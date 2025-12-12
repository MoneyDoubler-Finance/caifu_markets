import { FastifyPluginAsync } from 'fastify'
import { Redis } from 'ioredis'
import { z } from 'zod'
import { TradeUpdateSchema, MarketUpdateSchema } from '@caifu/types'
import { wsHealth } from './lib/wsHealth'
import { getRuntimeFlags } from './lib/runtimeFlags'
import { shouldLog } from './lib/logFilter'
import type { WebSocket } from 'ws'

// Extend WebSocket with custom fields for heartbeat tracking
interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean
  lastSeenAt?: number
}

// ─────────────────────────────────────────────────────────────
// Module-level registries for hot-reload safety
// ─────────────────────────────────────────────────────────────
const heartbeatDisposers: Array<() => void> = []
const allSocketSets: Array<Set<ExtendedWebSocket>> = []
let cleanupInitialized = false

/**
 * Cleanup all heartbeat intervals and terminate all sockets
 * Idempotent - safe to call multiple times
 */
export function cleanupAll(): void {
  // Clear all heartbeat intervals
  while (heartbeatDisposers.length > 0) {
    const disposer = heartbeatDisposers.pop()
    try {
      disposer?.()
    } catch (err) {
      console.error('ws: error during disposer cleanup', err)
    }
  }

  // Terminate all open sockets
  for (const socketSet of allSocketSets) {
    for (const socket of socketSet) {
      try {
        if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
          socket.terminate()
        }
      } catch (err) {
        // Ignore errors during shutdown
      }
    }
    socketSet.clear()
  }

  console.log('ws: cleanup complete (intervals cleared, sockets terminated)')
}

// ─────────────────────────────────────────────────────────────
// Process signal handlers for hot-reload safety
// ─────────────────────────────────────────────────────────────
if (!cleanupInitialized) {
  cleanupInitialized = true
  
  const onShutdown = () => {
    cleanupAll()
  }
  
  // Handle various shutdown signals
  // SIGUSR2 is sent by nodemon/tsx on restart
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGUSR2'] as const) {
    process.once(sig, onShutdown)
  }
  
  process.once('beforeExit', onShutdown)
}

/**
 * Helper to mark Trade events for health tracking
 * Call this from on-chain watcher when Trade events are published
 */
export function markTradeEvent(): void {
  wsHealth.onTradeEvent()
}

/**
 * Start heartbeat interval for a set of sockets
 * @param sockets Set of active sockets to monitor
 * @param endpoint Name of endpoint for logging
 * @param logger Optional logger instance for structured logging
 * @returns Cleanup function to clear interval
 */
function startHeartbeat(
  sockets: Set<ExtendedWebSocket>, 
  endpoint: string,
  logger?: any
): () => void {
  const flags = getRuntimeFlags()
  
  // Skip if ping disabled
  if (flags.WS_PING_MS <= 0) {
    return () => {} // no-op cleanup
  }
  
  // Log heartbeat config once on startup
  console.log(
    `ws: heartbeat enabled on ${endpoint} (ping=${Math.round(flags.WS_PING_MS / 1000)}s, idleDrop=${Math.round(flags.WS_IDLE_DROP_MS / 1000)}s)`
  )
  
  const interval = setInterval(() => {
    const now = Date.now()
    wsHealth.onPingCycle(now, endpoint)
    
    for (const socket of sockets) {
      // Defensive: skip if socket not in OPEN state
      if (socket.readyState !== socket.OPEN) {
        continue
      }

      // Check for idle timeout
      if (flags.WS_IDLE_DROP_MS > 0 && socket.lastSeenAt) {
        const idleDuration = now - socket.lastSeenAt
        if (idleDuration > flags.WS_IDLE_DROP_MS) {
          // Structured log for filtering
          const logContext = {
            kind: 'ws_drop',
            route: endpoint,
            reason: 'idle_timeout',
            idleMs: Math.round(idleDuration),
          }
          
          // Check if should log based on filters
          if (shouldLog(logContext)) {
            if (logger) {
              logger.info(logContext, 'ws: drop')
            } else {
              console.log(
                `ws: dropped client (reason=idle_timeout, idle=${Math.round(idleDuration / 1000)}s, route=${endpoint})`
              )
            }
          }
          
          wsHealth.onIdleDrop(endpoint)
          try {
            socket.terminate()
          } catch (err) {
            // Ignore termination errors
          }
          sockets.delete(socket)
          continue
        }
      }
      
      // Check heartbeat response
      if (socket.isAlive === false) {
        // Client didn't respond to previous ping - terminate
        
        // Structured log for filtering
        const logContext = {
          kind: 'ws_drop',
          route: endpoint,
          reason: 'missed_heartbeat',
        }
        
        // Check if should log based on filters
        if (shouldLog(logContext)) {
          if (logger) {
            logger.info(logContext, 'ws: drop')
          } else {
            console.log(`ws: dropped client (reason=missed_heartbeat, route=${endpoint})`)
          }
        }
        
        wsHealth.onMissedHeartbeat(endpoint)
        try {
          socket.terminate()
        } catch (err) {
          // Ignore termination errors
        }
        sockets.delete(socket)
        continue
      }
      
      // Mark as pending response and send ping
      socket.isAlive = false
      try {
        socket.ping()
      } catch (err) {
        // Socket may have closed, ignore ping errors
      }
    }
  }, flags.WS_PING_MS)
  
  // Return cleanup function
  return () => clearInterval(interval)
}

export const websocketHandler: FastifyPluginAsync = async (fastify) => {
  const { redis } = fastify

  // Log WebSocket endpoints ready
  fastify.log.info('ws: listening /ws/updates')

  // Track active sockets per endpoint for heartbeat
  const updatesSockets = new Set<ExtendedWebSocket>()
  
  // Register socket sets for cleanup
  allSocketSets.push(updatesSockets)
  
  // Start heartbeat intervals and register disposers (pass logger for structured logging)
  const cleanupUpdatesHeartbeat = startHeartbeat(updatesSockets, '/ws/updates', fastify.log)
  
  heartbeatDisposers.push(cleanupUpdatesHeartbeat)
  
  // Register cleanup on server close
  fastify.addHook('onClose', () => {
    cleanupUpdatesHeartbeat()
  })

  // General market updates WebSocket
  fastify.get('/updates', { websocket: true }, async (connection, request) => {
    const socket = connection.socket as ExtendedWebSocket
    const EP = '/ws/updates' // Stable endpoint label

    // Initialize heartbeat fields
    socket.isAlive = true
    socket.lastSeenAt = Date.now()
    updatesSockets.add(socket)

    // Track connection opened
    wsHealth.onOpen(EP)

    // Subscribe to all market updates and on-chain events
    const subscriber = new Redis(process.env.REDIS_URL!)

    // Handle pong responses
    socket.on('pong', () => {
      const now = Date.now()
      socket.isAlive = true
      socket.lastSeenAt = now
      wsHealth.onPong(now, EP)
    })

    socket.on('message', (message: string) => {
      // Update last seen time
      socket.lastSeenAt = Date.now()
      
      // Track client message
      wsHealth.onClientMsg()

      try {
        const data = JSON.parse(message)
        fastify.log.info('WebSocket message:', data)
      } catch (error) {
        fastify.log.error({ error }, 'Invalid WebSocket message')
      }
    })

    // Subscribe to both market updates and on-chain events
    try {
      await subscriber.subscribe('market:*')
      await subscriber.psubscribe('events:*')  // Pattern subscribe for all event types
    } catch (error) {
      fastify.log.error({ error }, 'Failed to subscribe to Redis channels for updates')
      socket.terminate()
      return
    }

    subscriber.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message)

        if (socket.readyState === 1) {
          socket.send(JSON.stringify(data))
        }
      } catch (error) {
        fastify.log.error({ error }, 'Error processing Redis message')
      }
    })
    
    subscriber.on('pmessage', (pattern, channel, message) => {
      try {
        const eventType = channel.split(':')[1]  // Extract 'Trade', 'MarketCreated', etc.
        const payload = JSON.parse(message)
        
        const data = {
          type: eventType,
          payload
        }

        if (socket.readyState === 1) {
          socket.send(JSON.stringify(data))
        }
        
        fastify.log.info(`Broadcasting ${eventType} event to WS client`)
      } catch (error) {
        fastify.log.error({ error }, 'Error processing Redis pmessage')
      }
    })

    // Handle Redis connection errors
    subscriber.on('error', (error) => {
      fastify.log.error({ error }, 'Redis subscriber error for updates')
      socket.terminate()
    })

    socket.on('close', async () => {
      // Remove from active sockets
      updatesSockets.delete(socket)
      
      // Track connection closed
      wsHealth.onClose(EP)

      // Clean up Redis subscriptions with error handling
      try {
        await subscriber.unsubscribe('market:*')
      } catch (error) {
        fastify.log.error({ error }, 'Error unsubscribing from market:* channel')
      }
      
      try {
        await subscriber.punsubscribe('events:*')
      } catch (error) {
        fastify.log.error({ error }, 'Error unsubscribing from events:* pattern')
      }
      
      try {
        await subscriber.quit()
      } catch (error) {
        fastify.log.error({ error }, 'Error closing Redis connection for updates')
      }
    })

    socket.on('error', () => {
      // Remove from active sockets on error
      updatesSockets.delete(socket)
      wsHealth.onClose(EP)
    })
  })
}

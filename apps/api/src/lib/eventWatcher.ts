/**
 * Optional WebSocket Event Watcher
 * Watches on-chain events if RPC_WS_URL is configured
 */

import { wsClient, connectionInfo } from '@caifu/sdk'
import type { Redis } from 'ioredis'

interface EventWatcherOptions {
  redis: Redis
}

/**
 * Initialize event watchers if WebSocket is available
 * @deprecated This function is no longer used. Use initOnchainWatchers from lib/onchain.ts instead.
 */
export function initializeEventWatchers(options: EventWatcherOptions) {
  const { redis } = options

  if (!wsClient) {
    console.log('WebSocket not configured - skipping on-chain event watchers')
    console.log('Real-time updates will use Redis pub/sub only')
    return
  }

  console.log('WebSocket enabled - initializing on-chain event watchers')
  console.log('WS URL:', connectionInfo.wsUrl)

  // Example: Watch Exchange Trade events (if needed in the future)
  // Uncomment and customize based on your needs
  /*
  wsClient.watchContractEvent({
    address: config.contractAddresses.exchange as `0x${string}`,
    abi: ExchangeAbi,
    eventName: 'OrderFilled',
    onLogs: async (logs) => {
      for (const log of logs) {
        console.log('On-chain OrderFilled event:', log)
        
        // Publish to Redis for other services
        await redis.publish('chain:events:order-filled', JSON.stringify({
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          args: log.args,
        }))
      }
    },
    onError: (error) => {
      console.error('Error watching OrderFilled events:', error)
    },
  })

  wsClient.watchContractEvent({
    address: config.contractAddresses.marketFactory as `0x${string}`,
    abi: MarketFactoryAbi,
    eventName: 'MarketCreated',
    onLogs: async (logs) => {
      for (const log of logs) {
        console.log('On-chain MarketCreated event:', log)
        
        await redis.publish('chain:events:market-created', JSON.stringify({
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          args: log.args,
        }))
      }
    },
    onError: (error) => {
      console.error('Error watching MarketCreated events:', error)
    },
  })
  */

  console.log('Event watchers initialized successfully')
}

/**
 * Cleanup event watchers on shutdown
 */
export async function cleanupEventWatchers() {
  if (wsClient) {
    console.log('Cleaning up WebSocket event watchers...')
    // WebSocket client cleanup happens automatically when process exits
  }
}


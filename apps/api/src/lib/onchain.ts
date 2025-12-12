/**
 * On-chain event watchers
 * Subscribes to MarketFactory events via WebSocket
 */
import { wsClient, MARKET_FACTORY_ABI } from '@caifu/sdk'
import { ENV } from '@caifu/config'
import type { Redis } from 'ioredis'
import type { Address, Hex, Log } from 'viem'
import { addMarket as addPositionMarket } from '../workers/positionIndex'

export type OnchainEvent =
  | { type: 'MarketCreated'; payload: any }

export interface OnchainWatcherOptions {
  redis: Redis
  log?: (msg: string, meta?: any) => void
}

const ENABLE_INDEXER = Boolean((ENV as any).ENABLE_INDEXER ?? false)

let unwatchFns: (() => void)[] = []

/**
 * Initialize on-chain event watchers (idempotent)
 * Returns a cleanup function to stop all watchers
 */
export async function initOnchainWatchers(opts: OnchainWatcherOptions): Promise<() => void> {
  // Guard against multiple initializations
  if ((globalThis as any).__onchainStarted) {
    opts.log?.('On-chain watchers already started, skipping')
    return () => {}
  }
  ;(globalThis as any).__onchainStarted = true

  const { redis, log } = opts

  // If WebSocket client not available, skip
  if (!wsClient) {
    log?.('WS disabled: RPC_WS_URL not configured')
    return () => {}
  }

  log?.('Starting on-chain event watchers', { wsEnabled: true })
  
  // Track which watchers are active for summary log
  const activeWatchers: string[] = []

  // Publish function to broadcast events
  const publish = (evt: OnchainEvent) => {
    try {
      redis?.publish?.(`events:${evt.type}`, JSON.stringify(evt.payload))
    } catch (err) {
      log?.('Failed to publish event to Redis', err)
    }
  }

  try {
    // Read contract addresses from env
    const MARKET_FACTORY_ADDRESS = (process.env.MARKET_FACTORY_ADDRESS || '') as Address

    // Watch MarketFactory MarketCreated events
    if (MARKET_FACTORY_ADDRESS) {
      try {
        const unwatch = wsClient.watchContractEvent({
          address: MARKET_FACTORY_ADDRESS,
          abi: MARKET_FACTORY_ABI,
          eventName: 'MarketCreated',
          onLogs: (logs: Log[]) => {
            logs.forEach((eventLog: any) => {
              try {
                const { marketId, conditionId, title, outcomes, creator } = eventLog.args || {}
                if (ENABLE_INDEXER && conditionId && marketId) {
                  addPositionMarket(conditionId as Hex, marketId.toString())
                }
                publish({
                  type: 'MarketCreated',
                  payload: {
                    txHash: eventLog.transactionHash,
                    blockNumber: Number(eventLog.blockNumber),
                    logIndex: eventLog.logIndex,
                    marketId: marketId?.toString(),
                    conditionId,
                    title,
                    outcomes,
                    creator,
                    timestamp: Date.now(),
                  },
                })
                log?.('MarketCreated event received', { marketId: marketId?.toString(), title })
              } catch (err) {
                log?.('Error processing MarketCreated event', err)
              }
            })
          },
          onError: (error: Error) => {
            log?.('MarketFactory watcher error', error.message)
          },
        })
        unwatchFns.push(unwatch)
        activeWatchers.push('Factory')
        log?.('Watching MarketFactory MarketCreated events', { address: MARKET_FACTORY_ADDRESS })
      } catch (err) {
        log?.('Failed to setup MarketFactory watcher', err instanceof Error ? err.message : String(err))
      }
    } else {
      log?.('MarketFactory address not configured, skipping MarketFactory watcher')
    }

    // Log summary of active watchers
    if (activeWatchers.length > 0) {
      log?.(`watchers: ${activeWatchers.join(' | ')} active`)
    }
  } catch (error) {
    log?.('Error setting up event watchers', error instanceof Error ? error.message : String(error))
  }

  // Return cleanup function
  return () => {
    log?.('Stopping on-chain event watchers')
    unwatchFns.forEach((unwatch) => {
      try {
        unwatch()
      } catch (err) {
        log?.('Error during unwatch', err)
      }
    })
    unwatchFns = []
    ;(globalThis as any).__onchainStarted = false
  }
}

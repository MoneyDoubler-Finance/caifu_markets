/**
 * React hook for consuming live on-chain events from the API WebSocket
 */

import { useEffect, useRef } from 'react'
import { createApiWs, type WsTradePayload, type WsMarketCreatedPayload, type WsMarketResolvedPayload } from '@/lib/ws'

export type TradeEvt = {
  marketId: string | number
  outcome?: number
  price: string
  size: string
  txHash: `0x${string}`
  blockNumber: number
  orderHash?: string
  taker?: string
  timestamp?: number
}

export type MarketCreatedEvt = {
  marketId: string | number
  title: string
  conditionId?: `0x${string}`
  txHash?: `0x${string}`
  outcomes?: string[]
  creator?: string
  blockNumber?: number
  timestamp?: number
}

export type MarketResolvedEvt = {
  marketId: string | number
  payouts?: number[]
  txHash?: `0x${string}`
  payoutNumerators?: string[]
  blockNumber?: number
  timestamp?: number
}

export interface OnchainEventsOptions {
  onTrade?: (e: TradeEvt) => void
  onMarketCreated?: (e: MarketCreatedEvt) => void
  onMarketResolved?: (e: MarketResolvedEvt) => void
  enabled?: boolean
}

/**
 * Hook to listen to live on-chain events from the API WebSocket
 * Automatically connects/disconnects based on component lifecycle
 */
export function useOnchainEvents(opts?: OnchainEventsOptions): void {
  const { onTrade, onMarketCreated, onMarketResolved, enabled = true } = opts || {}
  
  // Store callbacks in refs to avoid reconnecting when they change
  const onTradeRef = useRef(onTrade)
  const onMarketCreatedRef = useRef(onMarketCreated)
  const onMarketResolvedRef = useRef(onMarketResolved)

  useEffect(() => {
    onTradeRef.current = onTrade
    onMarketCreatedRef.current = onMarketCreated
    onMarketResolvedRef.current = onMarketResolved
  }, [onTrade, onMarketCreated, onMarketResolved])

  useEffect(() => {
    if (!enabled) return

    const ws = createApiWs((evt) => {
      try {
        // Guard for malformed messages
        if (!evt || typeof evt !== 'object' || !evt.type || !evt.payload) {
          console.warn('[useOnchainEvents] malformed event:', evt)
          return
        }

        const { type, payload } = evt

        switch (type) {
          case 'Trade':
            if (onTradeRef.current && payload) {
              const tradePayload = payload as WsTradePayload
              onTradeRef.current({
                marketId: tradePayload.marketId,
                outcome: tradePayload.outcome,
                price: tradePayload.price || '0',
                size: tradePayload.size || '0',
                txHash: tradePayload.txHash,
                blockNumber: tradePayload.blockNumber,
                orderHash: tradePayload.orderHash,
                taker: tradePayload.taker,
                timestamp: tradePayload.timestamp || Date.now(),
              })
            }
            break

          case 'MarketCreated':
            if (onMarketCreatedRef.current && payload) {
              const marketPayload = payload as WsMarketCreatedPayload
              onMarketCreatedRef.current({
                marketId: marketPayload.marketId,
                title: marketPayload.title || 'Untitled Market',
                conditionId: marketPayload.conditionId,
                txHash: marketPayload.txHash,
                outcomes: marketPayload.outcomes,
                creator: marketPayload.creator,
                blockNumber: marketPayload.blockNumber,
                timestamp: marketPayload.timestamp || Date.now(),
              })
            }
            break

          case 'MarketResolved':
            if (onMarketResolvedRef.current && payload) {
              const resolvedPayload = payload as WsMarketResolvedPayload
              onMarketResolvedRef.current({
                marketId: resolvedPayload.marketId,
                payouts: resolvedPayload.payoutNumerators?.map((p: string) => parseInt(p, 10)),
                txHash: resolvedPayload.txHash,
                payoutNumerators: resolvedPayload.payoutNumerators,
                blockNumber: resolvedPayload.blockNumber,
                timestamp: resolvedPayload.timestamp || Date.now(),
              })
            }
            break

          default:
            // Unknown event type, ignore
            break
        }
      } catch (error) {
        console.error('[useOnchainEvents] error processing event:', error)
      }
    })

    // Cleanup on unmount
    return () => {
      ws.close()
    }
  }, [enabled])
}

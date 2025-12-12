/**
 * WebSocket client for real-time on-chain events
 * Connects to API /ws/updates endpoint and handles reconnection
 */

import { getWsApiBase } from '@/lib/runtimeConfig'

// Define WebSocket event payload types
export interface WsTradePayload {
  marketId: string | number
  outcome?: number
  price?: string
  size?: string
  txHash: `0x${string}`
  blockNumber: number
  orderHash?: string
  taker?: string
  timestamp?: number
}

export interface WsMarketCreatedPayload {
  marketId: string | number
  title?: string
  conditionId?: `0x${string}`
  txHash?: `0x${string}`
  outcomes?: string[]
  creator?: string
  blockNumber?: number
  timestamp?: number
}

export interface WsMarketResolvedPayload {
  marketId: string | number
  payouts?: number[]
  txHash?: `0x${string}`
  payoutNumerators?: string[]
  blockNumber?: number
  timestamp?: number
}

export type WsEventPayload = WsTradePayload | WsMarketCreatedPayload | WsMarketResolvedPayload

type Handler = (evt: { type: string; payload: WsEventPayload }) => void

export function createApiWs(onMessage: Handler): { close(): void } {
  let baseWsUrl = 'wss://api.example.com'
  try {
    baseWsUrl = getWsApiBase()
  } catch (error) {
    console.error('[ws] Failed to resolve WS base, using fallback', error)
  }
  const wsUrl = `${baseWsUrl}/ws/updates`
  
  let ws: WebSocket | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  let isClosing = false

  function connect() {
    if (isClosing) return

    try {
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('[ws] connected to', wsUrl)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          onMessage(data)
        } catch (err) {
          console.warn('[ws] failed to parse message:', err)
        }
      }

      ws.onerror = (error) => {
        console.warn('[ws] error:', error)
      }

      ws.onclose = () => {
        console.log('[ws] disconnected, reconnecting in 3s...')
        ws = null
        
        if (!isClosing) {
          reconnectTimer = setTimeout(() => {
            connect()
          }, 3000)
        }
      }
    } catch (err) {
      console.error('[ws] failed to connect:', err)
      if (!isClosing) {
        reconnectTimer = setTimeout(() => {
          connect()
        }, 3000)
      }
    }
  }

  // Start connection
  connect()

  // Return cleanup function
  return {
    close: () => {
      isClosing = true
      
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      
      if (ws) {
        ws.close()
        ws = null
      }
    }
  }
}

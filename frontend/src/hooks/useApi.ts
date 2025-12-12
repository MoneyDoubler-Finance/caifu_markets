import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, fetchJSON, getAuthToken, ApiRequestError } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'
import type { PublicCreateMarketInput, ResolveMarketRequest } from '@caifu/types'

// Query keys
export const queryKeys = {
  markets: ['markets'] as const,
  market: (id: string) => ['markets', id] as const,
  marketTrades: (id: string) => ['markets', id, 'trades'] as const,
  positions: (user: string) => ['positions', user] as const,
  adminStats: ['admin', 'stats'] as const,
}

// Markets hooks
export type MarketCreationResponse = {
  id: string
  slug?: string | null
  conditionId?: string | null
  fpmmAddress?: string | null
  question?: string | null
  outcomes?: string[]
  heroImageUrl?: string | null
  seedTransactions?: Record<string, string | null>
  requiresUserFunding?: boolean
  userLiquidityAmount?: string | null
}

export const useMarkets = () => {
  return useQuery({
    queryKey: queryKeys.markets,
    queryFn: () => apiClient.getMarkets(),
    staleTime: 30000, // 30 seconds
  })
}

export const useMarket = (marketId: string) => {
  return useQuery({
    queryKey: queryKeys.market(marketId),
    queryFn: () => apiClient.getMarket(marketId),
    enabled: !!marketId,
  })
}

export const useMarketTrades = (marketId: string, limit = 50, offset = 0) => {
  return useQuery({
    queryKey: [...queryKeys.marketTrades(marketId), limit, offset],
    queryFn: () => apiClient.getMarketTrades(marketId, limit, offset),
    enabled: !!marketId,
  })
}

export const usePositions = (userAddress: string) => {
  return useQuery({
    queryKey: queryKeys.positions(userAddress),
    queryFn: () => apiClient.getPositions(userAddress),
    enabled: !!userAddress,
  })
}

type MarketCreationError = Error & { issues?: unknown }

export const useCreateMarket = () => {
  const queryClient = useQueryClient()

  return useMutation<MarketCreationResponse, MarketCreationError, PublicCreateMarketInput>({
    mutationFn: async (marketData) => {
      try {
        const url = API_BASE ? `${API_BASE}/api/markets` : '/api/markets'
        return await fetchJSON<MarketCreationResponse>(url, {
          method: 'POST',
          body: JSON.stringify(marketData),
        })
      } catch (err) {
        const baseMessage = err instanceof Error ? err.message : 'Failed to create market'
        const error = new Error(baseMessage) as MarketCreationError
        if (err instanceof ApiRequestError && err.body && typeof err.body === 'object' && 'issues' in err.body) {
          ;(error as any).issues = (err.body as Record<string, unknown>).issues
        }
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.markets })
    },
  })
}

export const useResolveMarket = () => {
  const queryClient = useQueryClient()
  const token = getAuthToken()

  return useMutation({
    mutationFn: ({ marketId, resolutionData }: {
      marketId: string
      resolutionData: ResolveMarketRequest
    }) => apiClient.resolveMarket(marketId, resolutionData, token!),
    onSuccess: (_, { marketId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.market(marketId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.markets })
    },
  })
}

export const useAdminStats = () => {
  const token = getAuthToken()

  return useQuery({
    queryKey: queryKeys.adminStats,
    queryFn: () => apiClient.getAdminStats(token!),
    enabled: !!token,
  })
}

// WebSocket hook for real-time updates
export const useWebSocket = (path: string = '/ws/updates') => {
  const queryClient = useQueryClient()

  const connect = () => {
    const ws = apiClient.createWebSocket(path)

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        // Handle different message types
        switch (data.type) {
          case 'trade_update':
            // Invalidate trade queries
            queryClient.invalidateQueries({
              queryKey: ['markets', data.trade.marketId, 'trades']
            })
            break
          case 'market_update':
            // Update market data
            queryClient.setQueryData(
              queryKeys.market(data.market.id),
              data.market
            )
            queryClient.invalidateQueries({ queryKey: queryKeys.markets })
            break
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    return ws
  }

  return { connect }
}

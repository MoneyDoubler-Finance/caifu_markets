import type { MarketResponse } from '@caifu/types'
import type { MarketSummary, PortfolioSnapshot, SummaryTrade } from '@/types'
import { fetchJSON, ApiRequestError } from '@/lib/api'
import { buildApiUrl } from '@/lib/apiBase'

type RequestJsonOptions = {
  timeoutMs?: number
}

async function requestJson<T>(url: string, options?: RequestJsonOptions): Promise<T> {
  return fetchJSON<T>(
    url,
    {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
      },
    },
    options
  )
}

const paramsToQuery = (params?: URLSearchParams | Record<string, string | number | undefined>) => {
  if (!params) return ''
  if (params instanceof URLSearchParams) {
    const query = params.toString()
    return query ? `?${query}` : ''
  }
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return
    search.set(key, String(value))
  })
  const query = search.toString()
  return query ? `?${query}` : ''
}

export async function getMarkets(params?: URLSearchParams | Record<string, string | number | undefined>) {
  const query = paramsToQuery(params)
  const url = buildApiUrl(`/api/markets${query}`)
  return requestJson<MarketResponse[]>(url)
}

type GetMarketSummaryOptions = {
  ignoreCache?: boolean
  timeoutMs?: number
}

export async function getMarketSummary(id: string, options?: GetMarketSummaryOptions) {
  if (!id) {
    throw new Error('market id required')
  }
  const encoded = encodeURIComponent(id)
  const search = new URLSearchParams()
  if (options?.ignoreCache) {
    search.set('ignoreCache', '1')
  }
  const query = search.toString()
  const suffix = query ? `?${query}` : ''

  try {
    const url = buildApiUrl(`/api/markets/${encoded}/summary${suffix}`)
    return await requestJson<MarketSummary>(url, options?.timeoutMs ? { timeoutMs: options.timeoutMs } : undefined)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      throw error
    }
    return null
  }
}

/**
 * Backwards-compatible alias – prefer `getMarketSummary` for clarity.
 */
export async function getMarket(id: string, options?: GetMarketSummaryOptions) {
  const summary = await getMarketSummary(id, options)
  if (!summary) {
    throw new Error('Failed to load market summary')
  }
  return summary
}

type MarketEnvelope = {
  ok?: boolean
  market?: MarketResponse | null
}

const isMarketResponse = (payload: unknown): payload is MarketResponse => {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    'id' in payload &&
    typeof (payload as { id?: unknown }).id === 'string'
  )
}

type GetMarketDetailsOptions = {
  timeoutMs?: number
}

export async function getMarketDetails(id: string, options?: GetMarketDetailsOptions): Promise<MarketResponse | null> {
  if (!id) {
    throw new Error('market id required')
  }

  const encoded = encodeURIComponent(id)
  try {
    const url = buildApiUrl(`/api/markets/${encoded}`)
    const payload = await requestJson<MarketResponse | MarketEnvelope>(
      url,
      options?.timeoutMs ? { timeoutMs: options.timeoutMs } : undefined
    )

    if (isMarketResponse(payload)) {
      return payload
    }

    if (payload && typeof payload === 'object' && 'ok' in payload) {
      const envelope = payload as MarketEnvelope
      if (envelope.ok && envelope.market && isMarketResponse(envelope.market)) {
        return envelope.market
      }
    }

    return null
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      throw error
    }
    return null
  }
}

export async function getPortfolio(address: string) {
  if (!address) {
    throw new Error('wallet address required')
  }
  try {
    const url = buildApiUrl(`/api/portfolio/${encodeURIComponent(address)}`)
    return await requestJson<PortfolioSnapshot>(url)
  } catch (error) {
    // Backward-compatibility: fall back to legacy query param route if the new path is unavailable
    const fallbackUrl = buildApiUrl(`/api/portfolio?owner=${encodeURIComponent(address)}`)
    return requestJson<PortfolioSnapshot>(fallbackUrl)
  }
}

export async function getTrades(params?: { marketId?: string; limit?: number }) {
  const search = new URLSearchParams()
  if (params?.marketId) {
    search.set('marketId', params.marketId)
  }
  if (params?.limit) {
    search.set('limit', String(params.limit))
  }
  const query = search.toString()
  const suffix = query ? `?${query}` : ''
  const url = buildApiUrl(`/api/trades${suffix}`)
  return requestJson<SummaryTrade[]>(url)
}

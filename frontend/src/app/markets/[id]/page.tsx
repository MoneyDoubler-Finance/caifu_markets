import MarketPageClient from './MarketPageClient'
import type { MarketSummary } from '@/types'
import { getMarketSummary, getMarketDetails } from '@/lib/dataSource'
import { ApiRequestError } from '@/lib/api'

type ApiMarketPayload = {
  id: string
  conditionId?: string | null
  fpmmAddress?: string | null
  title?: string | null
  description?: string | null
  category?: string | null
  outcomes?: string[]
  status?: string | null
  createdAt?: string | null
  expiresAt?: string | null
  resolvedAt?: string | null
  resolutionData?: Record<string, unknown> | null
  creator?: string | null
  tags?: string[] | null
  slug?: string | null
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const dynamicParams = true

const SSR_REQUEST_TIMEOUT_MS = 1500

const decodeMarketParam = (value?: string | null): string => {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default async function MarketDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const rawMarketParam = decodeMarketParam(params?.id)
  const marketKey = rawMarketParam.trim()

  let summary: MarketSummary | null = null
  let apiMarket: ApiMarketPayload | null = null
  let sawNotFound = false

  if (marketKey) {
    try {
      summary = await getMarketSummary(marketKey, { timeoutMs: SSR_REQUEST_TIMEOUT_MS })
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        sawNotFound = true
      } else {
        console.error('[market page] Failed to load market summary', { error, marketKey })
      }
    }

    if (summary?.market) {
      apiMarket = summary.market as ApiMarketPayload
    } else {
      try {
        const fallbackMarket = await getMarketDetails(marketKey, { timeoutMs: SSR_REQUEST_TIMEOUT_MS })
        if (fallbackMarket) {
          apiMarket = fallbackMarket as ApiMarketPayload
        }
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) {
          sawNotFound = true
        } else {
          console.error('[market page] Failed to load fallback market payload', { error, marketKey })
        }
      }
    }
  } else {
    console.warn('[market page] Missing market param; deferring to client hydration', { params })
  }

  if (!summary && !apiMarket) {
    console.warn('[market page] API returned no payload; deferring to client hydration', {
      marketKey,
      sawNotFound,
    })
  }

  const initialError = (() => {
    if (!marketKey) return 'Missing market id in URL; retrying in browser.'
    if (summary) return null
    if (apiMarket) return 'Loaded partial market data; refreshing in browser.'
    if (sawNotFound) return 'Market not found via API (404); retrying in browser.'
    return 'Failed to load market; retrying in browser.'
  })()

  return (
    <MarketPageClient
      marketKey={marketKey}
      initialApiMarket={apiMarket}
      initialSummary={summary}
      initialError={initialError}
    />
  )
}

/**
 * Centralized API client with runtime validation and error handling
 */

import { FEATURE_ORDERBOOK } from './features'
import type {
  MarketMetrics,
  Candle,
  TradeEvent,
  IndexedEvent,
} from '@/types'

import { getHttpApiBase, getWsApiBase, resolveHttpBase, DEV_HTTP_DEFAULT, DEV_HOSTS } from '@/lib/runtimeConfig'
import { API_BASE, buildApiUrl } from '@/lib/apiBase'

const getHttpBaseUrl = (): string => getHttpApiBase()

export class ApiRequestError extends Error {
  status: number
  bodyText?: string
  body?: unknown

  constructor(message: string, status: number, bodyText?: string, body?: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApiRequestError'
    this.status = status
    this.bodyText = bodyText
    this.body = body
  }
}

type FetchJsonOptions = {
  timeoutMs?: number
}

const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//i.test(value)

/**
 * Resolve the HTTP API base URL.
 * Priority: NEXT_PUBLIC_API_* envs → window.origin on deployed hosts → prod/dev defaults.
 */
export const getHttpApiBaseUrl = (): string => getHttpBaseUrl()

/**
 * Fetch JSON with automatic API base resolution. Throws ApiRequestError on non-2xx responses.
 */
export async function fetchJSON<T = any>(
  pathOrUrl: string,
  init?: RequestInit,
  options?: FetchJsonOptions
): Promise<T> {
  const isAbsolute = isAbsoluteHttpUrl(pathOrUrl)
  const normalizedPath = isAbsolute
    ? pathOrUrl
    : `${getHttpBaseUrl()}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`

  const controller = options?.timeoutMs ? new AbortController() : undefined
  let timeoutId: NodeJS.Timeout | undefined

  const headers = new Headers(init?.headers ?? {})
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }
  const shouldSetJson = init?.body && typeof init.body === 'string'
  if (shouldSetJson && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const requestInit: RequestInit = {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    signal: controller?.signal ?? init?.signal,
    headers,
  }

  if (controller && options?.timeoutMs) {
    timeoutId = setTimeout(() => {
      controller.abort()
    }, options.timeoutMs)
  }

  let response: Response
  try {
    response = await fetch(normalizedPath, requestInit)
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    const message = error instanceof Error ? error.message : 'Network error'
    throw new ApiRequestError(message, 0, undefined, undefined, error instanceof Error ? { cause: error } : undefined)
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }

  const status = response.status

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    let body: unknown = undefined
    try {
      body = bodyText ? JSON.parse(bodyText) : undefined
    } catch {
      body = undefined
    }

    let message = `HTTP ${status}`
    if (body && typeof body === 'object') {
      const maybeError = (body as Record<string, any>).error
      const maybeMessage = (body as Record<string, any>).message
      if (typeof maybeError === 'string') {
        message = maybeError
      } else if (maybeError && typeof maybeError.message === 'string') {
        message = maybeError.message
      } else if (typeof maybeMessage === 'string') {
        message = maybeMessage
      }
    } else if (bodyText) {
      message = bodyText
    }

    throw new ApiRequestError(message, status, bodyText, body)
  }

  if (status === 204 || status === 304) {
    return undefined as T
  }

  const text = await response.text()
  if (!text) {
    return undefined as T
  }

  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

/**
 * Get the configured API base URL (for display/debugging)
 */
export function getApiBaseUrl(): string | undefined {
  try {
    return getHttpBaseUrl()
  } catch (err) {
    console.error('[API Client] Failed to resolve API base URL:', err)
    return undefined
  }
}

export async function uploadMarketHeroImage(file: File): Promise<string> {
  const uploadUrl = buildApiUrl('/api/market-hero/upload')
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  let payload: any = null
  try {
    payload = await response.json()
  } catch (error) {
    payload = null
  }

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error ||
      `Upload failed (HTTP ${response.status})`
    throw new Error(message)
  }

  if (!payload || typeof payload.imageUrl !== 'string') {
    throw new Error('Upload failed: invalid response from server')
  }

  return payload.imageUrl
}

export async function fetchMarketMetrics(idOrSlug: string): Promise<MarketMetrics> {
  const encoded = encodeURIComponent(idOrSlug)
  const url = buildApiUrl(`/api/markets/${encoded}/metrics`)
  const payload = await fetchJSON<MarketMetrics>(url)
  if (!payload.spot) {
    return {
      marketId: payload.marketId,
      fpmmAddress: payload.fpmmAddress,
      spot: null,
      volume24hUSDF: payload.volume24hUSDF ?? '0',
      tvlUSDF: payload.tvlUSDF ?? '0',
      lastTradeAt: payload.lastTradeAt ?? null,
    }
  }

  return {
    ...payload,
    volume24hUSDF: payload.volume24hUSDF ?? '0',
  }
}

export async function fetchMarketCandles(
  idOrSlug: string,
  tf = '5m',
  limit = 200
): Promise<Candle[]> {
  const encoded = encodeURIComponent(idOrSlug)
  const url = buildApiUrl(`/api/markets/${encoded}/candles?tf=${encodeURIComponent(tf)}&limit=${limit}`)
  const payload = await fetchJSON<Candle[]>(url)

  if (!Array.isArray(payload)) {
    return []
  }

  return payload
}

type LiveEventHandlers = {
  onTrade?: (trade: TradeEvent) => void
  onIndexed?: (event: IndexedEvent) => void
  onComment?: (event: import('@/types').CommentEvent) => void
}

export function openLiveTradesSSE(
  idOrSlug: string,
  handlers: LiveEventHandlers
): EventSource {
  const encoded = encodeURIComponent(idOrSlug)
  const url = buildApiUrl(`/api/markets/${encoded}/live`)

  const eventSource = new EventSource(url, { withCredentials: true })

  eventSource.onmessage = (event) => {
    if (!event?.data) return
    try {
      const payload = JSON.parse(event.data) as TradeEvent | IndexedEvent | import('@/types').CommentEvent | undefined
      if (!payload || typeof payload !== 'object') return
      if ('type' in payload && payload.type === 'indexed') {
        handlers.onIndexed?.(payload as IndexedEvent)
        return
      }
      if ('type' in payload && payload.type === 'comment') {
        handlers.onComment?.(payload as any)
        return
      }
      handlers.onTrade?.(payload as TradeEvent)
    } catch (err) {
      console.warn('[api] Failed to parse live trade payload', err)
    }
  }

  return eventSource
}

export async function notifyTx(txHash: string, marketId?: string | null): Promise<boolean> {
  const body = {
    txHash,
    ...(marketId ? { marketId } : {}),
  }
  try {
    const result = await fetchJSON<{ queued?: boolean }>(buildApiUrl('/api/tx-notify'), {
      method: 'POST',
      body: JSON.stringify(body),
    })

    return Boolean(result?.queued)
  } catch (error) {
    console.warn('[api] tx-notify failed', error)
    return false
  }
}

/**
 * Check if API base URL is configured and valid
 */
export function isApiConfigured(): { valid: boolean; error?: string; source: ApiBaseSource } {
  try {
    const resolution = resolveHttpBase()
    if (resolution.source === 'fallback' && resolution.value === DEV_HTTP_DEFAULT && typeof window !== 'undefined' && !DEV_HOSTS.has(window.location.hostname)) {
      return {
        valid: false,
        error: `Using local fallback API at ${resolution.value}. Set NEXT_PUBLIC_API_BASE_URL to https://api.example.com`,
        source: resolution.source,
      }
    }
    return { valid: true, source: resolution.source }
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Unable to resolve API base URL',
      source: 'env',
    }
  }
}

/**
 * Legacy API client class for backward compatibility
 * @deprecated Use fetchJSON instead
 */
class ApiClient {
  private async request<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Network error' }))
      throw new Error(error.error?.message || `HTTP ${response.status}`)
    }

    return response.json()
  }

  // Markets
  async getMarkets(): Promise<any[]> {
    const url = buildApiUrl('/api/markets')
    return this.request<any[]>(url)
  }

  async getMarket(marketId: string): Promise<any> {
    const url = buildApiUrl(`/api/markets/${marketId}`)
    return this.request<any>(url)
  }

  async getMarketTrades(marketId: string, limit = 50, offset = 0): Promise<any[]> {
    const url = buildApiUrl(`/api/markets/${marketId}/trades?limit=${limit}&offset=${offset}`)
    return this.request<any[]>(url)
  }

  async getPositions(userAddress: string): Promise<any[]> {
    const url = buildApiUrl(`/api/positions?user=${encodeURIComponent(userAddress)}`)
    return this.request<any[]>(url)
  }

  // Orders
  async createOrder(orderData: any): Promise<any> {
    if (!FEATURE_ORDERBOOK) {
      throw new Error('Orderbook disabled (AMM-only)')
    }
    const url = buildApiUrl('/api/orders')
    return this.request<any>(url, {
      method: 'POST',
      body: JSON.stringify(orderData),
    })
  }

  async getOrderbook(marketId: string): Promise<any> {
    if (!FEATURE_ORDERBOOK) {
      throw new Error('Orderbook disabled (AMM-only)')
    }
    const url = buildApiUrl(`/api/orderbook/${marketId}`)
    return this.request<any>(url)
  }

  async getOrders(userAddress?: string, status?: string): Promise<any[]> {
    if (!FEATURE_ORDERBOOK) {
      throw new Error('Orderbook disabled (AMM-only)')
    }
    const params = new URLSearchParams()
    if (userAddress) params.append('user', userAddress)
    if (status) params.append('status', status)

    const url = buildApiUrl(`/api/orders?${params.toString()}`)
    return this.request<any[]>(url)
  }

  async cancelOrder(orderId: string): Promise<any> {
    if (!FEATURE_ORDERBOOK) {
      throw new Error('Orderbook disabled (AMM-only)')
    }
    const url = buildApiUrl(`/api/orders/${orderId}`)
    return this.request<any>(url, {
      method: 'DELETE',
    })
  }

  // Admin
  async createMarket(marketData: any): Promise<any> {
    const url = buildApiUrl('/api/markets')
    return this.request<any>(url, {
      method: 'POST',
      body: JSON.stringify(marketData),
    })
  }

  async resolveMarket(marketId: string, resolutionData: any, token: string): Promise<any> {
    const url = buildApiUrl(`/api/admin/markets/${marketId}/resolve`)
    return this.request<any>(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(resolutionData),
    })
  }

  async getAdminStats(token: string): Promise<any> {
    const url = buildApiUrl('/api/admin/stats')
    return this.request<any>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  }

  // WebSocket
  createWebSocket(path: string): WebSocket {
    const wsBase = getWsApiBase()
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return new WebSocket(`${wsBase}${normalizedPath}`)
  }
}

// Export singleton instance for backward compatibility
export const apiClient = new ApiClient()

// Export function for getting auth token (stub for backward compatibility)
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('admin_token')
}

// --- Auth helpers ---
export async function requestAuthNonce(address: string): Promise<{ nonce: string; message: string }> {
  const result = await fetchJSON<{ ok: boolean; nonce?: string; message?: string; error?: string }>(
    buildApiUrl('/api/auth/request-signature'),
    {
      method: 'POST',
      body: JSON.stringify({ address }),
    }
  )
  if (!result?.ok || !result.nonce || !result.message) {
    throw new Error(result?.error || 'Failed to request signature')
  }
  return { nonce: result.nonce, message: result.message }
}

export async function verifyAuthSignature(params: {
  address: string
  signature: string
  nonce: string
}): Promise<import('@/types').SiteUser> {
  const result = await fetchJSON<{ ok: boolean; user?: import('@/types').SiteUser; error?: string }>(
    buildApiUrl('/api/auth/verify'),
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  )
  if (!result?.ok || !result.user) {
    throw new Error(result?.error || 'Failed to verify signature')
  }
  return result.user
}

export async function logoutUser(): Promise<void> {
  await fetchJSON(buildApiUrl('/api/auth/logout'), { method: 'POST' })
}

// --- Profile helpers ---
export async function updateUserProfile(payload: { displayName?: string; avatarUrl?: string | null }): Promise<import('@/types').SiteUser> {
  const result = await fetchJSON<{ ok: boolean; user?: import('@/types').SiteUser; error?: string }>(
    buildApiUrl('/api/profile'),
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  )
  if (!result?.ok || !result.user) {
    throw new Error(result?.error || 'Failed to update profile')
  }
  return result.user
}

export async function uploadProfileAvatar(file: File): Promise<string> {
  const uploadUrl = buildApiUrl('/api/profile/avatar')
  const form = new FormData()
  form.append('avatar', file)
  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: form,
    credentials: 'include',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok || typeof payload?.avatarUrl !== 'string') {
    const message = payload?.error || `Upload failed (HTTP ${response.status})`
    throw new Error(message)
  }
  return payload.avatarUrl as string
}

// --- Portfolio ---
export async function fetchPortfolio(owner: string): Promise<import('@/types').PortfolioSnapshot> {
  const url = buildApiUrl(`/api/portfolio/${encodeURIComponent(owner)}`)
  return fetchJSON<import('@/types').PortfolioSnapshot>(url)
}

// --- Comments ---
export async function fetchMarketComments(
  marketKey: string,
  opts?: { before?: string | number; limit?: number }
): Promise<import('@/types').MarketComment[]> {
  const params = new URLSearchParams()
  if (opts?.before) params.set('before', String(opts.before))
  if (opts?.limit) params.set('limit', String(opts.limit))
  const url = buildApiUrl(
    `/api/markets/${encodeURIComponent(marketKey)}/comments${params.toString() ? `?${params.toString()}` : ''}`
  )
  const result = await fetchJSON<{ ok: boolean; comments?: import('@/types').MarketComment[]; error?: string }>(url)
  if (!result?.ok || !Array.isArray(result.comments)) {
    throw new Error(result?.error || 'Failed to load comments')
  }
  return result.comments
}

export async function postMarketComment(
  marketKey: string,
  body: string,
  extras?: { txHash?: string; parentId?: string | null }
): Promise<import('@/types').MarketComment> {
  const url = buildApiUrl(`/api/markets/${encodeURIComponent(marketKey)}/comments`)
  const result = await fetchJSON<{ ok: boolean; comment?: import('@/types').MarketComment; error?: string }>(url, {
    method: 'POST',
    body: JSON.stringify({ body, ...(extras || {}) }),
  })
  if (!result?.ok || !result.comment) {
    throw new Error(result?.error || 'Failed to post comment')
  }
  return result.comment
}

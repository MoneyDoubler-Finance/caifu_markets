import { getApiBaseUrl } from '@/lib/api'

const SP_ENABLE = String(process.env.NEXT_PUBLIC_SHORTPIXEL_ENABLE || '').toLowerCase()
const SP_CLIENT = process.env.NEXT_PUBLIC_SHORTPIXEL_CLIENT || 'caifu'
// Comma-separated ShortPixel params. Keep sensible defaults for quality and first-hit behavior.
const SP_PARAMS = process.env.NEXT_PUBLIC_SHORTPIXEL_PARAMS || 'to_auto,q_glossy,ret_img'

const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  'https://api.example.com'

export const toAbsoluteMediaUrl = (value?: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  let base: string | undefined
  try {
    base = getApiBaseUrl()
  } catch (err) {
    base = undefined
  }

  const resolvedBase = base && base.trim().length > 0 ? base : DEFAULT_API_BASE
  const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return `${resolvedBase}${normalizedPath}`
}

// Build a ShortPixel Adaptive Images CDN URL from an absolute image URL.
// Docs: https://shortpixel.com/adaptive-images-api
export function toShortPixelUrl(absoluteUrl: string, opts?: { width?: number; params?: string; client?: string }) {
  if (!absoluteUrl) return absoluteUrl
  const client = (opts?.client || SP_CLIENT).replace(/[^a-z0-9_-]/gi, '') || 'client'
  const parts: string[] = []
  const baseParams = (opts?.params || SP_PARAMS).split(/[,+]/).map((p) => p.trim()).filter(Boolean)
  parts.push(...baseParams)
  if (opts?.width && Number.isFinite(opts.width) && (opts.width as number) > 0) {
    parts.push(`w_${Math.round(opts.width as number)}`)
  }
  const paramStr = parts.join(',')
  // Ensure the source is absolute (ShortPixel requires absolute URL)
  const src = absoluteUrl.startsWith('http') ? absoluteUrl : `https:${absoluteUrl.startsWith('//') ? absoluteUrl : '//' + absoluteUrl}`
  return `https://cdn.shortpixel.ai/${client}/${paramStr}/${src}`
}

// Convenience: wrap a (possibly relative) site URL, resolve it to absolute API base, then
// optionally proxy through ShortPixel if enabled via env.
export function optimizeViaShortPixelIfEnabled(value?: string | null, width?: number): string | null {
  const absolute = toAbsoluteMediaUrl(value)
  if (!absolute) return absolute
  const enabled = SP_ENABLE === '1' || SP_ENABLE === 'true' || SP_ENABLE === 'yes'
  if (!enabled) return absolute
  return toShortPixelUrl(absolute, { width })
}

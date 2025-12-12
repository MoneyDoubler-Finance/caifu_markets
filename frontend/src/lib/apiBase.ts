const normalizeApiBase = (value: string): string => {
  const trimmed = value.replace(/\/+$/, '')
  if (trimmed.toLowerCase().endsWith('/api')) {
    return trimmed.slice(0, -4)
  }
  return trimmed
}

// Accept legacy env names for backward compatibility (NEXT_PUBLIC_API_URL, API_URL)
const rawApiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL

// If envs are missing (common on preview/prod when misconfigured), fall back to the
// canonical production API host so SSR requests don’t silently hit http://localhost
// and 404. In local dev we fall back to the dev API.
const FALLBACK_API_BASE =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:3001'
    : 'https://api.example.com'

// Do NOT throw at import time; callers should handle undefined API_BASE downstream
const API_BASE = normalizeApiBase(rawApiBase ?? FALLBACK_API_BASE)

/**
 * Build an absolute API URL while safely normalizing the base.
 * Handles cases where the configured base already includes a path segment like "/api".
 */
export const buildApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const base = API_BASE ?? ''
  try {
    // new URL will avoid double-appending path segments (e.g., base ends with /api)
    return new URL(normalizedPath, base || 'http://localhost').toString()
  } catch {
    const trimmedBase = base.replace(/\/+$/, '')
    return `${trimmedBase}${normalizedPath}`
  }
}

export { API_BASE }

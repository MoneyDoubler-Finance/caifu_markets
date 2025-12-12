export const PROD_HTTP_DEFAULT = 'https://api.example.com'
export const DEV_HTTP_DEFAULT = 'http://localhost:3001'
const PROD_WS_DEFAULT = PROD_HTTP_DEFAULT.replace(/^http/, 'ws')
const LOCAL_WS_DEFAULT = DEV_HTTP_DEFAULT.replace(/^http/, 'ws')
export const DEV_HOSTS = new Set(['localhost', '127.0.0.1'])

const flagTrue = (value?: string | null) => {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

const sanitizeBase = (value: string) => value.replace(/\/+$/, '')
const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//i.test(value)
const isAbsoluteWsUrl = (value: string) => /^wss?:\/\//i.test(value)

const preferLocal =
  flagTrue(process.env.NEXT_PUBLIC_USE_LOCAL_API) ||
  flagTrue(process.env.USE_LOCAL_API) ||
  flagTrue(process.env.NEXT_PUBLIC_API_USE_LOCAL) ||
  flagTrue(process.env.API_USE_LOCAL)

const envHttpCandidates = [
  process.env.NEXT_PUBLIC_API_URL,
  process.env.NEXT_PUBLIC_API_BASE_URL,
  process.env.NEXT_PUBLIC_API_BASE,
  process.env.API_URL,
  process.env.API_BASE_URL,
]

const envWsCandidates = [
  process.env.NEXT_PUBLIC_WS_URL,
  process.env.NEXT_PUBLIC_WS_BASE_URL,
  process.env.WS_URL,
]

const isKnownDeployedHost = (hostname: string) =>
  hostname.endsWith('.vercel.app') ||
  hostname === 'example.com' ||
  hostname === 'www.example.com' ||
  hostname === 'app.example.com'

const pickCandidate = (candidates: Array<string | undefined | null>, validator: (value: string) => boolean) => {
  for (const candidate of candidates) {
    if (!candidate) continue
    const trimmed = candidate.trim()
    if (!trimmed) continue
    if (!validator(trimmed)) continue
    return sanitizeBase(trimmed)
  }
  return null
}

let cachedHttpBase: string | null = null
let cachedHttpSource: 'env' | 'origin' | 'fallback' | null = null
export const getHttpApiBase = (): string => {
  if (cachedHttpBase) return cachedHttpBase

  const envBase = pickCandidate(envHttpCandidates, isAbsoluteHttpUrl)
  if (envBase) {
    // If someone accidentally points the API base at a Vercel preview URL,
    // ignore it on the server so SSR always talks to the real API host.
    let safeEnvBase = envBase
    try {
      const url = new URL(envBase)
      if (url.hostname.endsWith('.vercel.app') && typeof window === 'undefined') {
        safeEnvBase = ''
      }
    } catch {
      // fall through and use the env value if it parses badly
    }

    if (safeEnvBase) {
      cachedHttpBase = safeEnvBase
      cachedHttpSource = 'env'
      return cachedHttpBase
    }
  }

  if (typeof window !== 'undefined') {
    const { origin, hostname } = window.location
    if (isKnownDeployedHost(hostname)) {
      if (hostname.endsWith('.vercel.app')) {
        cachedHttpBase = sanitizeBase(origin)
        cachedHttpSource = 'origin'
        return cachedHttpBase
      }
      cachedHttpBase = sanitizeBase(PROD_HTTP_DEFAULT)
      cachedHttpSource = 'fallback'
      return cachedHttpBase
    }
    if (DEV_HOSTS.has(hostname) && preferLocal) {
      cachedHttpBase = sanitizeBase(DEV_HTTP_DEFAULT)
      cachedHttpSource = 'fallback'
      return cachedHttpBase
    }
  }

  const fallback = preferLocal ? DEV_HTTP_DEFAULT : PROD_HTTP_DEFAULT
  cachedHttpBase = sanitizeBase(fallback)
  cachedHttpSource = 'fallback'
  return cachedHttpBase
}

let cachedWsBase: string | null = null
export const getWsApiBase = (): string => {
  if (cachedWsBase) return cachedWsBase

  const envBase = pickCandidate(envWsCandidates, isAbsoluteWsUrl)
  if (envBase) {
    cachedWsBase = envBase.replace(/\/+$/, '')
    return cachedWsBase
  }

  const httpBase = getHttpApiBase()
  if (cachedHttpSource === 'origin' && typeof window !== 'undefined') {
    // When proxying through the same origin (e.g., Vercel), prefer the public API host for WS
    cachedWsBase = sanitizeBase((preferLocal ? LOCAL_WS_DEFAULT : PROD_WS_DEFAULT))
    return cachedWsBase
  }

  cachedWsBase = sanitizeBase(httpBase.replace(/^http/, 'ws'))
  return cachedWsBase
}

export type ApiBaseSource = 'env' | 'origin' | 'fallback'

export const resolveHttpBase = (): { value: string; source: ApiBaseSource } => {
  const value = getHttpApiBase()
  const source = (cachedHttpSource ?? 'fallback') as ApiBaseSource
  return { value, source }
}

export const apiRuntimeConfig = {
  preferLocal,
  defaults: {
    http: {
      remote: PROD_HTTP_DEFAULT,
      local: DEV_HTTP_DEFAULT,
    },
    ws: {
      remote: PROD_WS_DEFAULT,
      local: LOCAL_WS_DEFAULT,
    },
  },
}

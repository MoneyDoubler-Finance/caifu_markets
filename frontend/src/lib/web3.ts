'use client'

import { createConfig, http, webSocket } from 'wagmi'
import { bsc, bscTestnet } from 'wagmi/chains'
import { injected, walletConnect, metaMask, coinbaseWallet } from 'wagmi/connectors'
import { fallback } from 'viem'
import { getHttpApiBase, getWsApiBase } from '@/lib/runtimeConfig'
import mainnetAddresses from '../../../packages/config/addresses.56.json'
import testnetAddresses from '../../../packages/config/addresses.97.json'

// Guard against misconfigured env vars that still point at testnet. We treat any URL
// containing "testnet" (or the common 97 chain id) as unsafe for mainnet hosts.
const dropIfTestnet = (url?: string | null) => {
  if (!url) return undefined
  const lower = url.toLowerCase()
  if (lower.includes('testnet') || lower.includes('chain=97') || lower.includes('97.')) {
    return undefined
  }
  return url
}

// Mainnet: hard‑pin to BSC mainnet RPCs. Always prefer Binance seed (cheap/unlimited),
// use Alchemy as fallback. Ignore anything that smells like testnet.
const BINANCE_MAINNET = 'https://bsc-dataseed.binance.org'

const ALCHEMY_MAINNET =
  dropIfTestnet(process.env.NEXT_PUBLIC_RPC_URL) ||
  dropIfTestnet(process.env.NEXT_PUBLIC_RPC_MAINNET_URL) ||
  dropIfTestnet(process.env.NEXT_PUBLIC_RPC_FALLBACK_URL) ||
  ''

const MAINNET_PRIMARY = BINANCE_MAINNET
const MAINNET_FALLBACK = ALCHEMY_MAINNET

// Testnet: keep legacy envs for local/dev only.
const TESTNET_PRIMARY =
  process.env.NEXT_PUBLIC_RPC_TESTNET_URL ||
  process.env.NEXT_PUBLIC_RPC_HTTP_URL ||
  'https://bsc-testnet.publicnode.com'

const TESTNET_FALLBACK =
  process.env.NEXT_PUBLIC_RPC_TESTNET_FALLBACK_URL ||
  process.env.NEXT_PUBLIC_RPC_HTTP_FALLBACK_URL ||
  ''

const makeTransport = (primary: string, secondary?: string) => {
  const candidates = [primary, secondary]
    .filter((value): value is string => Boolean(value && value.trim()))

  if (candidates.length <= 1) {
    return http(candidates[0] ?? primary)
  }

  return fallback(candidates.map((value) => http(value)), { retryCount: 1 })
}

const MAINNET_WS =
  dropIfTestnet(process.env.NEXT_PUBLIC_RPC_MAINNET_WS_URL) ||
  dropIfTestnet(process.env.NEXT_PUBLIC_RPC_WS_URL) ||
  ''

const TESTNET_WS =
  process.env.NEXT_PUBLIC_RPC_TESTNET_WS_URL ||
  ''

const mainnetHttpUrls = [MAINNET_PRIMARY, MAINNET_FALLBACK].filter(Boolean)
const testnetHttpUrls = [TESTNET_PRIMARY, TESTNET_FALLBACK].filter(Boolean)

const parseChainId = () => {
  // In production on our canonical hosts, always talk to BSC mainnet (56)
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || ''
    if (host.endsWith('example.com')) {
      return 56
    }
  }

  const raw = process.env.NEXT_PUBLIC_CHAIN_ID || process.env.NEXT_PUBLIC_FALLBACK_CHAIN_ID || '56'
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 56
}

export const TARGET_CHAIN_ID = parseChainId()

// BSC chain configuration
const bscMainnet = {
  ...bsc,
  rpcUrls: {
    ...bsc.rpcUrls,
    default: {
      http: mainnetHttpUrls.length > 0 ? mainnetHttpUrls : bsc.rpcUrls.default.http,
      webSocket: MAINNET_WS ? [MAINNET_WS] : []
    }
  }
} as const

const bscTestnetChain = {
  ...bscTestnet,
  rpcUrls: {
    ...bscTestnet.rpcUrls,
    default: {
      http: testnetHttpUrls.length > 0 ? testnetHttpUrls : bscTestnet.rpcUrls.default.http,
      webSocket: TESTNET_WS ? [TESTNET_WS] : []
    }
  }
} as const

// In production we only ever want a single active chain:
// - 56 (bscMainnet) for production domains
// - 97 (bscTestnet) for local / preview.
const configuredChains =
  TARGET_CHAIN_ID === bscMainnet.id
    ? [bscMainnet] as const
    : [bscTestnetChain] as const

// Configure chains & providers with RPC URLs
const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || ''

const connectors = [
  injected(),
  metaMask(),
  coinbaseWallet({
    appName: 'Caifu Markets',
    appLogoUrl: 'https://example.com/favicon.ico'
  }),
  ...(projectId ? [walletConnect({ projectId })] : []),
]

const createClientConfig = () => createConfig({
  autoConnect: false,
  // Prefer websocket-driven updates; HTTP polling is fallback only.
  chains: configuredChains,
  connectors,
  transports: {
    ...(TARGET_CHAIN_ID === bscMainnet.id
      ? { [bscMainnet.id]: makeTransport(MAINNET_PRIMARY, MAINNET_FALLBACK) }
      : { [bscTestnetChain.id]: makeTransport(TESTNET_PRIMARY, TESTNET_FALLBACK) }),
  },
  webSocketTransport: {
    ...(TARGET_CHAIN_ID === bscMainnet.id
      ? (MAINNET_WS ? { [bscMainnet.id]: webSocket(MAINNET_WS) } : {})
      : (TESTNET_WS ? { [bscTestnetChain.id]: webSocket(TESTNET_WS) } : {})),
  },
  ssr: true,
})

let cachedConfig: ReturnType<typeof createClientConfig> | null = null

export const getClientConfig = () => {
  const hasIDB = typeof window !== 'undefined' && 'indexedDB' in window

  if (!hasIDB) {
    return null
  }

  if (!cachedConfig) {
    cachedConfig = createClientConfig()
  }

  return cachedConfig
}

// Contract addresses from environment with fallbacks to packaged configs
const env = process.env

const ADDRESSES_BY_CHAIN: Record<number, Partial<typeof mainnetAddresses>> = {
  56: mainnetAddresses,
  97: testnetAddresses,
}

const DEFAULT_USDT_BY_CHAIN: Record<number, `0x${string}`> = {
  56: '0x55d398326f99059fF775485246999027B3197955',
}

const pickAddress = (
  envValue?: string,
  fallbackValue?: string,
): `0x${string}` | undefined => {
  const trimmedEnv = envValue?.trim()
  if (trimmedEnv) return trimmedEnv as `0x${string}`
  const trimmedFallback = fallbackValue?.trim()
  return trimmedFallback ? trimmedFallback as `0x${string}` : undefined
}

const chainDefaults = ADDRESSES_BY_CHAIN[TARGET_CHAIN_ID] || {}

// Use the established frontend env names (Vercel):
// NEXT_PUBLIC_DIRECT_ORACLE_ADDRESS and NEXT_PUBLIC_ADAPTER_ADDRESS
export const CONTRACT_ADDRESSES = {
  conditionalTokens: pickAddress(env.NEXT_PUBLIC_CTF_ADDRESS, chainDefaults.ctf),
  marketFactory: pickAddress(env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS, chainDefaults.marketFactory),
  exchange: pickAddress(env.NEXT_PUBLIC_EXCHANGE_ADDRESS, chainDefaults.exchange),
  usdf: pickAddress(env.NEXT_PUBLIC_USDF_ADDRESS, chainDefaults.usdf),
  directOracle: pickAddress(env.NEXT_PUBLIC_DIRECT_ORACLE_ADDRESS, chainDefaults.directOracle),
  oracleAdapter: pickAddress(env.NEXT_PUBLIC_ADAPTER_ADDRESS, chainDefaults.oracleAdapter),
  usdt: pickAddress(env.NEXT_PUBLIC_USDT_ADDRESS, DEFAULT_USDT_BY_CHAIN[TARGET_CHAIN_ID]),
}

// USDF configuration
export const USDF_CONFIG = {
  address: CONTRACT_ADDRESSES.usdf,
  decimals: 18,
  symbol: 'USDF',
}

// API configuration
export const API_CONFIG = {
  baseUrl: (() => {
    try {
      return getHttpApiBase()
    } catch {
      return 'https://api.example.com'
    }
  })(),
  wsUrl: (() => {
    try {
      return getWsApiBase()
    } catch {
      return 'wss://api.example.com'
    }
  })(),
}

type AppWagmiConfig = ReturnType<typeof createClientConfig>

declare module 'wagmi' {
  interface Register {
    config: AppWagmiConfig
  }
}

'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartOptions
} from 'chart.js'
import { Market, MarketData, MarketMetrics, MarketSummary, TradeEvent, type MarketComment } from '@/types'
import { formatTimeRemaining, formatDate, formatUSDF, formatPct } from '@/utils/format'
import { useOnchainEvents, type MarketResolvedEvt } from '@/hooks/useOnchainEvents'
import LiveTape, { type TapeRow } from '@/components/LiveTape'
import { CONTRACT_ADDRESSES, TARGET_CHAIN_ID } from '@/lib/web3'
import { ApiRequestError, fetchJSON, notifyTx, openLiveTradesSSE, fetchMarketComments, postMarketComment } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'
import { getMarket } from '@/lib/dataSource'
import { CTF_ABI, ensureOutcomeApproval, ensureUsdfAllowance, getOutcomePositionId, isPoolInitialized, quoteFpmmTrade, swapExactUsdfForOutcome } from '@/lib/amm'
import { formatMissingAddressMessage, isValidHexAddress } from '@/lib/envValidation'
import MarketDiscussion from '@/components/MarketDiscussion'
import { useAuth } from '@/contexts/AuthContext'

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

// Map frontend routes to actual market IDs
const MARKET_ID_MAP: Record<string, string> = {
  '1': '3', // Route /markets/1 -> Market ID 3 (Bitcoin $200k)
}

const TRADE_FLUSH_INTERVAL_MS = 5000
const TRADE_METRICS_REFRESH_MS = 3000
const INDEXED_REFRESH_MS = 8000
const MAX_TRADES = 50
const MAX_POINTS = 200
const CHART_RENDER_THROTTLE_MS = 1000
const SPOT_HISTORY_LIMIT = 240

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
  resolutionData?: {
    payoutNumerators?: number[]
  } | null
  creator?: string | null
  tags?: string[] | null
  slug?: string | null
}

type MetricsState = {
  raw: MarketMetrics
  price: number
  yesReserves: number
  noReserves: number
  tvlUSDF: number
  updatedAt: string | null
  volume24hUSDF: number
  lastTradeAt: string | null
}

type CandleSample = {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const addBaselinePoints = (data: MarketData | null, baselinePrice = 0.5, count = 3, stepMs = 1000): MarketData => {
  const prices = data?.prices ?? []
  const volume = data?.volume ?? []
  const earliestTs = prices.length ? prices[0].timestamp : Date.now()
  const baseline: { timestamp: number; price: number }[] = []
  const baselineVol: { timestamp: number; volume: number }[] = []
  for (let i = count; i > 0; i--) {
    const ts = earliestTs - i * stepMs
    baseline.push({ timestamp: ts, price: baselinePrice })
    baselineVol.push({ timestamp: ts, volume: 0 })
  }
  return {
    prices: [...baseline, ...prices],
    volume: [...baselineVol, ...volume],
  }
}

const ERC20_BALANCE_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const ERC20_SUPPLY_ABI = [
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// Optional donation recipient for the second redeem click
const DEV_DONATION_ADDRESS = (process.env.NEXT_PUBLIC_DEV_DONATION_ADDRESS as `0x${string}` | undefined) || null
const DONATION_AMOUNT = '0.01' // native token tip (testnet)

const extractErrorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    const candidate = err as Record<string, unknown>
    const cause = candidate.cause as Record<string, unknown> | undefined
    const messageCandidate = (
      (typeof candidate.shortMessage === 'string' && candidate.shortMessage) ||
      (typeof candidate.reason === 'string' && candidate.reason) ||
      err.message ||
      (cause && typeof cause.shortMessage === 'string' ? cause.shortMessage : undefined) ||
      (cause && typeof cause.message === 'string' ? cause.message : undefined) ||
      'Trade failed. See console for details.'
    )
    if (typeof messageCandidate === 'string') {
      const normalized = messageCandidate.toLowerCase()
      if (normalized.includes('abort') || normalized.includes('timed out')) {
        return 'Request timed out. Please try again.'
      }
    }
    return messageCandidate
  }
  if (err && typeof err === 'object') {
    const candidate = err as Record<string, unknown>
    const cause = candidate.cause as Record<string, unknown> | undefined
    const messageCandidate = (
      (typeof candidate.shortMessage === 'string' && candidate.shortMessage) ||
      (typeof candidate.reason === 'string' && candidate.reason) ||
      (typeof candidate.message === 'string' && candidate.message) ||
      (cause && typeof cause.shortMessage === 'string' ? cause.shortMessage : undefined) ||
      (cause && typeof cause.message === 'string' ? cause.message : undefined) ||
      'Trade failed. See console for details.'
    )
    if (typeof messageCandidate === 'string') {
      const normalized = messageCandidate.toLowerCase()
      if (normalized.includes('abort') || normalized.includes('timed out')) {
        return 'Request timed out. Please try again.'
      }
    }
    return messageCandidate
  }
  if (typeof err === 'string') {
    return err
  }
  return 'Trade failed. See console for details.'
}

const decodeMarketParam = (value?: string | null): string => {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

type MarketPageClientProps = {
  marketKey: string
  initialApiMarket: ApiMarketPayload | null
  initialSummary?: MarketSummary | null
  initialError?: string | null
  notFoundFromApi?: boolean
}

const unwrapMarketPayload = (payload: unknown): ApiMarketPayload | null => {
  if (!payload) return null
  if (payload && typeof payload === 'object') {
    if ('market' in payload && payload.market && typeof payload.market === 'object') {
      return payload.market as ApiMarketPayload
    }
    if ('ok' in payload && payload.ok === false) {
      return null
    }
  }
  return payload as ApiMarketPayload
}

export default function MarketPageClient({
  marketKey,
  initialApiMarket,
  initialSummary = null,
  initialError = null,
  notFoundFromApi = false,
}: MarketPageClientProps) {
  const { user, signIn, isSigning } = useAuth()
  const [market, setMarket] = useState<Market | null>(null)
  const [chartData, setChartData] = useState<MarketData | null>(null)
  const [timeFilter, setTimeFilter] = useState<'1H' | '24H' | '7D' | '30D'>('24H')
  const [selectedOutcome, setSelectedOutcome] = useState<string>('')
  const [tradeAmount, setTradeAmount] = useState<string>('')
  const [liveTrades, setLiveTrades] = useState<TapeRow[]>([])
  const [lastTrade, setLastTrade] = useState<{ price: string; size: string } | null>(null)
  const [resolvedBanner, setResolvedBanner] = useState<{ payouts: number[] } | null>(null)
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState<string | null>(null)
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null)
  const [conditionId, setConditionId] = useState<`0x${string}` | null>(null)
  const [lagInfo, setLagInfo] = useState<{
    effectiveLag: number
    status: 'ok' | 'warn' | 'alert'
    isRunning: boolean
    lastError: string | null
  } | null>(null)
  const [tradeSide, setTradeSide] = useState<'BUY' | 'SELL'>('BUY')
  const [hasRedeemedOnce, setHasRedeemedOnce] = useState(false)
  const marketIdRef = useRef<string | null>(null)
  const [metricsState, setMetricsState] = useState<MetricsState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const [sseConnected, setSseConnected] = useState(false)
  const [hasCandles, setHasCandles] = useState<boolean>(false)
  const lastMetricsRefreshRef = useRef(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  // Comments state
  const [comments, setComments] = useState<MarketComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsHasMore, setCommentsHasMore] = useState(false)
  const [commentsSubmitting, setCommentsSubmitting] = useState(false)

  // Trading state
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [orderSuccess, setOrderSuccess] = useState<{ hash: `0x${string}`; side: 'BUY' | 'SELL' } | null>(null)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [poolInitialized, setPoolInitialized] = useState<boolean | null>(null)
  const [poolError, setPoolError] = useState<string | null>(null)
  const [poolLoading, setPoolLoading] = useState(false)
  const poolInitializedRef = useRef(false)
  const fpmmInitializedRef = useRef<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminCheckComplete, setAdminCheckComplete] = useState(false)
  const [seedLoading, setSeedLoading] = useState(false)
  const [seedSuccess, setSeedSuccess] = useState<string | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [resolveOutcomeIndex, setResolveOutcomeIndex] = useState(0)
  const [resolveLoading, setResolveLoading] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [resolveSuccess, setResolveSuccess] = useState<string | null>(null)
  const [walletBalances, setWalletBalances] = useState<{ usdf?: string; yes?: string; no?: string }>({})
  const [poolReserves, setPoolReserves] = useState<{ usdf?: string; yes?: string; no?: string; lp?: string; lastUpdated?: string }>({})
  const [balancesFloating, setBalancesFloating] = useState(false)
  const [walletPos, setWalletPos] = useState<{ x: number; y: number } | null>(null)
  const [isDraggingWallet, setIsDraggingWallet] = useState(false)
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null)
  const chartDataRef = useRef<MarketData | null>(null)
  const [renderChartData, setRenderChartData] = useState<MarketData | null>(null)
  const tradeBufferRef = useRef<TapeRow[]>([])
  const pathname = usePathname()
  const derivedMarketKey = useMemo(() => {
    if (marketKey?.trim()) return marketKey.trim()
    if (!pathname) return ''
    const segments = pathname.split('/').filter(Boolean)
    const candidate = segments[segments.length - 1]
    return decodeMarketParam(candidate ?? '').trim()
  }, [marketKey, pathname])
  const resolvedMarketId = useMemo(() => {
    if (!derivedMarketKey) return null
    return MARKET_ID_MAP[derivedMarketKey] || derivedMarketKey
  }, [derivedMarketKey])
  // Removed chart price buffering from trades; chart stays on spot/candle data.
  const poolPrice = useMemo(() => {
    const yes = poolReserves.yes ? Number.parseFloat(poolReserves.yes) : NaN
    const no = poolReserves.no ? Number.parseFloat(poolReserves.no) : NaN
    if (!Number.isFinite(yes) || !Number.isFinite(no)) return null
    const total = yes + no
    if (total <= 0) return null
    const yesPrice = no / total
    return {
      yesPrice,
      noPrice: Math.max(0, 1 - yesPrice),
      yes,
      no,
    }
  }, [poolReserves.yes, poolReserves.no])

const displayPrice = useMemo(() => {
    // Use live on-chain price only
    return poolPrice?.yesPrice ?? null
  }, [poolPrice])

  const derivedTvl = useMemo(() => {
    const yes = poolReserves.yes ? Number.parseFloat(poolReserves.yes) : NaN
    const no = poolReserves.no ? Number.parseFloat(poolReserves.no) : NaN
    if (!Number.isFinite(yes) || !Number.isFinite(no)) return null
    const total = yes + no
    if (total <= 0) return null
    const yesPrice = no / total
    const noPrice = 1 - yesPrice
    return yes * yesPrice + no * noPrice
  }, [poolReserves.yes, poolReserves.no])

  useEffect(() => {
    if (!poolPrice) return
    setMetricsState((prev) => {
      if (!prev) {
        return {
          raw: {
            spot: {
              price: poolPrice.yesPrice.toString(),
              yesReserves: poolPrice.yes.toString(),
              noReserves: poolPrice.no.toString(),
              tvlUSDF: (derivedTvl ?? 0).toString(),
              updatedAt: poolReserves.lastUpdated ?? new Date().toISOString(),
            },
            tvlUSDF: '0',
            volume24hUSDF: '0',
          } as unknown as MarketMetrics,
          price: poolPrice.yesPrice,
          yesReserves: poolPrice.yes,
          noReserves: poolPrice.no,
          tvlUSDF: derivedTvl ?? 0,
          updatedAt: poolReserves.lastUpdated ?? null,
          volume24hUSDF: 0,
          lastTradeAt: null,
        }
      }
      return {
        ...prev,
        // price stays driven by poolPrice only
        price: poolPrice.yesPrice,
        yesReserves: poolPrice.yes,
        noReserves: poolPrice.no,
        tvlUSDF: derivedTvl ?? prev.tvlUSDF,
        updatedAt: poolReserves.lastUpdated ?? prev.updatedAt,
      }
  })
}, [poolPrice, poolReserves.lastUpdated, derivedTvl])


  // Keep chart's last point pinned to the same spot price used by the Spot cards,
  // so the line and the numeric SPOT indicators never disagree.
  useEffect(() => {
    const base = chartDataRef.current
    if (!base) {
      setRenderChartData(chartData)
      return
    }

    if (!poolPrice || !Number.isFinite(poolPrice.yesPrice) || base.prices.length === 0) {
      setRenderChartData(base)
      return
    }

    const yesSpot = poolPrice.yesPrice
    const last = base.prices[base.prices.length - 1]
    if (Math.abs(last.price - yesSpot) < 1e-6) {
      setRenderChartData(base)
      return
    }

    const adjusted: MarketData = {
      prices: [
        ...base.prices.slice(0, -1),
        { ...last, price: yesSpot },
      ],
      volume: base.volume,
    }

    setRenderChartData(adjusted)
  }, [chartData, poolPrice])

  const flushTimerRef = useRef<NodeJS.Timeout | null>(null)
  const walletCardRef = useRef<HTMLDivElement | null>(null)
  const chartRenderTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastChartRenderRef = useRef(0)
  const [notFound, setNotFound] = useState<boolean>(() => Boolean(notFoundFromApi))
  const initialHydratedRef = useRef(false)

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      tradeBufferRef.current = []
    }
  }, [])

  // Wallet hooks
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID })
  const { data: walletClient } = useWalletClient({ chainId: TARGET_CHAIN_ID })
  const isWalletConnected = Boolean(address)

  // Contract addresses - must be declared before any useCallback that uses them
  const usdfAddress = isValidHexAddress(CONTRACT_ADDRESSES.usdf) ? CONTRACT_ADDRESSES.usdf : undefined
  const ctfAddress = isValidHexAddress(CONTRACT_ADDRESSES.conditionalTokens) ? CONTRACT_ADDRESSES.conditionalTokens : undefined
  const fpmmAddress = market?.fpmmAddress && isValidHexAddress(market.fpmmAddress) ? market.fpmmAddress : undefined

  const isResolved = market?.status === 'resolved'
  const isExpired = useMemo(() => {
    if (!market || !market.endDate) return false
    if (isResolved) return false
    return market.endDate.getTime() <= Date.now()
  }, [market, isResolved])
  const isTradingOpen = market?.status === 'active' && !isExpired

  useEffect(() => {
    marketIdRef.current = resolvedMarketId ?? null
  }, [resolvedMarketId])

  const parseDecimal = useCallback((value: string | number | null | undefined) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    if (typeof value === 'string') {
      const parsed = parseFloat(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
  }, [])

  const mapApiMarket = useCallback((apiMarket: ApiMarketPayload): Market => {
    const outcomes = Array.isArray(apiMarket.outcomes) && apiMarket.outcomes.length > 0
      ? apiMarket.outcomes
      : ['Yes', 'No']

    // Backend does not currently send an explicit close time; avoid the hardcoded
    // +7d fallback that made every market display "in 7 days". Use createdAt if
    // present so the UI can at least show a deterministic timestamp, otherwise
    // fall back to now.
    const createdAt = apiMarket.createdAt ? new Date(apiMarket.createdAt) : new Date()
    const expiresAt = apiMarket.expiresAt ? new Date(apiMarket.expiresAt) : null
    const resolvedAt = apiMarket.resolvedAt ? new Date(apiMarket.resolvedAt) : null

    return {
      id: apiMarket.id,
      slug: apiMarket.slug ?? null,
      conditionId: apiMarket.conditionId ?? null,
      fpmmAddress: apiMarket.fpmmAddress ?? null,
      title: apiMarket.title || 'Market',
      description: apiMarket.description || 'Prediction market',
      category: apiMarket.category || 'General',
      outcomes: outcomes.map((name: string) => ({ name, price: 0, change24h: 0 })),
      endDate: expiresAt ?? resolvedAt ?? createdAt,
      totalVolume: '0',
      liquidity: '0',
      createdBy: apiMarket.creator || '0x0000…0000',
      status: (apiMarket.status === 'resolved' ? 'resolved' : 'active') as 'active' | 'resolved' | 'cancelled',
      tags: apiMarket.tags || [],
    }
  }, [])

  const lastSummaryBlockRef = useRef<number | null>(null)

  const applySummary = useCallback((summary: MarketSummary | null) => {
    if (!summary) return

    lastSummaryBlockRef.current = summary.cache?.lastIndexedBlock ?? lastSummaryBlockRef.current

    const rawMarket = summary.market as unknown
    const unwrap = unwrapMarketPayload(rawMarket)

    if (!unwrap) {
      setLoadError('Market not found')
      setNotFound(true)
    } else {
      try {
        const mapped = mapApiMarket(unwrap)
        setMarket(mapped)
        setSelectedOutcome((prev) => prev || mapped.outcomes[0]?.name || '')
        setConditionId(unwrap.conditionId ? (unwrap.conditionId as `0x${string}`) : null)
        marketIdRef.current = unwrap.slug ?? unwrap.id
        setNotFound(false)
        setLoadError(null)
        // Ensure the resolved banner (and redeem UI) renders even when the page
        // loads after a market has already been resolved on-chain.
        if (unwrap.status === 'resolved') {
          const payouts = Array.isArray(unwrap.resolutionData?.payoutNumerators)
            ? unwrap.resolutionData?.payoutNumerators
            : []
          setResolvedBanner({ payouts: payouts as number[] })
        }
        initialHydratedRef.current = true
      } catch (err) {
        console.error('[markets] failed to map market response', err)
        setLoadError('Unable to parse market data')
        setNotFound(true)
      }
    }

    const metrics = summary.metrics
    if (metrics) {
      // Keep raw metrics for volume/history, but price/TVL display now driven by live on-chain poolPrice.
      const yesReserves = metrics.spot ? parseDecimal(metrics.spot.yesReserves) : 0
      const noReserves = metrics.spot ? parseDecimal(metrics.spot.noReserves) : 0
      const tvl = metrics.spot ? parseDecimal(metrics.spot.tvlUSDF) : parseDecimal(metrics.tvlUSDF ?? '0')

      setMetricsState({
        raw: metrics,
        price: metricsState?.price ?? 0, // placeholder; display uses poolPrice
        yesReserves,
        noReserves,
        tvlUSDF: tvl,
        updatedAt: metrics.spot?.updatedAt ?? null,
        volume24hUSDF: parseDecimal(metrics.volume24hUSDF ?? '0'),
        lastTradeAt: metrics.lastTradeAt ?? null,
      })
      // Pool initialization now relies solely on on-chain totalSupply via loadPoolState().
      // Do not infer init status from TVL snapshots, which may be stale or missing.
    }

    const spotSeries = Array.isArray(summary.spotSeries)
      ? summary.spotSeries
          .map((row) => {
            const price = parseDecimal((row as any).p ?? (row as any).price ?? (row as any).yes ?? 0)
            const tsRaw = (row as any).t ?? (row as any).timestamp ?? (row as any).time
            const ts = tsRaw ? new Date(tsRaw).getTime() : NaN
            if (!Number.isFinite(price) || price <= 0 || price >= 1 || !Number.isFinite(ts)) return null
            return { timestamp: ts, price }
          })
          .filter(Boolean) as Array<{ timestamp: number; price: number }>
      : []

    const candleSamples: CandleSample[] = Array.isArray(summary.candles)
      ? summary.candles.map((entry) => ({
        timestamp: new Date(entry.t).getTime(),
        open: parseDecimal(entry.o),
        high: parseDecimal(entry.h),
        low: parseDecimal(entry.l),
        close: parseDecimal(entry.c),
        volume: parseDecimal(entry.vUSDF),
      }))
      : []

    const seriesToUse = spotSeries.length > 0
      ? {
          prices: spotSeries.map((sample) => ({ timestamp: sample.timestamp, price: sample.price })),
          volume: spotSeries.map((sample) => ({ timestamp: sample.timestamp, volume: 0 })),
        }
      : null

    if (!seriesToUse) {
      setHasCandles(false)
      const chart = addBaselinePoints(null)
      setChartData(chart)
      chartDataRef.current = chart
      lastChartRenderRef.current = Date.now()
      setRenderChartData(chart)
    } else {
      setHasCandles(true)
      let chart: MarketData = {
        prices: seriesToUse.prices,
        volume: seriesToUse.volume,
      }
      chart = addBaselinePoints(chart, chart.prices[0]?.price ?? 0.5)
      setChartData(chart)
      chartDataRef.current = chart
      lastChartRenderRef.current = Date.now()
      setRenderChartData(chart)
    }

    const trades: TapeRow[] = Array.isArray(summary.trades)
      ? summary.trades.map((trade) => {
        const price = parseDecimal(trade.price)
        const shares = parseDecimal(trade.amountInUSDF ?? trade.amountOutShares)
        const ts = trade.timestamp ? new Date(trade.timestamp) : new Date()
        const side = (typeof trade.side === 'string' && trade.side.toLowerCase() === 'sell') ? 'sell' : 'buy'
        const outcomeLabel: 'Yes' | 'No' = Number(trade.outcome) === 0 ? 'Yes' : 'No'
        return {
          time: ts.toLocaleTimeString(),
          price: price.toFixed(4),
          size: shares.toFixed(4),
          side,
          outcomeLabel,
          tx: trade.txHash || '',
        }
      })
      : []

    setLiveTrades(trades)
    if (trades.length > 0) {
      setLastTrade({ price: trades[0].price, size: trades[0].size })
    }
  }, [mapApiMarket, parseDecimal])

  const flushBufferedTrades = useCallback(() => {
    const trades = tradeBufferRef.current
    tradeBufferRef.current = []
    flushTimerRef.current = null

    if (!trades.length) return

    setLiveTrades((prev) => {
      const combined = trades.length ? [...trades, ...prev] : prev
      const seen = new Set<string>()
      const deduped: TapeRow[] = []

      for (const entry of combined) {
        const key = entry.tx || `${entry.time}-${entry.price}-${entry.size}`
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(entry)
        if (deduped.length >= MAX_TRADES) break
      }

      if (deduped.length && trades.length) {
        setLastTrade({ price: deduped[0].price, size: deduped[0].size })
      }

      return deduped
    })
  }, [])

  const scheduleTradeFlush = useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(flushBufferedTrades, TRADE_FLUSH_INTERVAL_MS)
  }, [flushBufferedTrades])

  const marketRef = useRef<Market | null>(null)

  useEffect(() => {
    marketRef.current = market
  }, [market])

  const refreshAll = useCallback(async (fallbackKey?: string, options?: { ignoreCache?: boolean; quiet?: boolean; timeoutMs?: number }) => {
    const keyCandidate =
      fallbackKey ??
      marketRef.current?.slug ??
      marketRef.current?.id ??
      marketIdRef.current ??
      resolvedMarketId

    if (!keyCandidate) return

    if (!options?.quiet) {
      setIsRefreshing(true)
    }
    setLoadError(null)

    try {
      const summary = await getMarket(keyCandidate, {
        ignoreCache: options?.ignoreCache,
        timeoutMs: options?.timeoutMs,
      })
      applySummary(summary)
    } catch (err) {
      const message = extractErrorMessage(err)
      if (err instanceof ApiRequestError && err.status === 404) {
        setNotFound(true)
      }
      setLoadError(message)
    } finally {
      if (!options?.quiet) {
        setIsRefreshing(false)
      }
    }
  }, [resolvedMarketId, applySummary])

  useEffect(() => {
    if (initialHydratedRef.current) return

    if (initialSummary) {
      applySummary(initialSummary)
      lastSummaryBlockRef.current = initialSummary.cache?.lastIndexedBlock ?? null
      initialHydratedRef.current = true
      return
    }

    if (initialApiMarket) {
      try {
        const mapped = mapApiMarket(initialApiMarket)
        setMarket(mapped)
        setSelectedOutcome((prev) => prev || mapped.outcomes[0]?.name || '')
        setConditionId(initialApiMarket.conditionId ? (initialApiMarket.conditionId as `0x${string}`) : null)
        marketIdRef.current = initialApiMarket.slug ?? initialApiMarket.id
        setNotFound(false)
        setLoadError(null)
      } catch (err) {
        console.error('[markets] failed to hydrate from initial market payload', err)
        setLoadError('Unable to parse market data')
        setNotFound(true)
      }
      initialHydratedRef.current = true
      return
    }

    if (initialError) {
      // Surface the error but do NOT mark as notFound; instead, let the
      // client retry fetching from the browser.
      setLoadError(initialError)
    }

    // No usable initial payload; kick off a client-side refresh using the
    // route slug so we can recover from SSR/API flakiness.
    refreshAll(undefined, { ignoreCache: true, quiet: true }).catch(() => { })
    initialHydratedRef.current = true
  }, [initialSummary, initialApiMarket, initialError, applySummary, mapApiMarket, refreshAll])

  const handleSseTradeEvent = useCallback((payload: TradeEvent) => {
    const payloadPrice = parseDecimal(payload?.price ?? 0)
    const price = parseDecimal(poolPrice?.yesPrice ?? payloadPrice)
    const size = parseDecimal(payload?.amountUSDF ?? 0)
    const ts = payload?.ts ? new Date(payload.ts) : new Date()

    const txHash = payload?.txHash || `live-${ts.getTime()}`
    const outcomeLabel: 'Yes' | 'No' = payload?.outcome === 0 ? 'Yes' : 'No'
    const side: 'buy' | 'sell' = payload?.side === 'sell' ? 'sell' : 'buy'
    const row: TapeRow = {
      time: ts.toLocaleTimeString(),
      price: price.toFixed(4),
      size: size.toFixed(4),
      side,
      outcomeLabel,
      tx: txHash,
    }
    // Buffer trades and flush at a controlled cadence to avoid constant re-renders
    tradeBufferRef.current.unshift(row)
    scheduleTradeFlush()
  }, [parseDecimal, scheduleTradeFlush, poolPrice])

  // Record a spot point by fetching current on-chain pool reserves and POSTing to API.
  // Called after trades are detected via SSE. Uses pool reserves (not trade price) for accurate FPMM pricing.
  // IMPORTANT: This must be declared BEFORE the SSE useEffect that uses it to avoid TDZ errors.
  const recordSpotPointFromChain = useCallback(async () => {
    if (!publicClient || !fpmmAddress || !ctfAddress || !usdfAddress || !conditionId || !resolvedMarketId) {
      return
    }
    try {
      const [yesPositionId, noPositionId] = await Promise.all([
        getOutcomePositionId({
          publicClient,
          ctfAddress,
          collateralToken: usdfAddress,
          conditionId,
          outcomeIndex: 0,
        }),
        getOutcomePositionId({
          publicClient,
          ctfAddress,
          collateralToken: usdfAddress,
          conditionId,
          outcomeIndex: 1,
        }),
      ])

      const [yesBal, noBal] = await Promise.all([
        publicClient.readContract({
          address: ctfAddress,
          abi: CTF_ABI,
          functionName: 'balanceOf',
          args: [fpmmAddress, yesPositionId],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: ctfAddress,
          abi: CTF_ABI,
          functionName: 'balanceOf',
          args: [fpmmAddress, noPositionId],
        }) as Promise<bigint>,
      ])

      const toDisplay = (value: bigint) => {
        const formatted = formatUnits(value, 18)
        const numeric = Number.parseFloat(formatted)
        if (Number.isNaN(numeric)) return formatted
        return numeric.toFixed(4)
      }

      const yesShares = toDisplay(yesBal)
      const noShares = toDisplay(noBal)

      // POST to API - price is calculated server-side as noShares/(yesShares+noShares)
      await fetch(`${API_BASE}/api/markets/${encodeURIComponent(resolvedMarketId)}/spot-point`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yesShares,
          noShares,
          timestamp: new Date().toISOString(),
        }),
      })
    } catch (err) {
      // Best-effort; don't block UI if this fails
      console.warn('Failed to record spot point', err)
    }
  }, [publicClient, fpmmAddress, ctfAddress, usdfAddress, conditionId, resolvedMarketId])

  const handleRetry = useCallback(() => {
    refreshAll(undefined, { ignoreCache: true }).catch(() => { })
  }, [refreshAll])

  useEffect(() => {
    if (!resolvedMarketId) {
      setMarket(null)
      setMetricsState(null)
      setChartData(null)
      setLiveTrades([])
      setHasCandles(false)
      return
    }

    let cancelled = false

    const run = async () => {
      setLoadError(null)
      try {
        await refreshAll(resolvedMarketId, { ignoreCache: true })
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load market')
        }
      }
    }

    run().catch((err) => {
      if (!cancelled) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load market')
      }
    })

    return () => {
      cancelled = true
    }
  }, [resolvedMarketId, refreshAll])

  // Load initial comments whenever market changes
  useEffect(() => {
    const key = resolvedMarketId ?? null
    if (!key) {
      setComments([])
      setCommentsHasMore(false)
      return
    }
    let cancelled = false
    const load = async () => {
      setCommentsLoading(true)
      try {
        const list = await fetchMarketComments(key, { limit: 20 })
        if (!cancelled) {
          setComments(list)
          setCommentsHasMore(list.length >= 20)
        }
      } catch {
        if (!cancelled) {
          setComments([])
          setCommentsHasMore(false)
        }
      } finally {
        if (!cancelled) setCommentsLoading(false)
      }
    }
    load().catch(() => { })
    return () => {
      cancelled = true
    }
  }, [resolvedMarketId])

  const handleLoadMoreComments = useCallback(async () => {
    const key = resolvedMarketId ?? null
    if (!key || comments.length === 0) return
    const oldest = comments[comments.length - 1]
    try {
      setCommentsLoading(true)
      const more = await fetchMarketComments(key, { before: new Date(oldest.createdAt).getTime(), limit: 20 })
      setComments((prev) => [...prev, ...more])
      setCommentsHasMore(more.length >= 20)
    } finally {
      setCommentsLoading(false)
    }
  }, [comments, resolvedMarketId])

  const handleSubmitComment = useCallback(async (body: string) => {
    const key = resolvedMarketId ?? null
    if (!key) throw new Error('Market unavailable')
    setCommentsSubmitting(true)
    try {
      const created = await postMarketComment(key, body)
      setComments((prev) => [created, ...prev])
    } finally {
      setCommentsSubmitting(false)
    }
  }, [resolvedMarketId])

  useEffect(() => {
    if (!resolvedMarketId && !marketIdRef.current) return
    const interval = setInterval(() => {
      if (sseConnected) return
      refreshAll(undefined, { ignoreCache: true, quiet: true }).catch(() => { })
    }, 20000)
    if (typeof interval.unref === 'function') interval.unref()
    return () => clearInterval(interval)
  }, [resolvedMarketId, sseConnected, refreshAll])

  useEffect(() => {
    const key = resolvedMarketId ?? marketIdRef.current ?? market?.slug ?? null
    if (!key) {
      setSseConnected(false)
      return
    }

    const source = openLiveTradesSSE(key, {
      onTrade: (trade) => {
        handleSseTradeEvent(trade)
        // Record spot point from on-chain pool reserves after each trade
        recordSpotPointFromChain().catch(() => { })
        const now = Date.now()
        if (now - lastMetricsRefreshRef.current > TRADE_METRICS_REFRESH_MS) {
          lastMetricsRefreshRef.current = now
          refreshAll(key, { ignoreCache: true, quiet: true }).catch(() => { })
        }
      },
      onIndexed: () => {
        const now = Date.now()
        if (now - lastMetricsRefreshRef.current > INDEXED_REFRESH_MS) {
          lastMetricsRefreshRef.current = now
          refreshAll(key, { ignoreCache: true, quiet: true }).catch(() => { })
        }
      },
      onComment: (evt) => {
        if (!evt?.comment) return
        const comment = evt.comment as MarketComment
        setComments((prev) => {
          if (!prev.find((c) => c.id === comment.id)) {
            return [comment, ...prev]
          }
          return prev
        })
      }
    })

    eventSourceRef.current = source

    source.onopen = () => {
      setSseConnected(true)
    }

    source.onerror = () => {
      setSseConnected(false)
    }

    return () => {
      setSseConnected(false)
      source.close()
      eventSourceRef.current = null
    }
  }, [resolvedMarketId, handleSseTradeEvent, refreshAll, recordSpotPointFromChain])

  // Handle market resolved
  const handleMarketResolved = useCallback((evt: MarketResolvedEvt) => {
    const currentMarketId = marketIdRef.current
    if (!currentMarketId || evt.marketId.toString() !== currentMarketId) {
      return
    }

    console.log('[market detail] market resolved:', evt)
    setResolvedBanner({ payouts: evt.payouts || [] })

    // Update market status
    setMarket((prev) => prev ? { ...prev, status: 'resolved' } : null)
    refreshAll(undefined, { ignoreCache: true }).catch(() => { })
  }, [refreshAll])

  useOnchainEvents({
    onMarketResolved: handleMarketResolved
  })

  useEffect(() => {
    const checkAdmin = async () => {
      // Only probe if we have a cookie session; avoid noisy 401s for normal users.
      if (typeof document === 'undefined') {
        setAdminCheckComplete(true)
        return
      }
      const hasCookie = document.cookie && document.cookie.length > 0
      if (!hasCookie) {
        setIsAdmin(false)
        setAdminCheckComplete(true)
        return
      }
      try {
        const result = await fetchJSON<{ ok?: boolean }>(`${API_BASE}/api/admin/me`)
        if (result?.ok) {
          setIsAdmin(true)
        } else {
          setIsAdmin(false)
        }
      } catch (error) {
        // Suppress 401 noise; treat as non-admin
        setIsAdmin(false)
      } finally {
        setAdminCheckComplete(true)
      }
    }
    checkAdmin()
  }, [])

  // Resolve base explorer for tx links
  const chainId = TARGET_CHAIN_ID
  const explorerBase = chainId === 56
    ? 'https://bscscan.com'
    : 'https://testnet.bscscan.com'

  // Contract addresses are declared earlier (after wallet hooks) to avoid TDZ errors

  let tradingConfigError: string | null = null
  if (market && !fpmmAddress) {
    tradingConfigError = 'Pool not seeded yet. Ask an admin to seed the pool to enable trading.'
  } else if (fpmmAddress) {
    // Trust on-chain pool init; ignore missing spot/TVL metrics.
    if (poolInitialized === false) {
      tradingConfigError = 'Pool not seeded yet. Ask an admin to seed the pool to enable trading.'
    } else {
      tradingConfigError = null
    }
  }

  // Env sanity (only if still no other error)
  if (!tradingConfigError) {
    const envIssues: string[] = []
    if (!usdfAddress) envIssues.push('NEXT_PUBLIC_USDF_ADDRESS')
    if (!ctfAddress) envIssues.push('NEXT_PUBLIC_CTF_ADDRESS')
    if (envIssues.length) {
      tradingConfigError = formatMissingAddressMessage(envIssues)
    }
  }

  const loadPoolState = useCallback(async () => {
    if (!conditionId || !publicClient || !fpmmAddress) {
      return null
    }

    // Once we have confirmed initialization for this fpmmAddress, do not
    // downgrade; pools cannot "unseed" on-chain. This avoids false negatives
    // when the client drifts chains or RPC hiccups occur.
    if (poolInitializedRef.current && fpmmInitializedRef.current === fpmmAddress) {
      setPoolInitialized(true)
      return true
    }

    setPoolLoading(true)
    try {
      const initialized = await isPoolInitialized({
        publicClient,
        fpmmAddress,
      })
      if (initialized) {
        poolInitializedRef.current = true
        fpmmInitializedRef.current = fpmmAddress
        setPoolInitialized(true)
      } else if (!poolInitializedRef.current || fpmmInitializedRef.current !== fpmmAddress) {
        setPoolInitialized(false)
      }
      setPoolError(null)
      return initialized
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load pool state'
      setPoolError(message)
      return null
    } finally {
      setPoolLoading(false)
    }
  }, [conditionId, fpmmAddress, publicClient])

  const loadWalletBalances = useCallback(async () => {
    if (!isConnected || !address || !publicClient || !usdfAddress || !ctfAddress || !conditionId) return
    try {
      const [usdfBalance, yesPositionId, noPositionId] = await Promise.all([
        publicClient.readContract({
          address: usdfAddress,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address],
        }) as Promise<bigint>,
        getOutcomePositionId({
          publicClient,
          ctfAddress,
          collateralToken: usdfAddress,
          conditionId,
          outcomeIndex: 0,
        }),
        getOutcomePositionId({
          publicClient,
          ctfAddress,
          collateralToken: usdfAddress,
          conditionId,
          outcomeIndex: 1,
        }),
      ])

      const [yesBalance, noBalance] = await Promise.all([
        publicClient.readContract({
          address: ctfAddress,
          abi: CTF_ABI,
          functionName: 'balanceOf',
          args: [address, yesPositionId],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: ctfAddress,
          abi: CTF_ABI,
          functionName: 'balanceOf',
          args: [address, noPositionId],
        }) as Promise<bigint>,
      ])

      const toDisplay = (value: bigint) => {
        const formatted = formatUnits(value, 18)
        const numeric = Number.parseFloat(formatted)
        if (Number.isNaN(numeric)) return formatted
        return numeric.toFixed(4)
      }

      setWalletBalances({
        usdf: toDisplay(usdfBalance),
        yes: toDisplay(yesBalance),
        no: toDisplay(noBalance),
      })
    } catch (err) {
      console.warn('Failed to refresh balances', err)
    }
  }, [isConnected, address, publicClient, usdfAddress, ctfAddress, conditionId])

  const fetchPoolReserves = useCallback(async () => {
    if (!publicClient || !fpmmAddress || !ctfAddress || !usdfAddress || !conditionId) {
      return
    }
    try {
      const [yesPositionId, noPositionId] = await Promise.all([
        getOutcomePositionId({
          publicClient,
          ctfAddress,
          collateralToken: usdfAddress,
          conditionId,
          outcomeIndex: 0,
        }),
        getOutcomePositionId({
          publicClient,
          ctfAddress,
          collateralToken: usdfAddress,
          conditionId,
          outcomeIndex: 1,
        }),
      ])

      const [usdfBal, yesBal, noBal, lpSupply] = await Promise.all([
        publicClient.readContract({
          address: usdfAddress,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [fpmmAddress],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: ctfAddress,
          abi: CTF_ABI,
          functionName: 'balanceOf',
          args: [fpmmAddress, yesPositionId],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: ctfAddress,
          abi: CTF_ABI,
          functionName: 'balanceOf',
          args: [fpmmAddress, noPositionId],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: fpmmAddress,
          abi: ERC20_SUPPLY_ABI,
          functionName: 'totalSupply',
        }) as Promise<bigint>,
      ])

      const toDisplay = (value: bigint) => {
        const formatted = formatUnits(value, 18)
        const numeric = Number.parseFloat(formatted)
        if (Number.isNaN(numeric)) {
          return formatted
        }
        return numeric.toFixed(4)
      }

      setPoolReserves({
        usdf: toDisplay(usdfBal),
        yes: toDisplay(yesBal),
        no: toDisplay(noBal),
        lp: toDisplay(lpSupply),
        lastUpdated: new Date().toISOString(),
      })
    } catch (err) {
      console.warn('Failed to fetch pool reserves', err)
    }
  }, [publicClient, fpmmAddress, ctfAddress, usdfAddress, conditionId])

  const refreshBalances = useCallback(async () => {
    if (!publicClient || !address || !usdfAddress || !ctfAddress || !conditionId || !fpmmAddress) {
      return
    }
    try {
      const [usdfBalance, yesPositionId, noPositionId] = await Promise.all([
        publicClient.readContract({
          address: usdfAddress,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address],
        }) as Promise<bigint>,
        getOutcomePositionId({
          publicClient,
          ctfAddress,
          collateralToken: usdfAddress,
          conditionId,
          outcomeIndex: 0,
        }),
        getOutcomePositionId({
          publicClient,
          ctfAddress,
          collateralToken: usdfAddress,
          conditionId,
          outcomeIndex: 1,
        }),
      ])

      const [yesBalance, noBalance] = await Promise.all([
        publicClient.readContract({
          address: ctfAddress,
          abi: CTF_ABI,
          functionName: 'balanceOf',
          args: [address, yesPositionId],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: ctfAddress,
          abi: CTF_ABI,
          functionName: 'balanceOf',
          args: [address, noPositionId],
        }) as Promise<bigint>,
      ])

      const toDisplay = (value: bigint) => {
        const formatted = formatUnits(value, 18)
        const numeric = Number.parseFloat(formatted)
        if (Number.isNaN(numeric)) {
          return formatted
        }
        return numeric.toFixed(4)
      }

      setWalletBalances({
        usdf: toDisplay(usdfBalance),
        yes: toDisplay(yesBalance),
        no: toDisplay(noBalance),
      })
    } catch (err) {
      console.warn('Failed to refresh balances', err)
    }
  }, [address, publicClient, usdfAddress, ctfAddress, conditionId, fpmmAddress])

  useEffect(() => {
    loadPoolState()
  }, [loadPoolState])

  useEffect(() => {
    fetchPoolReserves()
  }, [fetchPoolReserves])

  // Floating wallet drag handlers
  useEffect(() => {
    if (!balancesFloating) return
    const handleMove = (e: MouseEvent) => {
      if (!isDraggingWallet || !dragOffsetRef.current) return
      const width = walletCardRef.current?.offsetWidth ?? 280
      const height = walletCardRef.current?.offsetHeight ?? 220
      const nextX = e.clientX - dragOffsetRef.current.x
      const nextY = e.clientY - dragOffsetRef.current.y
      const maxX = (typeof window !== 'undefined' ? window.innerWidth : width) - width - 8
      const maxY = (typeof window !== 'undefined' ? window.innerHeight : height) - height - 8
      setWalletPos({
        x: Math.max(8, Math.min(nextX, maxX)),
        y: Math.max(8, Math.min(nextY, maxY)),
      })
    }
    const handleUp = () => {
      setIsDraggingWallet(false)
      dragOffsetRef.current = null
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    const handleResize = () => {
      setWalletPos((pos) => {
        if (!pos) return pos
        const width = walletCardRef.current?.offsetWidth ?? 280
        const height = walletCardRef.current?.offsetHeight ?? 220
        const maxX = window.innerWidth - width - 8
        const maxY = window.innerHeight - height - 8
        return {
          x: Math.max(8, Math.min(pos.x, maxX)),
          y: Math.max(8, Math.min(pos.y, maxY)),
        }
      })
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('resize', handleResize)
    }
  }, [balancesFloating, isDraggingWallet])

  useEffect(() => {
    if (!address) return
    refreshBalances()
  }, [address, refreshBalances])

  useEffect(() => {
    if (market?.outcomes && market.outcomes.length > 0) {
      setResolveOutcomeIndex(0)
    }
  }, [market?.id, market?.outcomes?.length])

  useEffect(() => {
    if (!conditionId || !address) return
    refreshBalances()
  }, [conditionId, address, refreshBalances])

  useEffect(() => {
    if (!fpmmAddress || !conditionId) {
      setPoolInitialized(null)
      poolInitializedRef.current = false
      fpmmInitializedRef.current = null
    }
  }, [fpmmAddress, conditionId])

  const handleSeedPool = useCallback(async () => {
    if (!market) return
    setSeedLoading(true)
    setSeedError(null)
    setSeedSuccess(null)
    const parseEnvNumber = (value: string | undefined, fallback: number) => {
      if (!value) return fallback
      const parsed = Number(value)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
    }

    const seedRequest = {
      // Default to a small, safe seed unless explicitly overridden via env
      liquidity: parseEnvNumber(process.env.NEXT_PUBLIC_FPMM_SEED_LIQUIDITY, 10),
    }

    try {
      const result = await fetchJSON<{
        ok?: boolean
        fpmmAddress?: string
        addLiqTx?: string
        transactions?: { addFunding?: string }
        error?: string
      }>(`${API_BASE}/api/admin/markets/${market.id}/seed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(seedRequest),
      })

      if (result?.ok === false) {
        throw new Error(result.error || 'Failed to seed pool')
      }

      const seededAddress = result?.fpmmAddress
      if (seededAddress && isValidHexAddress(seededAddress)) {
        setMarket((prev) => (prev ? { ...prev, fpmmAddress: seededAddress as `0x${string}` } : prev))
      }

      const seedTxHash = result?.addLiqTx ?? result?.transactions?.addFunding ?? null
      if (seedTxHash) {
        setSeedSuccess(seedTxHash)
      }

      setPoolInitialized(true)
      await loadPoolState()
      await refreshBalances()
      await fetchPoolReserves()
    } catch (error) {
      setSeedError(error instanceof Error ? error.message : 'Failed to seed pool')
    } finally {
      setSeedLoading(false)
    }
  }, [market, loadPoolState, refreshBalances, fetchPoolReserves])

  const handleResolve = useCallback(async () => {
    if (!market) {
      setResolveError('Market not loaded')
      return
    }
    if (!Array.isArray(market.outcomes) || market.outcomes.length < 2) {
      setResolveError('Market outcomes missing')
      return
    }
    setResolveLoading(true)
    setResolveError(null)
    setResolveSuccess(null)
    try {
      const payoutNumerators = market.outcomes.map((_, idx) => (idx === resolveOutcomeIndex ? 1 : 0))
      const response = await fetchJSON<{ ok?: boolean; txHash?: string; error?: string }>(`${API_BASE}/api/admin/markets/${market.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payoutNumerators }),
      })
      if (response?.ok === false) {
        throw new Error(response.error || 'Resolution failed')
      }
      setResolveSuccess(response?.txHash ?? 'submitted')
      setMarket((prev) => (prev ? { ...prev, status: 'resolved', resolvedAt: new Date().toISOString() } : prev))
      setResolvedBanner({ payouts: payoutNumerators })
      await refreshAll(undefined, { ignoreCache: true })
      await fetchPoolReserves()
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setResolveError('Admin authentication required. Please sign in as an admin to resolve this market.')
      } else {
        setResolveError(err instanceof Error ? err.message : 'Failed to resolve market')
      }
    } finally {
      setResolveLoading(false)
    }
  }, [market, resolveOutcomeIndex, refreshAll, fetchPoolReserves])

  const handleRedeem = useCallback(async () => {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setRedeemError('Connect your wallet to redeem')
      return
    }
    if (!conditionId || !usdfAddress || !ctfAddress) {
      setRedeemError('Missing contract addresses')
      return
    }

    const donationAddress = DEV_DONATION_ADDRESS
    const donationAmount = parseUnits(DONATION_AMOUNT, 18)
    const shouldDonate = hasRedeemedOnce

    const waitForSuccess = async (hash: `0x${string}`) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (!receipt || receipt.status !== 'success') {
        throw new Error('Transaction reverted')
      }
      return receipt
    }

    setIsRedeeming(true)
    setRedeemError(null)
    setRedeemSuccess(null)
    try {
      if (shouldDonate) {
        if (!donationAddress) {
          throw new Error('Donation address not configured (NEXT_PUBLIC_DEV_DONATION_ADDRESS)')
        }

        const balance = await publicClient.getBalance({ address })
        const gasPrice = await publicClient.getGasPrice()
        const estimatedGas = 21_000n
        const required = donationAmount + estimatedGas * gasPrice

        if (balance < required) {
          throw new Error('Not enough balance to send 0.01 native tip + gas')
        }

        const txHash = await walletClient.sendTransaction({
          to: donationAddress,
          value: donationAmount,
          account: address,
        })

        await waitForSuccess(txHash)
        setRedeemSuccess(txHash)
        await loadWalletBalances()
      } else {
        const txHash = await walletClient.writeContract({
          address: ctfAddress,
          abi: CTF_ABI,
          functionName: 'redeemPositions',
          args: [
            usdfAddress,
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            conditionId,
            [1n, 2n],
          ],
          account: address,
        })

        await waitForSuccess(txHash)
        setRedeemSuccess(txHash)
        setHasRedeemedOnce(true)
        await fetchPoolReserves()
        await loadWalletBalances()
      }
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Redeem failed'
      setRedeemError(msg)
    } finally {
      setIsRedeeming(false)
    }
  }, [
    isConnected,
    address,
    walletClient,
    publicClient,
    conditionId,
    usdfAddress,
    ctfAddress,
    fetchPoolReserves,
    loadWalletBalances,
    hasRedeemedOnce,
  ])

  // Handle Buy/Sell orders
  const handlePlaceOrder = async (side: 'BUY' | 'SELL') => {
    setTradeSide(side)

    if (!isConnected || !address || !market) {
      setOrderError('Please connect your wallet to trade')
      return
    }

    if (isExpired && !isResolved) {
      setOrderError('Market has expired and is awaiting oracle settlement. Trading is closed.')
      return
    }

    if (!publicClient) {
      setOrderError('Unable to access RPC client. Please reconnect your wallet.')
      return
    }

    if (!walletClient) {
      setOrderError('Wallet client unavailable. Reconnect and try again.')
      return
    }

    if (!tradeAmount || Number.isNaN(Number(tradeAmount)) || Number(tradeAmount) <= 0) {
      setOrderError('Enter a valid amount above zero')
      return
    }

    if (!selectedOutcome) {
      setOrderError('Select an outcome to trade')
      return
    }

    if (!conditionId) {
      setOrderError('Market condition is still syncing. Please try again shortly.')
      return
    }

    if (!fpmmAddress || !usdfAddress || !ctfAddress) {
      setOrderError(tradingConfigError || 'Trading contracts not configured')
      return
    }

    const outcomeIndex = market.outcomes.findIndex(o => o.name === selectedOutcome)
    const normalizedOutcome = outcomeIndex >= 0 ? outcomeIndex : (selectedOutcome.toLowerCase() === 'yes' ? 0 : 1)

    if (normalizedOutcome < 0) {
      setOrderError('Selected outcome is unavailable for this market')
      return
    }

    const currentPoolInitialized = poolInitialized ?? await loadPoolState()
    if (!currentPoolInitialized) {
      setStatusMessage(null)
      setIsPlacingOrder(false)
      setOrderError('Pool not initialized. Ask an admin to seed the pool.')
      return
    }

    let parsedAmount: bigint
    try {
      parsedAmount = parseUnits(tradeAmount, 18)
    } catch {
      setOrderError('Invalid amount format')
      return
    }

    if (parsedAmount <= 0n) {
      setOrderError('Amount must be greater than zero')
      return
    }

    setIsPlacingOrder(true)
    setOrderError(null)
    setStatusMessage('Requesting quote…')
    setOrderSuccess(null)

    try {
      const tradeSide = side === 'BUY' ? 'buy' : 'sell'

      const { amountOut } = await quoteFpmmTrade({
        publicClient,
        fpmmAddress,
        conditionId,
        outcomeIndex: normalizedOutcome,
        amountIn: parsedAmount,
        side: tradeSide,
      })

      if (amountOut <= 0n) {
        setOrderError('Pool too shallow. Try a smaller amount or seed more liquidity.')
        setIsPlacingOrder(false)
        setStatusMessage(null)
        return
      }

      const slippageBps = 50n // 0.5%
      const minOut = (amountOut * (10_000n - slippageBps)) / 10_000n

      if (minOut <= 0n) {
        setOrderError('Calculated minimum output is zero. Try a smaller trade size.')
        setIsPlacingOrder(false)
        setStatusMessage(null)
        return
      }

      let approvalReceiptPromise: Promise<any> | null = null
      let approvalErrorLabel: string | null = null

      if (side === 'BUY') {
        setStatusMessage('Checking USDF balance…')
        const userUsdfBalance = await publicClient.readContract({
          address: usdfAddress,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address],
        }) as bigint

        if (userUsdfBalance < parsedAmount) {
          setOrderError('Insufficient USDF balance')
          setIsPlacingOrder(false)
          setStatusMessage(null)
          return
        }

        setStatusMessage('Checking USDF allowance…')
        const approvalHash = await ensureUsdfAllowance({
          publicClient,
          walletClient,
          account: address,
          tokenAddress: usdfAddress,
          spender: fpmmAddress,
          minimum: parsedAmount,
        })

        if (approvalHash) {
          setStatusMessage('Approval submitted. Confirm the trade in your wallet…')
          approvalErrorLabel = 'USDF approval failed'
          approvalReceiptPromise = publicClient.waitForTransactionReceipt({ hash: approvalHash })
        }
      } else {
        setStatusMessage('Checking outcome token approval…')
        const approvalHash = await ensureOutcomeApproval({
          publicClient,
          walletClient,
          account: address,
          ctfAddress,
          operator: fpmmAddress,
        })

        if (approvalHash) {
          setStatusMessage('Outcome approval submitted. Confirm the trade in your wallet…')
          approvalErrorLabel = 'Outcome approval failed'
          approvalReceiptPromise = publicClient.waitForTransactionReceipt({ hash: approvalHash })
        }
      }

      setStatusMessage('Submitting trade…')
      const tradeHash = await swapExactUsdfForOutcome({
        walletClient,
        account: address,
        fpmmAddress,
        conditionId,
        outcomeIndex: normalizedOutcome,
        amountIn: parsedAmount,
        minOut,
        side: tradeSide,
      })

      const notifyMarketId = marketIdRef.current ?? market?.id ?? undefined
      notifyTx(tradeHash, notifyMarketId).catch((err) => {
        console.warn('[market] Failed to enqueue tx for indexing', err)
      })

      setStatusMessage('Awaiting confirmation…')
      const [tradeResult, approvalResult] = await Promise.allSettled([
        publicClient.waitForTransactionReceipt({ hash: tradeHash }),
        approvalReceiptPromise ?? Promise.resolve(null),
      ])

      if (approvalResult.status === 'rejected') {
        throw new Error(approvalErrorLabel ?? 'Approval transaction failed')
      }

      if (approvalResult.status === 'fulfilled' && approvalResult.value && approvalResult.value.status !== 'success') {
        throw new Error(approvalErrorLabel ?? 'Approval transaction failed')
      }

      if (tradeResult.status !== 'fulfilled') {
        throw tradeResult.reason ?? new Error('Trade confirmation failed')
      }

      const receipt = tradeResult.value
      if (!receipt || receipt.status !== 'success') {
        throw new Error('Trade transaction reverted')
      }

      setOrderSuccess({ hash: tradeHash, side })
      setTradeAmount('')
      setStatusMessage(null)
      setPoolInitialized(true)

      // Refresh market + health snapshots after confirmation
      await refreshAll(undefined, { ignoreCache: true })
      refreshHealth()
      await refreshBalances()
      await fetchPoolReserves()

      // Clear success message after a brief display
      setTimeout(() => setOrderSuccess(null), 8000)
    } catch (error: unknown) {
      console.error('Trade error:', error)
      const message = extractErrorMessage(error)
      if (message.toLowerCase().includes('pool not initialized')) {
        setPoolInitialized(false)
        setOrderError('Pool not initialized. Ask an admin to seed the pool.')
      } else {
        setOrderError(message)
      }
    } finally {
      setIsPlacingOrder(false)
      setStatusMessage(null)
    }
  }

  const refreshHealth = useCallback(async () => {
    try {
      const payload = await fetchJSON<{
        recon?: {
          effectiveLag?: number
          lagBlocks?: number
          chainHead?: number
          confirmations?: number
          lastIndexedBlock?: number
          isRunning?: boolean
          lastError?: string | null
          status?: 'ok' | 'warn' | 'alert'
        }
      }>(`${API_BASE}/api/healthz`)

      const recon = payload?.recon
      if (!recon) {
        return
      }

      const effectiveLag = typeof recon.effectiveLag === 'number'
        ? recon.effectiveLag
        : Math.max(
          0,
          (recon.chainHead ?? 0) - (recon.confirmations ?? 0) - (recon.lastIndexedBlock ?? 0),
        )

      const status = (() => {
        const raw = recon.status
        if (raw === 'ok' || raw === 'warn' || raw === 'alert') {
          return raw
        }
        if (effectiveLag >= 50) return 'alert'
        if (effectiveLag >= 10) return 'warn'
        return 'ok'
      })()

      setLagInfo({
        effectiveLag,
        status,
        isRunning: Boolean(recon.isRunning ?? true),
        lastError: recon.lastError ?? null,
      })
    } catch (error) {
      console.debug('[market page] health fetch failed', error)
    }
  }, [])

  useEffect(() => {
    refreshHealth()
  }, [refreshHealth])

  const lagVariant: 'warn' | 'alert' | null = (() => {
    if (!lagInfo) return null
    if (!lagInfo.isRunning || lagInfo.lastError || lagInfo.status === 'alert' || lagInfo.effectiveLag >= 50) {
      return 'alert'
    }
    if (lagInfo.effectiveLag >= 10 || lagInfo.status === 'warn') {
      return 'warn'
    }
    return null
  })()

  const showLagPill = lagVariant !== null

  const lagPillText = (() => {
    if (!lagInfo || !lagVariant) return ''
    if (!lagInfo.isRunning) {
      return 'Indexer paused'
    }
    if (lagInfo.lastError) {
      return 'Indexer recovering'
    }
    const plural = lagInfo.effectiveLag === 1 ? '' : 's'
    if (lagVariant === 'alert') {
      return `Indexer catching up (${lagInfo.effectiveLag} block${plural} behind)`
    }
    return `Indexer ${lagInfo.effectiveLag} block${plural} behind`
  })()

  const lagPillClasses = lagVariant === 'alert'
    ? 'mb-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/15 border border-red-500/40 text-red-200 text-xs'
    : 'mb-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white/70 text-xs'

  const lagDotClass = lagVariant === 'alert' ? 'bg-red-300' : 'bg-white/50'
  const errorBanner = loadError
    ? (
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        <span>Failed to refresh market: {loadError}</span>
        <button
          onClick={handleRetry}
          className="self-start sm:self-auto rounded-md border border-red-300/60 bg-transparent px-3 py-1 text-xs font-semibold text-red-100 hover:bg-red-500/20 transition-colors"
        >
          Retry
        </button>
      </div>
    )
    : null

  if (notFoundFromApi) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center space-y-4 text-[var(--text-secondary)] px-6">
        <h1 className="text-2xl font-bold text-white">Market not found</h1>
        <p>The requested market could not be located. It may have been removed or the slug is incorrect.</p>
        <Link href="/markets" className="text-[var(--primary-yellow)] hover:underline">
          ← Back to markets
        </Link>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center space-y-4 text-[var(--text-secondary)] px-6">
        <h1 className="text-2xl font-bold text-white">Market not found</h1>
        <p>The requested market could not be located. It may have been removed or the slug is incorrect.</p>
        <Link href="/markets" className="text-[var(--primary-yellow)] hover:underline">
          ← Back to markets
        </Link>
      </div>
    )
  }

  if (loadError && !market) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-[var(--text-secondary)] space-y-4 px-6 text-center">
        <div>Failed to load market: {loadError}</div>
        <button
          onClick={handleRetry}
          className="btn-neon text-black font-semibold px-4 py-2 rounded-lg"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!market) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-[var(--text-secondary)]">
        {isRefreshing ? 'Loading market data…' : 'Loading market…'}
      </div>
    )
  }

  if (!market.id || !market.fpmmAddress) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-[var(--text-secondary)] space-y-4 px-6 text-center">
        <h1 className="text-2xl font-bold text-white">Market not ready</h1>
        <p>This market has not been fully initialized yet. Seed the pool or wait for the admin to complete setup.</p>
        <Link href="/markets" className="text-[var(--primary-yellow)] hover:underline">
          ← Back to markets
        </Link>
      </div>
    )
  }

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      },
    },
    scales: {
      x: {
        display: false,
      },
      y: {
        display: false,
        min: 0,
        max: 1,
      },
    },
    elements: {
      point: {
        radius: 0,
      },
      line: {
        borderWidth: 2,
        tension: 0.4,
      },
    },
  }

  const chartDataConfig = {
    labels: (renderChartData?.prices || []).map(p => formatDate(new Date(p.timestamp))) || [],
    datasets: [
      {
        data: (renderChartData?.prices || []).map(p => p.price) || [],
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
      },
    ],
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Resolved Banner */}
      {resolvedBanner && (
        <div className="mb-6 glass-card p-4 border-blue-500/20 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✅</span>
            <div>
              <p className="font-semibold text-blue-400">Market Resolved!</p>
              <p className="text-sm text-[var(--text-secondary)]">
                This market has been resolved on-chain.
              </p>
            </div>
          </div>
          {market?.status === 'resolved' && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-sm text-[var(--text-secondary)]">
                Redeem your YES/NO shares to claim USDF.
              </div>
              <div className="flex items-center gap-3">
                {redeemSuccess && (
                  <a
                    className="text-xs underline text-green-300"
                    href={`https://testnet.bscscan.com/tx/${redeemSuccess}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View tx
                  </a>
                )}
                {redeemError && (
                  <span className="text-xs text-red-300">{redeemError}</span>
                )}
                <button
                  onClick={handleRedeem}
                  disabled={isRedeeming}
                  className="px-4 py-2 text-sm font-semibold rounded-md bg-[var(--primary-yellow)] text-black hover:opacity-90 disabled:opacity-50"
                >
                  {isRedeeming ? 'Redeeming…' : 'Redeem payouts'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Back Button */}
      <Link
        href="/markets"
        className="inline-flex items-center text-[var(--text-secondary)] hover:text-white mb-6"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to markets
      </Link>

      {errorBanner}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Market Header */}
          <div className="glass-card rounded-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${isResolved
                    ? 'bg-blue-500/20 text-blue-400'
                    : isExpired
                      ? 'bg-[var(--primary-yellow)]/20 text-[var(--primary-yellow)]'
                      : 'bg-[var(--success-green)]/20 text-[var(--success-green)]'
                    }`}>
                    {isResolved ? 'resolved' : isExpired ? 'settlement pending' : market.status}
                  </span>
                  <span className="px-2 py-1 text-xs font-medium bg-[var(--hover-background)] text-[var(--text-secondary)] rounded-full">
                    {market.category}
                  </span>
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">
                  {market.title}
                </h1>
                <p className="text-[var(--text-secondary)]">
                  {market.description}
                </p>
              </div>
            </div>

            {/* Market Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-[var(--border-color)]">
              <div className="text-center">
                <div className="text-2xl font-bold text-white">
                  {displayPrice != null ? formatPct(displayPrice, 2) : '—'}
                </div>
                <div className="text-sm text-[var(--text-muted)]">Yes Price</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white">
                  {metricsState ? formatUSDF(metricsState.volume24hUSDF) : '—'}
                </div>
                <div className="text-sm text-[var(--text-muted)]">24h Volume</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white">
                  {derivedTvl != null ? formatUSDF(derivedTvl) : '—'}
                </div>
                <div className="text-sm text-[var(--text-muted)]">TVL</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-white">
                  {formatTimeRemaining(market.endDate)}
                </div>
                <div className="text-sm text-[var(--text-muted)]">Time Remaining</div>
              </div>
            </div>

            {metricsState && !metricsState.raw.spot && poolInitialized === false && (
              <div className="mt-4 text-sm text-[var(--text-secondary)] bg-[var(--hover-background)]/30 border border-[var(--border-color)]/40 rounded-lg px-4 py-3">
                Pool initializing / no liquidity yet. Trades will enable once liquidity is added.
              </div>
            )}
          </div>

          {/* Price Chart */}
          <div className="glass-card rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">
                Price Chart
              </h2>
              <div className="flex gap-2">
                {(['1H', '24H', '7D', '30D'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setTimeFilter(filter)}
                    className={`px-3 py-1 text-sm font-bold rounded transition-all duration-300 ${timeFilter === filter
                      ? 'btn-neon text-black'
                      : 'glass-card text-[var(--text-secondary)] hover:text-white hover:shadow-lg hover:scale-105'
                      }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-64 mb-4 relative">
              {/* Chart background with liquid glass effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary-yellow)]/6 via-[var(--primary-yellow)]/2 to-[var(--primary-yellow)]/4 rounded-lg"></div>
              <div className="relative z-10 h-full flex items-center justify-center">
                {hasCandles && chartData ? (
                  <Line data={chartDataConfig} options={chartOptions} />
                ) : (
                  <div className="text-sm text-[var(--text-secondary)]">
                    No history yet
                  </div>
                )}
              </div>
            </div>

            {/* Current Prices */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {market.outcomes.map((outcome, index) => {
                const outcomeProbability = (() => {
                  if (poolPrice) return index === 0 ? poolPrice.yesPrice : poolPrice.noPrice
                  return null
                })()

                return (
                  <div key={outcome.name} className="text-center p-3 glass-card rounded-lg hover:shadow-lg transition-all duration-300">
                    <div className="text-lg font-semibold text-white">
                      {outcome.name}
                    </div>
                    <div className="text-2xl font-bold text-[var(--primary-yellow)]">
                      {outcomeProbability !== null ? formatPct(outcomeProbability, 2) : '—'}
                    </div>
                    <div className="text-sm text-[var(--text-muted)]">
                      Spot price
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Live Trade Tape */}
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-2">
            <span
              className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-[var(--success-green)] animate-pulse shadow-[0_0_6px_var(--success-green)]' : 'bg-red-400'
                }`}
              aria-hidden
            />
            <span>{sseConnected ? 'Live updates active' : 'Live updates reconnecting…'}</span>
          </div>
          <LiveTape rows={liveTrades} chainId={TARGET_CHAIN_ID} />

          {/* Discussion */}
          <MarketDiscussion
            comments={comments}
            user={user}
            isSubmitting={commentsSubmitting}
            isSigningIn={isSigning}
            hasMore={commentsHasMore}
            isLoading={commentsLoading}
            onLoadMore={handleLoadMoreComments}
            onSubmit={handleSubmitComment}
            onSignIn={signIn}
          />
        </div>

        {/* Sidebar */}
        {/* Trading Sidebar */}
        <div className="space-y-6">
          {/* Last Trade Chip */}
          {lastTrade && (
            <div className="glass-card rounded-lg p-4">
              <h4 className="text-sm font-semibold text-white mb-2">Last Trade</h4>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-[var(--text-muted)]">Price</div>
                  <div className="text-lg font-mono text-[var(--primary-yellow)]">
                    {lastTrade.price}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--text-muted)]">Size</div>
                  <div className="text-lg font-mono text-white">
                    {lastTrade.size}
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Trading Interface */}
          <div className="glass-card rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              {isResolved ? 'Redeem' : isExpired ? 'Settlement Pending' : 'Place Trade'}
            </h3>

            {tradingConfigError && (
              <div className="mb-4 p-3 glass-card border-red-500/40 rounded-lg text-red-300 text-sm">
                {tradingConfigError}. Trading is disabled until the deployment config is updated.
              </div>
            )}

            {poolLoading && !tradingConfigError && (
              <div className="mb-4 p-3 glass-card border-yellow-400/30 rounded-lg text-yellow-200 text-xs">
                Checking pool status…
              </div>
            )}

            {poolError && (
              <div className="mb-4 p-3 glass-card border-red-500/40 rounded-lg text-red-300 text-sm">
                {poolError}
              </div>
            )}

            {poolInitialized === false && !tradingConfigError && (
              <div className="mb-4 p-3 glass-card border-yellow-400/40 rounded-lg text-yellow-100 text-sm">
                Pool not initialized. Ask an admin to seed the pool before trading.
              </div>
            )}

            {adminCheckComplete && isAdmin && !tradingConfigError && poolInitialized === false && (
              <div className="mb-4 flex flex-col gap-2">
                <button
                  onClick={handleSeedPool}
                  disabled={seedLoading}
                  className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all duration-300 shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:scale-105"
                >
                  {seedLoading ? 'Seeding pool…' : 'Seed Pool'}
                </button>
                {seedError && (
                  <div className="text-sm text-red-300">
                    {seedError}
                  </div>
                )}
                {seedSuccess && (
                  <a
                    href={`${explorerBase}/tx/${seedSuccess}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline text-blue-200 hover:text-blue-100"
                  >
                    View seed transaction →
                  </a>
                )}
              </div>
            )}

            {adminCheckComplete && isAdmin && market?.status !== 'resolved' && (
              <div className="mb-4 glass-card rounded-lg border border-[var(--border-color)] p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-white">Resolve Market</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Choose the winning outcome and finalize on-chain.
                  </p>
                </div>
                <select
                  className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)]"
                  value={resolveOutcomeIndex}
                  onChange={(e) => setResolveOutcomeIndex(Number(e.target.value))}
                  disabled={resolveLoading || market.status === 'resolved'}
                >
                  {market.outcomes.map((outcome, idx) => (
                    <option key={`${outcome.name}-${idx}`} value={idx}>
                      {outcome.name || (idx === 0 ? 'Yes' : 'No')}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleResolve}
                  disabled={resolveLoading}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-lime-500 text-black font-bold shadow-lg shadow-emerald-500/40 hover:scale-105 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {resolveLoading ? 'Submitting resolution…' : 'Resolve Market'}
                </button>
                {resolveError && <div className="text-xs text-red-300">{resolveError}</div>}
                {resolveSuccess && (
                  <a
                    href={`${explorerBase}/tx/${resolveSuccess}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline text-emerald-200 hover:text-emerald-100"
                  >
                    View resolution tx →
                  </a>
                )}
              </div>
            )}

            {showLagPill && lagInfo && (
              <div className={lagPillClasses}>
                <span className={`w-2 h-2 rounded-full ${lagDotClass}`} aria-hidden />
                <span>{lagPillText}</span>
                {lagInfo.lastError && (
                  <button
                    type="button"
                    className="underline decoration-dotted hover:text-white/90"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.open('/debug', '_blank', 'noopener')
                      }
                    }}
                  >
                    details
                  </button>
                )}
              </div>
            )}

            {/* Outcome Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Select Outcome
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {market.outcomes.map((outcome) => (
                  <button
                    key={outcome.name}
                    onClick={() => setSelectedOutcome(outcome.name)}
                    className={`p-3 text-sm font-bold rounded-lg transition-all duration-300 ${selectedOutcome === outcome.name
                      ? 'btn-neon text-black'
                      : 'glass-card text-[var(--text-secondary)] hover:text-white hover:shadow-lg hover:scale-105'
                      }`}
                  >
                    {outcome.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount Input / Trading Gate */}
            {!isTradingOpen ? (
              <>
                <div className="mb-4 p-3 glass-card rounded-lg text-sm text-[var(--text-secondary)]">
                  {isResolved
                    ? 'Trading is closed because this market is resolved. Redeem your shares below.'
                    : isExpired
                      ? 'Market has expired — settlement pending. Trading is frozen while the oracle posts the result.'
                      : 'Trading is closed while the market is pending resolution.'}
                </div>
                {isResolved && (
                  <div className="mb-4 flex flex-col gap-2">
                    <button
                      onClick={handleRedeem}
                      disabled={isRedeeming}
                      className="px-4 py-2 text-sm font-semibold rounded-md bg-[var(--primary-yellow)] text-black hover:opacity-90 disabled:opacity-50"
                    >
                      {isRedeeming ? 'Redeeming…' : 'Redeem payouts'}
                    </button>
                    <div className="text-xs text-[var(--text-muted)]">
                      Redeem converts your winning outcome shares into USDF. Clicking again sends a 0.01 native tip to the dev wallet to support the platform.
                    </div>
                    {redeemError && (
                      <div className="text-xs text-red-300">{redeemError}</div>
                    )}
                    {redeemSuccess && (
                      <a
                        href={`${explorerBase}/tx/${redeemSuccess}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline text-green-300"
                      >
                        View redeem tx →
                      </a>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="mb-4">
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Trade Amount
                </label>
                <input
                  type="number"
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(e.target.value)}
                  placeholder="0.00"
                  className="search-input w-full px-3 py-2 rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none"
                  disabled={Boolean(tradingConfigError) || poolInitialized === false}
                />
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Buy: amount of USDF to spend. Sell: outcome shares to redeem back to USDF.
                </p>
              </div>
            )}

            <div
              ref={walletCardRef}
              className={`mb-4 p-3 glass-card rounded-lg text-sm ${balancesFloating ? 'fixed w-64 shadow-2xl border border-[var(--primary-yellow)]/40 z-50' : ''}`}
              style={
                balancesFloating
                  ? {
                    top: walletPos?.y ?? Math.max((typeof window !== 'undefined' ? window.innerHeight - 220 : 500), 80),
                    left: walletPos?.x ?? Math.max((typeof window !== 'undefined' ? window.innerWidth - 280 : 800), 80),
                    cursor: isDraggingWallet ? 'grabbing' : 'grab',
                  }
                  : undefined
              }
              onMouseDown={(e) => {
                if (!balancesFloating) return
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
                setIsDraggingWallet(true)
              }}
            >
              <div className="flex justify-between items-center text-[var(--text-secondary)] mb-1">
                <span className="font-semibold text-white">Your wallet</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setBalancesFloating((v) => {
                        const next = !v
                        if (next && typeof window !== 'undefined') {
                          const rect = walletCardRef.current?.getBoundingClientRect()
                          const width = rect?.width ?? 280
                          const height = rect?.height ?? 220
                          const x = Math.max(8, window.innerWidth - width - 16)
                          const y = Math.max(8, Math.min(rect?.top ?? (window.innerHeight - height) / 2, window.innerHeight - height - 16))
                          setWalletPos({ x, y })
                        } else {
                          setWalletPos(null)
                          setIsDraggingWallet(false)
                        }
                        return next
                      })
                    }}
                    className="text-xs underline text-[var(--primary-yellow)] hover:text-white"
                    title="Undock / dock wallet balances panel"
                    disabled={!isWalletConnected}
                  >
                    {balancesFloating ? 'Dock' : 'Undock'}
                  </button>
                </div>
              </div>

              {!isWalletConnected ? (
                <div className="text-[var(--text-secondary)] text-xs">
                  Connect your wallet to see balances. Undock is disabled until connected.
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>USDF</span>
                    <span className="text-white font-mono">{walletBalances.usdf ?? '0.0000'}</span>
                  </div>
                  <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>YES Shares</span>
                    <span className="text-white font-mono">{walletBalances.yes ?? '0.0000'}</span>
                  </div>
                  <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>NO Shares</span>
                    <span className="text-white font-mono">{walletBalances.no ?? '0.0000'}</span>
                  </div>
                </>
              )}
            </div>

            {/* Price Display */}
            {selectedOutcome && (
              <div className="mb-4 p-3 glass-card rounded-lg">
                <div className="flex justify-between text-sm text-[var(--text-secondary)] mb-1">
                  <span>Current Price</span>
                  <span>
                    {(() => {
                      const base = displayPrice ?? market.outcomes.find(o => o.name === selectedOutcome)?.price ?? 0
                      return (base * 100).toFixed(1) + '%'
                    })()}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-[var(--text-secondary)]">
                  <span>Outcome Selected</span>
                  <span>{selectedOutcome}</span>
                </div>
              </div>
            )}

            {statusMessage && (
              <div className="mb-4 p-3 glass-card border-yellow-400/30 rounded-lg text-yellow-200 text-sm">
                {statusMessage}
              </div>
            )}

            {/* Success/Error Messages */}
            {orderSuccess && (
              <div className="mb-4 p-3 glass-card border-green-500/30 rounded-lg text-green-300 text-sm shadow-lg shadow-green-500/20">
                <p className="font-semibold">Trade confirmed on-chain.</p>
                <a
                  href={`${explorerBase}/tx/${orderSuccess.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-green-200 hover:text-green-100 text-xs inline-flex items-center gap-1 mt-1"
                >
                  View on BscScan →
                </a>
              </div>
            )}
            {orderError && (
              <div className="mb-4 p-3 glass-card border-red-500/30 rounded-lg text-red-300 text-sm shadow-lg shadow-red-500/20">
                {orderError}
              </div>
            )}

            {/* Trade Buttons */}
            {isTradingOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={() => handlePlaceOrder('BUY')}
                  disabled={isPlacingOrder || !isConnected || Boolean(tradingConfigError) || !conditionId || poolInitialized === false}
                  className={`px-4 py-2 bg-gradient-to-r from-[#62b78d] to-[#4fa77d] hover:from-[#5aad87] hover:to-[#479f74] disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all duration-300 shadow-[0_0_25px_rgba(98,183,141,0.25)] hover:shadow-[0_0_30px_rgba(98,183,141,0.35)] hover:scale-105 ${tradeSide === 'BUY' ? 'ring-2 ring-[rgba(98,183,141,0.7)]' : ''
                    }`}
                >
                  {isPlacingOrder && tradeSide === 'BUY' ? 'Processing…' : 'Buy'}
                </button>
                <button
                  onClick={() => handlePlaceOrder('SELL')}
                  disabled={isPlacingOrder || !isConnected || Boolean(tradingConfigError) || !conditionId || poolInitialized === false}
                  className={`px-4 py-2 bg-gradient-to-r from-[#e60001] to-[#b80001] hover:from-[#d40001] hover:to-[#a40000] disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all duration-300 shadow-[0_0_25px_rgba(230,0,1,0.25)] hover:shadow-[0_0_30px_rgba(230,0,1,0.35)] hover:scale-105 ${tradeSide === 'SELL' ? 'ring-2 ring-[rgba(230,0,1,0.7)]' : ''
                    }`}
                >
                  {isPlacingOrder && tradeSide === 'SELL' ? 'Processing…' : 'Sell'}
                </button>
              </div>
            )}

            {isTradingOpen && !isConnected && (
              <p className="mt-2 text-sm text-[var(--text-secondary)] text-center">
                Connect your wallet to trade
              </p>
            )}
          </div>

          {/* Market Info */}
          <div className="glass-card rounded-lg p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Market Information
            </h3>

            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Created by</span>
                <span className="text-white font-mono text-sm">
                  {market.createdBy}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">End Date</span>
                <span className="text-white">
                  {formatDate(market.endDate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Category</span>
                <span className="text-white">{market.category}</span>
              </div>
            </div>

            {market.tags && market.tags.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                <div className="flex flex-wrap gap-2">
                  {market.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 text-xs bg-[var(--primary-yellow)]/20 text-[var(--primary-yellow)] rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Pool Reserves (on-chain) */}
          <div className="glass-card rounded-lg p-4 border border-[var(--primary-yellow)]/40">
            <div className="flex items-center justify-between text-[var(--text-secondary)] mb-2">
              <span className="font-semibold text-white text-base">Pool Reserves (on-chain)</span>
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>USDF</span>
              <span className="text-white font-mono">{poolReserves.usdf ?? '—'}</span>
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>YES Shares</span>
              <span className="text-white font-mono">{poolReserves.yes ?? '—'}</span>
            </div>
            <div className="flex justify-between text-[var(--text-secondary)]">
              <span>NO Shares</span>
              <span className="text-white font-mono">{poolReserves.no ?? '—'}</span>
            </div>
            {poolReserves.lastUpdated && (
              <div className="mt-2 text-[var(--text-muted)] text-xs">
                Updated: {new Date(poolReserves.lastUpdated).toLocaleTimeString()}
              </div>
            )}
            <div className="mt-2 text-[var(--text-muted)] text-xs">
              Trades move inventory: buying YES reduces pool YES and increases pool NO (and vice versa).
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

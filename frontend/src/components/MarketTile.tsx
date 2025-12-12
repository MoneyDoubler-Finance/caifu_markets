'use client'

import Link from 'next/link'
import { useMemo, type CSSProperties } from 'react'
import type { Market, MarketMetrics, Candle, TileBackground } from '@/types'
import { formatTimeRemaining, formatUSDF, formatPct } from '@/utils/format'
import { useTileBackgrounds } from '@/hooks/useTileBackgrounds'
import { toAbsoluteMediaUrl } from '@/utils/media'

const SPARKLINE_WIDTH = 140
const SPARKLINE_HEIGHT = 40

const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() ?? ''

const collectMarketLabels = (market: Market) => {
  const labels = new Set<string>()

  if (market.category) {
    const normalized = normalize(market.category)
    if (normalized) labels.add(normalized)
  }

  if (Array.isArray(market.tags)) {
    for (const tag of market.tags) {
      const normalized = normalize(tag)
      if (normalized) labels.add(normalized)
    }
  }

  return Array.from(labels)
}

const pickBackgroundForMarket = (
  market: Market,
  backgrounds: TileBackground[] | undefined
): TileBackground | null => {
  if (!backgrounds || backgrounds.length === 0) {
    return null
  }

  const candidates = collectMarketLabels(market)
  if (candidates.length === 0) {
    return null
  }

  return backgrounds.find((background) =>
    candidates.includes(background.normalizedTag)
  ) ?? null
}

const buildHeroStyle = (heroUrl?: string | null): CSSProperties | undefined => {
  const resolved = toAbsoluteMediaUrl(heroUrl)
  if (!resolved) return undefined

  const overlay = 'rgba(6, 10, 18, 0.72)'
  return {
    '--market-card-bg-image': `url(${resolved})`,
    '--market-card-bg-opacity': '0.82',
    '--market-card-overlay-color': overlay,
    backgroundImage: `linear-gradient(180deg, ${overlay} 0%, rgba(8, 12, 20, 0.9) 55%, rgba(6, 10, 16, 0.94) 100%), url(${resolved})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundBlendMode: 'overlay',
  } as CSSProperties
}

const buildCardStyle = (background: TileBackground | null): CSSProperties | undefined => {
  if (!background) return undefined

  const overlay = 'rgba(6, 10, 18, 0.72)'
  return {
    '--market-card-bg-image': `url(${background.imageUrl})`,
    '--market-card-bg-opacity': '0.82',
    '--market-card-overlay-color': overlay,
    backgroundImage: `linear-gradient(180deg, ${overlay} 0%, rgba(8, 12, 20, 0.9) 55%, rgba(6, 10, 16, 0.94) 100%), url(${background.imageUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundBlendMode: 'overlay',
  } as CSSProperties
}

const MAX_SPARK_POINTS = 10

const Sparkline = ({ candles }: { candles?: Candle[] }) => {
  const polyline = useMemo(() => {
    if (!candles || candles.length === 0) {
      return null
    }

    const recent = candles.slice(-80)
    const values = recent
      .map((entry) => parseFloat(entry.c))
      .filter((value) => Number.isFinite(value))

    // Downsample so the homepage trail doesn’t become a dense scribble.
    let sampled = values
    if (values.length > MAX_SPARK_POINTS) {
      const step = (values.length - 1) / (MAX_SPARK_POINTS - 1)
      sampled = Array.from({ length: MAX_SPARK_POINTS }, (_, i) => values[Math.round(i * step)])
    }

    if (sampled.length === 0) {
      return null
    }

    const min = Math.min(...sampled)
    const max = Math.max(...sampled)
    const range = max - min || 1

    const points = sampled.map((value, index) => {
      const x = (index / Math.max(sampled.length - 1, 1)) * SPARKLINE_WIDTH
      const y = SPARKLINE_HEIGHT - ((value - min) / range) * SPARKLINE_HEIGHT
      return `${x},${y}`
    })

    return points.join(' ')
  }, [candles])

  if (!polyline) {
    return (
      <div className="h-16 flex items-center justify-center text-xs text-[var(--text-muted)] bg-[var(--hover-background)]/20 rounded">
        No sparkline yet
      </div>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      className="w-full h-16"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="sparklineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(250,204,21,0.6)" />
          <stop offset="100%" stopColor="rgba(250,204,21,0)" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke="url(#sparklineGradient)"
        strokeWidth="2"
        strokeLinecap="round"
        points={polyline}
      />
    </svg>
  )
}

type MarketWithSlug = Market & { slug?: string }

interface MarketTileProps {
  market: MarketWithSlug
  metrics?: MarketMetrics
  candles?: Candle[]
}

export default function MarketTile({ market, metrics, candles }: MarketTileProps) {
  const key = market.slug ?? market.id
  const { data: backgrounds } = useTileBackgrounds()

  const resolvedBackground = useMemo(
    () => pickBackgroundForMarket(market, backgrounds),
    [market, backgrounds]
  )

  const heroStyle = useMemo(() => buildHeroStyle(market.heroImageUrl), [market.heroImageUrl])

  const cardStyle = useMemo(
    () => heroStyle ?? buildCardStyle(resolvedBackground),
    [heroStyle, resolvedBackground]
  )

  const statusBadge = market.status === 'active'
    ? 'bg-[var(--success-green)]/20 text-[var(--success-green)]'
    : market.status === 'resolved'
    ? 'bg-blue-500/20 text-blue-400'
    : 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]'

  const yesLabel = market.outcomes[0]?.name ?? 'Yes'
  const noLabel = market.outcomes[1]?.name ?? 'No'

  const yesPrice = metrics?.spot ? parseFloat(metrics.spot.price) : null
  const noPrice = yesPrice !== null ? Math.max(0, 1 - yesPrice) : null
  const volume24h = metrics ? formatUSDF(metrics.volume24hUSDF ?? '0') : '—'
  const tvl = metrics ? formatUSDF(metrics.spot?.tvlUSDF ?? metrics.tvlUSDF ?? '0') : '—'
  const timeRemaining = market.status === 'resolved'
    ? 'Resolved'
    : formatTimeRemaining(market.endDate)

  return (
    <Link href={`/markets/${key}`}>
      <div
        className="market-card group h-full cursor-pointer transition-transform duration-300 hover:-translate-y-1"
        style={cardStyle}
        data-has-bg={resolvedBackground || heroStyle ? 'true' : 'false'}
        data-has-hero={heroStyle ? 'true' : 'false'}
      >
        <div className="relative z-[2] flex h-full flex-col">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusBadge}`}>
                  {market.status}
                </span>
                <span className="px-2 py-1 text-xs font-medium bg-[var(--card-background)] border border-[var(--border-color)] text-[var(--text-secondary)] rounded-full">
                  {market.category}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-white mb-1 line-clamp-2 group-hover:text-[var(--primary-yellow)] text-contrast-overlay">
                {market.title}
              </h3>
              {market.description && (
                <p className="text-sm text-[var(--text-secondary)] line-clamp-2 text-contrast-overlay">
                  {market.description}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="px-2 py-1 text-xs font-bold text-[var(--primary-yellow)] bg-[var(--primary-yellow)]/10 rounded-full">
                {tvl !== '$0' ? `TVL ${tvl}` : 'TVL pending'}
              </span>
              <span className="text-xs text-[var(--text-muted)]">{timeRemaining}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="glass-card rounded-lg px-3 py-2">
              <div className="text-xs text-[var(--text-muted)]">{yesLabel}</div>
              <div className="text-lg font-bold text-white">
                {yesPrice !== null ? formatPct(yesPrice, 1) : '—'}
              </div>
            </div>
            <div className="glass-card rounded-lg px-3 py-2">
              <div className="text-xs text-[var(--text-muted)]">{noLabel}</div>
              <div className="text-lg font-bold text-white">
                {noPrice !== null ? formatPct(noPrice, 1) : '—'}
              </div>
            </div>
          </div>

          <div className="mb-4">
            <Sparkline candles={candles} />
          </div>

          <div className="mt-auto flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <div>
              24h Volume: <span className="text-white font-semibold">{volume24h}</span>
            </div>
            <div>
              Outcomes: <span className="text-white font-semibold">{market.outcomes.length}</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

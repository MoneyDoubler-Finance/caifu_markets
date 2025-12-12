'use client'

import { useEffect, useRef, useState, useMemo, type CSSProperties } from 'react'
import Link from 'next/link'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { useMarkets } from '@/hooks/useApi'
import { useTileBackgrounds } from '@/hooks/useTileBackgrounds'
import { CAIFU_PICKS_SLUGS } from '@/data/heroShowcaseMarkets'
import { toAbsoluteMediaUrl } from '@/utils/media'
import { fetchJSON } from '@/lib/api'
import type { TileBackground } from '@/types'

interface CaifuPicksCarouselProps {
  speed?: number // pixels per second, default 70
}

interface SpotPoint {
  time: string
  yes: number
  no: number
}

// Build background style with overlay for text readability
const buildCardBackgroundStyle = (imageUrl: string | null | undefined): CSSProperties | undefined => {
  const resolved = toAbsoluteMediaUrl(imageUrl)
  if (!resolved) return undefined

  const overlay = 'rgba(6, 10, 18, 0.7)'
  return {
    backgroundImage: `linear-gradient(180deg, ${overlay} 0%, rgba(8, 12, 20, 0.85) 60%, rgba(6, 10, 16, 0.95) 100%), url(${resolved})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  }
}

// Find a matching tile background based on category or tags
const findTileBackground = (
  market: { category?: string | null; tags?: string[] | null; title?: string | null },
  backgrounds: TileBackground[] | undefined
): string | null => {
  if (!backgrounds || backgrounds.length === 0) return null

  // Collect all labels to match against (category + tags + title words)
  const labels: string[] = []
  if (market.category) {
    labels.push(market.category.trim().toLowerCase())
  }
  if (market.tags) {
    for (const tag of market.tags) {
      if (tag) {
        // Add both the tag and hyphen-to-space variant
        const normalized = tag.trim().toLowerCase()
        labels.push(normalized)
        labels.push(normalized.replace(/-/g, ' '))
      }
    }
  }
  // Also extract key words from title for matching
  if (market.title) {
    const titleLower = market.title.toLowerCase()
    // Extract potential matching terms from title
    const titleWords = titleLower.split(/\s+/)
    labels.push(...titleWords)
  }

  if (labels.length === 0) return null

  // Try exact match first
  for (const bg of backgrounds) {
    if (labels.includes(bg.normalizedTag)) {
      return bg.imageUrl
    }
  }

  // Try partial match (background tag contained in label or vice versa)
  for (const bg of backgrounds) {
    const bgTag = bg.normalizedTag
    for (const label of labels) {
      // Check if the tile background tag contains the label or vice versa
      if (bgTag.includes(label) || label.includes(bgTag)) {
        return bg.imageUrl
      }
    }
  }

  return null
}

const clampPrice = (value: number) => {
  if (!Number.isFinite(value)) return 0.5
  return Math.max(0.01, Math.min(0.99, value))
}

export default function CaifuPicksCarousel({ speed = 70 }: CaifuPicksCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number | null>(null)
  const offsetRef = useRef(0)
  const isPausedRef = useRef(false)

  const { data: apiMarkets } = useMarkets()
  const { data: tileBackgrounds } = useTileBackgrounds()

  // Store spot series data for sparklines
  const [spotSeriesMap, setSpotSeriesMap] = useState<Map<string, SpotPoint[]>>(new Map())

  // Filter to only Caifu Picks markets
  const caifuMarkets = useMemo(() => {
    return apiMarkets?.filter(m =>
      m.slug && CAIFU_PICKS_SLUGS.includes(m.slug)
    ) || []
  }, [apiMarkets])

  // Fetch spot series for sparklines
  useEffect(() => {
    if (caifuMarkets.length === 0) return

    const fetchSpotSeries = async (marketKey: string) => {
      try {
        const payload = await fetchJSON<any[]>(
          `/api/markets/${encodeURIComponent(marketKey)}/spot-series?limit=20`
        )
        if (!Array.isArray(payload) || payload.length === 0) return null

        const series = payload
          .map((p) => {
            const priceRaw = typeof p.yes === 'number' ? p.yes : typeof p.price === 'number' ? p.price : null
            if (!Number.isFinite(priceRaw)) return null
            const yesPrice = clampPrice(priceRaw)
            return {
              time: p.t || '',
              yes: yesPrice,
              no: clampPrice(1 - yesPrice),
            }
          })
          .filter(Boolean) as SpotPoint[]

        return series
      } catch {
        return null
      }
    }

    // Fetch for first 10 markets to avoid too many requests
    const marketsToFetch = caifuMarkets.slice(0, 10)
    Promise.all(
      marketsToFetch.map(async (m) => {
        const key = m.slug || m.id
        if (!key) return
        const series = await fetchSpotSeries(key)
        if (series && series.length > 0) {
          setSpotSeriesMap(prev => new Map(prev).set(key, series))
        }
      })
    )
  }, [caifuMarkets])

  // Animation loop using requestAnimationFrame
  useEffect(() => {
    if (!scrollRef.current || caifuMarkets.length === 0) return
    let lastTime = performance.now()

    const animate = (currentTime: number) => {
      if (!isPausedRef.current) {
        const delta = (currentTime - lastTime) / 1000
        offsetRef.current += speed * delta

        // Reset when we've scrolled through half (the duplicated content)
        const scrollWidth = scrollRef.current?.scrollWidth ?? 0
        if (scrollWidth > 0 && offsetRef.current >= scrollWidth / 2) {
          offsetRef.current = 0
        }

        if (scrollRef.current) {
          scrollRef.current.style.transform = `translateX(-${offsetRef.current}px)`
        }
      }
      lastTime = currentTime
      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [caifuMarkets.length, speed])

  // Don't render if no Caifu Picks markets
  if (caifuMarkets.length === 0) return null

  // Duplicate markets for seamless looping
  const displayMarkets = [...caifuMarkets, ...caifuMarkets]

  const handleMouseEnter = () => {
    isPausedRef.current = true
  }

  const handleMouseLeave = () => {
    isPausedRef.current = false
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between px-4 mb-4">
        <h2 className="text-lg font-semibold text-white">
          Caifu Picks
        </h2>
      </div>

      <div
        className="overflow-hidden"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div
          ref={scrollRef}
          className="flex items-stretch gap-4"
          style={{ willChange: 'transform' }}
        >
          {displayMarkets.map((market, idx) => {
            const yesPrice = market.yesPrice ?? 0.5
            const noPrice = 1 - yesPrice
            const yesPercent = Math.round(yesPrice * 100)
            const noPercent = Math.round(noPrice * 100)

            // Get hero image from the API, or fall back to category/tag-based tile background
            const heroImage = (market as any).heroImageUrl || null
            const fallbackImage = findTileBackground(market, tileBackgrounds)
            const backgroundStyle = buildCardBackgroundStyle(heroImage || fallbackImage)

            // Get sparkline data
            const marketKey = market.slug || market.id
            const spotSeries = spotSeriesMap.get(marketKey) || []

            // Generate fallback sparkline data if no real data
            const sparklineData = spotSeries.length > 0
              ? spotSeries
              : Array.from({ length: 10 }, (_, i) => ({
                  time: String(i),
                  yes: yesPrice + (Math.random() - 0.5) * 0.1,
                  no: noPrice + (Math.random() - 0.5) * 0.1,
                }))

            return (
              <Link
                key={`${market.id}-${idx}`}
                href={`/markets/${market.slug}`}
                className="group relative overflow-hidden rounded-xl border border-zinc-700/50 hover:border-zinc-600/70 transition-all duration-300 hover:scale-[1.02] shrink-0"
                style={{
                  width: '320px',
                  height: '340px',
                  ...backgroundStyle,
                  backgroundColor: backgroundStyle ? undefined : 'rgb(24 24 27 / 0.9)',
                }}
              >
                {/* Enhanced gradient for cards without images */}
                {!backgroundStyle && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-900 to-black" />
                    <div className="absolute inset-0 bg-gradient-to-tr from-emerald-950/30 via-transparent to-cyan-950/20" />
                    <div className="absolute inset-0 opacity-30" style={{
                      backgroundImage: 'radial-gradient(circle at 20% 80%, rgba(16, 185, 129, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(6, 182, 212, 0.1) 0%, transparent 40%)'
                    }} />
                  </>
                )}

                <div className="relative z-10 p-4 h-full flex flex-col">
                  {/* Category badge */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm text-emerald-400 uppercase tracking-wider border border-emerald-500/20">
                      {market.category || 'Market'}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-lg font-semibold text-white line-clamp-2 leading-snug group-hover:text-zinc-100 text-contrast-overlay mb-4">
                    {market.title}
                  </h3>

                  {/* Mini Sparkline Chart */}
                  <div className="flex-1 min-h-[80px] mb-4 rounded-lg bg-black/20 backdrop-blur-sm p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sparklineData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                        <Line
                          type="monotone"
                          dataKey="yes"
                          stroke="#10b981"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="no"
                          stroke="#ef4444"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Yes/No Prices */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between bg-emerald-500/10 rounded-lg px-3 py-2 border border-emerald-500/20">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-sm font-medium text-white">Yes</span>
                      </div>
                      <span className="text-lg font-bold text-emerald-400 font-mono">
                        {yesPercent}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <span className="text-sm font-medium text-white">No</span>
                      </div>
                      <span className="text-lg font-bold text-red-400 font-mono">
                        {noPercent}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Subtle gradient overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}

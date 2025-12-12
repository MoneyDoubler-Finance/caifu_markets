'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Filter, TrendingUp, Tag } from 'lucide-react'
import { Market, SortOption, MarketMetrics, Candle, MarketSummary } from '@/types'
import { useOnchainEvents, type MarketCreatedEvt } from '@/hooks/useOnchainEvents'
import { getMarkets, getMarket } from '@/lib/dataSource'
import MarketTile from '@/components/MarketTile'
import type { MarketResponse } from '@caifu/types'
import { toAbsoluteMediaUrl } from '@/utils/media'
import { API_BASE } from '@/lib/apiBase'

interface VisibleTag {
  name: string
  marketCount: number
}

type UiMarket = Market & { slug?: string }

const DEFAULT_ADDRESS = '0x0000…0000'
const DEFAULT_CATEGORY = 'General'
const DEFAULT_DESCRIPTION = 'Prediction market'

const slugifyTitle = (value: string | null | undefined) => {
  if (!value) return undefined
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined
  return trimmed
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

const mapMarketResponse = (market: MarketResponse): UiMarket => {
  const outcomes = Array.isArray(market.outcomes) && market.outcomes.length > 0
    ? market.outcomes
    : ['Yes', 'No']

  const createdAt = market.createdAt ? new Date(market.createdAt) : new Date()
  const expiresAt = market.expiresAt ? new Date(market.expiresAt) : null
  const resolvedAt = market.resolvedAt ? new Date(market.resolvedAt) : null
  const category =
    typeof market.category === 'string' && market.category.trim().length > 0
      ? market.category
      : DEFAULT_CATEGORY
  const tagValues = Array.isArray(market.tags)
    ? market.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
    : []

  return {
    id: market.id,
    conditionId: market.conditionId as UiMarket['conditionId'],
    fpmmAddress: market.fpmmAddress as UiMarket['fpmmAddress'],
    title: market.title ?? 'Market',
    description: DEFAULT_DESCRIPTION,
    category,
    outcomes: outcomes.map((name) => ({
      name,
      price: 0,
      change24h: 0,
    })),
    endDate: expiresAt ?? resolvedAt ?? createdAt,
    totalVolume: '0',
    liquidity: '0',
    createdBy: DEFAULT_ADDRESS,
    status: (market.status as UiMarket['status']) ?? 'active',
    imageUrl: undefined,
    heroImageUrl: toAbsoluteMediaUrl(market.heroImageUrl),
    tags: tagValues,
    // Use backend-provided slug only. Do NOT synthesize a slug
    // from the title here, or links will 404 until the DB is updated.
    slug: market.slug ?? undefined,
  } as UiMarket
}

export default function MarketsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>(searchParams.get('category') || 'All')
  const [selectedTag, setSelectedTag] = useState<string>(searchParams.get('tag') || 'All')
  const [selectedStatus, setSelectedStatus] = useState<string>('All')
  const [sortBy, setSortBy] = useState<SortOption>('volume')
  const [newMarketToast, setNewMarketToast] = useState<string | null>(null)
  const [markets, setMarkets] = useState<UiMarket[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [metricsByMarket, setMetricsByMarket] = useState<Record<string, MarketMetrics>>({})
  const [candlesByMarket, setCandlesByMarket] = useState<Record<string, Candle[]>>({})
  const summaryCacheRef = useRef(new Map<string, { data: MarketSummary; fetchedAt: number }>())
  const [visibleTags, setVisibleTags] = useState<VisibleTag[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)

  // Keep filters in sync with URL query params
  useEffect(() => {
    const categoryParam = searchParams.get('category') || 'All'
    const tagParam = searchParams.get('tag') || 'All'
    setSelectedCategory(categoryParam)
    setSelectedTag(tagParam)
  }, [searchParams])

  const updateUrlFilters = useCallback((category: string, tag: string) => {
    const params = new URLSearchParams()
    if (category && category !== 'All') params.set('category', category)
    if (tag && tag !== 'All') params.set('tag', tag)
    const qs = params.toString()
    router.push(qs ? `/markets?${qs}` : '/markets')
  }, [router])

  const categories = ['All', 'Trending', 'Breaking', 'New', 'Politics', 'Sports', 'Crypto', 'Earnings', 'Geopolitics', 'Tech', 'Culture', 'World', 'Economy', 'Economics', 'Technology']
  const CACHE_TTL_MS = 15_000
  const CONCURRENCY = 5

  // Fetch visible tags from API (curated list from admin)
  useEffect(() => {
    let cancelled = false
    const fetchVisibleTags = async () => {
      setTagsLoading(true)
      try {
        const res = await fetch(`${API_BASE}/api/tags`)
        if (!res.ok) {
          throw new Error('Failed to fetch tags')
        }
        const data = await res.json()
        if (!cancelled) {
          setVisibleTags(data.tags || [])
        }
      } catch (err) {
        console.error('[markets] failed to fetch visible tags:', err)
        if (!cancelled) {
          setVisibleTags([])
        }
      } finally {
        if (!cancelled) {
          setTagsLoading(false)
        }
      }
    }
    fetchVisibleTags()
    return () => {
      cancelled = true
    }
  }, [])

  // Build tag options from visible tags API response
  const tagOptions = useMemo(() => {
    const list = ['All', ...visibleTags.map((t) => t.name)]
    // If user has a tag selected via URL that's not in visible list, include it
    // (allows filtering even if admin hid the tag after user bookmarked URL)
    if (selectedTag && selectedTag !== 'All' && !visibleTags.some((t) => t.name === selectedTag)) {
      list.push(selectedTag)
    }
    return list
  }, [visibleTags, selectedTag])

  const fetchMarkets = useCallback(async () => {
    const result = await getMarkets({ limit: 50 })
    return result.map(mapMarketResponse)
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadMarkets = async () => {
      setLoading(true)
      setError(null)
      try {
        const next = await fetchMarkets()
        if (!cancelled) {
          setMarkets(next)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load markets'
          setError(message)
          setMarkets([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadMarkets().catch((err) => {
      console.error('[markets] initial load failed', err)
    })

    return () => {
      cancelled = true
    }
  }, [fetchMarkets])

  useEffect(() => {
    if (markets.length === 0) return

    let cancelled = false
    const now = Date.now()
    const entries = markets.map((market) => ({ key: market.slug ?? market.id }))

    setMetricsByMarket((prev) => {
      const next = { ...prev }
      entries.forEach(({ key }) => {
        const cached = summaryCacheRef.current.get(key)
        if (cached?.data?.metrics) {
          next[key] = cached.data.metrics
        }
      })
      return next
    })

    setCandlesByMarket((prev) => {
      const next = { ...prev }
      entries.forEach(({ key }) => {
        const cached = summaryCacheRef.current.get(key)
        if (cached?.data?.candles) {
          next[key] = cached.data.candles
        }
      })
      return next
    })

    const toFetch = entries.filter(({ key }) => {
      const cached = summaryCacheRef.current.get(key)
      return !cached || now - cached.fetchedAt > CACHE_TTL_MS
    })

    const run = async () => {
      for (let i = 0; i < toFetch.length && !cancelled; i += CONCURRENCY) {
        const slice = toFetch.slice(i, i + CONCURRENCY)
        const results = await Promise.allSettled(
          slice.map(async ({ key }) => {
            const summary = await getMarket(key)
            return { key, summary }
          })
        )

        if (cancelled) return

        const timestamp = Date.now()
        const nextMetrics: Record<string, MarketMetrics> = {}
        const nextCandles: Record<string, Candle[]> = {}

        results.forEach((result) => {
          if (result.status === 'fulfilled') {
            const { key, summary } = result.value
            summaryCacheRef.current.set(key, {
              data: summary,
              fetchedAt: timestamp,
            })
            if (summary?.metrics) {
              nextMetrics[key] = summary.metrics
            }
            if (Array.isArray(summary?.candles)) {
              nextCandles[key] = summary.candles
            }
          } else {
            console.error('[markets] summary fetch failed', result.reason)
          }
        })

        if (Object.keys(nextMetrics).length > 0) {
          setMetricsByMarket((prev) => ({ ...prev, ...nextMetrics }))
        }

        if (Object.keys(nextCandles).length > 0) {
          setCandlesByMarket((prev) => ({ ...prev, ...nextCandles }))
        }
      }
    }

    run().catch((err) => console.error('[markets] supplemental data load failed', err))

    return () => {
      cancelled = true
    }
  }, [markets])

  const refreshMarkets = useCallback(() => {
    fetchMarkets()
      .then((next) => {
        setMarkets(next)
        setError(null)
      })
      .catch((err) => {
        console.error('[markets] refresh failed', err)
      })
  }, [fetchMarkets])

  // Listen for new markets created on-chain
  const handleMarketCreated = useCallback((evt: MarketCreatedEvt) => {
    console.log('[markets] new market created:', evt)
    // Show toast notification
    setNewMarketToast(evt.title)
    // Auto-hide toast after 5 seconds
    setTimeout(() => setNewMarketToast(null), 5000)
    refreshMarkets()
  }, [refreshMarkets])

  useOnchainEvents({ onMarketCreated: handleMarketCreated })

  const filteredAndSortedMarkets = useMemo(() => {
    const selectedTagNormalized = selectedTag.toLowerCase()
    const selectedCategoryNormalized = selectedCategory.toLowerCase()
    const isLooseCategory = ['trending', 'breaking', 'new'].includes(selectedCategoryNormalized)
    const filtered = markets.filter(market => {
      const matchesSearch = market.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          market.description.toLowerCase().includes(searchQuery.toLowerCase())
      const marketCategory = (market.category || '').toLowerCase()
      const matchesCategory = selectedCategory === 'All' || isLooseCategory || marketCategory === selectedCategoryNormalized
      const matchesTag = selectedTag === 'All' || (Array.isArray(market.tags) && market.tags.some((tag) => tag.toLowerCase() === selectedTagNormalized))
      const matchesStatus = selectedStatus === 'All' || market.status === selectedStatus

      return matchesSearch && matchesCategory && matchesTag && matchesStatus
    })

    // Sort markets
    filtered.sort((a, b) => {
      const keyA = a.slug ?? a.id
      const keyB = b.slug ?? b.id
      const metricsA = metricsByMarket[keyA]
      const metricsB = metricsByMarket[keyB]

      switch (sortBy) {
        case 'volume': {
          const volA = metricsA ? parseFloat(metricsA.volume24hUSDF ?? '0') : parseFloat(a.totalVolume)
          const volB = metricsB ? parseFloat(metricsB.volume24hUSDF ?? '0') : parseFloat(b.totalVolume)
          return volB - volA
        }
        case 'ending-soon':
          return new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
        case 'newest':
          return new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
        case 'price': {
          const priceA = metricsA?.spot ? parseFloat(metricsA.spot.price) : 0
          const priceB = metricsB?.spot ? parseFloat(metricsB.spot.price) : 0
          return priceB - priceA
        }
        default:
          return 0
      }
    })

    return filtered
  }, [markets, searchQuery, selectedCategory, selectedTag, selectedStatus, sortBy, metricsByMarket])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Toast for new market */}
      {newMarketToast && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top duration-300">
          <div className="bg-[var(--primary-yellow)] text-black px-4 py-3 rounded-lg shadow-lg max-w-md">
            <div className="flex items-center gap-2">
              <span className="text-lg">🎉</span>
              <div>
                <p className="font-semibold text-sm">New market created!</p>
                <p className="text-xs opacity-90 line-clamp-1">{newMarketToast}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">
          Prediction Markets
        </h1>
        <p className="text-[var(--text-secondary)]">
          Trade on the outcome of future events
        </p>
      </div>

      {/* Search and Filters */}
      <div className="bg-[var(--card-background)] rounded-lg border border-[var(--border-color)] p-6 mb-8">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent text-white placeholder-[var(--text-muted)]"
            />
          </div>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2">
            {categories.map(category => (
              <button
                key={category}
                onClick={() => {
                  setSelectedCategory(category)
                  updateUrlFilters(category, selectedTag)
                }}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  selectedCategory === category
                    ? 'bg-[var(--primary-yellow)] text-black'
                    : 'bg-[var(--hover-background)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--border-color)]'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        {/* Additional Filters and Sort */}
        <div className="flex flex-col sm:flex-row gap-4 mt-4 pt-4 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--text-muted)]" />
            <label htmlFor="status-filter" className="sr-only">Filter by status</label>
            <select
              id="status-filter"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)]"
            >
              <option value="All">All Status</option>
              <option value="active">Active</option>
              <option value="resolved">Resolved</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[var(--text-muted)]" />
            <label htmlFor="tag-filter" className="sr-only">Filter by tag</label>
            <select
              id="tag-filter"
              value={selectedTag}
              onChange={(e) => {
                const next = e.target.value
                setSelectedTag(next)
                updateUrlFilters(selectedCategory, next)
              }}
              className="px-3 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)]"
            >
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[var(--text-muted)]" />
            <label htmlFor="sort-filter" className="sr-only">Sort markets</label>
            <select
              id="sort-filter"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)]"
            >
              <option value="volume">Volume</option>
              <option value="newest">Newest</option>
              <option value="ending-soon">Ending Soon</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Failed to load markets: {error}
        </div>
      )}

      {loading && (
        <div className="mb-6 text-[var(--text-secondary)] text-sm">
          Loading markets…
        </div>
      )}

      {/* Market Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedMarkets.map((market) => {
          const key = market.slug ?? market.id
          return (
            <MarketTile
              key={key}
              market={market}
              metrics={metricsByMarket[key]}
              candles={candlesByMarket[key]}
            />
          )
        })}
      </div>

      {!loading && filteredAndSortedMarkets.length === 0 && (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-[var(--card-background)] border border-[var(--border-color)] rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-[var(--text-muted)]" />
          </div>
          <h3 className="text-lg font-medium text-white mb-2">
            No markets found
          </h3>
          <p className="text-[var(--text-secondary)]">
            Try adjusting your search or filter criteria
          </p>
        </div>
      )}
    </div>
  )
}

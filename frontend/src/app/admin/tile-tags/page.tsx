'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Settings, X, Plus, Copy } from 'lucide-react'
import { heroShowcaseMarkets, type HeroMarket } from '@/data/heroShowcaseMarkets'
import { fetchJSON, ApiRequestError } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'
import { useTileBackgrounds } from '@/hooks/useTileBackgrounds'
import { useMarkets } from '@/hooks/useApi'
import AdminNav from '@/components/AdminNav'
import {
  pickHeroBackground,
  buildHeroBackgroundStyle,
  buildHeroMarketLookup,
  resolveHeroImageAsset,
} from '@/utils/heroMarketPresentation'

const buildTileKey = (market: HeroMarket, index: number) => market.slug ?? String(index + 1)

type EditableHeroMarket = HeroMarket & { key: string }

const buildEditableMarkets = (): EditableHeroMarket[] =>
  heroShowcaseMarkets.map((market, index) => ({
    ...market,
    key: buildTileKey(market, index),
    tags: [...market.tags],
  }))

export default function AdminTileTagsPage() {
  const router = useRouter()
  const { data: tileBackgrounds } = useTileBackgrounds()
  const { data: liveMarkets } = useMarkets()

  const [authChecking, setAuthChecking] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [markets, setMarkets] = useState<EditableHeroMarket[]>(() => buildEditableMarkets())
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({})
  const [copyKey, setCopyKey] = useState<string | null>(null)

  const heroMarketLookup = useMemo(() => buildHeroMarketLookup(liveMarkets), [liveMarkets])
  const sourceLookup = useMemo(() => {
    const map = new Map<string, HeroMarket>()
    heroShowcaseMarkets.forEach((market, index) => {
      map.set(buildTileKey(market, index), market)
    })
    return map
  }, [])

  // Persist a deduped list of edited tags (plus categories) to localStorage
  // so the Tile Backgrounds page can suggest them immediately.
  useEffect(() => {
    try {
      const seen = new Map<string, string>()
      const norm = (v?: string | null) => (v ?? '').trim().toLowerCase()

      const add = (v?: string | null) => {
        if (!v) return
        const n = norm(v)
        if (!n) return
        if (!seen.has(n)) seen.set(n, v.trim())
      }

      for (const m of markets) {
        add(m.category)
        if (Array.isArray(m.tags)) {
          for (const t of m.tags) add(t)
        }
      }

      const labels = Array.from(seen.values())
      if (typeof window !== 'undefined') {
        localStorage.setItem('caifu:admin:tile-tags:suggestions', JSON.stringify(labels))
      }
    } catch {
      // no-op: suggestions cache is best-effort only
    }
  }, [markets])

  useEffect(() => {
    let cancelled = false
    const verify = async () => {
      try {
        await fetchJSON(`${API_BASE}/api/admin/me`)
        if (!cancelled) {
          setAuthError(null)
          setAuthChecking(false)
        }
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiRequestError && error.status === 401) {
          router.replace('/admin/login')
          return
        }
        setAuthError(error instanceof Error ? error.message : 'Failed to verify admin session')
        setAuthChecking(false)
      }
    }

    verify()
    return () => {
      cancelled = true
    }
  }, [router])

  const toggleFlip = (key: string, next?: boolean) => {
    setFlippedCards((prev) => ({
      ...prev,
      [key]: typeof next === 'boolean' ? next : !prev[key],
    }))
  }

  const updateTags = (marketKey: string, updater: (tags: string[]) => string[]) => {
    setMarkets((prev) =>
      prev.map((market) =>
        market.key === marketKey
          ? {
              ...market,
              tags: updater(market.tags),
            }
          : market
      )
    )
  }

  const handleTagChange = (marketKey: string, index: number, value: string) => {
    updateTags(marketKey, (tags) => tags.map((tag, idx) => (idx === index ? value : tag)))
  }

  const handleAddTag = (marketKey: string) => {
    updateTags(marketKey, (tags) => [...tags, ''])
  }

  const handleRemoveTag = (marketKey: string, index: number) => {
    updateTags(marketKey, (tags) => tags.filter((_, idx) => idx !== index))
  }

  const handleResetTags = (marketKey: string) => {
    const source = sourceLookup.get(marketKey)
    if (!source) return
    setMarkets((prev) =>
      prev.map((market) =>
        market.key === marketKey
          ? {
              ...market,
              tags: [...source.tags],
            }
          : market
      )
    )
  }

  const handleCopyTags = async (market: EditableHeroMarket) => {
    const normalizedTags = market.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
    const payload = JSON.stringify(normalizedTags, null, 2)

    try {
      if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload)
      } else {
        throw new Error('Clipboard API unavailable')
      }
    } catch (error) {
      if (typeof window !== 'undefined') {
        window.prompt('Copy tags JSON', payload)
      }
      if (process.env.NODE_ENV !== 'production') {
        console.warn('Failed to copy tile tags to clipboard', error)
      }
    }

    setCopyKey(market.key)
    setTimeout(() => {
      setCopyKey((current) => (current === market.key ? null : current))
    }, 1800)
  }

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <p className="text-sm text-[var(--text-secondary)]">Verifying admin session…</p>
      </div>
    )
  }

  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-6">
        <div className="max-w-md text-center space-y-3">
          <p className="text-lg font-semibold text-white">Unable to load tile tags</p>
          <p className="text-sm text-[var(--text-secondary)]">{authError}</p>
          <button
            onClick={() => router.replace('/admin/login')}
            className="px-4 py-2 rounded-full bg-white/10 text-sm text-white hover:bg-white/20 transition"
          >
            Go to admin login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--background)] py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <AdminNav />

        <header className="mb-8 flex flex-col gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-[var(--text-secondary)]">Admin</p>
            <h1 className="text-3xl font-bold text-white">Tile Tags Workbench</h1>
          </div>
          <p className="text-[var(--text-secondary)] text-sm sm:text-base max-w-3xl">
            Inspect the promotional tiles exactly as they appear on the homepage. Use the gearbox to flip a tile
            and edit its tags before syncing updates to <code className="font-mono text-xs text-[var(--primary-yellow)]">heroShowcaseMarkets.ts</code>.
          </p>
        </header>

        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {markets.map((market, index) => {
            const heroImage = resolveHeroImageAsset(market, index, heroMarketLookup)
            const background = heroImage ? null : pickHeroBackground(market, tileBackgrounds)
            const cardStyle = buildHeroBackgroundStyle(heroImage ?? background?.imageUrl)
            const isFlipped = Boolean(flippedCards[market.key])
            const trimmedTags = market.tags.map((tag) => tag.trim()).filter(Boolean)

            return (
              <div key={market.key} className="relative" style={{ perspective: '1600px', minHeight: '320px' }}>
                <div
                  className="relative h-full w-full"
                  style={{
                    transformStyle: 'preserve-3d',
                    transition: 'transform 0.6s ease',
                    transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  }}
                >
                  <div
                    className="market-card absolute inset-0 flex flex-col pt-3"
                    data-has-bg={heroImage || background ? 'true' : 'false'}
                    data-has-hero={heroImage ? 'true' : 'false'}
                    style={{
                      ...cardStyle,
                      backfaceVisibility: 'hidden',
                      borderRadius: '20px',
                    }}
                  >
                    <button
                      className="absolute top-3 right-3 p-2 rounded-full bg-black/40 backdrop-blur hover:bg-black/60 transition"
                      onClick={() => toggleFlip(market.key, true)}
                      aria-label="Edit tile tags"
                    >
                      <Settings className="w-4 h-4 text-white" />
                    </button>

                    <div className="flex items-center px-3 mb-2">
                      <div className="w-8 h-8 min-w-8 bg-gradient-to-br from-[var(--hover-background)] to-[var(--card-background)] rounded flex items-center justify-center text-lg shadow-md">
                        {market.image}
                      </div>
                    </div>

                    <div className="px-3 mb-3">
                      <h3 className="text-sm font-semibold text-white line-clamp-2 leading-[20px]">
                        <span className="text-contrast-overlay">{market.title}</span>
                      </h3>
                      <p className="text-[11px] text-[var(--text-muted)] mt-1 uppercase tracking-wide">
                        {market.category}
                      </p>
                    </div>

                    <div className="px-3 mb-3 flex-1">
                      <div className="space-y-2">
                        {market.outcomes.map((outcome) => (
                          <div
                            key={outcome.name}
                            className="flex items-center justify-between text-xs hover:bg-[var(--hover-background)]/20 p-1 rounded"
                          >
                            <span className="text-white font-medium truncate mr-2 text-contrast-overlay">{outcome.name}</span>
                            <span className="font-bold text-white text-contrast-overlay">
                              {Math.round(outcome.price * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="px-3 pb-3 mt-auto border-t border-[var(--border-color)]/50 pt-2">
                      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-white text-contrast-overlay">${market.volume}</span>
                          <span>Vol.</span>
                        </div>
                        <div className="flex items-center space-x-2 text-[10px] uppercase tracking-[0.2em]">
                          <span className="text-[var(--text-secondary)]">Tags</span>
                          <span className="text-white">{trimmedTags.length}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    className="market-card absolute inset-0 p-4 flex flex-col gap-4"
                    style={{
                      ...cardStyle,
                      backfaceVisibility: 'hidden',
                      borderRadius: '20px',
                      transform: 'rotateY(180deg)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wide">Editing</p>
                        <h3 className="text-base font-semibold text-white leading-tight">{market.title}</h3>
                        {market.slug && (
                          <p className="text-[11px] text-[var(--text-muted)]">slug: {market.slug}</p>
                        )}
                      </div>
                      <button
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition"
                        onClick={() => toggleFlip(market.key, false)}
                        aria-label="Return to preview"
                      >
                        <X className="w-4 h-4 text-white" />
                      </button>
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {market.tags.length === 0 && (
                        <p className="text-sm text-[var(--text-muted)]">No tags yet – add one below.</p>
                      )}
                      {market.tags.map((tag, tagIndex) => (
                        <div key={`${market.key}-tag-${tagIndex}`} className="flex items-center gap-2">
                          <input
                            value={tag}
                            onChange={(event) => handleTagChange(market.key, tagIndex, event.target.value)}
                            className="flex-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--primary-yellow)]"
                            placeholder="Enter tag"
                          />
                          <button
                            onClick={() => handleRemoveTag(market.key, tagIndex)}
                            className="px-2 py-1 rounded-lg text-xs bg-red-500/20 text-red-200 hover:bg-red-500/30"
                            aria-label="Remove tag"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleAddTag(market.key)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/10 text-xs font-semibold text-white hover:bg-white/20 transition"
                      >
                        <Plus className="w-3 h-3" /> Add Tag
                      </button>
                      <button
                        onClick={() => handleResetTags(market.key)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-black/30 text-xs font-semibold text-white hover:bg-black/50 transition"
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => handleCopyTags(market)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[var(--primary-yellow)] text-xs font-semibold text-black hover:bg-yellow-300 transition"
                      >
                        <Copy className="w-3 h-3" /> {copyKey === market.key ? 'Copied!' : 'Copy tags JSON'}
                      </button>
                    </div>

                    <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                      Updated tags persist locally only. Paste the copied array back into <code className="font-mono text-[10px]">heroShowcaseMarkets</code> and commit the change.
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

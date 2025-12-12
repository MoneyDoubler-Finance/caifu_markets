import type { CSSProperties } from 'react'
import type { HeroMarket } from '@/data/heroShowcaseMarkets'
import type { TileBackground } from '@/types'
import { toAbsoluteMediaUrl, optimizeViaShortPixelIfEnabled } from '@/utils/media'

const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() ?? ''

export const collectHeroLabels = (market: HeroMarket) => {
  const labels = new Set<string>()
  const category = normalize(market.category)
  if (category) labels.add(category)
  for (const tag of market.tags) {
    const normalized = normalize(tag)
    if (normalized) labels.add(normalized)
  }
  return Array.from(labels)
}

export const pickHeroBackground = (
  market: HeroMarket,
  backgrounds: TileBackground[] | undefined
) => {
  if (!backgrounds || backgrounds.length === 0) return null
  const labels = collectHeroLabels(market)
  if (labels.length === 0) return null
  return backgrounds.find((background) => labels.includes(background.normalizedTag)) ?? null
}

export const buildHeroBackgroundStyle = (imageUrl: string | null | undefined): CSSProperties | undefined => {
  // Default to a conservative width suitable for a grid card; the CDN will deliver
  // AVIF/WebP automatically and scale as needed.
  const resolved = optimizeViaShortPixelIfEnabled(imageUrl, 720) || toAbsoluteMediaUrl(imageUrl)
  if (!resolved) return undefined
  const overlay = 'rgba(6, 10, 18, 0.82)'
  return {
    backgroundImage: `linear-gradient(180deg, ${overlay} 0%, rgba(8, 12, 20, 0.9) 55%, rgba(6, 10, 16, 0.95) 100%), url(${resolved})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundBlendMode: 'overlay',
  }
}

type MarketLike = {
  slug?: string | null
  id?: string | null
  heroImageUrl?: string | null
}

const isMarketLike = (value: unknown): value is MarketLike => {
  return Boolean(value) && typeof value === 'object'
}

export const buildHeroMarketLookup = (markets: unknown): Map<string, MarketLike> => {
  const map = new Map<string, MarketLike>()
  if (!Array.isArray(markets)) return map

  for (const entry of markets) {
    if (!isMarketLike(entry)) continue
    const slug = typeof entry.slug === 'string' ? entry.slug.trim().toLowerCase() : ''
    if (slug) {
      map.set(slug, entry)
    }
    const id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : ''
    if (id) {
      map.set(id, entry)
    }
  }

  return map
}

export const resolveHeroImageAsset = (
  market: HeroMarket,
  index: number,
  lookup: Map<string, MarketLike>
) => {
  const keys: string[] = []
  if (typeof market.slug === 'string' && market.slug.trim().length > 0) {
    keys.push(market.slug.trim())
  }
  if (!market.slug) {
    keys.push(String(index + 1))
  }

  for (const key of keys) {
    const normalized = key.trim().toLowerCase()
    if (!normalized) continue
    const candidate = lookup.get(normalized)
    if (candidate && typeof candidate.heroImageUrl === 'string' && candidate.heroImageUrl.trim().length > 0) {
      return toAbsoluteMediaUrl(candidate.heroImageUrl.trim()) ?? null
    }
  }

  return toAbsoluteMediaUrl(market.heroImageUrl) ?? null
}

"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Newspaper } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import Link from 'next/link';
import { usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { useMarkets } from '@/hooks/useApi';
import type { MarketResponse } from '@caifu/types';
import { toAbsoluteMediaUrl } from '@/utils/media';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useOnchainEvents } from '@/hooks/useOnchainEvents';
import { fetchJSON } from '@/lib/api';
import { TARGET_CHAIN_ID, CONTRACT_ADDRESSES } from '@/lib/web3';
import { getOutcomePositionId, CTF_ABI } from '@/lib/amm';
import { heroShowcaseMarkets, FEATURED_MARKET_SLUGS, CAIFU_PICKS_SLUGS } from '@/data/heroShowcaseMarkets';

interface Outcome {
  name: string;
  price: number;
  change: number;
  color: string;
  data: Array<{ time: string; price: number }>;
}

interface LiveMarket {
  id: string;
  slug?: string;
  title: string;
  image: string;
  fpmmAddress?: string | null;
  conditionId?: string | null;
  outcomes: Outcome[];
  volume: string;
  volumeChanges: string[];
  news: {
    title: string;
    description: string;
  };
  category: string;
  heroImageUrl?: string | null;
  hasLive?: boolean;
}

const MAX_POINTS = 90;
const SEED_POINTS = 30;
const spotSeriesCache = new Map<string, Array<{ time: string; price: number }>>();

const LIVE_MARKETS: LiveMarket[] = [];

const clampPrice = (value: number) => {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0.01, Math.min(0.99, value));
};

const formatTimeLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Softly glide the tail of a series toward the target price so the real spot
// doesn't appear as a jarring vertical spike on the mini chart.
const appendPoint = (
  series: Array<{ time: string; price: number }>,
  price: number,
  timestampMs: number
) => {
  const point = { time: formatTimeLabel(timestampMs), price: clampPrice(price) };
  if (!Array.isArray(series) || series.length === 0) return [point];
  const last = series[series.length - 1];
  if (last && last.time === point.time) {
    const next = [...series.slice(0, -1), point];
    return next.slice(-MAX_POINTS);
  }
  return [...series, point].slice(-MAX_POINTS);
};

// Deterministic seed series (flat line) used only until real spot series arrives
const buildSeedSeries = (seedBase = 0.5) => {
  const now = Date.now();
  return Array.from({ length: SEED_POINTS }, (_, i) => {
    const ts = now - (SEED_POINTS - 1 - i) * 30_000; // backfill 30s apart
    return { time: formatTimeLabel(ts), price: clampPrice(seedBase) };
  });
};

const marketCacheKey = (m?: { id?: string; slug?: string | null }) =>
  (m?.id ?? '').toString() || (m?.slug && m.slug.trim()) || '';

export default function LiveMarketCard() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeOutcomes, setActiveOutcomes] = useState<Record<string, boolean>>({});
  const [markets, setMarkets] = useState<LiveMarket[]>(LIVE_MARKETS);
  const metricsCache = useRef<Map<string, { price: number; updatedAt: number | null }>>(new Map());
  const lastMetricsFetch = useRef<Map<string, number>>(new Map());
  const currentMarketKeyRef = useRef<string | null>(null);
  
  // Fetch real markets from API
  const { data: apiMarkets } = useMarkets();
  const isMobile = useIsMobile(1024);
  const fallbackMarkets: LiveMarket[] = useMemo(() => {
    if (!Array.isArray(heroShowcaseMarkets) || heroShowcaseMarkets.length === 0) return [];
    return heroShowcaseMarkets.map((m, idx) => ({
      id: m.slug || `hero-${idx + 1}`,
      slug: m.slug,
      title: m.title,
      image: m.image,
      outcomes: m.outcomes.map((o, i) => ({
        ...o,
        data: [],
        color: i === 0 ? '#10b981' : '#ef4444',
      })),
      volume: m.volume,
      volumeChanges: [],
      news: { title: m.title, description: m.tags.join(', ') || 'Featured market' },
      category: m.category,
      heroImageUrl: m.heroImageUrl ?? null,
      fpmmAddress: null,
      conditionId: null,
      hasLive: false,
    }));
  }, []);

  const displayMarkets = markets.length > 0 ? markets : fallbackMarkets;

  const safeIndex = displayMarkets.length > 0 ? Math.min(currentIndex, displayMarkets.length - 1) : 0;
  const currentMarket = displayMarkets[safeIndex];
  const currentMarketKey = currentMarket?.id?.toString?.() || currentMarket?.slug || null;

  useEffect(() => {
    currentMarketKeyRef.current = currentMarketKey;
  }, [currentMarketKey]);

  // If markets not hydrated yet, render a lightweight placeholder to keep layout stable
  if (!currentMarket) {
    return null;
  }

  const applySpotPriceToMarket = useCallback(
    (market: LiveMarket, yesPrice: number, updatedAtMs?: number): LiveMarket => {
      const ts = Number.isFinite(updatedAtMs) ? updatedAtMs! : Date.now();
      const cacheKey = marketCacheKey(market);

      const outcomes = market.outcomes.map((outcome, idx) => {
        const existingYesSeries =
          idx === 0
            ? spotSeriesCache.get(cacheKey)
            : null;
        const baseSeries = Array.isArray(outcome.data) ? [...outcome.data] : existingYesSeries || [];
        const name = outcome.name?.toLowerCase?.() ?? '';
        const isYes = name.includes('yes') || idx === 0;
        const isNo = name.includes('no') || idx === 1;
        const price = clampPrice(
          isYes
            ? yesPrice
            : isNo && market.outcomes.length >= 2
            ? 1 - yesPrice
            : yesPrice
        );

        const nextSeries = appendPoint(baseSeries, price, ts);
        const lastPrice = nextSeries[nextSeries.length - 1]?.price ?? price;
        const firstPrice = nextSeries[0]?.price ?? lastPrice;
        const change = parseFloat(((lastPrice - firstPrice) * 100).toFixed(1));

        return { ...outcome, data: nextSeries, price: lastPrice, change };
      });

      if (outcomes[0]) {
        // Cache YES series only; NO derived on render
        spotSeriesCache.set(cacheKey, outcomes[0].data);
      }

      return { ...market, outcomes, hasLive: true };
    },
    []
  );
  
  // Helper: map API markets (which return string[] outcomes) into LiveMarket shape expected by this component
  const mapApiToLiveMarket = useCallback((
    m: MarketResponse & { slug?: string | null },
    idx: number,
    previous?: LiveMarket
  ): LiveMarket => {
    const palette = ['#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#a855f7'];
    const priorOutcomes = new Map((previous?.outcomes || []).map((o) => [o.name, o]));
    const cacheKey = marketCacheKey({ id: m.id?.toString(), slug: m.slug });
    const yesSeriesCached = spotSeriesCache.get(cacheKey);
    const outcomes: Outcome[] = (Array.isArray(m?.outcomes) ? m.outcomes : ['Yes', 'No'])
      .slice(0, 5)
      .map((name: string, i: number) => {
        const paletteColor = palette[i % palette.length];
        const prior = priorOutcomes.get(name);
        const seedBase = 0.35 + ((i % 2 === 0) ? 0.15 : 0.05);
        const baseSeries = yesSeriesCached
          ? yesSeriesCached
          : prior?.data?.length
            ? prior.data
            : buildSeedSeries(seedBase);
        const isYes = name.toLowerCase?.().includes('yes') || i === 0;
        const series = isYes
          ? baseSeries
          : baseSeries.map((pt) => ({ time: pt.time, price: clampPrice(1 - pt.price) }));
        const latest = series[series.length - 1]?.price ?? seedBase;
        const first = series[0]?.price ?? latest;
        const change = parseFloat(((latest - first) * 100).toFixed(1));

        return {
          name,
          price: latest,
          change,
          color: paletteColor,
          data: series,
        };
      });
    const slug = typeof m.slug === 'string' && m.slug.trim().length > 0
      ? m.slug.trim()
      : m.id?.toString() || String(idx + 1)
    const category =
      typeof m.category === 'string' && m.category.trim().length > 0
        ? m.category
        : 'General'

    const rawHero =
      typeof (m as any).heroImageUrl === 'string' && (m as any).heroImageUrl.trim().length > 0
        ? (m as any).heroImageUrl.trim()
        : null
    const heroImageUrl = toAbsoluteMediaUrl(rawHero)

    return {
      id: m.id?.toString() || String(idx + 1),
      slug,
      title: m.title || 'Market',
      image: '📈',
      fpmmAddress: m.fpmmAddress ?? (m as any)?.fpmm_address ?? null,
      conditionId: (m as any)?.conditionId ?? (m as any)?.condition_id ?? null,
      outcomes,
      volume: '$0', // API doesn't provide volume yet
      volumeChanges: [],
      news: {
        title: m.title || 'Market update',
        description: 'Live data coming soon.',
      },
      category,
      heroImageUrl,
      hasLive: previous?.hasLive ?? false,
    } as LiveMarket;
  }, []);

  // Prefer API markets but keep seeded data and any live points we already drew
  // Filter out markets that already have dedicated hero tiles on the homepage grid
  useEffect(() => {
    if (Array.isArray(apiMarkets) && apiMarkets.length > 0) {
      // Exclude markets that have hero tiles or appear in Caifu Picks to avoid duplicates
      const filteredMarkets = apiMarkets.filter(m => {
        const slug = typeof m.slug === 'string' ? m.slug : '';
        return !FEATURED_MARKET_SLUGS.includes(slug) && !CAIFU_PICKS_SLUGS.includes(slug);
      });

      setMarkets((prev) => {
        const prevById = new Map(prev.map((m) => [m.id, m]));
        return filteredMarkets.map((m, idx) => {
          const prevMatch = prevById.get(m.id?.toString() || '')
            || prev.find((p) => p.slug && p.slug === m.slug);
          return mapApiToLiveMarket(m, idx, prevMatch as LiveMarket | undefined);
        });
      });
    } else {
      setMarkets((prev) => (prev.length > 0 ? prev : LIVE_MARKETS));
    }
  }, [apiMarkets, mapApiToLiveMarket]);

  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });

  const loadSpotSeries = useCallback(
    async (marketKey: string) => {
      if (!marketKey) return;
      if (spotSeriesCache.has(marketKey)) return;
      try {
        const payload = await fetchJSON<any[]>(
          `/api/markets/${encodeURIComponent(marketKey)}/spot-series?limit=${MAX_POINTS}`
        );
        if (!Array.isArray(payload) || payload.length === 0) return;

        const yesSeries = payload
          .map((p) => {
            const iso = typeof p.t === 'string' ? p.t : null;
            const tsMs = iso ? Date.parse(iso) : Date.now();
            const priceRaw =
              typeof p.yes === 'string'
                ? parseFloat(p.yes)
                : typeof p.yes === 'number'
                ? p.yes
                : typeof p.price === 'number'
                ? p.price
                : typeof p.price === 'string'
                ? parseFloat(p.price)
                : null;
            if (!Number.isFinite(priceRaw)) return null;
            return { time: formatTimeLabel(tsMs), price: clampPrice(priceRaw) };
          })
          .filter(Boolean) as Array<{ time: string; price: number }>;

        if (yesSeries.length === 0) return;
        let trimmed = yesSeries.slice(-MAX_POINTS);
        if (trimmed.length < 2) {
          const basePrice = trimmed[0]?.price ?? 0.5;
          const baseTime = trimmed[0]?.time ?? formatTimeLabel(Date.now() - 60_000);
          // Prepend a baseline point to avoid single-point red tails
          trimmed = [{ time: baseTime, price: basePrice }, ...trimmed];
        }
        spotSeriesCache.set(marketKey, trimmed);

        setMarkets((prev) =>
          prev.map((m) => {
            if (m.id !== marketKey && m.slug !== marketKey) return m;
            const outcomes = m.outcomes.map((outcome, idx) => {
              const series = idx === 0
                ? trimmed
                : trimmed.map((pt) => ({ time: pt.time, price: clampPrice(1 - pt.price) }));
              const last = series[series.length - 1]?.price ?? outcome.price;
              const first = series[0]?.price ?? last;
              const change = parseFloat(((last - first) * 100).toFixed(1));
              return { ...outcome, data: series, price: last, change };
            });
            return { ...m, outcomes, hasLive: true };
          })
        );
      } catch (err) {
        console.warn('[LiveMarketCard] loadSpotSeries failed', err);
      }
    },
    []
  );

  const refreshMarketSpot = useCallback(
    async (marketKey: string, target?: LiveMarket, hintTs?: number) => {
      if (!marketKey) return null;
      if (!publicClient) return null;

      // Only fetch for the currently visible tile
      if (currentMarketKeyRef.current && marketKey !== currentMarketKeyRef.current) return;

      const now = Date.now();
      const last = lastMetricsFetch.current.get(marketKey) ?? 0;
      if (now - last < 5000) return; // throttle to ~5s
      lastMetricsFetch.current.set(marketKey, now);

      const cached = metricsCache.current.get(marketKey);

      const targetMarket =
        target ||
        markets.find((m) => m.id === marketKey || m.slug === marketKey);

      if (
        !targetMarket ||
        !targetMarket.fpmmAddress ||
        !targetMarket.conditionId ||
        !CONTRACT_ADDRESSES.conditionalTokens ||
        !CONTRACT_ADDRESSES.usdf
      ) {
        return null;
      }

      // Sanity check: if the public client is still pointed at the wrong chain,
      // bail out instead of throwing a confusing zero‑data error.
      try {
        const clientChainId = await publicClient.getChainId();
        if (clientChainId !== TARGET_CHAIN_ID) {
          console.warn('[LiveMarketCard] chain mismatch', {
            clientChainId,
            targetChainId: TARGET_CHAIN_ID,
          });
          return null;
        }
      } catch {
        // If we cannot read chain ID, fall through and let the later call fail noisily.
      }

      try {
        const yesPosition = await getOutcomePositionId({
          publicClient,
          ctfAddress: CONTRACT_ADDRESSES.conditionalTokens,
          collateralToken: CONTRACT_ADDRESSES.usdf,
          conditionId: targetMarket.conditionId as `0x${string}`,
          outcomeIndex: 0,
        });
        const noPosition = await getOutcomePositionId({
          publicClient,
          ctfAddress: CONTRACT_ADDRESSES.conditionalTokens,
          collateralToken: CONTRACT_ADDRESSES.usdf,
          conditionId: targetMarket.conditionId as `0x${string}`,
          outcomeIndex: 1,
        });

        const [yesBal, noBal] = await Promise.all([
          publicClient.readContract({
            address: CONTRACT_ADDRESSES.conditionalTokens,
            abi: CTF_ABI,
            functionName: 'balanceOf',
            args: [targetMarket.fpmmAddress as `0x${string}`, yesPosition],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: CONTRACT_ADDRESSES.conditionalTokens,
            abi: CTF_ABI,
            functionName: 'balanceOf',
            args: [targetMarket.fpmmAddress as `0x${string}`, noPosition],
          }) as Promise<bigint>,
        ]);

        const yes = Number.parseFloat(formatUnits(yesBal, 18));
        const no = Number.parseFloat(formatUnits(noBal, 18));
        if (!Number.isFinite(yes) || !Number.isFinite(no) || yes + no <= 0) return;

        const yesPrice = clampPrice(no / (yes + no));
        const updatedAtMs = hintTs ?? now;

        if (cached && cached.updatedAt && updatedAtMs <= cached.updatedAt) return null;

        metricsCache.current.set(marketKey, {
          price: yesPrice,
          updatedAt: updatedAtMs,
        });

        setMarkets((prev) =>
          prev.map((m) =>
            (targetMarket && (m.id === targetMarket.id || m.slug === targetMarket.slug))
              ? applySpotPriceToMarket(m, yesPrice, updatedAtMs)
              : m
          )
        );

        return { price: yesPrice, updatedAtMs };
      } catch (err) {
        console.warn('[LiveMarketCard] on-chain spot fetch failed', err);
        return null;
      }
    },
    [applySpotPriceToMarket, markets, publicClient]
  );

  // Fetch live spot price for the current market and append it to the series tail once
  useEffect(() => {
    // Avoid hitting the API with synthetic ids before real markets have hydrated.
    if (!Array.isArray(apiMarkets) || apiMarkets.length === 0) return;

    const marketKey = marketCacheKey(currentMarket) || currentMarketKey;
    if (!marketKey) return;

    // Only load for markets that came from API (have fpmmAddress/conditionId)
    if (!currentMarket?.fpmmAddress || !currentMarket?.conditionId) return;

    loadSpotSeries(marketKey).catch(() => {});
    refreshMarketSpot(marketKey, currentMarket);
  }, [currentMarket, currentMarketKey, apiMarkets, refreshMarketSpot, loadSpotSeries]);

  const currentMarketOutcomeSignature = useMemo(() => {
    if (!Array.isArray(currentMarket?.outcomes)) return '';
    return currentMarket.outcomes.map((outcome) => outcome?.name ?? '').join('|');
  }, [currentMarket]);
  
  // Create unique outcomes array to prevent duplicate keys
  const uniqueOutcomes = Array.isArray(currentMarket?.outcomes)
    ? Array.from(new Set(currentMarket.outcomes.map(o => o?.name)))
        .map(name => currentMarket.outcomes.find(o => o?.name === name)!)
        .filter(Boolean)
    : [];

  // React to live trades by fetching fresh spot once per ~1.2s for the affected market
  useOnchainEvents({
    onTrade: async (evt) => {
      const marketId = evt?.marketId?.toString?.() ?? '';
      if (!marketId) return;

      // Only refresh if this trade is for the currently visible market
      if (currentMarketKeyRef.current && marketId !== currentMarketKeyRef.current) return;

      const target = markets.find((m) => m.id === marketId || m.slug === marketId);
      const res = await refreshMarketSpot(marketId, target, evt.timestamp ?? Date.now());
      if (res && target) {
        const { price, updatedAtMs } = res;
        setMarkets((prev) =>
          prev.map((m) =>
            (m.id === target.id || m.slug === target.slug)
              ? applySpotPriceToMarket(m, price, updatedAtMs ?? evt.timestamp ?? Date.now())
              : m
          )
        );
      }
    },
  });

  // Route aliasing: map specific IDs to desired route ids
  const routeKey = (() => {
    if (typeof currentMarket?.slug === 'string' && currentMarket.slug.trim()) {
      return currentMarket.slug.trim();
    }
    const idStr = String(currentMarket?.id ?? '').trim();
    if (idStr === '3') return '1';
    return idStr || '1';
  })();

  useEffect(() => {
    // Initialize all outcomes as active when market changes
    const initial: Record<string, boolean> = {};
    if (Array.isArray(currentMarket?.outcomes)) {
      currentMarket.outcomes.forEach(outcome => {
        if (outcome?.name) initial[outcome.name] = true;
      });
    }
    setActiveOutcomes(initial);
  }, [currentMarket?.id, currentMarketOutcomeSignature]);

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? Math.max(0, markets.length - 1) : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev === Math.max(0, markets.length - 1) ? 0 : prev + 1));
  };

  const toggleOutcome = (name: string) => {
    setActiveOutcomes(prev => ({
      ...prev,
      [name]: !prev[name],
    }));
  };

  // Merge all data points for the chart (defensive against undefined shapes)
  const mergedData = useMemo(() => {
    if (!Array.isArray(currentMarket?.outcomes) || currentMarket.outcomes.length === 0) return [];

    const longest = currentMarket.outcomes.reduce((max, outcome) => {
      const len = Array.isArray(outcome.data) ? outcome.data.length : 0;
      return Math.max(max, len);
    }, 0);

    if (longest === 0) return [];

    const seriesTime = (idx: number) => {
      for (const outcome of currentMarket.outcomes) {
        if (Array.isArray(outcome.data) && outcome.data[idx]?.time) {
          return outcome.data[idx]?.time as string;
        }
      }
      // Fallback to last known timestamp
      const fallbackOutcome = currentMarket.outcomes.find((o) => Array.isArray(o.data) && o.data.length > 0);
      const last = fallbackOutcome?.data?.[fallbackOutcome.data.length - 1]?.time;
      return last ?? '';
    };

    return Array.from({ length: longest }, (_, index) => {
      const dataPoint: Record<string, string | number> = { time: seriesTime(index) };
      currentMarket.outcomes.forEach((outcome) => {
        const key = outcome?.name ?? '';
        if (!key) return;

        const series = Array.isArray(outcome.data) ? outcome.data : [];
        const price = series[index]?.price ?? (series.length ? series[series.length - 1].price : outcome.price ?? 0);
        dataPoint[key] = price;
      });
      return dataPoint;
    });
  }, [currentMarket]);

  const heroBackgroundStyle = currentMarket?.heroImageUrl
    ? {
        backgroundImage: [
          'linear-gradient(180deg, rgba(6,10,18,0.52) 0%, rgba(6,10,18,0.68) 55%, rgba(6,10,18,0.78) 100%)',
          `url(${currentMarket.heroImageUrl})`,
        ].join(', '),
        backgroundSize: ['cover', '50% auto'].join(', '),
        backgroundPosition: ['center', 'left center'].join(', '),
        backgroundRepeat: ['no-repeat', 'no-repeat'].join(', '),
      }
    : undefined;

  const titleBackdropStyle = currentMarket?.heroImageUrl
    ? {
        backgroundImage: `linear-gradient(135deg, rgba(5,6,13,0.2), rgba(5,6,13,0.85)), url(${currentMarket.heroImageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined;

  const normalizedMarketTitle = (currentMarket?.title ?? '').trim().toLowerCase();
  const normalizedNewsTitle = (currentMarket?.news?.title ?? '').trim();
  const shouldShowNewsHeading =
    normalizedNewsTitle.length > 0 && normalizedNewsTitle.toLowerCase() !== normalizedMarketTitle;

  if (isMobile) {
    return (
      <section className="bg-[var(--background)] border-b border-[var(--border-color)] relative">
        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          <div
            className="relative rounded-3xl overflow-hidden border border-[var(--border-color)]/50"
            style={titleBackdropStyle}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
            <div className="relative z-10 p-5 space-y-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                <span className="glass-chip px-2 py-1">{currentMarket.category}</span>
                <span className="status-live">Live</span>
              </div>
              <h2 className="text-2xl font-bold text-white leading-tight">
                {currentMarket.title}
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">{currentMarket.news.title}</p>
            </div>
          </div>

          <div className="glass-card rounded-3xl p-4 space-y-4">
            <div className="space-y-3">
              {uniqueOutcomes.map((outcome, i) => {
                const outcomeName = outcome.name ?? `Outcome ${i + 1}`;
                const isYes = outcomeName.toLowerCase().includes('yes') || i === 0;
                const ctaLabel = isYes ? 'Buy Yes' : 'Buy No';

                return (
                  <div
                    key={`mobile-outcome-${currentMarket.id}-${outcomeName}-${i}`}
                    className="flex items-center gap-3 bg-[var(--hover-background)]/30 rounded-2xl px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => toggleOutcome(outcome.name)}
                        className="w-3 h-3 rounded-full border-2"
                        style={{
                          backgroundColor: activeOutcomes[outcomeName] ? outcome.color : 'transparent',
                          borderColor: outcome.color,
                        }}
                        aria-label={`Toggle ${outcomeName} visibility on chart`}
                      />
                      <span className="text-white text-sm font-medium truncate">
                        {outcomeName}
                      </span>
                    </div>
                    <div className="flex flex-1 justify-center">
                      <Link
                        href={`/markets/${routeKey}`}
                        className={`px-6 py-1.5 text-[11px] rounded-full border border-[var(--border-color)] uppercase tracking-wide text-center min-w-[130px] ${
                          isYes ? 'bg-[var(--primary-yellow)] text-black' : 'bg-transparent text-white'
                        }`}
                      >
                        {ctaLabel}
                      </Link>
                    </div>
                    <div className="text-right ml-auto">
                      <p className="text-white text-lg font-semibold">{Math.round(outcome.price * 100)}%</p>
                      <p className={`text-xs ${outcome.change >= 0 ? 'price-up' : 'price-down'}`}>
                        {outcome.change >= 0 ? '+' : ''}{outcome.change}%
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="relative rounded-3xl border border-[var(--border-color)]/60 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary-yellow)]/5 via-transparent to-[var(--accent-purple)]/10" />
              <div className="absolute inset-0 opacity-20">
                <svg width="100%" height="100%" className="absolute inset-0">
                  <defs>
                    <pattern id="mobile-grid" width="36" height="36" patternUnits="userSpaceOnUse">
                      <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(255, 208, 0, 0.15)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#mobile-grid)" />
                </svg>
              </div>
              <div className="relative z-10 h-56 p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mergedData} margin={{ top: 10, right: 20, left: -10, bottom: 10 }}>
                    <XAxis
                      dataKey="time"
                      stroke="#ffffff"
                      tick={{ fill: '#ffffff', fontSize: 10, fontWeight: 'bold' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      tickFormatter={(value, index) => (index % 5 === 0 ? value : '')}
                    />
                    <YAxis
                      stroke="#ffffff"
                      tick={{ fill: '#ffffff', fontSize: 10, fontWeight: 'bold' }}
                      tickLine={false}
                      axisLine={false}
                      domain={[0, 1]}
                      tickFormatter={(value) => `${Math.round(value * 100)}%`}
                      ticks={[0, 0.5, 1]}
                    />
                    {uniqueOutcomes.map((outcome, i) => (
                      <Line
                        key={`mobile-chart-${currentMarket.id}-${outcome.name ?? outcome}-${i}`}
                        type="monotone"
                        dataKey={outcome.name ?? outcome}
                        stroke={outcome.color}
                        strokeWidth={3}
                        dot={false}
                        isAnimationActive={false}
                        style={{ filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.3))' }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-color)]/60 bg-[var(--hover-background)]/40 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Newspaper className="w-4 h-4" />
                News
              </div>
              {shouldShowNewsHeading && (
                <p className="text-white text-sm font-semibold">{currentMarket.news.title}</p>
              )}
              <p className="text-[var(--text-secondary)] text-xs">
                {currentMarket.news.description}
              </p>
            </div>

            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>{currentMarket.volume}</span>
              <div className="flex items-center gap-3">
                <button onClick={handlePrevious} aria-label="Previous market" className="p-2 rounded-full bg-[var(--hover-background)]">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  {markets.map((_, index) => (
                    <button
                      key={`mobile-dot-${index}`}
                      onClick={() => setCurrentIndex(index)}
                      className={`h-2 rounded-full transition-all ${
                        index === currentIndex ? 'bg-white w-6' : 'bg-[var(--text-muted)] w-2'
                      }`}
                    />
                  ))}
                </div>
                <button onClick={handleNext} aria-label="Next market" className="p-2 rounded-full bg-[var(--hover-background)]">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-[var(--background)] border-b border-[var(--border-color)] relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="glass-card rounded-xl overflow-hidden relative group" style={heroBackgroundStyle} data-hero={currentMarket?.heroImageUrl ? 'true' : 'false'}>
          {/* Animated border gradient */}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-[var(--primary-yellow)] via-[var(--accent-purple)] to-[var(--accent-cyan)] opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500"></div>

          {/* Liquid glass overlay */}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-[var(--primary-yellow)]/10 via-transparent to-[var(--primary-yellow)]/5 opacity-40"></div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 relative z-10">
            {/* Left Side - Market Info */}
            <div className="flex flex-col">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-16 h-16 bg-gradient-to-br from-[var(--hover-background)] to-[var(--card-background)] rounded-lg flex items-center justify-center text-3xl flex-shrink-0 shadow-lg float">
                  {currentMarket.image}
                </div>
                <div className="flex-1">
                  <Link href={`/markets/${routeKey}`}>
                    <h2 className="text-xl font-bold text-white mb-2 hover:gradient-text transition-all duration-300 cursor-pointer">
                      {currentMarket.title}
                    </h2>
                  </Link>
                  <span className="status-live text-xs font-bold">
                    <span className="w-2 h-2 rounded-full dot"></span>
                    LIVE
                  </span>
                </div>
              </div>

              {/* Outcomes */}
              <div className="space-y-3 mb-6">
                {uniqueOutcomes.map((outcome, i) => (
                  <div
                    key={`outcome-${currentMarket.id}-${outcome.name ?? outcome}-${i}`}
                    className="flex items-center justify-between group/outcome hover:bg-[var(--hover-background)]/30 p-2 rounded-lg transition-all duration-300"
                  >
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleOutcome(outcome.name)}
                        className="w-3 h-3 rounded-full border-2 transition-all hover:scale-125"
                        style={{
                          backgroundColor: activeOutcomes[outcome.name] ? outcome.color : 'transparent',
                          borderColor: outcome.color,
                          boxShadow: activeOutcomes[outcome.name] ? `0 0 10px ${outcome.color}` : 'none',
                        }}
                        aria-label={`Toggle ${outcome.name} visibility on chart`}
                        title={`Toggle ${outcome.name} visibility on chart`}
                      />
                      <span className="text-white font-medium">{outcome.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold text-lg">{Math.round(outcome.price * 100)}%</span>
                      <span
                        className={`text-sm font-bold ${
                          outcome.change >= 0 ? 'price-up' : 'price-down'
                        }`}
                      >
                        {outcome.change >= 0 ? '+' : ''}
                        {outcome.change}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Buttons - Link to market detail page for trading */}
              <div className="flex gap-3 mb-6">
                <Link href={`/markets/${routeKey}`} className="flex-1">
                  <span className="btn-neon w-full inline-flex justify-center items-center text-black font-bold py-3 px-6 rounded-lg">
                    Buy Yes
                  </span>
                </Link>
                <Link href={`/markets/${routeKey}`} className="flex-1">
                  <span className="w-full inline-flex justify-center items-center bg-gradient-to-r from-[var(--hover-background)] to-[var(--card-background)] hover:from-[var(--border-color)] hover:to-[var(--hover-background)] text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 border border-[var(--border-color)] hover:border-[var(--text-secondary)] hover:shadow-lg">
                    Buy No
                  </span>
                </Link>
              </div>

              {/* News */}
              <div className="border-t border-[var(--border-color)] pt-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-xs text-[var(--text-muted)] mb-1">News</p>
                    <h4 className="text-sm font-semibold text-white mb-1">{currentMarket.news.title}</h4>
                    <p className="text-xs text-[var(--text-secondary)]">{currentMarket.news.description}</p>
                  </div>
                  <span className="text-lg">➕</span>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-[var(--text-muted)] font-medium">{currentMarket.volume}</span>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={handlePrevious}
                      className="p-1 hover:bg-[var(--hover-background)] rounded transition-colors"
                      aria-label="Previous market"
                    >
                      <ChevronLeft className="w-4 h-4 text-[var(--text-secondary)]" />
                    </button>

                    {/* Pagination Dots */}
                    <div className="flex items-center gap-2">
                      {markets.map((_, index) => (
                        <button
                          key={index}
                          onClick={() => setCurrentIndex(index)}
                          className={`w-2 h-2 rounded-full transition-all ${
                            index === currentIndex
                              ? 'bg-white w-6'
                              : 'bg-[var(--text-muted)]'
                          }`}
                          aria-label={`Go to market ${index + 1}`}
                        />
                      ))}
                    </div>

                    <button
                      onClick={handleNext}
                      className="p-1 hover:bg-[var(--hover-background)] rounded transition-colors"
                      aria-label="Next market"
                    >
                      <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Side - Chart */}
            <div className="flex flex-col">
              <div className="flex-1 min-h-[300px] relative glass-card rounded-lg p-4">
                {/* Liquid glass effect behind chart */}
                <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary-yellow)]/6 via-[var(--primary-yellow)]/2 to-[var(--primary-yellow)]/4 rounded-lg"></div>

                {/* Chart grid background */}
                <div className="absolute inset-0 opacity-20">
                  <svg width="100%" height="100%" className="absolute inset-0">
                    <defs>
                      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255, 208, 0, 0.1)" strokeWidth="1"/>
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                  </svg>
                </div>

                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mergedData} margin={{ top: 20, right: 10, left: -20, bottom: 20 }}>
                    <XAxis
                      dataKey="time"
                      stroke="#ffffff"
                      tick={{ fill: '#ffffff', fontSize: 12, fontWeight: 'bold' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      tickFormatter={(value, index) => {
                        // Only show every 5th tick
                        if (index % 5 === 0) return value;
                        return '';
                      }}
                    />
                    <YAxis
                      stroke="#ffffff"
                      tick={{ fill: '#ffffff', fontSize: 12, fontWeight: 'bold' }}
                      tickLine={false}
                      axisLine={false}
                      domain={[0, 1]}
                      tickFormatter={(value) => `${Math.round(value * 100)}%`}
                      ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(255, 208, 0, 0.1)',
                        border: '1px solid rgba(255, 208, 0, 0.3)',
                        borderRadius: '8px',
                        padding: '8px',
                        backdropFilter: 'blur(10px)',
                      }}
                      labelStyle={{ color: '#ffffff', fontSize: '12px', fontWeight: 'bold' }}
                      itemStyle={{ color: '#ffffff', fontSize: '12px', fontWeight: 'bold' }}
                      formatter={(value: number) => `${Math.round(value * 100)}%`}
                    />
                    {uniqueOutcomes.map((outcome, i) => (
                      <Line
                        key={`line-${currentMarket.id}-${outcome.name ?? outcome}-${i}`}
                        type="monotone"
                        dataKey={outcome.name ?? outcome}
                        stroke={outcome.color}
                        strokeWidth={3}
                        dot={{ fill: outcome.color, strokeWidth: 2, r: 4 }}
                        isAnimationActive={true}
                        animationDuration={1000}
                        style={{
                          filter: 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.3))'
                        }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Volume Changes */}
              <div className="flex items-center gap-3 mt-4 overflow-x-auto">
                {currentMarket.volumeChanges.map((change, index) => (
                  <div
                    key={index}
                    className="px-3 py-1 glass-card rounded text-[var(--success-green)] text-xs font-bold whitespace-nowrap shadow-lg hover:scale-105 transition-transform duration-300"
                  >
                    {change}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

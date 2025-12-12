'use client'

import Link from "next/link";
import { useMemo } from "react";
import { TrendingUp, Clock, Bookmark } from "lucide-react";
import LiveMarketCard from "@/components/LiveMarketCard";
import CaifuPicksCarousel from "@/components/CaifuPicksCarousel";
import { useTileBackgrounds } from "@/hooks/useTileBackgrounds";
import { useMarkets } from "@/hooks/useApi";
import { heroShowcaseMarkets, type HeroMarket } from "@/data/heroShowcaseMarkets";
import {
  pickHeroBackground,
  buildHeroBackgroundStyle,
  buildHeroMarketLookup,
  resolveHeroImageAsset,
} from "@/utils/heroMarketPresentation";

export default function Home() {
  const { data: tileBackgrounds } = useTileBackgrounds()
  const { data: liveMarkets } = useMarkets()

  const heroMarketLookup = useMemo(() => buildHeroMarketLookup(liveMarkets), [liveMarkets])

  const resolveHeroImage = (market: HeroMarket, index: number): string | null => {
    return resolveHeroImageAsset(market, index, heroMarketLookup)
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Category filter toolbar - visible on all screen sizes */}
      <section className="liquid-toolbar overflow-hidden relative">
        {/* Glow orbs hidden on mobile for cleaner look */}
        <div className="hidden sm:block">
          <div className="glow-orb w-[180px] h-[180px] bg-[rgba(255,215,107,0.28)] -top-28 -left-20"></div>
          <div className="glow-orb w-[180px] h-[180px] bg-[rgba(255,215,107,0.22)] top-12 left-72"></div>
          <div className="glow-orb w-[260px] h-[260px] bg-[rgba(255,215,107,0.36)] -top-28 right-[-30px]"></div>
          <div className="glow-orb w-[220px] h-[220px] bg-[rgba(255,215,107,0.32)] bottom-[-50px] right-16"></div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="flex items-center gap-1 py-3 sm:py-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory horizontal-scroll">
            <Link href="/markets?category=Trending" className="nav-tab-active flex items-center gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm font-bold rounded-lg shrink-0 snap-start">
              <TrendingUp className="w-4 h-4" />
              Trending
            </Link>
            <Link href="/markets?category=Breaking" className="nav-tab flex items-center gap-2 shrink-0 snap-start text-xs sm:text-sm">
              Breaking
            </Link>
            <Link href="/markets?category=New" className="nav-tab flex items-center gap-2 shrink-0 snap-start text-xs sm:text-sm">
              New
            </Link>
            <div className="h-5 w-px bg-gradient-to-b from-transparent via-[var(--border-color)] to-transparent mx-2"></div>
            {['Politics', 'Sports', 'Crypto', 'Earnings', 'Geopolitics', 'Tech', 'Culture', 'World', 'Economy'].map((tab) => (
              <Link
                key={tab}
                href={`/markets?category=${encodeURIComponent(tab)}`}
                className="nav-tab shrink-0 snap-start text-xs sm:text-sm"
              >
                {tab}
              </Link>
            ))}
            <Link href="/markets" className="nav-tab shrink-0 snap-start text-xs sm:text-sm">
              More
            </Link>
          </div>
        </div>
      </section>

      {/* Caifu Picks Carousel */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <CaifuPicksCarousel />
      </div>

      {/* Live Featured Market */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <LiveMarketCard />
      </div>

      {/* Topic Filter Pills */}
      <section className="relative py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory horizontal-scroll">
            <Link href="/markets" className="px-3 py-1 text-xs font-bold text-black bg-[var(--primary-yellow)] rounded-full shadow-lg shadow-[var(--primary-yellow)]/40 hover:scale-105 transition-transform duration-300 whitespace-nowrap shrink-0 snap-start">
              All
            </Link>
            {[
              'Gov Shutdown',
              'Gaza',
              'NYC Mayor',
              'Taylor Swift',
              'France',
              'MLB Playoffs',
              'Venezuela',
              'Israel',
              'Fed',
              'Earnings',
              'Ukr',
              'Trump',
              'AI Regulation',
              'Climate Summit',
              'Oil Prices',
              'Bitcoin ETF',
              'Immigration Reform',
              'Housing Market'
            ].map((filter) => (
              <Link
                key={filter}
                href={`/markets?tag=${encodeURIComponent(filter)}`}
                className="px-3 py-1 text-xs font-medium text-[var(--text-secondary)] glass-card hover:text-white rounded-full transition-all duration-300 hover:scale-105 whitespace-nowrap shrink-0 snap-start"
              >
                {filter}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Main Markets Grid - Exact Polymarket Layout */}
      <section className="relative py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="neon-divider mb-8"></div>
          <div className="grid h-auto gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {heroShowcaseMarkets.map((market, index) => {
              const heroImageUrl = resolveHeroImage(market, index)
              const background = heroImageUrl ? null : pickHeroBackground(market, tileBackgrounds)
              const cardStyle = buildHeroBackgroundStyle(heroImageUrl ?? background?.imageUrl)
              const targetKey = typeof market.slug === 'string' && market.slug.length > 0
                ? market.slug
                : String(index + 1)
              return (
                <Link key={index} href={`/markets/${targetKey}`}>
                  <div
                    className="market-card min-h-[180px] h-full flex flex-col pt-3 relative group/card"
                    style={cardStyle}
                    data-has-bg={heroImageUrl || background ? 'true' : 'false'}
                    data-has-hero={heroImageUrl ? 'true' : 'false'}
                  >
                  {/* Market Icon */}
                  <div className="flex items-center px-3 mb-2">
                    <div className="w-8 h-8 min-w-8 bg-gradient-to-br from-[var(--hover-background)] to-[var(--card-background)] rounded flex items-center justify-center text-lg shadow-md">
                      {market.image}
                    </div>
                  </div>

                  {/* Market Title */}
                  <div className="px-3 mb-3">
                    <h3 className="text-sm font-semibold text-white line-clamp-2 leading-[20px] group-hover/card:gradient-text transition-all duration-300">
                      <span className="text-contrast-overlay">{market.title}</span>
                    </h3>
                  </div>

                  {/* Outcomes */}
                  <div className="px-3 mb-3 flex-1">
                    <div className="space-y-2">
                      {market.outcomes.map((outcome) => (
                        <div key={outcome.name} className="flex items-center justify-between text-xs hover:bg-[var(--hover-background)]/20 p-1 rounded transition-all duration-300">
                          <span className="text-white font-medium truncate mr-2 text-contrast-overlay">{outcome.name}</span>
                          <div className="flex items-center space-x-1">
                            <span className="font-bold text-white text-contrast-overlay">{Math.round(outcome.price * 100)}%</span>
                            <span className={`text-xs font-bold ${outcome.change >= 0 ? 'price-up' : 'price-down'}`}>
                              {outcome.change >= 0 ? '+' : ''}{outcome.change}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-3 pb-3 mt-auto border-t border-[var(--border-color)]/50 pt-2">
                    <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white text-contrast-overlay">${market.volume}</span>
                        <span className="text-[var(--text-muted)]">Vol.</span>
                        {market.status === 'live' && (
                          <>
                            <span className="inline-flex items-center gap-1 text-red-400 font-bold">
                              <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse shadow-[0_0_5px_#ef4444]"></span>
                              LIVE
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center space-x-1">
                        <button 
                          className="p-1 text-[var(--text-muted)] hover:text-white transition-all duration-300 hover:scale-125"
                          aria-label="Market timing"
                        >
                          <Clock className="w-3 h-3" />
                        </button>
                        <button 
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--primary-yellow)] transition-all duration-300 hover:scale-125"
                          aria-label="Bookmark market"
                        >
                          <Bookmark className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

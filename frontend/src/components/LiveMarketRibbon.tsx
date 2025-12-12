'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'

interface MarketTickerItem {
  id: string
  slug: string
  title: string
  yesPrice: number
}

export function LiveMarketRibbon({ speed = 40 }: { speed?: number }) {
  const [markets, setMarkets] = useState<MarketTickerItem[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number | null>(null)
  const offsetRef = useRef(0)

  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.example.com'
        const res = await fetch(`${apiBase}/api/markets?limit=20`)
        if (!res.ok) return
        const data = await res.json()

        // Map all active markets
        const allMarkets = (data.markets || data || []).map((m: any) => ({
          id: m.id,
          slug: m.slug || m.id,
          title: m.title || m.question || 'Market',
          yesPrice: m.yesPrice ?? 0.5,
        }))

        setMarkets(allMarkets)
      } catch {
        // Silently fail - ribbon is non-critical
      }
    }
    fetchMarkets()
    const interval = setInterval(fetchMarkets, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!scrollRef.current || markets.length === 0) return
    let lastTime = performance.now()

    const animate = (currentTime: number) => {
      const delta = (currentTime - lastTime) / 1000
      lastTime = currentTime
      offsetRef.current += speed * delta

      // Reset when we've scrolled through half (the duplicated content)
      const scrollWidth = scrollRef.current?.scrollWidth ?? 0
      if (scrollWidth > 0 && offsetRef.current >= scrollWidth / 2) {
        offsetRef.current = 0
      }

      if (scrollRef.current) {
        scrollRef.current.style.transform = `translateX(-${offsetRef.current}px)`
      }
      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [markets, speed])

  // Don't render if no traded markets
  if (markets.length === 0) return null

  // Duplicate markets for seamless looping
  const displayMarkets = [...markets, ...markets]

  return (
    <div className="w-full bg-black/60 backdrop-blur-sm border-y border-zinc-800/50 py-2 overflow-hidden">
      <div
        ref={scrollRef}
        className="flex items-center gap-8 whitespace-nowrap"
        style={{ willChange: 'transform' }}
      >
        {displayMarkets.map((m, i) => (
          <Link
            key={`${m.id}-${i}`}
            href={`/markets/${m.slug}`}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
          >
            <span className="text-zinc-400 text-sm truncate max-w-[200px]">
              {m.title}
            </span>
            <span className="text-white text-sm font-mono font-medium">
              {(m.yesPrice * 100).toFixed(0)}¢
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default LiveMarketRibbon

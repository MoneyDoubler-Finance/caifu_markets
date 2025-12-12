'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import Link from 'next/link'

interface SearchResult {
  id: string
  slug: string
  title: string
  yesPrice?: number
  status: string
}

interface MarketSearchProps {
  className?: string
  inputClassName?: string
  placeholder?: string
  onResultClick?: () => void
}

export function MarketSearch({
  className = '',
  inputClassName = '',
  placeholder = 'Search markets...',
  onResultClick,
}: MarketSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setIsOpen(false)
      return
    }

    const timer = setTimeout(async () => {
      setIsLoading(true)
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.example.com'
        const res = await fetch(`${apiBase}/api/markets?search=${encodeURIComponent(query.trim())}&limit=8`)
        if (res.ok) {
          const data = await res.json()
          const markets = (Array.isArray(data) ? data : data.markets || []).map((m: any) => ({
            id: m.id,
            slug: m.slug || m.id,
            title: m.title,
            yesPrice: m.yesPrice,
            status: m.status,
          }))
          setResults(markets)
          setIsOpen(true)
        }
      } catch {
        // Silently fail
      } finally {
        setIsLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close on Escape
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setQuery('')
      inputRef.current?.blur()
    }
  }, [])

  const handleResultClick = (slug: string) => {
    setQuery('')
    setIsOpen(false)
    onResultClick?.()
    router.push(`/markets/${slug}`)
  }

  const clearSearch = () => {
    setQuery('')
    setResults([])
    setIsOpen(false)
    inputRef.current?.focus()
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query.trim() && results.length > 0 && setIsOpen(true)}
          className={`w-full pl-10 pr-8 py-2 rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none transition-all duration-300 ${inputClassName}`}
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white transition-colors"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg shadow-2xl overflow-hidden z-50 max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="px-4 py-3 text-sm text-[var(--text-muted)]">
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[var(--text-muted)]">
              No markets found for "{query}"
            </div>
          ) : (
            <ul>
              {results.map((market) => (
                <li key={market.id}>
                  <button
                    onClick={() => handleResultClick(market.slug)}
                    className="w-full text-left px-4 py-3 hover:bg-[var(--hover-background)] transition-colors flex items-center justify-between gap-3 border-b border-[var(--border-color)] last:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">
                        {market.title}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] capitalize">
                        {market.status}
                      </p>
                    </div>
                    {market.yesPrice !== undefined && (
                      <span className="text-sm font-mono font-semibold text-[var(--primary-yellow)] shrink-0">
                        {(market.yesPrice * 100).toFixed(0)}¢
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default MarketSearch

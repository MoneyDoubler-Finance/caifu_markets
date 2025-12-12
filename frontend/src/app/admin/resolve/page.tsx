'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import { fetchJSON, ApiRequestError } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'
import { formatDateTime, formatTimeRemaining } from '@/utils/format'

type MarketDetails = {
  id: string
  title?: string | null
  outcomes?: string[]
  status?: string
  expiresAt?: string | null
  resolvedAt?: string | null
}

export default function AdminResolvePage() {
  const router = useRouter()
  const [authChecking, setAuthChecking] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const [markets, setMarkets] = useState<MarketDetails[]>([])
  const [loadingMarkets, setLoadingMarkets] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const [selectedOutcome, setSelectedOutcome] = useState<Record<string, number>>({})
  const [resolveState, setResolveState] = useState<Record<string, { status: 'idle' | 'submitting' | 'success' | 'error'; error?: string }>>({})

  useEffect(() => {
    let cancelled = false
    const verify = async () => {
      try {
        await fetchJSON(`${API_BASE}/api/admin/me`)
        if (!cancelled) {
          setAuthError(null)
          setAuthChecking(false)
          // Preload markets once auth is confirmed
          void fetchMarkets()
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiRequestError && err.status === 401) {
          router.replace('/admin/login')
          return
        }
        setAuthError(err instanceof Error ? err.message : 'Failed to verify admin session')
        setAuthChecking(false)
      }
    }
    verify()
    return () => {
      cancelled = true
    }
  }, [router])
  
  const fetchMarkets = async () => {
    setLoadingMarkets(true)
    setLoadError(null)
    try {
      const data = await fetchJSON<MarketDetails[]>(`${API_BASE}/api/markets?status=active&limit=100`)
      setMarkets(data)
      setLastRefreshed(new Date())
      setResolveState({})
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load markets')
    } finally {
      setLoadingMarkets(false)
    }
  }

  const settlementQueue = useMemo(() => {
    const now = Date.now()
    return markets.filter((m) => m.status === 'active' && m.expiresAt && new Date(m.expiresAt).getTime() <= now)
  }, [markets])

  const handleResolve = async (market: MarketDetails) => {
    const currentOutcome = selectedOutcome[market.id] ?? 0
    setResolveState((prev) => ({
      ...prev,
      [market.id]: { status: 'submitting' }
    }))
    try {
      const labels = (market.outcomes && market.outcomes.length > 0) ? market.outcomes : ['Yes', 'No']
      const payoutNumerators = labels.map((_, idx) => (idx === currentOutcome ? 1 : 0))

      await fetchJSON(`${API_BASE}/api/admin/markets/${encodeURIComponent(market.id)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId: market.id,
          payoutNumerators,
        }),
      })

      setResolveState((prev) => ({
        ...prev,
        [market.id]: { status: 'success' }
      }))
      setMarkets((prev) => prev.map((m) => m.id === market.id ? {
        ...m,
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
      } : m))
    } catch (err) {
      setResolveState((prev) => ({
        ...prev,
        [market.id]: { status: 'error', error: err instanceof Error ? err.message : 'Failed to resolve market' }
      }))
    }
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-white">Checking authentication…</div>
      </div>
    )
  }

  if (authError) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-white">{authError}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
        <AdminNav />
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">Resolve Markets</h1>
            <p className="text-sm text-[var(--text-secondary)]">Expired, still-active markets appear automatically. Pick the outcome and resolve.</p>
          </div>
          <button
            onClick={fetchMarkets}
            disabled={loadingMarkets}
            className="px-4 py-2 rounded-md bg-[var(--hover-background)] text-white border border-[var(--border-color)] hover:border-[var(--primary-yellow)] disabled:opacity-50"
          >
            {loadingMarkets ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {loadError && (
          <div className="glass-card rounded-lg p-4 text-red-300 border border-red-500/40">{loadError}</div>
        )}

        <div className="glass-card rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
            <span>Showing markets past expiry that are still marked active.</span>
            {lastRefreshed && <span>Updated {formatTimeRemaining(lastRefreshed)}</span>}
          </div>

          {loadingMarkets && (
            <div className="text-white">Loading markets…</div>
          )}

          {!loadingMarkets && settlementQueue.length === 0 && (
            <div className="text-[var(--text-secondary)]">No expired active markets right now. You’re all caught up.</div>
          )}

          <div className="space-y-4">
            {settlementQueue.map((m) => {
              const labels = (m.outcomes && m.outcomes.length > 0) ? m.outcomes : ['Yes', 'No']
              const selected = selectedOutcome[m.id] ?? 0
              const state = resolveState[m.id]?.status || 'idle'
              const err = resolveState[m.id]?.error
              const expiredAt = m.expiresAt ? new Date(m.expiresAt) : null
              const resolved = m.status === 'resolved' || state === 'success'

              return (
                <div key={m.id} className="border border-[var(--border-color)] rounded-lg p-4 bg-[var(--hover-background)]/40">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                      <div className="text-white font-semibold">{m.title || m.id}</div>
                      <div className="text-xs text-[var(--text-muted)]">ID: {m.id}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {expiredAt && (
                        <span className="px-2 py-1 rounded-full bg-amber-500/20 text-amber-200">Expired {formatTimeRemaining(expiredAt)}</span>
                      )}
                      {resolved && (
                        <span className="px-2 py-1 rounded-full bg-[var(--success-green)]/20 text-[var(--success-green)]">Settled</span>
                      )}
                    </div>
                  </div>

                  <div className="text-sm text-[var(--text-secondary)] mb-3">
                    <span className="mr-3">Status: {resolved ? 'resolved' : m.status}</span>
                    {expiredAt && <span>Expiry: {formatDateTime(expiredAt)}</span>}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-[var(--text-muted)]">Select winning outcome</div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {labels.map((label, idx) => (
                        <label
                          key={idx}
                          className={`flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer transition ${
                            selected === idx
                              ? 'border-[var(--primary-yellow)] bg-[var(--hover-background)]'
                              : 'border-[var(--border-color)] bg-[var(--background)]'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`outcome-${m.id}`}
                            className="accent-[var(--primary-yellow)]"
                            checked={selected === idx}
                            onChange={() => setSelectedOutcome((prev) => ({ ...prev, [m.id]: idx }))}
                            disabled={resolved || state === 'submitting'}
                          />
                          <span className="text-white">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mt-3">
                    <button
                      onClick={() => handleResolve(m)}
                      disabled={resolved || state === 'submitting'}
                      className="px-4 py-2 rounded-md bg-[var(--primary-yellow)] text-black font-semibold hover:bg-[var(--primary-yellow-hover)] disabled:opacity-50"
                    >
                      {state === 'submitting' ? 'Resolving…' : resolved ? 'Settled' : 'Resolve Market'}
                    </button>
                    {state === 'error' && <span className="text-sm text-red-400">{err}</span>}
                    {state === 'success' && <span className="text-sm text-[var(--success-green)]">Resolved</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

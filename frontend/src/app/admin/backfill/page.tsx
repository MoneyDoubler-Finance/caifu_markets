'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import { fetchJSON, ApiRequestError } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'

interface MarketRow {
  id: string
  title: string
  fpmmAddress?: string | null
  createdAt?: string | null
}

type BackfillState = Record<string, 'idle' | 'running' | 'success' | 'error'>

export default function AdminBackfillPage() {
  const router = useRouter()
  const [authChecking, setAuthChecking] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [markets, setMarkets] = useState<MarketRow[]>([])
  const [loading, setLoading] = useState(false)
  const [backfillState, setBackfillState] = useState<BackfillState>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const verify = async () => {
      try {
        await fetchJSON(`${API_BASE}/api/admin/me`)
        if (!cancelled) {
          setAuthError(null)
          setAuthChecking(false)
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

  useEffect(() => {
    if (authChecking || authError) return
    let cancelled = false
    const loadMarkets = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchJSON<MarketRow[]>(`${API_BASE}/api/markets?limit=100&includeDeleted=1`)
        if (!cancelled && Array.isArray(data)) {
          setMarkets(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load markets')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadMarkets()
    return () => {
      cancelled = true
    }
  }, [authChecking, authError])

  const sortedMarkets = useMemo(() => {
    return [...markets].sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bDate - aDate
    })
  }, [markets])

  const handleCopy = async (addr?: string | null) => {
    if (!addr) return
    try {
      await navigator.clipboard.writeText(addr)
    } catch (err) {
      console.error('clipboard error', err)
    }
  }

  const handleBackfill = async (marketId: string) => {
    setBackfillState((prev) => ({ ...prev, [marketId]: 'running' }))
    try {
      await fetchJSON(`${API_BASE}/api/admin/markets/${marketId}/backfill`, {
        method: 'POST',
      })
      setBackfillState((prev) => ({ ...prev, [marketId]: 'success' }))
    } catch (err) {
      setBackfillState((prev) => ({ ...prev, [marketId]: 'error' }))
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
    <div className="min-h-screen bg-[var(--background)] pb-16">
      <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
        <AdminNav />
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-white">Backfill Markets</h1>
          <p className="text-sm text-[var(--text-muted)]">Replay on-chain trades into the database for any market.</p>
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-900/20 border border-red-500/30 rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]/60 backdrop-blur">
          <div className="grid grid-cols-[1.4fr_1.1fr_0.4fr] gap-3 px-4 py-3 text-xs font-semibold text-[var(--text-muted)] border-b border-[var(--border-color)]">
            <div>Name</div>
            <div>FPMM CA</div>
            <div className="text-right">Action</div>
          </div>
          <div className="divide-y divide-[var(--border-color)]">
            {loading && (
              <div className="px-4 py-6 text-[var(--text-secondary)]">Loading markets…</div>
            )}
            {!loading && sortedMarkets.length === 0 && (
              <div className="px-4 py-6 text-[var(--text-secondary)]">No markets found.</div>
            )}
            {sortedMarkets.map((m) => {
              const addr = m.fpmmAddress || '—'
              const status = backfillState[m.id] ?? 'idle'
              return (
                <div key={m.id} className="grid grid-cols-[1.4fr_1.1fr_0.4fr] gap-3 px-4 py-3 items-center text-sm">
                  <div className="text-white truncate" title={m.title}>{m.title}</div>
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => handleCopy(m.fpmmAddress)}
                      className="text-[var(--primary-yellow)] hover:text-[var(--primary-yellow)]/80 truncate text-left"
                      title="Copy FPMM address"
                    >
                      {addr}
                    </button>
                    {m.fpmmAddress && (
                      <a
                        className="text-[var(--text-muted)] hover:text-[var(--primary-yellow)] text-xs"
                        href={`https://testnet.bscscan.com/address/${m.fpmmAddress}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in BscScan"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleBackfill(m.id)}
                      disabled={status === 'running'}
                      className={`px-4 py-2 rounded-lg text-xs font-bold border border-red-500 text-red-200 transition-all duration-200 ${
                        status === 'running'
                          ? 'bg-red-800/60 opacity-80 cursor-wait'
                          : 'bg-red-900/40 hover:bg-red-700/60 shadow-[0_0_10px_rgba(255,77,77,0.35)]'
                      }`}
                    >
                      {status === 'running' ? 'Backfilling…' : status === 'success' ? 'Backfilled' : status === 'error' ? 'Retry' : 'BACKFILL'}
                    </button>
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

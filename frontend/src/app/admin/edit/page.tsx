'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import { fetchJSON, ApiRequestError } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'
import type { MarketResponse } from '@caifu/types'

type EditableMarket = Pick<MarketResponse, 'id' | 'slug' | 'title' | 'expiresAt' | 'status'>

const toLocalInput = (iso?: string | null): string => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export default function AdminEditExpiryPage() {
  const router = useRouter()
  const [authChecking, setAuthChecking] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const [marketKey, setMarketKey] = useState('')
  const [market, setMarket] = useState<EditableMarket | null>(null)
  const [expiryInput, setExpiryInput] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadingMarket, setLoadingMarket] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

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

  const handleLoadMarket = async () => {
    const key = marketKey.trim()
    if (!key) return
    setLoadingMarket(true)
    setLoadError(null)
    setStatusMessage(null)
    try {
      const result = await fetchJSON<MarketResponse>(`${API_BASE}/api/markets/${encodeURIComponent(key)}`)
      const expiresAt = result.expiresAt ?? null
      setMarket({
        id: result.id,
        slug: result.slug ?? null,
        title: result.title ?? result.id,
        expiresAt,
        status: result.status,
      })
      setExpiryInput(toLocalInput(expiresAt))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load market')
      setMarket(null)
    } finally {
      setLoadingMarket(false)
    }
  }

  const handleUpdateExpiry = async () => {
    if (!market) return
    const trimmed = expiryInput.trim()
    if (!trimmed) {
      setLoadError('Expiry date/time is required')
      return
    }
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) {
      setLoadError('Enter a valid date/time')
      return
    }

    setSaving(true)
    setLoadError(null)
    setStatusMessage(null)
    try {
      const payload = { expiresAt: parsed.toISOString() }
      const updated = await fetchJSON<{ ok: boolean; market: { expiresAt?: string | null } }>(
        `${API_BASE}/api/admin/markets/${encodeURIComponent(market.id)}/expiry`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )

      const nextExpiry = updated.market?.expiresAt ?? payload.expiresAt
      setMarket((prev) => (prev ? { ...prev, expiresAt: nextExpiry } : prev))
      setExpiryInput(toLocalInput(nextExpiry))
      setStatusMessage('Expiry updated')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to update expiry')
    } finally {
      setSaving(false)
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
      <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
        <AdminNav />
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-white">Edit Market Expiry</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Look up a market by slug or ID, then set its expiry timestamp.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]/60 backdrop-blur p-5 space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-[var(--text-secondary)]" htmlFor="marketKey">
              Market ID or slug
            </label>
            <div className="flex gap-2">
              <input
                id="marketKey"
                value={marketKey}
                onChange={(e) => setMarketKey(e.target.value)}
                className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--card-background)] px-3 py-2 text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
                placeholder="e.g. cm123... or will-bitcoin-100k"
              />
              <button
                type="button"
                onClick={handleLoadMarket}
                disabled={!marketKey.trim() || loadingMarket}
                className="px-4 py-2 rounded-lg bg-[var(--primary-yellow)] text-black font-semibold hover:bg-[var(--primary-yellow)]/90 disabled:opacity-50"
              >
                {loadingMarket ? 'Loading…' : 'Load'}
              </button>
            </div>
          </div>

          {market && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-semibold text-lg">{market.title || market.id}</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    ID: {market.id} {market.slug ? `• slug: ${market.slug}` : ''}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] capitalize mt-1">Status: {market.status}</div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--text-secondary)]" htmlFor="expiry">
                  Expiry (required)
                </label>
                <input
                  id="expiry"
                  type="datetime-local"
                  value={expiryInput}
                  onChange={(e) => setExpiryInput(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--card-background)] px-3 py-2 text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
                />
                <p className="text-xs text-[var(--text-muted)]">
                  Use local time; it will be stored as UTC.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleUpdateExpiry}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-[var(--primary-yellow)] text-black font-semibold hover:bg-[var(--primary-yellow)]/90 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save expiry'}
                </button>
                {statusMessage && <span className="text-sm text-[var(--success-green)]">{statusMessage}</span>}
              </div>
            </div>
          )}

          {loadError && (
            <div className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg p-3">
              {loadError}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

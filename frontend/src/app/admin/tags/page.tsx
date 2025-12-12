'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import { fetchJSON, ApiRequestError } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'

interface Tag {
  id: string
  name: string
  normalized: string
  visible: boolean
  marketCount: number
  createdAt: string
  updatedAt: string
}

type SortKey = 'name' | 'marketCount' | 'visible'
type SortDir = 'asc' | 'desc'

export default function AdminTagsPage() {
  const router = useRouter()
  const [authChecking, setAuthChecking] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [showHidden, setShowHidden] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('marketCount')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ synced: number; total: number } | null>(null)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  // Auth check
  useEffect(() => {
    let cancelled = false
    const verify = async () => {
      try {
        await fetchJSON(`${API_BASE}/api/admin/me`)
        if (!cancelled) {
          setAuthError(null)
          setAuthChecking(false)
          void fetchTags()
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

  const fetchTags = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchJSON<{ tags: Tag[] }>(`${API_BASE}/api/admin/tags`)
      setTags(data.tags || [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load tags')
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const result = await fetchJSON<{ synced: number; total: number; existing: number }>(
        `${API_BASE}/api/admin/tags/sync`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )
      setSyncResult({ synced: result.synced, total: result.total })
      // Refresh the list
      await fetchTags()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to sync tags')
    } finally {
      setSyncing(false)
    }
  }

  const handleToggleVisibility = async (tag: Tag) => {
    const newVisible = !tag.visible
    // Optimistic update
    setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, visible: newVisible } : t)))
    setTogglingIds((prev) => new Set(prev).add(tag.id))

    try {
      await fetchJSON(`${API_BASE}/api/admin/tags/${tag.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible: newVisible }),
      })
    } catch (err) {
      // Revert on error
      setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, visible: !newVisible } : t)))
      setLoadError(err instanceof Error ? err.message : 'Failed to update tag')
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(tag.id)
        return next
      })
    }
  }

  const handleDelete = async (tag: Tag) => {
    if (!confirm(`Delete tag "${tag.name}"? This removes it from the visibility table. Markets will keep their tag associations. You can re-sync to add it back.`)) {
      return
    }

    setDeletingIds((prev) => new Set(prev).add(tag.id))
    try {
      await fetchJSON(`${API_BASE}/api/admin/tags/${tag.id}`, {
        method: 'DELETE',
      })
      setTags((prev) => prev.filter((t) => t.id !== tag.id))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to delete tag')
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(tag.id)
        return next
      })
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const filteredAndSortedTags = useMemo(() => {
    let result = [...tags]

    // Filter by visibility
    if (!showHidden) {
      result = result.filter((t) => t.visible)
    }

    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      result = result.filter((t) => t.name.toLowerCase().includes(query) || t.normalized.includes(query))
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortBy === 'marketCount') {
        cmp = a.marketCount - b.marketCount
      } else if (sortBy === 'visible') {
        cmp = (a.visible ? 1 : 0) - (b.visible ? 1 : 0)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [tags, showHidden, searchQuery, sortBy, sortDir])

  const visibleCount = useMemo(() => tags.filter((t) => t.visible).length, [tags])
  const hiddenCount = useMemo(() => tags.filter((t) => !t.visible).length, [tags])

  // Loading state
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-white">Checking authentication...</div>
      </div>
    )
  }

  // Auth error state
  if (authError) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 mb-4">{authError}</div>
          <a href="/admin/login" className="text-[var(--primary-yellow)] hover:underline">
            Go to login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-6">
        <AdminNav />

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">Manage Tags</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Control which tags appear in the public markets filter dropdown. Hidden tags won't show in filters but markets keep their tag associations.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2 rounded-lg bg-[var(--hover-background)] text-white border border-[var(--border-color)] hover:border-[var(--primary-yellow)] disabled:opacity-50 transition-colors text-sm font-medium"
            >
              {syncing ? 'Syncing...' : 'Sync Tags'}
            </button>
          </div>
        </div>

        {/* Sync result toast */}
        {syncResult && (
          <div className="glass-card rounded-lg p-4 border border-green-500/40 bg-green-500/10">
            <div className="flex items-center justify-between">
              <span className="text-green-400">
                Synced {syncResult.synced} new tag{syncResult.synced !== 1 ? 's' : ''} from markets. Total: {syncResult.total} tags.
              </span>
              <button onClick={() => setSyncResult(null)} className="text-green-400 hover:text-green-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Error message */}
        {loadError && (
          <div className="glass-card rounded-lg p-4 border border-red-500/40 bg-red-500/10">
            <div className="flex items-center justify-between">
              <span className="text-red-400">{loadError}</span>
              <button onClick={() => setLoadError(null)} className="text-red-400 hover:text-red-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 pl-10 rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-white placeholder-gray-500 focus:outline-none focus:border-[var(--primary-yellow)]"
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            {/* Toggle hidden filter */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--text-secondary)]">
                {visibleCount} visible, {hiddenCount} hidden
              </span>
              <button
                onClick={() => setShowHidden((prev) => !prev)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  showHidden
                    ? 'bg-[var(--primary-yellow)] text-black'
                    : 'bg-[var(--hover-background)] text-white border border-[var(--border-color)]'
                }`}
              >
                {showHidden ? 'Show All' : 'Visible Only'}
              </button>
            </div>
          </div>
        </div>

        {/* Tags table */}
        <div className="glass-card rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-white">Loading tags...</div>
          ) : filteredAndSortedTags.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-secondary)]">
              {searchQuery ? 'No tags match your search.' : 'No tags found. Click "Sync Tags" to populate from markets.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-white/10 bg-[var(--hover-background)]/50">
                  <tr>
                    <th
                      className="text-left py-3 px-4 text-sm font-medium text-gray-400 cursor-pointer hover:text-white transition-colors"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center gap-1">
                        Tag Name
                        {sortBy === 'name' && (
                          <span className="text-[var(--primary-yellow)]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="text-left py-3 px-4 text-sm font-medium text-gray-400 cursor-pointer hover:text-white transition-colors"
                      onClick={() => handleSort('marketCount')}
                    >
                      <div className="flex items-center gap-1">
                        Markets
                        {sortBy === 'marketCount' && (
                          <span className="text-[var(--primary-yellow)]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="text-left py-3 px-4 text-sm font-medium text-gray-400 cursor-pointer hover:text-white transition-colors"
                      onClick={() => handleSort('visible')}
                    >
                      <div className="flex items-center gap-1">
                        Status
                        {sortBy === 'visible' && (
                          <span className="text-[var(--primary-yellow)]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredAndSortedTags.map((tag) => (
                    <tr key={tag.id} className="hover:bg-[var(--hover-background)]/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="text-white font-medium">{tag.name}</div>
                        {tag.name !== tag.normalized && (
                          <div className="text-xs text-gray-500">{tag.normalized}</div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-[var(--text-secondary)]">
                          {tag.marketCount} market{tag.marketCount !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {tag.visible ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
                            Visible
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400">
                            Hidden
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          {/* Toggle switch */}
                          <button
                            onClick={() => handleToggleVisibility(tag)}
                            disabled={togglingIds.has(tag.id)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:ring-offset-2 focus:ring-offset-[var(--background)] ${
                              tag.visible ? 'bg-[var(--primary-yellow)]' : 'bg-gray-600'
                            } ${togglingIds.has(tag.id) ? 'opacity-50' : ''}`}
                            title={tag.visible ? 'Click to hide' : 'Click to show'}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                tag.visible ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>

                          {/* Delete button */}
                          <button
                            onClick={() => handleDelete(tag)}
                            disabled={deletingIds.has(tag.id)}
                            className={`p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors ${
                              deletingIds.has(tag.id) ? 'opacity-50' : ''
                            }`}
                            title="Delete tag"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Stats footer */}
        {!loading && tags.length > 0 && (
          <div className="text-center text-sm text-[var(--text-muted)]">
            Showing {filteredAndSortedTags.length} of {tags.length} tags
          </div>
        )}
      </div>
    </div>
  )
}

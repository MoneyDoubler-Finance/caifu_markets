'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJSON, getApiBaseUrl, ApiRequestError } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'
import type { TileBackground } from '@/types'
import type { MarketResponse } from '@caifu/types'
import { tileBackgroundQueryKey } from '@/hooks/useTileBackgrounds'
import AdminNav from '@/components/AdminNav'

const adminTileBackgroundsKey = ['admin', 'tile-backgrounds'] as const
const tagSuggestionKey = ['admin', 'tag-suggestions'] as const

const normalize = (value: string) => value.trim()
const normalizeKey = (value: string) => value.trim().toLowerCase()

export default function AdminTileBackgroundsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [authChecking, setAuthChecking] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [tag, setTag] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)

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

  const backgroundsQuery = useQuery({
    queryKey: adminTileBackgroundsKey,
    queryFn: async () => {
      const payload = await fetchJSON<{ backgrounds: TileBackground[] }>(`${API_BASE}/api/admin/tile-backgrounds`)
      return payload?.backgrounds ?? []
    },
    enabled: !authChecking && !authError,
    staleTime: 0,
  })

  const createMutation = useMutation({
    mutationFn: async ({ tag, file }: { tag: string; file: File }) => {
      const formData = new FormData()
      formData.append('tag', tag)
      formData.append('file', file)

      const baseUrl = getApiBaseUrl() || 'https://api.example.com'
      const response = await fetch(`${baseUrl}/api/admin/tile-backgrounds/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        mode: 'cors',
      })

      let data: any = null
      try {
        data = await response.json()
      } catch (error) {
        // ignore parse error
      }

      if (!response.ok) {
        const message = data?.error?.message || data?.error || 'Failed to save background'
        throw new Error(message)
      }

      return data?.background as TileBackground
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTileBackgroundsKey })
      queryClient.invalidateQueries({ queryKey: tileBackgroundQueryKey })
      setTag('')
      setFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setFormError(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetchJSON(`${API_BASE}/api/admin/tile-backgrounds/${id}`, {
        method: 'DELETE',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTileBackgroundsKey })
      queryClient.invalidateQueries({ queryKey: tileBackgroundQueryKey })
    },
  })

  const tagSuggestionsQuery = useQuery({
    queryKey: tagSuggestionKey,
    enabled: !authChecking && !authError,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      let markets: MarketResponse[] = []
      try {
        const url = `${API_BASE}/api/markets?limit=100`
        markets = await fetchJSON<MarketResponse[]>(url)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load market tags'
        setSuggestionError(message)
        throw error
      }
      const seen = new Map<string, string>()

      const addTag = (value?: string | null) => {
        if (!value) return
        const key = normalizeKey(value)
        if (!key || seen.has(key)) return
        seen.set(key, value.trim())
      }

      for (const market of markets) {
        if (market.category) {
          addTag(market.category)
        }
        if (Array.isArray(market.tags)) {
          for (const value of market.tags) {
            addTag(value)
          }
        }
      }

      // Augment suggestions with any edits made in /admin/tile-tags (cached locally)
      try {
        if (typeof window !== 'undefined') {
          const raw = localStorage.getItem('caifu:admin:tile-tags:suggestions')
          if (raw) {
            const labels: unknown = JSON.parse(raw)
            if (Array.isArray(labels)) {
              for (const v of labels) {
                if (typeof v === 'string') addTag(v)
              }
            }
          }
        }
      } catch {
        // ignore local cache parse errors
      }

      const suggestions = Array.from(seen.entries())
        .map(([normalized, original]) => ({ normalized, label: original }))
        .sort((a, b) => a.label.localeCompare(b.label))

      if (suggestions.length === 0) {
        setSuggestionError('No tags found on existing markets yet.')
      } else {
        setSuggestionError(null)
      }

      return suggestions
    },
  })

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedTag = normalize(tag)

    if (!trimmedTag || trimmedTag.length < 2) {
      setFormError('Tag must be at least 2 characters long')
      return
    }

    if (!file) {
      setFormError('Select an image file to upload')
      return
    }

    setFormError(null)
    try {
      await createMutation.mutateAsync({
        tag: trimmedTag,
        file,
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save background')
    }
  }

  const backgrounds = useMemo(
    () => backgroundsQuery.data ?? [],
    [backgroundsQuery.data]
  )

  const tagSuggestions = tagSuggestionsQuery.data ?? []

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
        <div className="max-w-lg text-center space-y-4">
          <h1 className="text-2xl font-semibold text-white">Unable to load admin tools</h1>
          <p className="text-[var(--text-muted)]">{authError}</p>
          <Link
            className="inline-flex items-center justify-center rounded-md bg-[var(--primary-yellow)] px-4 py-2 text-sm font-medium text-black hover:bg-[var(--primary-yellow)]/90"
            href="/admin/login"
          >
            Return to admin login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--background)] pb-16">
      <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
        <AdminNav />
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-white">Tile Backgrounds</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Upload background image URLs and map them to tags or categories. Tiles with matching tags will render the associated image.
          </p>
        </div>

        <form onSubmit={handleSubmit} encType="multipart/form-data" className="rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]/60 p-6 backdrop-blur">
          <h2 className="text-lg font-semibold text-white mb-4">Add or update background</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-1">
              <label className="mb-2 block text-sm font-medium text-white" htmlFor="tag">
                Tag or category
              </label>
              <input
                id="tag"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                placeholder="e.g. Government"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--card-background)] px-3 py-2 text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
              />
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Matching is case-insensitive. The tile&apos;s <code className="text-[var(--text-secondary)]">category</code> and <code className="text-[var(--text-secondary)]">tags</code> are checked.
              </p>
            </div>
            <div className="md:col-span-1">
              <label className="mb-2 block text-sm font-medium text-white" htmlFor="backgroundFile">
                Upload image
              </label>
              <input
                id="backgroundFile"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null
                  setFile(selected)
                }}
                ref={fileInputRef}
                className="w-full cursor-pointer rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--card-background)] px-3 py-2 text-sm text-[var(--text-secondary)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--hover-background)] file:px-3 file:py-1 file:text-sm file:font-medium file:text-white hover:border-[var(--primary-yellow)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
              />
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                PNG, JPEG, WEBP, or GIF up to 10MB. The image will be hosted under <code className="text-[var(--text-secondary)]">/static/tile-backgrounds</code>.
              </p>
              {file && (
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  Selected: <span className="text-white">{file.name}</span>
                </p>
              )}
            </div>
          </div>

          {formError && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-900/30 px-4 py-3 text-sm text-red-200">
              {formError}
            </div>
          )}

          <div className="mt-6 space-y-2">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>Suggested tags from live markets:</span>
              {tagSuggestionsQuery.isFetching && <span>Loading…</span>}
            </div>
            {suggestionError && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                {suggestionError}
              </div>
            )}
            {tagSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tagSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.normalized}
                    type="button"
                    onClick={() => setTag(suggestion.label)}
                    className="rounded-full border border-[var(--border-color)] bg-[var(--card-background)]/70 px-3 py-1 text-xs text-[var(--text-secondary)] hover:text-white hover:border-[var(--primary-yellow)]"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="inline-flex items-center rounded-lg bg-[var(--primary-yellow)] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[var(--primary-yellow)]/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createMutation.isPending ? 'Saving…' : 'Save background'}
            </button>
          </div>
        </form>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Configured backgrounds</h2>
            {backgroundsQuery.isFetching && (
              <span className="text-xs text-[var(--text-muted)]">Refreshing…</span>
            )}
          </div>

          {backgroundsQuery.isError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-900/30 px-4 py-3 text-sm text-red-200">
              {(backgroundsQuery.error as Error).message}
            </div>
          ) : backgrounds.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--card-background)]/40 px-4 py-10 text-center text-sm text-[var(--text-muted)]">
              No backgrounds configured yet. Add one using the form above.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {backgrounds.map((background) => (
                <div
                  key={background.id}
                  className="relative overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]/60 backdrop-blur"
                >
                  <div className="absolute inset-0 opacity-30">
                    <img
                      src={background.imageUrl}
                      alt={background.tag}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="relative space-y-3 p-4">
                    <div>
                      <div className="text-sm font-semibold text-white">{background.tag}</div>
                      <div className="text-xs text-[var(--text-muted)] break-all">
                        {background.imageUrl}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                      <span>Updated {new Date(background.updatedAt).toLocaleString()}</span>
                      <button
                        onClick={() => deleteMutation.mutate(background.id)}
                        disabled={deleteMutation.isPending}
                        className="rounded-md border border-red-500/40 px-2 py-1 text-xs font-medium text-red-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

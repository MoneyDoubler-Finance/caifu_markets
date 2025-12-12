'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { Cog, Move, Image as ImageIcon, Trash2, RefreshCw } from 'lucide-react'
import AdminNav from '@/components/AdminNav'
import { useTileBackgrounds, tileBackgroundQueryKey } from '@/hooks/useTileBackgrounds'
import { fetchJSON, getApiBaseUrl, ApiRequestError } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'
import type { TileBackground } from '@/types'

type Position = { x: number; y: number }

const STORAGE_KEY = 'caifu:admin:tile-bg-positions'

const defaultPosition: Position = { x: 50, y: 50 }

const loadPositions = (): Record<string, Position> => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const next: Record<string, Position> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as any).x === 'number' &&
        typeof (value as any).y === 'number'
      ) {
        next[key] = { x: (value as any).x, y: (value as any).y }
      }
    }
    return next
  } catch (error) {
    console.error('[tile-bg-positions] failed to parse', error)
    return {}
  }
}

const persistPositions = (positions: Record<string, Position>) => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions))
  } catch (error) {
    console.error('[tile-bg-positions] failed to persist', error)
  }
}

export default function AdminTileBackgroundsGridPage() {
  const queryClient = useQueryClient()

  const [authChecking, setAuthChecking] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [positions, setPositions] = useState<Record<string, Position>>({})

  useEffect(() => {
    setPositions(loadPositions())
  }, [])

  const setPosition = (id: string, position: Position) => {
    setPositions((prev) => {
      const next = { ...prev, [id]: position }
      persistPositions(next)
      return next
    })
  }

  const resetPosition = (id: string) => setPosition(id, defaultPosition)

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
          setAuthError('Admin session required')
          setAuthChecking(false)
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
  }, [])

  const { data: backgrounds, isLoading, isError, error, refetch } = useTileBackgrounds()

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetchJSON(`${API_BASE}/api/admin/tile-backgrounds/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tileBackgroundQueryKey })
    },
  })

  const replaceMutation = useMutation({
    mutationFn: async ({ background, file }: { background: TileBackground; file: File }) => {
      const formData = new FormData()
      formData.append('tag', background.tag)
      formData.append('file', file)

      const baseUrl = getApiBaseUrl() || 'https://api.example.com'
      const response = await fetch(`${baseUrl}/api/admin/tile-backgrounds/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        mode: 'cors',
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = data?.error?.message || data?.error || 'Failed to replace background'
        throw new Error(message)
      }
      return data?.background as TileBackground | undefined
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tileBackgroundQueryKey })
    },
  })

  const handleFileSelect = (background: TileBackground) => {
    const input = fileInputRefs.current[background.id]
    if (input) {
      input.value = ''
      input.click()
    }
  }

  const handleFileChange = (background: TileBackground, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    replaceMutation.mutate({ background, file })
  }

  const gridBackgrounds = useMemo(() => backgrounds ?? [], [backgrounds])

  const renderPositionControls = (background: TileBackground) => {
    if (editingId !== background.id) return null
    const pos = positions[background.id] ?? defaultPosition

    return (
      <div className="mt-3 rounded-lg border border-[var(--border-color)] bg-[var(--card-background)]/80 p-3 text-xs text-[var(--text-secondary)] backdrop-blur">
        <div className="flex items-center justify-between gap-2 text-[var(--text-muted)]">
          <span>Adjust background focus</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-white hover:border-[var(--primary-yellow)]"
            onClick={() => resetPosition(background.id)}
          >
            <RefreshCw className="h-3 w-3" />
            Reset
          </button>
        </div>
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-3">
            <span className="w-14 text-[var(--text-muted)]">Horizontal</span>
            <input
              type="range"
              min={0}
              max={100}
              value={pos.x}
              onChange={(event) => setPosition(background.id, { x: Number(event.target.value), y: pos.y })}
              className="flex-1 accent-[var(--primary-yellow)]"
            />
            <span className="w-10 text-right text-white">{pos.x}%</span>
          </label>
          <label className="flex items-center gap-3">
            <span className="w-14 text-[var(--text-muted)]">Vertical</span>
            <input
              type="range"
              min={0}
              max={100}
              value={pos.y}
              onChange={(event) => setPosition(background.id, { x: pos.x, y: Number(event.target.value) })}
              className="flex-1 accent-[var(--primary-yellow)]"
            />
            <span className="w-10 text-right text-white">{pos.y}%</span>
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="rounded-md bg-[var(--primary-yellow)] px-3 py-1 text-[11px] font-semibold text-black hover:bg-[var(--primary-yellow)]/90"
            onClick={() => setEditingId(null)}
          >
            Done
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">Position is saved locally in your browser to help align images; re-upload if you need a permanent crop.</p>
      </div>
    )
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center text-white">
        Checking admin session…
      </div>
    )
  }

  if (authError) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center text-white">
        {authError}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--background)] pb-16">
      <div className="mx-auto max-w-7xl px-4 py-10 space-y-8">
        <AdminNav />

        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-white">Manage Tile Backgrounds 2</h1>
          <p className="text-sm text-[var(--text-muted)]">
            A grid view of every live tile background the homepage can pick up by tag. Use the gear to reposition, replace, or delete a background.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-1 hover:border-[var(--primary-yellow)] hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          {replaceMutation.isPending && <span>Replacing…</span>}
          {deleteMutation.isPending && <span>Deleting…</span>}
        </div>

        {isError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {(error as Error)?.message ?? 'Failed to load tile backgrounds'}
          </div>
        )}

        {isLoading && (
          <div className="text-[var(--text-secondary)] text-sm">Loading tile backgrounds…</div>
        )}

        {!isLoading && gridBackgrounds.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--card-background)]/40 px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            No tile backgrounds found. Add one from the original Manage Tile Backgrounds page.
          </div>
        )}

        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {gridBackgrounds.map((background) => {
            const pos = positions[background.id] ?? defaultPosition
            const menuOpen = openMenuId === background.id

            return (
              <div
                key={background.id}
                className="relative overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)]/50 backdrop-blur group"
              >
                <div className="absolute inset-0">
                  <img
                    src={background.imageUrl}
                    alt={background.tag}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/55 to-black/75" />
                </div>

                <div className="relative p-4 flex flex-col h-full text-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Tag</p>
                      <h3 className="text-lg font-semibold leading-tight">{background.tag}</h3>
                      <p className="text-[11px] text-[var(--text-secondary)] break-all">{background.imageUrl}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">Updated {new Date(background.updatedAt).toLocaleString()}</p>
                    </div>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setOpenMenuId(menuOpen ? null : background.id)}
                        className="rounded-full bg-black/50 border border-[var(--border-color)] p-2 text-[var(--text-secondary)] hover:text-white hover:border-[var(--primary-yellow)]"
                        aria-label={`Open actions for ${background.tag}`}
                      >
                        <Cog className="h-4 w-4" />
                      </button>

                      {menuOpen && (
                        <div className="absolute right-0 z-10 mt-2 w-52 rounded-lg border border-[var(--border-color)] bg-[var(--card-background)] shadow-xl">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left text-[var(--text-secondary)] hover:text-white hover:bg-[var(--hover-background)]"
                            onClick={() => {
                              setEditingId(background.id)
                              setOpenMenuId(null)
                            }}
                          >
                            <Move className="h-4 w-4" />
                            Adjust position
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left text-[var(--text-secondary)] hover:text-white hover:bg-[var(--hover-background)]"
                            onClick={() => handleFileSelect(background)}
                          >
                            <ImageIcon className="h-4 w-4" />
                            Replace image
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left text-red-300 hover:bg-red-500/10"
                            onClick={() => {
                              setOpenMenuId(null)
                              deleteMutation.mutate(background.id)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete background
                          </button>
                        </div>
                      )}

                      <input
                        ref={(node) => {
                          fileInputRefs.current[background.id] = node
                        }}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(event) => handleFileChange(background, event)}
                      />
                    </div>
                  </div>

                  <div className="mt-auto">
                    {renderPositionControls(background)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

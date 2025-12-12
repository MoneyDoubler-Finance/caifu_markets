'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchJSON, getApiBaseUrl } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'
import { optimizeViaShortPixelIfEnabled } from '@/utils/media'
import type { TileBackground } from '@/types'

export const tileBackgroundQueryKey = ['tile-backgrounds'] as const

export function useTileBackgrounds() {
  return useQuery({
    queryKey: tileBackgroundQueryKey,
    queryFn: async () => {
      const url = `${API_BASE}/api/tile-backgrounds`
      const payload = await fetchJSON<{ backgrounds: TileBackground[] }>(url)
      const backgrounds = payload?.backgrounds ?? []
      let baseUrl: string | undefined
      try {
        baseUrl = getApiBaseUrl()
      } catch (err) {
        console.error('[tile backgrounds] failed to resolve API base URL', err)
      }
      const resolveUrl = (imageUrl: string) => {
        if (!imageUrl) return imageUrl
        if (/^https?:\/\//i.test(imageUrl)) return imageUrl
        const prefix = baseUrl || 'https://api.example.com'
        return `${prefix}${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`
      }

      return backgrounds.map((background) => {
        const absolute = resolveUrl(background.imageUrl)
        const optimized = optimizeViaShortPixelIfEnabled(absolute, 720) || absolute
        return {
          ...background,
          imageUrl: optimized,
        }
      })
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}

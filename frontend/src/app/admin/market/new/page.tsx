'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AdminNav from '@/components/AdminNav'
import { fetchJSON, uploadMarketHeroImage, ApiRequestError } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'

export default function AdminMarketNew() {
  const [formData, setFormData] = useState({
    question: '',
    outcomes: 'Yes,No',
    resolution: '',
    category: '',
    tags: '',
    feeBps: 200,
    initialPriceBps: 5000
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const [heroFile, setHeroFile] = useState<File | null>(null)
  const [heroPreview, setHeroPreview] = useState<string | null>(null)
  const [heroUploadError, setHeroUploadError] = useState<string | null>(null)
  const [isUploadingHero, setIsUploadingHero] = useState(false)

  useEffect(() => {
    return () => {
      if (heroPreview) {
        URL.revokeObjectURL(heroPreview)
      }
    }
  }, [heroPreview])

  const handleHeroFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setHeroUploadError(null)
    const file = event.target.files?.[0]

    if (!file) {
      if (heroPreview) {
        URL.revokeObjectURL(heroPreview)
      }
      setHeroFile(null)
      setHeroPreview(null)
      return
    }

    if (heroPreview) {
      URL.revokeObjectURL(heroPreview)
    }

    setHeroFile(file)
    setHeroPreview(URL.createObjectURL(file))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const trimmedQuestion = formData.question.trim()
    const outcomes = formData.outcomes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2)

    if (!trimmedQuestion) {
      setLoading(false)
      setError('Question is required.')
      return
    }

    if (outcomes.length !== 2) {
      setLoading(false)
      setError('Binary markets require exactly two outcomes (e.g., Yes,No).')
      return
    }

    const resolutionIso = formData.resolution && !Number.isNaN(Date.parse(formData.resolution))
      ? new Date(formData.resolution).toISOString()
      : null

    if (!resolutionIso) {
      setLoading(false)
      setError('Resolution / expiry date is required.')
      return
    }

    const category = formData.category.trim()
    const sanitizedCategory = category.length >= 2 ? category : undefined

    const tags = Array.from(
      new Map(
        formData.tags
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length >= 2)
          .map((value) => [value.toLowerCase(), value] as const)
      ).values()
    )

    setHeroUploadError(null)

    let heroImageUrl: string | null | undefined = undefined
    if (heroFile) {
      setIsUploadingHero(true)
      try {
        heroImageUrl = await uploadMarketHeroImage(heroFile)
      } catch (uploadErr: any) {
        const message = uploadErr instanceof Error ? uploadErr.message : 'Failed to upload hero image.'
        setHeroUploadError(message)
        setError(message)
        setLoading(false)
        setIsUploadingHero(false)
        return
      }
      setIsUploadingHero(false)
    }

    const payload = {
      question: trimmedQuestion,
      outcomes,
      resolution: resolutionIso,
      feeBps: Number(formData.feeBps),
      initialPriceBps: Number(formData.initialPriceBps),
      category: sanitizedCategory,
      tags,
      heroImageUrl: heroImageUrl ?? null,
    }

    try {
      const url = `${API_BASE}/api/markets`
      const result = await fetchJSON<{ id: string; slug?: string | null }>(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      setLoading(false)

      if (result?.id) {
        const slug = typeof result.slug === 'string' && result.slug.trim().length > 0 ? result.slug.trim() : null
        const fallbackId = result.id.trim()
        const destination = slug || fallbackId
        router.push(`/markets/${destination}`)
        if (heroPreview) {
          URL.revokeObjectURL(heroPreview)
        }
        setHeroFile(null)
        setHeroPreview(null)
        setHeroUploadError(null)
        return
      }

      setError('Market created but response was incomplete. Check admin dashboard for status.')
    } catch (err) {
      setLoading(false)
      if (err instanceof ApiRequestError && err.body && typeof err.body === 'object' && Array.isArray((err.body as any).issues)) {
        const issues = (err.body as any).issues as Array<{ path?: string; message?: string }>
        const details = issues
          .map((issue) => {
            if (!issue || typeof issue !== 'object') return null
            const path = typeof issue.path === 'string' && issue.path.length > 0 ? issue.path : 'field'
            const message = typeof issue.message === 'string' ? issue.message : 'Invalid value'
            return `${path}: ${message}`
          })
          .filter(Boolean)
          .join('; ')
        setError(details || err.message || 'Failed to create market')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create market')
      }
    }
  }

  const handleInputChange = (field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8">
        <AdminNav />
        <h1 className="text-3xl font-bold text-white mb-2">Create New Market</h1>
        <p className="text-[var(--text-muted)]">Create a new prediction market</p>
      </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="question" className="block text-sm font-medium text-white mb-2">
              Question *
            </label>
            <textarea
              id="question"
              required
              value={formData.question}
              onChange={(e) => handleInputChange('question', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
              placeholder="e.g., Will Bitcoin reach $100k by end of 2024?"
              rows={3}
            />
          </div>

          <div>
            <label htmlFor="category" className="block text-sm font-medium text-white mb-2">
              Category
            </label>
            <input
              id="category"
              type="text"
              value={formData.category}
              onChange={(e) => handleInputChange('category', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
              placeholder="Politics"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Optional. Helps power tile backgrounds and filtering.
            </p>
          </div>

          <div>
            <label htmlFor="tags" className="block text-sm font-medium text-white mb-2">
              Tags (comma-separated)
            </label>
            <input
              id="tags"
              type="text"
              value={formData.tags}
              onChange={(e) => handleInputChange('tags', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
              placeholder="Government, Shutdown"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Optional. We&apos;ll match uploaded tile backgrounds against these tags.
            </p>
          </div>

          <div>
            <label htmlFor="heroImage" className="block text-sm font-medium text-white mb-2">
              Hero Image
            </label>
            <input
              id="heroImage"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleHeroFileChange}
              className="block w-full text-sm text-white file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[var(--primary-yellow)] file:text-black hover:file:bg-[var(--primary-yellow)]/90"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Optional. Upload a wide image (4:3 or 16:9) to display behind this market&apos;s tile.
            </p>
            {heroPreview && (
              <div className="mt-3 h-32 overflow-hidden rounded-lg border border-[var(--border-color)]">
                <img src={heroPreview} alt="Hero preview" className="h-full w-full object-cover" />
              </div>
            )}
            {heroUploadError && (
              <p className="text-xs text-red-400 mt-1">{heroUploadError}</p>
            )}
          </div>

          <div>
            <label htmlFor="outcomes" className="block text-sm font-medium text-white mb-2">
              Outcomes (comma-separated)
            </label>
            <input
              id="outcomes"
              type="text"
              value={formData.outcomes}
              onChange={(e) => handleInputChange('outcomes', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
              placeholder="Yes,No"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Default: Yes,No (for binary markets)
            </p>
          </div>

          <div>
            <label htmlFor="resolution" className="block text-sm font-medium text-white mb-2">
              Resolution / Expiry Date/Time *
            </label>
            <input
              id="resolution"
              type="datetime-local"
              required
              value={formData.resolution}
              onChange={(e) => handleInputChange('resolution', e.target.value)}
              className="w-full px-3 py-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Required. Trades remain open until this time.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="feeBps" className="block text-sm font-medium text-white mb-2">
                LP Fee (bps)
              </label>
              <input
                id="feeBps"
                type="number"
                min="0"
                max="10000"
                value={formData.feeBps}
                onChange={(e) => handleInputChange('feeBps', parseInt(e.target.value))}
                className="w-full px-3 py-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Default: 200 (2%)
              </p>
            </div>

            <div>
              <label htmlFor="initialPriceBps" className="block text-sm font-medium text-white mb-2">
                Initial Price (bps)
              </label>
              <input
                id="initialPriceBps"
                type="number"
                min="0"
                max="10000"
                value={formData.initialPriceBps}
                onChange={(e) => handleInputChange('initialPriceBps', parseInt(e.target.value))}
                className="w-full px-3 py-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] focus:border-transparent"
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Default: 5000 (50%)
              </p>
            </div>
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 border border-red-500/30 rounded-lg p-3">
              {error}
            </div>
          )}

          <div className="flex space-x-4">
            <button
              type="submit"
              disabled={loading || isUploadingHero}
              className="flex-1 flex justify-center py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-black bg-[var(--primary-yellow)] hover:bg-[var(--primary-yellow)]/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--primary-yellow)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading || isUploadingHero ? 'Creating Market...' : 'Create Market'}
            </button>

            <Link
              href="/"
              className="flex-1 flex justify-center py-2 px-4 border border-[var(--border-color)] rounded-lg shadow-sm text-sm font-medium text-white bg-transparent hover:bg-[var(--hover-background)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--primary-yellow)]"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}

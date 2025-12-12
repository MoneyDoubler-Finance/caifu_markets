'use client'

import { useEffect, useState } from 'react'
import { isApiConfigured } from '@/lib/api'

export default function ApiConfigBanner() {
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return

    const config = isApiConfigured()
    
    // Show banner if:
    // 1. API is misconfigured
    // 2. AND (not production OR is vercel.app domain)
    const isVercel = window.location.host.endsWith('.vercel.app')
    const isLocalhost = window.location.host.includes('localhost')
    const shouldShow = !config.valid && (isVercel || isLocalhost || process.env.NODE_ENV !== 'production')

    if (shouldShow) {
      setError(config.error || 'API base URL is not configured')
      setShow(true)
    }
  }, [])

  if (!show) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-3 shadow-lg">
      <div className="max-w-7xl mx-auto flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="font-bold text-sm mb-1">⚠️ API Configuration Error</p>
          <p className="text-xs opacity-90">{error}</p>
          <p className="text-xs opacity-75 mt-1">
            Expected: <code className="bg-red-700 px-1 py-0.5 rounded">NEXT_PUBLIC_API_BASE_URL=https://api.example.com</code>
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/debug"
            className="text-xs bg-white text-red-600 px-3 py-1 rounded font-medium hover:bg-red-50 transition-colors whitespace-nowrap"
          >
            Debug Info
          </a>
          <button
            onClick={() => setShow(false)}
            className="text-xs bg-red-700 px-3 py-1 rounded font-medium hover:bg-red-800 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

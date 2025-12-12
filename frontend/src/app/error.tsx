'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to console
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-white mb-2">Something went wrong</h2>
          <p className="text-[var(--text-muted)] mb-4">
            An error occurred while loading this page.
          </p>
        </div>

        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400 text-sm font-mono break-all">
            {error.message || 'Unknown error'}
          </p>
          {error.digest && (
            <p className="text-red-400/60 text-xs mt-2">
              Error ID: {error.digest}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <button
            onClick={reset}
            className="w-full py-2 px-4 bg-[var(--primary-yellow)] text-black rounded-lg font-medium hover:bg-[var(--primary-yellow)]/90 transition-colors"
          >
            Try Again
          </button>
          <a
            href="/"
            className="block w-full py-2 px-4 bg-[var(--card-background)] text-white rounded-lg font-medium hover:bg-[var(--hover-background)] transition-colors text-center"
          >
            Go Home
          </a>
        </div>

        <div className="text-center">
          <a
            href="/debug"
            className="text-[var(--text-muted)] hover:text-white text-sm"
          >
            View Debug Info →
          </a>
        </div>
      </div>
    </div>
  )
}

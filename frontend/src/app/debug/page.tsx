'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { fetchJSON, getApiBaseUrl, isApiConfigured, ApiRequestError } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'

export default function DebugPage() {
  const [healthStatus, setHealthStatus] = useState<any>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const apiConfig = isApiConfigured()
  const baseUrl = getApiBaseUrl()

  useEffect(() => {
    const checkHealth = async () => {
      setLoading(true)
      try {
        const payload = await fetchJSON(`${API_BASE}/api/health`)
        setHealthStatus(payload)
        setHealthError(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Health check failed'
        setHealthStatus(null)
        setHealthError(message)
      } finally {
        setLoading(false)
      }
    }

    if (apiConfig.valid) {
      checkHealth()
    } else {
      setLoading(false)
    }
  }, [apiConfig.valid])

  return (
    <div className="min-h-screen bg-[var(--background)] p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-white">Debug Information</h1>
          <Link 
            href="/"
            className="text-[var(--text-muted)] hover:text-white text-sm"
          >
            ← Back to Home
          </Link>
        </div>

        {/* API Configuration Status */}
        <div className={`border rounded-lg p-6 ${
          apiConfig.valid 
            ? 'bg-green-900/20 border-green-500/30' 
            : 'bg-red-900/20 border-red-500/30'
        }`}>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            {apiConfig.valid ? '✅' : '❌'} API Configuration
          </h2>
          
          <div className="space-y-3">
            <div>
              <p className="text-sm text-[var(--text-muted)] mb-1">NEXT_PUBLIC_API_BASE_URL</p>
              <code className={`text-sm px-3 py-2 rounded block ${
                apiConfig.valid ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
              }`}>
                {baseUrl || '(not set)'}
              </code>
            </div>

            {!apiConfig.valid && (
              <div className="mt-4 p-4 bg-red-900/40 border border-red-500/50 rounded">
                <p className="text-red-400 font-bold mb-2">⚠️ Configuration Error</p>
                <p className="text-red-300 text-sm mb-2">{apiConfig.error}</p>
                <p className="text-red-200 text-xs">
                  Expected: <code className="bg-red-900/50 px-2 py-1 rounded">https://api.example.com</code>
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[var(--border-color)]">
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">Status</p>
                <p className={`text-sm font-mono ${apiConfig.valid ? 'text-green-400' : 'text-red-400'}`}>
                  {apiConfig.valid ? 'VALID' : 'INVALID'}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">Protocol</p>
                <p className="text-sm font-mono text-white">
                  {baseUrl?.startsWith('https://') ? 'HTTPS ✓' : baseUrl?.startsWith('http://') ? 'HTTP' : 'N/A'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Health Check Status */}
        <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">API Health Check</h2>
          
          {loading ? (
            <div className="text-[var(--text-muted)]">Checking API health...</div>
          ) : healthError ? (
            <div className="bg-red-900/20 border border-red-500/30 rounded p-4">
              <p className="text-red-400 text-sm">❌ {healthError}</p>
            </div>
          ) : healthStatus ? (
            <div className="space-y-4">
              <div className="bg-green-900/20 border border-green-500/30 rounded p-4">
                <p className="text-green-400 text-sm">✅ API is responding</p>
              </div>
              
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-[var(--text-muted)] mb-1">Status</p>
                    <p className="text-sm font-mono text-white">{healthStatus.status || 'unknown'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-muted)] mb-1">Version</p>
                    <p className="text-sm font-mono text-white">{healthStatus.version || 'unknown'}</p>
                  </div>
                </div>

                {healthStatus.ws && (
                  <div className="pt-3 border-t border-[var(--border-color)]">
                    <p className="text-xs text-[var(--text-muted)] mb-2">WebSocket Status</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-[var(--text-muted)]">Connections</p>
                        <p className="text-sm font-mono text-white">{healthStatus.ws.connections || 0}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--text-muted)]">Last Heartbeat</p>
                        <p className="text-sm font-mono text-white">
                          {healthStatus.ws.lastHeartbeatAt ? new Date(healthStatus.ws.lastHeartbeatAt).toLocaleTimeString() : 'N/A'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <details className="pt-3 border-t border-[var(--border-color)]">
                  <summary className="text-sm text-[var(--text-muted)] cursor-pointer hover:text-white">
                    View Full Response
                  </summary>
                  <pre className="mt-2 text-xs bg-[var(--background)] p-3 rounded overflow-auto max-h-64">
                    {JSON.stringify(healthStatus, null, 2)}
                  </pre>
                </details>
              </div>
            </div>
          ) : (
            <div className="text-[var(--text-muted)]">No health data available</div>
          )}
        </div>

        {/* Environment Info */}
        <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Environment</h2>
          
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">Host</p>
                <p className="text-sm font-mono text-white">{typeof window !== 'undefined' ? window.location.host : 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">Protocol</p>
                <p className="text-sm font-mono text-white">{typeof window !== 'undefined' ? window.location.protocol : 'N/A'}</p>
              </div>
            </div>
            
            <div className="pt-3 border-t border-[var(--border-color)]">
              <p className="text-xs text-[var(--text-muted)] mb-1">User Agent</p>
              <p className="text-xs font-mono text-white break-all">
                {typeof window !== 'undefined' ? navigator.userAgent : 'N/A'}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6">
          <h2 className="text-xl font-bold text-white mb-4">Quick Actions</h2>
          
          <div className="grid grid-cols-2 gap-4">
            <a
              href="/admin/login"
              className="block py-3 px-4 bg-[var(--primary-yellow)] text-black rounded-lg font-medium hover:bg-[var(--primary-yellow)]/90 transition-colors text-center"
            >
              Admin Login
            </a>
            <a
              href="/markets"
              className="block py-3 px-4 bg-[var(--hover-background)] text-white rounded-lg font-medium hover:bg-[var(--hover-background)]/80 transition-colors text-center"
            >
              View Markets
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

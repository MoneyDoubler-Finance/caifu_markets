'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error:', error)
  }, [error])

  return (
    <html>
      <body style={{ 
        margin: 0, 
        padding: 0, 
        fontFamily: 'system-ui, sans-serif',
        background: '#0a0a0a',
        color: '#ffffff',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ 
          maxWidth: '500px', 
          padding: '2rem',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>💥</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Critical Error
          </h1>
          <p style={{ 
            color: '#999', 
            marginBottom: '1.5rem',
            fontSize: '0.9rem'
          }}>
            A critical error occurred. The application cannot continue.
          </p>
          
          <div style={{
            background: 'rgba(220, 38, 38, 0.1)',
            border: '1px solid rgba(220, 38, 38, 0.3)',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '1.5rem',
            textAlign: 'left'
          }}>
            <code style={{ 
              fontSize: '0.75rem',
              color: '#fca5a5',
              wordBreak: 'break-all'
            }}>
              {error.message || 'Unknown error'}
            </code>
          </div>

          <button
            onClick={reset}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#fbbf24',
              color: '#000',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              marginBottom: '0.75rem'
            }}
          >
            Reload Application
          </button>

          <a
            href="/"
            style={{
              display: 'block',
              width: '100%',
              padding: '0.75rem',
              background: '#1f1f1f',
              color: '#fff',
              textDecoration: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600'
            }}
          >
            Go to Home
          </a>
        </div>
      </body>
    </html>
  )
}

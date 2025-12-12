'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnect } from 'wagmi'

export default function WalletConnectDebugPage() {
  const { connectors, connect, status, error, reset } = useConnect()
  const [uri, setUri] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const handlerRef = useRef<((payload: any) => void) | null>(null)

  const wc = useMemo(() => connectors.find((c) => c.type === 'walletConnect'), [connectors])

  useEffect(() => () => {
    // cleanup old handler on unmount
    if (wc && handlerRef.current && typeof (wc as any).off === 'function') {
      ;(wc as any).off('message', handlerRef.current)
    }
  }, [wc])

  const start = async () => {
    setUri(null)
    setLog((prev) => [...prev, 'starting walletconnect…'])
    if (!wc) {
      setLog((prev) => [...prev, 'walletconnect connector not found'])
      return
    }

    // subscribe to display_uri messages on connector
    const onMessage = (payload: any) => {
      try {
        if (payload?.type === 'display_uri' && typeof payload.data === 'string') {
          setUri(payload.data)
          setLog((prev) => [...prev, 'received display_uri'])
        }
      } catch {}
    }
    handlerRef.current = onMessage
    if (typeof (wc as any).on === 'function') {
      ;(wc as any).on('message', onMessage)
    }

    // also try to subscribe directly to WalletConnect provider events
    try {
      const provider: any = typeof (wc as any).getProvider === 'function' ? await (wc as any).getProvider() : null
      if (provider && typeof provider.on === 'function') {
        provider.on('display_uri', (u: string) => {
          if (typeof u === 'string') {
            setUri(u)
            setLog((prev) => [...prev, 'provider display_uri'])
          }
        })
      }
    } catch (e: any) {
      setLog((prev) => [...prev, `provider hook error: ${e?.message || String(e)}`])
    }

    try {
      await connect({ connector: wc })
      setLog((prev) => [...prev, 'connect() resolved'])
    } catch (err: any) {
      setLog((prev) => [...prev, `connect() error: ${err?.message || String(err)}`])
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4 text-sm">
      <h1 className="text-lg font-bold">WalletConnect Debug</h1>
      <p>Project ID detected: <code>{process.env.NEXT_PUBLIC_PROJECT_ID || 'not set'}</code></p>
      <div className="flex gap-2">
        <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={start}>
          Start WalletConnect
        </button>
        <button className="px-3 py-1 rounded bg-gray-700 text-white" onClick={() => { setUri(null); reset() }}>
          Reset
        </button>
      </div>
      <div className="space-y-2">
        <div>Status: <code>{status}</code>{error ? <span className="text-red-400"> — {String(error.message || error)}</span> : null}</div>
        {uri && (
          <div>
            <p className="font-semibold">Display URI</p>
            <textarea className="w-full h-28 p-2 bg-black/40 border border-gray-700 rounded" readOnly value={uri} />
          </div>
        )}
        <div>
          <p className="font-semibold">Log</p>
          <pre className="whitespace-pre-wrap bg-black/30 p-2 border border-gray-700 rounded max-h-48 overflow-auto">{log.join('\n')}</pre>
        </div>
      </div>
    </div>
  )
}

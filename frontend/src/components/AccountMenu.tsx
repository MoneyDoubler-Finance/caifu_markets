"use client"

import Link from 'next/link'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { UserCircle, LogIn, LogOut, Plug, PlugZap } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { toAbsoluteMediaUrl } from '@/utils/media'

function shortAddress(address?: string | null) {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function avatarInitials(name?: string | null, address?: string | null) {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(' ')
    if (parts.length > 1) {
      return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }
  if (address) {
    return address.slice(2, 4).toUpperCase()
  }
  return '??'
}

export default function AccountMenu() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const { user, signIn, signOut, isSigning } = useAuth()

  const [isOpen, setIsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const avatarSrc = useMemo(() => {
    if (!user?.avatarUrl) return null
    return toAbsoluteMediaUrl(user.avatarUrl)
  }, [user?.avatarUrl])

  const primaryLabel = useMemo(() => {
    if (user) return user.displayName ?? shortAddress(user.walletAddress)
    if (isConnected && address) return shortAddress(address)
    return 'Connect Wallet'
  }, [user, isConnected, address])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      window.addEventListener('click', handler)
    }
    return () => {
      window.removeEventListener('click', handler)
    }
  }, [isOpen])

  const resolveConnector = useCallback(async () => {
    if (!connectors?.length) {
      return null
    }

    for (const connector of connectors) {
      if (connector.type === 'walletConnect') {
        return connector
      }

      if (typeof connector.getProvider !== 'function') {
        return connector
      }

      try {
        const provider = await connector.getProvider()
        if (provider) {
          return connector
        }
      } catch (error) {
        // Continue to next connector
      }
    }

    return null
  }, [connectors])

  const handleConnect = async () => {
    setError(null)
    setConnecting(true)
    try {
      const connector = await resolveConnector()
      if (!connector) {
        throw new Error('No wallet connector is currently available. Please install a supported wallet extension or configure WalletConnect.')
      }
      await connect({ connector })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet'
      setError(message)
    } finally {
      setConnecting(false)
    }
  }

  const handleSignIn = async () => {
    setError(null)
    try {
      await signIn()
      setIsOpen(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign in'
      setError(message)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    setIsOpen(false)
  }

  const handleDisconnect = async () => {
    disconnect()
    setIsOpen(false)
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 px-3 py-2 rounded-full glass-card hover:bg-white/10 transition-all duration-200"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <div className="w-8 h-8 rounded-full bg-white/10 overflow-hidden flex items-center justify-center text-xs font-semibold text-white uppercase">
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarSrc} alt="Account avatar" className="w-full h-full object-cover object-center" />
          ) : user ? (
            avatarInitials(user.displayName, user.walletAddress)
          ) : (
            <UserCircle className="w-5 h-5 text-white/80" />
          )}
        </div>
        <span className="hidden sm:block text-sm font-medium text-white">
          {primaryLabel}
        </span>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-xl glass-card border border-white/10 shadow-xl p-3 z-50 backdrop-blur-md"
        >
          <div className="pb-3 border-b border-white/5 mb-3 flex items-start gap-3">
            <div className="w-12 h-12 rounded-full bg-white/10 overflow-hidden flex items-center justify-center text-sm font-semibold text-white uppercase shrink-0">
              {avatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarSrc} alt="Account avatar" className="w-full h-full object-cover object-center" />
              ) : (
                avatarInitials(user?.displayName, user?.walletAddress)
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">Account</p>
              <p className="text-sm text-white font-semibold">
                {user?.displayName ?? (address ? shortAddress(address) : 'Not connected')}
              </p>
              {address && (
                <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">{shortAddress(address)}</p>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-3 text-xs text-red-300 glass-card border border-red-500/30 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {!isConnected && (
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500/30 to-blue-500/30 border border-cyan-400/40 text-cyan-100 text-sm font-semibold transition hover:from-cyan-500/40 hover:to-blue-500/40 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Plug className="w-4 h-4" />
              {connecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
          )}

          {isConnected && !user && (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={isSigning}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[#62b78d]/40 to-[#4fa77d]/40 border border-[#62b78d]/40 text-emerald-100 text-sm font-semibold transition hover:from-[#62b78d]/50 hover:to-[#4fa77d]/50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <LogIn className="w-4 h-4" />
              {isSigning ? 'Signing…' : 'Sign in with wallet'}
            </button>
          )}

          {user && (
            <div className="space-y-2">
              <Link
                href="/profile"
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/10 border border-white/10 text-sm text-white font-semibold transition hover:bg-white/15"
                onClick={() => setIsOpen(false)}
              >
                <UserCircle className="w-4 h-4" />
                Manage profile
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 text-sm font-semibold transition hover:bg-red-500/20"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          )}

          {isConnected && (
            <button
              type="button"
              onClick={handleDisconnect}
              className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-xs text-[var(--text-secondary)] hover:text-white hover:bg-white/5 transition"
            >
              <PlugZap className="w-4 h-4" />
              Disconnect wallet
            </button>
          )}
        </div>
      )}
    </div>
  )
}

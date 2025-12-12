'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAccount, useConnect, useSignMessage } from 'wagmi'
import { fetchJSON, requestAuthNonce, verifyAuthSignature, logoutUser } from '@/lib/api'
import { API_BASE } from '@/lib/apiBase'
import type { SiteUser } from '@/types'

type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated'

type AuthContextValue = {
  user: SiteUser | null
  status: AuthStatus
  isSigning: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  connectWallet: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { signMessageAsync } = useSignMessage()

  const [user, setUser] = useState<SiteUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('idle')
  const [isSigning, setIsSigning] = useState(false)

  const loadMe = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await fetchJSON<{ ok: boolean; user: SiteUser | null }>(`${API_BASE}/api/auth/me`, {
        method: 'GET',
      })
      if (result?.ok && result.user) {
        setUser(result.user)
        setStatus('authenticated')
      } else {
        setUser(null)
        setStatus('unauthenticated')
      }
    } catch (error) {
      console.warn('[auth] failed to load session', error)
      setUser(null)
      setStatus('unauthenticated')
    }
  }, [])

  useEffect(() => {
    loadMe()
  }, [loadMe])

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
        // Ignore and try next connector
      }
    }

    return null
  }, [connectors])

  const ensureWalletConnection = useCallback(async () => {
    if (isConnected && address) {
      return
    }

    const connector = await resolveConnector()
    if (!connector) {
      throw new Error('No wallet connector is currently available. Please install a supported wallet extension or configure WalletConnect.')
    }
    await connect({ connector })
    await new Promise<void>((resolve) => setTimeout(resolve, 200))
  }, [address, connect, isConnected, resolveConnector])

  const signIn = useCallback(async () => {
    if (isSigning) return
    setIsSigning(true)
    try {
      await ensureWalletConnection()
      if (!address) {
        throw new Error('Wallet address unavailable')
      }

      const { nonce, message } = await requestAuthNonce(address)
      const signature = await signMessageAsync({ message })
      const authedUser = await verifyAuthSignature({
        address,
        signature,
        nonce,
      })

      setUser(authedUser)
      setStatus('authenticated')
    } catch (error) {
      console.error('[auth] sign in failed', error)
      throw error
    } finally {
      setIsSigning(false)
    }
  }, [address, ensureWalletConnection, isSigning, signMessageAsync])

  const signOut = useCallback(async () => {
    try {
      await logoutUser()
    } catch (error) {
      console.warn('[auth] failed to logout', error)
    } finally {
      setUser(null)
      setStatus('unauthenticated')
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    status,
    isSigning,
    signIn,
    signOut,
    connectWallet: ensureWalletConnection,
    refresh: loadMe,
  }), [user, status, isSigning, signIn, signOut, ensureWalletConnection, loadMe])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}

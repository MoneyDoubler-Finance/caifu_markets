"use client"

import { ReactNode, useMemo, useState, useEffect } from "react"
import { WagmiProvider } from "wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getClientConfig } from "@/lib/web3"
import Header from "./Header"
import ApiConfigBanner from "./ApiConfigBanner"
import { LiveMarketRibbon } from "./LiveMarketRibbon"
import { AuthProvider } from "@/contexts/AuthContext"
import { useIsMobile } from "@/hooks/useIsMobile"
import { usePauseAnimationsOnHidden } from "@/hooks/usePageVisibility"

interface LayoutProps {
  children: ReactNode
}

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: 15_000,
        gcTime: 10 * 60 * 1000,
        retry: 1,
        keepPreviousData: true,
      },
    },
  })

export default function Layout({ children }: LayoutProps) {
  const [queryClient] = useState<QueryClient>(() => createQueryClient())
  const [mounted, setMounted] = useState(false)
  const clientConfig = useMemo(() => getClientConfig(), [])
  const isMobile = useIsMobile()
  usePauseAnimationsOnHidden()

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    let cancelled = false

    import("@/lib/muteCoinbaseDevWarning")
      .then((m) => {
        if (!cancelled) {
          m.muteCoinbaseDevWarning()
        }
      })
      .catch(() => {
        // Ignore – warning muter is best-effort only
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Only check for IndexedDB after client-side hydration to avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  // During SSR or before hydration, show a loading placeholder that matches server HTML
  if (!mounted) {
    return (
      <div className="min-h-screen bg-[var(--background)] relative">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-[var(--text-secondary)]">Loading...</div>
        </div>
      </div>
    )
  }

  // After hydration, check if browser supports required features
  const hasIndexedDb = typeof window !== "undefined" && "indexedDB" in window

  if (!hasIndexedDb || !clientConfig) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-white flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold mb-2">Browser storage unavailable</p>
          <p className="text-sm text-[var(--text-secondary)]">
            Please disable private browsing or switch to a browser that supports IndexedDB so Caifu can load.
          </p>
        </div>
      </div>
    )
  }

  return (
    <WagmiProvider config={clientConfig}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ApiConfigBanner />
          <div className="min-h-screen bg-[var(--background)] relative">
            <Header isMobile={isMobile} />
            <LiveMarketRibbon />
            <main className="flex-1 relative z-10 pt-2 sm:pt-4 lg:pt-0">
              {children}
            </main>
          </div>
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

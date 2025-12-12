'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CreateMarketForm } from '@/components/CreateMarketForm'
import type { MarketCreationResponse } from '@/hooks/useApi'

export default function CreateMarketPage() {
  const router = useRouter()

  const handleSuccess = (market: MarketCreationResponse) => {
    const slug = typeof market?.slug === 'string' && market.slug.trim().length > 0 ? market.slug.trim() : null
    const fallbackId = typeof market?.id === 'string' && market.id.trim().length > 0 ? market.id.trim() : null
    const destination = slug || fallbackId
    if (destination) {
      router.push(`/markets/${destination}`)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] py-10">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8 space-y-2 text-center">
          <h1 className="text-3xl font-bold text-white">Create a Market</h1>
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto">
            Launch a new binary prediction market. This page mirrors the quick-create dialog
            available from the header and is open to every connected wallet.
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Looking for the swap interface?&nbsp;
            <Link href="/swap" className="text-cyan-300 hover:text-white underline">
              Visit the USDF swap page
            </Link>
            .
          </p>
        </div>

        <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl shadow-xl shadow-black/30 p-6 sm:p-10">
          <CreateMarketForm onSuccess={handleSuccess} />
        </div>
      </div>
    </div>
  )
}

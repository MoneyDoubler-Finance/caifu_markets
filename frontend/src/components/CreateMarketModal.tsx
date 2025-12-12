'use client'

import { useEffect } from 'react'
import { CreateMarketModalContent } from '@/components/CreateMarketForm'

interface CreateMarketModalProps {
  open: boolean
  onClose: () => void
}

export function CreateMarketModal({ open, onClose }: CreateMarketModalProps) {
  useEffect(() => {
    if (!open) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-3xl">
        <CreateMarketModalContent onClose={onClose} />
      </div>
    </div>
  )
}


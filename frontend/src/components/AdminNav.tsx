'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { label: 'Create New Market', href: '/admin/market/new' },
  { label: 'Edit Market', href: '/admin/edit' },
  { label: 'Resolve Market', href: '/admin/resolve' },
  { label: 'Manage Tile Backgrounds', href: '/admin/tile-backgrounds' },
  { label: 'Manage Tile Backgrounds 2', href: '/admin/tile-backgrounds-2' },
  { label: 'Tile Tags', href: '/admin/tile-tags' },
  { label: 'Manage Tags', href: '/admin/tags' },
  { label: 'Backfill Markets', href: '/admin/backfill' },
  { label: 'GAPE', href: '/admin/gape' },
]

export default function AdminNav() {
  const pathname = usePathname()

  return (
    <div className="mb-6 flex flex-wrap gap-3">
      {NAV_ITEMS.map((item) => {
        const active = pathname.startsWith(item.href)
        const base =
          'px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border'
        const activeClasses =
          'bg-[var(--primary-yellow)] text-black border-[var(--primary-yellow)] shadow-[0_0_12px_rgba(255,208,0,0.65)]'
        const inactiveClasses =
          'glass-card text-[var(--text-secondary)] border-[var(--border-color)] hover:text-white hover:border-[var(--primary-yellow)]'
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${base} ${active ? activeClasses : inactiveClasses}`}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Menu,
  X,
  Search,
  Settings,
  UserCircle,
  TrendingUp,
  Sparkles,
  Wallet,
  HelpCircle,
  ChevronRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CreateMarketModal } from '@/components/CreateMarketModal'
import { useAuth } from '@/contexts/AuthContext'
import AccountMenu from '@/components/AccountMenu'
import { MarketSearch } from '@/components/MarketSearch'

interface HeaderProps {
  isMobile?: boolean
}

type NavLink = {
  href: string
  label: string
  description?: string
  icon: LucideIcon
}

const primaryNavLinks: NavLink[] = [
  {
    href: '/markets',
    label: 'Markets',
    description: 'Browse and trade live outcomes',
    icon: TrendingUp,
  },
  {
    href: '/how-it-works',
    label: 'How it works',
    description: 'Mobile-friendly onboarding + docs',
    icon: HelpCircle,
  },
  {
    href: '/swap',
    label: 'Swap USDF',
    description: 'Fund your wallet with collateral',
    icon: Wallet,
  },
]

const utilityNavLinks: NavLink[] = [
  {
    href: '/profile',
    label: 'Profile',
    icon: UserCircle,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
  },
]

export default function Header({ isMobile = false }: HeaderProps) {
  if (isMobile) {
    return <MobileHeader />
  }
  return <DesktopHeader />
}

function DesktopHeader() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isCreateMarketOpen, setIsCreateMarketOpen] = useState(false)
  const { user } = useAuth()

  return (
    <>
      <header className="glass-nav sticky top-0 z-50">
        <div className="flex items-center h-16 px-4 relative">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--primary-yellow)] to-transparent opacity-60"></div>
          <div className="glow-orb w-[220px] h-[220px] bg-[rgba(255,215,107,0.45)] bottom-[-60px] left-6"></div>
          <Link href="/" className="flex items-center flex-shrink-0 mr-8 group">
            <Image
              src="/caifuyellow.png"
              alt="Caifu Markets"
              width={160}
              height={40}
              priority
              className="h-10 w-auto max-w-[160px] opacity-100 transition-all duration-300 group-hover:scale-105 group-hover:drop-shadow-[0_0_15px_rgba(255,208,0,0.5)]"
              onError={() => {
                console.error('Logo failed to load')
              }}
            />
          </Link>

          <div className="hidden md:flex flex-1 max-w-md ml-8">
            <MarketSearch
              className="w-full"
              inputClassName="search-input"
            />
          </div>

          <div className="flex items-center space-x-4 flex-shrink-0 ml-4">
            <Link href="/how-it-works" className="hidden sm:block text-[var(--text-secondary)] hover:text-white transition-all duration-300 text-sm hover:drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
              How it works
            </Link>

            <button
              onClick={() => setIsCreateMarketOpen(true)}
              className="hidden sm:flex items-center space-x-2 px-4 py-2 border border-red-500/40 text-red-400 hover:text-red-200 hover:bg-red-500/20 text-sm font-semibold rounded-lg transition-all duration-300 shadow-lg shadow-red-500/20 hover:shadow-red-500/40"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 5v14m-7-7h14"
                />
              </svg>
              <span className="uppercase tracking-wide">Create Market</span>
            </button>

            <AccountMenu />

            {user && (
              <Link
                href="/profile"
                className="hidden sm:flex items-center space-x-2 px-4 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--hover-background)] rounded-lg transition-all duration-300"
              >
                <UserCircle className="w-4 h-4" />
                <span className="text-sm font-medium">Profile</span>
              </Link>
            )}

            <Link
              href="/settings"
              className="hidden sm:flex items-center space-x-2 px-4 py-2 border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--hover-background)] rounded-lg transition-all duration-300"
            >
              <Settings className="w-4 h-4" />
              <span className="text-sm font-medium">Settings</span>
            </Link>

            <Link
              href="/swap"
              className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg border border-cyan-500/40 text-cyan-300 text-sm uppercase tracking-wide hover:bg-cyan-500/20 hover:text-white transition-all duration-300 shadow-lg shadow-cyan-500/20"
            >
              Swap USDF
            </Link>

            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="lg:hidden p-2 rounded-lg text-[var(--text-secondary)] hover:text-white hover:bg-[var(--hover-background)] transition-all duration-300"
              aria-label="Toggle navigation menu"
              aria-expanded={isMenuOpen}
              aria-controls="mobile-nav"
            >
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </header>
      {isMenuOpen && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={() => setIsMenuOpen(false)} aria-hidden />
          <div className="lg:hidden fixed top-16 inset-x-0 z-50 px-4 pb-6" id="mobile-nav">
            <div className="glass-card rounded-2xl border border-[var(--border-color)]/60 p-5 shadow-2xl max-h-[calc(100vh-4rem)] overflow-y-auto">
              <div className="mb-5">
                <MarketSearch
                  className="w-full"
                  inputClassName="w-full py-2 rounded-lg bg-[var(--background)]/80 border border-[var(--border-color)] text-sm focus:ring-2 focus:ring-[var(--primary-yellow)]"
                  onResultClick={() => setIsMenuOpen(false)}
                />
              </div>

              <div className="flex flex-col gap-3">
                {primaryNavLinks.map(({ href, label, description, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center justify-between rounded-xl border border-[var(--border-color)]/60 bg-[var(--background)]/70 px-4 py-3 hover:border-[var(--primary-yellow)]/60 transition"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full bg-[var(--hover-background)] flex items-center justify-center text-[var(--primary-yellow)]">
                        <Icon className="w-4 h-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-white">{label}</p>
                        {description && <p className="text-xs text-[var(--text-secondary)]">{description}</p>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      <CreateMarketModal open={isCreateMarketOpen} onClose={() => setIsCreateMarketOpen(false)} />
    </>
  )
}

function MobileHeader() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isCreateMarketOpen, setIsCreateMarketOpen] = useState(false)
  const pathname = usePathname()
  const { user } = useAuth()

  useEffect(() => {
    setIsDrawerOpen(false)
    setIsSearchOpen(false)
  }, [pathname])

  useEffect(() => {
    const shouldLock = isDrawerOpen || isSearchOpen
    if (!shouldLock) return

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isDrawerOpen, isSearchOpen])

  return (
    <>
      <header className="glass-nav sticky top-0 z-50">
        <div className="flex items-center h-16 px-4 gap-3">
          <Link href="/" className="flex items-center flex-shrink-0">
            <Image src="/caifuyellow.png" alt="Caifu Markets" width={120} height={32} className="h-8 w-auto" />
          </Link>

          <button
            onClick={() => setIsSearchOpen(true)}
            className="flex-1 min-w-[110px] max-w-[200px] inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--hover-background)]/60 text-left px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-white"
            aria-label="Search markets"
          >
            <Search className="w-4 h-4" />
            <span className="truncate">Search</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCreateMarketOpen(true)}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-gradient-to-br from-[var(--primary-yellow)]/80 to-[var(--accent-purple)]/60 text-black text-sm font-semibold shadow-lg"
              aria-label="Create market"
            >
              <Sparkles className="w-4 h-4" />
              <span>Create</span>
            </button>
            <AccountMenu />
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="p-2 rounded-full bg-[var(--hover-background)] text-[var(--text-secondary)] hover:text-white"
              aria-label="Open navigation drawer"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
      </header>

      {isSearchOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true">
          <div className="mt-16 mx-4 bg-[var(--background)] border border-[var(--border-color)] rounded-2xl p-4 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-white">Search markets</p>
              <button
                onClick={() => setIsSearchOpen(false)}
                className="p-1 rounded-full text-[var(--text-secondary)] hover:text-white"
                aria-label="Close search"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <MarketSearch
              className="w-full"
              inputClassName="w-full py-3 rounded-xl bg-[var(--hover-background)] border border-[var(--border-color)]"
              placeholder="Try elections, BTC, sports..."
              onResultClick={() => setIsSearchOpen(false)}
            />
          </div>
        </div>
      )}

      {isDrawerOpen && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70" onClick={() => setIsDrawerOpen(false)} aria-hidden />
          <div className="absolute inset-x-0 top-16 bottom-0 bg-[var(--background)] rounded-t-3xl border-t border-[var(--border-color)] p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">Navigation</p>
                <h3 className="text-lg font-semibold text-white">Quick actions</h3>
              </div>
              <button className="p-2 rounded-full bg-[var(--hover-background)]" onClick={() => setIsDrawerOpen(false)} aria-label="Close navigation drawer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              {primaryNavLinks.map(({ href, label, description, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setIsDrawerOpen(false)}
                  className="flex items-center justify-between rounded-2xl border border-[var(--border-color)]/60 px-4 py-3 hover:border-[var(--primary-yellow)]/60"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-[var(--hover-background)] flex items-center justify-center text-[var(--primary-yellow)]">
                      <Icon className="w-5 h-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">{label}</p>
                      {description && <p className="text-xs text-[var(--text-secondary)]">{description}</p>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
                </Link>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t border-[var(--border-color)] space-y-2">
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Account</p>
              {utilityNavLinks.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setIsDrawerOpen(false)}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border-color)]/50 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-white"
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              ))}
              {!user && (
                <p className="text-xs text-[var(--text-muted)]">
                  Connect your wallet from the avatar button to access profile features.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <CreateMarketModal open={isCreateMarketOpen} onClose={() => setIsCreateMarketOpen(false)} />
    </>
  )
}

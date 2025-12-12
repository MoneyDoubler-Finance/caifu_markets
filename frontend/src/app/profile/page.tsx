"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Camera, User2 } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { updateUserProfile, uploadProfileAvatar, fetchPortfolio } from "@/lib/api"
import type { PortfolioSnapshot } from "@/types"
import { toAbsoluteMediaUrl } from "@/utils/media"
import { formatNumber } from "@/utils/format"
import { formatEther } from "viem"

function initialsFromAddress(address?: string | null, fallback?: string | null) {
  if (fallback && fallback.trim().length > 1) {
    const parts = fallback.trim().split(" ")
    if (parts.length > 1) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase()
    }
    return fallback.slice(0, 2).toUpperCase()
  }
  if (!address) return "??"
  return address.slice(2, 4).toUpperCase()
}

export default function ProfilePage() {
  const { user, status, refresh, signIn, isSigning } = useAuth()
  const [displayName, setDisplayName] = useState("")
  const [avatarPath, setAvatarPath] = useState("")
  const [initialDisplayName, setInitialDisplayName] = useState("")
  const [initialAvatarPath, setInitialAvatarPath] = useState("")
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null)
  const [portfolioLoading, setPortfolioLoading] = useState(false)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!user) {
      setDisplayName("")
      setAvatarPath("")
      setInitialDisplayName("")
      setInitialAvatarPath("")
      setLocalPreview(null)
      return
    }
    const initialName = user.displayName ?? ""
    const initialAvatar = user.avatarUrl ?? ""
    setDisplayName(initialName)
    setInitialDisplayName(initialName)
    setAvatarPath(initialAvatar)
    setInitialAvatarPath(initialAvatar)
    setLocalPreview(initialAvatar ? toAbsoluteMediaUrl(initialAvatar) : null)
  }, [user])

  useEffect(() => {
    let cancelled = false

    const loadPortfolio = async () => {
      if (!user?.walletAddress) {
        setPortfolio(null)
        setPortfolioError(null)
        setPortfolioLoading(false)
        return
      }
      setPortfolioLoading(true)
      setPortfolioError(null)
      try {
        const snapshot = await fetchPortfolio(user.walletAddress)
        if (!cancelled) {
          setPortfolio(snapshot)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load wallet balances"
          setPortfolioError(message)
          setPortfolio(null)
        }
      } finally {
        if (!cancelled) {
          setPortfolioLoading(false)
        }
      }
    }

    loadPortfolio().catch(() => {})

    return () => {
      cancelled = true
    }
  }, [user?.walletAddress])

  const normalizedDisplayName = displayName.trim()
  const normalizedAvatarPath = avatarPath.trim()
  const normalizedInitialDisplayName = initialDisplayName.trim()
  const normalizedInitialAvatarPath = initialAvatarPath.trim()

  const isDirty =
    normalizedDisplayName !== normalizedInitialDisplayName ||
    normalizedAvatarPath !== normalizedInitialAvatarPath

  const avatarPreview = useMemo(() => {
    if (localPreview) return localPreview
    if (normalizedAvatarPath.length === 0) {
      return null
    }
    return toAbsoluteMediaUrl(normalizedAvatarPath)
  }, [localPreview, normalizedAvatarPath])

  const handleSubmit = async () => {
    if (!user) {
      setError("You need to sign in with your wallet before updating your profile.")
      return
    }
    if (uploading) {
      setError("Please wait until the avatar upload finishes.")
      return
    }
    if (!isDirty) {
      setError("There are no changes to save.")
      return
    }

    const payload: { displayName?: string; avatarUrl?: string | null } = {}

    if (normalizedDisplayName !== normalizedInitialDisplayName) {
      payload.displayName = normalizedDisplayName
    }

    if (normalizedAvatarPath !== normalizedInitialAvatarPath) {
      payload.avatarUrl = normalizedAvatarPath.length > 0 ? normalizedAvatarPath : null
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await updateUserProfile(payload)
      await refresh()
      setInitialDisplayName(normalizedDisplayName)
      setInitialAvatarPath(normalizedAvatarPath)
      setLocalPreview(
        normalizedAvatarPath.length > 0 ? toAbsoluteMediaUrl(normalizedAvatarPath) : null
      )
      setSuccess("Profile updated successfully.")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update profile"
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarSelect = async (file: File | undefined | null) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file for your avatar.")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Avatar must be 5MB or smaller.")
      return
    }

    const objectUrl = URL.createObjectURL(file)
    setLocalPreview(objectUrl)
    setUploading(true)
    setError(null)
    setSuccess(null)
    try {
      const uploadedUrl = await uploadProfileAvatar(file)
      setAvatarPath(uploadedUrl)
      setLocalPreview(toAbsoluteMediaUrl(uploadedUrl))
      setSuccess("Avatar uploaded. Don’t forget to save your profile.")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload avatar"
      setError(message)
      setLocalPreview(null)
      setAvatarPath(initialAvatarPath)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
      URL.revokeObjectURL(objectUrl)
    }
  }

  const handleRemoveAvatar = () => {
    setAvatarPath("")
    setLocalPreview(null)
    setError(null)
    setSuccess(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const formatTokenAmount = (value: string, fractionDigits: number = 4): string => {
    try {
      const decimal = parseFloat(formatEther(BigInt(value)))
      return formatNumber(decimal, decimal < 1 ? fractionDigits : 2)
    } catch {
      return formatNumber(0, fractionDigits)
    }
  }

  const positionsWithBalance = useMemo(() => {
    if (!portfolio?.positions) return []
    return portfolio.positions.filter((position) => {
      try {
        return BigInt(position.yesBalance) > 0n || BigInt(position.noBalance) > 0n
      } catch {
        return false
      }
    })
  }, [portfolio])

  if (status === "loading") {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center text-[var(--text-secondary)]">
        Loading profile…
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-4 text-center px-6">
        <h1 className="text-2xl font-semibold text-white">Sign in to manage your profile</h1>
        <p className="text-sm text-[var(--text-secondary)] max-w-md">
          Your wallet address powers your account. Connect your wallet and sign in to customise how
          your profile appears across markets.
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null)
            signIn().catch((err) => {
              const message = err instanceof Error ? err.message : "Failed to sign in"
              setError(message)
            })
          }}
          disabled={isSigning}
          className="btn-neon text-black font-semibold px-4 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSigning ? "Signing…" : "Sign in with wallet"}
        </button>
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-transparent via-[var(--background)] to-[var(--background)] pb-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 space-y-8">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Link href="/" className="inline-flex items-center gap-2 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to markets
          </Link>
        </div>

        <div className="glass-card rounded-2xl border border-[var(--border-color)]/60 p-6 sm:p-8 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-white/10 border border-white/10 overflow-hidden flex items-center justify-center text-white text-2xl font-semibold">
                  {avatarPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarPreview}
                      alt="Avatar preview"
                      className="w-full h-full object-cover object-center"
                    />
                  ) : (
                    initialsFromAddress(user.walletAddress, user.displayName)
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 bg-[var(--background)] border border-white/10 rounded-full p-1.5 text-[var(--text-secondary)]">
                  <Camera className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-white">Profile settings</h1>
                <p className="text-sm text-[var(--text-secondary)]">
                  Update how other traders see you across discussions and leaderboards.
                </p>
              </div>
            </div>
            <div className="px-3 py-2 rounded-full bg-white/5 border border-white/10 text-xs text-[var(--text-muted)] font-mono">
              {user.walletAddress}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <aside className="space-y-4">
              <div className="glass-card rounded-xl p-4 border border-white/10">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                  Tips
                </h2>
                <ul className="space-y-2 text-xs text-[var(--text-muted)]">
                  <li>Display names appear next to your comments in market chats.</li>
                  <li>Uploaded avatars are centered and cropped to fit the circular frame.</li>
                  <li>Leave fields blank to revert to address-based defaults.</li>
                </ul>
              </div>
            </aside>

            <section className="lg:col-span-2 space-y-6">
              <div className="glass-card rounded-xl border border-white/10 p-5 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-white mb-2" htmlFor="avatarUpload">
                    Avatar image
                  </label>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <p className="text-xs text-[var(--text-muted)] max-w-sm">
                      Upload PNG, JPG, WEBP, or GIF up to 5MB. Images are centered automatically so tall or wide photos fit the square preview.
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 rounded-lg bg-white/10 border border-white/15 text-sm text-white font-medium hover:bg-white/15 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={uploading}
                      >
                        {uploading ? "Uploading…" : "Upload new"}
                      </button>
                      {(normalizedAvatarPath || localPreview) && (
                        <button
                          type="button"
                          onClick={handleRemoveAvatar}
                          className="px-4 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:text-white hover:bg-white/10 transition disabled:opacity-60 disabled:cursor-not-allowed"
                          disabled={uploading}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    id="avatarUpload"
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => handleAvatarSelect(event.target.files?.[0])}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-white mb-2" htmlFor="displayName">
                    Display name
                  </label>
                  <input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(event) => {
                      setDisplayName(event.target.value)
                      setError(null)
                      setSuccess(null)
                    }}
                    maxLength={64}
                    placeholder="e.g. LiquidGlassMaximalist"
                    className="w-full rounded-lg bg-white/5 border border-white/10 text-sm text-white px-3 py-2 focus:outline-none focus:border-[var(--primary-yellow)] transition"
                  />
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    2 – 64 characters. Leave blank to fall back to your wallet alias.
                  </p>
                </div>
              </div>

              <div className="glass-card rounded-xl border border-white/10 p-5 space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Wallet</h2>
                    <p className="text-sm text-[var(--text-secondary)]">
                      Snapshot of your on-chain balances across BNB, USDF, and conditional tokens.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-lg bg-white/5 border border-white/10 p-4">
                    <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-1">
                      BNB Balance
                    </p>
                    <p className="text-2xl font-semibold text-white">
                      {portfolio ? `${formatTokenAmount(portfolio.bnbBalance)} BNB` : '—'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white/5 border border-white/10 p-4">
                    <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-1">
                      USDF Balance
                    </p>
                    <p className="text-2xl font-semibold text-white">
                      {portfolio ? `${formatTokenAmount(portfolio.usdfBalance)} USDF` : '—'}
                    </p>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                      Conditional Token Holdings
                    </p>
                    <span className="text-xs text-[var(--text-muted)]">
                      Balances update after each trade or redemption.
                    </span>
                  </div>

                  {portfolioLoading ? (
                    <div className="text-sm text-[var(--text-secondary)]">Loading balances…</div>
                  ) : portfolioError ? (
                    <div className="text-sm text-red-300 glass-card border border-red-500/40 bg-red-500/10 px-4 py-3 rounded-lg">
                      {portfolioError}
                    </div>
                  ) : positionsWithBalance.length === 0 ? (
                    <div className="text-sm text-[var(--text-secondary)] bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                      No conditional token holdings yet. Your future positions will appear here.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {positionsWithBalance.map((position) => {
                        const yesAmount = formatTokenAmount(position.yesBalance)
                        const noAmount = formatTokenAmount(position.noBalance)
                        const href = position.slug
                          ? `/markets/${position.slug}`
                          : `/markets/${position.marketId}`
                        return (
                          <Link
                            key={position.marketId}
                            href={href}
                            className="block rounded-lg bg-white/5 border border-white/10 px-4 py-3 hover:bg-white/10 transition"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-white">{position.title}</p>
                                <p className="text-xs text-[var(--text-secondary)] mt-1">
                                  Yes: <span className="text-white font-medium">{yesAmount}</span> • No:{" "}
                                  <span className="text-white font-medium">{noAmount}</span>
                                </p>
                              </div>
                              <span className="text-xs text-[var(--primary-yellow)] font-semibold">
                                View market →
                              </span>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="glass-card border border-red-500/40 bg-red-500/10 text-red-200 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              {success && (
                <div className="glass-card border border-emerald-400/30 bg-emerald-500/10 text-emerald-100 text-sm px-4 py-3 rounded-lg">
                  {success}
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDisplayName(initialDisplayName)
                    setAvatarUrl(initialAvatarUrl)
                    setLocalPreview(null)
                    setError(null)
                    setSuccess(null)
                    if (fileInputRef.current) {
                      fileInputRef.current.value = ""
                    }
                  }}
                  disabled={saving || uploading || !isDirty}
                  className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-white glass-card rounded-lg border border-white/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saving || uploading || !isDirty}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-[#62b78d] to-[#4fa77d] text-white text-sm font-semibold shadow-[0_0_20px_rgba(98,183,141,0.35)] hover:shadow-[0_0_25px_rgba(98,183,141,0.45)] transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <User2 className="w-4 h-4" />
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

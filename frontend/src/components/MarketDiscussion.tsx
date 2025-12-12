'use client'

import { useState } from 'react'
import { MessageCircle, SendHorizonal, ChevronDown } from 'lucide-react'
import type { MarketComment, SiteUser } from '@/types'
import { toAbsoluteMediaUrl } from '@/utils/media'

type MarketDiscussionProps = {
  comments: MarketComment[]
  user: SiteUser | null
  isSubmitting: boolean
  isSigningIn: boolean
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => Promise<void>
  onSubmit: (body: string) => Promise<void>
  onSignIn: () => Promise<void>
}

export default function MarketDiscussion({
  comments,
  user,
  isSubmitting,
  isSigningIn,
  hasMore,
  isLoading,
  onLoadMore,
  onSubmit,
  onSignIn,
}: MarketDiscussionProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const getCommentInitials = (displayName?: string | null, address?: string | null) => {
    if (displayName && displayName.trim().length > 0) {
      const parts = displayName.trim().split(' ')
      if (parts.length > 1) {
        return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
      }
      return displayName.slice(0, 2).toUpperCase()
    }
    if (address) {
      return address.slice(2, 4).toUpperCase()
    }
    return '??'
  }

  const handleSubmit = async () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      setError('Comment cannot be empty.')
      return
    }
    setError(null)
    try {
      await onSubmit(trimmed)
      setDraft('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to post comment'
      setError(message)
    }
  }

  const renderComment = (comment: MarketComment) => {
    const avatarSrc = comment.user.avatarUrl ? toAbsoluteMediaUrl(comment.user.avatarUrl) : null
    return (
      <div key={comment.id} className="glass-card border border-white/5 rounded-lg p-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-white/10 overflow-hidden flex items-center justify-center text-xs font-semibold text-white uppercase shrink-0">
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarSrc} alt={`${comment.user.displayName ?? 'User'} avatar`} className="w-full h-full object-cover object-center" />
            ) : (
              getCommentInitials(comment.user.displayName, comment.user.walletAddress)
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-sm font-semibold text-white">
                  {comment.user.displayName ?? comment.user.walletAddress.slice(0, 8)}
                </p>
                <p className="text-xs text-[var(--text-secondary)] font-mono">
                  {comment.user.walletAddress.slice(0, 6)}...{comment.user.walletAddress.slice(-4)}
                </p>
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                {new Date(comment.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="text-sm text-white whitespace-pre-wrap leading-5">
              {comment.body}
            </p>
            {comment.edited && (
              <p className="text-[10px] uppercase text-[var(--text-muted)] mt-2">Edited</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="glass-card rounded-xl border border-white/10 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-[var(--primary-yellow)]" />
          <h3 className="text-lg font-semibold text-white">Discussion</h3>
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoading}
            className="flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--text-secondary)] hover:text-white transition disabled:opacity-60"
          >
            {isLoading ? 'Loading…' : 'Load older'}
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="space-y-3">
        {comments.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] bg-white/5 border border-white/10 rounded-lg p-4 text-center">
            {isLoading ? 'Loading comments…' : 'No comments yet. Be the first to share your thoughts about this market.'}
          </div>
        ) : comments.map((comment) => renderComment(comment))}
      </div>

      <div className="border-t border-white/10 pt-4 space-y-3">
        {!user ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-[var(--text-secondary)]">
              Connect your wallet and sign in to participate in the conversation.
            </p>
            <button
              type="button"
              disabled={isSigningIn}
              onClick={async () => {
                setError(null)
                try {
                  await onSignIn()
                } catch (err) {
                  const message = err instanceof Error ? err.message : 'Failed to sign in'
                  setError(message)
                }
              }}
              className="btn-neon text-black text-sm font-bold px-4 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSigningIn ? 'Signing…' : 'Sign in with wallet'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                if (error) setError(null)
              }}
              placeholder="Share your thoughts..."
              rows={3}
              className="w-full rounded-lg bg-white/5 border border-white/10 text-sm text-white px-3 py-2 focus:outline-none focus:border-[var(--primary-yellow)] transition"
              maxLength={500}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-[var(--text-muted)]">
                {draft.length}/500 characters
              </p>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[#62b78d] to-[#4fa77d] text-white text-sm font-semibold shadow-[0_0_20px_rgba(98,183,141,0.35)] hover:shadow-[0_0_25px_rgba(98,183,141,0.45)] transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <SendHorizonal className="w-4 h-4" />
                {isSubmitting ? 'Posting…' : 'Post comment'}
              </button>
            </div>
            {error && (
              <p className="text-xs text-red-300">{error}</p>
            )}
          </div>
        )}
      </div>

      {!user && error && (
        <p className="text-xs text-red-300">{error}</p>
      )}
    </section>
  )
}

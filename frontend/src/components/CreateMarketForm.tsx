'use client'

import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useConnect, usePublicClient, useWriteContract, useReadContract } from 'wagmi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X, Plus, Minus } from 'lucide-react'
import { useCreateMarket, type MarketCreationResponse } from '@/hooks/useApi'
import { uploadMarketHeroImage } from '@/lib/api'
import { CONTRACT_ADDRESSES, TARGET_CHAIN_ID } from '@/lib/web3'
import { ERC20_ABI, FPMM_ABI } from '@/lib/amm'
import { formatUnits, parseUnits, type Address } from 'viem'

type FormState = {
  question: string
  outcomes: string[]
  resolution: string
  category: string
  tags: string
  initialLiquidity: string
}

const MIN_INITIAL_LIQUIDITY = 0

const DEFAULT_FORM: FormState = {
  question: '',
  outcomes: ['Yes', 'No'],
  resolution: '',
  category: '',
  tags: '',
  initialLiquidity: MIN_INITIAL_LIQUIDITY.toString(),
}

export interface CreateMarketFormProps {
  compact?: boolean
  onCancel?: () => void
  onSuccess?: (response: MarketCreationResponse) => void
}

export function CreateMarketForm({ compact = false, onCancel, onSuccess }: CreateMarketFormProps) {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const createMarketMutation = useCreateMarket()

  const { data: usdfBalanceRaw, isLoading: isUsdfBalanceLoading } = useReadContract({
    address: CONTRACT_ADDRESSES.usdf,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: {
      enabled: Boolean(address),
    },
  })

  const usdfBalance = useMemo(() => {
    if (!usdfBalanceRaw) return 0
    try {
      return Number(formatUnits(usdfBalanceRaw as bigint, 18))
    } catch {
      return 0
    }
  }, [usdfBalanceRaw])

  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [heroFile, setHeroFile] = useState<File | null>(null)
  const [heroPreview, setHeroPreview] = useState<string | null>(null)
  const [heroUploadError, setHeroUploadError] = useState<string | null>(null)
  const [isUploadingHero, setIsUploadingHero] = useState(false)
  const [isFunding, setIsFunding] = useState(false)
  const [fundingStep, setFundingStep] = useState<'idle' | 'approving' | 'funding'>('idle')
  const isSubmitting = createMarketMutation.isPending || isUploadingHero || isFunding

  const hasMinOutcomes = useMemo(
    () => form.outcomes.filter((value) => value.trim().length > 0).length >= 2,
    [form.outcomes]
  )

  const outcomeLimitReached = form.outcomes.length >= 2

  const handleOutcomeChange = (index: number, value: string) => {
    setForm((prev) => {
      const outcomes = [...prev.outcomes]
      outcomes[index] = value
      return { ...prev, outcomes }
    })
  }

  const removeOutcome = (index: number) => {
    setForm((prev) => ({
      ...prev,
      outcomes: prev.outcomes.filter((_, i) => i !== index),
    }))
  }

  const addOutcome = () => {
    if (form.outcomes.length >= 2) return
    setForm((prev) => ({
      ...prev,
      outcomes: [...prev.outcomes, ''],
    }))
  }

  const resetStatus = () => {
    setError(null)
    setSuccess(null)
    setFieldErrors({})
    setHeroUploadError(null)
    setFundingStep('idle')
  }

  const fundMarketWithWallet = async (fpmmAddress: Address, amount: number) => {
    if (!publicClient) {
      throw new Error('Wallet RPC client not available. Please refresh and try again.')
    }

    const liquidityWei = parseUnits(amount.toString(), 18)
    setIsFunding(true)
    setFundingStep('approving')

    const approvalHash = await writeContractAsync({
      address: CONTRACT_ADDRESSES.usdf,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [fpmmAddress, liquidityWei],
      chainId: TARGET_CHAIN_ID,
    })

    await publicClient.waitForTransactionReceipt({ hash: approvalHash })
    setFundingStep('funding')

    const addFundingHash = await writeContractAsync({
      address: fpmmAddress,
      abi: FPMM_ABI,
      functionName: 'addFunding',
      // Once the pool is already seeded (backend auto-seeds 100 USDF),
      // the FPMM requires distributionHint to be empty. Using [] also works
      // for first-time funding, so prefer the universally safe path.
      args: [liquidityWei, []],
      chainId: TARGET_CHAIN_ID,
    })

    await publicClient.waitForTransactionReceipt({ hash: addFundingHash })
    setFundingStep('idle')
    setIsFunding(false)
  }

  useEffect(() => {
    return () => {
      if (heroPreview) {
        URL.revokeObjectURL(heroPreview)
      }
    }
  }, [heroPreview])

  const handleHeroFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    resetStatus()
    const file = event.target.files?.[0]

    if (!file) {
      if (heroPreview) {
        URL.revokeObjectURL(heroPreview)
      }
      setHeroFile(null)
      setHeroPreview(null)
      return
    }

    if (heroPreview) {
      URL.revokeObjectURL(heroPreview)
    }

    setHeroFile(file)
    setHeroPreview(URL.createObjectURL(file))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    resetStatus()

    if (!isConnected || !address) {
      setError('Please connect your wallet to create a market.')
      return
    }

    const trimmedQuestion = form.question.trim()
    const sanitizedOutcomes = form.outcomes
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    if (trimmedQuestion.length < 5) {
      setError('Enter a descriptive market question (at least 5 characters).')
      return
    }

    if (sanitizedOutcomes.length !== 2) {
      setError('Binary markets require exactly two outcomes.')
      return
    }

    const resolutionIso =
      form.resolution && !Number.isNaN(Date.parse(form.resolution))
        ? new Date(form.resolution).toISOString()
        : null

    const liquidityValue = Number(form.initialLiquidity)
    if (!Number.isFinite(liquidityValue) || liquidityValue < MIN_INITIAL_LIQUIDITY) {
      setFieldErrors((prev) => ({
        ...prev,
        initialLiquidity: `Initial liquidity must be non-negative.`,
      }))
      setError(`Initial liquidity must be non-negative.`)
      return
    }

    if (liquidityValue > 0 && usdfBalance < liquidityValue) {
      setError(`You need at least ${liquidityValue.toFixed(2)} USDF in your wallet to seed this pool (currently ${usdfBalance.toFixed(2)}).`)
      return
    }

    const category = form.category.trim()
    const sanitizedCategory = category.length >= 2 ? category : undefined

    const tagValues = Array.from(
      new Map(
        form.tags
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length >= 2)
          .map((value) => [value.toLowerCase(), value] as const)
      ).values()
    )

    try {
      let heroImageUrl: string | null | undefined = undefined
      if (heroFile) {
        setIsUploadingHero(true)
        try {
          heroImageUrl = await uploadMarketHeroImage(heroFile)
        } catch (uploadErr: any) {
          const message = uploadErr instanceof Error ? uploadErr.message : 'Failed to upload hero image.'
          setHeroUploadError(message)
          setIsUploadingHero(false)
          return
        }
        setIsUploadingHero(false)
      }

      const response = await createMarketMutation.mutateAsync({
        question: trimmedQuestion,
        outcomes: sanitizedOutcomes.slice(0, 2),
        resolution: resolutionIso,
        category: sanitizedCategory,
        tags: tagValues,
        heroImageUrl: heroImageUrl ?? null,
        initialLiquidity: liquidityValue,
        creatorAddress: address,
      })

      if (response.requiresUserFunding && response.fpmmAddress) {
        try {
          await fundMarketWithWallet(response.fpmmAddress as Address, liquidityValue)
        } catch (fundErr: any) {
          setIsFunding(false)
          setFundingStep('idle')
          const message =
            fundErr?.shortMessage ||
            fundErr?.message ||
            'Funding transaction failed. Please try again from your wallet.'
          setError(message)
          return
        }
      }

      setSuccess(response.requiresUserFunding ? 'Market created and funded successfully.' : 'Market created successfully.')
      setFieldErrors({})
      setForm(DEFAULT_FORM)
      if (heroPreview) {
        URL.revokeObjectURL(heroPreview)
      }
      setHeroFile(null)
      setHeroPreview(null)
      if (onSuccess) {
        onSuccess(response)
      } else {
        const target = (response?.slug && typeof response.slug === 'string' && response.slug.trim())
          ? response.slug.trim()
          : response?.id
        if (target) {
          router.push(`/markets/${target}`)
        }
      }
    } catch (submitError: any) {
      setIsUploadingHero(false)
      setIsFunding(false)
      setFundingStep('idle')
      const issues = submitError?.issues || submitError?.response?.issues || submitError?.data?.issues
      if (Array.isArray(issues) && issues.length > 0) {
        const mapped: Record<string, string> = {}
        for (const issue of issues) {
          if (!issue || typeof issue !== 'object') continue
          const path = typeof issue.path === 'string' ? issue.path : ''
          const message = typeof issue.message === 'string' ? issue.message : 'Invalid value'
          if (path) {
            mapped[path] = message
          }
        }
        setFieldErrors(mapped)
        setError('Fix the highlighted fields and try again.')
      } else {
        const message =
          submitError?.message ||
          submitError?.response?.error ||
          'Failed to create market. Please try again.'
        setError(message)
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="question" className="text-white text-sm">
          Market Question
        </Label>
        <Input
          id="question"
          value={form.question}
          onChange={(event) => {
            resetStatus()
            setForm((prev) => ({ ...prev, question: event.target.value }))
          }}
          placeholder="Will ETH reach $5k by the end of 2024?"
          className="bg-[var(--input-background)] border-[var(--border-color)] text-white placeholder-[var(--text-muted)]"
          required
        />
        {fieldErrors.question && (
          <p className="text-xs text-red-400">{fieldErrors.question}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="category" className="text-white text-sm">
          Category
        </Label>
        <Input
          id="category"
          value={form.category}
          onChange={(event) => {
            resetStatus()
            setForm((prev) => ({ ...prev, category: event.target.value }))
          }}
          placeholder="Politics"
          className="bg-[var(--input-background)] border-[var(--border-color)] text-white placeholder-[var(--text-muted)]"
        />
        <p className="text-xs text-[var(--text-muted)]">
          Optional. Helps group related markets and drives tile backgrounds.
        </p>
        {fieldErrors.category && (
          <p className="text-xs text-red-400">{fieldErrors.category}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags" className="text-white text-sm">
          Tags (comma separated)
        </Label>
        <Input
          id="tags"
          value={form.tags}
          onChange={(event) => {
            resetStatus()
            setForm((prev) => ({ ...prev, tags: event.target.value }))
          }}
          placeholder="Taylor Swift, Israel"
          className="bg-[var(--input-background)] border-[var(--border-color)] text-white placeholder-[var(--text-muted)]"
        />
        <p className="text-xs text-[var(--text-muted)]">
          Optional. We&apos;ll match uploaded tile backgrounds against these tags.
        </p>
        {fieldErrors.tags && (
          <p className="text-xs text-red-400">{fieldErrors.tags}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="heroImage" className="text-white text-sm">
          Hero Image
        </Label>
        <input
          id="heroImage"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleHeroFileChange}
          className="block w-full text-sm text-white file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[var(--primary-yellow)] file:text-black hover:file:bg-[var(--primary-yellow-hover)]"
        />
        <p className="text-xs text-[var(--text-muted)]">
          Optional. Recommended 4:3 image (at least 1200px). This will appear behind your market tile.
        </p>
        {heroPreview && (
          <div className="relative mt-3 h-32 overflow-hidden rounded-lg border border-[var(--border-color)]">
            <img src={heroPreview} alt="Hero preview" className="h-full w-full object-cover" />
          </div>
        )}
        {heroUploadError && (
          <p className="text-xs text-red-400">{heroUploadError}</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-white text-sm">Outcomes</Label>
          <Button
            type="button"
            variant="ghost"
            onClick={addOutcome}
            disabled={outcomeLimitReached}
            className="flex items-center gap-2 text-xs text-[var(--primary-yellow)] hover:text-white hover:bg-[var(--hover-background)] px-2 py-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            Add outcome
          </Button>
        </div>

        <div className="space-y-2">
          {form.outcomes.map((outcome, index) => {
            const outcomeError = fieldErrors[`outcomes[${index}]`] || fieldErrors.outcomes
            return (
              <div key={index} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={outcome}
                    onChange={(event) => {
                      resetStatus()
                      handleOutcomeChange(index, event.target.value)
                    }}
                    placeholder={`Outcome ${index + 1}`}
                    className="bg-[var(--input-background)] border-[var(--border-color)] text-white placeholder-[var(--text-muted)]"
                    required
                  />
                  {form.outcomes.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        resetStatus()
                        removeOutcome(index)
                      }}
                      className="p-2 text-red-400 hover:text-white hover:bg-red-500/20"
                      aria-label={`Remove outcome ${index + 1}`}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                {outcomeError && (
                  <p className="text-xs text-red-400">{outcomeError}</p>
                )}
              </div>
            )
          })}
        </div>
        {!hasMinOutcomes && (
          <p className="text-xs text-red-400">At least two outcomes are required.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="resolution" className="text-white text-sm">
          Resolution (optional)
        </Label>
        <Input
          id="resolution"
          type="datetime-local"
          value={form.resolution}
          onChange={(event) => {
            resetStatus()
            setForm((prev) => ({ ...prev, resolution: event.target.value }))
          }}
          className="bg-[var(--input-background)] border-[var(--border-color)] text-white placeholder-[var(--text-muted)]"
        />
        <p className="text-xs text-[var(--text-muted)]">
          If blank, the market defaults to resolving in seven days.
        </p>
        {fieldErrors.resolution && (
          <p className="text-xs text-red-400">{fieldErrors.resolution}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="initialLiquidity" className="text-white text-sm">
          Initial Liquidity (USDF)
        </Label>
        <Input
          id="initialLiquidity"
          type="number"
          min={MIN_INITIAL_LIQUIDITY}
          step="0.01"
          value={form.initialLiquidity}
          onChange={(event) => {
            resetStatus()
            setForm((prev) => ({ ...prev, initialLiquidity: event.target.value }))
          }}
          className="bg-[var(--input-background)] border-[var(--border-color)] text-white placeholder-[var(--text-muted)]"
          placeholder={`Enter USDF to add (optional)`}
        />
        <p className="text-xs text-[var(--text-muted)]">Optional: add USDF from your wallet.</p>
        {isConnected && (
          <p className="text-xs text-[var(--text-secondary)]">
            Wallet balance: {isUsdfBalanceLoading ? 'Checking…' : `${usdfBalance.toFixed(2)} USDF`}
          </p>
        )}
        {fieldErrors.initialLiquidity && (
          <p className="text-xs text-red-400">{fieldErrors.initialLiquidity}</p>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {success && (
      <div className="rounded-lg border border-emerald-500 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
        {success}
      </div>
    )}
      {isFunding && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {fundingStep === 'approving'
            ? 'Waiting for USDF approval confirmation...'
            : 'Waiting for liquidity transaction confirmation...'}
        </div>
      )}

      <div className={`flex ${compact ? 'flex-col-reverse sm:flex-row sm:justify-between sm:items-center' : 'justify-between items-center'} gap-3`}>
        <div>
          {!isConnected && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const connector = connectors[0]
                if (connector) {
                  connect({ connector })
                }
              }}
              className="border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--hover-background)]"
            >
              Connect wallet
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              className="text-[var(--text-secondary)] hover:text-white hover:bg-[var(--hover-background)]"
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            className="bg-red-600 hover:bg-red-500 text-white px-5 py-2 rounded-lg shadow-lg shadow-red-600/30 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={isSubmitting || (isConnected && usdfBalance < Math.max(Number(form.initialLiquidity) || 0, MIN_INITIAL_LIQUIDITY))}
          >
            {isFunding
              ? fundingStep === 'approving'
                ? 'Waiting for approval...'
                : 'Seeding pool...'
              : createMarketMutation.isPending || isUploadingHero
                ? 'Creating...'
                : 'Create Market'}
          </Button>
        </div>
      </div>
    </form>
  )
}

export function CreateMarketModalContent({ onClose }: { onClose: () => void }) {
  const router = useRouter()

  const handleSuccess = (market: MarketCreationResponse) => {
    const slug = typeof market?.slug === 'string' && market.slug.trim().length > 0 ? market.slug.trim() : null
    const fallbackId = typeof market?.id === 'string' && market.id.trim().length > 0 ? market.id.trim() : null
    const destination = slug || fallbackId
    if (destination) {
      router.push(`/markets/${destination}`)
    }
    onClose()
  }

  return (
    <div className="relative bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl shadow-2xl shadow-black/40 p-6 sm:p-10 w-full max-h-[85vh] overflow-y-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Create Market</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Launch a new binary prediction market with custom outcomes.
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-white hover:bg-[var(--hover-background)] transition-colors"
          aria-label="Close create market dialog"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <CreateMarketForm compact onCancel={onClose} onSuccess={handleSuccess} />
    </div>
  )
}

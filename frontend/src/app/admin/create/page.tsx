'use client'

import { useState } from 'react'
import { getHttpApiBase } from '@/lib/runtimeConfig'
const DEFAULT_ORACLE = (process.env.NEXT_PUBLIC_DIRECT_ORACLE_ADDRESS || '').toLowerCase()
const MIN_INITIAL_LIQUIDITY = 0

export default function AdminCreateMarketPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ marketId: string; txHash: string } | null>(null)

  const [formData, setFormData] = useState({
    title: '',
    questionId: '',
    oracle: DEFAULT_ORACLE,
    openTime: Math.floor(Date.now() / 1000),
    closeTime: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days from now
    initialLiquidity: MIN_INITIAL_LIQUIDITY.toString(),
    creatorAddress: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)

    const liquidityValue = Number(formData.initialLiquidity)
    if (!Number.isFinite(liquidityValue) || liquidityValue < MIN_INITIAL_LIQUIDITY) {
      setError(`Initial liquidity must be non-negative.`)
      return
    }

    const creatorAddress = formData.creatorAddress.trim()
    if (!/^0x[a-fA-F0-9]{40}$/.test(creatorAddress)) {
      setError('Enter a valid creator wallet address (0x...) to fund liquidity.')
      return
    }

    setLoading(true)

    try {
      let apiUrl = 'https://api.example.com'
      try {
        apiUrl = getHttpApiBase()
      } catch (error) {
        console.error('[admin/create] Falling back to default API URL', error)
      }
      
      // Ensure questionId and oracle have 0x prefix and are valid hex
      let questionId = formData.questionId.trim()
      if (!questionId.startsWith('0x')) {
        questionId = '0x' + questionId
      }
      // Pad to 32 bytes if needed
      if (questionId.length < 66) {
        questionId = questionId.padEnd(66, '0')
      }

      let oracle = formData.oracle.trim()
      if (!oracle.startsWith('0x')) {
        oracle = '0x' + oracle
      }

      const response = await fetch(`${apiUrl}/api/admin/markets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: formData.title,
          questionId,
          oracle,
          openTime: formData.openTime,
          closeTime: formData.closeTime,
          initialLiquidity: liquidityValue,
          creatorAddress
        })
      })

      const data = await response.json()

      if (data.ok) {
        setResult({
          marketId: data.marketId,
          txHash: data.txHash
        })
      } else {
        setError(data.reason || 'Failed to create market')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  const explorerUrl = process.env.NEXT_PUBLIC_CHAIN_ID === '56'
    ? 'https://bscscan.com'
    : 'https://testnet.bscscan.com'

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">
          Create Binary Market
        </h1>
        <p className="text-[var(--text-secondary)]">
          Deploy a new prediction market on-chain
        </p>
      </div>

      <div className="bg-[var(--card-background)] rounded-lg border border-[var(--border-color)] p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-white mb-2">
              Market Title *
            </label>
            <input
              id="title"
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)]"
              placeholder="Will Bitcoin reach $100k by end of 2024?"
            />
          </div>

          <div>
            <label htmlFor="questionId" className="block text-sm font-medium text-white mb-2">
              Question ID (32 bytes) *
            </label>
            <input
              id="questionId"
              type="text"
              required
              value={formData.questionId}
              onChange={(e) => setFormData({ ...formData, questionId: e.target.value })}
              className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] font-mono text-sm"
              placeholder="0x1234567890abcdef..."
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Unique identifier for the condition (will be padded to 32 bytes if needed)
            </p>
          </div>

          <div>
            <label htmlFor="oracle" className="block text-sm font-medium text-white mb-2">
              Oracle Address *
            </label>
            <input
              id="oracle"
              type="text"
              required
              value={formData.oracle}
              readOnly
              className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] font-mono text-sm"
              placeholder="0x..."
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Markets resolve via the configured DirectCTFOracle.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="openTime" className="block text-sm font-medium text-white mb-2">
                Open Time (Unix timestamp)
              </label>
              <input
                id="openTime"
                type="number"
                value={formData.openTime}
                onChange={(e) => setFormData({ ...formData, openTime: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)]"
              />
            </div>

            <div>
              <label htmlFor="closeTime" className="block text-sm font-medium text-white mb-2">
                Close Time (Unix timestamp)
              </label>
              <input
                id="closeTime"
                type="number"
                value={formData.closeTime}
                onChange={(e) => setFormData({ ...formData, closeTime: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)]"
              />
            </div>
          </div>

          <div>
            <label htmlFor="initialLiquidity" className="block text-sm font-medium text-white mb-2">
              Initial Liquidity (USDF)
            </label>
            <input
              id="initialLiquidity"
            type="number"
            min={MIN_INITIAL_LIQUIDITY}
            step="0.01"
            value={formData.initialLiquidity}
            onChange={(e) => setFormData({ ...formData, initialLiquidity: e.target.value })}
            className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)]"
            placeholder={`Optional USDF amount`}
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">Optional: add USDF from the admin wallet.</p>
        </div>

          <div>
            <label htmlFor="creatorAddress" className="block text-sm font-medium text-white mb-2">
              Creator Wallet Address *
            </label>
            <input
              id="creatorAddress"
              type="text"
              value={formData.creatorAddress}
              onChange={(e) => setFormData({ ...formData, creatorAddress: e.target.value })}
              className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)] font-mono text-sm"
              placeholder="0xYourWallet..."
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              This wallet signs the USDF approve/addFunding steps right after the market is created.
            </p>
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {result && (
            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg space-y-2">
              <p className="text-green-400 font-medium">✓ Market created successfully!</p>
              <div className="text-sm space-y-1">
                <p className="text-white">
                  Market ID: <span className="font-mono">{result.marketId}</span>
                </p>
                <p className="text-white">
                  Transaction:{' '}
                  <a
                    href={`${explorerUrl}/tx/${result.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--primary-yellow)] hover:underline font-mono"
                  >
                    {result.txHash.slice(0, 10)}...{result.txHash.slice(-8)}
                  </a>
                </p>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 bg-[var(--primary-yellow)] text-black font-semibold rounded-lg hover:bg-[var(--primary-yellow-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating Market...' : 'Create Market'}
          </button>
        </form>
      </div>
    </div>
  )
}

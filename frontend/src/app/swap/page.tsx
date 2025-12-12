'use client'

import React, { useCallback, useMemo, useState, useEffect } from 'react'
import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract, usePublicClient } from 'wagmi'
import { ArrowDownUp, ExternalLink, AlertCircle, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { BaseError, formatUnits, parseUnits, type Hash } from 'viem'
import { CONTRACT_ADDRESSES, TARGET_CHAIN_ID } from '@/lib/web3'
import { isValidHexAddress, formatMissingAddressMessage } from '@/lib/envValidation'

// ERC20 ABI for balanceOf
const erc20ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

const EXPLORER_BASE = TARGET_CHAIN_ID === 56
  ? 'https://bscscan.com'
  : 'https://testnet.bscscan.com'
const TARGET_CHAIN_LABEL = TARGET_CHAIN_ID === 56 ? 'BNB Smart Chain' : 'BSC Testnet'
const IS_TESTNET = TARGET_CHAIN_ID !== 56

const usdfAbi = [
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'usdtAmount', type: 'uint256' },
    ],
    name: 'buy',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'usdfAmount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    name: 'sell',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

export default function SwapPage() {
  const { address, isConnected, chainId: connectedChainId } = useAccount()
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [isSwapping, setIsSwapping] = useState(false)
  const [txHash, setTxHash] = useState<Hash | null>(null)
  const [swapError, setSwapError] = useState<string | null>(null)
  const [swapDirection, setSwapDirection] = useState<'buy' | 'sell'>('buy')
  const [swapStep, setSwapStep] = useState<'idle' | 'submitting' | 'confirming' | 'complete'>('idle')
  const [txDirection, setTxDirection] = useState<'buy' | 'sell'>('buy')
  const [copied, setCopied] = useState(false)
  const [networkError, setNetworkError] = useState<string | null>(null)

  const { switchChainAsync, isPending: isSwitchPending } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID })

  const FALLBACK_RATE = 1 // 1 USDT = 1 USDF fixed rate
  const usdfContractAddress = isValidHexAddress(CONTRACT_ADDRESSES.usdf) ? CONTRACT_ADDRESSES.usdf : undefined
  const usdtContractAddress = isValidHexAddress(CONTRACT_ADDRESSES.usdt || '') ? CONTRACT_ADDRESSES.usdt : undefined
  const swapConfigIssues = [
    !usdfContractAddress ? 'NEXT_PUBLIC_USDF_ADDRESS' : null,
    !usdtContractAddress ? 'NEXT_PUBLIC_USDT_ADDRESS' : null,
  ].filter(Boolean) as string[]
  const swapConfigError = swapConfigIssues.length
    ? formatMissingAddressMessage(swapConfigIssues)
    : null

  const {
    writeContractAsync: writeSwap,
    isPending: isSwapPending,
  } = useWriteContract({
    chainId: TARGET_CHAIN_ID,
  })

  const { status: receiptStatus, error: receiptError } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId: TARGET_CHAIN_ID,
    query: {
      enabled: Boolean(txHash),
      // With WebSocket transport configured, rely on WS updates instead of manual polling.
      refetchInterval: false,
    },
  })

  // Fetch USDF token balance
  const { data: usdfBalance, refetch: refetchUsdfBalance } = useReadContract({
    address: (usdfContractAddress ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    abi: erc20ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address && usdfContractAddress),
    },
    chainId: TARGET_CHAIN_ID,
  })

  // Format balances for display
  const { data: usdtBalance, refetch: refetchUsdtBalance } = useReadContract({
    address: (usdtContractAddress ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    abi: erc20ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && usdtContractAddress) },
    chainId: TARGET_CHAIN_ID,
  })

  const usdtBalanceValue = usdtBalance ? formatUnits(usdtBalance, 18) : '0'
  const usdtBalanceFormatted = Number.parseFloat(usdtBalanceValue).toFixed(4)
  const usdfBalanceValue = usdfBalance ? formatUnits(usdfBalance, 18) : '0'
  const usdfBalanceFormatted = Number.parseFloat(usdfBalanceValue).toFixed(4)

  const rateDecimal = FALLBACK_RATE
  const inverseRate = 1

  const handleSwap = async () => {
    if (!isConnected || !fromAmount || !address) return
    if (!usdfContractAddress) {
      setSwapError(swapConfigError || 'Missing USDF contract configuration')
      return
    }
    if (isConnected && connectedChainId && connectedChainId !== TARGET_CHAIN_ID) {
      setSwapError(`Switch your wallet to ${TARGET_CHAIN_LABEL} to continue.`)
      return
    }

    let usdtAmountWei: bigint | null = null
    let usdfAmountWei: bigint | null = null

    try {
      if (swapDirection === 'buy') {
        usdtAmountWei = parseUnits(fromAmount, 18)
        if (usdtAmountWei <= 0n) throw new Error('amount must be greater than 0')
      } else {
        usdfAmountWei = parseUnits(fromAmount, 18)
        if (usdfAmountWei <= 0n) throw new Error('amount must be greater than 0')
      }
    } catch (err) {
      console.error('Invalid swap amount', err)
      setSwapError('Enter a valid amount greater than 0')
      return
    }

    try {
      setIsSwapping(true)
      setSwapError(null)
      setSwapStep('submitting')
      setTxHash(null)
      setTxDirection(swapDirection)

      if (swapDirection === 'buy') {
        if (!usdtBalance || !usdtAmountWei || usdtBalance < usdtAmountWei) {
          setSwapError('Insufficient USDT balance')
          setSwapStep('idle')
          setIsSwapping(false)
          return
        }

        const approveTx = await writeSwap({
          address: usdtContractAddress!,
          abi: erc20ABI,
          functionName: 'approve',
          args: [usdfContractAddress, usdtAmountWei],
        })
        await publicClient?.waitForTransactionReceipt({ hash: approveTx })

        const tx = await writeSwap({
          address: usdfContractAddress,
          abi: usdfAbi,
          functionName: 'buy',
          args: [address, usdtAmountWei],
        })
        setSwapStep('confirming')
        setTxHash(tx)
      } else {
        if (!usdfBalance) {
          setSwapError('Unable to determine USDF balance')
          setSwapStep('idle')
          setIsSwapping(false)
          return
        }
        if (!usdfAmountWei) {
          setSwapError('Enter a valid amount greater than 0')
          setSwapStep('idle')
          setIsSwapping(false)
          return
        }
        if (usdfBalance < usdfAmountWei) {
          setSwapError('Insufficient USDF balance')
          setSwapStep('idle')
          setIsSwapping(false)
          return
        }

        const tx = await writeSwap({
          address: usdfContractAddress,
          abi: usdfAbi,
          functionName: 'sell',
          args: [usdfAmountWei, address],
        })
        setSwapStep('confirming')
        setTxHash(tx)
      }
    } catch (err: unknown) {
      console.error('Swap failed', err)
      const baseError = err as BaseError
      const causeMessage = baseError?.cause instanceof Error ? baseError.cause.message : ''
      const combined = [baseError?.shortMessage ?? baseError?.message ?? 'Swap failed', causeMessage]
        .filter(Boolean)
        .join(' ')
      const lower = combined.toLowerCase()
      if (lower.includes('rate limited')) {
        setSwapError('Our current RPC node is rate-limiting requests. Please wait a few seconds and try again, or switch your wallet to a different BSC RPC endpoint.')
      } else {
        setSwapError(combined || 'Swap failed')
      }
      setSwapStep('idle')
      setIsSwapping(false)
    }
  }

  useEffect(() => {
    if (!txHash) return

    if (receiptStatus === 'pending') {
      setSwapStep('confirming')
      return
    }

    if (receiptStatus === 'success') {
      setSwapStep('complete')
      setSwapError(null)
      setIsSwapping(false)
      // Force-refresh balances once the chain confirms so UI cannot reuse stale amounts.
      refetchUsdtBalance()
      refetchUsdfBalance()
      setTimeout(() => {
        setFromAmount('')
        setToAmount('')
        setSwapStep('idle')
        setTxHash(null)
      }, 3000)
      return
    }

    if (receiptStatus === 'error') {
      const baseError = receiptError as BaseError
      const causeMessage = baseError?.cause instanceof Error ? baseError.cause.message : ''
      const combined = [baseError?.shortMessage ?? baseError?.message ?? (receiptError instanceof Error ? receiptError.message : ''), causeMessage]
        .filter(Boolean)
        .join(' ')
      setSwapError(combined || 'Swap transaction failed')
      setSwapStep('idle')
      setIsSwapping(false)
      setTxHash(null)
    }
  }, [txHash, receiptStatus, receiptError, refetchUsdtBalance, refetchUsdfBalance])

  useEffect(() => {
    if (!connectedChainId || connectedChainId === TARGET_CHAIN_ID) {
      setNetworkError(null)
    }
  }, [connectedChainId])

  const handleSwitchNetwork = useCallback(async () => {
    if (!switchChainAsync) {
      setNetworkError('Switching networks is not supported by the connected wallet.')
      return
    }
    try {
      setNetworkError(null)
      await switchChainAsync({ chainId: TARGET_CHAIN_ID })
    } catch (err) {
      const baseError = err as BaseError
      const causeMessage = baseError?.cause instanceof Error ? baseError.cause.message : ''
      const combined = [baseError?.shortMessage ?? baseError?.message ?? (err instanceof Error ? err.message : ''), causeMessage]
        .filter(Boolean)
        .join(' ')
      setNetworkError(combined || 'Failed to switch network')
    }
  }, [switchChainAsync])

  const maxFromValue = useMemo(() => {
    if (swapDirection === 'buy') {
      return usdtBalance ? formatUnits(usdtBalance, 18) : '0'
    }
    return usdfBalance ? formatUnits(usdfBalance, 18) : '0'
  }, [swapDirection, usdtBalance, usdfBalance])

  const convertAmount = useCallback(
    (value: string, direction: 'buy' | 'sell') => {
      if (!value) return ''
      const numeric = Number.parseFloat(value)
      if (!Number.isFinite(numeric) || numeric <= 0 || rateDecimal <= 0) {
        return ''
      }

      if (direction === 'buy') {
        const converted = numeric * rateDecimal
        return Number.isFinite(converted) ? converted.toFixed(2) : ''
      }

      const converted = numeric / rateDecimal
      return Number.isFinite(converted) ? converted.toFixed(4) : ''
    },
    [rateDecimal]
  )

  const handleAmountChange = useCallback(
    (value: string) => {
      setFromAmount(value)
      const calculatedAmount = value ? convertAmount(value, swapDirection) : ''
      setToAmount(calculatedAmount)
    },
    [convertAmount, swapDirection]
  )

  const handleMaxClick = useCallback(() => {
    const value = maxFromValue || ''
    setFromAmount(value)
    setToAmount(value ? convertAmount(value, swapDirection) : '')
    setSwapError(null)
  }, [convertAmount, maxFromValue, swapDirection])

  const handleDirectionToggle = () => {
    setSwapDirection((prev) => {
      const next = prev === 'buy' ? 'sell' : 'buy'
      setSwapError(null)
      setSwapStep('idle')
      setTxHash(null)

      if (toAmount) {
        setFromAmount(toAmount)
        setToAmount(convertAmount(toAmount, next))
      } else if (fromAmount) {
        setToAmount(convertAmount(fromAmount, next))
      } else {
        setFromAmount('')
        setToAmount('')
      }

      return next
    })
  }

  const fromToken = swapDirection === 'buy'
    ? { label: 'USDT', icon: 'T' }
    : { label: 'USDF', icon: '$' }

  const toToken = swapDirection === 'buy'
    ? { label: 'USDF', icon: '$' }
    : { label: 'USDT', icon: 'T' }

  const fromBalanceDisplay = swapDirection === 'buy'
    ? `${usdtBalanceFormatted} USDT`
    : `${usdfBalanceFormatted} USDF`

  const toBalanceDisplay = swapDirection === 'buy'
    ? `${usdfBalanceFormatted} USDF`
    : `${usdtBalanceFormatted} USDT`

  const parsedFromAmount = Number.parseFloat(fromAmount)
  const requiresNetworkSwitch = Boolean(isConnected && connectedChainId && connectedChainId !== TARGET_CHAIN_ID)

  const isSwapDisabled =
    !fromAmount ||
    !Number.isFinite(parsedFromAmount) ||
    parsedFromAmount <= 0 ||
    isSwapping ||
    Boolean(swapConfigError) ||
    requiresNetworkSwitch

  const buttonLabel = useMemo(() => {
    if (swapStep === 'submitting') {
      return swapDirection === 'buy' ? 'Submitting buy…' : 'Submitting sell…'
    }
    if (swapStep === 'confirming') {
      return swapDirection === 'buy' ? 'Minting USDF…' : 'Redeeming USDF…'
    }
    if (swapStep === 'complete') {
      return '✓ Swap Complete!'
    }
    if (isSwapping) {
      return 'Processing…'
    }
    return swapDirection === 'buy' ? 'Swap USDT → USDF' : 'Swap USDF → USDT'
  }, [swapStep, swapDirection, isSwapping])

  const handleCopyAddress = useCallback(() => {
    if (!usdfContractAddress || typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(usdfContractAddress).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      setCopied(false)
    })
  }, [usdfContractAddress])

  return (
    <div className="min-h-screen bg-[var(--background)] py-8">
      <div className="max-w-2xl mx-auto px-4">
        {/* Back Link */}
        <Link 
          href="/"
          className="inline-flex items-center text-[var(--text-secondary)] hover:text-white mb-6"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Markets
        </Link>

        {/* Page Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Swap USDT ↔ USDF</h1>
          <p className="text-[var(--text-secondary)]">
            Mint USDF with USDT or redeem USDF back to USDT at the fixed 1:1 vending-machine rate (sell fee applies).
          </p>
          {swapConfigError && (
            <div className="mt-4 text-sm text-red-300 bg-red-900/30 border border-red-500/30 rounded-lg px-4 py-3">
              {swapConfigError}. Please update your environment configuration before swapping.
            </div>
          )}
          {isConnected && requiresNetworkSwitch && (
            <div className="mt-4 text-sm text-yellow-200 bg-yellow-900/30 border border-yellow-500/40 rounded-lg px-4 py-3 space-y-2">
              <p className="font-medium">
                You are connected to chain ID {connectedChainId}. Switch to {TARGET_CHAIN_LABEL} (chain {TARGET_CHAIN_ID}) to mint or redeem USDF.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleSwitchNetwork}
                  disabled={isSwitchPending}
                  className="px-3 py-1.5 bg-[var(--primary-yellow)] text-black font-semibold rounded hover:bg-[var(--primary-yellow-hover)] disabled:opacity-60"
                >
                  {isSwitchPending ? 'Switching…' : `Switch to ${TARGET_CHAIN_LABEL}`}
                </button>
                {networkError && (
                  <span className="text-xs text-red-200">{networkError}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Swap Card */}
        <div className="bg-[var(--card-background)] rounded-lg border border-[var(--border-color)] p-6 mb-6">
          {/* From Token */}
          <div className="mb-2">
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              From
            </label>
            <div className="bg-[var(--background)] border border-[var(--border-color)] rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <input
                  type="number"
                  placeholder="0.0"
                  value={fromAmount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  className="bg-transparent text-2xl font-semibold text-white outline-none w-full"
                />
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleMaxClick}
                    className="px-2 py-1 bg-[var(--primary-yellow)] hover:bg-[var(--primary-yellow-hover)] text-black text-xs font-bold rounded transition-colors"
                  >
                    MAX
                  </button>
                  <div className="flex items-center space-x-2 bg-[var(--hover-background)] px-3 py-2 rounded-lg">
                    <div className="w-6 h-6 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center">
                      <span className="text-xs font-bold text-black">{fromToken.icon}</span>
                    </div>
                    <span className="font-semibold text-white">{fromToken.label}</span>
                  </div>
                </div>
              </div>
              <div className="text-sm text-[var(--text-muted)]">
                Balance: {fromBalanceDisplay}
              </div>
            </div>
          </div>

          {/* Swap Icon */}
          <div className="flex justify-center my-4">
            <button 
              className="p-2 bg-[var(--hover-background)] hover:bg-[var(--border-color)] rounded-lg border border-[var(--border-color)] transition-colors"
              onClick={handleDirectionToggle}
              aria-label="Reverse swap direction"
              title="Reverse swap direction"
            >
              <ArrowDownUp className="w-5 h-5 text-[var(--text-secondary)]" />
            </button>
          </div>

          {/* To Token */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              To
            </label>
            <div className="bg-[var(--background)] border border-[var(--border-color)] rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <input
                  type="number"
                  placeholder="0.0"
                  value={toAmount}
                  readOnly
                  className="bg-transparent text-2xl font-semibold text-white outline-none w-full"
                />
                <div className="flex items-center space-x-2 bg-[var(--hover-background)] px-3 py-2 rounded-lg">
                  <div className="w-6 h-6 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center text-xs font-bold">
                    {toToken.icon}
                  </div>
                  <span className="font-semibold text-white">{toToken.label}</span>
                </div>
              </div>
              <div className="text-sm text-[var(--text-muted)]">
                Balance: {toBalanceDisplay}
              </div>
            </div>
          </div>

          {/* Swap Details */}
          {fromAmount && (
            <div className="bg-[var(--hover-background)] rounded-lg p-4 mb-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-secondary)]">Action</span>
                <span className="text-white font-medium">
                  {swapDirection === 'buy' ? 'Mint USDF' : 'Redeem USDF'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-secondary)]">Exchange Rate</span>
                <span className="text-white font-medium">
                  1 USDT = {rateDecimal.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDF
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-secondary)]">Reverse Rate</span>
                <span className="text-white font-medium">
                  1 USDF ≈ {inverseRate.toFixed(4)} USDT
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-secondary)]">Network Fee</span>
                <span className="text-white font-medium">BNB (gas)</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-secondary)]">You&apos;ll Receive</span>
                <span className="text-[var(--primary-yellow)] font-bold">
                  {toAmount || '0.00'} {toToken.label}
                </span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {swapError && (
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <span className="text-red-400 text-sm">Swap failed: {swapError}</span>
              </div>
            </div>
          )}

          {/* Swap Button */}
          {!isConnected ? (
            <button 
              className="w-full py-4 bg-[var(--primary-yellow)] hover:bg-[var(--primary-yellow-hover)] text-black font-bold rounded-lg transition-colors"
              disabled
            >
              Connect Wallet to Swap
            </button>
          ) : (
            <button 
              onClick={handleSwap}
              disabled={isSwapDisabled}
              className={`w-full py-4 font-bold rounded-lg transition-colors ${
                isSwapDisabled
                  ? 'bg-[var(--border-color)] text-[var(--text-muted)] cursor-not-allowed'
                  : 'bg-[var(--primary-yellow)] hover:bg-[var(--primary-yellow-hover)] text-black'
              }`}
            >
              {buttonLabel}
            </button>
          )}

          {/* Success Message */}
          {txHash && swapStep === 'complete' && (
            <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <CheckCircle className="w-5 h-5 text-green-400" />
                <span className="text-green-400 font-semibold">Swap Successful!</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mb-2">
                {txDirection === 'buy'
                  ? 'Your USDF has been minted to your wallet.'
                  : 'Your USDT has been returned to your wallet.'}
              </p>
              <a 
                href={`${EXPLORER_BASE}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 text-sm text-blue-400 hover:text-blue-300"
              >
                <span>Swap Tx: {txHash.slice(0, 10)}...{txHash.slice(-8)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* Information Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* What is USDF */}
          <div className="bg-[var(--card-background)] rounded-lg border border-[var(--border-color)] p-6">
            <h3 className="text-lg font-semibold text-white mb-2">What is USDF?</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              USDF is the native stablecoin used for trading on Caifu Markets. 
              It&apos;s pegged 1:1 to USD and required for all market transactions.
            </p>
          </div>

          {/* How to Get USDF */}
          <div className="bg-[var(--card-background)] rounded-lg border border-[var(--border-color)] p-6">
            <h3 className="text-lg font-semibold text-white mb-2">How to Get USDF</h3>
            <ul className="text-sm text-[var(--text-secondary)] space-y-2">
              <li className="flex items-start">
                <span className="text-[var(--primary-yellow)] mr-2">1.</span>
                Swap USDT for USDF or redeem USDF back to USDT at the current vending-machine rate
              </li>
              <li className="flex items-start">
                <span className="text-[var(--primary-yellow)] mr-2">2.</span>
                Fund your wallet with a small amount of BNB for gas
              </li>
              <li className="flex items-start">
                <span className="text-[var(--primary-yellow)] mr-2">3.</span>
                Use local mint scripts for development
              </li>
            </ul>
          </div>

          {/* USDF_Mainnet Contract Snapshot */}
          {usdfContractAddress && (
            <div className="bg-[var(--card-background)] rounded-lg border border-[var(--border-color)] p-6 col-span-1 md:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">USDF Contract</h3>
                  <p className="text-sm text-[var(--text-secondary)]">
                    This swap talks directly to the USDF vending machine on {TARGET_CHAIN_LABEL}.
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleCopyAddress}
                    className="px-3 py-1 text-xs font-semibold rounded-full bg-[var(--hover-background)] border border-[var(--border-color)] text-white hover:bg-[var(--border-color)]"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <a
                    href={`${EXPLORER_BASE}/address/${usdfContractAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-xs font-semibold text-[var(--primary-yellow)] hover:text-white"
                  >
                    View on BscScan
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </div>
              </div>
              <code className="block text-sm text-[var(--text-secondary)] break-all bg-[var(--hover-background)] rounded-md px-3 py-2 border border-[var(--border-color)]">
                {usdfContractAddress}
              </code>
              <p className="text-xs text-[var(--text-muted)] mt-3">
                Current on-chain rate: 1 USDT = {rateDecimal.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDF. Swap UI automatically reads this value from the contract.
              </p>
            </div>
          )}
        </div>

        {/* Warning Banner */}
        {IS_TESTNET ? (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-yellow-400 mb-1">
                  Testnet Environment
                </h4>
                <p className="text-sm text-[var(--text-secondary)]">
                  This is a testnet deployment. Use testnet tokens only. 
                  For local development, you can mint USDF using the faucet or deploy scripts.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-yellow-400 mb-1">
                  Mainnet Safety
                </h4>
                <p className="text-sm text-[var(--text-secondary)]">
                  This is running on BNB Smart Chain mainnet. Swaps use real USDT, USDF, and BNB gas—double-check amounts and contract addresses before confirming in your wallet.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

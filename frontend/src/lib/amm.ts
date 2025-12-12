import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { maxUint256 } from 'viem'

const ONE = 10n ** 18n

export const ERC20_ABI = [
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
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

export const FPMM_ABI = [
  {
    name: 'addFunding',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'distributionHint', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    name: 'calcBuyAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'investmentAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
    ],
    outputs: [{ name: 'outcomeTokensToBuy', type: 'uint256' }],
  },
  {
    name: 'calcSellAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'returnAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
    ],
    outputs: [{ name: 'outcomeTokenSellAmount', type: 'uint256' }],
  },
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'investmentAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
      { name: 'minOutcomeTokensToBuy', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'returnAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
      { name: 'maxOutcomeTokensToSell', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'fee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const CTF_ABI = [
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'indexSet', type: 'uint256' },
    ],
    name: 'getCollectionId',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'collectionId', type: 'bytes32' },
    ],
    name: 'getPositionId',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'indexSets', type: 'uint256[]' },
    ],
    name: 'redeemPositions',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

export type TradeSide = 'buy' | 'sell'

interface CommonParams {
  publicClient: PublicClient | null
  walletClient: WalletClient | null
  account: Address
}

interface AllowanceParams extends CommonParams {
  tokenAddress: Address
  spender: Address
  minimum: bigint
}

interface SwapParams {
  walletClient: WalletClient | null
  account: Address
  fpmmAddress: Address
  conditionId: `0x${string}`
  outcomeIndex: number
  amountIn: bigint
  minOut: bigint
  side: TradeSide
}

interface QuoteParams {
  publicClient: PublicClient | null
  fpmmAddress: Address
  conditionId: `0x${string}`
  outcomeIndex: number
  amountIn: bigint
  side: TradeSide
}

interface ApprovalParams extends CommonParams {
  ctfAddress: Address
  operator: Address
}

const requireClient = <T>(client: T | null, label: string): T => {
  if (!client) {
    throw new Error(`${label} unavailable. Please reconnect your wallet.`)
  }
  return client
}

const formatContractError = (err: unknown, fallback: string): Error => {
  if (err && typeof err === 'object') {
    const anyErr = err as any
    const message =
      anyErr?.shortMessage ||
      anyErr?.reason ||
      anyErr?.message ||
      anyErr?.cause?.shortMessage ||
      anyErr?.cause?.message
    return new Error(message || fallback)
  }
  if (typeof err === 'string') {
    return new Error(err)
  }
  return new Error(fallback)
}

export async function isPoolInitialized({
  publicClient,
  fpmmAddress,
}: {
  publicClient: PublicClient | null
  fpmmAddress: Address
}): Promise<boolean> {
  const client = requireClient(publicClient, 'Public client')
  const totalSupply = await client.readContract({
    address: fpmmAddress,
    abi: FPMM_ABI,
    functionName: 'totalSupply',
    args: [],
  }) as bigint
  return totalSupply > 0n
}

export async function getOutcomePositionId({
  publicClient,
  ctfAddress,
  collateralToken,
  conditionId,
  outcomeIndex,
}: {
  publicClient: PublicClient | null
  ctfAddress: Address
  collateralToken: Address
  conditionId: `0x${string}`
  outcomeIndex: number
}): Promise<bigint> {
  const client = requireClient(publicClient, 'Public client')
  const parentCollectionId = '0x0000000000000000000000000000000000000000000000000000000000000000'
  const indexSet = BigInt(1 << outcomeIndex)
  const collectionId = await client.readContract({
    address: ctfAddress,
    abi: CTF_ABI,
    functionName: 'getCollectionId',
    args: [parentCollectionId, conditionId, indexSet],
  }) as `0x${string}`

  const positionId = await client.readContract({
    address: ctfAddress,
    abi: CTF_ABI,
    functionName: 'getPositionId',
    args: [collateralToken, collectionId],
  }) as bigint

  return positionId
}

const MAX_BINARY_SEARCH_STEPS = 48

async function calcSellRequired({
  publicClient,
  fpmmAddress,
  outcomeIndex,
  desiredReturn,
}: {
  publicClient: PublicClient
  fpmmAddress: Address
  outcomeIndex: number
  desiredReturn: bigint
}): Promise<bigint> {
  return await publicClient.readContract({
    address: fpmmAddress,
    abi: FPMM_ABI,
    functionName: 'calcSellAmount',
    args: [desiredReturn, BigInt(outcomeIndex)],
  }) as bigint
}

export async function quoteFpmmTrade({
  publicClient,
  fpmmAddress,
  conditionId,
  outcomeIndex,
  amountIn,
  side,
}: QuoteParams) {
  const client = requireClient(publicClient, 'Public client')
  const fee = await client.readContract({
    address: fpmmAddress,
    abi: FPMM_ABI,
    functionName: 'fee',
    args: [],
  }) as bigint

  if (side === 'sell') {
    if (amountIn === 0n) {
      return { amountOut: 0n, price: 0n, feeAmount: 0n, tokensUsed: 0n }
    }

    let low = 0n
    let high = amountIn
    let bestReturn = 0n
    let tokensRequired = 0n

    for (let i = 0; i < MAX_BINARY_SEARCH_STEPS && low <= high; i++) {
      const mid = ((low + high) >> 1n) + (high > low ? 1n : 0n)
      const required = await calcSellRequired({
        publicClient: client,
        fpmmAddress,
        outcomeIndex,
        desiredReturn: mid,
      })

      if (required <= amountIn) {
        bestReturn = mid
        tokensRequired = required
        low = mid
      } else {
        high = mid - 1n
      }

      if (high - low <= 1n) {
        const highRequired = await calcSellRequired({
          publicClient: client,
          fpmmAddress,
          outcomeIndex,
          desiredReturn: high,
        })
        if (highRequired <= amountIn) {
          bestReturn = high
          tokensRequired = highRequired
        }
        break
      }
    }

    const feeAmount = bestReturn === 0n ? 0n : (bestReturn * fee) / (ONE - fee)
    const price = tokensRequired > 0n ? (bestReturn * ONE) / tokensRequired : 0n

    return {
      amountOut: bestReturn,
      price,
      feeAmount,
      tokensUsed: tokensRequired,
    }
  }

  const sharesOut = await client.readContract({
    address: fpmmAddress,
    abi: FPMM_ABI,
    functionName: 'calcBuyAmount',
    args: [amountIn, BigInt(outcomeIndex)],
  }) as bigint

  const feeAmount = (amountIn * fee) / ONE
  const price = sharesOut > 0n ? (amountIn * ONE) / sharesOut : 0n

  return {
    amountOut: sharesOut,
    price,
    feeAmount,
    tokensUsed: amountIn,
  }
}

export async function ensureUsdfAllowance({
  publicClient,
  walletClient,
  tokenAddress,
  spender,
  account,
  minimum,
}: AllowanceParams): Promise<Hash | null> {
  const client = requireClient(publicClient, 'Public client')
  const wallet = requireClient(walletClient, 'Wallet client')

  const currentAllowance = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account, spender],
  }) as bigint

  if (currentAllowance >= minimum) {
    return null
  }

  try {
    return await wallet.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, maxUint256],
    })
  } catch (err) {
    throw formatContractError(err, 'USDF approval failed')
  }
}

export async function ensureOutcomeApproval({
  publicClient,
  walletClient,
  account,
  ctfAddress,
  operator,
}: ApprovalParams): Promise<Hash | null> {
  const client = requireClient(publicClient, 'Public client')
  const wallet = requireClient(walletClient, 'Wallet client')

  const approved = await client.readContract({
    address: ctfAddress,
    abi: CTF_ABI,
    functionName: 'isApprovedForAll',
    args: [account, operator],
  }) as boolean

  if (approved) {
    return null
  }

  try {
    return await wallet.writeContract({
      address: ctfAddress,
      abi: CTF_ABI,
      functionName: 'setApprovalForAll',
      args: [operator, true],
    })
  } catch (err) {
    throw formatContractError(err, 'Outcome token approval failed')
  }
}

export async function swapExactUsdfForOutcome({
  walletClient,
  account,
  fpmmAddress,
  conditionId,
  outcomeIndex,
  amountIn,
  minOut,
  side,
}: SwapParams): Promise<Hash> {
  const wallet = requireClient(walletClient, 'Wallet client')

  try {
    if (side === 'sell') {
      return await wallet.writeContract({
        address: fpmmAddress,
        abi: FPMM_ABI,
        functionName: 'sell',
        args: [minOut, BigInt(outcomeIndex), amountIn],
      })
    }

    return await wallet.writeContract({
      address: fpmmAddress,
      abi: FPMM_ABI,
      functionName: 'buy',
      args: [amountIn, BigInt(outcomeIndex), minOut],
    })
  } catch (err) {
    throw formatContractError(err, 'FPMM trade failed')
  }
}

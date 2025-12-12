import { publicClient } from '@caifu/sdk'
import { ENV } from '@caifu/config'
import type { Address, Hex } from 'viem'
import { CTFABI } from './abi/CTF'
import { FPMMABI } from './abi/FPMM'
import { FPMMFactoryABI } from './abi/FPMMFactory'
import { DirectOracleAdapterABI } from './abi/DirectOracleAdapter'
import { DirectCTFOracleABI } from './abi/DirectCTFOracle'

// Contract helpers
export function getCTFContract() {
  if (!ENV.CTF_ADDRESS) return null
  return {
    address: ENV.CTF_ADDRESS as Address,
    abi: CTFABI,
  }
}

export function getFPMMFactoryContract() {
  if (!ENV.MARKET_FACTORY_ADDRESS) return null
  return {
    address: ENV.MARKET_FACTORY_ADDRESS as Address,
    abi: FPMMFactoryABI,
  }
}

export function getFPMMContract(address?: string | null) {
  if (!address) return null
  return {
    address: address as Address,
    abi: FPMMABI,
  }
}

export function getUSDFContract() {
  if (!ENV.USDF_ADDRESS) return null
  return {
    address: ENV.USDF_ADDRESS as Address,
    abi: [
      { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
      { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
      { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
      { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
      { name: 'mint', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
    ] as const,
  }
}

const USDF_VENDING_MACHINE_ABI = [
  {
    type: 'function',
    stateMutability: 'payable',
    name: 'buy',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'sell',
    inputs: [
      { name: 'usdfAmount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'rate',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

export function getUSDF_MainnetContract() {
  if (!ENV.USDF_ADDRESS) return null
  return {
    address: ENV.USDF_ADDRESS as Address,
    abi: USDF_VENDING_MACHINE_ABI,
  }
}

export function getOracleAdapterContract() {
  if (!ENV.ORACLE_ADAPTER_ADDRESS) return null
  return {
    address: ENV.ORACLE_ADAPTER_ADDRESS as Address,
    abi: DirectOracleAdapterABI,
  }
}

export function getDirectOracleContract() {
  if (!ENV.DIRECT_ORACLE_ADDRESS) return null
  return {
    address: ENV.DIRECT_ORACLE_ADDRESS as Address,
    abi: DirectCTFOracleABI,
  }
}

// Helper to resolve Gnosis Conditional Tokens position IDs on-chain
export async function resolvePositionId(
  conditionId: Hex,
  outcomeIndex: number,
  collateralToken: Address,
  parentCollectionId: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'
): Promise<bigint> {
  const ctf = getCTFContract()
  if (!ctf) {
    throw new Error('ConditionalTokens contract not configured')
  }

  const indexSet = BigInt(1 << outcomeIndex)
  const collectionId = await publicClient.readContract({
    address: ctf.address,
    abi: ctf.abi,
    functionName: 'getCollectionId',
    args: [parentCollectionId, conditionId, indexSet],
  }) as Hex

  const positionId = await publicClient.readContract({
    address: ctf.address,
    abi: ctf.abi,
    functionName: 'getPositionId',
    args: [collateralToken, collectionId],
  }) as bigint

  return positionId
}

// Validation helper
export async function validateContractDeployments() {
  const addresses = {
    CTF: ENV.CTF_ADDRESS,
    MARKET_FACTORY: ENV.MARKET_FACTORY_ADDRESS,
    USDF: ENV.USDF_ADDRESS,
    DIRECT_ORACLE: ENV.DIRECT_ORACLE_ADDRESS,
    ORACLE_ADAPTER: ENV.ORACLE_ADAPTER_ADDRESS,
  }

  const results: Record<string, boolean> = {}

  for (const [name, address] of Object.entries(addresses)) {
    if (!address) {
      console.log(`⚠️  ${name} address not configured`)
      results[name] = false
      continue
    }

    try {
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        console.log(`⚠️  ${name} has invalid address format: ${address}`)
        results[name] = false
        continue
      }

      if (process.env.VALIDATE_CONTRACT_CODE !== '0') {
        const code = await publicClient.getCode({ address: address as `0x${string}` })
        const hasCode = code && code !== '0x' && code.length > 2

        if (hasCode) {
          console.log(`✅ ${name}: ${address} (${(code.length - 2) / 2} bytes)`)
          results[name] = true
        } else {
          console.log(`⚠️  ${name}: ${address} (NO CODE - not deployed?)`)
          results[name] = false
        }
      } else {
        console.log(`ℹ️  ${name}: ${address} (validation skipped)`)
        results[name] = true
      }
    } catch (error) {
      console.log(`❌ ${name}: ${address} (validation error: ${error})`)
      results[name] = false
    }
  }

  return results
}

import { PrismaClient } from '@prisma/client'
import { ENV } from '@caifu/config'
import { encodePacked, keccak256 } from 'viem'
import type { Hex, Address } from 'viem'

export type PositionMeta = { marketId: string; outcome: 0 | 1 }

const ZERO_COLLECTION_ID = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
const positionMap = new Map<string, PositionMeta>()
let hydrated = false

const normalizeKey = (value: bigint | string): string => {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (value.startsWith('0x') || value.startsWith('0X')) {
    return BigInt(value).toString()
  }
  return value
}

const getCollateral = (): Address | null => {
  const addr = ENV.USDF_ADDRESS?.toLowerCase()
  if (!addr || addr === '0x0000000000000000000000000000000000000000') {
    return null
  }
  return addr as Address
}

const computePositionId = (conditionId: Hex, outcome: 0 | 1): string | null => {
  const collateral = getCollateral()
  if (!collateral) {
    return null
  }
  const indexSet = outcome === 0 ? 1n : 2n
  const collectionId = keccak256(
    encodePacked(
      ['bytes32', 'bytes32', 'uint256[]'],
      [ZERO_COLLECTION_ID, conditionId, [indexSet]]
    )
  ) as Hex
  const positionHex = keccak256(
    encodePacked(
      ['address', 'bytes32'],
      [collateral, collectionId]
    )
  )
  return BigInt(positionHex).toString()
}

export async function hydrateFromDb(prisma: PrismaClient, log?: { info?: (meta: any, msg?: string) => void }) {
  positionMap.clear()
  const collateral = getCollateral()
  if (!collateral) {
    log?.info?.({ reason: 'missing_usdf' }, 'positionIndex skipped: collateral not set')
    hydrated = true
    return
  }

  const markets = await prisma.market.findMany({
    where: { conditionId: { not: null } },
    select: { id: true, conditionId: true },
  })

  for (const market of markets) {
    if (market.conditionId) {
      addMarket(market.conditionId as Hex, market.id)
    }
  }

  hydrated = true
  log?.info?.({ markets: markets.length, ids: markets.length * 2 }, 'positionIndex hydrated')
}

export function addMarket(conditionId: Hex | null | undefined, marketId: string) {
  if (!conditionId) return
  const yesId = computePositionId(conditionId, 0)
  const noId = computePositionId(conditionId, 1)
  if (yesId) {
    positionMap.set(yesId, { marketId, outcome: 0 })
  }
  if (noId) {
    positionMap.set(noId, { marketId, outcome: 1 })
  }
}

export function lookup(positionId: string | bigint | Hex): PositionMeta | undefined {
  const key = normalizeKey(typeof positionId === 'string' ? positionId : positionId)
  return positionMap.get(key)
}

export function isHydrated() {
  return hydrated
}

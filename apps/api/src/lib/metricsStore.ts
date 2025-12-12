import { Prisma, PrismaClient } from '@prisma/client'

const SCALE_18 = 10n ** 18n

export type TradeSide = 'buy' | 'sell'

export function hexToBuffer(hex: string): Buffer {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex
  return Buffer.from(normalized.padStart(normalized.length + (normalized.length % 2), '0'), 'hex')
}

export function formatFixed(value: bigint, decimals = 18): string {
  const scale = 10n ** BigInt(decimals)
  const negative = value < 0n
  const abs = negative ? -value : value
  const integer = abs / scale
  const fraction = abs % scale

  if (fraction === 0n) {
    return negative ? `-${integer.toString()}` : integer.toString()
  }

  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '')
  const result = `${integer.toString()}.${fractionStr}`
  return negative ? `-${result}` : result
}

export function ratioToFixed(numerator: bigint, denominator: bigint, decimals = 18): string {
  if (denominator === 0n) {
    return '0'
  }
  const scaled = (numerator * (10n ** BigInt(decimals))) / denominator
  return formatFixed(scaled, decimals)
}

export function parseFixed(value: string, decimals = 18): bigint {
  const [intPart, fracPart = ''] = value.split('.')
  const sanitizedFrac = fracPart.slice(0, decimals).padEnd(decimals, '0')
  const combined = `${intPart}${sanitizedFrac}`
  return BigInt(combined)
}

export async function insertTrade(prisma: PrismaClient, params: {
  marketId: string
  fpmmAddress: string
  txHash: string
  logIndex: number
  blockNumber: number
  timestamp: Date
  side: TradeSide
  outcome: number
  amountInUSDF: string
  price: string
  amountOutShares: string
  feeUSDF?: string | null
  taker?: string | null
  maker?: string | null
}) {
  const {
    marketId,
    fpmmAddress,
    txHash,
    logIndex,
    blockNumber,
    timestamp,
    side,
    outcome,
    amountInUSDF,
    price,
    amountOutShares,
    feeUSDF,
  } = params

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public.trades (
      market_id,
      fpmm_address,
      tx_hash,
      log_index,
      block_number,
      timestamp,
      side,
      outcome,
      amount_in_usdf,
      price,
      amount_out_shares,
      fee_usdf
    )
    VALUES (
      ${marketId},
      ${hexToBuffer(fpmmAddress)},
      ${hexToBuffer(txHash)},
      ${logIndex},
      ${blockNumber},
      ${timestamp},
      ${side},
      ${outcome},
      ${new Prisma.Decimal(amountInUSDF)},
      ${new Prisma.Decimal(price)},
      ${new Prisma.Decimal(amountOutShares)},
      ${feeUSDF == null ? Prisma.raw('NULL') : Prisma.sql`${new Prisma.Decimal(feeUSDF)}`}
    )
    ON CONFLICT (tx_hash, log_index) DO NOTHING;
  `)
}

export async function insertLiquidityEvent(prisma: PrismaClient, params: {
  marketId: string
  fpmmAddress: string
  txHash: string
  logIndex: number
  blockNumber: number
  timestamp: Date
  kind: 'init' | 'add' | 'remove' | 'trade'
  yesReserves: string
  noReserves: string
  tvlUSDF: string
  source?: string | null
}) {
  const {
    marketId,
    fpmmAddress,
    txHash,
    logIndex,
    blockNumber,
    timestamp,
    kind,
    yesReserves,
    noReserves,
    tvlUSDF,
    source = null,
  } = params

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public.liquidity_events (
      market_id,
      fpmm_address,
      tx_hash,
      log_index,
      block_number,
      timestamp,
      kind,
      yes_reserves,
      no_reserves,
      tvl_usdf,
      source
    )
    VALUES (
      ${marketId},
      ${hexToBuffer(fpmmAddress)},
      ${hexToBuffer(txHash)},
      ${logIndex},
      ${blockNumber},
      ${timestamp},
      ${kind},
      ${new Prisma.Decimal(yesReserves)},
      ${new Prisma.Decimal(noReserves)},
      ${new Prisma.Decimal(tvlUSDF)},
      ${source == null ? Prisma.raw('NULL') : Prisma.sql`${source}`}
    )
    ON CONFLICT (tx_hash, log_index) DO NOTHING;
  `)
}

export async function upsertCandle(prisma: PrismaClient, params: {
  marketId: string
  fpmmAddress: string
  bucketStart: Date
  price: string
  volumeUSDF: string
}) {
  const { marketId, fpmmAddress, bucketStart, price, volumeUSDF } = params

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public.candles_5m (
      market_id,
      fpmm_address,
      bucket_start,
      open_price,
      high_price,
      low_price,
      close_price,
      volume_usdf
    )
    VALUES (
      ${marketId},
      ${hexToBuffer(fpmmAddress)},
      ${bucketStart},
      ${new Prisma.Decimal(price)},
      ${new Prisma.Decimal(price)},
      ${new Prisma.Decimal(price)},
      ${new Prisma.Decimal(price)},
      ${new Prisma.Decimal(volumeUSDF)}
    )
    ON CONFLICT (market_id, bucket_start)
    DO UPDATE SET
      high_price = GREATEST(public.candles_5m.high_price, EXCLUDED.high_price),
      low_price = LEAST(public.candles_5m.low_price, EXCLUDED.low_price),
      close_price = EXCLUDED.close_price,
      volume_usdf = public.candles_5m.volume_usdf + EXCLUDED.volume_usdf;
  `)
}

export function truncateTo5m(date: Date): Date {
  const ms = date.getTime()
  const bucketMs = Math.floor(ms / (5 * 60 * 1000)) * 5 * 60 * 1000
  return new Date(bucketMs)
}

export function scaleAmount(amount: bigint, decimals = 18): string {
  return formatFixed(amount, decimals)
}

export function multiplyAndScale(amount: bigint, priceScaled: bigint, decimals = 18): string {
  const scaled = (amount * priceScaled) / SCALE_18
  return formatFixed(scaled, decimals)
}

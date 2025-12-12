import type { Redis } from 'ioredis'
import type { PrismaClient } from '@prisma/client'
import type { FastifyBaseLogger } from 'fastify'
import type { PublicClient, Hex, Log } from 'viem'
import { decodeEventLog, encodeEventTopics } from 'viem'
import { Prisma } from '@prisma/client'
import { ENV } from '@caifu/config'
import { withRpcLimiter, getLimiterStats } from '../lib/rpcLimiter'
import { sleep } from '../lib/sleep'
import {
  insertTrade,
  insertLiquidityEvent,
  upsertCandle,
  truncateTo5m,
  formatFixed,
  parseFixed,
  ratioToFixed,
  TradeSide,
} from '../lib/metricsStore'
import { FPMMABI } from '../lib/abi/FPMM'

type TxJob = {
  txHash: string
  marketId?: string
}

type SweepJob = {
  marketId: string
}

type MarketSyncRow = {
  market_id: string
  last_indexed_block: bigint
  last_audit_block: bigint | null
  sweeping: boolean
  updated_at: Date
}

type MarketMeta = {
  id: string
  slug: string | null
  fpmmAddress: `0x${string}`
}

type MarketState = {
  marketId: string
  fpmmAddress: `0x${string}`
  yesReserve: bigint
  noReserve: bigint
  hasLiquidity: boolean
}

type ProcessedTrade = {
  marketId: string
  fpmmAddress: string
  txHash: string
  outcome: number
  side: TradeSide
  price: string
  amountInUSDF: string
  amountOutShares: string
  feeUSDF: string | null
  timestamp: string
  blockNumber: number
  logIndex: number
}

type FpmmEventResult = {
  trade: ProcessedTrade | null
  liquidityKind: 'init' | 'add' | 'remove' | null
}

type LiquiditySummary = {
  init: number
  add: number
  remove: number
}

export type IndexerStats = {
  mode: 'api-ondemand'
  qps1m: number
  backoffMs: number
  last429At: number | null
  jobs: {
    txPending: number
    sweepPending: number
    inflight: number
  }
  head: {
    block: number | null
  }
  marketsLagTop: Array<{
    marketId: string
    slug: string | null
    lagBlocks: number
    lastIndexedBlock: number
  }>
}

interface QueueBackend {
  enqueueTx(job: TxJob): Promise<void>
  enqueueSweep(job: SweepJob, dedupeTtl: number): Promise<boolean>
  popTx(timeoutSeconds: number): Promise<TxJob | null>
  popSweep(timeoutSeconds: number): Promise<SweepJob | null>
  getPendingCounts(): Promise<{ tx: number; sweep: number }>
  releaseSweepLock(marketId: string): Promise<void>
  hasSweepLock(marketId: string): Promise<boolean>
}

const TX_QUEUE = 'recon:q:tx'
const SWEEP_QUEUE = 'recon:q:sweep'
const SWEEP_LOCK_PREFIX = 'recon:sweep:lock:'

const MAX_TX_RECEIPT_ATTEMPTS = 30
const TX_RECEIPT_POLL_MS = 1500
const BLOCK_CACHE_TTL_MS = 60_000

const sweepWindowBlocks = Math.max(1, parseInt(process.env.RECON_SWEEP_WINDOW_BLOCKS ?? '300', 10))
const sweepDedupeTtlSec = Math.max(1, parseInt(process.env.RECON_SWEEP_DEDUP_TTL_SEC ?? '120', 10))
const sweepCooldownMs = Math.max(30_000, parseInt(process.env.RECON_SWEEP_COOLDOWN_MS ?? '300000', 10))
const sweepMaxBatches = Math.max(1, parseInt(process.env.RECON_SWEEP_MAX_BATCHES_PER_SWEEP ?? '4', 10))
const scanBlocksPerBatch = Math.max(1, parseInt(process.env.RECON_SCAN_BLOCKS ?? '1000', 10))
const initLagBlocks = Math.max(0, parseInt(process.env.RECON_INIT_LAG_BLOCKS ?? '2', 10))
const reconBaselineBlock = (() => {
  const raw = process.env.RECON_BASELINE_BLOCK
  if (!raw) return 0n
  try {
    const value = BigInt(raw)
    return value > 0n ? value : 0n
  } catch {
    return 0n
  }
})()

const FPMM_EVENT_NAMES = ['FPMMFundingAdded', 'FPMMFundingRemoved', 'FPMMBuy', 'FPMMSell'] as const
const FPMM_EVENT_TOPICS: Hex[] = FPMM_EVENT_NAMES
  .map((eventName) => {
    const encoded = encodeEventTopics({
      abi: FPMMABI as any,
      eventName: eventName as any,
    })
    return encoded?.[0] as Hex | undefined
  })
  .filter((topic): topic is Hex => Boolean(topic))

const sleepShort = (ms: number) => sleep(Math.max(10, ms))

class RedisQueueBackend implements QueueBackend {
  private redis: Redis

  constructor(redis: Redis) {
    this.redis = redis
  }

  async enqueueTx(job: TxJob): Promise<void> {
    await this.redis.rpush(TX_QUEUE, JSON.stringify(job))
  }

  async enqueueSweep(job: SweepJob, dedupeTtl: number): Promise<boolean> {
    const lockKey = `${SWEEP_LOCK_PREFIX}${job.marketId}`
    const set = await this.redis.set(lockKey, '1', 'EX', dedupeTtl, 'NX')
    if (!set) {
      return false
    }
    await this.redis.rpush(SWEEP_QUEUE, JSON.stringify(job))
    return true
  }

  async popTx(timeoutSeconds: number): Promise<TxJob | null> {
    const result = await this.redis.blpop(TX_QUEUE, timeoutSeconds)
    if (!result) return null
    try {
      return JSON.parse(result[1]) as TxJob
    } catch {
      return null
    }
  }

  async popSweep(timeoutSeconds: number): Promise<SweepJob | null> {
    const result = await this.redis.blpop(SWEEP_QUEUE, timeoutSeconds)
    if (!result) return null
    try {
      return JSON.parse(result[1]) as SweepJob
    } catch {
      return null
    }
  }

  async getPendingCounts(): Promise<{ tx: number; sweep: number }> {
    const [tx, sweep] = await Promise.all([
      this.redis.llen(TX_QUEUE),
      this.redis.llen(SWEEP_QUEUE),
    ])
    return { tx, sweep }
  }

  async releaseSweepLock(marketId: string): Promise<void> {
    await this.redis.del(`${SWEEP_LOCK_PREFIX}${marketId}`)
  }

  async hasSweepLock(marketId: string): Promise<boolean> {
    const exists = await this.redis.exists(`${SWEEP_LOCK_PREFIX}${marketId}`)
    return exists > 0
  }
}

class MemoryQueueBackend implements QueueBackend {
  private tx: TxJob[] = []
  private sweep: SweepJob[] = []
  private sweepLocks = new Map<string, number>()

  async enqueueTx(job: TxJob): Promise<void> {
    this.tx.push(job)
  }

  async enqueueSweep(job: SweepJob, dedupeTtl: number): Promise<boolean> {
    const lock = this.sweepLocks.get(job.marketId)
    const now = Date.now()
    if (lock && lock > now) {
      return false
    }
    this.sweepLocks.set(job.marketId, now + dedupeTtl * 1000)
    this.sweep.push(job)
    return true
  }

  async popTx(_timeoutSeconds: number): Promise<TxJob | null> {
    return this.tx.shift() ?? null
  }

  async popSweep(_timeoutSeconds: number): Promise<SweepJob | null> {
    return this.sweep.shift() ?? null
  }

  async getPendingCounts(): Promise<{ tx: number; sweep: number }> {
    return { tx: this.tx.length, sweep: this.sweep.length }
  }

  async releaseSweepLock(marketId: string): Promise<void> {
    this.sweepLocks.delete(marketId)
  }

  async hasSweepLock(marketId: string): Promise<boolean> {
    const expiry = this.sweepLocks.get(marketId)
    if (!expiry) return false
    if (expiry < Date.now()) {
      this.sweepLocks.delete(marketId)
      return false
    }
    return true
  }
}

export interface OnDemandIndexer {
  start(): Promise<void>
  stop(): Promise<void>
  enqueueTx(job: TxJob): Promise<boolean>
  enqueueSweep(job: SweepJob): Promise<boolean>
  maybeEnqueueSweep(marketId: string): Promise<void>
  getStats(): Promise<IndexerStats>
  getLatestHead(): bigint | null
}

type IndexerOptions = {
  prisma: PrismaClient
  redis: Redis | null
  publicClient: PublicClient
  log: FastifyBaseLogger
}

function computeYesPriceScaled(yes: bigint, no: bigint): bigint {
  const total = yes + no
  if (total <= 0n) return 0n
  return (no * (10n ** 18n)) / total
}

function computeTVLScaled(yes: bigint, no: bigint): bigint {
  if (yes === 0n && no === 0n) return 0n
  const priceYes = computeYesPriceScaled(yes, no)
  const priceNo = (10n ** 18n) - priceYes
  const yesValue = (yes * priceYes) / (10n ** 18n)
  const noValue = (no * priceNo) / (10n ** 18n)
  return yesValue + noValue
}

function subtractWithFloor(value: bigint, delta: bigint): bigint {
  if (delta <= 0n) return value
  return value > delta ? value - delta : 0n
}

function isFpmmEvent(log: Log): boolean {
  if (!log?.topics || log.topics.length === 0) return false
  const topic = log.topics[0]
  return FPMM_EVENT_TOPICS.includes(topic as Hex)
}

export function createOnDemandIndexer(options: IndexerOptions): OnDemandIndexer {
  const { prisma, redis, publicClient, log } = options
  const queue: QueueBackend = redis ? new RedisQueueBackend(redis) : new MemoryQueueBackend()

  let running = false
  let stopped = false
  let txInflight = 0
  let sweepInflight = 0
  let cachedHead: bigint | null = null
  let cachedHeadFetchedAt = 0

  const blockTimestampCache = new Map<bigint, Date>()
  const marketCache = new Map<string, MarketMeta>()

  async function getCachedHead(refresh = false): Promise<bigint | null> {
    const now = Date.now()
    if (!refresh && cachedHead && now - cachedHeadFetchedAt < BLOCK_CACHE_TTL_MS) {
      return cachedHead
    }
    try {
      const head = await withRpcLimiter('getBlockNumber', () => publicClient.getBlockNumber())
      cachedHead = head
      cachedHeadFetchedAt = now
      return head
    } catch (error) {
      log.warn({ error }, 'Failed to refresh block head')
      return cachedHead
    }
  }

  async function getBlockTimestamp(blockNumber: bigint): Promise<Date> {
    const cached = blockTimestampCache.get(blockNumber)
    if (cached) return cached
    const block = await withRpcLimiter('getBlock', () => publicClient.getBlock({ blockNumber }))
    const ts = new Date(Number(block.timestamp) * 1000)
    blockTimestampCache.set(blockNumber, ts)
    if (blockTimestampCache.size > 512) {
      const firstKey = blockTimestampCache.keys().next().value
      if (firstKey !== undefined) {
        blockTimestampCache.delete(firstKey)
      }
    }
    return ts
  }

  async function resolveMarketMeta(marketId: string): Promise<MarketMeta | null> {
    for (const meta of marketCache.values()) {
      if (meta.id === marketId) {
        return meta
      }
    }

    const rows = await prisma.$queryRaw<Array<{ id: string; slug: string | null; fpmm_address: string | null }>>(Prisma.sql`
      SELECT id, slug, fpmm_address
      FROM public.markets
      WHERE id = ${marketId}
      LIMIT 1
    `)
    const row = rows[0]
    if (!row?.fpmm_address) {
      return null
    }
    const fpmmAddress = row.fpmm_address.toLowerCase() as `0x${string}`
    const meta: MarketMeta = {
      id: row.id,
      slug: row.slug,
      fpmmAddress,
    }
    marketCache.set(fpmmAddress, meta)
    return meta
  }

  async function findMarketByAddress(address: string): Promise<MarketMeta | null> {
    const normalized = address.toLowerCase()
    const cached = marketCache.get(normalized)
    if (cached) return cached
    const rows = await prisma.$queryRaw<Array<{ id: string; slug: string | null; fpmm_address: string | null }>>(Prisma.sql`
      SELECT id, slug, fpmm_address
      FROM public.markets
      WHERE lower(fpmm_address) = ${normalized}
      LIMIT 1
    `)
    const row = rows[0]
    if (!row?.fpmm_address) {
      return null
    }
    const meta: MarketMeta = {
      id: row.id,
      slug: row.slug,
      fpmmAddress: row.fpmm_address.toLowerCase() as `0x${string}`,
    }
    marketCache.set(meta.fpmmAddress, meta)
    return meta
  }

  async function getMarketSync(marketId: string): Promise<MarketSyncRow | null> {
    const rows = await prisma.$queryRaw<Array<MarketSyncRow>>(Prisma.sql`
      SELECT market_id, last_indexed_block, last_audit_block, sweeping, updated_at
      FROM public.market_sync
      WHERE market_id = ${marketId}
      LIMIT 1
    `)
    if (!rows.length) return null
    const row = rows[0]
    return {
      market_id: row.market_id,
      last_indexed_block: BigInt(row.last_indexed_block ?? 0),
      last_audit_block: row.last_audit_block != null ? BigInt(row.last_audit_block) : null,
      sweeping: row.sweeping,
      updated_at: row.updated_at,
    }
  }

  async function ensureMarketSync(marketId: string): Promise<MarketSyncRow> {
    const existing = await getMarketSync(marketId)
    if (existing) {
      return existing
    }
    const head = await getCachedHead(true)
    const baselineFromHead = head && head > BigInt(initLagBlocks) ? head - BigInt(initLagBlocks) : 0n
    const baseline = reconBaselineBlock > baselineFromHead ? reconBaselineBlock : baselineFromHead
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO public.market_sync (market_id, last_indexed_block)
      VALUES (${marketId}, ${baseline})
      ON CONFLICT (market_id) DO NOTHING;
    `)
    return {
      market_id: marketId,
      last_indexed_block: baseline,
      last_audit_block: null,
      sweeping: false,
      updated_at: new Date(),
    }
  }

  async function updateMarketSync(marketId: string, blockNumber: bigint, sweeping: boolean) {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO public.market_sync (market_id, last_indexed_block, sweeping, updated_at)
      VALUES (${marketId}, ${blockNumber}, ${sweeping}, NOW())
      ON CONFLICT (market_id) DO UPDATE
      SET last_indexed_block = GREATEST(public.market_sync.last_indexed_block, EXCLUDED.last_indexed_block),
          sweeping = ${sweeping},
          updated_at = NOW();
    `)
  }

  async function loadMarketState(meta: MarketMeta): Promise<MarketState> {
    const rows = await prisma.$queryRaw<Array<{ yes_reserves: Prisma.Decimal; no_reserves: Prisma.Decimal }>>(Prisma.sql`
      SELECT yes_reserves, no_reserves
      FROM public.liquidity_events
      WHERE market_id = ${meta.id}
      ORDER BY block_number DESC, log_index DESC
      LIMIT 1
    `)
    const row = rows[0]
    if (!row) {
      return {
        marketId: meta.id,
        fpmmAddress: meta.fpmmAddress,
        yesReserve: 0n,
        noReserve: 0n,
        hasLiquidity: false,
      }
    }
    const yesReserve = parseFixed(row.yes_reserves.toString(), 18)
    const noReserve = parseFixed(row.no_reserves.toString(), 18)
    return {
      marketId: meta.id,
      fpmmAddress: meta.fpmmAddress,
      yesReserve,
      noReserve,
      hasLiquidity: yesReserve > 0n || noReserve > 0n,
    }
  }

  async function publishTrade(trade: ProcessedTrade) {
    const channel = `market:${trade.marketId}:trades`
    const payload = {
      type: 'trade' as const,
      txHash: trade.txHash,
      side: trade.side,
      outcome: trade.outcome,
      price: trade.price,
      amountUSDF: trade.amountInUSDF,
      amountOutShares: trade.amountOutShares,
      feeUSDF: trade.feeUSDF,
      ts: trade.timestamp,
      blockNumber: trade.blockNumber,
      logIndex: trade.logIndex,
    }
    if (redis) {
      await redis.publish(channel, JSON.stringify(payload))
    }
  }

  async function publishIndexed(marketId: string, lastIndexedBlock: bigint, headOverride?: bigint | null) {
    if (!redis) return
    const channel = `market:${marketId}:trades`
    const head = headOverride ?? cachedHead
    const lastIndexedNumber = Number(lastIndexedBlock)
    const headNumber = head != null ? Number(head) : null
    const lagBlocks =
      head != null && head > lastIndexedBlock ? Number(head - lastIndexedBlock) : 0
    const payload = {
      type: 'indexed' as const,
      marketId,
      lastIndexedBlock: lastIndexedNumber,
      headBlock: headNumber,
      lagBlocks,
      emittedAt: new Date().toISOString(),
    }
    await redis.publish(channel, JSON.stringify(payload))
    log.info({ marketId, lastIndexedBlock: lastIndexedNumber, headBlock: payload.headBlock }, 'indexed.publish')
  }

  async function handleFpmmEvent(
    meta: MarketMeta,
    marketState: MarketState,
    decoded: { eventName: string; args: Record<string, any> },
    logEntry: Log,
    timestamp: Date
  ): Promise<FpmmEventResult> {
    const blockNumber = BigInt(logEntry.blockNumber ?? 0n)
    const logIndex = Number(logEntry.logIndex ?? 0)
    const txHash = typeof logEntry.transactionHash === 'string' ? logEntry.transactionHash : '0x'

    let broadcastTrade: ProcessedTrade | null = null
    let liquidityKind: 'init' | 'add' | 'remove' | null = null

    switch (decoded.eventName) {
      case 'FPMMFundingAdded': {
        const amounts: readonly bigint[] = Array.isArray(decoded.args?.amountsAdded)
          ? (decoded.args.amountsAdded as readonly bigint[])
          : Array.isArray(decoded.args?.amounts)
            ? (decoded.args.amounts as readonly bigint[])
            : []
        const yesAdded = amounts[0] ?? 0n
        const noAdded = amounts[1] ?? 0n
        const wasInitialized = marketState.hasLiquidity
        marketState.yesReserve += yesAdded
        marketState.noReserve += noAdded
        const tvlScaled = computeTVLScaled(marketState.yesReserve, marketState.noReserve)
        await insertLiquidityEvent(prisma, {
          marketId: meta.id,
          fpmmAddress: meta.fpmmAddress,
          txHash,
          logIndex,
          blockNumber: Number(blockNumber),
          timestamp,
          kind: wasInitialized ? 'add' : 'init',
          yesReserves: formatFixed(marketState.yesReserve, 18),
          noReserves: formatFixed(marketState.noReserve, 18),
          tvlUSDF: formatFixed(tvlScaled, 18),
        })
        log.info({ marketId: meta.id, txHash, blockNumber: Number(blockNumber), kind: wasInitialized ? 'add' : 'init' }, 'liquidity_event.inserted')
        liquidityKind = wasInitialized ? 'add' : 'init'
        marketState.hasLiquidity = true
        break
      }
      case 'FPMMFundingRemoved': {
        const amounts: readonly bigint[] = Array.isArray(decoded.args?.amountsRemoved)
          ? (decoded.args.amountsRemoved as readonly bigint[])
          : Array.isArray(decoded.args?.sendAmounts)
            ? (decoded.args.sendAmounts as readonly bigint[])
            : []
        const yesRemoved = amounts[0] ?? 0n
        const noRemoved = amounts[1] ?? 0n
        marketState.yesReserve = subtractWithFloor(marketState.yesReserve, yesRemoved)
        marketState.noReserve = subtractWithFloor(marketState.noReserve, noRemoved)
        const tvlScaled = computeTVLScaled(marketState.yesReserve, marketState.noReserve)
        await insertLiquidityEvent(prisma, {
          marketId: meta.id,
          fpmmAddress: meta.fpmmAddress,
          txHash,
          logIndex,
          blockNumber: Number(blockNumber),
          timestamp,
          kind: 'remove',
          yesReserves: formatFixed(marketState.yesReserve, 18),
          noReserves: formatFixed(marketState.noReserve, 18),
          tvlUSDF: formatFixed(tvlScaled, 18),
        })
        log.info({ marketId: meta.id, txHash, blockNumber: Number(blockNumber) }, 'liquidity_event.removed')
        liquidityKind = 'remove'
        break
      }
      case 'FPMMBuy': {
        const investmentAmount = BigInt(decoded.args?.investmentAmount ?? 0n)
        const feeAmount = BigInt(decoded.args?.feeAmount ?? 0n)
        const outcomeIndex = Number(decoded.args?.outcomeIndex ?? 0)
        const outcomeTokensBought = BigInt(decoded.args?.outcomeTokensBought ?? 0n)
        const buyer = decoded.args?.buyer as string | undefined
        const netInvestment = investmentAmount > feeAmount ? investmentAmount - feeAmount : 0n

        // Update reserves per outcome:
        // - outcomeIndex 0 = YES
        // - outcomeIndex 1 = NO
        // The invariant is that the side corresponding to the **other** outcome
        // receives the collateral, and the bought outcome side loses the excess
        // tokens beyond the newly minted netInvestment.
        if (outcomeIndex === 0) {
          // Buy YES: pool gains NO collateral, loses YES shares taken out.
          marketState.noReserve += netInvestment
          marketState.yesReserve = subtractWithFloor(marketState.yesReserve, outcomeTokensBought)
        } else if (outcomeIndex === 1) {
          // Buy NO: pool gains YES collateral, loses NO shares taken out.
          marketState.yesReserve += netInvestment
          marketState.noReserve = subtractWithFloor(marketState.noReserve, outcomeTokensBought)
        }

        const priceAfter = computeYesPriceScaled(marketState.yesReserve, marketState.noReserve)
        const amountInStr = formatFixed(investmentAmount, 18)
        const amountOutStr = formatFixed(outcomeTokensBought, 18)
        const execPriceStr = outcomeTokensBought > 0n ? ratioToFixed(investmentAmount, outcomeTokensBought, 18) : '0'
        const spotPriceStr = formatFixed(priceAfter, 18)
        const feeStr = feeAmount > 0n ? formatFixed(feeAmount, 18) : null

        await insertTrade(prisma, {
          marketId: meta.id,
          fpmmAddress: meta.fpmmAddress,
          txHash,
          logIndex,
          blockNumber: Number(blockNumber),
          timestamp,
          side: 'buy',
          outcome: outcomeIndex,
          amountInUSDF: amountInStr,
          price: execPriceStr,
          amountOutShares: amountOutStr,
          feeUSDF: feeStr,
          taker: buyer ?? null,
          maker: meta.fpmmAddress,
        })

        // Persist state
        await insertLiquidityEvent(prisma, {
          marketId: meta.id,
          fpmmAddress: meta.fpmmAddress,
          txHash,
          logIndex,
          blockNumber: Number(blockNumber),
          timestamp,
          kind: 'trade',
          yesReserves: formatFixed(marketState.yesReserve, 18),
          noReserves: formatFixed(marketState.noReserve, 18),
          tvlUSDF: formatFixed(computeTVLScaled(marketState.yesReserve, marketState.noReserve), 18),
        })

        await upsertCandle(prisma, {
          marketId: meta.id,
          fpmmAddress: meta.fpmmAddress,
          bucketStart: truncateTo5m(timestamp),
          // Candles should represent spot (post-trade pool state), not execution price.
          price: spotPriceStr,
          volumeUSDF: amountInStr,
        })

        broadcastTrade = {
          marketId: meta.id,
          fpmmAddress: meta.fpmmAddress,
          txHash,
          outcome: outcomeIndex,
          side: 'buy',
          price: execPriceStr,
          amountInUSDF: amountInStr,
          amountOutShares: amountOutStr,
          feeUSDF: feeStr,
          timestamp: timestamp.toISOString(),
          blockNumber: Number(blockNumber),
          logIndex,
        }
        break
      }
      case 'FPMMSell': {
        const returnAmount = BigInt(decoded.args?.returnAmount ?? 0n)
        const feeAmount = BigInt(decoded.args?.feeAmount ?? 0n)
        const outcomeIndex = Number(decoded.args?.outcomeIndex ?? 0)
        const outcomeTokensSold = BigInt(decoded.args?.outcomeTokensSold ?? 0n)
        const seller = decoded.args?.seller as string | undefined
        const totalOut = returnAmount + feeAmount

        // Update reserves per outcome (mirror of FPMMBuy):
        if (outcomeIndex === 0) {
          // Sell YES: pool receives YES shares, pays out USDF from NO side.
          marketState.yesReserve += outcomeTokensSold
          marketState.noReserve = subtractWithFloor(marketState.noReserve, totalOut)
        } else if (outcomeIndex === 1) {
          // Sell NO: pool receives NO shares, pays out USDF from YES side.
          marketState.noReserve += outcomeTokensSold
          marketState.yesReserve = subtractWithFloor(marketState.yesReserve, totalOut)
        }

        const priceAfter = computeYesPriceScaled(marketState.yesReserve, marketState.noReserve)
        const amountOutStr = formatFixed(returnAmount, 18)
        const amountInShares = formatFixed(outcomeTokensSold, 18)
        const execPriceStr = outcomeTokensSold > 0n ? ratioToFixed(returnAmount, outcomeTokensSold, 18) : '0'
        const spotPriceStr = formatFixed(priceAfter, 18)
        const feeStr = feeAmount > 0n ? formatFixed(feeAmount, 18) : null

        await insertTrade(prisma, {
          marketId: meta.id,
          fpmmAddress: meta.fpmmAddress,
          txHash,
          logIndex,
          blockNumber: Number(blockNumber),
          timestamp,
          side: 'sell',
          outcome: outcomeIndex,
          amountInUSDF: amountOutStr,
          price: execPriceStr,
          amountOutShares: amountInShares,
          feeUSDF: feeStr,
          taker: seller ?? null,
          maker: meta.fpmmAddress,
        })

        // Persist state
        await insertLiquidityEvent(prisma, {
          marketId: meta.id,
          fpmmAddress: meta.fpmmAddress,
          txHash,
          logIndex,
          blockNumber: Number(blockNumber),
          timestamp,
          kind: 'trade',
          yesReserves: formatFixed(marketState.yesReserve, 18),
          noReserves: formatFixed(marketState.noReserve, 18),
          tvlUSDF: formatFixed(computeTVLScaled(marketState.yesReserve, marketState.noReserve), 18),
        })

        await upsertCandle(prisma, {
          marketId: meta.id,
          fpmmAddress: meta.fpmmAddress,
          bucketStart: truncateTo5m(timestamp),
          // Candles should reflect spot after the trade, not the execution price.
          price: spotPriceStr,
          volumeUSDF: amountOutStr,
        })

        broadcastTrade = {
          marketId: meta.id,
          fpmmAddress: meta.fpmmAddress,
          txHash,
          outcome: outcomeIndex,
          side: 'sell',
          price: execPriceStr,
          amountInUSDF: amountOutStr,
          amountOutShares: amountInShares,
          feeUSDF: feeStr,
          timestamp: timestamp.toISOString(),
          blockNumber: Number(blockNumber),
          logIndex,
        }
        break
      }
      default:
        break
    }

    return { trade: broadcastTrade, liquidityKind }
  }

  async function processLogs(meta: MarketMeta, logs: Log[]) {
    if (!logs.length) {
      return {
        matched: 0,
        liquidity: { init: 0, add: 0, remove: 0 } as LiquiditySummary,
      }
    }
    const state = await loadMarketState(meta)
    let lastBlock = state.hasLiquidity ? 0n : 0n
    let matched = 0
    const liquidityCounts: LiquiditySummary = { init: 0, add: 0, remove: 0 }

    for (const logEntry of logs) {
      if (!isFpmmEvent(logEntry)) continue
      matched += 1
      const blockNumber = BigInt(logEntry.blockNumber ?? 0n)
      const timestamp = await getBlockTimestamp(blockNumber)
      try {
        const decoded = decodeEventLog({
          abi: FPMMABI as any,
          data: logEntry.data as Hex,
          topics: logEntry.topics as unknown as [Hex, ...Hex[]],
        })
        const result = await handleFpmmEvent(meta, state, decoded as any, logEntry, timestamp)
        if (result.liquidityKind) {
          liquidityCounts[result.liquidityKind] += 1
        }
        if (result.trade) {
          await publishTrade(result.trade)
        }
        lastBlock = blockNumber
      } catch (error) {
        log.warn({ error, marketId: meta.id }, 'Failed to decode FPMM event')
      }
    }

    if (lastBlock > 0n) {
      cachedHead = cachedHead && cachedHead > lastBlock ? cachedHead : lastBlock
    }

    return {
      matched,
      liquidity: liquidityCounts,
    }
  }

  async function handleTxJob(job: TxJob) {
    const txHash = job.txHash as `0x${string}`
    log.info({ txHash, marketId: job.marketId }, 'tx_job.start')
    let attempt = 0
    let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>> | null = null
    while (attempt < MAX_TX_RECEIPT_ATTEMPTS) {
      attempt += 1
      try {
        receipt = await withRpcLimiter('getTransactionReceipt', () =>
          publicClient.getTransactionReceipt({ hash: txHash })
        )
        break
      } catch (error) {
        const message = (error as any)?.shortMessage || (error as any)?.message || ''
        if (message.toLowerCase().includes('not found')) {
          await sleepShort(TX_RECEIPT_POLL_MS)
          continue
        }
        throw error
      }
    }

    if (!receipt) {
      log.warn({ txHash }, 'Transaction receipt not found after polling, requeueing')
      await queue.enqueueTx(job)
      return
    }

    const blockNumber = receipt.blockNumber ?? 0n
    cachedHead = cachedHead && cachedHead > blockNumber ? cachedHead : blockNumber

    const logs = await withRpcLimiter('getLogs', () =>
      publicClient.getLogs({
        blockHash: receipt!.blockHash,
      })
    )

    const logsByMarket = new Map<
      string,
      {
        meta: MarketMeta
        logs: Log[]
      }
    >()

    const ensureEntry = (meta: MarketMeta | null) => {
      if (!meta) return null
      const existing = logsByMarket.get(meta.id)
      if (existing) {
        return existing
      }
      const entry = { meta, logs: [] as Log[] }
      logsByMarket.set(meta.id, entry)
      return entry
    }

    if (job.marketId) {
      const meta = await resolveMarketMeta(job.marketId)
      ensureEntry(meta)
      if (meta) {
        const relevant = logs.filter((logEntry) => logEntry.address?.toLowerCase() === meta.fpmmAddress)
        logsByMarket.get(meta.id)!.logs.push(...relevant)
      }
    }

    if (!job.marketId || logsByMarket.size === 0) {
      for (const logEntry of logs) {
        if (!logEntry.address) continue
        const meta = await findMarketByAddress(logEntry.address)
        const entry = ensureEntry(meta)
        if (!entry) continue
        entry.logs.push(logEntry)
      }
    }

    if (logsByMarket.size === 0 && job.marketId) {
      const meta = await resolveMarketMeta(job.marketId)
      ensureEntry(meta)
    }

    for (const { meta, logs: marketLogs } of logsByMarket.values()) {
      await ensureMarketSync(meta.id)
      let summary: { matched: number; liquidity: LiquiditySummary } = {
        matched: 0,
        liquidity: { init: 0, add: 0, remove: 0 },
      }
      let processed = true
      try {
        if (marketLogs.length > 0) {
          summary = await processLogs(meta, marketLogs)
        }
      } catch (error) {
        processed = false
        log.error({ error, txHash, marketId: meta.id }, 'Failed to process transaction logs, scheduling sweep')
        try {
          await queue.enqueueSweep({ marketId: meta.id }, sweepDedupeTtlSec)
        } catch (enqueueError) {
          log.error({ enqueueError, marketId: meta.id }, 'Failed to enqueue recovery sweep after tx failure')
        }
      } finally {
        await queue.releaseSweepLock(meta.id)
      }

      if (!processed) {
        continue
      }

      await updateMarketSync(meta.id, blockNumber, false)
      log.info({ marketId: meta.id, blockNumber: Number(blockNumber), txHash }, 'tx_job.market_processed')
      await publishIndexed(meta.id, blockNumber)
    }
  }

  async function handleSweepJob(job: SweepJob) {
    const meta = await resolveMarketMeta(job.marketId)
    if (!meta) {
      return
    }

    let syncRow = await ensureMarketSync(meta.id)
    if (reconBaselineBlock > 0n && syncRow.last_indexed_block < reconBaselineBlock) {
      await updateMarketSync(meta.id, reconBaselineBlock, false)
      syncRow = {
        ...syncRow,
        last_indexed_block: reconBaselineBlock,
      }
    }
    const latestHead = await getCachedHead(true)
    if (!latestHead) {
      return
    }

    const lag = latestHead > syncRow.last_indexed_block ? latestHead - syncRow.last_indexed_block : 0n
    if (lag <= BigInt(sweepWindowBlocks)) {
      return
    }

    let adjustedSyncRow = syncRow
    if (reconBaselineBlock > 0n && syncRow.last_indexed_block < reconBaselineBlock) {
      await updateMarketSync(meta.id, reconBaselineBlock, false)
      syncRow = {
        ...syncRow,
        last_indexed_block: reconBaselineBlock,
      }
    }

    if (syncRow.last_indexed_block <= 0n) {
      const firstTradeRows = await prisma.$queryRaw<Array<{ min_block: bigint | null }>>(Prisma.sql`
        SELECT MIN(block_number)::bigint AS min_block
        FROM public.trades
        WHERE market_id = ${meta.id}
      `)
      const minBlock = firstTradeRows[0]?.min_block
      if (minBlock && minBlock > 0n) {
        const safetyWindow = BigInt(Math.max(scanBlocksPerBatch * sweepMaxBatches, 50_000))
        const baseline = minBlock > safetyWindow ? minBlock - safetyWindow : 0n
        await prisma.$executeRaw(Prisma.sql`
          UPDATE public.market_sync
          SET last_indexed_block = ${baseline}, updated_at = NOW()
          WHERE market_id = ${meta.id}
        `)
        adjustedSyncRow = {
          market_id: meta.id,
          last_indexed_block: baseline,
          last_audit_block: syncRow.last_audit_block,
          sweeping: syncRow.sweeping,
          updated_at: new Date(),
        }
        log.info({ marketId: meta.id, baseline: Number(baseline), reason: 'bootstrap' }, 'sweep.baseline_adjusted')
      }
    }

    let fromBlock = adjustedSyncRow.last_indexed_block + 1n
    let batches = 0
    let lastProcessed = adjustedSyncRow.last_indexed_block

    log.info({ marketId: meta.id, from: Number(fromBlock), head: Number(latestHead), maxBatches: sweepMaxBatches }, 'sweep.begin')

    try {
      while (fromBlock <= latestHead && batches < sweepMaxBatches) {
        const batchFrom = fromBlock
        const toBlock = batchFrom + BigInt(scanBlocksPerBatch) - 1n
        const upper = toBlock > latestHead ? latestHead : toBlock
        batches += 1
        const logs = await withRpcLimiter('getLogs', () =>
          publicClient.getLogs({
            fromBlock: batchFrom,
            toBlock: upper,
            address: [meta.fpmmAddress] as `0x${string}`[],
          })
        )
        log.info({ marketId: meta.id, from: Number(batchFrom), to: Number(upper), count: logs.length }, 'sweep.window')
        const summary = await processLogs(meta, logs)
        log.info(
          {
            marketId: meta.id,
            from: Number(batchFrom),
            to: Number(upper),
            matched: summary.matched,
            liquidity: summary.liquidity,
          },
          'sweep.batch'
        )
        lastProcessed = upper
        fromBlock = upper + 1n
        if (fromBlock <= latestHead) {
          await sleepShort(150)
        }
      }
    } catch (error) {
      log.error({ error, marketId: meta.id }, 'Sweep job failed')
      throw error
    } finally {
      await queue.releaseSweepLock(job.marketId)
    }

    const updatedBlock = lastProcessed > adjustedSyncRow.last_indexed_block ? lastProcessed : adjustedSyncRow.last_indexed_block
    await updateMarketSync(meta.id, updatedBlock, false)
    await publishIndexed(meta.id, updatedBlock, latestHead)
  }

  async function txLoop() {
    while (!stopped) {
      let job: TxJob | null = null
      let active = false
      try {
        job = await queue.popTx(2)
        if (!job) continue
        active = true
        txInflight += 1
        await handleTxJob(job)
      } catch (error) {
        log.error({ error, job }, 'Error processing tx job')
        if (job) {
          try {
            await queue.enqueueTx(job)
          } catch (enqueueError) {
            log.error({ enqueueError, job }, 'Failed to requeue tx job')
          }
        }
        await sleepShort(500)
      } finally {
        if (active) {
          txInflight = Math.max(0, txInflight - 1)
        }
      }
    }
  }

  async function sweepLoop() {
    while (!stopped) {
      let job: SweepJob | null = null
      let active = false
      try {
        job = await queue.popSweep(2)
        if (!job) continue
        active = true
        sweepInflight += 1
        await updateMarketSync(job.marketId, 0n, true)
        await handleSweepJob(job)
      } catch (error) {
        log.error({ error, job }, 'Error processing sweep job')
        if (job) {
          try {
            await queue.enqueueSweep(job, sweepDedupeTtlSec)
          } catch (enqueueError) {
            log.error({ enqueueError, job }, 'Failed to requeue sweep job')
          }
        }
        await sleepShort(500)
      } finally {
        if (active) {
          sweepInflight = Math.max(0, sweepInflight - 1)
        }
      }
    }
  }

  async function maybeEnqueueSweep(marketId: string) {
    const sync = await ensureMarketSync(marketId)

    // Clamp very old cursors to a configured baseline so we never sweep from genesis
    if (reconBaselineBlock > 0n && sync.last_indexed_block < reconBaselineBlock) {
      await updateMarketSync(marketId, reconBaselineBlock, false)
      sync.last_indexed_block = reconBaselineBlock
    }

    const head = await getCachedHead()
    if (!head) return
    const lag = head > sync.last_indexed_block ? head - sync.last_indexed_block : 0n
    if (lag <= BigInt(sweepWindowBlocks)) {
      return
    }

    const lastUpdatedMs = sync.updated_at ? new Date(sync.updated_at).getTime() : 0
    const nowMs = Date.now()

    // Throttle sweeps unless the lag is very large (4x the window)
    if (lag < BigInt(sweepWindowBlocks * 4) && nowMs - lastUpdatedMs < sweepCooldownMs) {
      return
    }

    await queue.enqueueSweep({ marketId }, sweepDedupeTtlSec)
  }

  async function getStats(): Promise<IndexerStats> {
    const limiter = getLimiterStats()
    const pending = await queue.getPendingCounts()
    const head = await getCachedHead()

    const lagRows = head
      ? await prisma.$queryRaw<Array<{ market_id: string; slug: string | null; last_indexed_block: bigint }>>(Prisma.sql`
          SELECT m.id AS market_id, m.slug, s.last_indexed_block
          FROM public.market_sync s
          JOIN public.markets m ON m.id = s.market_id
          ORDER BY s.last_indexed_block ASC
          LIMIT 5
        `)
      : []

    const marketsLagTop = (lagRows || []).map((row) => {
      const lastIndexed = BigInt(row.last_indexed_block ?? 0)
      const lag = head && head > lastIndexed ? head - lastIndexed : 0n
      return {
        marketId: row.market_id,
        slug: row.slug,
        lagBlocks: Number(lag),
        lastIndexedBlock: Number(lastIndexed),
      }
    })

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO public.recon_state (id, rpc_qps1m, last_429_at, backoff_ms, jobs_pending, jobs_inflight, updated_at)
      VALUES (TRUE, ${limiter.qps1m}, ${limiter.last429At ? new Date(limiter.last429At) : Prisma.raw('NULL')}, ${limiter.backoffMs}, ${pending.tx + pending.sweep}, ${txInflight + sweepInflight}, NOW())
      ON CONFLICT (id) DO UPDATE
      SET rpc_qps1m = EXCLUDED.rpc_qps1m,
          last_429_at = EXCLUDED.last_429_at,
          backoff_ms = EXCLUDED.backoff_ms,
          jobs_pending = EXCLUDED.jobs_pending,
          jobs_inflight = EXCLUDED.jobs_inflight,
          updated_at = NOW();
    `)

    return {
      mode: 'api-ondemand',
      qps1m: limiter.qps1m,
      backoffMs: limiter.backoffMs,
      last429At: limiter.last429At,
      jobs: {
        txPending: pending.tx,
        sweepPending: pending.sweep,
        inflight: txInflight + sweepInflight,
      },
      head: {
        block: head ? Number(head) : null,
      },
      marketsLagTop,
    }
  }

  return {
    async start() {
      if (running) return
      running = true
      stopped = false
      void txLoop()
      void sweepLoop()
      log.info('On-demand indexer started')
    },
    async stop() {
      stopped = true
      running = false
    },
    async enqueueTx(job: TxJob): Promise<boolean> {
      if (!job?.txHash) return false
      await queue.enqueueTx(job)
      return true
    },
    async enqueueSweep(job: SweepJob): Promise<boolean> {
      if (!job?.marketId) return false
      const queued = await queue.enqueueSweep(job, sweepDedupeTtlSec)
      return queued
    },
    maybeEnqueueSweep,
    getStats,
    getLatestHead() {
      return cachedHead
    },
  }
}

export function createNoopIndexer(): OnDemandIndexer {
  return {
    async start() { },
    async stop() { },
    async enqueueTx() {
      return false
    },
    async enqueueSweep() {
      return false
    },
    async maybeEnqueueSweep() { },
    async getStats() {
      const limiter = getLimiterStats()
      return {
        mode: 'api-ondemand',
        qps1m: limiter.qps1m,
        backoffMs: limiter.backoffMs,
        last429At: limiter.last429At,
        jobs: { txPending: 0, sweepPending: 0, inflight: 0 },
        head: { block: null },
        marketsLagTop: [],
      }
    },
    getLatestHead() {
      return null
    },
  }
}

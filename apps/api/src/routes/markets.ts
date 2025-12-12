import { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Address, Hex } from 'viem'
import {
  MarketResponseSchema,
  PublicCreateMarketInputSchema,
  type MarketResponse
} from '@caifu/types'
import {
  GetMarketsQuerySchema,
  formatValidationError,
  type GetMarketsQuery
} from '../lib/schemas'
import { createMarketInternal, MarketCreationError } from '../services/marketCreation'
import { inc as incValidationMetric } from '../lib/validationMetrics'
import { formatZodIssues } from '../lib/zod'
import { formatFixed, parseFixed, insertLiquidityEvent } from '../lib/metricsStore'
import { getCTFContract, getFPMMContract, resolvePositionId } from '../lib/contracts'
import { uploadPaths } from '../lib/uploads'
import { assertImageSafe } from '../lib/imageSafety'
const SCALE_18 = 10n ** 18n
const CACHE_MAX_AGE_SECONDS = 15
const CACHE_STALE_REVALIDATE_SECONDS = 60
const SWEEP_WINDOW_BLOCKS = Math.max(1, parseInt(process.env.RECON_SWEEP_WINDOW_BLOCKS ?? '300', 10))
const TX_NOTIFY_TOKEN = process.env.TX_NOTIFY_TOKEN || null
const TX_NOTIFY_HEADER = 'x-tx-notify-token'
const SUMMARY_TIMEOUT_MS = Math.max(500, parseInt(process.env.SUMMARY_TIMEOUT_MS ?? '1200', 10))
const SUMMARY_TIMEOUT_SYMBOL = Symbol('summary-timeout')
const ONCHAIN_PROBE_COOLDOWN_MS = Math.max(0, parseInt(process.env.ONCHAIN_PROBE_COOLDOWN_MS ?? '60000', 10))
const onchainProbeCache = new Map<string, number>()
const tradeProbeCache = new Map<string, number>()
const PUBLIC_DEFAULT_FEE_BPS = 269
const PUBLIC_DEFAULT_INITIAL_PRICE_BPS = 5000
const TxNotifySchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  marketId: z.string().optional(),
})

const sanitizeEtagPart = (value: string | number | bigint | null | undefined) => {
  if (value === null || value === undefined) return '0'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : '0'
  return String(value)
}

const createEtag = (label: string, marketId: string, ...parts: Array<string | number | bigint | null | undefined>) => {
  const joined = [label, marketId, ...parts].map(sanitizeEtagPart).join(':')
  return `W/"${joined}"`
}

const applyCacheHeaders = (reply: FastifyReply, etag: string, lastModifiedMs: number) => {
  reply
    .header('ETag', etag)
    .header(
      'Cache-Control',
      `public, max-age=${CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=${CACHE_STALE_REVALIDATE_SECONDS}`
    )
    .header('Last-Modified', new Date(lastModifiedMs).toUTCString())
    .header('Vary', 'Accept,Accept-Encoding,If-None-Match')
}

async function promiseWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof SUMMARY_TIMEOUT_SYMBOL> {
  return Promise.race([
    promise,
    new Promise<typeof SUMMARY_TIMEOUT_SYMBOL>((resolve) => {
      setTimeout(() => resolve(SUMMARY_TIMEOUT_SYMBOL), ms)
    }),
  ])
}

function bufferToHex(buf: Buffer | Uint8Array | null): string | null {
  if (!buf) return null
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  return `0x${buffer.toString('hex')}`
}

function computeYesPriceScaled(yes: bigint, no: bigint): bigint {
  const total = yes + no
  if (total <= 0n) return 0n
  return (no * SCALE_18) / total
}

function computeTVLScaled(yes: bigint, no: bigint): bigint {
  if (yes === 0n && no === 0n) return 0n
  const priceYes = computeYesPriceScaled(yes, no)
  const priceNo = SCALE_18 - priceYes
  const yesValue = (yes * priceYes) / SCALE_18
  const noValue = (no * priceNo) / SCALE_18
  return yesValue + noValue
}


async function upsertSpotPoint(
  prisma: PrismaClient,
  marketId: string,
  timestamp: Date,
  yesPriceScaled: bigint
): Promise<void> {
  if (yesPriceScaled < 0n || yesPriceScaled > SCALE_18) return
  const yesStr = formatFixed(yesPriceScaled, 18)
  const noStr = formatFixed(SCALE_18 - yesPriceScaled, 18)
  const id = randomUUID()
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public.market_spot_points (id, market_id, timestamp, yes_price, no_price)
    VALUES (${id}, ${marketId}, ${timestamp}, ${yesStr}::numeric, ${noStr}::numeric)
    ON CONFLICT (market_id, timestamp) DO NOTHING;
  `)
}

function decimalToString(value: Prisma.Decimal | null | undefined): string {
  if (!value) return '0'
  return value.toString()
}

async function fetchOnchainReserves(
  fastify: any,
  fpmmAddress: string | null | undefined,
  conditionId: string | null | undefined
): Promise<{ yesReserve: bigint; noReserve: bigint } | null> {
  if (!fpmmAddress || !conditionId) return null

  const fpmm = getFPMMContract(fpmmAddress)
  const ctf = getCTFContract()
  if (!fpmm || !ctf) return null

  try {
    const collateral = await fastify.publicClient.readContract({
      address: fpmm.address,
      abi: fpmm.abi,
      functionName: 'collateralToken',
      args: [],
    }) as Address

    const yesPosition = await resolvePositionId(conditionId as Hex, 0, collateral)
    const noPosition = await resolvePositionId(conditionId as Hex, 1, collateral)

    const balances = await fastify.publicClient.readContract({
      address: ctf.address,
      abi: ctf.abi,
      functionName: 'balanceOfBatch',
      args: [[fpmm.address, fpmm.address], [yesPosition, noPosition]],
    }) as readonly bigint[]

    return {
      yesReserve: balances?.[0] ?? 0n,
      noReserve: balances?.[1] ?? 0n,
    }
  } catch (error) {
    fastify.log.warn({ error, fpmmAddress, conditionId }, 'summary.onchain_reserves_failed')
    return null
  }
}

const listTradesForMarket = async (
  prisma: PrismaClient,
  marketKey: string,
  limit: number,
  beforeDate: Date | null
) => {
  const market = await resolveMarket(prisma, marketKey)
  if (!market) {
    return null
  }

  const rows = await prisma.$queryRaw<Array<{
    tx_hash: Buffer | null
    log_index: number
    block_number: number
    timestamp: Date
    side: string
    outcome: number
    amount_in_usdf: Prisma.Decimal
    price: Prisma.Decimal
    amount_out_shares: Prisma.Decimal
    fee_usdf: Prisma.Decimal | null
  }>>(Prisma.sql`
    SELECT
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
    FROM public.trades
    WHERE market_id = ${market.id}
    ${beforeDate ? Prisma.sql`AND timestamp < ${beforeDate}` : Prisma.sql``}
    ORDER BY timestamp DESC, log_index DESC
    LIMIT ${limit}
  `)

  const response = rows.map((row) => ({
    txHash: bufferToHex(row.tx_hash),
    logIndex: row.log_index,
    blockNumber: row.block_number,
    timestamp: row.timestamp.toISOString(),
    side: row.side,
    outcome: row.outcome,
    amountInUSDF: decimalToString(row.amount_in_usdf),
    price: decimalToString(row.price),
    amountOutShares: decimalToString(row.amount_out_shares),
    feeUSDF: row.fee_usdf ? decimalToString(row.fee_usdf) : null,
  }))

  return { market, trades: response }
}


type MarketRow = {
  id: string
  conditionId: string | null
  fpmmAddress: string | null
  title: string
  category: string | null
  outcomes: string[] | null
  status: string
  createdAt: Date
  expiresAt: Date | null
  resolvedAt: Date | null
  resolutionData: Prisma.JsonValue | null
  slug: string | null
  tags: string[]
  heroImageUrl: string | null
}

const resolveMarket = async (prisma: PrismaClient, key: string): Promise<MarketRow | null> => {
  const normalized = key.trim()
  if (!normalized) return null

  const rows = await prisma.$queryRaw<Array<MarketRow & { outcomes: any; tags: any }>>(Prisma.sql`
    SELECT
      id,
      "conditionId",
      fpmm_address AS "fpmmAddress",
      title,
      category,
      outcomes,
      status,
      "createdAt",
      expires_at AS "expiresAt",
      "resolvedAt",
      "resolutionData",
      slug,
      tags,
      hero_image_url AS "heroImageUrl"
    FROM public.markets
    WHERE (
      id = ${normalized}
      OR (slug IS NOT NULL AND lower(slug) = lower(${normalized}))
    )
      AND status <> 'deleted'
    ORDER BY CASE WHEN id = ${normalized} THEN 0 ELSE 1 END
    LIMIT 1
  `)

  if (rows.length === 0) return null

  const [row] = rows
  return {
    ...row,
    outcomes: Array.isArray(row.outcomes) ? (row.outcomes as string[]) : null,
    category: typeof row.category === 'string' && row.category.length > 0 ? row.category : null,
    tags: Array.isArray(row.tags)
      ? (row.tags as string[]).filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
      : [],
    heroImageUrl:
      typeof row.heroImageUrl === 'string' && row.heroImageUrl.trim().length > 0
        ? row.heroImageUrl
        : null,
  }
}

export const marketRoutes: FastifyPluginAsync = async (fastify) => {
  const { prisma } = fastify
  fastify.post('/market-hero/upload', async (request, reply) => {
    const parts = request.parts()
    let uploadedFile: { buffer: Buffer; mimetype: string; filename?: string } | null = null

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const chunks: Buffer[] = []
        for await (const chunk of part.file) {
          if (typeof chunk === 'string') {
            chunks.push(Buffer.from(chunk))
          } else {
            chunks.push(chunk)
          }
        }
        uploadedFile = {
          buffer: Buffer.concat(chunks),
          mimetype: part.mimetype,
          filename: part.filename,
        }
      } else if (part.type === 'file') {
        part.file.resume()
      }
    }

    if (!uploadedFile) {
      return reply.status(400).send({
        error: {
          code: 'FILE_REQUIRED',
          message: 'An image file is required',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const mimeToExt: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
    }

    const extension = mimeToExt[uploadedFile.mimetype]
    if (!extension) {
      return reply.status(400).send({
        error: {
          code: 'UNSUPPORTED_TYPE',
          message: 'Only PNG, JPEG, WEBP, or GIF images are allowed',
        },
        timestamp: new Date().toISOString(),
      })
    }

    try {
      await assertImageSafe(uploadedFile.buffer, request.log)
    } catch (error) {
      request.log.warn({ error }, 'market_hero_upload_safety_rejected')
      return reply.status(422).send({
        error: {
          code: 'IMAGE_REJECTED',
          message: 'Image failed safety checks',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const safeNameFragment =
      uploadedFile.filename?.replace(/[^a-zA-Z0-9-_]+/g, '').slice(0, 32) || 'market'
    const fileName = `${safeNameFragment}-${Date.now().toString(36)}${Math.random()
      .toString(16)
      .slice(2)}${extension}`
    const destination = path.join(uploadPaths.marketHeroes, fileName)

    request.log.info(
      { destination, bytes: uploadedFile.buffer.length },
      'market_hero_upload_write_start'
    )
    try {
      await fs.writeFile(destination, uploadedFile.buffer)
    } catch (error) {
      request.log.error({ error, destination }, 'market_hero_upload_failed')
      return reply.status(500).send({
        error: {
          code: 'UPLOAD_FAILED',
          message: 'Failed to save uploaded file',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const publicUrl = `/static/market-heroes/${fileName}`
    request.log.info({ destination, publicUrl }, 'market_hero_upload_write_done')

    return reply.send({
      imageUrl: publicUrl,
    })
  })

  fastify.post<{ Body: unknown }>('/markets', async (request, reply) => {
    const rawBody = typeof request.body === 'object' && request.body !== null
      ? { ...(request.body as Record<string, unknown>) }
      : {}

    if (rawBody.feeBps == null) {
      rawBody.feeBps = PUBLIC_DEFAULT_FEE_BPS
    }
    if (rawBody.initialPriceBps == null) {
      rawBody.initialPriceBps = PUBLIC_DEFAULT_INITIAL_PRICE_BPS
    }

    if (typeof rawBody.category === 'string') {
      rawBody.category = (rawBody.category as string).trim()
    }

    if (typeof rawBody.tags === 'string') {
      rawBody.tags = (rawBody.tags as string)
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    }

    if (Array.isArray(rawBody.tags)) {
      const seen = new Map<string, string>()
      for (const entry of rawBody.tags as Array<unknown>) {
        if (typeof entry !== 'string') continue
        const trimmed = entry.trim()
        if (!trimmed) continue
        const normalized = trimmed.toLowerCase()
        if (!seen.has(normalized)) {
          seen.set(normalized, trimmed)
        }
      }
      rawBody.tags = Array.from(seen.values()).slice(0, 12)
    }

    if (typeof rawBody.heroImageUrl === 'string') {
      rawBody.heroImageUrl = (rawBody.heroImageUrl as string).trim()
    }

    const parsed = PublicCreateMarketInputSchema.safeParse(rawBody)
    if (!parsed.success) {
      incValidationMetric('POST /api/markets')
      const issues = formatZodIssues(parsed.error.issues)
      return reply.status(400).send({
        error: 'validation_failed',
        issues,
        timestamp: new Date().toISOString(),
      })
    }

    try {
      const creatorUserId = (request as any)?.user?.id ?? null
      const result = await createMarketInternal(fastify, parsed.data, {
        creatorUserId,
        logger: request.log,
      })
      return reply.status(201).send(result)
    } catch (error) {
      if (error instanceof MarketCreationError) {
        return reply.status(error.statusCode).send({
          ...error.body,
          timestamp: (error.body && error.body.timestamp) || new Date().toISOString(),
        })
      }
      fastify.log.error({ error }, 'public_create_market_failed')
      return reply.status(500).send({
        error: 'internal_error',
        message: 'Failed to create market',
        timestamp: new Date().toISOString(),
      })
    }
  })

  // Get all markets
  fastify.get<{
    Querystring: GetMarketsQuery
  }>('/markets', {
    schema: {
      querystring: GetMarketsQuerySchema
    }
  }, async (request, reply) => {
    try {
      // Extract query params with defaults
      const limit = Number(request.query.limit || 20)
      const search = request.query.search
      const status = request.query.status
      const cursor = request.query.cursor
      const includeDeleted = request.query.includeDeleted === '1'
      
      // Build where clause
      const where: any = {}
      if (status) {
        where.status = status
      }
      if (!includeDeleted) {
        where.status = where.status ? where.status : { not: 'deleted' }
      }
      if (search) {
        where.title = {
          contains: search,
          mode: 'insensitive'
        }
      }
      if (cursor) {
        where.id = {
          gt: cursor
        }
      }
      
      const markets = await prisma.market.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit
      })

      // Fetch latest spot price for each market (efficient raw SQL with DISTINCT ON)
      const marketIds = markets.map(m => m.id)
      let spotMap = new Map<string, number>()
      if (marketIds.length > 0) {
        const latestSpots = await prisma.$queryRaw<Array<{ market_id: string; yes_price: string }>>`
          SELECT DISTINCT ON (market_id) market_id, yes_price
          FROM market_spot_points
          WHERE market_id = ANY(${marketIds})
          ORDER BY market_id, timestamp DESC
        `
        spotMap = new Map(latestSpots.map(s => [s.market_id, parseFloat(s.yes_price)]))
      }

      const response: MarketResponse[] = markets.map((market: any) => ({
        id: market.id,
        conditionId: market.conditionId,
        fpmmAddress: market.fpmmAddress,
        slug: market.slug ?? null,
        title: market.title,
        outcomes: Array.isArray(market.outcomes) ? market.outcomes : [],
      status: market.status as any,
      category: typeof market.category === 'string' ? market.category : null,
      tags: Array.isArray(market.tags)
        ? (market.tags as string[]).filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
        : [],
      heroImageUrl:
        typeof market.heroImageUrl === 'string' && market.heroImageUrl.trim().length > 0
          ? market.heroImageUrl
          : null,
      createdAt: market.createdAt.toISOString(),
      expiresAt: market.expiresAt?.toISOString?.(),
      resolvedAt: market.resolvedAt?.toISOString(),
      resolutionData: market.resolutionData as any,
      yesPrice: spotMap.get(market.id)
    }))

      return reply.send(response)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get markets'
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  // GET /api/tags - Public endpoint for visible tags (for dropdown filters)
  fastify.get('/tags', async (request, reply) => {
    try {
      // Get all visible tags
      const tags = await prisma.tag.findMany({
        where: { visible: true },
        orderBy: { name: 'asc' },
      })

      // Get all markets to count tag usage
      const markets = await prisma.market.findMany({
        where: { status: { not: 'deleted' } },
        select: { tags: true },
      })

      // Count tag usage across markets (case-insensitive)
      const tagCounts = new Map<string, number>()
      for (const market of markets) {
        if (Array.isArray(market.tags)) {
          for (const tag of market.tags) {
            if (typeof tag === 'string' && tag.trim()) {
              const normalized = tag.trim().toLowerCase()
              tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1)
            }
          }
        }
      }

      // Build response with market counts
      const tagsWithCounts = tags.map((tag) => ({
        name: tag.name,
        marketCount: tagCounts.get(tag.normalized) || 0,
      }))

      // Sort alphabetically by name (already sorted from DB, but ensure consistency)
      tagsWithCounts.sort((a, b) => a.name.localeCompare(b.name))

      return reply.send({
        tags: tagsWithCounts,
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get tags',
        },
        timestamp: new Date().toISOString(),
      })
    }
  })

  // Record a spot point based on already-fetched pool reserves (frontend poolReserves.*).
  fastify.post<{
    Params: { marketId: string }
    Body: { yesShares?: string; noShares?: string; timestamp?: string }
  }>('/markets/:marketId/spot-point', async (request, reply) => {
    const { marketId } = request.params
    const { yesShares, noShares, timestamp } = request.body || {}

    if (!yesShares || !noShares) {
      return reply.status(400).send({
        error: {
          code: 'MISSING_RESERVES',
          message: 'yesShares and noShares are required',
        },
        timestamp: new Date().toISOString(),
      })
    }

    try {
      const market = await resolveMarket(prisma, marketId)
      if (!market) {
        return reply.status(404).send({
          error: {
            code: 'MARKET_NOT_FOUND',
            message: 'Market not found',
          },
          timestamp: new Date().toISOString(),
        })
      }

      let yesScaled: bigint
      let noScaled: bigint
      try {
        yesScaled = parseFixed(yesShares, 18)
        noScaled = parseFixed(noShares, 18)
      } catch {
        return reply.status(400).send({
          error: {
            code: 'INVALID_RESERVES',
            message: 'yesShares and noShares must be numeric strings',
          },
          timestamp: new Date().toISOString(),
        })
      }

      const total = yesScaled + noScaled
      if (total <= 0n) {
        // Nothing to record
        return reply.status(204).send()
      }

      const yesPriceScaled = computeYesPriceScaled(yesScaled, noScaled)
      let ts: Date
      if (timestamp) {
        const parsed = new Date(timestamp)
        ts = Number.isNaN(parsed.getTime()) ? new Date() : parsed
      } else {
        ts = new Date()
      }

      await upsertSpotPoint(prisma, market.id, ts, yesPriceScaled)
      return reply.status(204).send()
    } catch (error) {
      fastify.log.error({ error, marketId }, 'spot_point.persist_failed')
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to record spot point',
        },
        timestamp: new Date().toISOString(),
      })
    }
  })

  // Get market by ID
  fastify.get<{
    Params: { marketId: string }
  }>('/markets/:marketId', async (request, reply) => {
    const { marketId } = request.params

    try {
      const market = await resolveMarket(prisma, marketId)

      if (!market) {
        return reply.status(404).send({
          error: {
            code: 'MARKET_NOT_FOUND',
            message: 'Market not found'
          },
          timestamp: new Date().toISOString()
        })
      }

      const response: MarketResponse = {
        id: market.id,
        conditionId: market.conditionId,
        fpmmAddress: market.fpmmAddress,
        slug: market.slug ?? null,
        title: market.title,
        outcomes: market.outcomes ?? [],
        status: market.status as any,
        category: market.category,
        tags: market.tags,
        heroImageUrl: market.heroImageUrl ?? null,
        createdAt: market.createdAt?.toISOString?.() ?? new Date().toISOString(),
        expiresAt: market.expiresAt?.toISOString?.() ?? null,
        resolvedAt: market.resolvedAt?.toISOString?.(),
        resolutionData: market.resolutionData as any
      }

      return reply.send(response)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get market'
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  // Get user's positions
  fastify.get<{
    Querystring: { user: string }
  }>('/positions', async (request, reply) => {
    const { user } = request.query

    try {
      const positions = await prisma.position.findMany({
        where: { userAddress: user },
        orderBy: { updatedAt: 'desc' }
      })

      const response = positions.map((position: any) => ({
        id: position.id,
        userAddress: position.userAddress,
        marketId: position.marketId,
        outcome: position.outcome,
        quantity: position.quantity,
        updatedAt: position.updatedAt.toISOString()
      }))

      return reply.send(response)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get positions'
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  // Get trades for a market (FPMM trades table)
  fastify.get<{
    Params: { marketId: string }
    Querystring: { limit?: string; before?: string }
  }>('/markets/:marketId/trades', async (request, reply) => {
    const { marketId } = request.params
    const limitParam = Number(request.query.limit ?? 50)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : 50
    const beforeRaw = request.query.before
    let beforeDate: Date | null = null

    if (beforeRaw) {
      const parsed = new Date(beforeRaw)
      if (Number.isNaN(parsed.getTime())) {
        return reply.status(400).send({
          error: { code: 'INVALID_CURSOR', message: 'before must be an ISO8601 timestamp' },
          timestamp: new Date().toISOString(),
        })
      }
      beforeDate = parsed
    }

    try {
      const result = await listTradesForMarket(prisma, marketId, limit, beforeDate)
      if (!result) {
        return reply.status(404).send({
          error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
          timestamp: new Date().toISOString(),
        })
      }

      return reply.send(result.trades)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get trades'
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  fastify.get<{
    Querystring: { marketId?: string; limit?: string; before?: string }
  }>('/trades', async (request, reply) => {
    const { marketId } = request.query
    if (!marketId) {
      return reply.status(400).send({
        error: { code: 'MARKET_REQUIRED', message: 'marketId query parameter is required' },
        timestamp: new Date().toISOString(),
      })
    }

    const limitParam = Number(request.query.limit ?? 50)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : 50
    const beforeRaw = request.query.before
    let beforeDate: Date | null = null

    if (beforeRaw) {
      const parsed = new Date(beforeRaw)
      if (Number.isNaN(parsed.getTime())) {
        return reply.status(400).send({
          error: { code: 'INVALID_CURSOR', message: 'before must be an ISO8601 timestamp' },
          timestamp: new Date().toISOString(),
        })
      }
      beforeDate = parsed
    }

    try {
      const result = await listTradesForMarket(prisma, marketId, limit, beforeDate)
      if (!result) {
        return reply.status(404).send({
          error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
          timestamp: new Date().toISOString(),
        })
      }

      return reply.send(result.trades)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get trades'
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  fastify.get<{
    Params: { marketId: string }
  }>('/markets/:marketId/metrics', async (request, reply) => {
    const { marketId } = request.params

    try {
      const market = await resolveMarket(prisma, marketId)

      if (!market) {
        return reply.status(404).send({
          error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
          timestamp: new Date().toISOString(),
        })
      }

      const latestLiquidity = await prisma.$queryRaw<Array<{
        yes_reserves: Prisma.Decimal
        no_reserves: Prisma.Decimal
        tvl_usdf: Prisma.Decimal
        timestamp: Date
      }>>(Prisma.sql`
        SELECT yes_reserves, no_reserves, tvl_usdf, timestamp
        FROM public.liquidity_events
        WHERE market_id = ${market.id}
        ORDER BY block_number DESC, log_index DESC
        LIMIT 1
      `)

      let yesReserve = 0n
      let noReserve = 0n
      let tvlScaled = 0n
      let spotUpdatedAt: string | null = null
      let spotPayload:
        | {
            price: string
            yesReserves: string
            noReserves: string
            tvlUSDF: string
            updatedAt: string | null
          }
        | null = null

      if (latestLiquidity.length > 0) {
        const row = latestLiquidity[0]
        yesReserve = parseFixed(row.yes_reserves.toString(), 18)
        noReserve = parseFixed(row.no_reserves.toString(), 18)
        tvlScaled = parseFixed(row.tvl_usdf.toString(), 18)
        spotUpdatedAt = row.timestamp.toISOString()
        const yesPriceScaled = computeYesPriceScaled(yesReserve, noReserve)
        spotPayload = {
          price: formatFixed(yesPriceScaled, 18),
          yesReserves: formatFixed(yesReserve, 18),
          noReserves: formatFixed(noReserve, 18),
          tvlUSDF: formatFixed(tvlScaled, 18),
          updatedAt: spotUpdatedAt,
        }
      }

      const now = Date.now()
      const since = new Date(now - 24 * 60 * 60 * 1000)
      const volumeRows = await prisma.$queryRaw<Array<{ volume: Prisma.Decimal | null }>>(Prisma.sql`
        SELECT COALESCE(SUM(amount_in_usdf), 0) AS volume
        FROM public.trades
        WHERE market_id = ${market.id} AND timestamp >= ${since}
      `)

      const lastTradeRows = await prisma.$queryRaw<Array<{ timestamp: Date }>>(Prisma.sql`
        SELECT timestamp
        FROM public.trades
        WHERE market_id = ${market.id}
        ORDER BY timestamp DESC, log_index DESC
        LIMIT 1
      `)

      const volume24hUSDF = volumeRows[0] ? decimalToString(volumeRows[0].volume) : '0'
      const lastTradeAt = lastTradeRows[0]?.timestamp?.toISOString() ?? null

      const syncRows = await prisma.$queryRaw<Array<{ last_indexed_block: bigint; updated_at: Date }>>(Prisma.sql`
        SELECT last_indexed_block, updated_at
        FROM public.market_sync
        WHERE market_id = ${market.id}
        LIMIT 1
      `)
      let syncRow = syncRows[0]
      if (!syncRow) {
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO public.market_sync (market_id, last_indexed_block, sweeping, updated_at)
          VALUES (${market.id}, 0, FALSE, NOW())
          ON CONFLICT (market_id) DO NOTHING;
        `)
        syncRow = { last_indexed_block: 0n, updated_at: new Date() }
      }
      const lastIndexedBlock = BigInt(syncRow.last_indexed_block ?? 0)
      const lastModifiedMs = syncRow.updated_at ? new Date(syncRow.updated_at).getTime() : Date.now()

      fastify.indexer.maybeEnqueueSweep(market.id).catch((error) => {
        fastify.log.warn({ error, marketId: market.id }, 'metrics.sweep.enqueue_failed')
      })

      const etag = createEtag(
        'metrics',
        market.id,
        lastIndexedBlock,
        spotPayload?.updatedAt ?? null,
        volume24hUSDF,
        lastTradeAt
      )

      const payload = {
        marketId: market.id,
        fpmmAddress: market.fpmmAddress,
        spot: spotPayload,
        tvlUSDF: formatFixed(tvlScaled, 18),
        volume24hUSDF,
        lastTradeAt,
      }

      applyCacheHeaders(reply, etag, lastModifiedMs)

      return reply.send(payload)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get metrics'
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  fastify.get<{
    Params: { marketId: string }
    Querystring: { tf?: string; limit?: string }
  }>('/markets/:marketId/candles', async (request, reply) => {
    const { marketId } = request.params
    const tf = request.query.tf ?? '5m'
    if (tf !== '5m') {
      return reply.status(400).send({
        error: { code: 'UNSUPPORTED_TIMEFRAME', message: 'Only 5m timeframe is supported' },
        timestamp: new Date().toISOString(),
      })
    }

    const limitParam = Number(request.query.limit ?? 200)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : 200

    try {
      const market = await resolveMarket(prisma, marketId)

      if (!market) {
        return reply.status(404).send({
          error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
          timestamp: new Date().toISOString(),
        })
      }

      const rows = await prisma.$queryRaw<Array<{
        bucket_start: Date
        open_price: Prisma.Decimal
        high_price: Prisma.Decimal
        low_price: Prisma.Decimal
        close_price: Prisma.Decimal
        volume_usdf: Prisma.Decimal
      }>>(Prisma.sql`
        SELECT bucket_start, open_price, high_price, low_price, close_price, volume_usdf
        FROM public.candles_5m
        WHERE market_id = ${market.id}
        ORDER BY bucket_start DESC
        LIMIT ${limit}
      `)

      const candles = rows
        .map((row) => ({
          t: row.bucket_start.toISOString(),
          o: row.open_price.toString(),
          h: row.high_price.toString(),
          l: row.low_price.toString(),
          c: row.close_price.toString(),
          vUSDF: row.volume_usdf.toString(),
        }))
        .reverse()

      // If no candles yet, synthesize one from the latest liquidity snapshot (if available)
      if (candles.length === 0) {
        const latestLiquidity = await prisma.$queryRaw<Array<{
          yes_reserves: Prisma.Decimal
          no_reserves: Prisma.Decimal
          timestamp: Date
        }>>(Prisma.sql`
          SELECT yes_reserves, no_reserves, timestamp
          FROM public.liquidity_events
          WHERE market_id = ${market.id}
          ORDER BY block_number DESC, log_index DESC
          LIMIT 1
        `)

        if (latestLiquidity.length > 0) {
          const snapshot = latestLiquidity[0]
          const yesReserve = parseFixed(snapshot.yes_reserves.toString(), 18)
          const noReserve = parseFixed(snapshot.no_reserves.toString(), 18)
          const price = computeYesPriceScaled(yesReserve, noReserve)
          const iso = snapshot.timestamp?.toISOString?.() ?? new Date().toISOString()
          candles.push({
            t: iso,
            o: formatFixed(price, 18),
            h: formatFixed(price, 18),
            l: formatFixed(price, 18),
            c: formatFixed(price, 18),
            vUSDF: '0',
          })
        }
      }

      const syncRows = await prisma.$queryRaw<Array<{ last_indexed_block: bigint; updated_at: Date }>>(Prisma.sql`
        SELECT last_indexed_block, updated_at
        FROM public.market_sync
        WHERE market_id = ${market.id}
        LIMIT 1
      `)
      let syncRow = syncRows[0]
      if (!syncRow) {
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO public.market_sync (market_id, last_indexed_block, sweeping, updated_at)
          VALUES (${market.id}, 0, FALSE, NOW())
          ON CONFLICT (market_id) DO NOTHING;
        `)
        syncRow = { last_indexed_block: 0n, updated_at: new Date() }
      }
      const lastIndexedBlock = BigInt(syncRow.last_indexed_block ?? 0)
      const lastModifiedMs = syncRow.updated_at ? new Date(syncRow.updated_at).getTime() : Date.now()

      fastify.indexer.maybeEnqueueSweep(market.id).catch((error) => {
        fastify.log.warn({ error, marketId: market.id }, 'candles.sweep.enqueue_failed')
      })

      const mostRecent = candles.length > 0 ? candles[candles.length - 1].t : null
      const etag = createEtag('candles', market.id, lastIndexedBlock, limit, mostRecent)

      const recentMs = mostRecent ? new Date(mostRecent).getTime() : lastModifiedMs
      applyCacheHeaders(reply, etag, Math.max(lastModifiedMs, recentMs))

      return reply.send(candles)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get candles'
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  fastify.get<{
    Params: { marketId: string }
    Querystring: { limit?: string }
  }>('/markets/:marketId/spot-series', async (request, reply) => {
    const { marketId } = request.params
    const limitParam = Number(request.query.limit ?? 200)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : 200

    try {
      const market = await resolveMarket(prisma, marketId)
      if (!market) {
        return reply.status(404).send({
          error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
          timestamp: new Date().toISOString(),
        })
      }

      let rows = await prisma.$queryRaw<Array<{
        timestamp: Date
        yes_price: Prisma.Decimal
        no_price: Prisma.Decimal
      }>>(Prisma.sql`
        SELECT timestamp, yes_price, no_price
        FROM public.market_spot_points
        WHERE market_id = ${market.id}
        ORDER BY timestamp ASC
        LIMIT ${limit}
      `)

      const series = rows.map((row) => {
        const iso = row.timestamp.toISOString()
        const hhmmss = iso.slice(11, 19)
        return {
          t: iso,
          hhmmss,
          yes: row.yes_price.toString(),
          no: row.no_price.toString(),
        }
      })

      return reply.send(series)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get spot series'
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  fastify.get<{
    Params: { marketId: string }
  }>('/markets/:marketId/live', async (request, reply) => {
    const { marketId } = request.params

    const market = await resolveMarket(prisma, marketId)

    if (!market) {
      return reply.status(404).send({
        error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
        timestamp: new Date().toISOString(),
      })
    }

    // Allow CORS for SSE explicitly (Fastify CORS doesn't cover stream well)
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined
    if (origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin)
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
    } else {
      reply.raw.setHeader('Access-Control-Allow-Origin', '*')
    }
    reply.raw.setHeader('Vary', 'Origin')

    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders?.()
    reply.raw.write(':connected\n\n')

    const subscriber = fastify.redis.duplicate()
    const tradeChannel = `market:${market.id}:trades`
    const commentChannel = `market:${market.id}:comments`
    let closed = false

    const send = (data: any) => {
      if (closed) return
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    subscriber.on('message', (ch, message) => {
      if (ch !== tradeChannel && ch !== commentChannel) {
        return
      }
      try {
        const parsed = JSON.parse(message)
        send(parsed)
      } catch (err) {
        fastify.log.error({ err, message }, 'Failed to parse live broadcast')
      }
    })

    subscriber.on('error', (err) => {
      fastify.log.error({ err }, 'Redis subscriber error')
    })

    await subscriber.subscribe(tradeChannel, commentChannel)

    const heartbeat = setInterval(() => {
      if (closed) return
      reply.raw.write(':ping\n\n')
    }, 15000)
    if (typeof heartbeat.unref === 'function') heartbeat.unref()

    await new Promise<void>((resolve) => {
      const cleanup = async () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        try {
          await subscriber.unsubscribe(tradeChannel, commentChannel)
        } catch (err) {
          fastify.log.warn({ err }, 'Failed to unsubscribe SSE channel')
        }
        try {
          await subscriber.quit()
        } catch (err) {
          fastify.log.warn({ err }, 'Failed to close SSE subscriber')
        }
        reply.raw.end()
        resolve()
      }

      request.raw.on('close', cleanup)
      request.raw.on('error', cleanup)
    })
  })

  fastify.post('/tx-notify', async (request, reply) => {
    if (TX_NOTIFY_TOKEN) {
      const header = request.headers[TX_NOTIFY_HEADER] as string | undefined
      if (header !== TX_NOTIFY_TOKEN) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' },
          timestamp: new Date().toISOString(),
        })
      }
    }

    const parsed = TxNotifySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_BODY',
          message: 'Invalid transaction payload',
          details: parsed.error.flatten(),
        },
        timestamp: new Date().toISOString(),
      })
    }

    let marketId: string | undefined = parsed.data.marketId
    if (marketId) {
      const market = await resolveMarket(prisma, marketId)
      if (!market) {
        return reply.status(404).send({
          error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
          timestamp: new Date().toISOString(),
        })
      }
      marketId = market.id
    }

    const queued = await fastify.indexer.enqueueTx({ txHash: parsed.data.txHash, marketId })

    return reply.send({ queued })
  })

  fastify.patch<{
    Params: { marketId: string }
  }>('/markets/:marketId/sweep', async (request, reply) => {
    if (TX_NOTIFY_TOKEN) {
      const header = request.headers[TX_NOTIFY_HEADER] as string | undefined
      if (header !== TX_NOTIFY_TOKEN) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' },
          timestamp: new Date().toISOString(),
        })
      }
    }

    const market = await resolveMarket(prisma, request.params.marketId)
    if (!market) {
      return reply.status(404).send({
        error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
        timestamp: new Date().toISOString(),
      })
    }

    const queued = await fastify.indexer.enqueueSweep({ marketId: market.id })
    if (queued) {
      return reply.send({ queued: true })
    }

    return reply.status(202).send({ queued: false })
  })

  fastify.get<{
    Params: { marketId: string }
  }>('/markets/:marketId/summary', async (request, reply) => {
    const { marketId } = request.params
    const reqId = (request as any)?.id ?? request.id ?? 'summary'
    const startedAt = Date.now()
    fastify.log.info({ reqId, marketKey: marketId }, 'summary.start')

    const market = await resolveMarket(prisma, marketId)

    if (!market) {
      const miss = {
        error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
        timestamp: new Date().toISOString(),
      }
      fastify.log.warn({ reqId, marketKey: marketId }, 'summary.missing_market')
      return reply.status(404).send(miss)
    }

    try {

      let yesReserve = 0n
      let noReserve = 0n
      let tvlScaled = 0n
      let spotUpdatedAt: string | null = null
      let spotPayload: {
        price: string
        yesReserves: string
        noReserves: string
        tvlUSDF: string
        updatedAt: string | null
      } | null = null
      let stale = false
      let bootstrapLastIndexed: bigint | null = null

      const runTimed = async <T>(
        label: string,
        action: () => Promise<T>,
        fallback: () => T
      ): Promise<T> => {
        try {
          const result = await promiseWithTimeout(action(), SUMMARY_TIMEOUT_MS)
          if (result === SUMMARY_TIMEOUT_SYMBOL) {
            stale = true
            fastify.log.warn({ reqId, marketId: market.id, label, timeoutMs: SUMMARY_TIMEOUT_MS }, 'summary.timeout')
            return fallback()
          }
          return result
        } catch (error) {
          stale = true
          fastify.log.error({ reqId, marketId: market.id, label, error }, 'summary.partial_error')
          return fallback()
        }
      }

      const latestLiquidity = await runTimed(
        'liquidity',
        () =>
          prisma.$queryRaw<Array<{
            yes_reserves: Prisma.Decimal
            no_reserves: Prisma.Decimal
            tvl_usdf: Prisma.Decimal
            timestamp: Date
          }>>(Prisma.sql`
            SELECT yes_reserves, no_reserves, tvl_usdf, timestamp
            FROM public.liquidity_events
            WHERE market_id = ${market.id}
            ORDER BY block_number DESC, log_index DESC
            LIMIT 1
          `),
        () => []
      )

      let lastLiquidityAt = latestLiquidity.length > 0 ? latestLiquidity[0].timestamp.toISOString() : null

      if (latestLiquidity.length > 0) {
        const row = latestLiquidity[0]
        yesReserve = parseFixed(row.yes_reserves.toString(), 18)
        noReserve = parseFixed(row.no_reserves.toString(), 18)
        tvlScaled = parseFixed(row.tvl_usdf.toString(), 18)
        spotUpdatedAt = row.timestamp.toISOString()
        const yesPriceScaled = computeYesPriceScaled(yesReserve, noReserve)
        spotPayload = {
          price: formatFixed(yesPriceScaled, 18),
          yesReserves: formatFixed(yesReserve, 18),
          noReserves: formatFixed(noReserve, 18),
          tvlUSDF: formatFixed(tvlScaled, 18),
          updatedAt: spotUpdatedAt,
        }
      }

      const now = Date.now()
      const since = new Date(now - 24 * 60 * 60 * 1000)

      const volumeRows = await runTimed(
        'volume24h',
        () =>
          prisma.$queryRaw<Array<{ volume: Prisma.Decimal | null }>>(Prisma.sql`
            SELECT COALESCE(SUM(amount_in_usdf), 0) AS volume
            FROM public.trades
            WHERE market_id = ${market.id} AND timestamp >= ${since}
          `),
        () => []
      )

      const lastTradeRows = await runTimed(
        'lastTrade',
        () =>
          prisma.$queryRaw<Array<{ timestamp: Date }>>(Prisma.sql`
            SELECT timestamp
            FROM public.trades
            WHERE market_id = ${market.id}
            ORDER BY timestamp DESC, log_index DESC
            LIMIT 1
          `),
          () => []
      )

      // If trades happened after the last recorded liquidity snapshot, refresh
      // spot from on-chain balances so the UI reflects the latest price, but
      // throttle using tradeProbeCache/onchainProbeCache to avoid spamming RPC.
      if (
        market.fpmmAddress &&
        market.conditionId &&
        lastTradeRows.length > 0
      ) {
        const lastTradeTs = lastTradeRows[0].timestamp
        const tradeMs = lastTradeTs.getTime()
        const liquidityMs = spotUpdatedAt ? new Date(spotUpdatedAt).getTime() : 0
        const lastProcessedTrade = tradeProbeCache.get(market.id) ?? 0
        const lastOnchainProbe = onchainProbeCache.get(market.id) ?? 0
        const nowMs = Date.now()

        if (tradeMs > liquidityMs && tradeMs > lastProcessedTrade && nowMs - lastOnchainProbe >= ONCHAIN_PROBE_COOLDOWN_MS) {
          // throttle even if the RPC fails/returns zero
          onchainProbeCache.set(market.id, nowMs)
          const onchainSpot = await runTimed(
            'onchainSpot',
            () => fetchOnchainReserves(fastify, market.fpmmAddress, market.conditionId),
            () => null
          )
          if (onchainSpot && (onchainSpot.yesReserve > 0n || onchainSpot.noReserve > 0n)) {
            yesReserve = onchainSpot.yesReserve
            noReserve = onchainSpot.noReserve
            tvlScaled = computeTVLScaled(yesReserve, noReserve)
            spotUpdatedAt = lastTradeTs.toISOString()
            tradeProbeCache.set(market.id, tradeMs)
            const yesPriceScaled = computeYesPriceScaled(yesReserve, noReserve)
            spotPayload = {
              price: formatFixed(yesPriceScaled, 18),
              yesReserves: formatFixed(yesReserve, 18),
              noReserves: formatFixed(noReserve, 18),
              tvlUSDF: formatFixed(tvlScaled, 18),
              updatedAt: spotUpdatedAt,
            }
          }
        }
      }

      if (latestLiquidity.length === 0 && lastTradeRows.length > 0 && market.fpmmAddress) {
        const bootstrapSpot = await runTimed(
          'onchainBootstrap',
          () => fetchOnchainReserves(fastify, market.fpmmAddress, market.conditionId),
          () => null
        )
        if (bootstrapSpot && (bootstrapSpot.yesReserve > 0n || bootstrapSpot.noReserve > 0n)) {
          const tvlFromBootstrap = computeTVLScaled(bootstrapSpot.yesReserve, bootstrapSpot.noReserve)
          const timestamp = new Date()
          const bootstrapTxHash = `0x${createHash('sha256')
            .update(`bootstrap:${market.id}`)
            .digest('hex')}`
          const headBlock = fastify.indexer.getLatestHead()
          const blockNumber = headBlock != null && headBlock > 0n ? headBlock : 0n

          await insertLiquidityEvent(prisma, {
            marketId: market.id,
            fpmmAddress: market.fpmmAddress,
            txHash: bootstrapTxHash,
            logIndex: 0,
            blockNumber: Number(blockNumber),
            timestamp,
            kind: 'init',
            yesReserves: formatFixed(bootstrapSpot.yesReserve, 18),
            noReserves: formatFixed(bootstrapSpot.noReserve, 18),
            tvlUSDF: formatFixed(tvlFromBootstrap, 18),
            source: 'onchain_snapshot',
          })

          yesReserve = bootstrapSpot.yesReserve
          noReserve = bootstrapSpot.noReserve
          tvlScaled = tvlFromBootstrap
          spotUpdatedAt = timestamp.toISOString()
          spotPayload = {
            price: formatFixed(computeYesPriceScaled(yesReserve, noReserve), 18),
            yesReserves: formatFixed(yesReserve, 18),
            noReserves: formatFixed(noReserve, 18),
            tvlUSDF: formatFixed(tvlScaled, 18),
            updatedAt: spotUpdatedAt,
          }
          lastLiquidityAt = spotUpdatedAt
          stale = false
          bootstrapLastIndexed = blockNumber
        }
      }

      if (!spotPayload && market.fpmmAddress) {
        const nowMs = Date.now()
        const lastProbe = onchainProbeCache.get(market.id) ?? 0
        if (nowMs - lastProbe >= ONCHAIN_PROBE_COOLDOWN_MS) {
          onchainProbeCache.set(market.id, nowMs)
          const onchainSpot = await runTimed(
            'onchainSpot',
            () => fetchOnchainReserves(fastify, market.fpmmAddress, market.conditionId),
            () => null
          )
          if (onchainSpot && (onchainSpot.yesReserve > 0n || onchainSpot.noReserve > 0n)) {
            yesReserve = onchainSpot.yesReserve
            noReserve = onchainSpot.noReserve
            tvlScaled = computeTVLScaled(yesReserve, noReserve)
            spotUpdatedAt = spotUpdatedAt ?? new Date().toISOString()
            spotPayload = {
              price: formatFixed(computeYesPriceScaled(yesReserve, noReserve), 18),
              yesReserves: formatFixed(yesReserve, 18),
              noReserves: formatFixed(noReserve, 18),
              tvlUSDF: formatFixed(tvlScaled, 18),
              updatedAt: spotUpdatedAt,
            }
            stale = true
          }
        }
      }

      const candleRows = await runTimed(
        'candles',
        () =>
          prisma.$queryRaw<Array<{
            bucket_start: Date
            open_price: Prisma.Decimal
            high_price: Prisma.Decimal
            low_price: Prisma.Decimal
            close_price: Prisma.Decimal
            volume_usdf: Prisma.Decimal
          }>>(Prisma.sql`
            SELECT bucket_start, open_price, high_price, low_price, close_price, volume_usdf
            FROM public.candles_5m
            WHERE market_id = ${market.id}
            ORDER BY bucket_start DESC
            LIMIT 40
          `),
        () => []
      )

      const spotSeriesRows = await runTimed(
        'spotSeries',
        () =>
          prisma.$queryRaw<Array<{ timestamp: Date; yes_price: Prisma.Decimal; no_price: Prisma.Decimal }>>(Prisma.sql`
            SELECT timestamp, yes_price, no_price
            FROM public.market_spot_points
            WHERE market_id = ${market.id}
            ORDER BY timestamp ASC
            LIMIT 180
          `),
        () => []
      )

      const candles = candleRows
        .map((row) => ({
          t: row.bucket_start.toISOString(),
          o: row.open_price.toString(),
          h: row.high_price.toString(),
          l: row.low_price.toString(),
          c: row.close_price.toString(),
          vUSDF: row.volume_usdf.toString(),
        }))
        .reverse()

      if (candles.length === 0) {
        const latestSpot = spotSeriesRows.length > 0 ? spotSeriesRows[spotSeriesRows.length - 1] : null
        const price = latestSpot ? latestSpot.yes_price.toString() : '0'
        candles.push({
          t: (latestSpot?.timestamp ?? new Date()).toISOString(),
          o: price,
          h: price,
          l: price,
          c: price,
          vUSDF: '0',
        })
      }

      const tradeRows = await runTimed(
        'trades',
        () =>
          prisma.$queryRaw<Array<{
            tx_hash: Buffer | null
            log_index: number
            block_number: number
            timestamp: Date
            side: string
            outcome: number
            amount_in_usdf: Prisma.Decimal
            price: Prisma.Decimal
            amount_out_shares: Prisma.Decimal
            fee_usdf: Prisma.Decimal | null
          }>>(Prisma.sql`
            SELECT
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
            FROM public.trades
            WHERE market_id = ${market.id}
            ORDER BY timestamp DESC, log_index DESC
            LIMIT 20
          `),
        () => []
      )

      const mostRecentTradeRow = tradeRows[0] ?? null
      const mostRecentTradeTs = mostRecentTradeRow ? mostRecentTradeRow.timestamp : lastTradeRows[0]?.timestamp ?? null
      const trades = tradeRows.map((row) => ({
        txHash: bufferToHex(row.tx_hash),
        logIndex: row.log_index,
        blockNumber: row.block_number,
        timestamp: row.timestamp.toISOString(),
        side: row.side,
        outcome: row.outcome,
        amountInUSDF: decimalToString(row.amount_in_usdf),
        price: decimalToString(row.price),
        amountOutShares: decimalToString(row.amount_out_shares),
        feeUSDF: row.fee_usdf ? decimalToString(row.fee_usdf) : null,
      }))

      if (
        market.fpmmAddress &&
        mostRecentTradeRow &&
        mostRecentTradeTs
      ) {
        const tradeMs = mostRecentTradeTs.getTime()
        const liquidityMs = spotUpdatedAt ? new Date(spotUpdatedAt).getTime() : 0
        const lastProcessedTrade = tradeProbeCache.get(market.id) ?? 0
        if (tradeMs > liquidityMs && tradeMs > lastProcessedTrade) {
          const onchainSpot = await runTimed(
            'tradeSpot',
            () => fetchOnchainReserves(fastify, market.fpmmAddress, market.conditionId),
            () => null
          )
          if (onchainSpot && (onchainSpot.yesReserve > 0n || onchainSpot.noReserve > 0n)) {
            yesReserve = onchainSpot.yesReserve
            noReserve = onchainSpot.noReserve
            tvlScaled = computeTVLScaled(yesReserve, noReserve)
            spotUpdatedAt = mostRecentTradeTs.toISOString()
            spotPayload = {
              price: formatFixed(computeYesPriceScaled(yesReserve, noReserve), 18),
              yesReserves: formatFixed(yesReserve, 18),
              noReserves: formatFixed(noReserve, 18),
              tvlUSDF: formatFixed(tvlScaled, 18),
              updatedAt: spotUpdatedAt,
            }
            tradeProbeCache.set(market.id, tradeMs)
          }
        }
      }

      const latestSpotRow = spotSeriesRows.length > 0 ? spotSeriesRows[spotSeriesRows.length - 1] : null
      const metricsPayload = {
        marketId: market.id,
        fpmmAddress: market.fpmmAddress,
        // `spot` is derived from persisted spot-series points (built from poolReserves.*),
        // not from liquidity_events math.
        spot: latestSpotRow
          ? {
              price: latestSpotRow.yes_price.toString(),
              yesReserves: null,
              noReserves: null,
              tvlUSDF: formatFixed(tvlScaled, 18),
              updatedAt: latestSpotRow.timestamp.toISOString(),
            }
          : null,
        tvlUSDF: formatFixed(tvlScaled, 18),
        volume24hUSDF: volumeRows[0] ? decimalToString(volumeRows[0].volume) : '0',
        lastTradeAt: mostRecentTradeTs
          ? mostRecentTradeTs.toISOString()
          : lastTradeRows[0]?.timestamp?.toISOString() ?? null,
      }

      const spotSeriesPayload = spotSeriesRows.map((row) => ({
        t: row.timestamp.toISOString(),
        yes: row.yes_price.toString(),
        no: row.no_price.toString(),
      }))

      const marketPayload = {
        id: market.id,
        conditionId: market.conditionId,
        fpmmAddress: market.fpmmAddress,
        title: market.title,
        outcomes: market.outcomes,
        status: market.status,
        category: market.category,
        tags: market.tags,
        createdAt: market.createdAt?.toISOString?.() ?? null,
        expiresAt: market.expiresAt?.toISOString?.() ?? null,
        resolvedAt: market.resolvedAt?.toISOString?.() ?? null,
        resolutionData: market.resolutionData,
        slug: market.slug ?? null,
      }

      const syncRows = await runTimed(
        'marketSync',
        () =>
          prisma.$queryRaw<Array<{ last_indexed_block: bigint; updated_at: Date }>>(Prisma.sql`
            SELECT last_indexed_block, updated_at
            FROM public.market_sync
            WHERE market_id = ${market.id}
            LIMIT 1
          `),
        () => []
      )

      let syncRow = syncRows[0]
      if (!syncRow) {
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO public.market_sync (market_id, last_indexed_block, sweeping, updated_at)
          VALUES (${market.id}, 0, FALSE, NOW())
          ON CONFLICT (market_id) DO NOTHING;
        `)
        syncRow = { last_indexed_block: 0n, updated_at: new Date() }
      }

      let lastIndexedBlock = BigInt(syncRow.last_indexed_block ?? 0)
      let lastModifiedMs = syncRow.updated_at ? new Date(syncRow.updated_at).getTime() : Date.now()

      if (bootstrapLastIndexed != null && bootstrapLastIndexed > lastIndexedBlock) {
        await prisma.$executeRaw(Prisma.sql`
          UPDATE public.market_sync
          SET last_indexed_block = ${bootstrapLastIndexed}, updated_at = NOW()
          WHERE market_id = ${market.id}
        `)
        lastIndexedBlock = bootstrapLastIndexed
        lastModifiedMs = Date.now()
      }

      fastify.indexer.maybeEnqueueSweep(market.id).catch((error) => {
        fastify.log.warn({ error, marketId: market.id }, 'summary.sweep.enqueue_failed')
      })

      const mostRecentCandle = candles.length > 0 ? candles[candles.length - 1].t : null
      const etag = createEtag(
        'summary',
        market.id,
        lastIndexedBlock,
        metricsPayload.lastTradeAt,
        mostRecentCandle,
        lastLiquidityAt
      )

      const timestamps = [
        metricsPayload.lastTradeAt ? new Date(metricsPayload.lastTradeAt).getTime() : 0,
        spotUpdatedAt ? new Date(spotUpdatedAt).getTime() : 0,
        mostRecentCandle ? new Date(mostRecentCandle).getTime() : 0,
        lastModifiedMs,
      ].filter((value) => Number.isFinite(value) && value > 0) as number[]
      const derivedLastModified = timestamps.length > 0 ? Math.max(...timestamps) : lastModifiedMs

      applyCacheHeaders(reply, etag, derivedLastModified)

      const latestHead = fastify.indexer.getLatestHead()
      const lagBlocks = latestHead && latestHead > lastIndexedBlock ? Number(latestHead - lastIndexedBlock) : 0

      const responsePayload = {
        market: marketPayload,
        metrics: metricsPayload,
        candles,
        trades,
        spotSeries: spotSeriesPayload,
        cache: {
          lastIndexedBlock: Number(lastIndexedBlock),
          generatedAt: new Date(derivedLastModified).toISOString(),
          lagBlocks,
          lastLiquidityAt,
          stale,
        },
      }

      const elapsedMs = Date.now() - startedAt
      const payloadSize = Buffer.byteLength(JSON.stringify(responsePayload))
      fastify.log.info({ reqId, marketId: market.id, elapsedMs, etag, stale, payloadSize }, 'summary.sent')
      return reply.send(responsePayload)
    } catch (error) {
      const elapsedMs = Date.now() - startedAt
      fastify.log.error({ reqId, marketKey: marketId, elapsedMs, error }, 'summary.failed')

      if (market) {
        try {
          const fallbackSpot = market.fpmmAddress && market.conditionId
            ? await fetchOnchainReserves(fastify, market.fpmmAddress, market.conditionId)
            : null
          const yesReserve = fallbackSpot?.yesReserve ?? 0n
          const noReserve = fallbackSpot?.noReserve ?? 0n
          const tvlScaled = computeTVLScaled(yesReserve, noReserve)
          const spotPayload = fallbackSpot
            ? {
                price: formatFixed(computeYesPriceScaled(yesReserve, noReserve), 18),
                yesReserves: formatFixed(yesReserve, 18),
                noReserves: formatFixed(noReserve, 18),
                tvlUSDF: formatFixed(tvlScaled, 18),
                updatedAt: new Date().toISOString(),
              }
            : null

          const fallbackMetrics = {
            marketId: market.id,
            fpmmAddress: market.fpmmAddress,
            spot: spotPayload,
            tvlUSDF: formatFixed(tvlScaled, 18),
            volume24hUSDF: '0',
            lastTradeAt: null,
          }

          const fallbackPayload = {
            market: {
              id: market.id,
              conditionId: market.conditionId,
              fpmmAddress: market.fpmmAddress,
              title: market.title,
              outcomes: market.outcomes,
              status: market.status,
              category: market.category,
              tags: market.tags,
              createdAt: market.createdAt?.toISOString?.() ?? null,
              expiresAt: market.expiresAt?.toISOString?.() ?? null,
              resolvedAt: market.resolvedAt?.toISOString?.() ?? null,
              resolutionData: market.resolutionData,
              slug: market.slug ?? null,
            },
            metrics: fallbackMetrics,
            candles: [],
            trades: [],
            spotSeries: [],
            cache: {
              lastIndexedBlock: 0,
              generatedAt: new Date().toISOString(),
              lagBlocks: 0,
              lastLiquidityAt: null,
              stale: true,
            },
          }

          const fallbackEtag = createEtag('summary-fallback', market.id, Date.now())
          applyCacheHeaders(reply, fallbackEtag, Date.now())
          fastify.log.warn({ reqId, marketId: market.id }, 'summary.fallback_sent')
          return reply.status(200).send(fallbackPayload)
        } catch (fallbackError) {
          fastify.log.error({ reqId, marketKey: marketId, fallbackError }, 'summary.fallback_failed')
        }
      }

      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to build summary'
        },
        timestamp: new Date().toISOString()
      })
    }
  })
}

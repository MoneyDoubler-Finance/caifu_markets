import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { Address, Hex } from 'viem'
import { decodeEventLog } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { encodePacked, keccak256, stringToBytes } from 'viem/utils'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  MIN_INITIAL_LIQUIDITY_USDF,
  PublicCreateMarketInput,
} from '@caifu/types'
import { ENV } from '@caifu/config'
import { publicClient, makeWalletClient } from '@caifu/sdk'
import {
  getCTFContract,
  getFPMMContract,
  getFPMMFactoryContract,
  getOracleAdapterContract,
  getUSDFContract,
} from '../lib/contracts'
import { addMarket as addPositionMarket } from '../workers/positionIndex'

export type MarketCreationContext = {
  creatorUserId: string | null
  logger?: FastifyBaseLogger
}

export type MarketCreationResult = {
  id: string
  slug: string | null
  question: string
  outcomes: string[]
  category: string | null
  tags: string[]
  heroImageUrl: string | null
  conditionId: string | null
  txHash: Hex | null
  blockNumber: number | null
  lpFeeBps: number
  initialPriceBps: number
  fpmmAddress: string | null
  seedTransactions: Record<string, string | null> | null
  seedInitTx: Hex | null
  seedAddLiqTx: Hex | null
  requiresUserFunding: boolean
  userLiquidityAmount: string
}

export type SeedMarketResult = {
  ok: true
  conditionId: Hex
  fpmmAddress: string
  initTx: Hex | null
  addLiqTx: Hex | null
  requiresUserFunding: boolean
  transactions?: Record<string, string | null> | null
}

export class MarketCreationError extends Error {
  statusCode: number
  body: Record<string, any>

  constructor(statusCode: number, body: Record<string, any>) {
    super(body?.error || body?.reason || 'market_creation_failed')
    this.statusCode = statusCode
    this.body = body
  }
}

const sanitizeCategory = (value?: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 120)
}

const sanitizeMarketTags = (values?: readonly string[]): string[] => {
  if (!Array.isArray(values)) return []
  const seen = new Map<string, string>()
  for (const entry of values) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed) continue
    const normalized = trimmed.toLowerCase()
    if (!seen.has(normalized)) {
      seen.set(normalized, trimmed)
    }
  }
  return Array.from(seen.values()).slice(0, 12)
}

const sanitizeHeroImageUrl = (value?: string | null): string | null => {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('/static/market-heroes/')) return null
  return trimmed
}

const slugifyMarketQuestion = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const capped = normalized.slice(0, 80)
  return capped.length > 0 ? capped : 'market'
}

const reserveMarketSlug = async (prisma: PrismaClient, candidate: string): Promise<string> => {
  const base = candidate || 'market'
  let attempt = base
  let suffix = 2
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await prisma.market.findFirst({
      where: { slug: { equals: attempt, mode: 'insensitive' } },
      select: { id: true },
    })
    if (!clash) return attempt
    attempt = `${base}-${suffix++}`
    if (attempt.length > 80) {
      attempt = attempt.slice(0, 80)
    }
  }
}

const seedSpotSeries = async (prisma: PrismaClient, marketId: string, createdAt: Date) => {
  const base = createdAt instanceof Date ? createdAt : new Date()
  const points = Array.from({ length: 30 }, (_v, i) => new Date(base.getTime() - (29 - i) * 30_000))

  // Insert one row at a time to avoid the binary-parameter bug the pg driver
  // can hit with createMany on Decimal columns.
  for (const ts of points) {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO public.market_spot_points (market_id, timestamp, yes_price, no_price)
      VALUES (${marketId}, ${ts}, ${new Prisma.Decimal('0.5')}::numeric, ${new Prisma.Decimal('0.5')}::numeric)
      ON CONFLICT (market_id, timestamp) DO NOTHING;
    `)
  }
}

const formatSimulationError = (err: any): { short: string; details?: string } => {
  const short = err?.shortMessage || err?.message || 'Simulation failed'
  const details = err?.cause?.shortMessage || err?.cause?.message || err?.cause?.data || err?.data
  return { short, details: details ?? undefined }
}

export async function seedMarketInternal(
  fastify: FastifyInstance,
  marketId: string,
  options?: { logger?: FastifyBaseLogger }
): Promise<SeedMarketResult> {
  const logger = options?.logger ?? fastify.log
  const prisma = fastify.prisma

  const factory = getFPMMFactoryContract()
  const ctf = getCTFContract()
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined

  if (!factory || !ctf || !deployerKey || !ENV.USDF_ADDRESS) {
    throw new MarketCreationError(500, {
      ok: false,
      error: 'missing_configuration',
      details: 'MARKET_FACTORY_ADDRESS, CTF_ADDRESS, USDF_ADDRESS, and DEPLOYER_PRIVATE_KEY must be configured',
    })
  }

  const market = await prisma.market.findUnique({
    where: { id: marketId },
  })

  if (!market) {
    throw new MarketCreationError(404, {
      ok: false,
      error: 'market_not_found',
    })
  }

  if (!market.conditionId) {
    throw new MarketCreationError(400, {
      ok: false,
      error: 'missing_condition_id',
      details: 'Market is missing conditionId; cannot seed pool.',
    })
  }

  const conditionId = market.conditionId as Hex
  const account = privateKeyToAccount(deployerKey)
  const walletClient = makeWalletClient(account)
  const walletClientAny = walletClient as any
  const seedAmount = 100n * 10n ** 18n

  logger.info({ marketId: market.id, conditionId }, 'seed_market.start')

  let fpmmAddress = market.fpmmAddress ? market.fpmmAddress.toLowerCase() : null
  let initTx: Hex | null = null
  let addLiqTx: Hex | null = null

  if (!fpmmAddress) {
    let simulation
    try {
      simulation = await publicClient.simulateContract({
        address: factory.address,
        abi: factory.abi,
        functionName: 'createFixedProductMarketMaker',
        args: [ctf.address, ENV.USDF_ADDRESS as Address, [conditionId], 0n],
        account,
      })
    } catch (simErr: any) {
      const { short, details } = formatSimulationError(simErr)
      throw new MarketCreationError(400, {
        ok: false,
        error: 'fpmm_create_simulation_failed',
        reason: short,
        details,
      })
    }

    const createHash = await walletClient.writeContract(simulation.request)
    initTx = createHash

    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash })
    if (createReceipt.status !== 'success') {
      throw new MarketCreationError(500, {
        ok: false,
        error: 'fpmm_create_failed',
        details: 'Factory create call reverted',
      })
    }

    let derivedAddress: string | null = null
    for (const log of createReceipt.logs) {
      if (log.address.toLowerCase() !== factory.address.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({
          abi: factory.abi,
          data: log.data,
          topics: log.topics as any,
        })
        if (decoded?.eventName === 'FixedProductMarketMakerCreation') {
          const eventAddress = decoded.args?.fixedProductMarketMaker as string | undefined
          if (eventAddress) {
            derivedAddress = eventAddress.toLowerCase()
            break
          }
        }
      } catch (decodeErr) {
        logger.debug({ decodeErr }, 'seed_market.decode_event_failed')
      }
    }

    if (!derivedAddress && simulation?.result) {
      derivedAddress = (simulation.result as Address).toLowerCase()
    }

    if (!derivedAddress) {
      throw new MarketCreationError(500, {
        ok: false,
        error: 'fpmm_create_failed',
        details: 'Unable to determine FPMM address from factory transaction',
      })
    }

    fpmmAddress = derivedAddress
    await prisma.market.update({
      where: { id: market.id },
      data: { fpmmAddress: derivedAddress },
    })
  }

  const fpmm = getFPMMContract(fpmmAddress)
  if (!fpmm) {
    throw new MarketCreationError(500, {
      ok: false,
      error: 'fpmm_not_configured',
    })
  }

  const usdf = getUSDFContract()
  if (!usdf) {
    throw new MarketCreationError(500, {
      ok: false,
      error: 'usdf_not_configured',
    })
  }

  try {
    const mintTx = await walletClientAny.writeContract({
      address: usdf.address,
      abi: usdf.abi,
      functionName: 'mint',
      args: [account.address as Address, seedAmount],
    })
    await publicClient.waitForTransactionReceipt({ hash: mintTx })

    const { request: approveReqRaw } = await publicClient.simulateContract({
      address: usdf.address,
      abi: usdf.abi,
      functionName: 'approve',
      args: [fpmm.address as Address, seedAmount],
      account,
    })
    const approveReq: any = approveReqRaw
    const approveTx = await walletClientAny.writeContract(approveReq as any)
    await publicClient.waitForTransactionReceipt({ hash: approveTx })

    const { request: addReqRaw } = await publicClient.simulateContract({
      address: fpmm.address as Address,
      abi: fpmm.abi,
      functionName: 'addFunding',
      args: [seedAmount, []],
      account,
    })
    const addReq: any = addReqRaw
    addLiqTx = await walletClientAny.writeContract(addReq as any)
    if (!addLiqTx) {
      throw new Error('addFunding tx missing')
    }
    await publicClient.waitForTransactionReceipt({ hash: addLiqTx })
  } catch (err) {
    logger.error({ err }, 'seed_market.add_funding_failed')
    throw new MarketCreationError(500, {
      ok: false,
      error: 'auto_seed_failed',
      details: (err as Error)?.message ?? 'deployer seeding failed',
    })
  }

  logger.info({ marketId: market.id, fpmmAddress, seedAmount: seedAmount.toString(), addLiqTx }, 'seed_market.success')

  return {
    ok: true,
    conditionId,
    fpmmAddress,
    initTx,
    addLiqTx,
    requiresUserFunding: false,
    transactions: null,
  }
}

export async function createMarketInternal(
  fastify: FastifyInstance,
  input: PublicCreateMarketInput,
  context: MarketCreationContext
): Promise<MarketCreationResult> {
  const logger = context.logger ?? fastify.log
  const { prisma } = fastify

  const question = input.question.trim()
  const outcomes = input.outcomes.map((value) => value.trim())
  const initialLiquidityAmount = Number(input.initialLiquidity)
  if (!Number.isFinite(initialLiquidityAmount)) {
    throw new MarketCreationError(400, {
      ok: false,
      reason: 'invalid_initial_liquidity',
      error: `Initial liquidity must be a valid number`,
    })
  }

  const normalizedCreatorAddress = input.creatorAddress
  if (!/^0x[a-fA-F0-9]{40}$/i.test(normalizedCreatorAddress)) {
    throw new MarketCreationError(400, {
      ok: false,
      reason: 'creator_address_required',
      error: 'A valid creatorAddress is required to fund liquidity from the user wallet',
    })
  }

  const sanitizedCategory = sanitizeCategory(input.category ?? null)
  const sanitizedTags = sanitizeMarketTags(input.tags)
  const sanitizedHeroImageUrl = sanitizeHeroImageUrl(input.heroImageUrl)

  const slugSource = typeof input.slug === 'string' && input.slug.trim().length > 0 ? input.slug : question
  const marketSlug = await reserveMarketSlug(prisma, slugifyMarketQuestion(slugSource))

  if (!input.resolution) {
    throw new MarketCreationError(400, {
      ok: false,
      reason: 'resolution_required',
      error: 'Resolution / expiry time is required',
    })
  }

  const parsedResolution = Date.parse(input.resolution)
  if (Number.isNaN(parsedResolution)) {
    throw new MarketCreationError(400, {
      ok: false,
      reason: 'invalid_resolution',
      error: 'Resolution / expiry time is invalid',
    })
  }

  const normalizedResolution = Math.floor(parsedResolution / 1000)

  const ctf = getCTFContract()
  if (!ctf) {
    throw new MarketCreationError(500, {
      ok: false,
      reason: 'missing_configuration',
      error: 'ConditionalTokens contract not configured',
    })
  }

  const adapter = getOracleAdapterContract()
  if (!adapter || !ENV.DIRECT_ORACLE_ADDRESS) {
    throw new MarketCreationError(503, {
      ok: false,
      reason: 'oracle_adapter_not_configured',
      error: 'Direct oracle adapter contract not configured',
    })
  }

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined
  if (!deployerKey) {
    throw new MarketCreationError(500, {
      ok: false,
      reason: 'missing_configuration',
      error: 'DEPLOYER_PRIVATE_KEY is not configured',
    })
  }

  const directOracleAddress = ENV.DIRECT_ORACLE_ADDRESS as Address

  const adapterClarification = question.length > 256 ? `${question.slice(0, 252)}…` : question
  const outcomeSlotCount = outcomes.length
  const outcomeCount = BigInt(outcomeSlotCount)
  const account = privateKeyToAccount(deployerKey)
  const wallet = makeWalletClient(account)

  const nowSeconds = Math.floor(Date.now() / 1000)
  const openTime = nowSeconds + 60
  if (normalizedResolution <= openTime) {
    throw new MarketCreationError(400, {
      ok: false,
      reason: 'resolution_in_past',
      error: 'Resolution / expiry must be in the future',
      details: 'Provide a time at least 1 minute from now',
    })
  }
  const closeTime = normalizedResolution

  const questionSeed = `${question}::${randomUUID()}`
  const questionId = keccak256(stringToBytes(questionSeed)) as Hex

  logger.info({
    question,
    outcomes,
    questionId,
    oracle: directOracleAddress,
    openTime,
    closeTime,
    feeBps: input.feeBps,
    priceBps: input.initialPriceBps,
    initialLiquidityAmount,
    creatorAddress: normalizedCreatorAddress,
    creatorUserId: context.creatorUserId ?? undefined,
  }, 'create_market.start')

  let initializeHash: Hex | null = null
  let initializeReceipt: { blockNumber: bigint } | null = null

  try {
    const { request: initRequest } = await publicClient.simulateContract({
      address: adapter.address,
      abi: adapter.abi,
      functionName: 'initializeCondition',
      args: [directOracleAddress, questionId, outcomeSlotCount, adapterClarification],
      account,
    })
    initializeHash = await wallet.writeContract(initRequest)
    logger.info({ hash: initializeHash }, 'oracle_adapter.initialize_condition_sent')
    const receipt = await publicClient.waitForTransactionReceipt({ hash: initializeHash })
    initializeReceipt = { blockNumber: receipt.blockNumber }
  } catch (adapterErr: any) {
    const asString = `${adapterErr?.shortMessage || ''} ${adapterErr?.message || ''} ${adapterErr?.cause?.shortMessage || ''}`
    if (!asString.toLowerCase().includes('alreadyprepared')) {
      const { short, details } = formatSimulationError(adapterErr)
      logger.error({ short, details }, 'oracle_adapter.initialize_condition_failed')
      throw new MarketCreationError(400, {
        ok: false,
        reason: 'oracle_adapter_failed',
        error: short,
        details,
      })
    }
    logger.info({ questionId }, 'oracle_adapter.condition_reused')
  }

  const conditionId = keccak256(
    encodePacked(['address', 'bytes32', 'uint256'], [directOracleAddress, questionId, outcomeCount])
  ) as Hex

  logger.info({ conditionId }, 'create_market.condition_resolved')

  let dbMarket
  try {
    dbMarket = await prisma.market.create({
      data: {
        slug: marketSlug,
        conditionId,
        questionId,
        title: question,
        category: sanitizedCategory,
        tags: sanitizedTags,
        heroImageUrl: sanitizedHeroImageUrl,
        outcomes,
        status: 'active',
        expiresAt: new Date(parsedResolution),
      },
    })
    logger.info({ dbMarketId: dbMarket.id, conditionId, slug: marketSlug }, 'create_market.persisted')
    await seedSpotSeries(prisma, dbMarket.id, dbMarket.createdAt)
    const enableIndexer = Boolean((ENV as any).ENABLE_INDEXER ?? false)
    if (enableIndexer && conditionId) {
      addPositionMarket(conditionId as Hex, dbMarket.id)
    }
  } catch (dbErr) {
    logger.error({ dbErr }, 'create_market.db_failed')
    throw new MarketCreationError(500, {
      ok: false,
      reason: 'database_error',
      details: dbErr instanceof Error ? dbErr.message : 'Unknown error',
    })
  }

  let seedResult: SeedMarketResult
  try {
    seedResult = await seedMarketInternal(fastify, dbMarket.id, { logger })
  } catch (seedError) {
    if (seedError instanceof MarketCreationError) {
      throw new MarketCreationError(seedError.statusCode, {
        ...seedError.body,
        marketId: dbMarket.id,
      })
    }
    logger.error({ seedError, marketId: dbMarket.id }, 'create_market.seed_failed')
    throw new MarketCreationError(500, {
      ok: false,
      reason: 'auto_seed_failed',
      error: (seedError as Error)?.message || 'Automatic pool seeding encountered an unexpected error',
      marketId: dbMarket.id,
    })
  }

  return {
    id: dbMarket.id,
    slug: dbMarket.slug ?? dbMarket.id,
    question,
    outcomes,
    category: sanitizedCategory,
    tags: sanitizedTags,
    heroImageUrl: sanitizedHeroImageUrl,
    conditionId,
    txHash: initializeHash,
    blockNumber: initializeReceipt ? Number(initializeReceipt.blockNumber) : null,
    lpFeeBps: input.feeBps,
    initialPriceBps: input.initialPriceBps,
    fpmmAddress: seedResult.fpmmAddress ?? null,
    seedTransactions: seedResult.transactions ?? null,
    seedInitTx: seedResult.initTx ?? null,
    seedAddLiqTx: seedResult.addLiqTx ?? null,
    requiresUserFunding: initialLiquidityAmount > 0,
    userLiquidityAmount: String(initialLiquidityAmount),
  }
}

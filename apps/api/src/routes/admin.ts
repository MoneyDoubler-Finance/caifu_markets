import { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  validateMarketResolution,
  type ResolveMarketRequest
} from '@caifu/types'
import { publicClient, makeWalletClient } from '@caifu/sdk'
import type { Hex } from 'viem'
import { Prisma } from '@prisma/client'
import { privateKeyToAccount } from 'viem/accounts'
import { AdminTileBackgroundBodySchema, type AdminTileBackgroundBody } from '../lib/schemas'
import { inc as incValidationMetric } from '../lib/validationMetrics'
import { verifyAdminAuth, handleAdminLogin, type AdminRequest } from '../middleware/adminAuth'
import { getOracleAdapterContract } from '../lib/contracts'
import { uploadPaths } from '../lib/uploads'
import { CreateMarketInputSchema } from '@caifu/types'
import { formatZodIssues } from '../lib/zod'
import { createMarketInternal, MarketCreationError, seedMarketInternal } from '../services/marketCreation'
import { backfillFpmmFromEtherscan } from '../lib/backfillFpmm'
import { assertImageSafe } from '../lib/imageSafety'
import { ENV } from '@caifu/config'

const SEED_TX_LOCK_PREFIX = 'recon:tx:lock:'
const SEED_TX_LOCK_TTL_SEC = 600
const memorySeedTxLocks = new Map<string, number>()

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const { prisma } = fastify

  const normalizeTag = (value: string) => value.trim().toLowerCase()
  const slugify = (value: string) => {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return normalized.length > 0 ? normalized : 'background'
  }
  const serializeBackground = (record: any) => ({
    id: record.id,
    tag: record.tag,
    normalizedTag: record.normalizedTag,
    imageUrl: record.imageUrl,
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
  })

  const normalizeTxHash = (hash: string | null | undefined): `0x${string}` | null => {
    if (!hash) return null
    let normalized = hash.trim().toLowerCase()
    if (!normalized) return null
    if (!normalized.startsWith('0x')) {
      normalized = `0x${normalized}`
    }
    if (normalized.length !== 66) return null
    return normalized as `0x${string}`
  }

  const acquireSeedTxLock = async (txHash: `0x${string}`): Promise<boolean> => {
    const now = Date.now()
    if (fastify.redis) {
      try {
        const key = `${SEED_TX_LOCK_PREFIX}${txHash}`
        const set = await fastify.redis.set(key, '1', 'EX', SEED_TX_LOCK_TTL_SEC, 'NX')
        return set === 'OK'
      } catch (error) {
        fastify.log.warn({ error, txHash }, 'seed.tx_lock.redis_failed')
      }
    }

    // Fallback in-process lock with TTL
    const expiry = memorySeedTxLocks.get(txHash)
    if (expiry && expiry > now) {
      return false
    }
    memorySeedTxLocks.set(txHash, now + SEED_TX_LOCK_TTL_SEC * 1000)
    // Cleanup stale entries occasionally
    if (memorySeedTxLocks.size > 1024) {
      for (const [key, value] of memorySeedTxLocks.entries()) {
        if (value <= now) {
          memorySeedTxLocks.delete(key)
        }
      }
    }
    return true
  }

  // Admin login route (no auth required)
  fastify.post<{
    Body: { password: string }
  }>('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string', minLength: 1 }
        }
      }
    }
  }, handleAdminLogin)

  // Helper to add auth to a route
  const withAuth = async (request: AdminRequest, reply: FastifyReply) => {
    await verifyAdminAuth(request, reply)
  }

  // Check if admin is authenticated (returns 200 if authed, 401 if not)
  fastify.get('/me', {
    preHandler: withAuth
  }, async (request, reply) => {
    return reply.send({ ok: true })
  })

  fastify.get('/tile-backgrounds', {
    preHandler: withAuth,
  }, async (_request, reply) => {
    const backgrounds = await prisma.marketTileBackground.findMany({
      orderBy: [{ updatedAt: 'desc' }],
    })

    return reply.send({
      backgrounds: backgrounds.map(serializeBackground),
    })
  })

  fastify.post<{
    Body: AdminTileBackgroundBody
  }>('/tile-backgrounds', {
    preHandler: withAuth,
    schema: {
      body: AdminTileBackgroundBodySchema,
    },
  }, async (request, reply) => {
    const rawTag = request.body.tag?.trim?.() ?? ''
    const rawUrl = request.body.imageUrl?.trim?.() ?? ''

    if (!rawTag || rawTag.length < 2) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_TAG',
          message: 'Tag must be at least 2 characters long',
        },
        timestamp: new Date().toISOString(),
      })
    }

    if (!/^https?:\/\//i.test(rawUrl) && !rawUrl.startsWith('//')) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_URL',
          message: 'Image URL must be an absolute HTTP(S) URL',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const normalizedTag = normalizeTag(rawTag)
    if (!normalizedTag) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_TAG',
          message: 'Tag cannot be empty',
        },
        timestamp: new Date().toISOString(),
      })
    }

    try {
      const background = await prisma.marketTileBackground.upsert({
        where: { normalizedTag },
        update: {
          tag: rawTag,
          imageUrl: rawUrl,
        },
        create: {
          tag: rawTag,
          normalizedTag,
          imageUrl: rawUrl,
        },
      })

      return reply.send({
        background: serializeBackground(background),
        upserted: true,
      })
    } catch (error) {
      request.log.error({ error, tag: rawTag }, 'Failed to save tile background')
      return reply.status(500).send({
        error: {
          code: 'BACKGROUND_SAVE_FAILED',
          message: 'Failed to save tile background',
        },
        timestamp: new Date().toISOString(),
      })
    }
  })

  fastify.post<{ Params: { marketId: string } }>('/markets/:marketId/nuke', {
    preHandler: withAuth,
  }, async (request, reply) => {
    const marketKey = request.params.marketId

    const market = await prisma.market.findFirst({
      where: {
        OR: [{ id: marketKey }, { slug: marketKey }],
      },
      select: { id: true, status: true },
    })

    if (!market) {
      return reply.status(404).send({ error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' } })
    }

    try {
      await prisma.market.update({
        where: { id: market.id },
        data: { status: 'deleted' },
      })

      if (fastify.redis) {
        try {
          await fastify.redis.del(`recon:sweep:lock:${market.id}`)
          await fastify.redis.lrem('recon:q:sweep', 0, JSON.stringify({ marketId: market.id }))
        } catch (error) {
          request.log.warn({ error, marketId: market.id }, 'nuke.redis_cleanup_failed')
        }
      }

      return reply.send({ ok: true })
    } catch (error) {
      request.log.error({ error, marketId: market.id }, 'nuke.failed')
      return reply.status(500).send({ error: { code: 'NUKE_FAILED', message: (error as Error).message } })
    }
  })

  fastify.post<{ Params: { marketId: string } }>('/markets/:marketId/restore', {
    preHandler: withAuth,
  }, async (request, reply) => {
    const marketKey = request.params.marketId

    const market = await prisma.market.findFirst({
      where: {
        OR: [{ id: marketKey }, { slug: marketKey }],
      },
      select: { id: true, status: true },
    })

    if (!market) {
      return reply.status(404).send({ error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' } })
    }

    try {
      await prisma.market.update({
        where: { id: market.id },
        data: { status: 'active' },
      })

      return reply.send({ ok: true })
    } catch (error) {
      request.log.error({ error, marketId: market.id }, 'restore.failed')
      return reply.status(500).send({ error: { code: 'RESTORE_FAILED', message: (error as Error).message } })
    }
  })

  const UpdateExpirySchema = z.object({
    expiresAt: z.string().trim().min(1, 'expiresAt is required').refine((value) => {
      return !Number.isNaN(Date.parse(value))
    }, { message: 'expiresAt must be a valid ISO 8601 date/time' }),
  })

  fastify.post<{
    Params: { marketId: string }
    Body: { expiresAt?: string }
  }>('/markets/:marketId/expiry', {
    preHandler: withAuth,
  }, async (request, reply) => {
    const marketKey = request.params.marketId
    const parsed = UpdateExpirySchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_EXPIRY',
          message: parsed.error.errors[0]?.message ?? 'Invalid expiresAt value',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const market = await prisma.market.findFirst({
      where: {
        OR: [{ id: marketKey }, { slug: marketKey }],
      },
    })

    if (!market) {
      return reply.status(404).send({
        error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
        timestamp: new Date().toISOString(),
      })
    }

    const expiresAt = new Date(parsed.data.expiresAt)
    if (Number.isNaN(expiresAt.getTime())) {
      return reply.status(400).send({
        error: { code: 'INVALID_EXPIRY', message: 'expiresAt must be a valid date' },
        timestamp: new Date().toISOString(),
      })
    }

    const updated = await prisma.market.update({
      where: { id: market.id },
      data: { expiresAt },
    })

    return reply.send({
      ok: true,
      market: {
        id: updated.id,
        expiresAt: updated.expiresAt?.toISOString?.() ?? null,
        slug: updated.slug ?? null,
        status: updated.status,
      },
    })
  })

  fastify.post('/tile-backgrounds/upload', {
    preHandler: withAuth,
  }, async (request, reply) => {
    const parts = request.parts()
    let tagValue: string | null = null
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
      } else if (part.type === 'field' && part.fieldname === 'tag') {
        if (typeof part.value === 'string') {
          tagValue = part.value
        }
      } else if (part.type === 'file') {
        part.file.resume()
      }
    }

    if (!tagValue || tagValue.trim().length < 2) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_TAG',
          message: 'Tag must be at least 2 characters long',
        },
        timestamp: new Date().toISOString(),
      })
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
      request.log.warn({ error, tag: tagValue }, 'tile_background_upload_safety_rejected')
      return reply.status(422).send({
        error: {
          code: 'IMAGE_REJECTED',
          message: 'Image failed safety checks',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const normalizedTag = normalizeTag(tagValue)
    const filenameBase = slugify(tagValue)
    const fileName = `${filenameBase}-${Date.now()}${extension}`
    const destination = path.join(uploadPaths.tileBackgrounds, fileName)

    request.log.info({ tag: tagValue, destination, bytes: uploadedFile.buffer.length }, 'tile_background_upload_write_start')
    try {
      await fs.writeFile(destination, uploadedFile.buffer)
    } catch (error) {
      request.log.error({ error, destination }, 'tile_background_upload_failed')
      return reply.status(500).send({
        error: {
          code: 'UPLOAD_FAILED',
          message: 'Failed to save uploaded file',
        },
        timestamp: new Date().toISOString(),
      })
    }

    request.log.info({ tag: tagValue, destination }, 'tile_background_upload_write_done')

    const publicUrl = `/static/tile-backgrounds/${fileName}`

    try {
      request.log.info({ tag: tagValue, normalizedTag, publicUrl }, 'tile_background_upload_upsert_start')
      const background = await prisma.marketTileBackground.upsert({
        where: { normalizedTag },
        update: {
          tag: tagValue.trim(),
          imageUrl: publicUrl,
        },
        create: {
          tag: tagValue.trim(),
          normalizedTag,
          imageUrl: publicUrl,
        },
      })

      request.log.info({ tag: tagValue, normalizedTag, id: background.id }, 'tile_background_upload_upsert_done')
      return reply.send({
        background: serializeBackground(background),
        upserted: true,
      })
    } catch (error) {
      request.log.error({ error, tag: tagValue }, 'Failed to save uploaded tile background')
      return reply.status(500).send({
        error: {
          code: 'BACKGROUND_SAVE_FAILED',
          message: 'Failed to save tile background',
        },
        timestamp: new Date().toISOString(),
      })
    }
  })

  fastify.post<{ Params: { marketId: string } }>('/markets/:marketId/backfill', {
    preHandler: withAuth,
  }, async (request, reply) => {
    const marketKey = request.params.marketId
    const etherscanKey = process.env.ETHERSCAN_API_KEY

    if (!etherscanKey) {
      return reply.status(500).send({ error: { code: 'MISSING_ETHERSCAN_KEY', message: 'ETHERSCAN_API_KEY not set' } })
    }

    const market = await prisma.market.findFirst({
      where: {
        OR: [{ id: marketKey }, { slug: marketKey }],
      },
      select: { id: true, fpmmAddress: true },
    })

    if (!market) {
      return reply.status(404).send({ error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' } })
    }
    if (!market.fpmmAddress) {
      return reply.status(400).send({ error: { code: 'NO_FPMM', message: 'Market has no FPMM address' } })
    }

    try {
      const result = await backfillFpmmFromEtherscan({
        prisma,
        publicClient,
        fpmmAddress: market.fpmmAddress as `0x${string}`,
        marketId: market.id,
        etherscanKey,
        chainId: ENV.CHAIN_ID,
      })

      if (fastify.redis) {
        try {
          await fastify.redis.del(`recon:sweep:lock:${market.id}`)
          await fastify.redis.lrem('recon:q:sweep', 0, JSON.stringify({ marketId: market.id }))
        } catch (error) {
          request.log.warn({ error, marketId: market.id }, 'backfill.redis_cleanup_failed')
        }
      }

      return reply.send({
        ok: true,
        result: {
          trades: result.trades,
          liquidityEvents: result.liquidityEvents,
          lastBlock: result.lastBlock ? result.lastBlock.toString() : null,
        },
      })
    } catch (error) {
      request.log.error({ error, marketId: market.id }, 'backfill.failed')
      return reply.status(500).send({ error: { code: 'BACKFILL_FAILED', message: (error as Error).message } })
    }
  })

  fastify.delete<{
    Params: { id: string }
  }>('/tile-backgrounds/:id', {
    preHandler: withAuth,
  }, async (request, reply) => {
    const { id } = request.params
    if (!id) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_ID',
          message: 'Background id is required',
        },
        timestamp: new Date().toISOString(),
      })
    }

    try {
      await prisma.marketTileBackground.delete({
        where: { id },
      })
      return reply.send({ deleted: true })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.status(404).send({
          error: {
            code: 'BACKGROUND_NOT_FOUND',
            message: 'Tile background not found',
          },
          timestamp: new Date().toISOString(),
        })
      }

      request.log.error({ error, id }, 'Failed to delete tile background')
      return reply.status(500).send({
        error: {
          code: 'BACKGROUND_DELETE_FAILED',
          message: 'Failed to delete tile background',
        },
        timestamp: new Date().toISOString(),
      })
    }
  })

  // Create market (admin only)
  fastify.post<{ Body: unknown }>('/markets', async (request, reply) => {
    const parsed = CreateMarketInputSchema.safeParse(request.body)
    if (!parsed.success) {
      incValidationMetric('POST /api/admin/markets')
      const issues = formatZodIssues(parsed.error.issues)
      return reply.status(400).send({
        error: 'validation_failed',
        issues,
        timestamp: new Date().toISOString(),
      })
    }

    try {
      const result = await createMarketInternal(fastify, parsed.data, {
        creatorUserId: 'admin',
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
      request.log.error({ error }, 'admin_create_market_failed')
      return reply.status(500).send({
        ok: false,
        reason: 'internal_error',
        error: 'Failed to create market',
        timestamp: new Date().toISOString(),
      })
    }
  })

  const SeedPoolParamsSchema = z.object({
    marketId: z.string().min(1),
  })

  fastify.post<{
    Params: { marketId: string }
  }>('/markets/:marketId/seed', {
    schema: {
      params: {
        type: 'object',
        required: ['marketId'],
        properties: {
          marketId: { type: 'string' }
        }
      },
      body: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: {},
      },
    },
    preHandler: withAuth
  }, async (request, reply) => {
    const params = SeedPoolParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.status(400).send({
        ok: false,
        error: 'invalid_params',
        details: params.error.flatten()
      })
    }

    try {
      const result = await seedMarketInternal(fastify, params.data.marketId, {
        logger: request.log,
      })
      return reply.send(result)
    } catch (error) {
      if (error instanceof MarketCreationError) {
        return reply.status(error.statusCode).send({
          ...error.body,
          timestamp: (error.body && error.body.timestamp) || new Date().toISOString(),
        })
      }
      request.log.error({ error }, 'Failed to seed FPMM pool')
      return reply.status(500).send({
        ok: false,
        error: 'seed_failed',
        details: (error as Error)?.message || 'Unknown error',
        timestamp: new Date().toISOString(),
      })
    }
  })

  // Resolve market (admin only)
  fastify.post<{
    Body: ResolveMarketRequest
    Params: { marketId: string }
  }>('/markets/:marketId/resolve', {
    preHandler: withAuth
  }, async (request, reply) => {
    const { marketId } = request.params
    const resolutionData = validateMarketResolution(request.body)

    try {
      // Get market
      const market = await prisma.market.findUnique({
        where: { id: marketId }
      })

      if (!market) {
        return reply.status(404).send({
          error: {
            code: 'MARKET_NOT_FOUND',
            message: 'Market not found'
          },
          timestamp: new Date().toISOString()
        })
      }

      if (market.status !== 'active') {
        return reply.status(400).send({
          error: {
            code: 'INVALID_MARKET_STATUS',
            message: 'Market is not active'
          },
          timestamp: new Date().toISOString()
        })
      }

      const adapter = getOracleAdapterContract()
      if (!adapter) {
        return reply.status(503).send({
          error: {
            code: 'ORACLE_ADAPTER_NOT_CONFIGURED',
            message: 'Direct oracle adapter contract not configured'
          },
          timestamp: new Date().toISOString()
        })
      }

      if (!process.env.DEPLOYER_PRIVATE_KEY) {
        return reply.status(500).send({
          error: {
            code: 'MISSING_DEPLOYER_KEY',
            message: 'DEPLOYER_PRIVATE_KEY not configured'
          },
          timestamp: new Date().toISOString()
        })
      }

      if (!market.conditionId || !/^0x[0-9a-fA-F]{64}$/.test(market.conditionId)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_CONDITION_ID',
            message: 'Market is missing a valid conditionId'
          },
          timestamp: new Date().toISOString()
        })
      }

      const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex)
      const walletClient = makeWalletClient(account)
      const payoutVector = resolutionData.payoutNumerators.map((n: any) => BigInt(n))

      let txHash: Hex
      try {
        const { request: resolveRequest } = await publicClient.simulateContract({
          address: adapter.address,
          abi: adapter.abi,
          functionName: 'requestResolve',
          args: [market.conditionId as `0x${string}`, payoutVector],
          account,
        })
        txHash = await walletClient.writeContract(resolveRequest)
        await publicClient.waitForTransactionReceipt({ hash: txHash })
      } catch (resolveErr: any) {
        const short = resolveErr?.shortMessage || resolveErr?.message || 'Resolution failed'
        const details = resolveErr?.cause?.shortMessage || resolveErr?.cause?.message || resolveErr?.cause?.data
        request.log.error({ short, details, marketId }, 'oracle_adapter.requestResolve_failed')
        return reply.status(400).send({
          error: {
            code: 'ORACLE_ADAPTER_RESOLVE_FAILED',
            message: short,
            details,
          },
          timestamp: new Date().toISOString()
        })
      }

      // Update database
      const updatedMarket = await prisma.market.update({
        where: { id: marketId },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolutionData: {
            payoutNumerators: resolutionData.payoutNumerators
          }
        }
      })

      return reply.send({
        id: updatedMarket.id,
        status: updatedMarket.status,
        resolvedAt: updatedMarket.resolvedAt!.toISOString(),
        resolutionData: updatedMarket.resolutionData as any
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to resolve market'
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  // Get admin stats
  fastify.get('/stats', {
    preHandler: withAuth
  }, async (request, reply) => {
    try {
      const [totalMarkets, activeMarkets, totalTrades, totalUsers] = await Promise.all([
        prisma.market.count(),
        prisma.market.count({ where: { status: 'active' } }),
        prisma.trade.count(),
        prisma.user.count(),
      ])

      return reply.send({
        totalMarkets,
        activeMarkets,
        totalTrades,
        totalUsers,
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get admin stats'
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  // ============================================
  // Tag Management Endpoints
  // ============================================

  const serializeTag = (tag: { id: string; name: string; normalized: string; visible: boolean; createdAt: Date; updatedAt: Date }, marketCount: number) => ({
    id: tag.id,
    name: tag.name,
    normalized: tag.normalized,
    visible: tag.visible,
    marketCount,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  })

  // GET /api/admin/tags - List all tags with visibility status and market counts
  fastify.get('/tags', {
    preHandler: withAuth,
  }, async (request, reply) => {
    try {
      // Get all tags from the tags table
      const tags = await prisma.tag.findMany({
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

      // Build response with market counts, sorted by count descending
      const tagsWithCounts = tags.map((tag) => ({
        ...tag,
        marketCount: tagCounts.get(tag.normalized) || 0,
      }))

      // Sort by marketCount descending (most used first)
      tagsWithCounts.sort((a, b) => b.marketCount - a.marketCount)

      return reply.send({
        tags: tagsWithCounts.map((t) => serializeTag(t, t.marketCount)),
      })
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch tags')
      return reply.status(500).send({
        error: {
          code: 'TAGS_FETCH_FAILED',
          message: 'Failed to fetch tags',
        },
        timestamp: new Date().toISOString(),
      })
    }
  })

  // PUT /api/admin/tags/:id - Toggle or set visibility for a tag
  fastify.put<{
    Params: { id: string }
    Body: { visible: boolean }
  }>('/tags/:id', {
    preHandler: withAuth,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['visible'],
        properties: {
          visible: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { visible } = request.body

    try {
      const tag = await prisma.tag.update({
        where: { id },
        data: { visible },
      })

      // Get market count for this tag
      const markets = await prisma.market.findMany({
        where: {
          status: { not: 'deleted' },
        },
        select: { tags: true },
      })

      let marketCount = 0
      for (const market of markets) {
        if (Array.isArray(market.tags)) {
          for (const t of market.tags) {
            if (typeof t === 'string' && t.trim().toLowerCase() === tag.normalized) {
              marketCount++
              break
            }
          }
        }
      }

      return reply.send({
        tag: serializeTag(tag, marketCount),
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.status(404).send({
          error: {
            code: 'TAG_NOT_FOUND',
            message: 'Tag not found',
          },
          timestamp: new Date().toISOString(),
        })
      }
      request.log.error({ error, id }, 'Failed to update tag')
      return reply.status(500).send({
        error: {
          code: 'TAG_UPDATE_FAILED',
          message: 'Failed to update tag',
        },
        timestamp: new Date().toISOString(),
      })
    }
  })

  // POST /api/admin/tags/sync - Sync tags from all markets into the tags table
  fastify.post('/tags/sync', {
    preHandler: withAuth,
  }, async (request, reply) => {
    try {
      // Get all unique tags from markets
      const markets = await prisma.market.findMany({
        where: { status: { not: 'deleted' } },
        select: { tags: true },
      })

      // Collect all unique tags (by normalized name)
      const uniqueTags = new Map<string, string>() // normalized -> original name
      for (const market of markets) {
        if (Array.isArray(market.tags)) {
          for (const tag of market.tags) {
            if (typeof tag === 'string' && tag.trim()) {
              const normalized = tag.trim().toLowerCase()
              // Keep the first (or most common) casing we see
              if (!uniqueTags.has(normalized)) {
                uniqueTags.set(normalized, tag.trim())
              }
            }
          }
        }
      }

      // Get existing tags
      const existingTags = await prisma.tag.findMany({
        select: { normalized: true },
      })
      const existingNormalized = new Set(existingTags.map((t) => t.normalized))

      // Insert only new tags (don't update existing ones to preserve visibility)
      let synced = 0
      for (const [normalized, name] of uniqueTags) {
        if (!existingNormalized.has(normalized)) {
          await prisma.tag.create({
            data: {
              name,
              normalized,
              visible: true, // Default to visible
            },
          })
          synced++
        }
      }

      return reply.send({
        synced,
        total: uniqueTags.size,
        existing: existingNormalized.size,
      })
    } catch (error) {
      request.log.error({ error }, 'Failed to sync tags')
      return reply.status(500).send({
        error: {
          code: 'TAGS_SYNC_FAILED',
          message: 'Failed to sync tags',
        },
        timestamp: new Date().toISOString(),
      })
    }
  })

  // DELETE /api/admin/tags/:id - Hard delete a tag from the tags table
  // Note: This does NOT remove the tag from markets - it only removes the visibility entry
  fastify.delete<{
    Params: { id: string }
  }>('/tags/:id', {
    preHandler: withAuth,
  }, async (request, reply) => {
    const { id } = request.params

    try {
      const tag = await prisma.tag.delete({
        where: { id },
      })

      return reply.send({
        deleted: true,
        tag: {
          id: tag.id,
          name: tag.name,
          normalized: tag.normalized,
        },
        note: 'Tag removed from visibility table. Markets still have this tag - run sync to re-add.',
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.status(404).send({
          error: {
            code: 'TAG_NOT_FOUND',
            message: 'Tag not found',
          },
          timestamp: new Date().toISOString(),
        })
      }
      request.log.error({ error, id }, 'Failed to delete tag')
      return reply.status(500).send({
        error: {
          code: 'TAG_DELETE_FAILED',
          message: 'Failed to delete tag',
        },
        timestamp: new Date().toISOString(),
      })
    }
  })
}

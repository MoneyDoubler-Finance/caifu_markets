import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const PostCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(500, 'Comment must be 500 characters or less'),
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional()
    .nullable(),
  parentId: z.string().optional().nullable(),
})

const commentsRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app

  // Helper to resolve a market key (id or slug) to canonical id
  async function resolveMarketId(key: string): Promise<string | null> {
    const normalized = key?.trim()
    if (!normalized) return null
    const row = await prisma.market.findFirst({
      where: {
        OR: [
          { id: normalized },
          { slug: { equals: normalized, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    })
    return row?.id ?? null
  }

  // List comments for a market (newest first)
  app.get('/markets/:id/comments', async (request, reply) => {
    const key = (request.params as any)?.id as string
    const { limit: limitStr, before } = request.query as { limit?: string; before?: string }
    const limit = Math.max(1, Math.min(parseInt(limitStr || '25', 10) || 25, 50))

    let createdBefore: Date | undefined
    if (before) {
      const ts = Number(before)
      if (!Number.isNaN(ts)) {
        createdBefore = new Date(ts)
      } else {
        const parsed = new Date(before)
        if (!Number.isNaN(parsed.getTime())) createdBefore = parsed
      }
    }

    const canonicalId = await resolveMarketId(key)
    if (!canonicalId) {
      return reply.status(404).send({ ok: false, error: 'Market not found' })
    }

    const comments = await prisma.marketComment.findMany({
      where: {
        marketId: canonicalId,
        ...(createdBefore ? { createdAt: { lt: createdBefore } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            displayName: true,
            avatarUrl: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return reply.send({ ok: true, comments })
  })

  // Post a new comment (requires auth)
  app.post('/markets/:id/comments', async (request, reply) => {
    const user = (request as any).user as { id: string } | null
    if (!user) {
      return reply.status(401).send({ ok: false, error: 'Authentication required' })
    }
    const key = (request.params as any)?.id as string

    const parsed = PostCommentSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      const first = parsed.error.issues?.[0]?.message || 'Invalid request'
      return reply.status(400).send({ ok: false, error: first })
    }

    const { body, txHash, parentId } = parsed.data

    const canonicalId = await resolveMarketId(key)
    if (!canonicalId) {
      return reply.status(404).send({ ok: false, error: 'Market not found' })
    }

    const created = await prisma.marketComment.create({
      data: {
        marketId: canonicalId,
        userId: user.id,
        body,
        txHash: txHash ?? null,
        parentId: parentId ?? null,
      },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            displayName: true,
            avatarUrl: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    })

    // Broadcast to SSE listeners
    try {
      const channel = `market:${canonicalId}:comments`
      await app.redis.publish(channel, JSON.stringify({ type: 'comment', comment: created }))
    } catch (err) {
      app.log?.warn?.({ err }, 'comment.publish_failed')
    }

    return reply.send({ ok: true, comment: created })
  })
}

export { commentsRoutes }

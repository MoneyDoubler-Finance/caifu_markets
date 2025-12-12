import type { FastifyPluginAsync } from 'fastify'
import { isAddress } from 'viem'
import { issueNonce, verifySignatureAndCreateSession, setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME, revokeSession } from '../services/auth'

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const { prisma } = fastify

  fastify.post<{
    Body: { address?: string }
  }>('/request-signature', async (request, reply) => {
    const { address } = request.body || {}

    if (!address || !isAddress(address, { strict: false })) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid wallet address',
      })
    }

    const result = await issueNonce(prisma, address)

    return reply.send({
      ok: true,
      nonce: result.nonce,
      message: result.message,
      expiresAt: result.expiresAt.toISOString(),
    })
  })

  fastify.post<{
    Body: { address?: string; signature?: string; nonce?: string }
  }>('/verify', async (request, reply) => {
    const { address, signature, nonce } = request.body || {}

    if (!address || !isAddress(address, { strict: false }) || typeof signature !== 'string' || !signature.startsWith('0x') || typeof nonce !== 'string' || nonce.length === 0) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid signature payload',
      })
    }

    try {
      const { token, session, user } = await verifySignatureAndCreateSession(prisma, {
        walletAddress: address,
        signature: signature as `0x${string}`,
        nonce,
      }, request)

      setSessionCookie(reply, token, session.expiresAt)

      return reply.send({
        ok: true,
        user,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to verify signature'
      return reply.status(401).send({
        ok: false,
        error: message,
      })
    }
  })

  fastify.get('/me', async (request, reply) => {
    if (!request.user) {
      return reply.send({
        ok: false,
        user: null,
      })
    }

    return reply.send({
      ok: true,
      user: request.user,
    })
  })

  fastify.post('/logout', async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE_NAME]
    if (token) {
      await revokeSession(prisma, token).catch(() => undefined)
      clearSessionCookie(reply)
    }

    return reply.send({ ok: true })
  })
}

export { authRoutes }

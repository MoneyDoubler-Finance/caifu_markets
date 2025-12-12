import crypto from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { getConfig } from '@caifu/config'
import { getAddress, isAddress, recoverMessageAddress } from 'viem'
import type { PrismaClient, User, UserSession } from '@prisma/client'

export const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME || 'caifu_session'
const NONCE_TTL_MS = parseInt(process.env.AUTH_NONCE_TTL_MS ?? '', 10) || 15 * 60 * 1000
const SESSION_TTL_MS = parseInt(process.env.AUTH_SESSION_TTL_MS ?? '', 10) || 7 * 24 * 60 * 60 * 1000
const SESSION_REFRESH_THRESHOLD_MS = parseInt(process.env.AUTH_SESSION_REFRESH_THRESHOLD_MS ?? '', 10) || 24 * 60 * 60 * 1000

export type AuthenticatedUser = {
  id: string
  walletAddress: string
  displayName: string | null
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

const hashValue = (value: string): string =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex')

const generateNonce = (): string => crypto.randomBytes(16).toString('hex')
const generateSessionToken = (): string => crypto.randomBytes(32).toString('hex')

const normalizeAddress = (address: string): string => {
  if (!isAddress(address, { strict: false })) {
    throw new Error('Invalid wallet address')
  }
  return getAddress(address).toLowerCase()
}

export const authMessageForNonce = (address: string, nonce: string): string =>
  [
    'Caifu Markets Login',
    `Address: ${getAddress(address)}`,
    `Nonce: ${nonce}`,
    'Only sign this message if you trust the application.'
  ].join('\n')

export const serializeUser = (user: User): AuthenticatedUser => ({
  id: user.id,
  walletAddress: user.walletAddress,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
})

export async function issueNonce(
  prisma: PrismaClient,
  walletAddress: string,
) {
  const normalized = normalizeAddress(walletAddress)
  const nonce = generateNonce()
  const nonceHash = hashValue(nonce)
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS)

  await prisma.authNonce.create({
    data: {
      walletAddress: normalized,
      nonceHash,
      expiresAt,
    },
  })

  return {
    nonce,
    message: authMessageForNonce(normalized, nonce),
    expiresAt,
  }
}

async function findValidNonce(
  prisma: PrismaClient,
  walletAddress: string,
  nonce: string,
) {
  const normalized = normalizeAddress(walletAddress)
  const nonceHash = hashValue(nonce)

  const record = await prisma.authNonce.findUnique({
    where: { nonceHash },
  })

  if (!record) return null
  if (record.walletAddress !== normalized) return null
  if (record.consumed) return null
  if (record.expiresAt.getTime() < Date.now()) return null

  return record
}

async function markNonceConsumed(
  prisma: PrismaClient,
  nonceHash: string,
) {
  await prisma.authNonce.updateMany({
    where: { nonceHash },
    data: {
      consumed: true,
      consumedAt: new Date(),
    },
  })
}

async function upsertUser(
  prisma: PrismaClient,
  walletAddress: string,
) {
  const normalized = normalizeAddress(walletAddress)

  const existing = await prisma.user.findUnique({
    where: { walletAddress: normalized },
  })

  if (existing) {
    return existing
  }

  const fallbackName = `${getAddress(normalized).slice(0, 6)}...${getAddress(normalized).slice(-4)}`

  return prisma.user.create({
    data: {
      walletAddress: normalized,
      displayName: fallbackName,
    },
  })
}

async function createSession(
  prisma: PrismaClient,
  user: User,
  request: FastifyRequest,
) {
  const token = generateSessionToken()
  const tokenHash = hashValue(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const userAgent = request.headers['user-agent'] || null
  const ipAddress = request.ip

  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      sessionTokenHash: tokenHash,
      expiresAt,
      userAgent,
      ipAddress,
    },
  })

  return { session, token }
}

export async function verifySignatureAndCreateSession(
  prisma: PrismaClient,
  params: {
    walletAddress: string
    nonce: string
    signature: `0x${string}`
  },
  request: FastifyRequest,
) {
  const { walletAddress, nonce, signature } = params
  const normalized = normalizeAddress(walletAddress)

  const nonceRecord = await findValidNonce(prisma, normalized, nonce)
  if (!nonceRecord) {
    throw new Error('Nonce invalid or expired')
  }

  const message = authMessageForNonce(normalized, nonce)
  const recovered = await recoverMessageAddress({
    message,
    signature,
  })

  if (normalizeAddress(recovered) !== normalized) {
    await prisma.authNonce.update({
      where: { nonceHash: hashValue(nonce) },
      data: {
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    }).catch(() => undefined)
    throw new Error('Signature does not match wallet')
  }

  await markNonceConsumed(prisma, hashValue(nonce))

  const user = await upsertUser(prisma, normalized)
  const { token, session } = await createSession(prisma, user, request)

  return {
    token,
    session,
    user: serializeUser(user),
  }
}

export async function revokeSession(
  prisma: PrismaClient,
  token: string,
) {
  const hash = hashValue(token)
  await prisma.userSession.updateMany({
    where: { sessionTokenHash: hash },
    data: {
      revoked: true,
      revokedAt: new Date(),
    },
  })
}

type SessionValidationResult = {
  user: AuthenticatedUser
  session: UserSession
  refreshToken: boolean
  expiresAt: Date
  rawSessionToken?: string
}

export async function validateSessionToken(
  prisma: PrismaClient,
  token: string,
): Promise<SessionValidationResult | null> {
  if (!token) return null
  const hash = hashValue(token)
  const session = await prisma.userSession.findUnique({
    where: { sessionTokenHash: hash },
    include: { user: true },
  })

  if (!session) {
    return null
  }

  if (session.revoked || session.expiresAt.getTime() <= Date.now()) {
    await prisma.userSession.deleteMany({
      where: { sessionTokenHash: hash },
    }).catch(() => undefined)
    return null
  }

  const refreshToken = session.expiresAt.getTime() - Date.now() < SESSION_REFRESH_THRESHOLD_MS

  let expiresAt = session.expiresAt

  if (refreshToken) {
    expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await prisma.userSession.update({
      where: { id: session.id },
      data: {
        expiresAt,
        lastSeenAt: new Date(),
      },
    }).catch(() => undefined)
  } else {
    await prisma.userSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: new Date(),
      },
    }).catch(() => undefined)
  }

  return {
    user: serializeUser(session.user),
    session,
    refreshToken,
    expiresAt,
    rawSessionToken: refreshToken ? token : undefined,
  }
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  const config = getConfig()
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: config.isProduction,
    secure: config.isProduction,
    sameSite: (config.isProduction ? 'none' : 'lax') as any,
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(reply: FastifyReply) {
  const config = getConfig()
  reply.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: config.isProduction,
    secure: config.isProduction,
    sameSite: (config.isProduction ? 'none' : 'lax') as any,
    path: '/',
  })
}

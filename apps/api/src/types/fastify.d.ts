import 'fastify'
import type { PrismaClient, UserSession } from '@prisma/client'
import { Redis } from 'ioredis'
import type { PublicClient } from 'viem'
import type { OnDemandIndexer } from '../services/indexer'
import type { AuthenticatedUser } from '../services/auth'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
    redis: Redis
    collateral: typeof import('@caifu/config').COLLATERAL
    publicClient: PublicClient
    wsClient: PublicClient | undefined
    indexer: OnDemandIndexer
  }

  interface FastifyRequest {
    user: AuthenticatedUser | null
    session: UserSession | null
  }
}

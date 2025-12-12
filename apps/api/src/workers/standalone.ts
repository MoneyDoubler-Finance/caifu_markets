import pino from 'pino'
import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import { getConfig } from '@caifu/config'
import { startReconciliationWorker } from './reconcile'

const config = getConfig()
const prisma = new PrismaClient()
const redisUrl = process.env.REDIS_URL || config.env.REDIS_URL
const redis = redisUrl ? new Redis(redisUrl) : undefined
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'caifu-indexer'
})

async function run() {
  logger.info({ redisUrl }, 'Starting reconciliation worker (standalone)')
  try {
    await startReconciliationWorker(prisma, logger, redis)
    logger.info('Reconciliation worker started')
  } catch (err) {
    logger.error({ err }, 'Failed to start reconciliation worker')
    await prisma.$disconnect().catch(() => undefined)
    redis?.disconnect()
    process.exit(1)
  }
}

async function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'Shutting down reconciliation worker')
  redis?.disconnect()
  try {
    await prisma.$disconnect()
  } catch (err) {
    logger.warn({ err }, 'Failed to disconnect Prisma cleanly')
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

run()

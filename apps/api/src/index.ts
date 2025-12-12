import Fastify, { type FastifyReply, type FastifyRequest, type HookHandlerDoneFunction } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import websocket from '@fastify/websocket'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { getConfig, COLLATERAL, ENV } from '@caifu/config'
import { CaifuSDK, publicClient, wsClient, connectionInfo } from '@caifu/sdk'
import { PrismaClient } from '@prisma/client'
import { Redis } from 'ioredis'

// Import routes
import { marketRoutes } from './routes/markets'
import { adminRoutes } from './routes/admin'
import { registerAdminPing } from './routes/adminPing'
import swapRoutes from './routes/swap'
import tradeRoutes from './routes/trades'
import adminResolveRoutes from './routes/admin-resolve'
import redeemRoutes from './routes/redeem'
import healthzRoutes from './routes/healthz'
import { websocketHandler } from './websocket'
import { tileBackgroundRoutes } from './routes/tileBackgrounds'
import { ensureUploadDirectories, uploadPaths } from './lib/uploads'
import { registerUserSession } from './middleware/userSession'
import { authRoutes } from './routes/auth'
import { profileRoutes } from './routes/profile'
import { commentsRoutes } from './routes/comments'
import { alchemyWebhookRoutes } from './routes/webhooks'

// Import event watcher
import { cleanupEventWatchers } from './lib/eventWatcher'
import { initOnchainWatchers } from './lib/onchain'
import { startReconciliationWorker } from './workers/reconcile'
import { createOnDemandIndexer, createNoopIndexer } from './services/indexer'
import type { OnDemandIndexer } from './services/indexer'
import { runMigrations } from './scripts/migrate'
import { startLiveIngest } from './workers/liveIngest'

const config = getConfig()
const prisma = new PrismaClient()
const redis = new Redis(config.env.REDIS_URL)
let indexerInstance: OnDemandIndexer = createNoopIndexer()
const reconMode = (process.env.RECON_MODE ?? 'api-ondemand').toLowerCase()
let stopLiveIngest: (() => void) | null = null

// Request ID counter for proper request tracking
let requestIdCounter = 0

// Initialize SDK (still uses old constructor for backward compatibility)
const sdk = new CaifuSDK(
  ENV.RPC_HTTP_URL,
  config.contractAddresses as any,
  config.env.DEPLOYER_PRIVATE_KEY as `0x${string}`,
  undefined,
  ENV.CHAIN_ID,
  ENV.RPC_HTTP_FALLBACK_URL
)

// Log connection info
console.log('RPC Connection Info:', connectionInfo)

// Log active wiring configuration
console.log('ActiveWiring:', {
  MARKET_FACTORY: ENV.MARKET_FACTORY_ADDRESS || '(not set)',
  USE_CTF: ENV.USE_CTF,
  CTF: ENV.USE_CTF ? ENV.CTF_ADDRESS : '(disabled)',
  USDF: ENV.USDF_ADDRESS || '(not set)',
})

// Store cleanup function for onchain watchers
let stopOnchainWatchers: (() => void) | null = null

// Register hooks (must be called BEFORE listen)
function registerHooks(app: ReturnType<typeof Fastify>) {
  // Cleanup hook for graceful shutdown
  app.addHook('onClose', async () => {
    // Stop on-chain watchers
    if (stopOnchainWatchers) {
      stopOnchainWatchers()
    }

    if (stopLiveIngest) {
      stopLiveIngest()
    }
    
    // Cleanup WebSocket heartbeat timers and sockets
    try {
      const { cleanupAll } = await import('./websocket')
      cleanupAll?.()
    } catch (err) {
      app.log.error('Failed to cleanup WebSocket resources', err)
    }
  })
}

// Register custom request logging with filtering
async function registerRequestLogging(app: ReturnType<typeof Fastify>) {
  // Log incoming requests
  app.addHook('onRequest', async (request: any, reply: any) => {
    request.log.info({ req: request }, 'incoming request')
  })

  // Log completed requests
  app.addHook('onResponse', async (request: any, reply: any) => {
    const responseTime = typeof reply.elapsedTime === 'number'
      ? reply.elapsedTime
      : typeof reply.getResponseTime === 'function'
        ? reply.getResponseTime()
        : undefined
    request.log.info(
      {
        req: request,
        res: reply,
        responseTime,
      },
      'request completed'
    )
  })
}

// Register plugins
async function registerPlugins(app: ReturnType<typeof Fastify>) {
  await ensureUploadDirectories()
  // Build robust CORS allowlist from env (comma-separated)
  const raw =
    process.env.CORS_ORIGINS ??
    'https://example.com,https://www.example.com,https://app.example.com,https://*.vercel.app'
  const allowlist = raw.split(',').map((value) => value.trim()).filter(Boolean)
  const requiredOrigins = [
    'https://example.com',
    'https://www.example.com',
    'https://app.example.com',
    'https://*.vercel.app'
  ]
  for (const originValue of requiredOrigins) {
    if (!allowlist.includes(originValue)) {
      allowlist.push(originValue)
    }
  }
  const exactAllowlist = new Set(allowlist.filter(origin => !origin.includes('*')))
  const loggedCorsDecisions = new Set<string>()

  const logCorsDecision = (origin: string | null, allowed: boolean, reason: string) => {
    const key = `${allowed ? 'allow' : 'deny'}:${origin ?? '(none)'}`
    if (loggedCorsDecisions.has(key)) return
    loggedCorsDecisions.add(key)
    app.log.info({ origin: origin ?? '(none)', reason }, allowed ? 'CORS allow origin' : 'CORS deny origin')
  }

  app.addHook('onRequest', (req: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) => {
    if (typeof req.headers.upgrade === 'string' && req.headers.upgrade.toLowerCase() === 'websocket') {
      return done()
    }
    done()
  })

  const origin = (requestOrigin: string, cb: (err: Error | null, allow?: boolean) => void) => {
    // Allow non-browser / curl (no Origin header)
    if (!requestOrigin) {
      logCorsDecision(null, true, 'no-origin')
      return cb(null, true)
    }

    if (exactAllowlist.has(requestOrigin)) {
      logCorsDecision(requestOrigin, true, 'exact')
      return cb(null, true)
    }

    const hasVercelWildcard = allowlist.includes('https://*.vercel.app')
    if (hasVercelWildcard) {
      try {
        const parsed = new URL(requestOrigin)
        if (parsed.protocol === 'https:' && parsed.hostname.endsWith('vercel.app')) {
          logCorsDecision(requestOrigin, true, 'vercel-wildcard')
          return cb(null, true)
        }
      } catch (error) {
        app.log.warn({ origin: requestOrigin, error: (error as Error).message }, 'CORS origin parse failed')
      }
    }

    logCorsDecision(requestOrigin, false, 'not-allowed')
    return cb(null, false)
  }

  await app.register(cors, {
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'cookie',
      'x-requested-with',
      'sentry-trace',
      'x-sentry-trace',
      'baggage'
    ],
    exposedHeaders: ['set-cookie'],
    maxAge: 600
    // optionsSuccessStatus is an Express-only option; Fastify replies 204 by default
  })

  app.addHook('onSend', (request: FastifyRequest, reply: FastifyReply, payload: unknown, done: HookHandlerDoneFunction) => {
    const existing = reply.getHeader('Vary')
    if (!existing) {
      reply.header('Vary', 'Origin')
    } else if (typeof existing === 'string' && !existing.split(',').map((part) => part.trim().toLowerCase()).includes('origin')) {
      reply.header('Vary', `${existing}, Origin`)
    }
    done()
  })

  await app.register(cookie, {
    secret: config.env.ADMIN_JWT_SECRET
  })

  // Populate request.user from session cookie (must come after cookie plugin)
  await registerUserSession(app)

  await app.register(multipart, {
    attachFieldsToBody: false,
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
    },
  })

  await app.register(fastifyStatic, {
    root: uploadPaths.root,
    prefix: '/static/',
    list: false,
    decorateReply: false,
  })

  await app.register(jwt, {
    secret: config.env.ADMIN_JWT_SECRET
  })

  await app.register(websocket)
}

// Register routes
async function registerRoutes(app: ReturnType<typeof Fastify>) {
  // Health check
  app.get('/health', async () => {
    const { wsHealth } = require('./lib/wsHealth')
    const { getCompactFlags } = require('./lib/runtimeFlags')
    const { snapshot: getValidationMetrics } = require('./lib/validationMetrics')
    
    const wsHealthSnapshot = wsHealth.snapshot()
    const validationMetrics = getValidationMetrics()

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      ws: {
        connections: wsHealthSnapshot.connections,
        lastHeartbeatAt: wsHealthSnapshot.lastHeartbeatAt,
        lastTradeEventAt: wsHealthSnapshot.lastTradeEventAt
      },
      validation: {
        last5m: validationMetrics.last5m,
        total: validationMetrics.total
      },
      flags: getCompactFlags()
    }
  })

  // Config health check
  app.get('/health/config', async () => {
    const { getRuntimeFlags } = require('./lib/runtimeFlags')
    return getRuntimeFlags()
  })

  // WebSocket health check
  app.get('/health/ws', async () => {
    const { wsHealth } = require('./lib/wsHealth')
    return wsHealth.snapshotWithAlerts()
  })

  // RPC Health check
  app.get('/health/rpc', async () => {
    try {
      const block = await publicClient.getBlockNumber()
      return {
        ok: true,
        block: Number(block),
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }
    }
  })

  // API routes
  await app.register(marketRoutes, { prefix: '/api' })
  await app.register(adminRoutes, { prefix: '/api/admin' })
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(profileRoutes, { prefix: '/api' })
  await app.register(swapRoutes)
  await app.register(tradeRoutes, { prefix: '/api' })
  await app.register(adminResolveRoutes, { prefix: '/api' })
  await app.register(redeemRoutes, { prefix: '/api' })
  await app.register(healthzRoutes, { prefix: '/api' })
  await app.register(tileBackgroundRoutes, { prefix: '/api' })
  await app.register(commentsRoutes, { prefix: '/api' })
  await app.register(alchemyWebhookRoutes, { indexer: indexerInstance, log: app.log })
  await registerAdminPing(app)

  // WebSocket for real-time updates
  app.register(websocketHandler, { prefix: '/ws' })
}

// Build Fastify server
async function buildServer() {
  const loggerConfig: any = {
    level: config.env.LOG_LEVEL
  }

  const app = Fastify({
    bodyLimit: 12 * 1024 * 1024,
    logger: loggerConfig,
    requestIdLogLabel: 'reqId',
    genReqId: () => {
      // Generate simple sequential request IDs using module-level counter
      return String(++requestIdCounter)
    },
    disableRequestLogging: true,  // We'll handle request logging manually with filters
    ajv: {
      customOptions: {
        allowUnionTypes: true,
        strictTypes: false,
      },
    },
  })

  // Error handling
  app.setErrorHandler(async (error, request, reply) => {
    // Handle validation errors specially
    if (error.validation) {
      const { formatValidationError } = require('./lib/schemas')
      const { inc: incValidationMetric } = require('./lib/validationMetrics')
      
      const routeKey = `${request.method} ${request.url.split('?')[0]}`
      incValidationMetric(routeKey)
      
      const formatted = formatValidationError(error)
      return reply.status(400).send({
        error: formatted
      })
    }
    
    app.log.error(error)

    if (error.statusCode) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code || 'INTERNAL_SERVER_ERROR',
          message: error.message,
          details: config.isDevelopment ? error.stack : undefined
        },
        timestamp: new Date().toISOString()
      })
    } else {
      reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error',
          details: config.isDevelopment ? error.message : undefined
        },
        timestamp: new Date().toISOString()
      })
    }
  })

  // Register plugins
  await registerPlugins(app)

  // Make SDK, Prisma, Redis, Collateral, and Clients available to routes
  // Must be registered BEFORE routes are registered
  app.decorate('sdk', sdk)
  app.decorate('prisma', prisma)
  app.decorate('redis', redis)
  app.decorate('collateral', COLLATERAL)
  app.decorate('publicClient', publicClient)
  app.decorate('wsClient', wsClient)
  if (reconMode === 'api-ondemand' || reconMode === 'webhook') {
    indexerInstance = createOnDemandIndexer({
      prisma,
      redis,
      publicClient,
      log: app.log,
    })
  } else {
    indexerInstance = createNoopIndexer()
  }
  app.decorate('indexer', indexerInstance)

  // Register custom request logging with filtering
  await registerRequestLogging(app)

  // Register routes
  await registerRoutes(app)

  // Register hooks (MUST be before listen)
  registerHooks(app)

  return app
}

// Graceful shutdown
async function gracefulShutdown(signal: string, app: ReturnType<typeof Fastify>) {
  app.log.info(`Received ${signal}, shutting down gracefully`)

  // Cleanup WebSocket resources
  try {
    const { cleanupAll } = await import('./websocket')
    cleanupAll?.()
  } catch (err) {
    app.log.error('Failed to cleanup WebSocket resources', err)
  }

  await cleanupEventWatchers()
  await indexerInstance.stop()
  await app.close()
  await prisma.$disconnect()
  await redis.quit()

  process.exit(0)
}

// Start server
let started = false
async function start() {
  if (started) return
  started = true

  try {
    await runMigrations(prisma)

    const app = await buildServer()

    // Initialize on-chain watchers (if RPC_WS_URL configured)
    if (process.env.RPC_WS_URL) {
      stopOnchainWatchers = await initOnchainWatchers({
        redis,
        log: (msg, meta) => app.log.info({ meta }, msg),
      })
    }

    // Start reconciliation/indexing
    if (reconMode === 'api-ondemand' || reconMode === 'webhook') {
      await indexerInstance.start()
      // Start live ingest in both api-ondemand and webhook modes
      // (webhook mode can still benefit from real-time event watching)
      try {
        stopLiveIngest = await startLiveIngest(prisma, indexerInstance, app.log)
      } catch (err) {
        app.log.error({ err }, 'Failed to start live ingest')
      }
    } else if (process.env.RECON_ENABLED === '1') {
      await startReconciliationWorker(prisma, app.log, redis)
    }

    await app.listen({
      host: config.env.HOST,
      port: config.env.PORT
    })

    app.log.info(`Server listening on ${config.env.HOST}:${config.env.PORT}`)

    process.on('SIGINT', () => gracefulShutdown('SIGINT', app))
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', app))
  } catch (err) {
    console.error('Failed to start:', err)
    process.exit(1)
  }
}

start()

import type { FastifyPluginAsync } from 'fastify';
import { ENV } from '@caifu/config';
import { getCTFContract, getFPMMFactoryContract, getUSDFContract } from '../lib/contracts';
import { publicClient } from '@caifu/sdk';
import type { Address } from 'viem';
import { getFpmmWatcherStats } from '../workers/reconcile';
import { getLiveIngestStats } from '../workers/liveIngest';

const HEALTHZ_CACHE_MS = parseInt(process.env.HEALTHZ_CACHE_MS || '0', 10);

type CachedHealth = {
  statusCode: number;
  payload: any;
  expiresAt: number;
};

let cachedHealth: CachedHealth | null = null;

const healthzRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app;
  const indexer = app.indexer;

  app.get('/healthz', async (request, reply) => {
    if (HEALTHZ_CACHE_MS > 0 && cachedHealth && Date.now() < cachedHealth.expiresAt) {
      const cachedPayload = JSON.parse(JSON.stringify(cachedHealth.payload));
      return reply.status(cachedHealth.statusCode).send(cachedPayload);
    }

    const results: any = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };

    let hasHardErrors = false;
    let overallStatus: 'ok' | 'warn' | 'alert' = 'ok';

    // Check DB
    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const dbElapsed = Date.now() - dbStart;
      results.db = { status: 'ok', elapsed_ms: dbElapsed };
    } catch (error: any) {
      results.db = { status: 'error', error: error.message };
      hasHardErrors = true;
      overallStatus = 'alert';
    }

    // Check on-demand indexer health
    try {
      const reconStats = await indexer.getStats();
      const reconStatus: 'ok' | 'warn' | 'alert' = reconStats.qps1m <= (parseInt(process.env.ETH_RPC_MAX_QPS ?? '2', 10) + 0.01)
        ? 'ok'
        : 'warn';

      results.recon = {
        mode: reconStats.mode,
        qps1m: reconStats.qps1m,
        backoffMs: reconStats.backoffMs,
        last429At: reconStats.last429At,
        jobs: reconStats.jobs,
        head: reconStats.head,
        marketsLagTop: reconStats.marketsLagTop,
        status: reconStatus,
      };

      results.rpc = {
        status: reconStats.head.block != null ? 'ok' : 'unknown',
        block: reconStats.head.block,
      };

      if (reconStatus === 'warn' && overallStatus !== 'alert') {
        overallStatus = 'warn';
      }
    } catch (error: any) {
      results.recon = {
        mode: 'api-ondemand',
        qps1m: 0,
        backoffMs: 0,
        last429At: null,
        jobs: { txPending: 0, sweepPending: 0, inflight: 0 },
        head: { block: null },
        marketsLagTop: [],
        status: 'alert',
        error: error.message,
      } as any;
      results.rpc = { status: 'error', error: error.message };
      hasHardErrors = true;
      overallStatus = 'alert';
    }

    // Check contract deployments
    results.contracts = {};
    
    const contractChecks = [
      { name: 'Factory', getter: getFPMMFactoryContract },
      { name: 'CTF', getter: getCTFContract },
      { name: 'USDF', getter: getUSDFContract },
    ];

    for (const { name, getter } of contractChecks) {
      const contract = getter();
      if (!contract) {
        results.contracts[name] = { status: 'not_configured', address: null };
        continue;
      }

      try {
        const code = await publicClient.getCode({ address: contract.address as Address });
        const codeLength = code && code !== '0x' ? (code.length - 2) / 2 : 0;
        results.contracts[name] = {
          status: codeLength > 0 ? 'ok' : 'no_code',
          address: contract.address,
          code_bytes: codeLength,
        };
        if (codeLength === 0) {
          overallStatus = overallStatus === 'alert' ? 'alert' : 'warn';
        }
      } catch (error: any) {
        results.contracts[name] = {
          status: 'error',
          address: contract.address,
          error: error.message,
        };
        hasHardErrors = true;
        overallStatus = 'alert';
      }
    }

    // Get real FPMM watcher stats from either reconcile worker or live ingest
    const reconStats = getFpmmWatcherStats();
    const liveStats = getLiveIngestStats();
    // Use whichever has watchers (live ingest takes priority in api-ondemand mode)
    const fpmmStats = liveStats.watcherCount > 0 ? liveStats : reconStats;
    results.fpmm = {
      watcherCount: fpmmStats.watcherCount,
      lastWatcherRefreshAt: fpmmStats.lastWatcherRefreshAt,
      lastEventAt: fpmmStats.lastEventAt,
    };
    results.metrics = {
      fpmmWatchers: fpmmStats.watcherCount,
      lastEventAt: fpmmStats.lastEventAt,
      candlesBackfillOk: true,
    };

    // Include env config (no secrets)
    results.env = {
      MARKET_FACTORY_ADDRESS: ENV.MARKET_FACTORY_ADDRESS || null,
      CTF_ADDRESS: ENV.CTF_ADDRESS || null,
      USDF_ADDRESS: ENV.USDF_ADDRESS || null,
      CHAIN_ID: ENV.CHAIN_ID,
      DEV_ROUTES: process.env.DEV_ROUTES || '0',
    };

    results.status = overallStatus;

    const sendWithCache = (statusCode: number) => {
      if (HEALTHZ_CACHE_MS > 0) {
        cachedHealth = {
          statusCode,
          payload: JSON.parse(JSON.stringify(results)),
          expiresAt: Date.now() + HEALTHZ_CACHE_MS,
        };
      }
      return reply.status(statusCode).send(results);
    };

    if (hasHardErrors) {
      return sendWithCache(503);
    }

    if (overallStatus === 'warn') {
      return sendWithCache(200);
    }

    return sendWithCache(200);
  });
};

export default healthzRoutes;

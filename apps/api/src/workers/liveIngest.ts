import type { PrismaClient } from '@prisma/client'
import type { FastifyBaseLogger } from 'fastify'
import { wsClient } from '@caifu/sdk'
import type { OnDemandIndexer } from '../services/indexer'
import { FPMMABI } from '../lib/abi/FPMM'
import { FPMMFactoryABI } from '../lib/abi/FPMMFactory'
import type { Log } from 'viem'

type MarketRow = {
  id: string
  fpmm_address: string
}

// Module-level state for stats export
let liveIngestWatcherCount = 0
let liveIngestLastRefreshAt: number | null = null
let liveIngestLastEventAt: number | null = null

export function getLiveIngestStats() {
  return {
    watcherCount: liveIngestWatcherCount,
    lastWatcherRefreshAt: liveIngestLastRefreshAt,
    lastEventAt: liveIngestLastEventAt,
  }
}

const REFRESH_MS = 60_000
const SWEEP_MS = Math.max(60_000, parseInt(process.env.RECON_SWEEP_TIMER_MS ?? '300000', 10))
const SWEEP_ENABLED = process.env.INGEST_SWEEP_ENABLED === '1'

export async function startLiveIngest(prisma: PrismaClient, indexer: OnDemandIndexer, log: FastifyBaseLogger) {
  if (!wsClient) {
    log.warn('WS client unavailable; live ingest disabled')
    return () => {}
  }

  const client = wsClient

  const watchers = new Map<string, () => void>() // key: lowercase address

  const enqueueTxFromLogs = async (logs: Log[], hintMarketId?: string) => {
    const seen = new Set<string>()
    for (const entry of logs) {
      const tx = entry.transactionHash
      if (typeof tx === 'string' && tx.startsWith('0x') && tx.length === 66 && !seen.has(tx)) {
        seen.add(tx)
        await indexer.enqueueTx({ txHash: tx as `0x${string}`, marketId: hintMarketId })
      }
    }
  }

  const addFpmmWatcher = (address: string, marketId?: string) => {
    const key = address.toLowerCase()
    if (watchers.has(key)) return
    try {
      const unwatch = client.watchContractEvent({
        address: address as `0x${string}`,
        abi: FPMMABI as any,
        onLogs: (logs) => {
          liveIngestLastEventAt = Date.now()
          enqueueTxFromLogs(logs, marketId).catch((err) => log.error({ err, address: key }, 'liveIngest.fpmm.enqueue_failed'))
        },
        onError: (err) => {
          log.error({ err, address: key }, 'liveIngest.fpmm.error')
        },
      })
      watchers.set(key, unwatch)
      liveIngestWatcherCount = watchers.size
      log.info({ address: key }, 'liveIngest.fpmm.watching')
    } catch (err) {
      log.error({ err, address: key }, 'liveIngest.fpmm.watch_failed')
    }
  }

  const refreshWatchlist = async () => {
    const rows = await prisma.$queryRaw<MarketRow[]>`SELECT id, fpmm_address FROM public.markets WHERE fpmm_address IS NOT NULL`
    for (const row of rows) {
      if (!row.fpmm_address) continue
      addFpmmWatcher(row.fpmm_address, row.id)
    }
    liveIngestLastRefreshAt = Date.now()
  }

  // Factory watcher to auto-add new pools
  try {
    const factoryAddress = (process.env.MARKET_FACTORY_ADDRESS || '').toLowerCase()
    if (factoryAddress) {
      const unwatchFactory = client.watchContractEvent({
        address: factoryAddress as `0x${string}`,
        abi: FPMMFactoryABI as any,
        eventName: 'FixedProductMarketMakerCreation',
        onLogs: (logs) => {
          logs.forEach((logEntry) => {
            const fpmm = (logEntry as any)?.args?.fixedProductMarketMaker as string | undefined
            if (fpmm) {
              addFpmmWatcher(fpmm)
              enqueueTxFromLogs([logEntry]).catch((err) => log.error({ err, fpmm }, 'liveIngest.factory.enqueue_failed'))
            }
          })
        },
        onError: (err) => log.error({ err }, 'liveIngest.factory.error'),
      })
      watchers.set(factoryAddress, unwatchFactory)
      log.info({ address: factoryAddress }, 'liveIngest.factory.watching')
    }
  } catch (err) {
    log.error({ err }, 'liveIngest.factory.watch_failed')
  }

  // Initial load
  await refreshWatchlist()

  const refreshTimer = setInterval(() => {
    refreshWatchlist().catch((err) => log.error({ err }, 'liveIngest.refresh_failed'))
  }, REFRESH_MS)

  const sweepTimer = SWEEP_ENABLED
    ? setInterval(async () => {
        try {
          const rows = await prisma.$queryRaw<MarketRow[]>`SELECT id FROM public.markets`
          for (const row of rows) {
            await indexer.maybeEnqueueSweep(row.id)
          }
        } catch (err) {
          log.error({ err }, 'liveIngest.sweep_failed')
        }
      }, SWEEP_MS)
    : null

  const stop = () => {
    clearInterval(refreshTimer)
    if (sweepTimer) clearInterval(sweepTimer)
    for (const unwatch of watchers.values()) {
      try {
        unwatch()
      } catch (err) {
        log.error({ err }, 'liveIngest.unwatch_failed')
      }
    }
    watchers.clear()
    liveIngestWatcherCount = 0
  }

  return stop
}

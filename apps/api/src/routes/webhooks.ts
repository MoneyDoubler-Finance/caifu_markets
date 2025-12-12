import type { FastifyPluginAsync } from 'fastify'
import type { OnDemandIndexer } from '../services/indexer'

type WebhookOptions = {
  indexer: OnDemandIndexer
  log: any
}

// Webhook auth must be configured via environment variables.
// Never commit webhook tokens/signing keys to source control.
const ALCHEMY_TOKEN = process.env.ALCHEMY_WEBHOOK_TOKEN

// Extract tx hashes from a variety of possible webhook shapes
function extractTxHashes(payload: any): string[] {
  const hashes = new Set<string>()

  const scanLogs = (logs: any[]) => {
    for (const log of logs) {
      const tx = log?.transactionHash || log?.transaction_hash
      if (typeof tx === 'string' && tx.startsWith('0x') && tx.length === 66) {
        hashes.add(tx)
      }
    }
  }

  if (Array.isArray(payload?.logs)) {
    scanLogs(payload.logs)
  }

  if (Array.isArray(payload?.event?.data?.block?.logs)) {
    scanLogs(payload.event.data.block.logs)
  }

  const maybeTx = payload?.event?.data?.transaction?.hash || payload?.txHash || payload?.transactionHash
  if (typeof maybeTx === 'string' && maybeTx.startsWith('0x') && maybeTx.length === 66) {
    hashes.add(maybeTx)
  }

  return Array.from(hashes)
}

export const alchemyWebhookRoutes: FastifyPluginAsync<WebhookOptions> = async (fastify, opts) => {
  const { indexer, log } = opts

  fastify.post('/api/webhooks/alchemy', async (request, reply) => {
    try {
      if (!ALCHEMY_TOKEN) {
        reply.code(503)
        return { ok: false, error: 'webhook_not_configured' }
      }

      const token = (request.headers['authorization'] || '').toString().replace(/^bearer\s+/i, '')
      const alt = request.headers['x-alchemy-token'] || request.headers['x-webhook-token']
      const provided = (alt || token || '').toString()
      if (!provided || provided !== ALCHEMY_TOKEN) {
        reply.code(401)
        return { ok: false, error: 'unauthorized' }
      }

      // Accept JSON; if content-type missing, attempt to parse raw body
      const body: any = request.body ?? {}

      const txHashes = extractTxHashes(body)

      if (txHashes.length === 0) {
        log.warn({ body }, 'alchemy webhook: no tx hashes found')
        return { ok: true, received: 0 }
      }

      let enqueued = 0
      for (const hash of txHashes) {
        try {
          const queued = await indexer.enqueueTx({ txHash: hash as `0x${string}` })
          if (queued) enqueued += 1
        } catch (err) {
          log.error({ err, hash }, 'alchemy webhook enqueue failed')
        }
      }

      return { ok: true, received: txHashes.length, enqueued }
    } catch (error) {
      log.error({ error }, 'alchemy webhook handler error')
      reply.code(500)
      return { ok: false, error: 'internal_error' }
    }
  })
}

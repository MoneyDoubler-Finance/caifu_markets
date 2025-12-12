import { Prisma, PrismaClient } from '@prisma/client'

type Logger = {
  info?: (msg: string, meta?: Record<string, unknown>) => void
  warn?: (meta: Record<string, unknown>, msg: string) => void
  error?: (meta: Record<string, unknown>, msg: string) => void
}

const logPrefix = 'db:migrate'

const MIGRATIONS: Array<{
  id: string
  run: (prisma: PrismaClient, log?: Logger) => Promise<void>
}> = [
  {
    id: '0001_fpmm_metrics_tables',
    async run(prisma, log) {
      // Rename legacy orderbook trades table if it exists so we can reuse the
      // trades name for the new FPMM metrics schema. We guard on a legacy column
      // (takeraddress) to avoid renaming the new table on subsequent runs.
      const renameLegacyTrades = Prisma.sql`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'takeraddress'
  ) THEN
    ALTER TABLE public.trades RENAME TO orderbook_trades;
  END IF;
END $$;
`
      await prisma.$executeRaw(renameLegacyTrades)

      // Create trades table for FPMM executions (idempotent).
      const createTrades = Prisma.sql`
CREATE TABLE IF NOT EXISTS public.trades (
  id SERIAL PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  fpmm_address BYTEA NOT NULL,
  tx_hash BYTEA NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  side TEXT NOT NULL,
  outcome SMALLINT NOT NULL,
  amount_in_usdf NUMERIC(78, 18) NOT NULL,
  price NUMERIC(38, 18) NOT NULL,
  amount_out_shares NUMERIC(78, 18) NOT NULL,
  fee_usdf NUMERIC(78, 18),
  UNIQUE (tx_hash, log_index)
);
`
      await prisma.$executeRaw(createTrades)

      await prisma.$executeRaw(Prisma.sql`
CREATE INDEX IF NOT EXISTS trades_market_idx ON public.trades (market_id);
`)
      await prisma.$executeRaw(Prisma.sql`
CREATE INDEX IF NOT EXISTS trades_fpmm_idx ON public.trades (fpmm_address);
`)
      await prisma.$executeRaw(Prisma.sql`
CREATE INDEX IF NOT EXISTS trades_timestamp_idx ON public.trades (timestamp);
`)
      await prisma.$executeRaw(Prisma.sql`
CREATE INDEX IF NOT EXISTS trades_block_idx ON public.trades (block_number);
`)

      // Liquidity events capture pool reserve transitions.
      const createLiquidityEvents = Prisma.sql`
CREATE TABLE IF NOT EXISTS public.liquidity_events (
  id SERIAL PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  fpmm_address BYTEA NOT NULL,
  tx_hash BYTEA NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  yes_reserves NUMERIC(78, 18) NOT NULL,
  no_reserves NUMERIC(78, 18) NOT NULL,
  tvl_usdf NUMERIC(78, 18) NOT NULL,
  source TEXT,
  UNIQUE (tx_hash, log_index)
);
`
      await prisma.$executeRaw(createLiquidityEvents)

      await prisma.$executeRaw(Prisma.sql`
ALTER TABLE public.liquidity_events
  ADD COLUMN IF NOT EXISTS source TEXT;
`)

      await prisma.$executeRaw(Prisma.sql`
CREATE INDEX IF NOT EXISTS liquidity_events_market_idx ON public.liquidity_events (market_id);
`)
      await prisma.$executeRaw(Prisma.sql`
CREATE INDEX IF NOT EXISTS liquidity_events_fpmm_idx ON public.liquidity_events (fpmm_address);
`)
      await prisma.$executeRaw(Prisma.sql`
CREATE INDEX IF NOT EXISTS liquidity_events_timestamp_idx ON public.liquidity_events (timestamp);
`)

      // Compact five-minute candles per market.
      const createCandles = Prisma.sql`
CREATE TABLE IF NOT EXISTS public.candles_5m (
  market_id TEXT NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  fpmm_address BYTEA NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  open_price NUMERIC(38, 18) NOT NULL,
  high_price NUMERIC(38, 18) NOT NULL,
  low_price NUMERIC(38, 18) NOT NULL,
  close_price NUMERIC(38, 18) NOT NULL,
  volume_usdf NUMERIC(78, 18) NOT NULL,
  PRIMARY KEY (market_id, bucket_start)
);
`
      await prisma.$executeRaw(createCandles)

      await prisma.$executeRaw(Prisma.sql`
CREATE INDEX IF NOT EXISTS candles_fpmm_idx ON public.candles_5m (fpmm_address);
`)
      await prisma.$executeRaw(Prisma.sql`
CREATE INDEX IF NOT EXISTS candles_bucket_idx ON public.candles_5m (bucket_start);
`)

      log?.info?.(`${logPrefix}: applied migration 0001_fpmm_metrics_tables`)
    },
  },
  {
    id: '0002_market_sync_tables',
    async run(prisma, log) {
      await prisma.$executeRaw(Prisma.sql`
CREATE TABLE IF NOT EXISTS public.market_sync (
  market_id TEXT PRIMARY KEY REFERENCES public.markets(id) ON DELETE CASCADE,
  last_indexed_block BIGINT NOT NULL,
  last_audit_block BIGINT,
  sweeping BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`)

      await prisma.$executeRaw(Prisma.sql`
CREATE TABLE IF NOT EXISTS public.recon_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  rpc_qps1m NUMERIC(10, 2),
  last_429_at TIMESTAMPTZ,
  backoff_ms INTEGER,
  jobs_pending INTEGER,
  jobs_inflight INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`)

      await prisma.$executeRaw(Prisma.sql`
INSERT INTO public.recon_state (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;
`)

      log?.info?.(`${logPrefix}: applied migration 0002_market_sync_tables`)
    },
  },
  {
    id: '0003_system_kv_table',
    async run(prisma, log) {
      await prisma.$executeRaw(Prisma.sql`
CREATE TABLE IF NOT EXISTS public.system_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`)

      log?.info?.(`${logPrefix}: applied migration 0003_system_kv_table`)
    },
  },
  {
    id: '0004_user_and_comment_tables',
    async run(prisma, log) {
      // Users
      await prisma.$executeRaw(Prisma.sql`
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  wallet_address VARCHAR(42) UNIQUE NOT NULL,
  display_name VARCHAR(64),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`)
      await prisma.$executeRaw(Prisma.sql`
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`)
      await prisma.$executeRaw(Prisma.sql`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at'
  ) THEN
    CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
`)

      // Sessions
      await prisma.$executeRaw(Prisma.sql`
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_token_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`)

      // Auth nonces
      await prisma.$executeRaw(Prisma.sql`
CREATE TABLE IF NOT EXISTS public.auth_nonces (
  nonce_hash VARCHAR(64) PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed BOOLEAN NOT NULL DEFAULT FALSE,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`)
      await prisma.$executeRaw(Prisma.sql`CREATE INDEX IF NOT EXISTS auth_nonces_wallet_idx ON public.auth_nonces (wallet_address);`)

      // Market comments
      await prisma.$executeRaw(Prisma.sql`
CREATE TABLE IF NOT EXISTS public.market_comments (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  tx_hash VARCHAR(66),
  parent_id TEXT,
  edited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`)
      await prisma.$executeRaw(Prisma.sql`CREATE INDEX IF NOT EXISTS market_comments_market_idx ON public.market_comments (market_id, created_at DESC);`)
      await prisma.$executeRaw(Prisma.sql`CREATE INDEX IF NOT EXISTS market_comments_user_idx ON public.market_comments (user_id, created_at DESC);`)
      await prisma.$executeRaw(Prisma.sql`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_market_comments_updated_at'
  ) THEN
    CREATE TRIGGER trg_market_comments_updated_at
    BEFORE UPDATE ON public.market_comments
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
`)

      log?.info?.(`${logPrefix}: applied migration 0004_user_and_comment_tables`)
    },
  },
]

async function ensureMigrationTable(prisma: PrismaClient) {
  const createTable = Prisma.sql`
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`
  await prisma.$executeRaw(createTable)
}

async function hasMigration(prisma: PrismaClient, id: string): Promise<boolean> {
  const result = await prisma.$queryRaw<{ exists: boolean }[]>(Prisma.sql`
SELECT EXISTS(
  SELECT 1 FROM public.schema_migrations WHERE id = ${id}
) AS "exists";
`)
  return Boolean(result?.[0]?.exists)
}

async function recordMigration(prisma: PrismaClient, id: string) {
  await prisma.$executeRaw(Prisma.sql`
INSERT INTO public.schema_migrations (id, applied_at)
VALUES (${id}, NOW())
ON CONFLICT (id) DO NOTHING;
`)
}

export async function runMigrations(prisma: PrismaClient, log?: Logger) {
  await ensureMigrationTable(prisma)

  for (const migration of MIGRATIONS) {
    const alreadyRan = await hasMigration(prisma, migration.id)
    if (alreadyRan) {
      continue
    }

    try {
      await migration.run(prisma, log)
      await recordMigration(prisma, migration.id)
    } catch (err) {
      log?.error?.({ migration: migration.id, err: err instanceof Error ? err.message : err }, `${logPrefix}: migration failed`)
      throw err
    }
  }
}

CREATE TABLE IF NOT EXISTS public.position_balances (
  owner TEXT NOT NULL,
  market_id TEXT NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  outcome INTEGER NOT NULL,
  balance_shares NUMERIC(78, 0) NOT NULL DEFAULT 0,
  last_block BIGINT NOT NULL DEFAULT 0,
  last_tx TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner, market_id, outcome)
);

CREATE INDEX IF NOT EXISTS position_balances_owner_idx ON public.position_balances (owner);
CREATE INDEX IF NOT EXISTS position_balances_market_idx ON public.position_balances (market_id);

ALTER TABLE public.recon_state
  ADD COLUMN IF NOT EXISTS position_last_block BIGINT NOT NULL DEFAULT 0;

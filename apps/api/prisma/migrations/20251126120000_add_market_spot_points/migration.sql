-- Create spot price history table
CREATE TABLE IF NOT EXISTS public.market_spot_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id VARCHAR(128) NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  yes_price NUMERIC(18,10) NOT NULL,
  no_price  NUMERIC(18,10) NOT NULL
);

-- Keep one point per timestamp per market
CREATE UNIQUE INDEX IF NOT EXISTS market_spot_points_market_ts_idx
  ON public.market_spot_points (market_id, timestamp);

CREATE INDEX IF NOT EXISTS market_spot_points_ts_idx
  ON public.market_spot_points (timestamp);

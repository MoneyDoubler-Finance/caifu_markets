import { sleep } from './sleep';

type RateLimiterStats = {
  qps1m: number;
  last429At: number | null;
  backoffMs: number;
};

const maxQps = Math.max(1, parseInt(process.env.ETH_RPC_MAX_QPS ?? '2', 10));
const burst = Math.max(1, parseInt(process.env.ETH_RPC_BURST ?? String(maxQps), 10));
const backoffBaseMs = Math.max(50, parseInt(process.env.ETH_RPC_BACKOFF_BASE_MS ?? '300', 10));
const backoffMaxMs = Math.max(backoffBaseMs, parseInt(process.env.ETH_RPC_BACKOFF_MAX_MS ?? '5000', 10));

let tokens = burst;
let lastRefill = Date.now();
let currentBackoff = backoffBaseMs;
let last429At: number | null = null;
const requestTimestamps: number[] = [];

function refillTokens() {
  const now = Date.now();
  if (now <= lastRefill) return;
  const elapsedMs = now - lastRefill;
  const tokensToAdd = Math.floor((elapsedMs / 1000) * maxQps);
  if (tokensToAdd > 0) {
    tokens = Math.min(burst, tokens + tokensToAdd);
    lastRefill = now;
  }
}

async function acquireToken(): Promise<void> {
  while (true) {
    refillTokens();
    if (tokens > 0) {
      tokens -= 1;
      return;
    }
    const waitMs = Math.max(50, Math.floor(1000 / maxQps));
    await sleep(waitMs);
  }
}

function recordRequest() {
  const now = Date.now();
  requestTimestamps.push(now);
  const cutoff = now - 60_000;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
}

function recordSuccess() {
  currentBackoff = backoffBaseMs;
}

async function applyBackoff() {
  const delayMs = Math.min(currentBackoff, backoffMaxMs);
  currentBackoff = Math.min(backoffMaxMs, currentBackoff * 2);
  await sleep(delayMs);
}

function looksLikeRateLimit(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as any;
  const message = typeof err.shortMessage === 'string' ? err.shortMessage : typeof err.message === 'string' ? err.message : '';
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes('rate limit') || normalized.includes('429') || normalized.includes('too many requests');
}

export async function withRpcLimiter<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    await acquireToken();
    recordRequest();
    try {
      const result = await fn();
      recordSuccess();
      return result;
    } catch (error) {
      if (looksLikeRateLimit(error)) {
        last429At = Date.now();
        await applyBackoff();
        continue;
      }
      throw error;
    }
  }
}

export function getLimiterStats(): RateLimiterStats {
  const now = Date.now();
  const cutoff = now - 60_000;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
  const qps1m = requestTimestamps.length / 60;
  return {
    qps1m,
    last429At,
    backoffMs: currentBackoff,
  };
}

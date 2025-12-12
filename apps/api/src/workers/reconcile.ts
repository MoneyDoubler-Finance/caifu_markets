import type { Redis } from 'ioredis';
import { publicClient } from '@caifu/sdk';
import { ENV } from '@caifu/config';
import {
  getCTFContract,
  getFPMMFactoryContract,
  getFPMMContract,
  resolvePositionId,
} from '../lib/contracts';
import { FPMMABI } from '../lib/abi/FPMM';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Address, Hex } from 'viem';
import { decodeEventLog, encodeEventTopics } from 'viem';
import {
  insertTrade,
  insertLiquidityEvent,
  upsertCandle,
  truncateTo5m,
  formatFixed,
  parseFixed,
  hexToBuffer,
  TradeSide,
} from '../lib/metricsStore';
import { hydrateFromDb, addMarket as addPositionMarket, lookup as lookupPositionMeta } from './positionIndex';

const RECON_INTERVAL_MS = parseInt(process.env.RECON_INTERVAL_MS || '30000', 10);
const RECON_BLOCKS_PER_SCAN = parseInt(process.env.RECON_SCAN_BLOCKS || '400', 10);
const RECON_CONFIRMATIONS = parseInt(process.env.RECON_CONFIRMATIONS || '2', 10);
const RECON_JUMP_THRESHOLD = parseInt(process.env.RECON_JUMP_THRESHOLD || '1000', 10);

const parseBoolEnv = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) {
    return false;
  }
  return defaultValue;
};

const RECON_ONLY_KNOWN_FPMM = parseBoolEnv(process.env.RECON_ONLY_KNOWN_FPMM, false);
const RECON_BACKFILL_ENABLED = parseBoolEnv(process.env.RECON_BACKFILL_ENABLED, true);
const ENABLE_INDEXER = parseBoolEnv(process.env.ENABLE_INDEXER, Boolean((ENV as any).ENABLE_INDEXER));
const RECENT_MARKET_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface ReconState {
  lastIndexedBlock: bigint;
  latestHead: bigint | null;
  isRunning: boolean;
  lastDurationMs: number;
  lastError: string | null;
  confirmations: number;
  batchSize: number;
  usingWs: boolean;
  lastEventAt: number | null;
  lastRunAt: number | null;
  idle: boolean;
  idleReason: string | null;
}

const state: ReconState = {
  lastIndexedBlock: 0n,
  latestHead: null,
  isRunning: false,
  lastDurationMs: 0,
  lastError: null,
  confirmations: RECON_CONFIRMATIONS,
  batchSize: RECON_BLOCKS_PER_SCAN,
  usingWs: false,
  lastEventAt: null,
  lastRunAt: null,
  idle: false,
  idleReason: null,
};

const ERC20_TRANSFER_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
  },
] as const;

const ERC1155_EVENTS_ABI = [
  {
    type: 'event',
    name: 'TransferSingle',
    inputs: [
      { indexed: true, name: 'operator', type: 'address' },
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'id', type: 'uint256' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'TransferBatch',
    inputs: [
      { indexed: true, name: 'operator', type: 'address' },
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'ids', type: 'uint256[]' },
      { indexed: false, name: 'values', type: 'uint256[]' },
    ],
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

let redisPublisher: Redis | null = null;
let lastKnownFpmmCount = 0;

const SCALE_18 = 10n ** 18n;

const FPMM_EVENT_NAMES = ['FPMMFundingAdded', 'FPMMFundingRemoved', 'FPMMBuy', 'FPMMSell'] as const;
const FPMM_EVENT_TOPICS: Hex[] = FPMM_EVENT_NAMES.map((eventName) => {
  const topics = encodeEventTopics({
    abi: FPMMABI as any,
    eventName: eventName as any,
  });
  return topics?.[0];
}).filter((topic): topic is Hex => Boolean(topic));

type MarketState = {
  marketId: string;
  fpmmAddress: `0x${string}`;
  conditionId: Hex | null;
  collateralToken: Address | null;
  outcomeCount: number;
  positionIds: bigint[];
  fee: bigint;
  yesReserve: bigint;
  noReserve: bigint;
  lastProcessedBlock: bigint;
  lastProcessedLogIndex: number;
  hasLiquidity: boolean;
};

const marketStateByAddress = new Map<string, MarketState>();
const blockTimestampCache = new Map<bigint, Date>();
const lastBackfillByAddress = new Map<string, bigint>();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const appendRecentMarkets = async (prisma: PrismaClient, log: any) => {
  const since = new Date(Date.now() - RECENT_MARKET_LOOKBACK_MS);
  const markets = await prisma.market.findMany({
    where: {
      conditionId: { not: null },
      createdAt: { gte: since },
    },
    select: { id: true, conditionId: true },
  });

  let added = 0;
  for (const market of markets) {
    if (market.conditionId) {
      addPositionMarket(market.conditionId as Hex, market.id);
      added += 1;
    }
  }

  if (added > 0) {
    log?.info?.({ markets: added }, 'positionIndex appended recent markets');
  }
};

async function applyPositionDelta(
  prisma: PrismaClient,
  owner: string,
  marketId: string,
  outcome: number,
  delta: string,
  blockNumber: bigint,
  txHash: string
) {
  if (delta === '0') return;
  const ownerKey = owner.toLowerCase();
  const numericDelta = new Prisma.Decimal(delta);
  const blockValue = Number(blockNumber);

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO public.position_balances (owner, market_id, outcome, balance_shares, last_block, last_tx)
    VALUES (${ownerKey}, ${marketId}, ${outcome}, ${numericDelta}, ${blockValue}, ${txHash})
    ON CONFLICT (owner, market_id, outcome)
    DO UPDATE SET
      balance_shares = public.position_balances.balance_shares + EXCLUDED.balance_shares,
      last_block = GREATEST(public.position_balances.last_block, EXCLUDED.last_block),
      last_tx = CASE
        WHEN EXCLUDED.last_block >= public.position_balances.last_block THEN EXCLUDED.last_tx
        ELSE public.position_balances.last_tx
      END,
      updated_at = NOW();
  `);

  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM public.position_balances
    WHERE owner = ${ownerKey}
      AND market_id = ${marketId}
      AND outcome = ${outcome}
      AND balance_shares <= 0;
  `);
}

async function seedPositionBalancesFromPositions(prisma: PrismaClient, log: any) {
  if (!ENABLE_INDEXER) return;
  const result = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM public.position_balances
  `);
  const existing = result?.[0]?.count ?? 0n;
  if (existing > 0n) {
    log?.info?.({ rows: existing.toString() }, 'position_balances already seeded');
    return;
  }

  const rows = await prisma.$queryRaw<Array<{ owner: string; market_id: string; outcome: number; quantity: string; condition_id: string | null }>>(Prisma.sql`
    SELECT
      positions."userAddress" AS owner,
      positions."marketId" AS market_id,
      positions.outcome,
      positions.quantity,
      m."conditionId" AS condition_id
    FROM public.positions positions
    LEFT JOIN public.markets m ON m.id = positions."marketId"
    WHERE positions.quantity <> '0'
  `);

  let inserted = 0;
  for (const row of rows) {
    const amount = row.quantity || '0';
    if (amount === '0') continue;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO public.position_balances (owner, market_id, outcome, balance_shares, last_block, last_tx)
      VALUES (${row.owner.toLowerCase()}, ${row.market_id}, ${row.outcome}, ${new Prisma.Decimal(amount)}, 0, 'seed')
      ON CONFLICT (owner, market_id, outcome)
      DO UPDATE SET balance_shares = EXCLUDED.balance_shares,
        last_block = EXCLUDED.last_block,
        last_tx = EXCLUDED.last_tx,
        updated_at = NOW()
    `);
    if (row.condition_id) {
      addPositionMarket(row.condition_id as Hex, row.market_id);
    }
    inserted += 1;
  }

  log?.info?.({ rows: inserted }, 'position_balances seeded from legacy positions');
}

async function handleCtfTransferEvent(
  prisma: PrismaClient,
  decoded: any,
  logEntry: any,
  log: any
): Promise<number> {
  if (!ENABLE_INDEXER || !decoded?.eventName) {
    return 0;
  }

  const blockNumber = BigInt(logEntry.blockNumber ?? 0n);
  const txHash = logEntry.transactionHash ?? '';
  let updates = 0;
  let attemptedRecentLoad = false;

  const resolveMeta = async (idValue: bigint) => {
    let meta = lookupPositionMeta(idValue);
    if (!meta && !attemptedRecentLoad) {
      attemptedRecentLoad = true;
      await appendRecentMarkets(prisma, log);
      meta = lookupPositionMeta(idValue);
    }
    return meta;
  };

  const processTransfer = async (idValue: bigint, value: bigint, from: string, to: string) => {
    if (value === 0n) {
      return;
    }
    const meta = await resolveMeta(idValue);
    if (!meta) {
      log?.debug?.({ positionId: idValue.toString() }, 'positionIndex.miss');
      return;
    }
    const amount = value.toString();
    if (amount === '0') {
      return;
    }
    if (from && from !== ZERO_ADDRESS) {
      await applyPositionDelta(prisma, from, meta.marketId, meta.outcome, `-${amount}`, blockNumber, txHash);
      updates += 1;
    }
    if (to && to !== ZERO_ADDRESS) {
      await applyPositionDelta(prisma, to, meta.marketId, meta.outcome, amount, blockNumber, txHash);
      updates += 1;
    }
  };

  if (decoded.eventName === 'TransferSingle') {
    const idValue = BigInt(decoded.args?.id ?? 0n);
    const value = BigInt(decoded.args?.value ?? 0n);
    const from = typeof decoded.args?.from === 'string' ? decoded.args.from.toLowerCase() : ZERO_ADDRESS;
    const to = typeof decoded.args?.to === 'string' ? decoded.args.to.toLowerCase() : ZERO_ADDRESS;
    await processTransfer(idValue, value, from, to);
  } else if (decoded.eventName === 'TransferBatch') {
    const ids = Array.isArray(decoded.args?.ids) ? decoded.args.ids : [];
    const values = Array.isArray(decoded.args?.values) ? decoded.args.values : [];
    const from = typeof decoded.args?.from === 'string' ? decoded.args.from.toLowerCase() : ZERO_ADDRESS;
    const to = typeof decoded.args?.to === 'string' ? decoded.args.to.toLowerCase() : ZERO_ADDRESS;
    for (let i = 0; i < ids.length; i += 1) {
      const idValue = BigInt(ids[i] ?? 0n);
      const value = BigInt(values[i] ?? 0n);
      await processTransfer(idValue, value, from, to);
    }
  }

  return updates;
}

async function waitForDependency(
  name: string,
  attempt: () => Promise<unknown>,
  log: any,
  attempts: number = 10,
  delayMs: number = 2000
) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await attempt();
      if (i > 1) {
        log?.info?.({ dependency: name, retries: i - 1 }, `${name} ready`);
      }
      return true;
    } catch (err: any) {
      if (i === attempts) {
        log?.error?.({ dependency: name, err }, `${name} did not become ready after ${attempts} attempts`);
        return false;
      }
      log?.warn?.({ dependency: name, attempt: i, err: err?.message }, `${name} not ready yet; retrying`);
      await delay(delayMs);
    }
  }
  return false;
}

type FpmmEventLog = {
  address: `0x${string}`;
  eventName: string;
  args: Record<string, any>;
  log: any;
};

type ProcessedTrade = {
  marketId: string;
  fpmmAddress: string;
  txHash: string;
  outcome: number;
  side: TradeSide;
  price: string;
  amountInUSDF: string;
  amountOutShares: string;
  feeUSDF: string | null;
  timestamp: string;
  blockNumber: number;
  logIndex: number;
};

function computeYesPriceScaled(yes: bigint, no: bigint): bigint {
  const total = yes + no;
  if (total <= 0n) {
    return 0n;
  }
  return (no * SCALE_18) / total;
}

function computeTVLScaled(yes: bigint, no: bigint): bigint {
  if (yes === 0n && no === 0n) {
    return 0n;
  }
  const priceYes = computeYesPriceScaled(yes, no);
  const priceNo = SCALE_18 - priceYes;
  const yesValue = (yes * priceYes) / SCALE_18;
  const noValue = (no * priceNo) / SCALE_18;
  return yesValue + noValue;
}

function subtractWithFloor(value: bigint, delta: bigint): bigint {
  if (delta <= 0n) {
    return value;
  }
  return value > delta ? value - delta : 0n;
}

async function getBlockTimestamp(blockNumber: bigint): Promise<Date> {
  const cached = blockTimestampCache.get(blockNumber);
  if (cached) {
    return cached;
  }

  const block = await publicClient.getBlock({ blockNumber });
  const ts = new Date(Number(block.timestamp) * 1000);
  blockTimestampCache.set(blockNumber, ts);
  if (blockTimestampCache.size > 1024) {
    const firstKey = blockTimestampCache.keys().next().value;
    if (firstKey !== undefined) {
      blockTimestampCache.delete(firstKey);
    }
  }
  return ts;
}

export function getReconState() {
  return { ...state };
}

export function getFpmmWatcherStats() {
  return {
    watcherCount: lastKnownFpmmCount,
    lastWatcherRefreshAt: lastKnownFpmmCount > 0 ? state.lastRunAt : null,
    lastEventAt: state.lastEventAt,
  };
}

async function handleFpmmEvent(
  prisma: PrismaClient,
  marketState: MarketState,
  decoded: { eventName: string; args: Record<string, any> },
  logEntry: any,
  timestamp: Date,
  log: any
): Promise<ProcessedTrade | null> {
  const { eventName, args } = decoded;
  const blockNumber = BigInt(logEntry.blockNumber ?? 0n);
  const logIndex = Number(logEntry.logIndex ?? 0);
  const txHash = typeof logEntry.transactionHash === 'string' ? logEntry.transactionHash : '0x';

  const marketId = marketState.marketId;
  const fpmmAddress = marketState.fpmmAddress;
  const previousHasLiquidity = marketState.hasLiquidity;

  let broadcastTrade: ProcessedTrade | null = null;

  switch (eventName) {
    case 'FPMMFundingAdded': {
      const amounts: readonly bigint[] = Array.isArray(args?.amountsAdded)
        ? (args.amountsAdded as readonly bigint[])
        : Array.isArray(args?.amounts)
          ? (args.amounts as readonly bigint[])
          : [];
      const yesAdded = amounts[0] ?? 0n;
      const noAdded = amounts[1] ?? 0n;

      marketState.yesReserve += yesAdded;
      marketState.noReserve += noAdded;

      const tvlScaled = computeTVLScaled(marketState.yesReserve, marketState.noReserve);

      await insertLiquidityEvent(prisma, {
        marketId,
        fpmmAddress,
        txHash,
        logIndex,
        blockNumber: Number(blockNumber),
        timestamp,
        kind: previousHasLiquidity ? 'add' : 'init',
        yesReserves: formatFixed(marketState.yesReserve, 18),
        noReserves: formatFixed(marketState.noReserve, 18),
        tvlUSDF: formatFixed(tvlScaled, 18),
      });
      break;
    }
    case 'FPMMFundingRemoved': {
      const amounts: readonly bigint[] = Array.isArray(args?.amountsRemoved)
        ? (args.amountsRemoved as readonly bigint[])
        : Array.isArray(args?.sendAmounts)
          ? (args.sendAmounts as readonly bigint[])
          : [];
      const yesRemoved = amounts[0] ?? 0n;
      const noRemoved = amounts[1] ?? 0n;

      marketState.yesReserve = subtractWithFloor(marketState.yesReserve, yesRemoved);
      marketState.noReserve = subtractWithFloor(marketState.noReserve, noRemoved);

      const tvlScaled = computeTVLScaled(marketState.yesReserve, marketState.noReserve);

      await insertLiquidityEvent(prisma, {
        marketId,
        fpmmAddress,
        txHash,
        logIndex,
        blockNumber: Number(blockNumber),
        timestamp,
        kind: 'remove',
        yesReserves: formatFixed(marketState.yesReserve, 18),
        noReserves: formatFixed(marketState.noReserve, 18),
        tvlUSDF: formatFixed(tvlScaled, 18),
      });
      break;
    }
    case 'FPMMBuy': {
      const investmentAmount = BigInt(args?.investmentAmount ?? 0n);
      const feeAmount = BigInt(args?.feeAmount ?? 0n);
      const outcomeIndex = Number(args?.outcomeIndex ?? 0);
      const outcomeTokensBought = BigInt(args?.outcomeTokensBought ?? 0n);
      const netInvestment = investmentAmount > feeAmount ? investmentAmount - feeAmount : 0n;
      const execPriceStr = outcomeTokensBought > 0n ? formatFixed((investmentAmount * SCALE_18) / outcomeTokensBought, 18) : '0';

      if (outcomeIndex === 0) {
        // Buy YES: gain NO collateral, lose YES shares.
        marketState.noReserve += netInvestment;
        marketState.yesReserve = subtractWithFloor(marketState.yesReserve, outcomeTokensBought);
      } else if (outcomeIndex === 1) {
        // Buy NO: gain YES collateral, lose NO shares.
        marketState.yesReserve += netInvestment;
        marketState.noReserve = subtractWithFloor(marketState.noReserve, outcomeTokensBought);
      } else {
        log?.warn?.({ outcomeIndex, marketId }, 'Unsupported outcome index for FPMMBuy event');
      }

      const priceAfter = computeYesPriceScaled(marketState.yesReserve, marketState.noReserve);
      const amountInStr = formatFixed(investmentAmount, 18);
      const amountOutStr = formatFixed(outcomeTokensBought, 18);
      const priceStr = formatFixed(priceAfter, 18);
      const feeStr = formatFixed(feeAmount, 18);

      await insertTrade(prisma, {
        marketId,
        fpmmAddress,
        txHash,
        logIndex,
        blockNumber: Number(blockNumber),
        timestamp,
        side: 'buy',
        outcome: outcomeIndex,
        amountInUSDF: amountInStr,
        price: execPriceStr,
        amountOutShares: amountOutStr,
        feeUSDF: feeAmount > 0n ? feeStr : null,
      });

      await upsertCandle(prisma, {
        marketId,
        fpmmAddress,
        bucketStart: truncateTo5m(timestamp),
        // Candles track spot (priceStr already reflects priceAfter)
        price: priceStr,
        volumeUSDF: amountInStr,
      });

      broadcastTrade = {
        marketId,
        fpmmAddress,
        txHash,
        outcome: outcomeIndex,
        side: 'buy',
        price: execPriceStr,
        amountInUSDF: amountInStr,
        amountOutShares: amountOutStr,
        feeUSDF: feeAmount > 0n ? feeStr : null,
        timestamp: timestamp.toISOString(),
        blockNumber: Number(blockNumber),
        logIndex,
      };
      break;
    }
    case 'FPMMSell': {
      const returnAmount = BigInt(args?.returnAmount ?? 0n);
      const feeAmount = BigInt(args?.feeAmount ?? 0n);
      const outcomeIndex = Number(args?.outcomeIndex ?? 0);
      const outcomeTokensSold = BigInt(args?.outcomeTokensSold ?? 0n);
      const returnAmountPlusFees = returnAmount + feeAmount;
      const execPriceStr = outcomeTokensSold > 0n ? formatFixed((returnAmount * SCALE_18) / outcomeTokensSold, 18) : '0';

      if (outcomeIndex === 0) {
        // Sell YES: receive YES shares, pay USDF from NO side.
        marketState.yesReserve += outcomeTokensSold;
        marketState.noReserve = subtractWithFloor(marketState.noReserve, returnAmountPlusFees);
      } else if (outcomeIndex === 1) {
        // Sell NO: receive NO shares, pay USDF from YES side.
        marketState.noReserve += outcomeTokensSold;
        marketState.yesReserve = subtractWithFloor(marketState.yesReserve, returnAmountPlusFees);
      } else {
        log?.warn?.({ outcomeIndex, marketId }, 'Unsupported outcome index for FPMMSell event');
      }

      const priceAfter = computeYesPriceScaled(marketState.yesReserve, marketState.noReserve);
      const amountInStr = formatFixed(returnAmount, 18);
      const amountOutStr = formatFixed(outcomeTokensSold, 18);
      const priceStr = formatFixed(priceAfter, 18);
      const feeStr = formatFixed(feeAmount, 18);

      await insertTrade(prisma, {
        marketId,
        fpmmAddress,
        txHash,
        logIndex,
        blockNumber: Number(blockNumber),
        timestamp,
        side: 'sell',
        outcome: outcomeIndex,
        amountInUSDF: amountInStr,
        price: execPriceStr,
        amountOutShares: amountOutStr,
        feeUSDF: feeAmount > 0n ? feeStr : null,
      });

      await upsertCandle(prisma, {
        marketId,
        fpmmAddress,
        bucketStart: truncateTo5m(timestamp),
        price: priceStr,
        volumeUSDF: amountInStr,
      });

      broadcastTrade = {
        marketId,
        fpmmAddress,
        txHash,
        outcome: outcomeIndex,
        side: 'sell',
        price: execPriceStr,
        amountInUSDF: amountInStr,
        amountOutShares: amountOutStr,
        feeUSDF: feeAmount > 0n ? feeStr : null,
        timestamp: timestamp.toISOString(),
        blockNumber: Number(blockNumber),
        logIndex,
      };
      break;
    }
    default:
      return null;
  }

  const priceAfter = computeYesPriceScaled(marketState.yesReserve, marketState.noReserve);
  if (eventName === 'FPMMFundingAdded' || eventName === 'FPMMFundingRemoved') {
    await upsertCandle(prisma, {
      marketId,
      fpmmAddress,
      bucketStart: truncateTo5m(timestamp),
      price: formatFixed(priceAfter, 18),
      volumeUSDF: '0',
    });
  }

  marketState.lastProcessedBlock = blockNumber;
  marketState.lastProcessedLogIndex = logIndex;
  marketState.hasLiquidity = marketState.yesReserve > 0n || marketState.noReserve > 0n;

  return broadcastTrade;
}

async function ensureMarketState(prisma: PrismaClient, fpmmAddress: string, log?: any): Promise<MarketState | null> {
  const normalized = fpmmAddress.toLowerCase();
  const existing = marketStateByAddress.get(normalized);
  if (existing) {
    return existing;
  }

  const market = await prisma.market.findFirst({
    where: { fpmmAddress: { equals: normalized, mode: 'insensitive' } },
    select: { id: true, fpmmAddress: true, conditionId: true, outcomes: true },
  });

  if (!market || !market.fpmmAddress) {
    return null;
  }

  if (market.conditionId) {
    addPositionMarket(market.conditionId as Hex, market.id);
  }

  const fpmmAddressHex = market.fpmmAddress as `0x${string}`;

  let yesReserve = 0n;
  let noReserve = 0n;
  let lastProcessedBlock = 0n;
  let lastProcessedLogIndex = -1;
  let collateralToken: Address | null = null;
  let fee = 0n;
  const outcomeCount = Array.isArray(market.outcomes) && market.outcomes.length > 0
    ? Math.min(market.outcomes.length, 2)
    : 2;
  let positionIds: bigint[] = [];

  const fpmmContract = getFPMMContract(market.fpmmAddress);

  if (fpmmContract) {
    try {
      collateralToken = await publicClient.readContract({
        address: fpmmContract.address,
        abi: fpmmContract.abi,
        functionName: 'collateralToken',
        args: [],
      }) as Address;
    } catch (err) {
      log?.warn?.({ err, fpmmAddress: normalized }, 'Failed to read FPMM collateral token');
    }

    try {
      fee = await publicClient.readContract({
        address: fpmmContract.address,
        abi: fpmmContract.abi,
        functionName: 'fee',
        args: [],
      }) as bigint;
    } catch (err) {
      log?.warn?.({ err, fpmmAddress: normalized }, 'Failed to read FPMM fee');
    }
  }

  if (!collateralToken && ENV.USDF_ADDRESS) {
    collateralToken = ENV.USDF_ADDRESS as Address;
  }

  if (market.conditionId && collateralToken) {
    const outcomesToFetch = outcomeCount;
    try {
      const ids = await Promise.all(
        Array.from({ length: outcomesToFetch }, (_, idx) =>
          resolvePositionId(market.conditionId as Hex, idx, collateralToken as Address)
        )
      );
      positionIds = ids;
    } catch (err) {
      log?.warn?.({ err, fpmmAddress: normalized }, 'Failed to resolve position IDs');
      positionIds = [];
    }
  }

  try {
    const latest = await prisma.$queryRaw<Array<{
      yes_reserves: Prisma.Decimal;
      no_reserves: Prisma.Decimal;
      block_number: number;
      log_index: number;
    }>>(Prisma.sql`
      SELECT yes_reserves, no_reserves, block_number, log_index
      FROM public.liquidity_events
      WHERE market_id = ${market.id}
        AND fpmm_address = ${hexToBuffer(market.fpmmAddress)}
      ORDER BY block_number DESC, log_index DESC
      LIMIT 1
    `);

    if (latest.length > 0) {
      const row = latest[0];
      yesReserve = parseFixed(row.yes_reserves.toString(), 18);
      noReserve = parseFixed(row.no_reserves.toString(), 18);
      lastProcessedBlock = BigInt(row.block_number);
      lastProcessedLogIndex = row.log_index;
    } else if (positionIds.length >= 2) {
      const ctf = getCTFContract();
      if (ctf) {
        try {
          const owners = positionIds.map(() => fpmmAddressHex);
          const balances = await publicClient.readContract({
            address: ctf.address,
            abi: ctf.abi,
            functionName: 'balanceOfBatch',
            args: [owners, positionIds],
          }) as readonly bigint[];
          if (balances.length >= 2) {
            yesReserve = balances[0];
            noReserve = balances[1];
          }
        } catch (err) {
          log?.warn?.({ err, fpmmAddress: normalized }, 'Failed to fetch on-chain reserves');
        }
      }
    }
  } catch (err) {
    log?.warn?.({ err, fpmmAddress: normalized }, 'Failed to load latest liquidity state');
  }

  const stateEntry: MarketState = {
    marketId: market.id,
    fpmmAddress: market.fpmmAddress as `0x${string}`,
    conditionId: market.conditionId as Hex | null,
    collateralToken,
    outcomeCount,
    positionIds,
    fee,
    yesReserve,
    noReserve,
    lastProcessedBlock,
    lastProcessedLogIndex,
    hasLiquidity: yesReserve > 0n || noReserve > 0n,
  };

  marketStateByAddress.set(normalized, stateEntry);
  return stateEntry;
}

export async function startReconciliationWorker(prisma: PrismaClient, log: any, redis?: Redis) {
  if (!ENV.CTF_ADDRESS) {
    log.warn('Reconciliation: CTF not configured; conditional token events will be skipped');
  }

  redisPublisher = redis ?? null;

  await waitForDependency('postgres', () => prisma.$queryRaw`SELECT 1`, log, 10, 2000);
  if (redisPublisher) {
    await waitForDependency('redis', () => redisPublisher!.ping(), log, 10, 2000);
  }

  try {
    await hydrateFromDb(prisma, log);
    await seedPositionBalancesFromPositions(prisma, log);
  } catch (err) {
    log?.error?.({ err }, 'positionIndex hydrate failed');
  }

  state.confirmations = RECON_CONFIRMATIONS;
  state.batchSize = RECON_BLOCKS_PER_SCAN;

  let cachedHead: bigint | null = null;
  const getCurrentHead = async () => {
    if (cachedHead === null) {
      cachedHead = await publicClient.getBlockNumber();
    }
    return cachedHead;
  };

  const computeStartingBlock = async () => {
    const head = await getCurrentHead();
    if (!RECON_BACKFILL_ENABLED) {
      return head;
    }
    return head > BigInt(RECON_BLOCKS_PER_SCAN)
      ? head - BigInt(RECON_BLOCKS_PER_SCAN)
      : 0n;
  };

  try {
    const kv = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT value FROM system_kv WHERE key = 'lastIndexedBlock' LIMIT 1
    ` as any[];

    if (kv.length > 0) {
      state.lastIndexedBlock = BigInt(kv[0].value);
    } else {
      state.lastIndexedBlock = await computeStartingBlock();
    }
  } catch {
    state.lastIndexedBlock = await computeStartingBlock();
  }

  {
    const initialHead = await getCurrentHead();
    const confirmations = BigInt(state.confirmations);
    state.latestHead = initialHead > confirmations ? initialHead - confirmations : 0n;
  }

  const head = state.latestHead;
  const jumpThreshold = BigInt(RECON_JUMP_THRESHOLD <= 0 ? 0 : RECON_JUMP_THRESHOLD);
  const lag = head > state.lastIndexedBlock ? head - state.lastIndexedBlock : 0n;
  if (lag > jumpThreshold) {
    const target = head > 2n ? head - 2n : 0n;
    const previous = state.lastIndexedBlock;
    state.lastIndexedBlock = target;
    try {
      await prisma.$executeRaw`
        INSERT INTO system_kv (key, value)
        VALUES ('lastIndexedBlock', ${target.toString()})
        ON CONFLICT (key) DO UPDATE SET value = ${target.toString()}
      `;
      log.warn({
        previous: previous.toString(),
        target: target.toString(),
        head: head.toString(),
        lag: lag.toString(),
      }, 'Recon jump-to-head applied');
    } catch (err) {
      log.error({ err }, 'Failed to persist jump-to-head lastIndexedBlock');
    }
  }

  state.usingWs = false;

  log.info({
    chainId: ENV.CHAIN_ID,
    lastIndexedBlock: state.lastIndexedBlock.toString(),
    contracts: {
      ctf: ENV.CTF_ADDRESS || null,
      exchange: process.env.EXCHANGE_ADDRESS || null,
      marketFactory: ENV.MARKET_FACTORY_ADDRESS || null,
      usdf: ENV.USDF_ADDRESS || null,
    },
    recon: {
      confirmations: state.confirmations,
      batchSize: state.batchSize,
      usingWs: state.usingWs,
    },
  }, 'Reconciliation worker starting');

  runReconCycle(prisma, log);
  setInterval(() => runReconCycle(prisma, log), RECON_INTERVAL_MS);
}

async function runReconCycle(prisma: PrismaClient, log: any) {
  if (state.isRunning) {
    log.debug('Recon cycle already running, skipping');
    return;
  }

  state.isRunning = true;
  const startTime = Date.now();
  state.lastRunAt = startTime;
  state.usingWs = false;

  try {
    const chainHead = await publicClient.getBlockNumber();
    const confirmations = BigInt(state.confirmations);
    const safeHead = chainHead > confirmations ? chainHead - confirmations : 0n;

    const fpmmMarkets = await prisma.market.findMany({
      where: { fpmmAddress: { not: null } },
      select: { fpmmAddress: true },
    });

    const uniqueFpmm = Array.from(
      new Set(fpmmMarkets.map((m) => m.fpmmAddress?.toLowerCase()).filter(Boolean))
    ) as string[];

    lastKnownFpmmCount = uniqueFpmm.length;
    state.latestHead = safeHead;

    if (RECON_ONLY_KNOWN_FPMM && uniqueFpmm.length === 0) {
      log.debug('Recon: no fpmm-addressed markets; skipping cycle');
      state.idle = true;
      state.idleReason = 'no_fpmm_markets';
      const previousIndexed = state.lastIndexedBlock;
      state.lastIndexedBlock = safeHead;
      state.lastDurationMs = Date.now() - startTime;
      state.lastError = null;
      state.isRunning = false;
      if (previousIndexed !== safeHead) {
        try {
          await prisma.$executeRaw`
            INSERT INTO system_kv (key, value)
            VALUES ('lastIndexedBlock', ${safeHead.toString()})
            ON CONFLICT (key) DO UPDATE SET value = ${safeHead.toString()}
          `;
        } catch (err) {
          log.debug({ err }, 'Recon idle persist failed (expected if system_kv missing)');
        }
      }
      return;
    }

    state.idle = false;
    state.idleReason = null;

    let maxRange = BigInt(state.batchSize);
    if (maxRange <= 0n) {
      maxRange = 400n;
    }

    const ctf = getCTFContract();

    let cursor = state.lastIndexedBlock;
    let windowsProcessed = 0;
    let totalEvents = 0;

    while (cursor < safeHead) {
      const fromBlock = cursor + 1n;
      let toBlock = fromBlock + maxRange - 1n;
      if (toBlock > safeHead) {
        toBlock = safeHead;
      }

      const windowStart = Date.now();

      const filters: Array<{
        name: string;
        address: Address | Address[];
        abi?: any;
        topics?: Hex[];
        fpmmAddresses?: string[];
        fpmmAddressSet?: Set<string>;
      }> = [];

      const FPMM_CHUNK_SIZE = 40;
      for (let i = 0; i < uniqueFpmm.length; i += FPMM_CHUNK_SIZE) {
        const chunk = uniqueFpmm.slice(i, i + FPMM_CHUNK_SIZE);
        if (chunk.length === 0) {
          continue;
        }
        filters.push({
          name: `FPMM(${chunk.length})`,
          address: chunk.map((addr) => addr as Address),
          abi: FPMMABI,
          topics: FPMM_EVENT_TOPICS.length ? FPMM_EVENT_TOPICS : undefined,
          fpmmAddresses: chunk,
          fpmmAddressSet: new Set(chunk),
        });
      }

      if (ctf) {
        const ctfTopics = ['TransferSingle', 'TransferBatch']
          .map(eventName => encodeEventTopics({
            abi: ERC1155_EVENTS_ABI as any,
            eventName: eventName as any,
          })?.[0])
          .filter(Boolean) as Hex[];

        if (ctfTopics.length > 0) {
          filters.push({
            name: 'CTF',
            address: ctf.address,
            abi: ERC1155_EVENTS_ABI,
            topics: ctfTopics,
          });
        }
      }

      if (ENV.USDF_ADDRESS) {
        const transferTopic = encodeEventTopics({
          abi: ERC20_TRANSFER_ABI as any,
          eventName: 'Transfer',
        })?.[0];

        filters.push({
          name: 'USDF',
          address: ENV.USDF_ADDRESS as Address,
          abi: ERC20_TRANSFER_ABI,
          topics: transferTopic ? [transferTopic] : undefined,
        });
      }

      const results = await Promise.all(filters.map(async (filter) => {
        try {
          const params: any = {
            address: filter.address,
            fromBlock,
            toBlock,
          };
          if (filter.topics && filter.topics.length) {
            params.topics = [filter.topics];
          }
          const logs = await publicClient.getLogs(params);
          return { filter, logs };
        } catch (err) {
          log.warn({ err }, `Failed to fetch logs for ${filter.name}`);
          return { filter, logs: [] as any[] };
        }
      }));

      let eventsProcessed = 0;
      let positionEventsProcessed = 0;
      const fpmmEvents: Array<{
        decoded: any;
        logEntry: any;
        fpmmAddress: string;
        marketState: MarketState;
      }> = [];

      for (const { filter, logs: contractLogs } of results) {
        for (const logEntry of contractLogs) {
          try {
            if (!filter.abi) {
              continue;
            }

            const decoded = decodeEventLog({
              abi: filter.abi as any,
              data: logEntry.data,
              topics: logEntry.topics as [Hex, ...Hex[]],
              strict: false,
            }) as any;

            eventsProcessed++;

            if (ENABLE_INDEXER && filter.name === 'CTF') {
              positionEventsProcessed += await handleCtfTransferEvent(prisma, decoded, logEntry, log);
              continue;
            }

            if (filter.fpmmAddressSet) {
              const logAddr = typeof logEntry.address === 'string' ? logEntry.address.toLowerCase() : '';
              if (!filter.fpmmAddressSet.has(logAddr)) {
                continue;
              }
              const marketState = await ensureMarketState(prisma, logAddr, log);
              if (!marketState) {
                log.warn({ address: logAddr }, 'Skipping FPMM event for unknown market');
                continue;
              }

              fpmmEvents.push({
                decoded,
                logEntry,
                fpmmAddress: logAddr,
                marketState,
              });
            } else {
              log.debug({
                event: decoded?.eventName,
                txHash: logEntry.transactionHash,
                logIndex: logEntry.logIndex,
                address: filter.address,
              }, `${filter.name} event`);
            }
          } catch (decodeErr) {
            log.debug({ decodeErr }, `Failed to decode ${filter.name} event`);
          }
        }
      }

      fpmmEvents.sort((a, b) => {
        const blockA = BigInt(a.logEntry.blockNumber ?? 0n);
        const blockB = BigInt(b.logEntry.blockNumber ?? 0n);
        if (blockA !== blockB) {
          return blockA < blockB ? -1 : 1;
        }
        const indexA = Number(a.logEntry.logIndex ?? 0);
        const indexB = Number(b.logEntry.logIndex ?? 0);
        return indexA - indexB;
      });

      const tradeBroadcasts: ProcessedTrade[] = [];

      for (const eventInfo of fpmmEvents) {
        const blockNumber = BigInt(eventInfo.logEntry.blockNumber ?? 0n);
        const timestamp = await getBlockTimestamp(blockNumber);
        const trade = await handleFpmmEvent(
          prisma,
          eventInfo.marketState,
          eventInfo.decoded,
          eventInfo.logEntry,
          timestamp,
          log
        );

        if (trade) {
          tradeBroadcasts.push(trade);
        }

        lastBackfillByAddress.set(eventInfo.fpmmAddress, blockNumber);
        state.lastEventAt = Date.now();
      }

      if (tradeBroadcasts.length > 0 && redisPublisher) {
        try {
          await Promise.all(
            tradeBroadcasts.map((trade) =>
              redisPublisher!.publish(
                `market:${trade.marketId}:trades`,
                JSON.stringify(trade)
              )
            )
          );
        } catch (err) {
          log.warn({ err }, 'Failed to publish trade updates');
        }
      }

      cursor = toBlock;
      state.lastIndexedBlock = cursor;
      totalEvents += eventsProcessed;
      windowsProcessed += 1;

      if (positionEventsProcessed > 0) {
        try {
          await prisma.$executeRaw(Prisma.sql`
            UPDATE public.recon_state
            SET position_last_block = GREATEST(position_last_block, ${Number(toBlock)}),
                updated_at = NOW()
            WHERE id = TRUE;
          `);
        } catch (err) {
          log.debug({ err }, 'position_balances.cursor_update_failed');
        }
      }

      try {
        await prisma.$executeRaw`
          INSERT INTO system_kv (key, value)
          VALUES ('lastIndexedBlock', ${cursor.toString()})
          ON CONFLICT (key) DO UPDATE SET value = ${cursor.toString()}
        `;
      } catch (err) {
        log.warn({ err }, 'Could not persist lastIndexedBlock (system_kv missing?)');
      }

      log.info({
        from: fromBlock.toString(),
        to: toBlock.toString(),
        eventsProcessed,
        positionEvents: positionEventsProcessed,
        durationMs: Date.now() - windowStart,
        safeHead: safeHead.toString(),
      }, 'Recon window complete');

      if (cursor >= safeHead) {
        break;
      }
    }

    if (cursor < safeHead) {
      // No work happened (e.g., cursor already past safe head)
      const previousIndexed = state.lastIndexedBlock;
      state.lastIndexedBlock = safeHead;
      if (previousIndexed !== safeHead) {
        try {
          await prisma.$executeRaw`
            INSERT INTO system_kv (key, value)
            VALUES ('lastIndexedBlock', ${safeHead.toString()})
            ON CONFLICT (key) DO UPDATE SET value = ${safeHead.toString()}
          `;
        } catch (err) {
          log.debug({ err }, 'Recon cursor persist skipped (system_kv missing?)');
        }
      }
    }

    state.lastDurationMs = Date.now() - startTime;
    state.lastError = null;

    log.info({
      windowsProcessed,
      eventsProcessed: totalEvents,
      latestCursor: state.lastIndexedBlock.toString(),
      safeHead: safeHead.toString(),
      durationMs: state.lastDurationMs,
    }, 'Recon cycle complete');
  } catch (error: any) {
    state.lastError = error?.message || 'Unknown error';
    state.idle = false;
    state.idleReason = null;
    log.error({ error }, 'Recon cycle failed');
  } finally {
    state.isRunning = false;
  }
}

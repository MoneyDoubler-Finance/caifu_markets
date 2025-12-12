export interface MarketOutcome {
  name: string
  price: number
  change24h: number
}

export interface Market {
  id: string
  slug?: string | null
  conditionId?: `0x${string}` | null
  fpmmAddress?: `0x${string}` | null
  title: string
  description: string
  category: string
  outcomes: MarketOutcome[]
  endDate: Date
  totalVolume: string
  liquidity: string
  createdBy: string
  status: 'active' | 'resolved' | 'cancelled'
  imageUrl?: string
  heroImageUrl?: string | null
  tags?: string[]
}

export interface MarketOutcomeData {
  id: string
  marketId: string
  name: string
  currentPrice: number
  totalShares: string
  volume24h: string
}

export interface Position {
  id: string
  marketId: string
  outcome: string
  shares: string
  avgPrice: number
  totalCost: string
  currentValue: string
  pnl: string
}

export interface Trade {
  id: string
  marketId: string
  outcome: string
  type: 'buy' | 'sell'
  shares: string
  price: number
  timestamp: Date
  txHash?: string
}

export interface User {
  address: string
  ens?: string
  balance: string
  totalPnL: string
  positions: Position[]
  trades: Trade[]
}

export type SiteUser = {
  id: string
  walletAddress: string
  displayName: string | null
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

export type MarketCommentUser = {
  id: string
  walletAddress: string
  displayName: string | null
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

export type MarketComment = {
  id: string
  marketId: string
  userId: string
  body: string
  txHash?: string | null
  parentId?: string | null
  createdAt: string
  updatedAt: string
  edited: boolean
  user: MarketCommentUser
}

export type PortfolioPosition = {
  marketId: string
  title: string
  slug?: string | null
  conditionId: `0x${string}`
  yesBalance: string
  noBalance: string
  yesPositionId?: string
  noPositionId?: string
}

export type PortfolioSnapshot = {
  owner: string
  bnbBalance: string
  usdfBalance: string
  positions: PortfolioPosition[]
}

export interface MarketData {
  prices: Array<{
    timestamp: number
    price: number
  }>
  volume: Array<{
    timestamp: number
    volume: number
  }>
}

export type TimeFilter = '1H' | '24H' | '7D' | '30D' | 'ALL'

export type SortOption = 'volume' | 'newest' | 'ending-soon' | 'price'

export interface FilterOptions {
  category?: string
  status?: Market['status']
  minLiquidity?: number
  maxLiquidity?: number
  tags?: string[]
}

export type TileBackground = {
  id: string
  tag: string
  normalizedTag: string
  imageUrl: string
  createdAt: string
  updatedAt: string
}

export type MarketMetrics = {
  marketId: string
  fpmmAddress: `0x${string}`
  spot: null | {
    price: string
    yesReserves: string
    noReserves: string
    tvlUSDF: string
    updatedAt: string | null
  }
  volume24hUSDF: string
  tvlUSDF?: string
  lastTradeAt: string | null
}

export type Candle = {
  t: string
  o: string
  h: string
  l: string
  c: string
  vUSDF: string
}

export type TradeEvent = {
  type?: 'trade'
  ts: string
  side: 'buy' | 'sell'
  outcome: 0 | 1
  price: string
  amountUSDF: string
  txHash?: string
  blockNumber?: number
  logIndex?: number
  amountOutShares?: string
  feeUSDF?: string | null
}

export type IndexedEvent = {
  type: 'indexed'
  marketId: string
  lastIndexedBlock: number
  headBlock: number | null
  lagBlocks: number
  emittedAt: string
}

export type CommentEvent = {
  type: 'comment'
  comment: MarketComment
}

export type SummaryTrade = {
  txHash?: string | null
  logIndex: number
  blockNumber: number
  timestamp: string
  side: string
  outcome: number
  amountInUSDF: string
  price: string
  amountOutShares: string
  feeUSDF: string | null
}

export type SummaryMarketPayload = {
  id: string
  conditionId?: string | null
  fpmmAddress?: string | null
  title?: string | null
  description?: string | null
  category?: string | null
  outcomes?: string[]
  status?: string | null
  createdAt?: string | null
  expiresAt?: string | null
  resolvedAt?: string | null
  resolutionData?: unknown
  creator?: string | null
  tags?: string[] | null
  slug?: string | null
  heroImageUrl?: string | null
}

export type MarketSummary = {
  market: SummaryMarketPayload
  metrics: MarketMetrics
  candles: Candle[]
  spotSeries?: Array<{ t: string; p: string }>
  trades: SummaryTrade[]
  cache: {
    lastIndexedBlock: number
    generatedAt: string
  }
}

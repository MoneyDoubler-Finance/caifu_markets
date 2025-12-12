import { API_BASE } from '@/lib/apiBase'

export const CATEGORIES = [
  'Politics',
  'Sports',
  'Crypto',
  'Economics',
  'Technology',
  'Entertainment',
  'Science',
  'Weather',
  'Other'
] as const

export const POPULAR_TAGS = [
  'US Election',
  'Bitcoin',
  'Ethereum',
  'NFL',
  'NBA',
  'Federal Reserve',
  'AI',
  'Climate',
  'COVID-19',
  'Space'
] as const

export const SUPPORTED_CHAINS = {
  1: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
  },
  137: {
    name: 'Polygon',
    symbol: 'MATIC',
    decimals: 18,
  },
  42161: {
    name: 'Arbitrum',
    symbol: 'ARB',
    decimals: 18,
  }
} as const

export const CONTRACT_ADDRESSES = {
  // These would be actual deployed contract addresses
  MARKET_FACTORY: '0x0000000000000000000000000000000000000000',
  CONDITIONAL_TOKENS: '0x0000000000000000000000000000000000000000',
  USDC: '0xA0b86a33E6441e00E4A5e0E5A2E2E8F0e3E2F5E2'
} as const

export const API_ENDPOINTS = {
  MARKETS: `${API_BASE}/api/markets`,
  TRADES: `${API_BASE}/api/trades`,
  PORTFOLIO: `${API_BASE}/api/portfolio`,
  PRICES: `${API_BASE}/api/prices`
} as const

export const CHART_COLORS = {
  PRIMARY: '#3B82F6',
  SUCCESS: '#10B981',
  DANGER: '#EF4444',
  WARNING: '#FFCD00',
  PURPLE: '#8B5CF6',
  GRAY: '#6B7280'
} as const

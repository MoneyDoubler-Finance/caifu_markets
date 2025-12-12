/**
 * Centralized environment variable access
 * This module provides normalized accessors for RPC URLs without modifying existing env vars
 */

const USE_CTF = Number(process.env.USE_CTF || 0);
const CTF_ADDRESS = process.env.CTF_ADDRESS || '';

const asOptional = (value?: string | null): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const PRIMARY_HTTP_RPC =
  asOptional(process.env.RPC_HTTP_URL) ??
  asOptional(process.env.RPC_URL) ??
  asOptional(process.env.BSC_RPC_URL) ??
  'https://bsc-testnet.publicnode.com';

const BACKUP_HTTP_RPC =
  asOptional(process.env.RPC_HTTP_URL_BACKUP) ??
  asOptional(process.env.RPC_HTTP_FALLBACK_URL) ??
  asOptional(process.env.RPC_FALLBACK_URL);

const WS_RPC =
  asOptional(process.env.RPC_WS_URL) ??
  asOptional(process.env.BSC_WS_URL) ??
  '';

const ALCHEMY_WS = asOptional(process.env.ALCHEMY_WS_URL);

const SUBGRAPH_URL = process.env.SUBGRAPH_URL || ''
const ENABLE_INDEXER = Number(process.env.ENABLE_INDEXER ?? 0) === 1

if (USE_CTF === 1 && !CTF_ADDRESS) {
  console.error('ERROR: CTF_ADDRESS is required when USE_CTF=1');
  process.exit(1);
}
export const ENV = {
  CHAIN_ID: Number(process.env.CHAIN_ID ?? 97),
  RPC_HTTP_URL: PRIMARY_HTTP_RPC,
  RPC_HTTP_FALLBACK_URL: BACKUP_HTTP_RPC ?? PRIMARY_HTTP_RPC,
  RPC_WS_URL: WS_RPC,
  ALCHEMY_WS_URL: ALCHEMY_WS,
  
  // Contract addresses
  CTF_ADDRESS,
  MARKET_FACTORY_ADDRESS: process.env.MARKET_FACTORY_ADDRESS || '',
  USDF_ADDRESS: process.env.USDF_ADDRESS || '',
  DIRECT_ORACLE_ADDRESS: process.env.DIRECT_ORACLE_ADDRESS || '',
  ORACLE_ADAPTER_ADDRESS: process.env.ORACLE_ADAPTER_ADDRESS || '',
  FPMM_DEFAULT_FEE: process.env.FPMM_DEFAULT_FEE || '',

  // Feature flags
  USE_CTF,

  // Data sources
  ENABLE_INDEXER,
  SUBGRAPH_URL,
};

// Re-export for convenience
export default ENV;

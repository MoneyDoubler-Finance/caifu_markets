export type ChainConfig = {
  id: number
  name: string
  rpcUrl: string
  blockExplorer: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
}

export type Environment = {
  // Chain configuration
  CHAIN_ID: number
  RPC_URL: string

  // Contract addresses
  CTF_ADDRESS: string
  EXCHANGE_ADDRESS: string
  MARKET_FACTORY_ADDRESS: string
  USDF_ADDRESS: string
  DIRECT_ORACLE_ADDRESS: string
  ORACLE_ADAPTER_ADDRESS: string

  // Database
  DATABASE_URL: string

  // Redis
  REDIS_URL: string

  // API configuration
  PORT: number
  HOST: string
  CORS_ORIGIN: string

  // Authentication
  ADMIN_JWT_SECRET: string

  // Exchange configuration
  EXCHANGE_FEE_BPS: number

  // Deployment
  DEPLOYER_PRIVATE_KEY: string

  // Optional configurations
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug'
  NODE_ENV: 'development' | 'test' | 'production'
  SUBGRAPH_URL?: string
  ENABLE_INDEXER?: number
}

import { z } from 'zod'
import { config } from 'dotenv'

// Load environment variables
config()

// Chain configurations
export const CHAINS = {
  BSC_MAINNET: {
    id: 56,
    name: 'BNB Smart Chain',
    rpcUrl: 'https://bsc-dataseed.binance.org/',
    blockExplorer: 'https://bscscan.com',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18
    }
  },
  BSC_TESTNET: {
    id: 97,
    name: 'BNB Smart Chain Testnet',
    rpcUrl: 'https://bsc-testnet.publicnode.com',
    blockExplorer: 'https://testnet.bscscan.com',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18
    }
  }
} as const

export type ChainId = keyof typeof CHAINS

// Environment schema
export const EnvironmentSchema = z.object({
  // Chain configuration
  CHAIN_ID: z.coerce.number().refine((id) => Object.values(CHAINS).some(chain => chain.id === id), {
    message: 'Invalid chain ID'
  }),
  RPC_URL: z.string().url(),

  // Contract addresses
  CTF_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  MARKET_FACTORY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  USDF_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  DIRECT_ORACLE_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  ORACLE_ADAPTER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // API configuration
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),

  // Authentication
  ADMIN_JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  ADMIN_PASSWORD: z.string().min(8, 'Admin password must be at least 8 characters'),

  // Exchange configuration
  EXCHANGE_FEE_BPS: z.coerce.number().min(0).max(10000).default(0),

  // Deployment
  DEPLOYER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key'),

  // Optional configurations
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  
  // Optional contract addresses
  SUBGRAPH_URL: z.string().url().optional(),
  ENABLE_INDEXER: z.coerce.number().min(0).max(1).default(0),
  
  // Feature flags
  USE_CTF: z.coerce.number().default(0),
})

export type Environment = z.infer<typeof EnvironmentSchema>

// Configuration class
export class Config {
  private static instance: Config
  private _env: Environment

  private constructor() {
    // Validate environment variables
    const result = EnvironmentSchema.safeParse(process.env)

    if (!result.success) {
      const errors = result.error.errors.map(err =>
        `${err.path.join('.')}: ${err.message}`
      ).join('\n')

      throw new Error(`Invalid environment configuration:\n${errors}`)
    }

    this._env = result.data
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config()
    }
    return Config.instance
  }

  public get env(): Environment {
    return this._env
  }

  public get chain() {
    return getChainConfig(this._env.CHAIN_ID)
  }

  public get contractAddresses() {
    return {
      conditionalTokens: this._env.CTF_ADDRESS,
      marketFactory: this._env.MARKET_FACTORY_ADDRESS,
      usdf: this._env.USDF_ADDRESS,
      directOracle: this._env.DIRECT_ORACLE_ADDRESS,
      oracleAdapter: this._env.ORACLE_ADAPTER_ADDRESS,
    }
  }

  public get subgraphUrl(): string | undefined {
    return (this._env as any).SUBGRAPH_URL
  }

  public get isProduction(): boolean {
    return this._env.NODE_ENV === 'production'
  }

  public get isTest(): boolean {
    return this._env.NODE_ENV === 'test'
  }

  public get isDevelopment(): boolean {
    return this._env.NODE_ENV === 'development'
  }
}

// Utility functions
export const getConfig = (): Config => {
  return Config.getInstance()
}

export const getChainConfig = (chainId: number) => {
  const chain = Object.values(CHAINS).find(c => c.id === chainId)
  if (!chain) {
    throw new Error(`Chain with ID ${chainId} not found`)
  }
  return chain
}

export const validateEnvironment = (): Environment => {
  return EnvironmentSchema.parse(process.env)
}

// Default configurations for different environments
export const DEFAULT_CONFIGS = {
  development: {
    CHAIN_ID: 97, // BSC testnet
    RPC_URL: 'https://bsc-testnet.publicnode.com',
    PORT: 3000,
    LOG_LEVEL: 'debug' as const,
    NODE_ENV: 'development' as const
  },
  test: {
    CHAIN_ID: 97,
    RPC_URL: 'https://bsc-testnet.publicnode.com',
    PORT: 3001,
    LOG_LEVEL: 'error' as const,
    NODE_ENV: 'test' as const
  },
  production: {
    CHAIN_ID: 56, // BSC mainnet
    RPC_URL: 'https://bsc-dataseed.binance.org/',
    PORT: 3000,
    LOG_LEVEL: 'info' as const,
    NODE_ENV: 'production' as const
  }
} as const

// Helper to merge configs
export const mergeConfig = <T extends Record<string, any>>(
  base: T,
  overrides: Partial<T>
): T => {
  return { ...base, ...overrides }
}

// Collateral configuration
export { COLLATERAL } from './collateral'

// Environment configuration
export { ENV } from './env'

// Contract ABI exports for convenience
export * from './abis'

// Re-export ChainConfig type for convenience
export type { ChainConfig } from './types'

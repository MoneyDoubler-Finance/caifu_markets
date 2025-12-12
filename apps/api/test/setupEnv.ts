import os from 'node:os'
import path from 'node:path'

// Minimal env required by @caifu/config validation
process.env.NODE_ENV = process.env.NODE_ENV || 'test'
process.env.CHAIN_ID = process.env.CHAIN_ID || '56'
process.env.RPC_URL = process.env.RPC_URL || 'https://bsc-dataseed.binance.org'
process.env.CTF_ADDRESS = process.env.CTF_ADDRESS || '0x289b9C58e0a0FD75e574E967E0c84eA2320084a5'
process.env.MARKET_FACTORY_ADDRESS = process.env.MARKET_FACTORY_ADDRESS || '0x5D5c33BD67e5065bd93339C717f27CD8C6770D63'
process.env.USDF_ADDRESS = process.env.USDF_ADDRESS || '0x6922e3A041870c87295E02d3814BA5871Ed38f58'
process.env.DIRECT_ORACLE_ADDRESS = process.env.DIRECT_ORACLE_ADDRESS || '0x0B40878a6b31eA07121a1e7691e011dC14287eFD'
process.env.ORACLE_ADAPTER_ADDRESS = process.env.ORACLE_ADAPTER_ADDRESS || '0xd77e3cE643877Af847b67Ec07bef0855520f5407'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/caifu'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
process.env.PORT = process.env.PORT || '3000'
process.env.HOST = process.env.HOST || '0.0.0.0'
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000'
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'x'.repeat(32)
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpassword'
process.env.EXCHANGE_FEE_BPS = process.env.EXCHANGE_FEE_BPS || '0'
process.env.DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || `0x${'1'.repeat(64)}`
process.env.USE_CTF = process.env.USE_CTF || '1'

// Image safety credentials are mocked in tests; keep path deterministic
process.env.CAIFU_UPLOADS_ROOT = process.env.CAIFU_UPLOADS_ROOT || path.join(os.tmpdir(), 'caifu-test-uploads')

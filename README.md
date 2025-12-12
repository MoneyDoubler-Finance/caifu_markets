# Caifu Markets

A Polymarket-inspired prediction market platform now running on **BNB Smart Chain Mainnet (chainId 56)** using Fixed Product Market Makers (FPMM) for automated trading.

**Live Deployment (example placeholders):**
- **Frontend**: https://www.example.com
- **API**: https://api.example.com
- **Network**: BSC Mainnet (Chain ID 56)
- **Collateral**: USDF (USDF_Mainnet vending machine, USDT-backed)
  - Mainnet USDF_Mainnet: `0x6922e3A041870c87295E02d3814BA5871Ed38f58`
  - Mainnet USDT: `0x55d398326f99059fF775485246999027B3197955`
  - Legacy testnet USDF_Mainnet (dev only): `0x7783a39E07a990284b87f3f01c2B52dE42147cd2`

## 🚦 Mainnet status (Dec 1, 2025)
We reached a stable "Gold" build on testnet and have now fully **cut over to BSC mainnet (56)**:
- Frontend/API builds are green and wired to mainnet addresses.
- Spot charts and tiles are pinned to on-chain FPMM reserves via a single pool‑reserves→spot‑point→summary pipeline.
- **Spot-point recording is trade-triggered only** (via SSE `onTrade` → `recordSpotPointFromChain()`), preventing DB flooding from polling.
- **TDZ ordering fixed** in `MarketPageClient.tsx` — contract address declarations moved before callbacks that use them.
- Swap (USDT ↔ USDF) and Create Market flows are both operating against the mainnet contracts.

Current mainnet contracts:
- **USDF_Mainnet (USDF)**: `0x6922e3A041870c87295E02d3814BA5871Ed38f58`
- **ConditionalTokens**: `0x289b9C58e0a0FD75e574E967E0c84eA2320084a5`
- **DirectCTFOracle**: `0x0B40878a6b31eA07121a1e7691e011dC14287eFD`
- **DirectOracleAdapter**: `0xd77e3cE643877Af847b67Ec07bef0855520f5407`
- **FixedProductMarketMakerFactory**: `0x5D5c33BD67e5065bd93339C717f27CD8C6770D63` (default fee 2%)

These are mirrored in:
- `packages/config/addresses.56.json`
- `contracts-hardhat/deployments/56.json`
- `.env`, `ops/.env`, `apps/api/.env`
- Vercel env: `NEXT_PUBLIC_USDF_ADDRESS`, `NEXT_PUBLIC_USDT_ADDRESS`, `NEXT_PUBLIC_CTF_ADDRESS`, `NEXT_PUBLIC_DIRECT_ORACLE_ADDRESS`, `NEXT_PUBLIC_ADAPTER_ADDRESS`, `NEXT_PUBLIC_MARKET_FACTORY_ADDRESS`

## 🎯 What is Caifu?

Caifu is a full-stack prediction market where users can:
- **Trade** binary outcome markets using automated market makers (FPMM)
- **Deposit** test BNB and mint USDF collateral via on-chain onramp
- **Chat** in real-time on market discussion threads
- **Track** live trades, price charts, volume, and TVL
- **Redeem** winnings when markets resolve

All trading happens **on-chain** via FPMM smart contracts. No orderbook, no off-chain matching.

## 🏗️ Architecture

### Tech Stack

**Frontend:**
- Next.js 16 (App Router)
- WalletConnect v2 for wallet connection
- viem for on-chain interactions
- Real-time SSE streams for live data
- Wagmi v2 hooks wired to `TARGET_CHAIN_ID`
- Market UI shows **Pool Reserves (on-chain)** from the FPMM, and a draggable **Your wallet** panel (undock/dock). No user reindex buttons; trading is not blocked by stale metrics if the pool is initialized on-chain.
- **Homepage components:**
  - `LiveMarketRibbon`: Scrolling ticker below navbar with live market prices
  - `CaifuPicksCarousel`: Team-curated market carousel with large cards (320x340px), sparkline charts, and Yes/No prices. Continuous smooth scroll via `requestAnimationFrame`.
  - `MarketSearch`: Debounced search bar with dropdown results
- API access (SSR + client) must go through the shared helpers in `frontend/src/lib/api.ts` or `frontend/src/lib/dataSource.ts` so every request uses the canonical base URL (`NEXT_PUBLIC_API_BASE_URL`). The repo blocks relative `fetch('/api/...')` in server components via `scripts/policy-check.sh`.

- **Backend:**
  - Fastify REST + SSE API
  - PostgreSQL (market data, trades, candles, comments)
  - Redis (pub/sub for real-time streams)
  - Event indexer (on-demand) with **Alchemy BSC testnet HTTP+Smart WS** as primary RPC and a webhook at `/api/webhooks/alchemy` (auth via `ALCHEMY_WEBHOOK_TOKEN` in env). Publicnode is fallback HTTP. Unique constraints on `trades(tx_hash, log_index)` and `liquidity_events(tx_hash, log_index)` to allow idempotent replay.

- **Smart Contracts (Hardhat 3, BSC mainnet | Nov 29–30, 2025):**
  - **ConditionalTokens v2** (`0x289b9C58e0a0FD75e574E967E0c84eA2320084a5`) – Outcome token ERC‑1155 used for all markets.
  - **DirectCTFOracle** (`0x0B40878a6b31eA07121a1e7691e011dC14287eFD`) – Admin‑driven settlement oracle; calls CTF `reportPayouts`.
  - **DirectOracleAdapter** (`0xd77e3cE643877Af847b67Ec07bef0855520f5407`) – Bridges market creation + resolution into CTF/oracle; owns condition metadata and safelists allowed oracles.
  - **FixedProductMarketMakerFactory** (`0x5D5c33BD67e5065bd93339C717f27CD8C6770D63`) – Deploys/wires FPMM pools (verified as “FixedProductMarketMakerFactory”, default fee 2%).
  - **USDF_Mainnet (USDF)** (`0x6922e3A041870c87295E02d3814BA5871Ed38f58`) – ERC20 + fixed‑rate USDT↔USDF vending machine (18‑decimal USDT backing, configurable sell fee). Prod context: `STABLECOIN.MD`. Legacy BNB‑backed USDF_Mainnet and virtual FPMM factory are archived at `contracts-hardhat/contracts-archive/`.

**Tooling Standards**
- Use **Hardhat 3** with the viem toolbox **and** `@nomicfoundation/hardhat-ethers`. Deployment scripts follow the Hardhat 3 pattern `const { ethers } = await network.connect(); const [deployer] = await ethers.getSigners();` (see `contracts-hardhat/scripts/deploy-ctf-stack.ts`, `deploy-usdf-mainnet.ts`, and `deploy/all.ts`).
- Verify every deployment with the **Etherscan V2 API key** (`ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY`) via `pnpm --filter contracts-hardhat hardhat verify --network bscMainnet <address> <constructorArgs>`.
- Frontend wallets must stay on **wagmi v2** and always pass `chainId: TARGET_CHAIN_ID` so writes never fall back to mainnet.

ABI snapshots for each deployment are committed under `contracts-hardhat/abis/` and stay in sync with the verified BscScan sources. Reference those JSON files for Hardhat scripts, viem clients, and SDK builds instead of re-downloading from explorers.

All contracts were originally deployed on **BSC Testnet** for staging and are now fully deployed and verified on **BSC Mainnet (56)**. The snippets below show the **mainnet** env shapes; testnet values are kept only for legacy regression and can be found in `CONTEXT.MD` and `Mainnet_Variables.md`.

Mainnet cutover checklist: `Mainnet_Variables.md` lists every testnet-hardwired address/RPC/chainId reference that must be swapped once mainnet contracts are deployed.

### Monorepo Structure

```
caifu/
├── apps/
│   ├── api/                    # Fastify backend (REST + SSE)
│   └── frontend/               # Next.js 16 frontend (moved to root as 'frontend/')
├── contracts-hardhat/          # Hardhat 3 workspace (production contracts + scripts)
│   ├── contracts/              # Solidity source (.sol files)
│   ├── scripts/                # Deployment scripts
│   └── hardhat.config.ts       # Hardhat 3 config
├── frontend/                   # Next.js frontend (main location)
│   ├── src/
│   │   ├── app/               # Next.js App Router pages
│   │   ├── components/        # React components
│   │   └── lib/              # API clients, utilities
│   └── package.json
├── packages/
│   ├── config/                # Shared env + chain config
│   ├── sdk/                   # TypeScript SDK (viem wrappers)
│   └── types/                 # Shared TypeScript types
├── ops/
│   ├── docker-compose.yml     # Production Docker setup
│   ├── .env                   # Backend environment config
│   └── Dockerfiles           # API, frontend Docker builds
└── scripts/
    ├── e2e/                   # E2E test harness
    └── *.ts                   # Utility scripts
```


## 🚀 Quick Start

### Prerequisites

- **Node.js**: 22.x (see `.nvmrc`; uses nvm on EC2)
- **pnpm**: 8+
- **Docker + Docker Compose** (for local PostgreSQL/Redis)
- **Funded BSC Testnet wallet** (get test BNB from [BSC Testnet Faucet](https://testnet.bnbchain.org/faucet-smart))

### 1. Clone & Install

```bash
git clone https://github.com/<your-org>/<your-repo>.git
cd Caifu
pnpm install
```

### 2. Environment Setup

**Backend** (`ops/.env` – mainnet):
```bash
# Chain
CHAIN_ID=56
RPC_HTTP_URL=https://bnb-mainnet.g.alchemy.com/v2/YOUR_API_KEY
RPC_HTTP_FALLBACK_URL=https://bsc-dataseed.binance.org
RPC_WS_URL=wss://bnb-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Contracts (mainnet)
CTF_ADDRESS=0x289b9C58e0a0FD75e574E967E0c84eA2320084a5
MARKET_FACTORY_ADDRESS=0x5D5c33BD67e5065bd93339C717f27CD8C6770D63
DIRECT_ORACLE_ADDRESS=0x0B40878a6b31eA07121a1e7691e011dC14287eFD
ORACLE_ADAPTER_ADDRESS=0xd77e3cE643877Af847b67Ec07bef0855520f5407
USDF_ADDRESS=0x6922e3A041870c87295E02d3814BA5871Ed38f58 # USDF_Mainnet

# Database
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/caifu
REDIS_URL=redis://redis:6379

# Auth
ADMIN_JWT_SECRET=your-secret-key-here

# Deployment (for contract operations)
DEPLOYER_PRIVATE_KEY=0x...
```

**Frontend** (`frontend/.env.local` – mainnet):
```bash
NEXT_PUBLIC_CHAIN_ID=56
NEXT_PUBLIC_RPC_URL=https://bnb-mainnet.g.alchemy.com/v2/YOUR_API_KEY
NEXT_PUBLIC_RPC_FALLBACK_URL=https://bsc-dataseed.binance.org
NEXT_PUBLIC_RPC_WS_URL=wss://bnb-mainnet.g.alchemy.com/v2/YOUR_API_KEY

NEXT_PUBLIC_API_BASE_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com

NEXT_PUBLIC_CTF_ADDRESS=0x289b9C58e0a0FD75e574E967E0c84eA2320084a5
NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=0x5D5c33BD67e5065bd93339C717f27CD8C6770D63
NEXT_PUBLIC_USDF_ADDRESS=0x6922e3A041870c87295E02d3814BA5871Ed38f58 # USDF_Mainnet
NEXT_PUBLIC_USDT_ADDRESS=0x55d398326f99059fF775485246999027B3197955  # USDT (BSC mainnet)
```

See `env.example`, `ops/.env`, and `.env.example.e2e` for complete reference.

### 3. Swap USDT ↔ USDF

- The `/swap` route talks directly to `USDF_Mainnet` using **wagmi v2**. Every wagmi hook is pinned to `NEXT_PUBLIC_CHAIN_ID`, so make sure that env var (and `NEXT_PUBLIC_USDF_ADDRESS` / `NEXT_PUBLIC_USDT_ADDRESS`) track the latest deployment you mirrored into `contracts-hardhat/abis/USDF_Mainnet.json`.
- Users must be on the same chain as the dapp (`TARGET_CHAIN_ID`, 56 in production). If a wallet is connected elsewhere the UI surfaces a network warning and blocks submissions until they switch, preventing accidental cross-chain transactions.
- The buy flow approves USDT and calls `USDF_Mainnet.buy(address, usdtAmount)`; the sell flow burns via `USDF_Mainnet.sell(amount,address)` (contract handles flat/percent fee). Keep USDT liquidity topped up in the vending machine so redemptions succeed.

### 4. Start Services

```bash
# Terminal 1: Start PostgreSQL + Redis
docker compose -f ops/docker-compose.yml up postgres redis

# Terminal 2: Start API (includes auto-migrations)
cd apps/api
pnpm dev

# Terminal 3: Start Frontend
cd frontend
pnpm dev
```

**Access**:
- Frontend: http://localhost:3000
- API: http://localhost:3001 (if running separately)
- Health Check: http://localhost:3001/api/healthz

### 5. Create Your First Market

Navigate to `/admin/market/new` (requires wallet signature auth) and create a binary market. The form includes an **Initial Liquidity (USDF)** field which is now **optional**. When you submit:
1. The backend deploys a new FPMM clone contract and stores the market metadata.
2. The deployer wallet mints **100 USDF** from `USDF_Mainnet` and calls `addFunding` on the new FPMM, auto-seeding every market with baseline liquidity.
3. If you enter a non-zero `initialLiquidity`, the public create flow then walks your wallet through `approve(USDF)` + `addFunding` to stack your liquidity on top of the 100 USDF seed.
4. Event indexing starts as soon as the pool exists.

Ops who need a deploy-only pass can still call `/api/admin/markets/:id/seed`; it deploys the FPMM clone (if needed), auto-seeds 100 USDF from the deployer, and returns `requiresUserFunding` if additional liquidity should be added via wallet.

### Indexer/Recon Status

- **Recon/ingest is currently disabled** to avoid RPC burn (both on testnet and mainnet). Worker container is stopped; `RECON_ENABLED=0`, `RECON_MODE=webhook`, `ENABLE_INDEXER=0`, `INGEST_SWEEP_ENABLED=0` in `ops/.env`. Leave it off unless you explicitly need to replay events.
- Backfill trades on-demand via `POST /api/admin/markets/:id/backfill` (auth) which replays the FPMM’s txs from Etherscan V2 and updates trades/liquidity/candles + `market_sync`.
- Webhook mode is enabled for `/api/webhooks/alchemy` (token + signing key in env). Live ingest/sweeps are off; webhook enqueues txs without block-by-block scans.
- If you must run recon: set `RECON_MODE=api-ondemand` and `RECON_ENABLED=1`, start the worker (`docker compose -f ops/docker-compose.yml up -d worker`), and consider scan/sweep limits. Turn it off again to conserve RPC.

## 📡 API Reference

### Contract Verification

- We use Hardhat v3 + the viem toolbox and Etherscan **V2** API to verify contracts on both BscScan and Sourcify. Export `ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY` locally and run:

```bash
pnpm --filter contracts-hardhat hardhat verify --network bscMainnet <contract-address> <constructor-args>
```

- The same key works across Etherscan/BscScan per the [official v2 docs](https://docs.etherscan.io/introduction); no separate `BSCSCAN_API_KEY` is needed anymore.

### Public Endpoints

```bash
# Markets
GET  /api/markets                    # List all markets
GET  /api/markets/:id                # Market details
GET  /api/markets/:id/metrics        # Price, volume, TVL
GET  /api/markets/:id/candles        # OHLCV data (5min buckets)
GET  /api/markets/:id/trades         # Recent trades
GET  /api/markets/:id/live           # SSE: live trades stream
GET  /api/markets/:id/comments       # Market chat
GET  /api/markets/:id/comments/live  # SSE: live chat stream
POST /api/markets                    # Create market (requires authenticated user session)

# User
GET  /api/user/profile               # User profile (requires auth)
GET  /api/user/positions             # Token positions

# Health
GET  /api/healthz                    # System health + indexer status
GET  /api/health/ws                  # WebSocket metrics
```

### Admin Endpoints (Wallet Auth Required)

```bash
POST /api/admin/markets              # Admin wrapper for market creation (thin proxy around POST /api/markets)
POST /api/admin/markets/:id/seed     # Seed FPMM liquidity
POST /api/admin/markets/:id/resolve  # Resolve market
POST /api/admin/markets/:id/backfill # Replay trades/liquidity from chain (Etherscan + RPC)
POST /api/admin/markets/:id/nuke     # Soft-delete (hide) a market (admins still see it)
POST /api/webhooks/alchemy           # Alchemy webhook (token + signing key); tolerant to missing content-type
GET  /api/admin/tile-backgrounds     # Custom tile backgrounds
POST /api/admin/tile-backgrounds/upload  # Upload background image

# Tag Management
GET  /api/admin/tags                 # List all tags with visibility status and market counts
PUT  /api/admin/tags/:id             # Toggle tag visibility { visible: boolean }
POST /api/admin/tags/sync            # Sync tags from existing markets into tags table
DELETE /api/admin/tags/:id           # Remove tag from visibility table
GET  /api/tags                       # Public: visible tags only (for /markets dropdown)
```

### Indexer/Recon Status

- **Recon/ingest is currently disabled** to avoid RPC burn. Worker container is stopped; `RECON_MODE=webhook`, `RECON_ENABLED=0`, `ENABLE_INDEXER=0`, `INGEST_SWEEP_ENABLED=0` in `ops/.env`. Leave it off unless you explicitly need to replay events.
- Backfill trades on-demand via `POST /api/admin/markets/:id/backfill` (auth) which replays the FPMM’s txs from Etherscan V2 and updates trades/liquidity/candles + `market_sync`.
- Webhook mode is enabled for `/api/webhooks/alchemy` (token + signing key in env). Live ingest/sweeps are off; webhook enqueues txs without block-by-block scans.
- If you must run recon: set `RECON_MODE=api-ondemand` and `RECON_ENABLED=1`, start the worker (`docker compose -f ops/docker-compose.yml up -d worker`), and consider scan/sweep limits. Turn it off again to conserve RPC.

### Authentication

Caifu uses **EIP-191 signature-based auth**:

1. `POST /api/auth/nonce` - Get a nonce for your wallet address
2. Sign the nonce with your wallet
3. `POST /api/auth/verify` - Verify signature, receive HttpOnly session cookie (7-day TTL)
4. Use cookie for subsequent admin requests

## 🔨 Development Workflows

### Running Locally

```bash
# Full stack (recommended)
docker compose -f ops/docker-compose.yml up

# Individual services
pnpm --filter api dev              # API only
pnpm --filter frontend dev         # Frontend only
```

### Contract Development

```bash
cd contracts-hardhat

# Compile contracts
npx hardhat compile

# Deploy pieces to BSC via Hardhat (see scripts for network)
pnpm deploy:usdf-mainnet:bsc       # Deploy USDF_Mainnet (ERC20 + swap)
pnpm deploy:ctf-stack:bsc          # Deploy ConditionalTokens + DirectCTFOracle + DirectOracleAdapter
pnpm deploy:fpmmFactory:bsc        # Deploy FixedProductMarketMakerFactory and patch envs
pnpm deploy:all:bsc                # Full stack deploy (USDF_Mainnet + CTF stack + FPMM factory + Vault + Minter + verify)
pnpm smoke:fpmm:bsc                # FPMM end-to-end smoke test on BSC
```

See `HARDHAT3_DEPLOYMENT_SUMMARY.md` for detailed deployment guide.

### E2E Testing

```bash
# Run full beta cycle (login → create → seed → trade)
pnpm e2e:beta

# Output: devtools-artifacts/beta-cycle/<timestamp>/
# - login.json, create.json, seed-*.json, buy.json
# - balances-*.json, healthz-*.json
# - console.json, network.har, page.png
```

See `README_E2E.md` for E2E test documentation.

### Oracle Wiring Sanity Check

```bash
# Requires the API server running locally with admin password configured
pnpm sanity:oracle
```

Creates a disposable market through the admin API, seeds it, resolves it via DirectOracleAdapter, and verifies the CTF payouts are written by DirectCTFOracle.

### Database Migrations

```bash
cd apps/api

# Run migrations
pnpm prisma migrate dev

# Generate Prisma client
pnpm prisma generate

# Reset database (WARNING: deletes all data)
pnpm prisma migrate reset
   ```

## 📁 Static Uploads (Hero Images, Tile Backgrounds, Avatars)

- **Runtime source of truth:** The Fastify API serves uploads from the Docker named volume `ops_uploads_data`, mounted inside the container at `/app/apps/api/uploads` and persisted on the host at `/var/lib/docker/volumes/ops_uploads_data/_data/{avatars,market-heroes,tile-backgrounds}` (device `nvme1n1`, label `docker-data`).
- **Repo mirror:** The monorepo keeps a tracked mirror under `./uploads/{avatars,market-heroes,tile-backgrounds}` for local dev and as a backup snapshot. Local `pnpm dev` (no Docker) reads from this directory automatically.
- **Safety filter:** All uploaded images are scanned server-side with Google Cloud Vision SafeSearch **before** they hit disk/DB. Uploads are rejected only if `adult` or `violence` is `VERY_LIKELY`; the `racy` flag is ignored.
- **If images vanish in the UI:**  
  1. Inspect `/var/lib/docker/volumes/ops_uploads_data/_data` first—this is almost always intact.  
  2. If Docker still has the assets but the repo copy is empty, sync Docker → repo with:
     ```
     sudo rsync -a --delete --exclude='.gitkeep' /var/lib/docker/volumes/ops_uploads_data/_data/avatars/ ./uploads/avatars/
     sudo rsync -a --delete --exclude='.gitkeep' /var/lib/docker/volumes/ops_uploads_data/_data/market-heroes/ ./uploads/market-heroes/
     sudo rsync -a --delete --exclude='.gitkeep' /var/lib/docker/volumes/ops_uploads_data/_data/tile-backgrounds/ ./uploads/tile-backgrounds/
     sudo chown -R ubuntu:ubuntu ./uploads
     ```
  3. Never assume files are gone solely because `./uploads` looks empty; the Docker volume is the canonical store.

## 🐳 Docker Deployment

### Production Deployment (EC2)

The current production setup runs on AWS EC2:

   ```bash
# Load NVM (Node Version Manager)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Navigate to repo
cd /home/ubuntu/repo

# Pull latest changes
git pull origin SIGMA

# Rebuild and restart services
docker compose -f ops/docker-compose.yml up -d --build

# View logs
docker compose -f ops/docker-compose.yml logs -f api
```

**Services:**
- `api` - Fastify backend (port 3000, behind Caddy reverse proxy)
- `postgres` - PostgreSQL database
- `redis` - Redis cache/pub-sub

**Frontend** deploys separately via **Vercel** (auto-deploys on push to `main`).

See `DEPLOYMENT_ENV.md` for environment configuration details.

## 🧱 Build Notes (Vercel / Turbopack)
- WalletConnect pulls in `thread-stream@0.15.2`, whose published tarball includes tests, benchmarks, and LICENSE files referencing Node-only modules (`worker_threads`, `tap`, etc.). Turbopack tries to parse them and fails.
- The repo includes a pnpm patch (`patches/thread-stream@0.15.2.patch`) plus a `postinstall` cleanup script (`scripts/remove-thread-stream-tests.mjs`) that now prune **all** `thread-stream@*` installs, force them to export a browser stub, and additionally stub `@sentry/node-core`’s `worker_threads` require so Turbopack never trips on NFT tracing.
- **Never remove or bypass those files**. Fresh installs (local or on Vercel) rely on them to avoid the `NftJsonAsset`/"unknown module type" errors described in [`Vercel_Errors.md`](./Vercel_Errors.md). On CI, always clear the Vercel build cache if you don’t see `[thread-stream-patch] …` log lines after `pnpm install`—that output confirms the stubber ran.

## 🔐 Secrets & Environment Management (prepping for mainnet)
- Testnet keys/secrets have been committed intentionally for BSC testnet debugging, but **mainnet must not reuse them**.
- Recommended pattern going forward:
  - Local/dev: continue to use `.env` and `ops/.env` for testnet-only keys, but keep them out of mainnet flows.
  - Server (EC2): load production env from a secrets manager (e.g., AWS SSM/Secrets Manager) or instance metadata and inject them into Docker/Node via `docker compose` env vars; do not bake private keys directly into images.
  - Vercel: configure `NEXT_PUBLIC_*` and server-only env vars via the Vercel dashboard; never hard-code mainnet addresses or secrets in the repo.
- When we cut over to mainnet:
  - Rotate all deployer/operator keys.
  - Point `.env`-style files at *testnet* only, and keep mainnet credentials exclusively in your secret manager.
  - Treat README/CONTEXT/SYSTEM_STATUS as documentation of env shapes and required values, not as sources of real secrets.

## 🎨 Features

### Real-Time Data

- **Live Trades**: SSE stream pushes trades to UI instantly
- **Price Charts**: 5-minute OHLCV candles with real-time updates
- **Market Metrics**: Spot price, 24h volume, TVL (auto-refreshed)
- **Spot Points**: Recorded only on trades (not on polling) via `recordSpotPointFromChain()` triggered by SSE `onTrade` callback
- **Chat**: Real-time market discussion with SSE

### USDF Onramp

Users can mint or redeem USDF straight against the **USDF_Mainnet** contract:

1. Connect a wallet with test BNB.
2. Use the "Get USDF" button (or call `buy(address to)` manually) to send BNB to USDF_Mainnet.
3. Receive freshly minted USDF at the fixed rate (default 1:1) credited to the target address.
4. When done, call `sell(uint256 usdfAmount, address payable to)` to burn USDF and withdraw BNB from the same contract balance.

BNB liquidity lives on the USDF_Mainnet contract itself; the owner can still emergency-withdraw with `rescueBNB`, but there is no separate Vault.

### Admin Tools

- **Market Creation**: Define question, tags, expiry, FPMM fee
- **Liquidity Seeding**: Mint YES/NO tokens, initialize FPMM pool with balanced reserves
- **Market Resolution**: Choose the winning outcome from each market's sidebar UI (admin-only) which calls `DirectOracleAdapter.requestResolve` on-chain.
- **Tile Backgrounds**: Upload custom images for market categories (applies based on tags)
- **Tag Management** (`/admin/tags`): Control which tags appear in the public markets filter dropdown
  - Sync tags from existing markets
  - Toggle visibility per tag (hidden tags don't appear in `/markets` dropdown)
  - Search, sort, and delete tags

### Visual Effects

Caifu features a modern glassmorphism theme with:
- Animated gradient backgrounds
- Neon glow effects on buttons and status indicators
- Frosted glass cards with backdrop blur
- Custom scrollbar styling
- Floating animations

See `FRONTEND_THEME_ENHANCEMENTS.md` for theme documentation.

## 📊 System Monitoring

### Health Checks

```bash
# API health + indexer status
curl https://api.example.com/api/healthz | jq

# Key metrics:
# - recon.lagBlocks (should be <10 for healthy indexer)
# - recon.fpmmWatchers (count of active FPMM watchers)
# - recon.lastEventAt (timestamp of last indexed event)
```

### Reconciliation Worker

The backend runs a reconciliation worker that:
- Watches all FPMM contracts for Swap/AddLiquidity/RemoveLiquidity events
- Calculates spot price, reserves, volume, TVL
- Aggregates 5-minute candles
- Publishes trade events to Redis for SSE streaming
- Exposes health metrics via `/api/healthz`

**Configuration** (`ops/.env`):
```bash
RECON_ENABLED=1
RECON_INTERVAL_MS=15000          # Poll interval
RECON_SCAN_BLOCKS=1200           # Backfill window
RECON_MAX_LAG_BLOCKS=20000       # Max allowed lag
RECON_CONFIRMATIONS=1            # Block confirmations
```

## 🔐 Security Notes

**⚠️ THIS IS A TESTNET DEPLOYMENT**

- Private keys and secrets are **committed** to the repo for debugging purposes
- All values will be rotated before mainnet deployment
- **Do not use these keys/secrets for real funds**
- CORS allowlist: `example.com`, `www.example.com`, `your-project.vercel.app`

## 📚 Documentation

**Core Documentation (Root):**
- `README.md` - This file (project overview, quick start, API reference)
- `CONTEXT_NOTES.md` - Agent onboarding, architecture overview, critical addresses
- `CONTEXT.MD` - Snapshot of deployed contracts, dev key location, and MCP usage tips
- `SYSTEM_STATUS.md` - Current deployment status, contract addresses, features

**Extended Documentation (`/docs/`):**

For comprehensive guides, implementation details, and operational documentation, see the [`/docs`](/docs) folder:

- **Deployment & Testing**:
  - `README_E2E.md` - E2E testing harness documentation
  - `FPMM_TESTNET_CHECKLIST.md` - Production deployment checklist
  - `HARDHAT3_DEPLOYMENT_SUMMARY.md` - Contract deployment guide
  - `DEPLOYMENT_ENV.md` - Environment configuration details

- **API & Features**:
  - `api-calls.md` - API endpoint reference and examples
  - `toggles.md` - Runtime feature flags configuration
  - `ws-alerts-guide.md` - WebSocket health monitoring
  - `ws-hot-reload-guide.md` - Hot-reload safety guide

- **Frontend & UI**:
  - `FRONTEND_THEME_ENHANCEMENTS.md` - UI/UX theme system
  - `THEME_ENHANCEMENT_SUMMARY.md` - Theme implementation summary
  - `VISUAL_EFFECTS_GUIDE.md` - Visual effects reference
  - `YELLOW_LIQUID_GLASS_EFFECT.md` - Liquid glass effect details

- **Implementation**:
  - `Background.md` - System architecture and design decisions
  - `TOGGLES_IMPLEMENTATION.md` - Feature toggles implementation
  - `BITCOIN_MARKET_SETUP.md` - Bitcoin market creation example
  - `To-Do-List.md` - Active development tasks

**Explore the `/docs` folder for detailed guides on deployment, testing, API usage, and system internals.**

## 🛠️ Troubleshooting

### Common Issues

**"Chain ID mismatch"**
- Ensure wallet is on BSC Testnet (97)
- Check `NEXT_PUBLIC_CHAIN_ID=97` in frontend env

**"RPC request failed"**
- Check NodeReal RPC URL is valid
- Fallback RPC (`bsc-testnet.publicnode.com`) should auto-activate

**"Indexer lag high"**
- Check `/api/healthz` → `recon.lagBlocks`
- If >50 blocks, restart API: `docker compose -f ops/docker-compose.yml restart api`

**"No trades appearing"**
- Check reconciliation worker is running: `/api/healthz` → `recon.fpmmWatchers > 0`
- Verify FPMM address in DB matches deployed contract

**"Admin auth failing"**
- Clear browser cookies
- Generate new nonce: `POST /api/auth/nonce`
- Re-sign and verify

## 🤝 Contributing

This is a private repository. For internal development:

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes, commit frequently
3. Push to GitHub: `git push origin feature/your-feature`
4. Merge to `SIGMA` branch when ready
5. Deploy via EC2 (backend) and Vercel (frontend)

**Active Branch**: `SIGMA`

## 📄 License

Proprietary. All rights reserved.

---

**Built for prediction markets on BNB Smart Chain** 🔮

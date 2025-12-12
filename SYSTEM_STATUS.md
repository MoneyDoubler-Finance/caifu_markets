# 🎯 Caifu Prediction Market - System Status

**Last Updated:** 2025-12-01 (markets created, homepage fixes)
**Environment:** BSC Mainnet (Chain ID: 56)
**Status:** 🟢 Production Live (Mainnet "Gold")
**Markets:** 26 total (22 active, 4 resolved)

---

## 📊 Quick Status Dashboard

| Component | Status | Address/Version |
|-----------|--------|-----------------|
| **ConditionalTokens v2** | 🟢 Live | `0x289b9C58e0a0FD75e574E967E0c84eA2320084a5` |
| **DirectCTFOracle** | 🟢 Live | `0x0B40878a6b31eA07121a1e7691e011dC14287eFD` |
| **DirectOracleAdapter** | 🟢 Live | `0xd77e3cE643877Af847b67Ec07bef0855520f5407` |
| **FPMM Factory** | 🟢 Live | `0x5D5c33BD67e5065bd93339C717f27CD8C6770D63` |
| **USDF_Mainnet (USDF)** | 🟢 Live | `0x6922e3A041870c87295E02d3814BA5871Ed38f58` |
| **API Server** | 🟢 Running | `https://api.example.com` |
| **Frontend** | 🟢 Deployed | `https://www.example.com` |
| **Database** | 🟢 Connected | PostgreSQL |
| **Redis** | 🟢 Connected | `redis://redis:6379` |

**Image safety:** `GOOGLE_APPLICATION_CREDENTIALS` should point to a local secret file, e.g. `/run/secrets/gcp-vision.json`.

**Contract sources:** Active mainnet/testnet Solidity lives in `contracts-hardhat/contracts/` (ConditionalTokens, DirectCTFOracle, DirectOracleAdapter, FixedProductMarketMakerFactory, USDF_Mainnet). Deprecated variants (BNB-backed USDF_Mainnet, virtual FPMM factory) are quarantined in `contracts-hardhat/contracts-archive/` and excluded from Hardhat builds.
**Mainnet swap checklist:** see `Mainnet_Variables.md` for every testnet-hardwired address/RPC/chainId reference to update when cutting over to mainnet.

---

## 🔄 System Flow (current Caifu stack)

```
┌─────────────────────────────────────────────────────────────┐
│                     MARKET LIFECYCLE                        │
└─────────────────────────────────────────────────────────────┘

1. CREATE MARKET
   ├─ Authenticated user creates market via /api/markets (admin wrapper available at /api/admin/markets)
   ├─ Factory deploys FPMM clone contract
   ├─ CTF condition prepared automatically
   └─ Market stored in database with fpmmAddress

2. SEED LIQUIDITY
   ├─ Backend auto-seeds 100 USDF from deployer via seedMarketInternal
   │   ├─ Mints 100 USDF from USDF_Mainnet
   │   ├─ Approves FPMM to spend USDF
   │   └─ Calls addFunding(100e18, []) so pool holds a balanced YES/NO set at 50/50
   ├─ (Optional) Creator adds extra USDF via wallet
   │   ├─ UI runs USDF.approve(FPMM, amount)
   │   └─ Then calls addFunding(amount, []) to layer on top of the seed
   └─ Market becomes tradeable (totalSupply > 0)

3. TRADE
   ├─ Users connect wallet (WalletConnect/MetaMask)
   ├─ FPMM calculates buy/sell quotes
   ├─ User approves USDF spending (if needed)
   ├─ FPMM.buy() or FPMM.sell() executed on-chain
   ├─ Trade events indexed and streamed via SSE
   └─ Metrics updated (spot price, volume, TVL)

4. RESOLVE
   ├─ Admin calls POST /api/admin/markets/:id/resolve
   ├─ CTF.reportPayouts([1,0] or [0,1])
   └─ Market status → "resolved"

5. REDEEM
   ├─ Winners redeem positions on market page
   ├─ CTF.redeemPositions() burns winning tokens
   └─ USDF collateral returned to user
```

---

## 🛠️ API Endpoints

### Public Endpoints
- `GET /api/healthz` - Comprehensive health check with recon metrics
- `GET /api/markets` - List all markets
- `GET /api/markets/:id` - Get market details
- `GET /api/markets/:id/metrics` - Real-time metrics (spot price, volume24h, TVL)
- `GET /api/markets/:id/candles` - OHLCV candle data for charts
- `GET /api/markets/:id/trades` - Recent trade history
- `GET /api/markets/:id/live` - Server-Sent Events (SSE) for live trades
- `GET /api/markets/:id/comments` - Market discussion comments
- `GET /api/markets/:id/comments/live` - SSE for live chat updates
- `POST /api/markets` - Create new market (requires wallet session)

### Authentication Endpoints
- `POST /api/auth/nonce` - Request signing nonce
- `POST /api/auth/verify` - Verify wallet signature and create session
- `POST /api/auth/logout` - Destroy session
- `GET /api/auth/me` - Get current user profile

### Admin Endpoints (Auth Required)
- `POST /api/admin/login` - Admin login with password
- `POST /api/admin/markets` - Thin wrapper around `POST /api/markets`
- `POST /api/admin/markets/:id/seed` - Seed FPMM liquidity pool
- `POST /api/admin/markets/:id/resolve` - Resolve market outcome

### User Endpoints (Auth Required)
- `POST /api/markets/:id/comments` - Post comment on market
- `GET /api/portfolio` - View user's positions across markets

---

## 🔧 CTFv2 Key Features

### Fixed Redemption Logic
```solidity
// OLD (CTFv1) - BROKEN
partition = [1]  // indexSet
payout = payouts[conditionId][partition[0]]  // ❌ Uses 1 as outcomeIndex

// NEW (CTFv2) - FIXED
indexSet = 1  // YES token
outcomeIndex = indexSet - 1  // 0
payout = (amount * payouts[conditionId][outcomeIndex]) / denominator  // ✅ Correct
```

### Payout Denominator
```solidity
// CTFv2 stores sum of payouts for percentage calculation
payoutDenominator[conditionId] = sum(payoutNumerators)

// Example: [1, 0] → denominator = 1
// Winning position: (amount * 1) / 1 = 100% payout
// Losing position: (amount * 0) / 1 = 0% payout
```

---

## 🧷 FPMM addFunding invariant (post-seed)
- The FPMM contract enforces a strict rule around `addFunding(uint256 addedFunds, uint256[] distributionHint)`:
  - During **initial funding** (empty pool), a non-empty `distributionHint` can be used to shape how addedFunds is split across outcome positions.
  - After the pool has been initialized and has shares, **distributionHint must be empty**. Any non-empty hint causes a revert with reason `cannot use distribution hint after initial funding`.
- Caifu’s backend calls `seedMarketInternal` to mint 100 USDF from USDF_Mainnet and seed every new FPMM. All subsequent liquidity top-ups (creator or ops) must therefore call `addFunding(amount, [])`.
- If an addFunding tx is failing on a live market:
  - Decode the tx and confirm the second argument is non-empty (e.g. `[1,1]`).
  - Simulate with `eth_call` to check for the invariant revert.
  - Fix the caller (UI/SDK/script) to send an empty `distributionHint` for post-seed funding.

---

## 🧪 Testing & Validation

### E2E Beta Cycle (`pnpm e2e:beta`)
Automated headless testing flow validates:
- ✅ Admin authentication (JWT session)
- ✅ Market creation via Factory
- ✅ FPMM seeding with deterministic liquidity
- ✅ USDF approval workflow
- ✅ FPMM buy/sell execution
- ✅ Trade event indexing and SSE streaming
- ✅ Metrics API (spot price, volume, TVL)
- ✅ Candles API (OHLCV data)
- ✅ Puppeteer artifacts (HAR, console logs, screenshots)

**Artifacts:** `devtools-artifacts/beta-cycle/<timestamp>/`

### Health Check Validation
```bash
curl https://api.example.com/api/healthz | jq
```

Expected metrics:
- `recon.usingWs: false` (HTTP polling mode)
- `recon.lagBlocks: <10` (healthy indexing)
- `recon.fpmmWatchers: >0` (active market watchers)
- `contracts.Factory.status: "ok"`
- `contracts.CTF.status: "ok"`
- `contracts.USDF.status: "ok"`

---

## 🏛️ Architecture & Features

### Core Components
1. **Fixed Product Market Maker (FPMM)**
   - On-chain AMM for YES/NO token swaps
   - Constant product formula: `x * y = k`
   - Deterministic pricing with configurable fees (1% default)
   - Per-market liquidity pools

2. **Conditional Tokens Framework (CTF v2)**
   - ERC-1155 multi-token standard
   - Splits collateral into outcome positions
   - Handles market resolution and redemption
   - Fixed indexSet calculation (CTF v2 improvement)

3. **Real-Time Indexing**
   - WebSocket/HTTP event listeners
   - Redis pub/sub for SSE streaming
   - Candle aggregation (5-minute buckets)
   - Trade history with tx details

4. **User Authentication**
   - Wallet signature-based auth (EIP-191)
   - HttpOnly session cookies (7-day TTL)
   - Profile system with display names
   - Market chat/comments integration

### Frontend Features
- 🔗 **WalletConnect v2** - Multi-wallet support
- 📊 **Live Price Charts** - TradingView-style candles
- 💬 **Market Chat** - Real-time discussion with SSE
- 📈 **Live Metrics** - Spot price, 24h volume, TVL
- 🎨 **Glass Morphism UI** - Yellow liquid theme
- ⚡ **Trade Execution** - Direct FPMM interaction with approvals
- 👤 **User Profiles** - Wallet-based identity

---
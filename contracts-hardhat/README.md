# Contracts (Hardhat 3) Overview

This package contains the production Solidity contracts and deployment scripts for Caifu Markets, wired to **Hardhat 3**, **ethers v6**, and the **Etherscan V2 API**.

## Tooling

- Hardhat: `3.0.14`
- Plugins:
  - `@nomicfoundation/hardhat-toolbox-viem`
  - `@nomicfoundation/hardhat-ethers` (deployment scripts)
  - `@nomicfoundation/hardhat-verify` (Etherscan V2)
- Node: `22.x`
- TypeScript: `^5.7.3`

## Network & Verify Config

The config in `contracts-hardhat/hardhat.config.ts`:

- Targets **BSC Testnet** as `bscTestnet`:
  - `type: "http"`
  - `url: RPC_HTTP_URL` from env
  - `accounts: [OPERATOR_PRIVATE_KEY]` when present
- Uses the **Etherscan V2** key (works for BscScan too):
  - `ETHERSCAN_API_KEY` or `NEXT_PUBLIC_ETHERSCAN_API_KEY`
  - `verify.etherscan.apiKey = ETHERSCAN_API_KEY`
  - No BscScan-specific `customChains` block is needed.

To verify a deployment on BSC Testnet:

```bash
export ETHERSCAN_API_KEY=your_v2_key_here
pnpm --filter contracts-hardhat hardhat verify --network bscTestnet <address> <constructor-args>
```

## Scripts: Hardhat 3 + Ethers

All ethers-based scripts follow the Hardhat 3 pattern:

```ts
import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("USDF");
  const usdf = await Factory.deploy(INITIAL_RATE);
  await usdf.waitForDeployment();

  const address = await usdf.getAddress();
  const tx = usdf.deploymentTransaction();
  console.log("USDF deployed at", address, "tx:", tx?.hash);
}
```

Key scripts:

- `scripts/deploy/all.ts`  
  Full stack deploy (USDF_Mainnet, ConditionalTokens, DirectCTFOracle, DirectOracleAdapter, FPMM factory, Vault, USDFMinter), writes `deployments/97.json`, and runs `verify` via Hardhat’s task API.

- `scripts/deploy-usdf-mainnet.ts`
  Deploys the `USDF` (USDF_Mainnet) vending machine contract with the fixed initial rate.

- `scripts/deploy-fpmm-factory.ts`  
  Deploys `FixedProductMarketMakerFactory`, then patches `ops/.env` and `.env` with `MARKET_FACTORY_ADDRESS`.

- `scripts/deploy-ctf-stack.ts`  
  Deploys `ConditionalTokens`, `DirectCTFOracle`, and `DirectOracleAdapter` and prints an env snippet for the API/worker.

- `scripts/fpmm-smoke.ts`  
  End-to-end FPMM smoke test using the configured addresses: prepares a condition, creates an FPMM, seeds liquidity, trades YES, resolves, and redeems.

Other utility scripts (`ctf-inspect.ts`, `vault-withdraw.ts`, `vault-sweep-erc20.ts`, etc.) also rely on:

```ts
const { ethers } = await network.connect();
```

## Environment Variables

The config and scripts expect chain/env values to be set (typically via `ops/.env` and root `.env`):

- RPC / keys:
  - `RPC_HTTP_URL` (or `RPC_URL`)
  - `OPERATOR_PRIVATE_KEY` / `DEPLOYER_PRIVATE_KEY`
  - `ETHERSCAN_API_KEY` (Etherscan V2)
- Core contracts:
  - `USDF_ADDRESS`
  - `CTF_ADDRESS`
  - `DIRECT_ORACLE_ADDRESS`
  - `ORACLE_ADAPTER_ADDRESS`
  - `FPMM_FACTORY_ADDRESS`
  - `USDF_VAULT_ADDRESS`

Deployment scripts that emit new addresses will usually log an `.env` snippet and, for key addresses, automatically update `ops/.env` and `.env` so the API/frontend stay in sync.

## Commands

From the repo root:

- Build contracts TypeScript:

```bash
pnpm --filter @caifu/contracts-hardhat build
```

- Run tests:

```bash
pnpm --filter @caifu/contracts-hardhat hardhat test
```

- Run a specific script on BSC Testnet (example):

```bash
pnpm --filter @caifu/contracts-hardhat hardhat run scripts/deploy-usdf-mainnet.ts --network bscTestnet
```

This README reflects the current Hardhat 3 + ethers + Etherscan V2 setup used by Caifu’s canonical BSC testnet deployment. 


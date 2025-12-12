import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { defineConfig } from "hardhat/config";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from ops/.env first, then .env as fallback
const opsEnvPath = path.join(__dirname, "..", "ops", ".env");
const rootEnvPath = path.join(__dirname, "..", ".env");

if (fs.existsSync(opsEnvPath)) {
  dotenv.config({ path: opsEnvPath });
}
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

const RPC_HTTP_URL = process.env.RPC_HTTP_URL || process.env.RPC_URL || "";
const RPC_HTTP_URL_MAINNET =
  process.env.RPC_HTTP_URL_MAINNET || process.env.RPC_URL_MAINNET || "";
const OPERATOR_PRIVATE_KEY = 
  process.env.OPERATOR_PRIVATE_KEY || 
  process.env.PRIVATE_KEY || 
  process.env.MINTER_PRIVATE_KEY ||
  process.env.DEPLOYER_PRIVATE_KEY || 
  "";

if (!OPERATOR_PRIVATE_KEY) {
  console.warn("⚠️  Warning: No operator private key found in environment");
}

const ETHERSCAN_API_KEY =
  process.env.ETHERSCAN_API_KEY || process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY || "";

export default defineConfig({
  plugins: [hardhatToolboxViem, hardhatEthers, hardhatVerify],
  solidity: {
    compilers: [
      {
        version: "0.5.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    bscTestnet: {
      type: "http",
      url: RPC_HTTP_URL,
      accounts: OPERATOR_PRIVATE_KEY ? [OPERATOR_PRIVATE_KEY] : [],
      chainId: 97,
    },
    bscMainnet: {
      type: "http",
      url: RPC_HTTP_URL_MAINNET,
      accounts: OPERATOR_PRIVATE_KEY ? [OPERATOR_PRIVATE_KEY] : [],
      chainId: 56,
    },
  },
  verify: {
    etherscan: {
      // Etherscan V2 key – works for all supported chains (incl. BscScan)
      apiKey: ETHERSCAN_API_KEY,
    },
    blockscout: {
      enabled: false,
    },
  },
});

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("./tasks/check-contracts.js");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const url_1 = require("url");
const __filename = (0, url_1.fileURLToPath)(import.meta.url);
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
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    process.env.MINTER_PRIVATE_KEY ||
    process.env.DEPLOYER_PRIVATE_KEY ||
    "";
if (!OPERATOR_PRIVATE_KEY) {
    console.warn("⚠️  Warning: No operator private key found in environment");
}
const config = {
    solidity: {
        version: "0.8.28",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    networks: {
        bscTestnet: {
            type: "http",
            url: RPC_HTTP_URL,
            accounts: OPERATOR_PRIVATE_KEY ? [OPERATOR_PRIVATE_KEY] : [],
            chainId: 97,
        },
    },
};
exports.default = config;

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
exports.loadEnv = loadEnv;
exports.getAddresses = getAddresses;
exports.updateEnvFile = updateEnvFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const url_1 = require("url");
const __filename = (0, url_1.fileURLToPath)(import.meta.url);
const __dirname = path.dirname(__filename);
const opsEnvPath = path.join(__dirname, "..", "..", "ops", ".env");
const rootEnvPath = path.join(__dirname, "..", "..", ".env");
function loadEnv() {
    if (fs.existsSync(opsEnvPath)) {
        dotenv.config({ path: opsEnvPath });
    }
    if (fs.existsSync(rootEnvPath)) {
        dotenv.config({ path: rootEnvPath });
    }
}
function getAddresses() {
    loadEnv();
    return {
        CTF_ADDRESS: process.env.CTF_ADDRESS || "",
        EXCHANGE_ADDRESS: process.env.EXCHANGE_ADDRESS || "",
        MARKET_FACTORY_ADDRESS: process.env.MARKET_FACTORY_ADDRESS || "",
        USDF_ADDRESS: process.env.USDF_ADDRESS || "",
    };
}
function updateEnvFile(filePath, key, value) {
    let content = "";
    if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, "utf8");
    }
    const lines = content.split("\n");
    const keyIndex = lines.findIndex(line => line.startsWith(key + "="));
    if (keyIndex !== -1) {
        lines[keyIndex] = `${key}=${value}`;
    }
    else {
        lines.push(`${key}=${value}`);
    }
    fs.writeFileSync(filePath, lines.join("\n"));
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("hardhat/config");
const addresses_js_1 = require("../lib/addresses.js");
(0, config_1.task)("check:code", "Check if address has bytecode")
    .addParam("address", "The contract address to check")
    .setAction(async ({ address }, hre) => {
    const code = await hre.ethers.provider.getCode(address);
    const hasCode = code !== "0x" && code.length > 2;
    console.log(`Address: ${address}`);
    console.log(`Has code: ${hasCode}`);
    console.log(`Code length: ${code.length - 2} bytes`);
    if (hasCode) {
        console.log(`First 20 bytes: ${code.substring(0, 42)}`);
    }
});
(0, config_1.task)("ping:contracts", "Check all configured contract addresses")
    .setAction(async (_, hre) => {
    const addresses = (0, addresses_js_1.getAddresses)();
    console.log("\n=== Contract Address Verification ===\n");
    const checks = [
        { name: "CTF", address: addresses.CTF_ADDRESS },
        { name: "Exchange", address: addresses.EXCHANGE_ADDRESS },
        { name: "MarketFactory", address: addresses.MARKET_FACTORY_ADDRESS },
        { name: "USDF", address: addresses.USDF_ADDRESS },
    ];
    for (const { name, address } of checks) {
        if (!address) {
            console.log(`❌ ${name.padEnd(15)} - NOT CONFIGURED`);
            continue;
        }
        try {
            const code = await hre.ethers.provider.getCode(address);
            const hasCode = code !== "0x" && code.length > 2;
            const codeSize = (code.length - 2) / 2;
            if (hasCode) {
                console.log(`✅ ${name.padEnd(15)} ${address} (${codeSize} bytes)`);
            }
            else {
                console.log(`❌ ${name.padEnd(15)} ${address} (NO CODE)`);
            }
        }
        catch (error) {
            console.log(`❌ ${name.padEnd(15)} ${address} (ERROR: ${error})`);
        }
    }
    console.log();
});
(0, config_1.task)("print:addrs", "Print all configured addresses")
    .setAction(async () => {
    const addresses = (0, addresses_js_1.getAddresses)();
    console.log("\n=== Configured Contract Addresses ===\n");
    Object.entries(addresses).forEach(([key, value]) => {
        const display = value || "(not set)";
        console.log(`${key.padEnd(25)} = ${display}`);
    });
    console.log();
});

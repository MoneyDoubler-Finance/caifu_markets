export const COLLATERAL = {
  symbol: "USDF",
  address: {
    56: "0x5A110fC00474038f6c02E89C707D638602EA44B5", // BSC mainnet
    97: process.env.USDF_TESTNET_ADDRESS || "",        // placeholder for testnet fork
  },
  decimals: 18,
} as const;

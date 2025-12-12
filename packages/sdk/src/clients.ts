/**
 * Shared Viem clients for all backend services
 * Provides consistent RPC connection across API, Matcher, Settlement Worker, and Frontend utilities
 */

import { createPublicClient, createWalletClient, fallback, http, webSocket, type PublicClient, type WalletClient } from 'viem';
import { defineChain } from 'viem/utils';
import { ENV } from '@caifu/config';

// Define BSC chain based on CHAIN_ID
export const chain = defineChain({
  id: ENV.CHAIN_ID,
  name: ENV.CHAIN_ID === 56 ? 'BSC Mainnet' : 'BSC Testnet',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: {
    default: {
      http: [ENV.RPC_HTTP_URL, ENV.RPC_HTTP_FALLBACK_URL].filter(Boolean),
      webSocket: ENV.RPC_WS_URL ? [ENV.RPC_WS_URL] : [],
    },
    public: {
      http: [ENV.RPC_HTTP_URL, ENV.RPC_HTTP_FALLBACK_URL].filter(Boolean),
      webSocket: ENV.RPC_WS_URL ? [ENV.RPC_WS_URL] : [],
    },
  },
  blockExplorers: {
    default: {
      name: ENV.CHAIN_ID === 56 ? 'BscScan' : 'BscScan Testnet',
      url: ENV.CHAIN_ID === 56 ? 'https://bscscan.com' : 'https://testnet.bscscan.com',
    },
  },
});

const httpTransports = [
  http(ENV.RPC_HTTP_URL),
  ...(ENV.RPC_HTTP_FALLBACK_URL && ENV.RPC_HTTP_FALLBACK_URL !== ENV.RPC_HTTP_URL
    ? [http(ENV.RPC_HTTP_FALLBACK_URL)]
    : []),
];

const sharedHttpTransport =
  httpTransports.length > 1
    ? fallback(httpTransports, { rank: true, retryCount: 1 })
    : httpTransports[0];

// HTTP Public Client (always available)
export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: sharedHttpTransport,
});

// WebSocket Public Client (optional, prefers dedicated ALCHEMY_WS_URL if set)
const wsUrl = ENV.ALCHEMY_WS_URL || ENV.RPC_WS_URL;
export const wsClient: PublicClient | undefined = wsUrl
  ? createPublicClient({
      chain,
      transport: webSocket(wsUrl),
    })
  : undefined;

/**
 * Create a wallet client with a specific account
 * @param account - The account object or address to use
 * @returns WalletClient instance
 */
export const makeWalletClient = (account: any): WalletClient => {
  return createWalletClient({
    chain,
    transport: sharedHttpTransport,
    account,
  });
};

/**
 * Wait for transaction receipt with timeout
 * @param hash - Transaction hash
 * @param timeout - Timeout in milliseconds (default 60s)
 * @returns Transaction receipt
 */
export async function waitReceiptWithTimeout(
  hash: `0x${string}`,
  timeout: number = 60000
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      // @ts-ignore - AbortSignal is supported but types may not reflect it
      signal: controller.signal,
    });
    return receipt;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Transaction receipt timeout after ${timeout}ms for hash: ${hash}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Export connection info for debugging
export const connectionInfo = {
  chainId: ENV.CHAIN_ID,
  httpUrl: ENV.RPC_HTTP_URL,
  httpFallbackUrl: ENV.RPC_HTTP_FALLBACK_URL,
  wsUrl: wsUrl || 'not configured',
  wsEnabled: Boolean(wsUrl),
};

export const httpTransport = sharedHttpTransport;

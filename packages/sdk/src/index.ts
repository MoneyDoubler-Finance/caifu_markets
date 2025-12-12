import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type PublicClient,
  type WalletClient,
  type Hash,
  type Address,
  type Hex,
  encodePacked,
  keccak256,
  toBytes,
  type TypedDataDomain,
  type TypedDataParameter,
  hashTypedData,
  verifyTypedData,
  type SignTypedDataReturnType,
  type Account
} from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import * as abis from './abis'

// Contract addresses (will be populated from config)
export interface ContractAddresses {
  conditionalTokens: Address
  marketFactory: Address
  exchange: Address
  usdf: Address
}

// Order types for EIP-712
export interface Order {
  maker: Address
  taker: Address
  marketId: Hex
  outcome: bigint
  side: OrderSide
  price: bigint
  size: bigint
  nonce: bigint
  expiry: bigint
}

export enum OrderSide {
  Buy = 0,
  Sell = 1
}

export enum OrderStatus {
  Open = 0,
  Filled = 1,
  Cancelled = 2
}

// EIP-712 domain and types
const DOMAIN_NAME = 'CaifuExchange'
const DOMAIN_VERSION = '1'

const ORDER_TYPE: Record<string, TypedDataParameter[]> = {
  Order: [
    { name: 'maker', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'marketId', type: 'bytes32' },
    { name: 'outcome', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'price', type: 'uint256' },
    { name: 'size', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' }
  ]
}

// Caifu SDK class
export class CaifuSDK {
  private publicClient: PublicClient
  private walletClient?: WalletClient
  private addresses: ContractAddresses
  private account?: PrivateKeyAccount | Address
  private chainId: bigint

  constructor(
    rpcUrl: string,
    addresses: ContractAddresses,
    privateKey?: Hex,
    account?: Address,
    chainId?: number,
    fallbackRpcUrl?: string
  ) {
    this.addresses = addresses
    this.chainId = BigInt(chainId || 97)  // Default to BSC testnet

    const transport =
      fallbackRpcUrl && fallbackRpcUrl !== rpcUrl
        ? fallback([http(rpcUrl), http(fallbackRpcUrl)], { retryCount: 2 })
        : http(rpcUrl)

    // Create public client
    this.publicClient = createPublicClient({
      transport
    })

    // Create wallet client if private key provided
    if (privateKey) {
      const viemAccount = privateKeyToAccount(privateKey)
      this.account = viemAccount  // Store full LocalAccount, not just address
      this.walletClient = createWalletClient({
        account: viemAccount,
        transport
      })
    } else if (account) {
      this.account = account
    }
  }

  // Helper to get address from account
  private getAddress(): Address {
    if (!this.account) throw new Error('Account not available')
    return typeof this.account === 'string' ? this.account : this.account.address
  }

  // Contract interaction methods
  async prepareCondition(
    oracle: Address,
    questionId: Hex,
    outcomeSlotCount: bigint
  ): Promise<Hash> {
    if (!this.walletClient || !this.account) throw new Error('Wallet client not available')

    const { request } = await this.publicClient.simulateContract({
      account: this.getAddress(),
      address: this.addresses.conditionalTokens,
      abi: abis.CONDITIONAL_TOKENS_ABI,
      functionName: 'prepareCondition',
      args: [oracle, questionId, outcomeSlotCount]
    })

    return this.walletClient.writeContract(request)
  }

  async createBinaryMarket(
    title: string,
    questionId: Hex,
    oracle: Address,
    openTime: bigint,
    closeTime: bigint
  ): Promise<Hash> {
    if (!this.walletClient || !this.account) throw new Error('Wallet client not available')

    const { request } = await this.publicClient.simulateContract({
      account: this.getAddress(),
      address: this.addresses.marketFactory,
      abi: abis.MARKET_FACTORY_ABI,
      functionName: 'createBinaryMarket',
      args: [title, questionId, oracle, openTime, closeTime]
    })

    return this.walletClient.writeContract(request)
  }

  async getMarket(marketId: bigint) {
    return this.publicClient.readContract({
      address: this.addresses.marketFactory,
      abi: abis.MARKET_FACTORY_ABI,
      functionName: 'getMarket',
      args: [marketId]
    })
  }

  async splitPosition(
    collateralToken: Address,
    parentCollectionId: Hex,
    conditionId: Hex,
    partition: bigint[],
    amount: bigint
  ): Promise<Hash> {
    if (!this.walletClient || !this.account) throw new Error('Wallet client not available')

    const { request } = await this.publicClient.simulateContract({
      account: this.getAddress(),
      address: this.addresses.conditionalTokens,
      abi: abis.CONDITIONAL_TOKENS_ABI,
      functionName: 'splitPosition',
      args: [collateralToken, parentCollectionId, conditionId, partition, amount]
    })

    return this.walletClient.writeContract(request)
  }

  async mergePositions(
    collateralToken: Address,
    parentCollectionId: Hex,
    conditionId: Hex,
    partition: bigint[],
    amount: bigint
  ): Promise<Hash> {
    if (!this.walletClient || !this.account) throw new Error('Wallet client not available')

    const { request } = await this.publicClient.simulateContract({
      account: this.getAddress(),
      address: this.addresses.conditionalTokens,
      abi: abis.CONDITIONAL_TOKENS_ABI,
      functionName: 'mergePositions',
      args: [collateralToken, parentCollectionId, conditionId, partition, amount]
    })

    return this.walletClient.writeContract(request)
  }

  async redeemPositions(
    collateralToken: Address,
    parentCollectionId: Hex,
    conditionId: Hex,
    indexSets: bigint[]
  ): Promise<Hash> {
    if (!this.walletClient || !this.account) throw new Error('Wallet client not available')

    const { request } = await this.publicClient.simulateContract({
      account: this.getAddress(),
      address: this.addresses.conditionalTokens,
      abi: abis.CONDITIONAL_TOKENS_ABI,
      functionName: 'redeemPositions',
      args: [collateralToken, parentCollectionId, conditionId, indexSets]
    })

    return this.walletClient.writeContract(request)
  }

  async createOrder(order: Order, signature: Hex): Promise<Hash> {
    if (!this.walletClient || !this.account) throw new Error('Wallet client not available')

    const { request } = await this.publicClient.simulateContract({
      account: this.getAddress(),
      address: this.addresses.exchange,
      abi: abis.EXCHANGE_ABI,
      functionName: 'createOrder',
      args: [order, signature] as any
    })

    return this.walletClient.writeContract(request)
  }

  async fillOrders(
    orders: Order[],
    signatures: Hex[],
    fillSizes: bigint[]
  ): Promise<Hash> {
    if (!this.walletClient || !this.account) throw new Error('Wallet client not available')

    const { request } = await this.publicClient.simulateContract({
      account: this.getAddress(),
      address: this.addresses.exchange,
      abi: abis.EXCHANGE_ABI,
      functionName: 'fillOrders',
      args: [orders, signatures, fillSizes] as any
    })

    return this.walletClient.writeContract(request)
  }

  async cancelOrder(order: Order, signature: Hex): Promise<Hash> {
    if (!this.walletClient || !this.account) throw new Error('Wallet client not available')

    const { request } = await this.publicClient.simulateContract({
      account: this.getAddress(),
      address: this.addresses.exchange,
      abi: abis.EXCHANGE_ABI,
      functionName: 'cancelOrder',
      args: [order, signature] as any
    })

    return this.walletClient.writeContract(request)
  }

  async resolveMarket(
    questionId: Hex,
    payoutNumerators: bigint[]
  ): Promise<Hash> {
    if (!this.walletClient || !this.account) throw new Error('Wallet client not available')

    const { request } = await this.publicClient.simulateContract({
      account: this.getAddress(),
      address: this.addresses.conditionalTokens,
      abi: abis.CONDITIONAL_TOKENS_ABI,
      functionName: 'reportPayouts',
      args: [questionId, payoutNumerators]
    })

    return this.walletClient.writeContract(request)
  }

  // EIP-712 helpers
  getDomainSeparator(chainId: bigint): Hex {
    // Compute EIP-712 domain separator hash
    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId,
      verifyingContract: this.addresses.exchange
    }
    // For domain separator, we hash just the domain without a message
    const typeHash = keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'))
    const nameHash = keccak256(toBytes(DOMAIN_NAME))
    const versionHash = keccak256(toBytes(DOMAIN_VERSION))
    return keccak256(
      encodePacked(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [typeHash, nameHash, versionHash, chainId, domain.verifyingContract]
      )
    ) as Hex
  }

  hashOrder(order: Order): Hex {
    return hashTypedData({
      domain: {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: this.chainId,
        verifyingContract: this.addresses.exchange
      },
      types: ORDER_TYPE,
      primaryType: 'Order',
      message: {
        maker: order.maker,
        taker: order.taker,
        marketId: order.marketId,
        outcome: order.outcome,
        side: order.side,
        price: order.price,
        size: order.size,
        nonce: order.nonce,
        expiry: order.expiry
      }
    }) as Hex
  }

  async signOrder(order: Order): Promise<Hex> {
    if (!this.walletClient || !this.account) throw new Error('Wallet client not available')

    const signature = await this.walletClient.signTypedData({
      account: this.account,
      domain: {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: this.chainId,
        verifyingContract: this.addresses.exchange
      },
      types: ORDER_TYPE,
      primaryType: 'Order',
      message: {
        maker: order.maker,
        taker: order.taker,
        marketId: order.marketId,
        outcome: order.outcome,
        side: order.side,
        price: order.price,
        size: order.size,
        nonce: order.nonce,
        expiry: order.expiry
      }
    })

    return signature
  }

  async verifyOrderSignature(order: Order, signature: Hex): Promise<boolean> {
    try {
      // viem v2: verifyTypedData returns Promise<boolean> (true if signature is valid for given address)
      return await verifyTypedData({
        address: order.maker,
        domain: {
          name: DOMAIN_NAME,
          version: DOMAIN_VERSION,
          chainId: this.chainId,
          verifyingContract: this.addresses.exchange
        },
        types: ORDER_TYPE,
        primaryType: 'Order',
        message: {
          maker: order.maker,
          taker: order.taker,
          marketId: order.marketId,
          outcome: order.outcome,
          side: order.side,
          price: order.price,
          size: order.size,
          nonce: order.nonce,
          expiry: order.expiry
        },
        signature
      })
    } catch {
      return false
    }
  }

  // Utility methods - CTF-compatible position ID calculation
  getPositionId(collateralToken: Address, collectionId: Hex): bigint {
    // CTF uses abi.encodePacked for position ID
    return BigInt(keccak256(encodePacked(['address', 'bytes32'], [collateralToken, collectionId])))
  }

  getCollectionId(parentCollectionId: Hex, conditionId: Hex, partition: bigint[]): Hex {
    // CTF uses abi.encodePacked for collectionId
    // partition is a uint256[] array
    return keccak256(encodePacked(['bytes32', 'bytes32', 'uint256[]'], [parentCollectionId, conditionId, partition])) as Hex
  }
  
  // Helper to get position ID for a specific outcome (compatible with Exchange)
  getPositionIdForOutcome(collateralToken: Address, conditionId: Hex, outcome: number): bigint {
    // For binary markets: outcome 0 = YES (indexSet 1), outcome 1 = NO (indexSet 2)
    const indexSet = outcome === 0 ? 1n : 2n
    const parentCollectionId = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex
    const collectionId = this.getCollectionId(parentCollectionId, conditionId, [indexSet])
    return this.getPositionId(collateralToken, collectionId)
  }

  getConditionId(oracle: Address, questionId: Hex, outcomeSlotCount: bigint): Hex {
    return keccak256(encodePacked(['address', 'bytes32', 'uint256'], [oracle, questionId, outcomeSlotCount])) as Hex
  }

  // Read-only methods
  async getOrderStatus(orderHash: Hex): Promise<OrderStatus> {
    const status = await this.publicClient.readContract({
      address: this.addresses.exchange,
      abi: abis.EXCHANGE_ABI,
      functionName: 'orderStatus',
      args: [orderHash]
    })
    return status as OrderStatus
  }

  async getOrderFilledAmount(orderHash: Hex): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.exchange,
      abi: abis.EXCHANGE_ABI,
      functionName: 'orderFilled',
      args: [orderHash]
    })
  }

  async getUserNonce(user: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.exchange,
      abi: abis.EXCHANGE_ABI,
      functionName: 'getNonce',
      args: [user]
    })
  }

  async getTradeCount(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.exchange,
      abi: abis.EXCHANGE_ABI,
      functionName: 'getTradeCount'
    })
  }

  async getTrade(index: bigint) {
    return this.publicClient.readContract({
      address: this.addresses.exchange,
      abi: abis.EXCHANGE_ABI,
      functionName: 'getTrade',
      args: [index]
    })
  }

  async isConditionPrepared(conditionId: Hex): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.addresses.conditionalTokens,
      abi: abis.CONDITIONAL_TOKENS_ABI,
      functionName: 'isConditionPrepared',
      args: [conditionId]
    })
  }

  async arePayoutsReported(conditionId: Hex): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.addresses.conditionalTokens,
      abi: abis.CONDITIONAL_TOKENS_ABI,
      functionName: 'arePayoutsReported',
      args: [conditionId]
    })
  }

  async getPayout(conditionId: Hex, index: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.conditionalTokens,
      abi: abis.CONDITIONAL_TOKENS_ABI,
      functionName: 'getPayout',
      args: [conditionId, index]
    })
  }

  async balanceOf(account: Address, id: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.conditionalTokens,
      abi: abis.CONDITIONAL_TOKENS_ABI,
      functionName: 'balanceOf',
      args: [account, id]
    })
  }
}

// Export types and ABIs
export * from './abis'
export { abis }

// Export shared clients
export * from './clients'
export { publicClient, wsClient, makeWalletClient } from './clients'

// Address management
export interface ContractAddresses {
  conditionalTokens: Address
  marketFactory: Address
  exchange: Address
  usdf: Address
}

/**
 * Get contract addresses for a specific chain
 * @param chainId The chain ID (56 for BSC mainnet, 97 for testnet)
 * @returns Contract addresses for the specified chain
 */
export function getAddresses(chainId: number): ContractAddresses {
  const addressesPath = `../../config/addresses.${chainId}.json`

  try {
    // Dynamic import for Node.js environment
    const fs = require('fs')
    const path = require('path')

    const fullPath = path.resolve(__dirname, addressesPath)
    const addresses = JSON.parse(fs.readFileSync(fullPath, 'utf8'))

    return {
      conditionalTokens: addresses.ctf as Address,
      marketFactory: addresses.marketFactory as Address,
      exchange: addresses.exchange as Address,
      usdf: addresses.usdf as Address
    }
  } catch (error) {
    throw new Error(`Failed to load addresses for chain ${chainId}. Make sure addresses.${chainId}.json exists.`)
  }
}

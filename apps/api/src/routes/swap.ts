import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createPublicClient, formatEther, http, parseEther } from 'viem'

import { getUSDF_MainnetContract } from '../lib/contracts'

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/i

const positiveAmount = (field: string) =>
  z.string().refine((value) => {
    try {
      return parseEther(value) > 0n
    } catch {
      return false
    }
  }, `${field} must be a positive decimal string`)

const SwapRequestSchema = z.discriminatedUnion('direction', [
  z.object({
    direction: z.literal('buy'),
    userAddress: z.string().regex(ADDRESS_REGEX, 'Invalid address'),
    bnbAmount: positiveAmount('bnbAmount'),
  }),
  z.object({
    direction: z.literal('sell'),
    userAddress: z.string().regex(ADDRESS_REGEX, 'Invalid address'),
    usdfAmount: positiveAmount('usdfAmount'),
  }),
])

const WAD = 1_000_000_000_000_000_000n

const swapRoutes: FastifyPluginAsync = async (fastify) => {
  const rpcUrl = process.env.RPC_HTTP_URL || process.env.RPC_URL || 'http://127.0.0.1:8545'

  const vendingMachine = getUSDF_MainnetContract()
  if (!vendingMachine) {
    throw new Error('USDF_ADDRESS is not configured. Set this env before enabling /api/swap')
  }

  const chain = {
    id: Number(process.env.CHAIN_ID || 56),
    name: Number(process.env.CHAIN_ID || 56) === 56 ? 'BNB Smart Chain' : 'BSC Testnet',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  fastify.post('/api/swap', async (request, reply) => {
    try {
      const body = SwapRequestSchema.parse(request.body)
      const { direction, userAddress } = body

      const rate = await publicClient.readContract({
        address: vendingMachine.address,
        abi: vendingMachine.abi,
        functionName: 'rate',
      }) as bigint

      if (rate <= 0n) {
        throw new Error('USDF_Mainnet returned invalid rate')
      }

      if (direction === 'buy') {
        const bnbValueWei = parseEther(body.bnbAmount)
        const usdfOut = (bnbValueWei * rate) / WAD

        return reply.send({
          success: true,
          direction,
          userAddress,
          bnbAmount: body.bnbAmount,
          usdfAmount: formatEther(usdfOut),
          note: 'Execute this swap directly against USDF_Mainnet from your wallet',
        })
      }

      const usdfAmountWei = parseEther(body.usdfAmount)
      const bnbOut = (usdfAmountWei * WAD) / rate

      return reply.send({
        success: true,
        direction,
        userAddress,
        usdfAmount: body.usdfAmount,
        bnbAmount: formatEther(bnbOut),
        note: 'Execute this swap directly against USDF_Mainnet from your wallet',
      })
    } catch (error: any) {
      fastify.log.error({ error: error.message, stack: error.stack }, 'Swap quote failed')

      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_error',
          details: error.errors,
        })
      }

      return reply.code(500).send({
        error: 'swap_failed',
        message: error?.message || 'An unexpected error occurred',
      })
    }
  })
}

export default swapRoutes

import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { ENV } from '@caifu/config'
import { publicClient, makeWalletClient } from '@caifu/sdk'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getCTFContract, getFPMMContract, getUSDFContract, resolvePositionId } from '../lib/contracts'

const ONE = 10n ** 18n
const MAX_BINARY_SEARCH_STEPS = 48

interface MarketRecord {
  id: string
  conditionId: string | null
  fpmmAddress: string | null
  title?: string
}

const normalizeWalletAddress = (value?: string): Address | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^0x[a-fA-F0-9]{40}$/i.test(trimmed)) {
    return null
  }
  return trimmed as Address
}

const ensureBigInt = (value: string, label: string): bigint => {
  try {
    const parsed = BigInt(value)
    if (parsed < 0n) throw new Error(`${label} must be positive`)
    return parsed
  } catch (err) {
    throw new Error(`${label} must be a valid integer string`)
  }
}

async function ensureSeededPool(fpmm: { address: Address; abi: any }) {
  const totalSupply = await publicClient.readContract({
    ...fpmm,
    functionName: 'totalSupply',
    args: [],
  }) as bigint
  if (totalSupply === 0n) {
    throw new Error('Pool not funded yet')
  }
}

async function readFee(fpmm: { address: Address; abi: any }) {
  return await publicClient.readContract({
    ...fpmm,
    functionName: 'fee',
    args: [],
  }) as bigint
}

async function quoteBuy(
  fpmm: { address: Address; abi: any },
  conditionId: Hex,
  outcomeIndex: number,
  investmentAmount: bigint,
  fee: bigint
) : Promise<{ sharesOut: bigint; price: bigint; feeAmount: bigint }> {
  const outcome = BigInt(outcomeIndex)
  const sharesOut = await publicClient.readContract({
    ...fpmm,
    functionName: 'calcBuyAmount',
    args: [investmentAmount, outcome],
  }) as bigint

  const feeAmount = (investmentAmount * fee) / ONE
  const price = sharesOut > 0n ? (investmentAmount * ONE) / sharesOut : 0n

  return { sharesOut, price, feeAmount }
}

async function calcSellRequired(
  fpmm: { address: Address; abi: any },
  outcomeIndex: number,
  desiredReturn: bigint
) {
  return await publicClient.readContract({
    ...fpmm,
    functionName: 'calcSellAmount',
    args: [desiredReturn, BigInt(outcomeIndex)],
  }) as bigint
}

async function quoteSell(
  fpmm: { address: Address; abi: any },
  conditionId: Hex,
  outcomeIndex: number,
  outcomeTokens: bigint,
  fee: bigint
) : Promise<{ returnAmount: bigint; feeAmount: bigint; tokensToSell: bigint; price: bigint }> {
  if (outcomeTokens === 0n) {
    return { returnAmount: 0n, feeAmount: 0n, tokensToSell: 0n, price: 0n }
  }

  let low = 0n
  let high = outcomeTokens
  let bestReturn = 0n
  let tokensRequired = 0n

  for (let i = 0; i < MAX_BINARY_SEARCH_STEPS && low <= high; i++) {
    const mid = ((low + high) >> 1n) + (high > low ? 1n : 0n)
    const required = await calcSellRequired(fpmm, outcomeIndex, mid)
    if (required <= outcomeTokens) {
      bestReturn = mid
      tokensRequired = required
      low = mid
    } else {
      high = mid - 1n
    }
    if (high - low <= 1n) {
      const highRequired = await calcSellRequired(fpmm, outcomeIndex, high)
      if (highRequired <= outcomeTokens) {
        bestReturn = high
        tokensRequired = highRequired
      }
      break
    }
  }

  const feeAmount = bestReturn === 0n ? 0n : (bestReturn * fee) / (ONE - fee)
  const price = tokensRequired > 0n ? (bestReturn * ONE) / tokensRequired : 0n

  return { returnAmount: bestReturn, feeAmount, tokensToSell: tokensRequired, price }
}

const tradeRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app

  const fetchMarket = async (marketId: string): Promise<MarketRecord | null> => {
    return prisma.market.findUnique({
      where: { id: marketId },
      select: { id: true, conditionId: true, fpmmAddress: true, title: true },
    })
  }

  app.get('/quote', async (request, reply) => {
    const { marketId, outcome, amountIn, side } = request.query as {
      marketId?: string
      outcome?: string
      amountIn?: string
      side?: string
    }

    if (!marketId || !outcome || !amountIn) {
      return reply.status(400).send({ error: 'marketId, outcome, and amountIn required' })
    }

    const market = await fetchMarket(marketId)
    if (!market?.conditionId || !market.fpmmAddress) {
      return reply.status(404).send({ error: 'Market missing condition or FPMM address' })
    }

    const fpmm = getFPMMContract(market.fpmmAddress)
    if (!fpmm) {
      return reply.status(503).send({ error: 'FPMM not configured' })
    }

    try {
      await ensureSeededPool(fpmm)
    } catch (err: any) {
      return reply.status(409).send({ error: err.message || 'Pool not ready' })
    }

    const fee = await readFee(fpmm)
    const conditionId = market.conditionId as Hex
    const outcomeIndex = Number.parseInt(outcome)
    const amount = ensureBigInt(amountIn, 'amountIn')

    try {
      if (side === 'sell') {
        const { returnAmount, feeAmount, tokensToSell, price } = await quoteSell(fpmm, conditionId, outcomeIndex, amount, fee)
        return reply.send({
          conditionId,
          outcome: outcomeIndex,
          sharesIn: amount.toString(),
          usdfOut: returnAmount.toString(),
          price: price.toString(),
          fee: feeAmount.toString(),
          tokensToSell: tokensToSell.toString(),
        })
      }

      const { sharesOut, price, feeAmount } = await quoteBuy(fpmm, conditionId, outcomeIndex, amount, fee)
      return reply.send({
        conditionId,
        outcome: outcomeIndex,
        amountIn: amount.toString(),
        sharesOut: sharesOut.toString(),
        price: price.toString(),
        fee: feeAmount.toString(),
      })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  })

  app.post('/trade/buy', async (request, reply) => {
    const { marketId, outcome, amountIn, minOut } = request.body as {
      marketId?: string
      outcome?: number
      amountIn?: string
      minOut?: string
    }

    if (!marketId || outcome === undefined || !amountIn) {
      return reply.status(400).send({ error: 'marketId, outcome, and amountIn required' })
    }

    const market = await fetchMarket(marketId)
    if (!market?.conditionId || !market.fpmmAddress) {
      return reply.status(404).send({ error: 'Market missing condition or FPMM address' })
    }

    const fpmm = getFPMMContract(market.fpmmAddress)
    if (!fpmm) {
      return reply.status(503).send({ error: 'FPMM not configured' })
    }

    if (!process.env.DEPLOYER_PRIVATE_KEY) {
      return reply.status(500).send({ error: 'DEPLOYER_PRIVATE_KEY not configured' })
    }

    const conditionId = market.conditionId as Hex
    const investment = ensureBigInt(amountIn, 'amountIn')
    const minShares = minOut ? ensureBigInt(minOut, 'minOut') : 0n

    const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex)
    const walletClient = makeWalletClient(account)

    try {
      const hash = await walletClient.writeContract({
        ...fpmm,
        functionName: 'buy',
        args: [investment, BigInt(outcome), minShares],
        chain: null as any,
      } as any)

      return reply.send({
        txHash: hash,
        conditionId,
        outcome,
        amountIn,
      })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  })

  app.post('/trade/sell', async (request, reply) => {
    const { marketId, outcome, sharesIn, minOut } = request.body as {
      marketId?: string
      outcome?: number
      sharesIn?: string
      minOut?: string
    }

    if (!marketId || outcome === undefined || !sharesIn || !minOut) {
      return reply.status(400).send({ error: 'marketId, outcome, sharesIn, and minOut required' })
    }

    const market = await fetchMarket(marketId)
    if (!market?.conditionId || !market.fpmmAddress) {
      return reply.status(404).send({ error: 'Market missing condition or FPMM address' })
    }

    const fpmm = getFPMMContract(market.fpmmAddress)
    if (!fpmm) {
      return reply.status(503).send({ error: 'FPMM not configured' })
    }

    if (!process.env.DEPLOYER_PRIVATE_KEY) {
      return reply.status(500).send({ error: 'DEPLOYER_PRIVATE_KEY not configured' })
    }

    const maxTokens = ensureBigInt(sharesIn, 'sharesIn')
    const desiredReturn = ensureBigInt(minOut, 'minOut')

    const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex)
    const walletClient = makeWalletClient(account)

    try {
      const hash = await walletClient.writeContract({
        ...fpmm,
        functionName: 'sell',
        args: [desiredReturn, BigInt(outcome), maxTokens],
        chain: null as any,
      } as any)

      return reply.send({
        txHash: hash,
        conditionId: market.conditionId,
        outcome,
        sharesIn,
      })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  })

  const buildPortfolioSnapshot = async (userAddress: Address) => {
    const usdf = getUSDFContract()
    const ctf = getCTFContract()

    if (!usdf || !ctf) {
      const err = new Error('Contracts not configured') as Error & { statusCode?: number }
      err.statusCode = 503
      throw err
    }

    const [usdfBalance, bnbBalance] = await Promise.all([
      publicClient.readContract({
        ...usdf,
        functionName: 'balanceOf',
        args: [userAddress],
      }),
      publicClient.getBalance({ address: userAddress }),
    ])

    const markets = await prisma.market.findMany({
      where: { conditionId: { not: null }, fpmmAddress: { not: null } },
      select: { id: true, title: true, conditionId: true, fpmmAddress: true },
    })

    const positions = (
      await Promise.all(
        markets.map(async (market) => {
          try {
            const conditionId = market.conditionId as Hex
            const yesPositionId = await resolvePositionId(
              conditionId,
              0,
              ENV.USDF_ADDRESS as Address
            )
            const noPositionId = await resolvePositionId(
              conditionId,
              1,
              ENV.USDF_ADDRESS as Address
            )

            const [yesBalance, noBalance] = await Promise.all([
              publicClient.readContract({
                ...ctf,
                functionName: 'balanceOf',
                args: [userAddress, yesPositionId],
              }),
              publicClient.readContract({
                ...ctf,
                functionName: 'balanceOf',
                args: [userAddress, noPositionId],
              }),
            ])

            return {
              marketId: market.id,
              title: market.title,
              conditionId,
              yesBalance: yesBalance.toString(),
              noBalance: noBalance.toString(),
            }
          } catch {
            // If resolving a specific market's positions fails (e.g. condition not prepared),
            // skip that market instead of failing the entire portfolio snapshot.
            return null
          }
        })
      )
    ).filter((position): position is NonNullable<typeof position> => position !== null)

    return {
      owner: userAddress,
      bnbBalance: bnbBalance.toString(),
      usdfBalance: usdfBalance.toString(),
      positions,
    }
  }

  const sendPortfolioSnapshot = async (userAddress: Address, reply: FastifyReply) => {
    try {
      const snapshot = await buildPortfolioSnapshot(userAddress)
      return reply.send(snapshot)
    } catch (error: any) {
      const status = typeof error?.statusCode === 'number' ? error.statusCode : 500
      const message = error?.message || 'Failed to load portfolio'
      return reply.status(status).send({ error: message })
    }
  }

  app.get<{ Params: { owner: string } }>('/portfolio/:owner', async (request, reply) => {
    const normalized = normalizeWalletAddress(request.params.owner)
    if (!normalized) {
      return reply.status(400).send({ error: 'owner address required' })
    }

    return sendPortfolioSnapshot(normalized, reply)
  })

  app.get('/portfolio', async (request, reply) => {
    const { owner } = request.query as { owner?: string }

    const fallbackAddress = process.env.DEPLOYER_PRIVATE_KEY
      ? privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex).address
      : null

    const normalized = normalizeWalletAddress(owner || fallbackAddress || undefined)
    if (!normalized) {
      return reply.status(400).send({
        error: 'owner address required',
        hint: 'Call /api/portfolio/:owner instead of /api/portfolio?owner=…',
      })
    }

    return sendPortfolioSnapshot(normalized, reply)
  })

  app.get('/allowance', async (request, reply) => {
    const operatorAddress = process.env.DEPLOYER_PRIVATE_KEY
      ? privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex).address
      : null

    if (!operatorAddress) {
      return reply.status(500).send({ error: 'DEPLOYER_PRIVATE_KEY not configured' })
    }

    const usdf = getUSDFContract()
    const ctf = getCTFContract()

    if (!usdf || !ctf) {
      return reply.status(503).send({ error: 'Contracts not configured' })
    }

    try {
      const markets = await prisma.market.findMany({
        where: { fpmmAddress: { not: null } },
        select: { id: true, fpmmAddress: true, title: true },
      })

      const allowances = await Promise.all(
        markets.map(async (market) => {
          const fpmm = getFPMMContract(market.fpmmAddress)
          if (!fpmm) {
            return {
              marketId: market.id,
              title: market.title,
              fpmmAddress: market.fpmmAddress,
              usdfAllowance: '0',
              ctfApprovedForAll: false,
            }
          }

          const [usdfAllowance, ctfApproved] = await Promise.all([
            publicClient.readContract({
              ...usdf,
              functionName: 'allowance',
              args: [operatorAddress, fpmm.address],
            }),
            publicClient.readContract({
              ...ctf,
              functionName: 'isApprovedForAll',
              args: [operatorAddress, fpmm.address],
            }),
          ])

          return {
            marketId: market.id,
            title: market.title,
            fpmmAddress: market.fpmmAddress,
            usdfAllowance: (usdfAllowance as bigint).toString(),
            ctfApprovedForAll: Boolean(ctfApproved),
          }
        })
      )

      return reply.send({ owner: operatorAddress, allowances })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  })
}

export default tradeRoutes

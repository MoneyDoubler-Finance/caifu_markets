import { Prisma, PrismaClient } from '@prisma/client'
import { PublicClient, decodeEventLog } from 'viem'
import { FPMMABI } from './abi/FPMM'
import {
  insertTrade,
  insertLiquidityEvent,
  upsertCandle,
  truncateTo5m,
  formatFixed,
  ratioToFixed,
} from './metricsStore'

type BackfillResult = {
  trades: number
  liquidityEvents: number
  lastBlock: bigint | null
  yesReserve: bigint
  noReserve: bigint
}

function computeYesPriceScaled(yes: bigint, no: bigint): bigint {
  const total = yes + no
  if (total <= 0n) return 0n
  return (no * (10n ** 18n)) / total
}

function computeTVLScaled(yes: bigint, no: bigint): bigint {
  if (yes === 0n && no === 0n) return 0n
  const priceYes = computeYesPriceScaled(yes, no)
  const priceNo = (10n ** 18n) - priceYes
  const yesValue = (yes * priceYes) / (10n ** 18n)
  const noValue = (no * priceNo) / (10n ** 18n)
  return yesValue + noValue
}

function subtractWithFloor(value: bigint, delta: bigint): bigint {
  if (delta <= 0n) return value
  return value > delta ? value - delta : 0n
}

export async function backfillFpmmFromEtherscan(params: {
  prisma: PrismaClient
  publicClient: PublicClient
  fpmmAddress: `0x${string}`
  marketId: string
  etherscanKey: string
  chainId?: number
}): Promise<BackfillResult> {
  const { prisma, publicClient, fpmmAddress, marketId, etherscanKey, chainId } = params

  const baseUrl = 'https://api.etherscan.io/v2/api'
  const query = `module=account&action=txlist&address=${fpmmAddress}&sort=asc&apikey=${etherscanKey}`
  const effectiveChainId = chainId ?? 56
  const url = `${baseUrl}?chainid=${effectiveChainId}&${query}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`etherscan request failed: ${res.status}`)
  }
  const body: any = await res.json()
  if (body?.status !== '1' || !Array.isArray(body?.result)) {
    throw new Error(`etherscan returned no data: ${body?.message || 'unknown'}`)
  }

  let yesReserve = 0n
  let noReserve = 0n
  let liquidityEvents = 0
  let trades = 0
  let lastBlock: bigint | null = null

  for (const tx of body.result as any[]) {
    const txHash = tx.hash as `0x${string}`
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber })
    const ts = new Date(Number(block.timestamp) * 1000)
    lastBlock = receipt.blockNumber

    for (const log of receipt.logs) {
      if (!log.address || log.address.toLowerCase() !== fpmmAddress.toLowerCase()) continue
      try {
        const decoded: any = decodeEventLog({ abi: FPMMABI as any, data: log.data, topics: log.topics as any }) as any
        switch (decoded.eventName as string) {
          case 'FPMMFundingAdded': {
            const amounts = decoded.args?.amountsAdded as readonly bigint[] | undefined
            const yesAdded = amounts?.[0] ?? 0n
            const noAdded = amounts?.[1] ?? 0n
            yesReserve += yesAdded
            noReserve += noAdded
            liquidityEvents += 1
            await insertLiquidityEvent(prisma, {
              marketId,
              fpmmAddress,
              txHash,
              logIndex: Number(log.logIndex ?? 0n),
              blockNumber: Number(receipt.blockNumber),
              timestamp: ts,
              kind: yesReserve > 0n || noReserve > 0n ? 'add' : 'init',
              yesReserves: formatFixed(yesReserve, 18),
              noReserves: formatFixed(noReserve, 18),
              tvlUSDF: formatFixed(computeTVLScaled(yesReserve, noReserve), 18),
            })
            break
          }
          case 'FPMMBuy': {
            const investmentAmount = BigInt(decoded.args?.investmentAmount ?? 0n)
            const feeAmount = BigInt(decoded.args?.feeAmount ?? 0n)
            const outcomeIndex = Number(decoded.args?.outcomeIndex ?? 0)
            const outcomeTokensBought = BigInt(decoded.args?.outcomeTokensBought ?? 0n)
            const buyer = decoded.args?.buyer as string | undefined
            const netInvestment = investmentAmount > feeAmount ? investmentAmount - feeAmount : 0n

            // Spot-consistent reserve updates:
            // outcomeIndex 0 = YES, 1 = NO
            if (outcomeIndex === 0) {
              // Buy YES: pool gains NO collateral, loses YES shares.
              noReserve += netInvestment
              yesReserve = subtractWithFloor(yesReserve, outcomeTokensBought)
            } else if (outcomeIndex === 1) {
              // Buy NO: pool gains YES collateral, loses NO shares.
              yesReserve += netInvestment
              noReserve = subtractWithFloor(noReserve, outcomeTokensBought)
            }

            const execPriceStr = outcomeTokensBought > 0n ? ratioToFixed(investmentAmount, outcomeTokensBought, 18) : '0'
            const amountInStr = formatFixed(investmentAmount, 18)
            const amountOutStr = formatFixed(outcomeTokensBought, 18)
            const feeStr = feeAmount > 0n ? formatFixed(feeAmount, 18) : null

            await insertTrade(prisma, {
              marketId,
              fpmmAddress,
              txHash,
              logIndex: Number(log.logIndex ?? 0n),
              blockNumber: Number(receipt.blockNumber),
              timestamp: ts,
              side: 'buy',
              outcome: outcomeIndex,
              amountInUSDF: amountInStr,
              price: execPriceStr,
              amountOutShares: amountOutStr,
              feeUSDF: feeStr,
              taker: buyer ?? null,
              maker: fpmmAddress,
            })

            await insertLiquidityEvent(prisma, {
              marketId,
              fpmmAddress,
              txHash,
              logIndex: Number(log.logIndex ?? 0n),
              blockNumber: Number(receipt.blockNumber),
              timestamp: ts,
              kind: 'trade',
              yesReserves: formatFixed(yesReserve, 18),
              noReserves: formatFixed(noReserve, 18),
              tvlUSDF: formatFixed(computeTVLScaled(yesReserve, noReserve), 18),
            })

            await upsertCandle(prisma, {
              marketId,
              fpmmAddress,
              bucketStart: truncateTo5m(ts),
              // Spot after the trade, not execution price
              price: formatFixed(computeYesPriceScaled(yesReserve, noReserve), 18),
              volumeUSDF: amountInStr,
            })
            trades += 1
            break
          }
          case 'FPMMSell': {
            const returnAmount = BigInt(decoded.args?.returnAmount ?? 0n)
            const feeAmount = BigInt(decoded.args?.feeAmount ?? 0n)
            const outcomeIndex = Number(decoded.args?.outcomeIndex ?? 0)
            const outcomeTokensSold = BigInt(decoded.args?.outcomeTokensSold ?? 0n)
            const seller = decoded.args?.seller as string | undefined
            const totalOut = returnAmount + feeAmount

            // Mirror FPMMBuy, but in reverse: the pool receives outcome
            // tokens on the sold side and pays USDF from the opposite side.
            if (outcomeIndex === 0) {
              // Sell YES: receive YES shares, pay USDF from NO side.
              yesReserve += outcomeTokensSold
              noReserve = subtractWithFloor(noReserve, totalOut)
            } else if (outcomeIndex === 1) {
              // Sell NO: receive NO shares, pay USDF from YES side.
              noReserve += outcomeTokensSold
              yesReserve = subtractWithFloor(yesReserve, totalOut)
            }

            const execPriceStr = outcomeTokensSold > 0n ? ratioToFixed(returnAmount, outcomeTokensSold, 18) : '0'
            const amountOutStr = formatFixed(returnAmount, 18)
            const amountInShares = formatFixed(outcomeTokensSold, 18)
            const feeStr = feeAmount > 0n ? formatFixed(feeAmount, 18) : null

            await insertTrade(prisma, {
              marketId,
              fpmmAddress,
              txHash,
              logIndex: Number(log.logIndex ?? 0n),
              blockNumber: Number(receipt.blockNumber),
              timestamp: ts,
              side: 'sell',
              outcome: outcomeIndex,
              amountInUSDF: amountOutStr,
              price: execPriceStr,
              amountOutShares: amountInShares,
              feeUSDF: feeStr,
              taker: seller ?? null,
              maker: fpmmAddress,
            })

            await insertLiquidityEvent(prisma, {
              marketId,
              fpmmAddress,
              txHash,
              logIndex: Number(log.logIndex ?? 0n),
              blockNumber: Number(receipt.blockNumber),
              timestamp: ts,
              kind: 'trade',
              yesReserves: formatFixed(yesReserve, 18),
              noReserves: formatFixed(noReserve, 18),
              tvlUSDF: formatFixed(computeTVLScaled(yesReserve, noReserve), 18),
            })

            await upsertCandle(prisma, {
              marketId,
              fpmmAddress,
              bucketStart: truncateTo5m(ts),
              // Spot after the trade, not execution price
              price: formatFixed(computeYesPriceScaled(yesReserve, noReserve), 18),
              volumeUSDF: amountOutStr,
            })
            trades += 1
            break
          }
          default:
            break
        }
      } catch (err) {
        // Skip non-FPMM events such as ERC20 Transfer
        continue
      }
    }
  }

  if (lastBlock) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE public.market_sync
      SET last_indexed_block = ${lastBlock}, updated_at = NOW()
      WHERE market_id = ${marketId}
    `)
  }

  return { trades, liquidityEvents, lastBlock, yesReserve, noReserve }
}

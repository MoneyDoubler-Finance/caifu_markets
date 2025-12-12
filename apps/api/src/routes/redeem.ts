import type { FastifyPluginAsync } from 'fastify';
import { ENV } from '@caifu/config';
import { getCTFContract, getUSDFContract, resolvePositionId } from '../lib/contracts';
import { publicClient, makeWalletClient } from '@caifu/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

const redeemRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app;

  app.post('/redeem', async (request, reply) => {
    const { marketId, owner } = request.body as {
      marketId?: string;
      owner?: string;
    };

    if (!marketId) {
      return reply.status(400).send({ error: 'marketId required' });
    }

    const ctf = getCTFContract();
    const usdf = getUSDFContract();
    if (!ctf || !usdf) {
      return reply.status(503).send({ error: 'CTF or USDF not configured' });
    }

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: { conditionId: true, status: true, resolutionData: true, ctfVersion: true },
    });

    if (!market?.conditionId) {
      return reply.status(404).send({ error: 'Market not found or missing conditionId' });
    }

    if (market.status !== 'resolved') {
      return reply.status(400).send({ error: 'Market not resolved yet' });
    }

    const ctfVersion = market.ctfVersion || 1;
    
    if (ctfVersion === 1) {
      return reply.status(400).send({ 
        error: 'Legacy market (CTF v1): redeem not supported. This market was created with the old CTF contract that has a redeem bug.',
        marketId,
        ctfVersion: 1,
      });
    }

    const conditionId = market.conditionId as Hex;
    const parentCollectionId = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
    
    if (!process.env.DEPLOYER_PRIVATE_KEY) {
      return reply.status(500).send({ error: 'DEPLOYER_PRIVATE_KEY not configured' });
    }

    const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
    const ownerAddress = (owner || account.address) as Address;

    // Get USDF balance before
    const usdfBalanceBefore = await publicClient.readContract({
      ...usdf,
      functionName: 'balanceOf',
      args: [ownerAddress],
    });

    // CTFv2: redeem single winning position using indexSets
    const winningOutcome = (market.resolutionData as any)?.outcome || 0;
    const winningIndexSet = 1n << BigInt(winningOutcome);
    const winningPositionId = await resolvePositionId(conditionId, winningOutcome, ENV.USDF_ADDRESS as Address);
    
    const positionBalance = await publicClient.readContract({
      ...ctf,
      functionName: 'balanceOf',
      args: [ownerAddress, winningPositionId],
    });
    
    if (positionBalance === 0n) {
      return reply.status(400).send({ 
        error: 'No winning position tokens to redeem',
        outcome: winningOutcome,
        positionBalance: '0'
      });
    }
    
    // CTFv2 takes indexSets array (not partition)
    const indexSets = [winningIndexSet];

    const walletClient = makeWalletClient(account);

    try {
      const hash = await walletClient.writeContract({
        ...ctf,
        functionName: 'redeemPositions',
        args: [ENV.USDF_ADDRESS as Address, parentCollectionId, conditionId, indexSets],
        chain: null as any,
      } as any);

      // Wait for tx and get USDF balance after
      await publicClient.waitForTransactionReceipt({ hash });

      const usdfBalanceAfter = await publicClient.readContract({
        ...usdf,
        functionName: 'balanceOf',
        args: [ownerAddress],
      });

      const redeemed = usdfBalanceAfter - usdfBalanceBefore;

      return reply.send({
        txHash: hash,
        conditionId,
        owner: ownerAddress,
        usdfBefore: usdfBalanceBefore.toString(),
        usdfAfter: usdfBalanceAfter.toString(),
        redeemed: redeemed.toString(),
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
};

export default redeemRoutes;

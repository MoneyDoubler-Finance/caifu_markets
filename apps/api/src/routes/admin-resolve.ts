import type { FastifyPluginAsync } from 'fastify';
import { ENV } from '@caifu/config';
import { getOracleAdapterContract } from '../lib/contracts';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { makeWalletClient, publicClient } from '@caifu/sdk';
import { verifyAdminAuth, type AdminRequest } from '../middleware/adminAuth';

const adminResolveRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app;

  app.post('/admin/resolve', { preHandler: verifyAdminAuth }, async (request: AdminRequest, reply) => {
    const { marketId, outcome } = request.body as {
      marketId?: string;
      outcome?: number;
    };

    if (!marketId || outcome === undefined) {
      return reply.status(400).send({ error: 'marketId and outcome required' });
    }

    if (outcome !== 0 && outcome !== 1) {
      return reply.status(400).send({ error: 'outcome must be 0 (YES) or 1 (NO)' });
    }

    const adapter = getOracleAdapterContract();
    if (!adapter) {
      return reply.status(503).send({ error: 'Oracle adapter not configured' });
    }

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: { conditionId: true },
    });

    if (!market?.conditionId || !/^0x[0-9a-fA-F]{64}$/.test(market.conditionId)) {
      return reply.status(404).send({ error: 'Market not found or missing conditionId' });
    }

    // Build payout numerators: outcome 0 (YES) = [1,0], outcome 1 (NO) = [0,1]
    const payoutNumerators = outcome === 0 ? [1, 0] : [0, 1];

    if (!process.env.DEPLOYER_PRIVATE_KEY) {
      return reply.status(500).send({ error: 'DEPLOYER_PRIVATE_KEY not configured' });
    }

    const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
    const walletClient = makeWalletClient(account);

    try {
      const payoutVector = payoutNumerators.map((value) => BigInt(value));
      const { request: resolveRequest } = await publicClient.simulateContract({
        address: adapter.address,
        abi: adapter.abi,
        functionName: 'requestResolve',
        args: [market.conditionId as Hex, payoutVector],
        account,
      });
      const hash = await walletClient.writeContract(resolveRequest);
      await publicClient.waitForTransactionReceipt({ hash });

      // Update market status in DB
      await prisma.market.update({
        where: { id: marketId },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolutionData: { outcome, payoutNumerators },
        },
      });

      return reply.send({
        txHash: hash,
        conditionId: market.conditionId,
        outcome,
        payoutNumerators,
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
};

export default adminResolveRoutes;

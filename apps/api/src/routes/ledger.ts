import type { FastifyInstance } from 'fastify';
import type { LedgerService } from '../services/ledger.ts';
import type { Repository } from '../repository/types.ts';

export async function ledgerRoutes(app: FastifyInstance, ledger: LedgerService, repo: Repository): Promise<void> {
  app.get<{ Params: { collectorId: string }; Querystring: { limit?: string } }>(
    '/v1/collectors/:collectorId/ledger',
    async (request, reply) => {
      const collector = await repo.getCollector(request.params.collectorId);
      if (!collector) return reply.code(404).send({ error: 'collector_not_found' });
      return ledger.summary(request.params.collectorId, {
        limit: Math.min(Number(request.query.limit ?? 50), 200),
      });
    },
  );

  app.get<{ Params: { collectorId: string } }>('/v1/collectors/:collectorId', async (request, reply) => {
    const collector = await repo.getCollector(request.params.collectorId);
    if (!collector) return reply.code(404).send({ error: 'collector_not_found' });
    return collector;
  });
}

import type { FastifyInstance } from 'fastify';
import type { Repository } from '../repository/types.ts';

export async function recyclerRoutes(app: FastifyInstance, repo: Repository): Promise<void> {
  app.get<{ Querystring: { district?: string; authorizedOnly?: string } }>('/v1/recyclers', async (request) => {
    const recyclers = await repo.listRecyclers({
      district: request.query.district,
      // Default to authorised only. Surfacing unauthorised buyers by accident
      // would undo the point of the platform.
      authorizedOnly: request.query.authorizedOnly !== 'false',
    });
    return { recyclers };
  });

  app.get<{ Params: { recyclerId: string } }>('/v1/recyclers/:recyclerId', async (request, reply) => {
    const recycler = await repo.getRecycler(request.params.recyclerId);
    if (!recycler) return reply.code(404).send({ error: 'recycler_not_found' });
    return recycler;
  });

  app.get<{ Params: { recyclerId: string }; Querystring: { limit?: string } }>(
    '/v1/recyclers/:recyclerId/transactions',
    async (request) => {
      const transactions = await repo.listTransactions({
        recyclerId: request.params.recyclerId,
        limit: Math.min(Number(request.query.limit ?? 50), 200),
      });
      return { transactions };
    },
  );
}

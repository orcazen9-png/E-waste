import type { FastifyInstance } from 'fastify';
import type { Recycler } from '@ewaste/shared';
import type { Repository } from '../repository/types.ts';
import { requireAuth, requireSelf } from '../plugins/auth.ts';

/**
 * The list of authorised facilities is public, because "which buyers near me
 * are actually authorised?" is the question the platform exists to answer and
 * gating it behind a login would defeat the point.
 *
 * Rate cards and contact numbers are not public. Those are commercially
 * sensitive and a scraper's shopping list, so an unauthenticated caller gets a
 * directory entry and an authenticated one gets the full record.
 */
type DirectoryEntry = Omit<Recycler, 'offeredRatesInr' | 'contactPhone' | 'contactPersonName'>;

function toDirectoryEntry(recycler: Recycler): DirectoryEntry {
  const { offeredRatesInr, contactPhone, contactPersonName, ...directory } = recycler;
  void offeredRatesInr;
  void contactPhone;
  void contactPersonName;
  return directory;
}

export async function recyclerRoutes(app: FastifyInstance, repo: Repository): Promise<void> {
  app.get<{ Querystring: { district?: string; authorizedOnly?: string } }>(
    '/v1/recyclers',
    async (request) => {
      const recyclers = await repo.listRecyclers({
        district: request.query.district,
        // Default to authorised only. Surfacing unauthorised buyers by accident
        // would undo the point of the platform.
        authorizedOnly: request.query.authorizedOnly !== 'false',
      });
      return request.auth
        ? { recyclers }
        : { recyclers: recyclers.map(toDirectoryEntry), directoryOnly: true };
    },
  );

  app.get<{ Params: { recyclerId: string } }>('/v1/recyclers/:recyclerId', async (request, reply) => {
    const recycler = await repo.getRecycler(request.params.recyclerId);
    if (!recycler) return reply.code(404).send({ error: 'recycler_not_found' });
    return request.auth ? recycler : toDirectoryEntry(recycler);
  });

  app.get<{ Params: { recyclerId: string }; Querystring: { limit?: string } }>(
    '/v1/recyclers/:recyclerId/transactions',
    async (request, reply) => {
      // A facility's trading history is its own.
      if (!requireSelf(request, reply, 'recycler', request.params.recyclerId)) return reply;
      const transactions = await repo.listTransactions({
        recyclerId: request.params.recyclerId,
        limit: Math.min(Number(request.query.limit ?? 50), 200),
      });
      return { transactions };
    },
  );

  void requireAuth;
}

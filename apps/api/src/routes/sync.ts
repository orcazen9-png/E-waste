import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SyncService } from '../services/sync.ts';
import { requireKind, requireSelf } from '../plugins/auth.ts';

const pushBody = z.object({
  deviceId: z.string().min(1),
  collectorId: z.string().min(1),
  changes: z
    .array(
      z.object({
        changeId: z.string().min(1),
        entity: z.enum(['lot', 'material_item', 'handover', 'transaction', 'collector', 'rating']),
        entityId: z.string().min(1),
        op: z.enum(['upsert', 'delete']),
        payload: z.unknown(),
        clientUpdatedAt: z.string().datetime(),
        deviceId: z.string().min(1),
        attempts: z.number().int().nonnegative().default(0),
      }),
    )
    .max(200),
});

const pullBody = z.object({
  collectorId: z.string().min(1),
  cursor: z.string().optional(),
  districts: z.array(z.string()).default([]),
  knownPriceIndexVersion: z.string().optional(),
  knownRecyclerVersion: z.string().optional(),
});

export async function syncRoutes(app: FastifyInstance, sync: SyncService): Promise<void> {
  app.post('/v1/sync/push', async (request, reply) => {
    // Authenticate before parsing: an anonymous caller should not be able to
    // probe the request schema by watching validation errors come back.
    if (!requireKind(request, reply, 'collector')) return reply;
    const parsed = pushBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    if (!requireSelf(request, reply, 'collector', parsed.data.collectorId)) return reply;
    return sync.push(parsed.data as Parameters<SyncService['push']>[0]);
  });

  app.post('/v1/sync/pull', async (request, reply) => {
    if (!requireKind(request, reply, 'collector')) return reply;
    const parsed = pullBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    if (!requireSelf(request, reply, 'collector', parsed.data.collectorId)) return reply;
    return sync.pull(parsed.data);
  });
}

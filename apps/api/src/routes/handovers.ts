import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { HandoverService } from '../services/handover.ts';
import { HandoverError } from '../services/handover.ts';
import type { Repository } from '../repository/types.ts';
import { requireAuth, requireKind, requireSelf } from '../plugins/auth.ts';

const recordBody = z.object({
  deviceSecret: z.string().min(8),
  record: z.object({
    handoverRef: z.string().regex(/^HO-[0-9A-Z]{4}-[0-9A-Z]{4}$/),
    lotId: z.string().min(1),
    collectorId: z.string().min(1),
    recyclerId: z.string().min(1),
    verificationCode: z.string().regex(/^\d{6}$/),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    photoRefs: z.array(z.string()).default([]),
    photoHashes: z.array(z.string()).default([]),
    weighedWeightKg: z.number().positive(),
    declaredWeightKg: z.number().positive(),
    handoverPoint: z.object({ lat: z.number(), lon: z.number(), accuracyM: z.number().optional() }),
    handoverPlace: z.object({
      locality: z.string(),
      district: z.string(),
      state: z.string(),
      point: z.object({ lat: z.number(), lon: z.number() }).optional(),
    }),
    createdAt: z.string().datetime(),
    confirmationStatus: z.literal('pending').default('pending'),
  }),
});

const lookupBody = z
  .object({
    qr: z.string().optional(),
    handoverRef: z.string().optional(),
    verificationCode: z.string().optional(),
  })
  .refine((b) => b.qr || (b.handoverRef && b.verificationCode), {
    message: 'provide either qr, or handoverRef with verificationCode',
  });

// recyclerId is deliberately absent: it comes from the token. Accepting it in
// the body is how anyone could settle anyone else's handover.
const confirmBody = z.object({
  finalPriceInr: z.number().nonnegative(),
  paymentMode: z.enum(['cash', 'upi', 'bank_transfer']),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']),
  weighedWeightKg: z.number().positive().optional(),
});

export async function handoverRoutes(
  app: FastifyInstance,
  handovers: HandoverService,
  repo: Repository,
): Promise<void> {
  /** The phone uploads a slip it signed offline, possibly hours later. */
  app.post('/v1/handovers', async (request, reply) => {
    if (!requireKind(request, reply, 'collector')) return reply;
    const parsed = recordBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    // A collector may only upload their own slip.
    if (!requireSelf(request, reply, 'collector', parsed.data.record.collectorId)) return reply;
    try {
      const { record, flags } = await handovers.record(
        parsed.data.record as Parameters<HandoverService['record']>[0],
        parsed.data.deviceSecret,
      );
      return reply.code(201).send({ record, flags });
    } catch (error) {
      return sendHandoverError(reply, error);
    }
  });

  /** Recycler console: scan the QR, or type the reference and 6-digit code. */
  app.post('/v1/handovers/lookup', async (request, reply) => {
    if (!requireKind(request, reply, 'recycler')) return reply;
    const parsed = lookupBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    try {
      const found = parsed.data.qr
        ? await handovers.lookupByQr(parsed.data.qr)
        : await handovers.lookupByCode(parsed.data.handoverRef!, parsed.data.verificationCode!);
      if (!found) return reply.code(404).send({ error: 'handover_not_found' });
      return found;
    } catch (error) {
      return sendHandoverError(reply, error);
    }
  });

  app.post<{ Params: { handoverRef: string } }>('/v1/handovers/:handoverRef/confirm', async (request, reply) => {
    const auth = requireKind(request, reply, 'recycler');
    if (!auth) return reply;
    const parsed = confirmBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    try {
      return await handovers.confirm({
        handoverRef: request.params.handoverRef,
        recyclerId: auth.id,
        ...parsed.data,
      });
    } catch (error) {
      return sendHandoverError(reply, error);
    }
  });

  app.post<{ Params: { handoverRef: string }; Body: { reason?: string } }>(
    '/v1/handovers/:handoverRef/reject',
    async (request, reply) => {
      const auth = requireKind(request, reply, 'recycler');
      if (!auth) return reply;
      const { reason } = request.body ?? {};
      if (!reason) return reply.code(400).send({ error: 'reason is required' });
      try {
        return await handovers.reject(request.params.handoverRef, auth.id, reason);
      } catch (error) {
        return sendHandoverError(reply, error);
      }
    },
  );

  app.post<{ Params: { handoverRef: string }; Body: { status?: string } }>(
    '/v1/handovers/:handoverRef/downstream',
    async (request, reply) => {
      const auth = requireKind(request, reply, 'recycler');
      if (!auth) return reply;
      const { status } = request.body ?? {};
      const allowed = ['received', 'sorted', 'processed', 'reported_to_epr'] as const;
      if (!status || !allowed.includes(status as (typeof allowed)[number])) {
        return reply.code(400).send({ error: 'a valid status is required', allowed });
      }
      try {
        return await handovers.setDownstreamStatus(
          request.params.handoverRef,
          auth.id,
          status as (typeof allowed)[number],
        );
      } catch (error) {
        return sendHandoverError(reply, error);
      }
    },
  );

  app.get<{ Params: { handoverRef: string } }>('/v1/handovers/:handoverRef', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return reply;
    const record = await repo.getHandover(request.params.handoverRef);
    if (!record) return reply.code(404).send({ error: 'handover_not_found' });

    // Only the two parties to a handover can read it, and a non-party gets the
    // same 404 as a missing record rather than a 403 confirming it exists.
    const isParty =
      (auth.kind === 'recycler' && record.recyclerId === auth.id) ||
      (auth.kind === 'collector' && record.collectorId === auth.id);
    if (!isParty) return reply.code(404).send({ error: 'handover_not_found' });

    return { record, lot: await repo.getLot(record.lotId) };
  });

  /** The recycler's inbox: slips waiting to be confirmed. */
  app.get<{ Params: { recyclerId: string }; Querystring: { status?: string; limit?: string } }>(
    '/v1/recyclers/:recyclerId/handovers',
    async (request, reply) => {
      if (!requireSelf(request, reply, 'recycler', request.params.recyclerId)) return reply;
      const status = request.query.status as 'pending' | 'confirmed' | 'rejected' | undefined;
      const records = await repo.listHandovers({
        recyclerId: request.params.recyclerId,
        confirmationStatus: status,
        limit: Math.min(Number(request.query.limit ?? 50), 200),
      });
      const lots = await Promise.all(records.map((r) => repo.getLot(r.lotId)));
      return {
        handovers: records.map((record, i) => ({ record, lot: lots[i] })),
      };
    },
  );
}

/** Domain errors carry their own status and a translation key the app already knows. */
function sendHandoverError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof HandoverError) return reply.code(error.statusCode).send({ error: error.code });
  throw error;
}

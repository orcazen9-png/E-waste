import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MATERIAL_CATEGORIES, ALL_SUB_CATEGORY_IDS } from '@ewaste/shared';
import type { LotService } from '../services/lots.ts';
import type { MatchService } from '../services/matching.ts';
import { requireAuth, requireKind, requireSelf } from '../plugins/auth.ts';

const placeSchema = z.object({
  locality: z.string().min(1),
  district: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().regex(/^\d{6}$/).optional(),
  point: z
    .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), accuracyM: z.number().optional() })
    .optional(),
});

const createLotBody = z.object({
  lotId: z.string().min(1).optional(),
  collectorId: z.string().min(1),
  collectedAt: z.string().datetime().optional(),
  collectionPlace: placeSchema,
  notes: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        categoryId: z.enum(MATERIAL_CATEGORIES.map((c) => c.id) as [string, ...string[]]),
        subCategoryId: z.enum(ALL_SUB_CATEGORY_IDS as [string, ...string[]]),
        approxWeightKg: z.number().positive().max(5000),
        quantity: z.number().int().positive().max(10_000).optional(),
        condition: z.enum(['intact', 'partially_dismantled', 'broken', 'burnt', 'wet']),
        sourceType: z
          .enum(['household', 'shop', 'office', 'repair_shop', 'street_pickup', 'aggregator'])
          .optional(),
        description: z.string().max(300).optional(),
        imageRefs: z.array(z.string()).max(6).optional(),
        classificationSource: z.enum(['collector', 'model', 'recycler_corrected']).optional(),
        modelConfidence: z.number().min(0).max(1).optional(),
      }),
    )
    .min(1)
    .max(20),
});

const matchQuery = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  maxDistanceKm: z.coerce.number().positive().max(200).optional(),
  preferredPayment: z.enum(['cash', 'upi', 'bank_transfer']).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export async function lotRoutes(app: FastifyInstance, lots: LotService, matching: MatchService): Promise<void> {
  app.post('/v1/lots', async (request, reply) => {
    if (!requireKind(request, reply, 'collector')) return reply;
    const parsed = createLotBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    // A collector can only create lots for themselves.
    if (!requireSelf(request, reply, 'collector', parsed.data.collectorId)) return reply;

    // The phone may already hold this lot (it was created offline), so a
    // repeated POST with the same lotId must not create a second one.
    if (parsed.data.lotId) {
      const existing = await lots.get(parsed.data.lotId);
      if (existing) return reply.code(200).send(existing);
    }

    const lot = await lots.create(parsed.data as Parameters<LotService['create']>[0]);
    return reply.code(201).send(lot);
  });

  app.get<{ Params: { lotId: string } }>('/v1/lots/:lotId', async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return reply;
    const lot = await lots.get(request.params.lotId);
    if (!lot) return reply.code(404).send({ error: 'lot_not_found' });
    // Its collector, or the recycler it has been offered to. Nobody else.
    const isParty =
      (auth.kind === 'collector' && lot.collectorId === auth.id) ||
      (auth.kind === 'recycler' && lot.recyclerId === auth.id);
    if (!isParty) return reply.code(404).send({ error: 'lot_not_found' });
    return lot;
  });

  app.get<{ Params: { collectorId: string }; Querystring: { limit?: string } }>(
    '/v1/collectors/:collectorId/lots',
    async (request, reply) => {
      if (!requireSelf(request, reply, 'collector', request.params.collectorId)) return reply;
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      return { lots: await lots.listForCollector(request.params.collectorId, limit) };
    },
  );

  /** Ranked authorised buyers for this lot, with the reasons for the ranking. */
  app.get<{ Params: { lotId: string } }>('/v1/lots/:lotId/matches', async (request, reply) => {
    const parsed = matchQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });

    const auth = requireAuth(request, reply);
    if (!auth) return reply;
    const owned = await lots.get(request.params.lotId);
    if (!owned || (auth.kind === 'collector' && owned.collectorId !== auth.id)) {
      return reply.code(404).send({ error: 'lot_not_found' });
    }

    const { lat, lon, maxDistanceKm, preferredPayment, limit } = parsed.data;
    const result = await matching.forLot(request.params.lotId, {
      collectorPoint: lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
      maxDistanceKm,
      preferredPayment,
      limit,
    });
    if (!result) return reply.code(404).send({ error: 'lot_not_found' });
    return result;
  });
}

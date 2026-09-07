import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ALL_SUB_CATEGORY_IDS } from '@ewaste/shared';
import type { MlService } from '../services/ml.ts';
import { requireAuth } from '../plugins/auth.ts';

const classifyBody = z.object({
  imageRef: z.string().min(1),
  features: z.array(z.number()).optional(),
  district: z.string().optional(),
  recentSubCategoryIds: z.array(z.string()).max(20).optional(),
});

const valueBody = z.object({
  subCategoryId: z.enum(ALL_SUB_CATEGORY_IDS as [string, ...string[]]),
  weightKg: z.number().positive().max(5000),
  quantity: z.number().int().positive().optional(),
  condition: z.enum(['intact', 'partially_dismantled', 'broken', 'burnt', 'wet']),
  district: z.string().min(1),
});

const screenBody = z.object({
  district: z.string().min(1),
  collectorId: z.string().optional(),
  lotId: z.string().optional(),
  items: z
    .array(
      z.object({
        subCategoryId: z.string(),
        approxWeightKg: z.number().positive(),
        quantity: z.number().int().positive(),
        condition: z.enum(['intact', 'partially_dismantled', 'broken', 'burnt', 'wet']),
      }),
    )
    .min(1),
  declaredWeightKg: z.number().positive(),
  weighedWeightKg: z.number().positive().optional(),
  estimatedValueInr: z.number().nonnegative(),
  quotedPriceInr: z.number().nonnegative().optional(),
  finalPriceInr: z.number().nonnegative().optional(),
  photoHashes: z.array(z.string()).optional(),
});

export async function mlRoutes(app: FastifyInstance, ml: MlService): Promise<void> {
  app.post('/v1/ml/classify', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply;
    const parsed = classifyBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    return ml.classify(parsed.data);
  });

  app.post('/v1/ml/value', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply;
    const parsed = valueBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    return ml.value(parsed.data);
  });

  app.post('/v1/ml/screen', async (request, reply) => {
    if (!requireAuth(request, reply)) return reply;
    const parsed = screenBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    return ml.screenTransaction(parsed.data as Parameters<MlService['screenTransaction']>[0]);
  });
}

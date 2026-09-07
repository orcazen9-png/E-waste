import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthError, type AuthService } from '../services/auth.ts';
import { requireAuth } from '../plugins/auth.ts';
import type { Repository } from '../repository/types.ts';

const collectorRequest = z.object({ phone: z.string().min(6).max(20) });

const collectorVerify = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
  phone: z.string().min(6).max(20),
  deviceId: z.string().min(1).max(64),
  preferredLanguage: z.enum(['mr', 'hi', 'en']).optional(),
  district: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  platform: z.string().max(32).optional(),
  appVersion: z.string().max(32).optional(),
});

const recyclerRequest = z.object({ recyclerId: z.string().min(1) });
const recyclerVerify = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

export async function authRoutes(
  app: FastifyInstance,
  auth: AuthService,
  repo: Repository,
): Promise<void> {
  app.post('/v1/auth/collector/request', async (request, reply) => {
    const parsed = collectorRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'auth.invalid_phone' });
    try {
      return await auth.requestCollectorCode(parsed.data.phone);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/collector/verify', async (request, reply) => {
    const parsed = collectorVerify.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    try {
      return await auth.verifyCollectorCode(parsed.data);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/recycler/request', async (request, reply) => {
    const parsed = recyclerRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    try {
      return await auth.requestRecyclerCode(parsed.data.recyclerId);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/recycler/verify', async (request, reply) => {
    const parsed = recyclerVerify.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    try {
      return await auth.verifyRecyclerCode(parsed.data);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  /** Who am I? Lets a client check a stored token without guessing. */
  app.get('/v1/auth/me', async (request, reply) => {
    const context = requireAuth(request, reply);
    if (!context) return reply;
    if (context.kind === 'collector') {
      const collector = await repo.getCollector(context.id);
      return { kind: context.kind, id: context.id, deviceId: context.deviceId, collector };
    }
    const recycler = await repo.getRecycler(context.id);
    return { kind: context.kind, id: context.id, recycler };
  });
}

function sendAuthError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AuthError) {
    if (error.retryAfterSeconds) void reply.header('retry-after', String(error.retryAfterSeconds));
    return reply.code(error.statusCode).send({ error: error.code });
  }
  throw error;
}

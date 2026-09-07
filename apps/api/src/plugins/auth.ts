import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, type Principal } from '@ewaste/shared';
import type { Config } from '../config.ts';
import type { Repository } from '../repository/types.ts';

/**
 * Authentication and authorisation.
 *
 * The identity of the caller comes from the signed token and nowhere else.
 * Before this existed, `confirm` took the recycler id from the request body,
 * which meant anyone could settle anyone's handover. Route handlers now read
 * `request.auth`, and ids in a body are checked against it rather than trusted.
 */

export interface AuthContext {
  kind: Principal;
  /** Collector id or recycler id. */
  id: string;
  deviceId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * Attaches the decoding hook to the root instance.
 *
 * Deliberately NOT a Fastify plugin registered with `app.register`. Fastify
 * encapsulates plugins: a hook added inside one applies to that context and
 * its children, not to routes registered on the parent afterwards. Registering
 * this as a plugin silently left every guarded route seeing no token at all,
 * which fails closed (401 everywhere) but would fail open the moment a route
 * read an id from a body instead. Called directly, the hook is global.
 */
export function attachAuth(
  app: FastifyInstance,
  options: { config: Config; repository: Repository },
): void {
  const { config, repository } = options;

  // Decode on every request, but never reject here: public routes exist, and
  // each route decides for itself what it requires.
  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;

    const result = verifyToken(header.slice(7).trim(), config.tokenSecret);
    if (!result.valid) return;

    // A revoked device's tokens stop working immediately, without waiting for
    // the 90-day expiry. This is the only way to cut off a lost phone.
    if (result.payload.did) {
      const device = await repository.getDevice(result.payload.did);
      if (!device || device.revokedAt) return;
    }

    request.auth = {
      kind: result.payload.kind,
      id: result.payload.sub,
      deviceId: result.payload.did,
    };
  });
}

/** Requires any authenticated principal. */
export function requireAuth(request: FastifyRequest, reply: FastifyReply): AuthContext | undefined {
  if (!request.auth) {
    void reply.code(401).send({ error: 'auth.required' });
    return undefined;
  }
  return request.auth;
}

/** Requires a specific kind of principal. */
export function requireKind(
  request: FastifyRequest,
  reply: FastifyReply,
  kind: Principal,
): AuthContext | undefined {
  const auth = requireAuth(request, reply);
  if (!auth) return undefined;
  if (auth.kind !== kind) {
    void reply.code(403).send({ error: 'auth.wrong_principal', expected: kind });
    return undefined;
  }
  return auth;
}

/**
 * Requires the caller to be the principal named in the path or body.
 *
 * Returns 404, not 403, when a collector asks for someone else's record: a 403
 * confirms the id exists, which is an enumeration oracle over a list of people
 * whose earnings this is.
 */
export function requireSelf(
  request: FastifyRequest,
  reply: FastifyReply,
  kind: Principal,
  id: string,
): AuthContext | undefined {
  const auth = requireKind(request, reply, kind);
  if (!auth) return undefined;
  if (auth.id !== id) {
    void reply.code(404).send({ error: 'not_found' });
    return undefined;
  }
  return auth;
}

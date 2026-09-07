import type { FastifyInstance } from 'fastify';
import { MATERIAL_CATEGORIES, SAFETY_CARDS, BUNDLES, LANGUAGES } from '@ewaste/shared';

/**
 * Reference data the app caches on first run and refreshes rarely: the
 * pictorial taxonomy, the safety cards and the translation bundles. Shipping
 * translations from the server means a wording fix reaches the field without
 * an app-store update, which matters when the fix is to a safety instruction.
 */
export async function referenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/reference/taxonomy', async () => ({
    categories: MATERIAL_CATEGORIES,
    version: '1',
  }));

  app.get('/v1/reference/safety', async () => ({ cards: SAFETY_CARDS, version: '1' }));

  app.get('/v1/reference/languages', async () => ({ languages: LANGUAGES }));

  app.get<{ Params: { lang: string } }>('/v1/reference/strings/:lang', async (request, reply) => {
    const lang = request.params.lang as keyof typeof BUNDLES;
    const bundle = BUNDLES[lang];
    if (!bundle) return reply.code(404).send({ error: 'unknown_language' });
    return { lang, strings: bundle, version: '1' };
  });
}

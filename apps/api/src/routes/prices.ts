import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { speakPrice, getSubCategory, type LanguageCode } from '@ewaste/shared';
import type { PriceService } from '../services/prices.ts';

const boardQuery = z.object({
  district: z.string().min(1),
  lang: z.enum(['mr', 'hi', 'en']).default('mr'),
  categoryId: z.string().optional(),
});

const trendQuery = z.object({
  subCategoryId: z.string().min(1),
  district: z.string().min(1),
  window: z.enum(['7d', '30d']).default('30d'),
});

export async function priceRoutes(app: FastifyInstance, prices: PriceService): Promise<void> {
  /**
   * The price board. Every row carries `speak`, the text the phone hands to
   * its text-to-speech engine, so a collector who cannot read the number still
   * hears it. Generating it here keeps the spoken and printed price identical.
   */
  app.get('/v1/prices/board', async (request, reply) => {
    const parsed = boardQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    const { district, lang, categoryId } = parsed.data;

    const board = await prices.board(district);
    const filtered = categoryId ? board.filter((e) => e.categoryId === categoryId) : board;

    return {
      district,
      asOf: new Date().toISOString(),
      entries: filtered.map((entry) => ({
        ...entry,
        speak: speakPrice(lang as LanguageCode, entry.fairPriceInr, entry.unit === 'piece' ? 'piece' : 'kg'),
        glyph: getSubCategory(entry.subCategoryId).sub.glyph,
        labelKey: getSubCategory(entry.subCategoryId).sub.labelKey,
      })),
    };
  });

  app.get('/v1/prices/trend', async (request, reply) => {
    const parsed = trendQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    const { subCategoryId, district, window } = parsed.data;

    const result = await prices.trend(subCategoryId, district, window);
    if (!result) return reply.code(404).send({ error: 'no_price_data', subCategoryId, district });
    return { subCategoryId, district, ...result };
  });

  /**
   * The offline bundle. This is what the phone downloads so valuation works
   * with no connectivity; it is intentionally the same object the server uses.
   */
  app.get<{ Querystring: { district?: string } }>('/v1/prices/index', async (request) => {
    const index = await prices.getIndex(request.query.district);
    return index;
  });
}

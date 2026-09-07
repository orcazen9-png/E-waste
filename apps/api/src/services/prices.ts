import {
  ALL_SUB_CATEGORY_IDS,
  buildPriceIndex,
  computeTrend,
  getSubCategory,
  lookupStat,
  rateKey,
  NATIONAL,
  statKey,
  type PriceBoardEntry,
  type PriceIndex,
} from '@ewaste/shared';
import type { Repository } from '../repository/types.ts';

/**
 * Price discovery.
 *
 * The index is expensive to build and cheap to reuse, so it is cached per
 * district with a short TTL. This is the same artefact that ships to phones,
 * which is deliberate: a collector offline and a collector online must see the
 * same number, or the app has lied to one of them.
 */
export class PriceService {
  private cache = new Map<string, { index: PriceIndex; builtAt: number }>();

  constructor(
    private readonly repo: Repository,
    private readonly ttlMs = 5 * 60_000,
    private readonly windowDays = 90,
  ) {}

  async getIndex(district?: string): Promise<PriceIndex> {
    const key = district ?? NATIONAL;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.builtAt < this.ttlMs) return cached.index;

    const since = new Date(Date.now() - this.windowDays * 86_400_000);
    // Districts still need the national rollup for fallback, so an unfiltered
    // read is correct here even when a district is requested.
    const points = await this.repo.listPricePoints({ since });
    const index = buildPriceIndex(points, { windowDays: this.windowDays });
    this.cache.set(key, { index, builtAt: Date.now() });
    return index;
  }

  invalidate(): void {
    this.cache.clear();
  }

  /** The price board: one row per sub-category for a district, with a trend. */
  async board(district: string, options: { subCategoryIds?: string[] } = {}): Promise<PriceBoardEntry[]> {
    const index = await this.getIndex(district);
    const recyclers = await this.repo.listRecyclers({ district, authorizedOnly: true });
    const wanted = options.subCategoryIds ?? ALL_SUB_CATEGORY_IDS;

    const entries: PriceBoardEntry[] = [];
    for (const subCategoryId of wanted) {
      const stat = lookupStat(index, subCategoryId, district);
      if (!stat) continue;
      const isLocal = index.stats[statKey(subCategoryId, district)] !== undefined;
      const { category, sub } = getSubCategory(subCategoryId);

      // Best published rate among authorised local buyers, so the board shows
      // what is actually obtainable rather than only an average.
      let bestRate: number | undefined;
      let bestRecyclerId: string | undefined;
      for (const recycler of recyclers) {
        if (!recycler.materialsAccepted.includes(category.id)) continue;
        const rate =
          recycler.offeredRatesInr[rateKey(category.id, subCategoryId)] ??
          recycler.offeredRatesInr[rateKey(category.id)];
        if (rate !== undefined && (bestRate === undefined || rate > bestRate)) {
          bestRate = rate;
          bestRecyclerId = recycler.recyclerId;
        }
      }

      entries.push({
        categoryId: category.id,
        subCategoryId,
        district,
        unit: sub.unit,
        fairPriceInr: stat.medianBuyingInr,
        marketLowInr: stat.marketLowInr,
        marketHighInr: stat.marketHighInr,
        bestRecyclerRateInr: bestRate,
        bestRecyclerId,
        asOf: stat.asOf,
        sampleSize: stat.sampleSize,
        trend: computeTrend(stat, '7d'),
        basis: isLocal ? 'local_data' : 'national_data',
      });
    }
    return entries;
  }

  async trend(subCategoryId: string, district: string, window: '7d' | '30d' = '30d') {
    const index = await this.getIndex(district);
    const local = index.stats[statKey(subCategoryId, district)];
    const stat = local ?? lookupStat(index, subCategoryId, district);
    if (!stat) return undefined;
    // The national rollup is a useful fallback but must never be presented as
    // a local trend, so the caller is told which one it got.
    return { stat, trend: computeTrend(stat, window), basis: local ? 'local_data' : 'national_data' };
  }
}

import type { GeoPoint, Lot, MaterialCategoryId, Recycler } from '../types.ts';
import { rateKey } from '../taxonomy.ts';
import { haversineKm } from '../geo.ts';
import { lookupStat, type PriceIndex } from './priceIndex.ts';

/**
 * Recycler matching. Like valuation, this is an interface first: the ranking
 * below is a transparent weighted score, and a learn-to-rank model trained on
 * accepted-vs-ignored offers can replace it without touching the UI.
 */
export interface RecyclerMatcher {
  readonly id: string;
  match(request: MatchRequest): MatchResult;
}

export interface MatchRequest {
  lot: Pick<Lot, 'items' | 'totalWeightKg' | 'collectionPlace'>;
  collectorPoint: GeoPoint;
  recyclers: Recycler[];
  priceIndex: PriceIndex;
  /** Collector's preferred payment mode; cash must never be a second-class option. */
  preferredPayment?: 'cash' | 'upi' | 'bank_transfer';
  maxDistanceKm?: number;
  limit?: number;
  now?: Date;
}

export interface MatchScoreBreakdown {
  rate: number;
  distance: number;
  pickup: number;
  reliability: number;
  coverage: number;
}

export interface RecyclerMatch {
  recycler: Recycler;
  score: number;
  breakdown: MatchScoreBreakdown;
  distanceKm: number;
  /** What this recycler would pay for the lot at their published rates. */
  estimatedPayoutInr: number;
  /** Difference against the district fair price, as a percentage. */
  vsFairPricePct: number;
  coveredCategories: MaterialCategoryId[];
  uncoveredCategories: MaterialCategoryId[];
  pickupOffered: boolean;
  reasons: string[];
  warnings: string[];
}

export interface MatchResult {
  matches: RecyclerMatch[];
  /** Facilities filtered out, with the reason - shown behind a "why not?" tap. */
  excluded: Array<{ recyclerId: string; reason: string }>;
  matcherId: string;
}

const WEIGHTS: MatchScoreBreakdown = {
  rate: 0.42,
  distance: 0.2,
  pickup: 0.13,
  reliability: 0.13,
  coverage: 0.12,
};

export class WeightedRecyclerMatcher implements RecyclerMatcher {
  readonly id = 'weighted-v1';

  match(request: MatchRequest): MatchResult {
    const now = request.now ?? new Date();
    const maxDistanceKm = request.maxDistanceKm ?? 40;
    const excluded: MatchResult['excluded'] = [];
    const matches: RecyclerMatch[] = [];

    const lotCategories = [...new Set(request.lot.items.map((i) => i.categoryId))];
    const fairPayout = fairValueForLot(request.lot.items, request.lot.collectionPlace.district, request.priceIndex);

    for (const recycler of request.recyclers) {
      // Hard filter 1: authorisation. An unauthorised buyer defeats the purpose
      // of the platform, so they are never ranked - only listed as excluded.
      if (recycler.authorizationStatus !== 'authorized') {
        excluded.push({ recyclerId: recycler.recyclerId, reason: `match.excluded.status:${recycler.authorizationStatus}` });
        continue;
      }
      if (Date.parse(`${recycler.authorizationValidTill}T23:59:59Z`) < now.getTime()) {
        excluded.push({ recyclerId: recycler.recyclerId, reason: 'match.excluded.authorization_expired' });
        continue;
      }

      const point = recycler.place.point;
      const distanceKm = point ? haversineKm(request.collectorPoint, point) : Number.POSITIVE_INFINITY;

      // Hard filter 2: reachability. Beyond the recycler's own service radius
      // (or the collector's travel limit) an offer is not real.
      if (distanceKm > Math.min(maxDistanceKm, recycler.serviceAreaRadiusKm + 5)) {
        excluded.push({ recyclerId: recycler.recyclerId, reason: 'match.excluded.too_far' });
        continue;
      }

      const covered = lotCategories.filter((c) => recycler.materialsAccepted.includes(c));
      if (covered.length === 0) {
        excluded.push({ recyclerId: recycler.recyclerId, reason: 'match.excluded.material_not_accepted' });
        continue;
      }
      const uncovered = lotCategories.filter((c) => !recycler.materialsAccepted.includes(c));

      const payout = payoutForLot(recycler, request.lot.items, request.priceIndex, request.lot.collectionPlace.district);
      const vsFairPricePct = fairPayout > 0 ? ((payout - fairPayout) / fairPayout) * 100 : 0;

      const breakdown: MatchScoreBreakdown = {
        // Rate score is centred on the fair price: +20% over fair scores 1.0.
        rate: clamp01(0.5 + vsFairPricePct / 40),
        distance: clamp01(1 - distanceKm / maxDistanceKm),
        pickup: pickupScore(recycler, request.lot.totalWeightKg),
        reliability: reliabilityScore(recycler),
        coverage: covered.length / lotCategories.length,
      };

      let score =
        breakdown.rate * WEIGHTS.rate +
        breakdown.distance * WEIGHTS.distance +
        breakdown.pickup * WEIGHTS.pickup +
        breakdown.reliability * WEIGHTS.reliability +
        breakdown.coverage * WEIGHTS.coverage;

      const reasons: string[] = [];
      const warnings: string[] = [];

      if (vsFairPricePct >= 5) reasons.push(`match.reason.above_fair:${Math.round(vsFairPricePct)}`);
      if (distanceKm <= 5) reasons.push('match.reason.very_close');
      if (breakdown.pickup === 1) reasons.push('match.reason.pickup_available');
      if ((recycler.rating ?? 0) >= 4.2) reasons.push('match.reason.well_rated');
      if (uncovered.length > 0) warnings.push(`match.warning.partial_coverage:${uncovered.join(',')}`);
      if (vsFairPricePct <= -10) warnings.push(`match.warning.below_fair:${Math.round(Math.abs(vsFairPricePct))}`);

      if (request.preferredPayment && !recycler.paymentModes.includes(request.preferredPayment)) {
        // A soft penalty, not a filter: a good rate can still be worth a different payment mode.
        score *= 0.9;
        warnings.push(`match.warning.payment_mode:${request.preferredPayment}`);
      }

      matches.push({
        recycler,
        score: Math.round(score * 1000) / 1000,
        breakdown,
        distanceKm: Math.round(distanceKm * 10) / 10,
        estimatedPayoutInr: Math.round(payout * 100) / 100,
        vsFairPricePct: Math.round(vsFairPricePct * 10) / 10,
        coveredCategories: covered,
        uncoveredCategories: uncovered,
        pickupOffered: breakdown.pickup > 0,
        reasons,
        warnings,
      });
    }

    matches.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
    return { matches: matches.slice(0, request.limit ?? 10), excluded, matcherId: this.id };
  }
}

function pickupScore(recycler: Recycler, lotWeightKg: number): number {
  if (!recycler.pickupAvailable) return 0;
  const min = recycler.pickupMinWeightKg ?? 0;
  if (lotWeightKg >= min) return 1;
  // Close to the threshold still counts for something - the collector can top up.
  return clamp01(lotWeightKg / Math.max(min, 1)) * 0.5;
}

function reliabilityScore(recycler: Recycler): number {
  if (recycler.ratingCount < 3 || recycler.rating === undefined) return 0.5; // unknown, not bad
  return clamp01(recycler.rating / 5);
}

/** What the recycler's published rate card yields for this lot. */
export function payoutForLot(
  recycler: Recycler,
  items: Array<{ categoryId: MaterialCategoryId; subCategoryId: string; approxWeightKg: number }>,
  priceIndex: PriceIndex,
  district: string,
): number {
  let total = 0;
  for (const item of items) {
    if (!recycler.materialsAccepted.includes(item.categoryId)) continue;
    const rate =
      recycler.offeredRatesInr[rateKey(item.categoryId, item.subCategoryId)] ??
      recycler.offeredRatesInr[rateKey(item.categoryId)] ??
      lookupStat(priceIndex, item.subCategoryId, district)?.medianBuyingInr ??
      0;
    total += rate * item.approxWeightKg;
  }
  return total;
}

function fairValueForLot(
  items: Array<{ subCategoryId: string; approxWeightKg: number }>,
  district: string,
  priceIndex: PriceIndex,
): number {
  return items.reduce(
    (sum, item) => sum + (lookupStat(priceIndex, item.subCategoryId, district)?.medianBuyingInr ?? 0) * item.approxWeightKg,
    0,
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

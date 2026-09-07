import type { GeoPoint, Transaction } from '../types.ts';
import { findSubCategory } from '../taxonomy.ts';
import { haversineKm } from '../geo.ts';
import { lookupStat, type PriceIndex } from './priceIndex.ts';

/**
 * Abnormal-transaction detection. Two jobs:
 *  1. protect the collector (a price far under the local band, a weight that
 *     shrank between declaration and weighing, a payment that never lands);
 *  2. protect the dataset (duplicated photos, impossible geography), because a
 *     poisoned dataset makes every downstream price signal worse.
 *
 * Statistical checks use median + MAD rather than mean + standard deviation:
 * with a handful of observations per district, one bad quote would drag a
 * mean-based check far enough to hide everything else.
 */

export type AnomalySeverity = 'info' | 'warn' | 'critical';

export interface AnomalyFlag {
  code: string;
  severity: AnomalySeverity;
  /** Translation key plus interpolation values, so the collector sees it in Marathi. */
  messageKey: string;
  detail: Record<string, string | number>;
}

export interface AnomalyContext {
  priceIndex: PriceIndex;
  /** Photo hashes already seen, for duplicate detection. */
  knownPhotoHashes?: Set<string>;
  /** The collector's own recent transactions, for behavioural checks. */
  collectorHistory?: Transaction[];
  now?: Date;
}

export interface AnomalyInput {
  district: string;
  items: Array<{
    subCategoryId: string;
    approxWeightKg: number;
    quantity: number;
  }>;
  declaredWeightKg: number;
  weighedWeightKg?: number;
  estimatedValueInr: number;
  quotedPriceInr?: number;
  finalPriceInr?: number;
  photoHashes?: string[];
  collectionPoint?: GeoPoint;
  collectedAt?: string;
  handoverPoint?: GeoPoint;
  handoverAt?: string;
}

export interface AnomalyDetector {
  readonly id: string;
  detect(input: AnomalyInput, context: AnomalyContext): AnomalyFlag[];
}

export class RuleBasedAnomalyDetector implements AnomalyDetector {
  readonly id = 'anomaly-rules-v1';

  detect(input: AnomalyInput, context: AnomalyContext): AnomalyFlag[] {
    const flags: AnomalyFlag[] = [];
    flags.push(...this.checkPrice(input, context));
    flags.push(...this.checkWeight(input, context));
    flags.push(...this.checkPhotos(input, context));
    flags.push(...this.checkGeography(input));
    return flags;
  }

  private checkPrice(input: AnomalyInput, context: AnomalyContext): AnomalyFlag[] {
    const flags: AnomalyFlag[] = [];
    const fair = input.items.reduce((sum, item) => {
      const stat = lookupStat(context.priceIndex, item.subCategoryId, input.district);
      return sum + (stat?.medianBuyingInr ?? 0) * item.approxWeightKg;
    }, 0);

    const actual = input.finalPriceInr ?? input.quotedPriceInr;
    if (fair > 0 && actual !== undefined) {
      const deltaPct = ((actual - fair) / fair) * 100;
      if (deltaPct <= -35) {
        flags.push({
          code: 'PRICE_FAR_BELOW_MARKET',
          severity: 'critical',
          messageKey: 'anomaly.price_far_below',
          detail: { deltaPct: round1(deltaPct), fairInr: round1(fair), offeredInr: actual },
        });
      } else if (deltaPct <= -18) {
        flags.push({
          code: 'PRICE_BELOW_MARKET',
          severity: 'warn',
          messageKey: 'anomaly.price_below',
          detail: { deltaPct: round1(deltaPct), fairInr: round1(fair), offeredInr: actual },
        });
      } else if (deltaPct >= 60) {
        // Too good is also a signal - usually a unit mix-up or a data-entry slip.
        flags.push({
          code: 'PRICE_IMPLAUSIBLY_HIGH',
          severity: 'warn',
          messageKey: 'anomaly.price_high',
          detail: { deltaPct: round1(deltaPct), fairInr: round1(fair), offeredInr: actual },
        });
      }
    }

    if (input.quotedPriceInr !== undefined && input.finalPriceInr !== undefined && input.quotedPriceInr > 0) {
      const dropPct = ((input.finalPriceInr - input.quotedPriceInr) / input.quotedPriceInr) * 100;
      if (dropPct <= -15) {
        flags.push({
          code: 'FINAL_BELOW_QUOTE',
          severity: 'critical',
          messageKey: 'anomaly.final_below_quote',
          detail: { dropPct: round1(dropPct), quotedInr: input.quotedPriceInr, finalInr: input.finalPriceInr },
        });
      }
    }

    // Behavioural: is this collector consistently paid less than their own norm?
    const history = context.collectorHistory ?? [];
    if (history.length >= 5 && input.finalPriceInr !== undefined) {
      const ratios = history
        .filter((t) => t.estimatedValueInr > 0)
        .map((t) => t.finalPriceInr / t.estimatedValueInr);
      if (ratios.length >= 5 && input.estimatedValueInr > 0) {
        const ratio = input.finalPriceInr / input.estimatedValueInr;
        const z = robustZ(ratio, ratios);
        if (z <= -3) {
          flags.push({
            code: 'OUTLIER_VS_COLLECTOR_HISTORY',
            severity: 'warn',
            messageKey: 'anomaly.below_own_history',
            detail: { z: round1(z), ratio: round2(ratio) },
          });
        }
      }
    }
    return flags;
  }

  private checkWeight(input: AnomalyInput, _context: AnomalyContext): AnomalyFlag[] {
    const flags: AnomalyFlag[] = [];

    for (const item of input.items) {
      const found = findSubCategory(item.subCategoryId);
      const typical = found?.sub.typicalPieceWeightKg;
      if (!typical || item.quantity <= 0) continue;
      const perPiece = item.approxWeightKg / item.quantity;
      // Anything outside 4x either way of the reference mass is almost always a
      // wrong category or a slipped decimal point.
      if (perPiece > typical * 4 || perPiece < typical / 4) {
        flags.push({
          code: 'WEIGHT_IMPLAUSIBLE_FOR_CATEGORY',
          severity: 'warn',
          messageKey: 'anomaly.weight_implausible',
          detail: {
            subCategoryId: item.subCategoryId,
            perPieceKg: round2(perPiece),
            typicalKg: typical,
          },
        });
      }
    }

    if (input.weighedWeightKg !== undefined && input.declaredWeightKg > 0) {
      const deltaPct = ((input.weighedWeightKg - input.declaredWeightKg) / input.declaredWeightKg) * 100;
      if (Math.abs(deltaPct) >= 20) {
        flags.push({
          code: 'WEIGHT_MISMATCH_AT_HANDOVER',
          severity: deltaPct <= -20 ? 'critical' : 'warn',
          messageKey: 'anomaly.weight_mismatch',
          detail: {
            deltaPct: round1(deltaPct),
            declaredKg: input.declaredWeightKg,
            weighedKg: input.weighedWeightKg,
          },
        });
      }
    }
    return flags;
  }

  private checkPhotos(input: AnomalyInput, context: AnomalyContext): AnomalyFlag[] {
    const known = context.knownPhotoHashes;
    if (!known || !input.photoHashes) return [];
    const duplicates = input.photoHashes.filter((h) => known.has(h));
    if (duplicates.length === 0) return [];
    return [
      {
        code: 'DUPLICATE_PHOTO',
        severity: 'critical',
        messageKey: 'anomaly.duplicate_photo',
        detail: { count: duplicates.length, firstHash: duplicates[0]!.slice(0, 12) },
      },
    ];
  }

  private checkGeography(input: AnomalyInput): AnomalyFlag[] {
    const flags: AnomalyFlag[] = [];
    if (!input.collectionPoint || !input.handoverPoint || !input.collectedAt || !input.handoverAt) return flags;

    const km = haversineKm(input.collectionPoint, input.handoverPoint);
    const hours = (Date.parse(input.handoverAt) - Date.parse(input.collectedAt)) / 3_600_000;

    if (hours < 0) {
      flags.push({
        code: 'HANDOVER_BEFORE_COLLECTION',
        severity: 'critical',
        messageKey: 'anomaly.time_order',
        detail: { hours: round2(hours) },
      });
      return flags;
    }
    if (hours > 0 && km / hours > 120) {
      flags.push({
        code: 'IMPOSSIBLE_TRAVEL',
        severity: 'warn',
        messageKey: 'anomaly.impossible_travel',
        detail: { km: round1(km), hours: round2(hours), kmh: round1(km / hours) },
      });
    }
    if (km > 150) {
      flags.push({
        code: 'HANDOVER_FAR_FROM_COLLECTION',
        severity: 'info',
        messageKey: 'anomaly.handover_far',
        detail: { km: round1(km) },
      });
    }
    return flags;
  }
}

/** Median absolute deviation z-score. Returns 0 when the sample is degenerate. */
export function robustZ(value: number, sample: number[]): number {
  if (sample.length < 3) return 0;
  const med = median(sample);
  const mad = median(sample.map((x) => Math.abs(x - med)));
  if (mad === 0) return 0;
  return (0.6745 * (value - med)) / mad;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function worstSeverity(flags: AnomalyFlag[]): AnomalySeverity | undefined {
  if (flags.some((f) => f.severity === 'critical')) return 'critical';
  if (flags.some((f) => f.severity === 'warn')) return 'warn';
  if (flags.length) return 'info';
  return undefined;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

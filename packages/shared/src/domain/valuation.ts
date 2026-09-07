import type { MaterialCondition, MaterialItem, Unit } from '../types.ts';
import { getSubCategory } from '../taxonomy.ts';
import { lookupStat, type PriceIndex } from './priceIndex.ts';

/**
 * Valuation is deliberately behind an interface. Today it is a transparent
 * rule engine over the price index (which is what a collector can argue with
 * at the weighing scale). When enough matched image/weight/final-price records
 * exist, a learned regressor can implement the same interface and the app does
 * not change - see docs/ai-ml.md.
 */
export interface Valuer {
  readonly id: string;
  estimate(input: ValuationInput): Valuation;
}

export interface ValuationInput {
  subCategoryId: string;
  weightKg: number;
  quantity?: number;
  condition: MaterialCondition;
  district: string;
}

export interface Valuation {
  /** The number shown big on screen. */
  estimateInr: number;
  lowInr: number;
  highInr: number;
  ratePerUnitInr: number;
  unit: Unit;
  /** 0-1. Below 0.4 the app says "rough guess" instead of showing a firm number. */
  confidence: number;
  /** Plain-language reasons, translated in the UI; also the audit trail. */
  reasons: string[];
  basis: 'local_data' | 'national_data' | 'reference_band';
  sampleSize: number;
  valuerId: string;
}

/** How much a condition changes what a buyer will pay. */
const CONDITION_FACTOR: Record<MaterialCondition, number> = {
  intact: 1.0,
  partially_dismantled: 1.05, // pre-sorted material is worth slightly more per kg
  broken: 0.82,
  burnt: 0.45, // burnt material loses value and is the practice we are trying to displace
  wet: 0.7,
};

/** Larger lots clear at a better rate; this mirrors what aggregators actually pay. */
function bulkFactor(weightKg: number): number {
  if (weightKg >= 200) return 1.06;
  if (weightKg >= 50) return 1.03;
  if (weightKg < 2) return 0.95;
  return 1;
}

export class RuleBasedValuer implements Valuer {
  readonly id = 'rule-based-v1';

  constructor(private readonly index: PriceIndex) {}

  estimate(input: ValuationInput): Valuation {
    const { sub } = getSubCategory(input.subCategoryId);
    const stat = lookupStat(this.index, input.subCategoryId, input.district);
    const reasons: string[] = [];

    let rate: number;
    let low: number;
    let high: number;
    let basis: Valuation['basis'];
    let confidence: number;
    const sampleSize = stat?.sampleSize ?? 0;

    if (stat && stat.district === input.district && stat.sampleSize >= 3) {
      rate = stat.medianBuyingInr;
      low = stat.p25Inr;
      high = stat.p75Inr;
      basis = 'local_data';
      confidence = Math.min(0.95, 0.55 + Math.min(sampleSize, 20) * 0.02);
      reasons.push(`valuation.reason.local:${sampleSize}:${input.district}`);
    } else if (stat && stat.sampleSize >= 3) {
      rate = stat.medianBuyingInr;
      low = stat.p25Inr;
      high = stat.p75Inr;
      basis = 'national_data';
      confidence = 0.5;
      reasons.push(`valuation.reason.national:${sampleSize}`);
    } else {
      rate = (sub.baseLowInr + sub.baseHighInr) / 2;
      low = sub.baseLowInr;
      high = sub.baseHighInr;
      basis = 'reference_band';
      confidence = 0.3;
      reasons.push('valuation.reason.reference_band');
    }

    const condition = CONDITION_FACTOR[input.condition];
    if (condition !== 1) reasons.push(`valuation.reason.condition:${input.condition}`);
    const bulk = bulkFactor(input.weightKg);
    if (bulk !== 1) reasons.push(`valuation.reason.bulk:${bulk > 1 ? 'up' : 'down'}`);

    const measure = sub.unit === 'piece' ? (input.quantity ?? 1) : input.weightKg;
    const adjustedRate = rate * condition * bulk;

    // A very small parcel priced off a per-kg rate is inherently uncertain.
    if (sub.unit === 'kg' && input.weightKg < 0.5) {
      confidence *= 0.8;
      reasons.push('valuation.reason.small_parcel');
    }

    // The same adjustment must apply to all three numbers. lowInr used to omit
    // the bulk factor, so on a small parcel (bulk 0.95) the low bound came out
    // ABOVE the high bound and the estimate fell outside its own range - the
    // screen read "you should get Rs 528, between Rs 544 and Rs 533". A range
    // that does not contain its own estimate destroys the one thing this
    // number is for.
    return {
      estimateInr: round(adjustedRate * measure),
      lowInr: round(low * condition * bulk * measure),
      highInr: round(high * condition * bulk * measure),
      ratePerUnitInr: round(adjustedRate),
      unit: sub.unit,
      confidence: Math.round(confidence * 100) / 100,
      reasons,
      basis,
      sampleSize,
      valuerId: this.id,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Value a whole lot by summing its items. */
export function valueLot(
  valuer: Valuer,
  items: Array<Pick<MaterialItem, 'subCategoryId' | 'approxWeightKg' | 'quantity' | 'condition'>>,
  district: string,
): { totalInr: number; lowInr: number; highInr: number; perItem: Valuation[]; confidence: number } {
  const perItem = items.map((item) =>
    valuer.estimate({
      subCategoryId: item.subCategoryId,
      weightKg: item.approxWeightKg,
      quantity: item.quantity,
      condition: item.condition,
      district,
    }),
  );
  const sum = (pick: (v: Valuation) => number) => round(perItem.reduce((s, v) => s + pick(v), 0));
  const confidence = perItem.length
    ? Math.round((perItem.reduce((s, v) => s + v.confidence, 0) / perItem.length) * 100) / 100
    : 0;
  return {
    totalInr: sum((v) => v.estimateInr),
    lowInr: sum((v) => v.lowInr),
    highInr: sum((v) => v.highInr),
    perItem,
    confidence,
  };
}

import type { MaterialCategoryId } from '../types.ts';
import { MATERIAL_CATEGORIES, findSubCategory } from '../taxonomy.ts';

/**
 * Material classification from a photo.
 *
 * There is no honest way to ship an image model before the field dataset
 * exists, so this module defines the contract and ships a prior-based
 * suggester. It never auto-selects a category: it re-orders the pictorial
 * picker so the likely answers come first, and the collector always taps the
 * final choice. That tap is exactly the label the future model needs - see
 * docs/ai-ml.md for the training loop.
 */

export interface ClassifyInput {
  /** Local file URI or object key. */
  imageRef: string;
  /** Optional on-device embedding or feature vector, once a model exists. */
  features?: number[];
  district?: string;
  /** What this collector picked recently - a strong prior in practice. */
  recentSubCategoryIds?: string[];
}

export interface ClassificationCandidate {
  categoryId: MaterialCategoryId;
  subCategoryId: string;
  probability: number;
}

export interface ClassificationResult {
  candidates: ClassificationCandidate[];
  modelId: string;
  /** True when the result is only a prior, not an image model. */
  isPrior: boolean;
  /** Below this, the UI must not preselect anything. */
  autoSelectThreshold: number;
}

export interface MaterialClassifier {
  readonly id: string;
  classify(input: ClassifyInput): Promise<ClassificationResult>;
}

/** District-level frequency priors, refreshed nightly from the transaction dataset. */
export type CategoryPriors = Record<string, number>;

export class PriorBasedClassifier implements MaterialClassifier {
  readonly id = 'prior-v1';

  constructor(private readonly priors: CategoryPriors = defaultPriors()) {}

  async classify(input: ClassifyInput): Promise<ClassificationResult> {
    const scores = new Map<string, number>();
    for (const [subCategoryId, prior] of Object.entries(this.priors)) {
      scores.set(subCategoryId, prior);
    }
    // Recency prior: a collector working a street of old TVs keeps finding CRTs.
    input.recentSubCategoryIds?.slice(0, 10).forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0.001) + 0.08 / (i + 1));
    });

    const total = [...scores.values()].reduce((s, v) => s + v, 0) || 1;
    const candidates = [...scores.entries()]
      .map(([subCategoryId, score]) => {
        const found = findSubCategory(subCategoryId);
        return found
          ? { categoryId: found.category.id, subCategoryId, probability: score / total }
          : undefined;
      })
      .filter((c): c is ClassificationCandidate => c !== undefined)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 6);

    return {
      candidates,
      modelId: this.id,
      isPrior: true,
      // Deliberately unreachable: a prior must never auto-select a category.
      autoSelectThreshold: 1.1,
    };
  }
}

function defaultPriors(): CategoryPriors {
  // Uniform within category, weighted by how often each category shows up in
  // mixed household scrap. Replaced at runtime by district priors from the API.
  const categoryWeight: Record<MaterialCategoryId, number> = {
    cable: 0.24,
    mixed_plastic: 0.2,
    pcb: 0.16,
    motor_magnet: 0.14,
    battery: 0.12,
    crt: 0.08,
    lcd_panel: 0.06,
  };
  const priors: CategoryPriors = {};
  for (const category of MATERIAL_CATEGORIES) {
    const per = categoryWeight[category.id] / category.subCategories.length;
    for (const sub of category.subCategories) priors[sub.id] = per;
  }
  return priors;
}

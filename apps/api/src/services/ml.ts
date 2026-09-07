import {
  PriorBasedClassifier,
  RuleBasedAnomalyDetector,
  RuleBasedValuer,
  type AnomalyInput,
  type ClassifyInput,
  type MaterialClassifier,
  type Valuer,
} from '@ewaste/shared';
import type { Repository } from '../repository/types.ts';
import type { PriceService } from './prices.ts';

/**
 * The AI/ML surface.
 *
 * Every endpoint here returns a `modelId`, and the app records it against the
 * record it produced. That is the whole point of routing these through one
 * service: when a learned model replaces a rule, we can tell which decisions
 * came from which version, and compare them on the same data. Swapping in a
 * model means constructing this service with a different implementation of
 * `Valuer` or `MaterialClassifier` - no route changes.
 */
export class MlService {
  constructor(
    private readonly repo: Repository,
    private readonly prices: PriceService,
    private readonly classifier: MaterialClassifier = new PriorBasedClassifier(),
    private readonly detector = new RuleBasedAnomalyDetector(),
  ) {}

  async classify(input: ClassifyInput) {
    const result = await this.classifier.classify(input);
    return {
      ...result,
      // Stated plainly so no caller mistakes a prior for a prediction.
      note: result.isPrior
        ? 'No image model is deployed. These are frequency priors that re-order the picker; the collector chooses.'
        : undefined,
    };
  }

  async value(input: {
    subCategoryId: string;
    weightKg: number;
    quantity?: number;
    condition: AnomalyInput['items'][number]['condition'];
    district: string;
  }) {
    const index = await this.prices.getIndex(input.district);
    const valuer: Valuer = new RuleBasedValuer(index);
    return valuer.estimate({
      subCategoryId: input.subCategoryId,
      weightKg: input.weightKg,
      quantity: input.quantity,
      condition: input.condition,
      district: input.district,
    });
  }

  async screenTransaction(input: AnomalyInput & { collectorId?: string; lotId?: string }) {
    const index = await this.prices.getIndex(input.district);
    const knownPhotoHashes = await this.repo.knownPhotoHashes(input.lotId);
    const collectorHistory = input.collectorId
      ? await this.repo.listTransactions({ collectorId: input.collectorId, limit: 30 })
      : undefined;

    const flags = this.detector.detect(input, { priceIndex: index, knownPhotoHashes, collectorHistory });
    return { flags, detectorId: this.detector.id };
  }
}

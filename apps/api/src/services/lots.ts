import {
  RuleBasedValuer,
  newLotId,
  newMaterialId,
  valueLot,
  type Lot,
  type MaterialItem,
  type PlaceRef,
} from '@ewaste/shared';
import type { Repository } from '../repository/types.ts';
import type { PriceService } from './prices.ts';

export interface DraftItem {
  categoryId: MaterialItem['categoryId'];
  subCategoryId: string;
  approxWeightKg: number;
  quantity?: number;
  condition: MaterialItem['condition'];
  sourceType?: MaterialItem['sourceType'];
  description?: string;
  imageRefs?: string[];
  classificationSource?: MaterialItem['classificationSource'];
  modelConfidence?: number;
}

export interface CreateLotInput {
  /** Supplied by the phone so a lot created offline keeps its id after sync. */
  lotId?: string;
  collectorId: string;
  items: DraftItem[];
  collectionPlace: PlaceRef;
  collectedAt?: string;
  notes?: string;
}

export class LotService {
  constructor(
    private readonly repo: Repository,
    private readonly prices: PriceService,
  ) {}

  async create(input: CreateLotInput): Promise<Lot> {
    const now = new Date().toISOString();
    const lotId = input.lotId ?? newLotId();
    const index = await this.prices.getIndex(input.collectionPlace.district);
    const valuer = new RuleBasedValuer(index);

    const valued = valueLot(
      valuer,
      input.items.map((i) => ({
        subCategoryId: i.subCategoryId,
        approxWeightKg: i.approxWeightKg,
        quantity: i.quantity ?? 1,
        condition: i.condition,
      })),
      input.collectionPlace.district,
    );

    const items: MaterialItem[] = input.items.map((item, i) => ({
      materialId: newMaterialId(),
      lotId,
      categoryId: item.categoryId,
      subCategoryId: item.subCategoryId,
      description: item.description ?? '',
      imageRefs: item.imageRefs ?? [],
      approxWeightKg: item.approxWeightKg,
      unit: 'kg',
      quantity: item.quantity ?? 1,
      condition: item.condition,
      sourceType: item.sourceType ?? 'household',
      estimatedValueInr: valued.perItem[i]!.estimateInr,
      classificationSource: item.classificationSource ?? 'collector',
      modelConfidence: item.modelConfidence,
      createdAt: input.collectedAt ?? now,
    }));

    const lot: Lot = {
      lotId,
      collectorId: input.collectorId,
      status: 'ready',
      items,
      totalWeightKg: round2(items.reduce((s, i) => s + i.approxWeightKg, 0)),
      estimatedValueInr: valued.totalInr,
      collectionPlace: input.collectionPlace,
      collectedAt: input.collectedAt ?? now,
      createdAt: now,
      updatedAt: now,
      notes: input.notes,
    };

    await this.repo.upsertLot(lot);
    return lot;
  }

  async get(lotId: string): Promise<Lot | undefined> {
    return this.repo.getLot(lotId);
  }

  async listForCollector(collectorId: string, limit = 50): Promise<Lot[]> {
    return this.repo.listLots({ collectorId, limit });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

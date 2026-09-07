import { PrismaClient, type Prisma } from '@prisma/client';
import type {
  Collector,
  HandoverRecord,
  Lot,
  MaterialCategoryId,
  MaterialItem,
  PricePoint,
  Recycler,
  Transaction,
} from '@ewaste/shared';
import type { Repository } from './types.ts';

/**
 * Postgres adapter.
 *
 * Two conventions worth knowing:
 *  - money is Decimal in the database and `number` in the domain, converted at
 *    this boundary and nowhere else. Rounding drift is a dispute with someone
 *    who counted the cash, so it stays in one place;
 *  - the domain nests (a Lot owns its MaterialItems, a place is an object) and
 *    the schema flattens. That mapping also lives here, so a route never sees
 *    a column name.
 */
export class PrismaRepository implements Repository {
  readonly kind = 'postgres' as const;

  constructor(private readonly prisma: PrismaClient) {}

  static async connect(databaseUrl: string): Promise<PrismaRepository> {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    return new PrismaRepository(prisma);
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /* ---------------- reference data ---------------- */

  async listRecyclers(filter: { district?: string; authorizedOnly?: boolean } = {}): Promise<Recycler[]> {
    const rows = await this.prisma.recycler.findMany({
      where: {
        ...(filter.district ? { district: filter.district } : {}),
        ...(filter.authorizedOnly ? { authorizationStatus: 'authorized' } : {}),
      },
    });
    return rows.map(toRecycler);
  }

  async getRecycler(recyclerId: string): Promise<Recycler | undefined> {
    const row = await this.prisma.recycler.findUnique({ where: { recyclerId } });
    return row ? toRecycler(row) : undefined;
  }

  async listPricePoints(
    filter: { district?: string; subCategoryId?: string; since?: Date; limit?: number } = {},
  ): Promise<PricePoint[]> {
    const rows = await this.prisma.pricePoint.findMany({
      where: {
        ...(filter.district ? { district: filter.district } : {}),
        ...(filter.subCategoryId ? { subCategoryId: filter.subCategoryId } : {}),
        ...(filter.since ? { observedAt: { gte: filter.since } } : {}),
      },
      orderBy: { observedAt: 'desc' },
      take: filter.limit ?? 100_000,
    });
    return rows.map(toPricePoint);
  }

  async appendPricePoint(point: PricePoint): Promise<void> {
    await this.prisma.pricePoint.upsert({
      where: { priceId: point.priceId },
      create: fromPricePoint(point),
      update: fromPricePoint(point),
    });
  }

  /* ---------------- collectors ---------------- */

  async getCollector(collectorId: string): Promise<Collector | undefined> {
    const row = await this.prisma.collector.findUnique({ where: { collectorId } });
    return row ? toCollector(row) : undefined;
  }

  async getCollectorByPhoneHash(phoneHash: string): Promise<Collector | undefined> {
    const row = await this.prisma.collector.findUnique({ where: { phoneHash } });
    return row ? toCollector(row) : undefined;
  }

  async upsertCollector(collector: Collector): Promise<Collector> {
    const data = {
      phoneHash: collector.phoneHash,
      preferredLanguage: collector.preferredLanguage,
      operatingDistrict: collector.operatingDistrict,
      operatingState: collector.operatingState,
      lifetimeEarningsInr: collector.lifetimeEarningsInr,
      pendingDuesInr: collector.pendingDuesInr,
      completedTransactions: collector.completedTransactions,
    };
    const row = await this.prisma.collector.upsert({
      where: { collectorId: collector.collectorId },
      create: { collectorId: collector.collectorId, createdAt: new Date(collector.createdAt), ...data },
      update: data,
    });
    return toCollector(row);
  }

  /* ---------------- lots ---------------- */

  async getLot(lotId: string): Promise<Lot | undefined> {
    const row = await this.prisma.lot.findUnique({ where: { lotId }, include: { items: true } });
    return row ? toLot(row) : undefined;
  }

  async listLots(filter: {
    collectorId?: string;
    district?: string;
    status?: string;
    limit?: number;
  }): Promise<Lot[]> {
    const rows = await this.prisma.lot.findMany({
      where: {
        ...(filter.collectorId ? { collectorId: filter.collectorId } : {}),
        ...(filter.district ? { district: filter.district } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: { items: true },
      orderBy: { collectedAt: 'desc' },
      take: filter.limit ?? 100,
    });
    return rows.map(toLot);
  }

  async upsertLot(lot: Lot): Promise<Lot> {
    const header = {
      collectorId: lot.collectorId,
      status: lot.status,
      totalWeightKg: lot.totalWeightKg,
      estimatedValueInr: lot.estimatedValueInr,
      locality: lot.collectionPlace.locality,
      district: lot.collectionPlace.district,
      state: lot.collectionPlace.state,
      lat: lot.collectionPlace.point?.lat ?? null,
      lon: lot.collectionPlace.point?.lon ?? null,
      collectedAt: new Date(lot.collectedAt),
      recyclerId: lot.recyclerId ?? null,
      quotedPriceInr: lot.quotedPriceInr ?? null,
      notes: lot.notes ?? null,
    };

    // Items are replaced wholesale rather than diffed: a lot is small, and a
    // partial write here would leave a collector's declared weight and their
    // item list disagreeing.
    await this.prisma.$transaction([
      this.prisma.lot.upsert({
        where: { lotId: lot.lotId },
        create: { lotId: lot.lotId, createdAt: new Date(lot.createdAt), ...header },
        update: header,
      }),
      this.prisma.materialItem.deleteMany({ where: { lotId: lot.lotId } }),
      this.prisma.materialItem.createMany({ data: lot.items.map(fromMaterialItem) }),
    ]);

    return (await this.getLot(lot.lotId))!;
  }

  /* ---------------- handovers ---------------- */

  async getHandover(handoverRef: string): Promise<HandoverRecord | undefined> {
    const row = await this.prisma.handover.findUnique({ where: { handoverRef } });
    return row ? toHandover(row) : undefined;
  }

  async listHandovers(filter: {
    recyclerId?: string;
    collectorId?: string;
    confirmationStatus?: HandoverRecord['confirmationStatus'];
    limit?: number;
  }): Promise<HandoverRecord[]> {
    const rows = await this.prisma.handover.findMany({
      where: {
        ...(filter.recyclerId ? { recyclerId: filter.recyclerId } : {}),
        ...(filter.collectorId ? { collectorId: filter.collectorId } : {}),
        ...(filter.confirmationStatus ? { confirmationStatus: filter.confirmationStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 50,
    });
    return rows.map(toHandover);
  }

  async createHandover(record: HandoverRecord): Promise<HandoverRecord> {
    const row = await this.prisma.handover.create({ data: fromHandover(record) });
    return toHandover(row);
  }

  async updateHandover(handoverRef: string, patch: Partial<HandoverRecord>): Promise<HandoverRecord> {
    const row = await this.prisma.handover.update({
      where: { handoverRef },
      data: {
        ...(patch.confirmationStatus ? { confirmationStatus: patch.confirmationStatus } : {}),
        ...(patch.confirmedAt ? { confirmedAt: new Date(patch.confirmedAt) } : {}),
        ...(patch.confirmedBy ? { confirmedBy: patch.confirmedBy } : {}),
        ...(patch.transactionId ? { transactionId: patch.transactionId } : {}),
        ...(patch.downstreamStatus ? { downstreamStatus: patch.downstreamStatus } : {}),
        ...(patch.rejectionReason ? { rejectionReason: patch.rejectionReason } : {}),
        ...(patch.weighedWeightKg !== undefined ? { weighedWeightKg: patch.weighedWeightKg } : {}),
      },
    });
    return toHandover(row);
  }

  async knownPhotoHashes(excludeLotId?: string): Promise<Set<string>> {
    const rows = await this.prisma.handover.findMany({
      where: excludeLotId ? { NOT: { lotId: excludeLotId } } : {},
      select: { photoHashes: true },
    });
    const set = new Set<string>();
    for (const row of rows) for (const hash of row.photoHashes) set.add(hash);
    return set;
  }

  /* ---------------- transactions ---------------- */

  async getTransaction(transactionId: string): Promise<Transaction | undefined> {
    const row = await this.prisma.transaction.findUnique({ where: { transactionId } });
    return row ? toTransaction(row) : undefined;
  }

  async listTransactions(filter: {
    collectorId?: string;
    recyclerId?: string;
    since?: Date;
    limit?: number;
  }): Promise<Transaction[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        ...(filter.collectorId ? { collectorId: filter.collectorId } : {}),
        ...(filter.recyclerId ? { recyclerId: filter.recyclerId } : {}),
        ...(filter.since ? { handoverAt: { gte: filter.since } } : {}),
      },
      orderBy: { handoverAt: 'desc' },
      take: filter.limit ?? 100,
    });
    return rows.map(toTransaction);
  }

  async upsertTransaction(transaction: Transaction): Promise<Transaction> {
    const data = fromTransaction(transaction);
    const row = await this.prisma.transaction.upsert({
      where: { transactionId: transaction.transactionId },
      create: data,
      update: data,
    });
    return toTransaction(row);
  }

  /* ---------------- sync ---------------- */

  async wasChangeApplied(changeId: string): Promise<boolean> {
    const row = await this.prisma.syncChange.findUnique({ where: { changeId }, select: { changeId: true } });
    return row !== null;
  }

  async recordChange(entry: {
    changeId: string;
    deviceId: string;
    collectorId: string;
    entity: string;
    entityId: string;
    op: string;
    outcome: string;
  }): Promise<void> {
    // A concurrent retry of the same change loses the race harmlessly.
    await this.prisma.syncChange.createMany({ data: [entry], skipDuplicates: true });
  }

  async appendToFeed(entry: {
    collectorId: string;
    entity: string;
    entityId: string;
    op: string;
    payload: unknown;
  }): Promise<void> {
    await this.prisma.changeFeed.create({
      data: { ...entry, payload: entry.payload as Prisma.InputJsonValue },
    });
  }

  async readFeed(collectorId: string, cursor: string | undefined, limit: number) {
    const after = cursor ? BigInt(cursor) : 0n;
    // Fetch one extra row to answer hasMore without a second count query.
    const rows = await this.prisma.changeFeed.findMany({
      where: { collectorId, serverSeq: { gt: after } },
      orderBy: { serverSeq: 'asc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      entries: page.map((row) => ({
        serverSeq: row.serverSeq.toString(),
        entity: row.entity,
        entityId: row.entityId,
        op: row.op,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      })),
      cursor: (page.at(-1)?.serverSeq ?? after).toString(),
      hasMore: rows.length > page.length,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Row <-> domain mapping                                              */
/* ------------------------------------------------------------------ */

const num = (value: Prisma.Decimal | number | null): number => (value === null ? 0 : Number(value));
const optNum = (value: Prisma.Decimal | number | null): number | undefined =>
  value === null ? undefined : Number(value);

type RecyclerRow = Awaited<ReturnType<PrismaClient['recycler']['findFirstOrThrow']>>;
type PriceRow = Awaited<ReturnType<PrismaClient['pricePoint']['findFirstOrThrow']>>;
type CollectorRow = Awaited<ReturnType<PrismaClient['collector']['findFirstOrThrow']>>;
type LotRow = Awaited<ReturnType<PrismaClient['lot']['findFirstOrThrow']>> & {
  items: Awaited<ReturnType<PrismaClient['materialItem']['findFirstOrThrow']>>[];
};
type MaterialRow = LotRow['items'][number];
type HandoverRow = Awaited<ReturnType<PrismaClient['handover']['findFirstOrThrow']>>;
type TransactionRow = Awaited<ReturnType<PrismaClient['transaction']['findFirstOrThrow']>>;

function toRecycler(row: RecyclerRow): Recycler {
  return {
    recyclerId: row.recyclerId,
    name: row.name,
    facilityType: row.facilityType as Recycler['facilityType'],
    place: {
      locality: row.locality,
      district: row.district,
      state: row.state,
      pincode: row.pincode ?? undefined,
      point: row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : undefined,
    },
    materialsAccepted: row.materialsAccepted as MaterialCategoryId[],
    authorizationNumber: row.authorizationNumber,
    authorizationIssuer: row.authorizationIssuer,
    authorizationValidTill: row.authorizationValidTill.toISOString().slice(0, 10),
    authorizationStatus: row.authorizationStatus as Recycler['authorizationStatus'],
    contactPhone: row.contactPhone,
    contactPersonName: row.contactPersonName ?? undefined,
    offeredRatesInr: (row.offeredRatesInr ?? {}) as Record<string, number>,
    pickupAvailable: row.pickupAvailable,
    pickupMinWeightKg: row.pickupMinWeightKg ?? undefined,
    serviceAreaRadiusKm: row.serviceAreaRadiusKm,
    paymentModes: row.paymentModes as Recycler['paymentModes'],
    rating: row.rating ?? undefined,
    ratingCount: row.ratingCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPricePoint(row: PriceRow): PricePoint {
  return {
    priceId: row.priceId,
    categoryId: row.categoryId as MaterialCategoryId,
    subCategoryId: row.subCategoryId,
    district: row.district,
    state: row.state,
    observedAt: row.observedAt.toISOString(),
    buyingPriceInr: num(row.buyingPriceInr),
    quotedPriceInr: optNum(row.quotedPriceInr),
    unit: row.unit as PricePoint['unit'],
    currency: 'INR',
    marketLowInr: num(row.marketLowInr),
    marketHighInr: num(row.marketHighInr),
    recyclerId: row.recyclerId ?? undefined,
    source: row.source as PricePoint['source'],
    confidence: row.confidence,
  };
}

function fromPricePoint(point: PricePoint) {
  return {
    priceId: point.priceId,
    categoryId: point.categoryId,
    subCategoryId: point.subCategoryId,
    district: point.district,
    state: point.state,
    observedAt: new Date(point.observedAt),
    buyingPriceInr: point.buyingPriceInr,
    quotedPriceInr: point.quotedPriceInr ?? null,
    unit: point.unit,
    currency: point.currency,
    marketLowInr: point.marketLowInr,
    marketHighInr: point.marketHighInr,
    recyclerId: point.recyclerId ?? null,
    source: point.source,
    confidence: point.confidence,
  };
}

function toCollector(row: CollectorRow): Collector {
  return {
    collectorId: row.collectorId,
    phoneHash: row.phoneHash,
    preferredLanguage: row.preferredLanguage as Collector['preferredLanguage'],
    operatingDistrict: row.operatingDistrict,
    operatingState: row.operatingState,
    createdAt: row.createdAt.toISOString(),
    lifetimeEarningsInr: num(row.lifetimeEarningsInr),
    pendingDuesInr: num(row.pendingDuesInr),
    completedTransactions: row.completedTransactions,
  };
}

function toMaterialItem(row: MaterialRow): MaterialItem {
  return {
    materialId: row.materialId,
    lotId: row.lotId,
    categoryId: row.categoryId as MaterialCategoryId,
    subCategoryId: row.subCategoryId,
    description: row.description,
    imageRefs: row.imageRefs,
    approxWeightKg: row.approxWeightKg,
    unit: row.unit as MaterialItem['unit'],
    quantity: row.quantity,
    condition: row.condition as MaterialItem['condition'],
    sourceType: row.sourceType as MaterialItem['sourceType'],
    estimatedValueInr: num(row.estimatedValueInr),
    classificationSource: row.classificationSource as MaterialItem['classificationSource'],
    modelConfidence: row.modelConfidence ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function fromMaterialItem(item: MaterialItem) {
  return {
    materialId: item.materialId,
    lotId: item.lotId,
    categoryId: item.categoryId,
    subCategoryId: item.subCategoryId,
    description: item.description,
    imageRefs: item.imageRefs,
    approxWeightKg: item.approxWeightKg,
    unit: item.unit,
    quantity: item.quantity,
    condition: item.condition,
    sourceType: item.sourceType,
    estimatedValueInr: item.estimatedValueInr,
    classificationSource: item.classificationSource,
    modelConfidence: item.modelConfidence ?? null,
    createdAt: new Date(item.createdAt),
  };
}

function toLot(row: LotRow): Lot {
  return {
    lotId: row.lotId,
    collectorId: row.collectorId,
    status: row.status as Lot['status'],
    items: row.items.map(toMaterialItem),
    totalWeightKg: row.totalWeightKg,
    estimatedValueInr: num(row.estimatedValueInr),
    collectionPlace: {
      locality: row.locality,
      district: row.district,
      state: row.state,
      point: row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : undefined,
    },
    collectedAt: row.collectedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    recyclerId: row.recyclerId ?? undefined,
    quotedPriceInr: optNum(row.quotedPriceInr),
    notes: row.notes ?? undefined,
  };
}

function toHandover(row: HandoverRow): HandoverRecord {
  return {
    handoverRef: row.handoverRef,
    lotId: row.lotId,
    collectorId: row.collectorId,
    recyclerId: row.recyclerId,
    verificationCode: row.verificationCode,
    digest: row.digest,
    photoRefs: row.photoRefs,
    photoHashes: row.photoHashes,
    weighedWeightKg: row.weighedWeightKg,
    declaredWeightKg: row.declaredWeightKg,
    handoverPoint: { lat: row.lat, lon: row.lon },
    handoverPlace: { locality: row.locality, district: row.district, state: row.state },
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString(),
    confirmedBy: row.confirmedBy ?? undefined,
    confirmationStatus: row.confirmationStatus as HandoverRecord['confirmationStatus'],
    rejectionReason: row.rejectionReason ?? undefined,
    downstreamStatus: (row.downstreamStatus ?? undefined) as HandoverRecord['downstreamStatus'],
    transactionId: row.transactionId ?? undefined,
  };
}

function fromHandover(record: HandoverRecord) {
  return {
    handoverRef: record.handoverRef,
    lotId: record.lotId,
    collectorId: record.collectorId,
    recyclerId: record.recyclerId,
    transactionId: record.transactionId ?? null,
    verificationCode: record.verificationCode,
    digest: record.digest,
    photoRefs: record.photoRefs,
    photoHashes: record.photoHashes,
    declaredWeightKg: record.declaredWeightKg,
    weighedWeightKg: record.weighedWeightKg,
    lat: record.handoverPoint.lat,
    lon: record.handoverPoint.lon,
    locality: record.handoverPlace.locality,
    district: record.handoverPlace.district,
    state: record.handoverPlace.state,
    createdAt: new Date(record.createdAt),
    confirmedAt: record.confirmedAt ? new Date(record.confirmedAt) : null,
    confirmedBy: record.confirmedBy ?? null,
    confirmationStatus: record.confirmationStatus,
    rejectionReason: record.rejectionReason ?? null,
    downstreamStatus: record.downstreamStatus ?? null,
  };
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    transactionId: row.transactionId,
    lotId: row.lotId,
    collectorId: row.collectorId,
    recyclerId: row.recyclerId,
    categorySummary: row.categorySummary as MaterialCategoryId[],
    totalWeightKg: row.totalWeightKg,
    estimatedValueInr: num(row.estimatedValueInr),
    quotedPriceInr: num(row.quotedPriceInr),
    finalPriceInr: num(row.finalPriceInr),
    collectionPlace: { locality: '', district: row.collectionDistrict, state: '' },
    handoverPlace: { locality: '', district: row.handoverDistrict, state: '' },
    handoverAt: row.handoverAt.toISOString(),
    paymentStatus: row.paymentStatus as Transaction['paymentStatus'],
    paymentMode: row.paymentMode as Transaction['paymentMode'],
    paidAt: row.paidAt?.toISOString(),
    status: row.status as Transaction['status'],
    anomalyFlags: row.anomalyFlags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function fromTransaction(t: Transaction) {
  return {
    transactionId: t.transactionId,
    lotId: t.lotId,
    collectorId: t.collectorId,
    recyclerId: t.recyclerId,
    categorySummary: t.categorySummary,
    totalWeightKg: t.totalWeightKg,
    estimatedValueInr: t.estimatedValueInr,
    quotedPriceInr: t.quotedPriceInr,
    finalPriceInr: t.finalPriceInr,
    collectionDistrict: t.collectionPlace.district,
    handoverDistrict: t.handoverPlace.district,
    handoverAt: new Date(t.handoverAt),
    paymentStatus: t.paymentStatus,
    paymentMode: t.paymentMode,
    paidAt: t.paidAt ? new Date(t.paidAt) : null,
    status: t.status,
    anomalyFlags: t.anomalyFlags,
  };
}

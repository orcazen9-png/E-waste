import {
  RuleBasedAnomalyDetector,
  newTransactionId,
  parseHandoverQr,
  verifyHandover,
  type AnomalyFlag,
  type HandoverRecord,
  type Lot,
  type PaymentMode,
  type Transaction,
} from '@ewaste/shared';
import type { Repository } from '../repository/types.ts';
import type { PriceService } from './prices.ts';

/**
 * Handover and confirmation - the step that turns a pile of scrap into a
 * traceable, documented transfer.
 *
 * The slip is created and signed on the collector's phone, offline. The server
 * never mints one; it only verifies what arrives and records the recycler's
 * counter-signature. That ordering matters: if the server had to be reachable
 * to produce a slip, the whole thing would fail exactly where connectivity is
 * worst.
 */
export class HandoverService {
  private readonly detector = new RuleBasedAnomalyDetector();

  constructor(
    private readonly repo: Repository,
    private readonly prices: PriceService,
  ) {}

  /**
   * Records a slip produced on a phone. `deviceSecret` is supplied by the
   * caller's authenticated session; the digest is re-checked here so a
   * tampered slip is rejected at the boundary rather than trusted because it
   * arrived over HTTPS.
   */
  async record(record: HandoverRecord, deviceSecret: string): Promise<{ record: HandoverRecord; flags: AnomalyFlag[] }> {
    const verification = verifyHandover(record, deviceSecret);
    if (!verification.valid) {
      throw new HandoverError(400, verification.reason ?? 'handover.invalid_digest');
    }

    const existing = await this.repo.getHandover(record.handoverRef);
    if (existing) return { record: existing, flags: [] }; // idempotent replay

    const lot = await this.repo.getLot(record.lotId);
    if (!lot) throw new HandoverError(404, 'handover.unknown_lot');

    const flags = await this.screen(lot, record);
    const saved = await this.repo.createHandover(record);

    lot.status = 'handed_over';
    lot.recyclerId = record.recyclerId;
    lot.updatedAt = new Date().toISOString();
    await this.repo.upsertLot(lot);

    return { record: saved, flags };
  }

  /** What the recycler console calls after scanning the QR code. */
  async lookupByQr(payload: string): Promise<{ record: HandoverRecord; lot: Lot } | undefined> {
    const parsed = parseHandoverQr(payload);
    const record = await this.repo.getHandover(parsed.handoverRef);
    if (!record) return undefined;
    // The QR carries a digest prefix; a mismatch means the code was re-encoded.
    if (!record.digest.startsWith(parsed.digestPrefix)) {
      throw new HandoverError(409, 'handover.invalid_digest');
    }
    const lot = await this.repo.getLot(record.lotId);
    if (!lot) throw new HandoverError(404, 'handover.unknown_lot');
    return { record, lot };
  }

  /** Fallback path when the QR will not scan: reference plus 6-digit code. */
  async lookupByCode(handoverRef: string, verificationCode: string) {
    const record = await this.repo.getHandover(handoverRef);
    if (!record) return undefined;
    if (record.verificationCode !== verificationCode) {
      throw new HandoverError(403, 'handover.invalid_code');
    }
    const lot = await this.repo.getLot(record.lotId);
    if (!lot) throw new HandoverError(404, 'handover.unknown_lot');
    return { record, lot };
  }

  async confirm(input: {
    handoverRef: string;
    recyclerId: string;
    finalPriceInr: number;
    paymentMode: PaymentMode;
    paymentStatus: 'unpaid' | 'partial' | 'paid';
    weighedWeightKg?: number;
  }): Promise<{ handover: HandoverRecord; transaction: Transaction; flags: AnomalyFlag[] }> {
    const record = await this.repo.getHandover(input.handoverRef);
    if (!record) throw new HandoverError(404, 'handover.not_found');
    if (record.recyclerId !== input.recyclerId) throw new HandoverError(403, 'handover.wrong_recycler');
    if (record.confirmationStatus === 'confirmed') {
      const existing = record.transactionId ? await this.repo.getTransaction(record.transactionId) : undefined;
      if (existing) return { handover: record, transaction: existing, flags: [] }; // idempotent
    }

    const lot = await this.repo.getLot(record.lotId);
    if (!lot) throw new HandoverError(404, 'handover.unknown_lot');

    const now = new Date().toISOString();
    const transactionId = newTransactionId();
    const flags = await this.screen(lot, record, {
      finalPriceInr: input.finalPriceInr,
      quotedPriceInr: lot.quotedPriceInr,
      weighedWeightKg: input.weighedWeightKg ?? record.weighedWeightKg,
    });

    const transaction: Transaction = {
      transactionId,
      lotId: lot.lotId,
      collectorId: lot.collectorId,
      recyclerId: input.recyclerId,
      categorySummary: [...new Set(lot.items.map((i) => i.categoryId))],
      totalWeightKg: lot.totalWeightKg,
      estimatedValueInr: lot.estimatedValueInr,
      quotedPriceInr: lot.quotedPriceInr ?? input.finalPriceInr,
      finalPriceInr: input.finalPriceInr,
      collectionPlace: lot.collectionPlace,
      handoverPlace: record.handoverPlace,
      handoverAt: record.createdAt,
      paymentStatus: input.paymentStatus,
      paymentMode: input.paymentMode,
      paidAt: input.paymentStatus === 'paid' ? now : undefined,
      status: 'completed',
      anomalyFlags: flags.map((f) => f.code),
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.upsertTransaction(transaction);

    const handover = await this.repo.updateHandover(record.handoverRef, {
      confirmationStatus: 'confirmed',
      confirmedAt: now,
      confirmedBy: input.recyclerId,
      transactionId,
      downstreamStatus: 'received',
      weighedWeightKg: input.weighedWeightKg ?? record.weighedWeightKg,
    });

    lot.status = input.paymentStatus === 'paid' ? 'paid' : 'confirmed';
    lot.recyclerId = input.recyclerId;
    lot.updatedAt = now;
    await this.repo.upsertLot(lot);

    await this.updateLedger(lot.collectorId);

    // A settled transaction is the highest-confidence price observation the
    // platform has. Feeding it back is what makes the price dataset improve
    // with use instead of going stale.
    await this.recordPriceObservations(lot, transaction);

    await this.repo.appendToFeed({
      collectorId: lot.collectorId,
      entity: 'transaction',
      entityId: transactionId,
      op: 'upsert',
      payload: transaction,
    });

    return { handover, transaction, flags };
  }

  async reject(handoverRef: string, recyclerId: string, reason: string): Promise<HandoverRecord> {
    const record = await this.repo.getHandover(handoverRef);
    if (!record) throw new HandoverError(404, 'handover.not_found');
    if (record.recyclerId !== recyclerId) throw new HandoverError(403, 'handover.wrong_recycler');
    if (record.confirmationStatus === 'confirmed') throw new HandoverError(409, 'handover.already_confirmed');

    const updated = await this.repo.updateHandover(handoverRef, {
      confirmationStatus: 'rejected',
      rejectionReason: reason,
      confirmedAt: new Date().toISOString(),
      confirmedBy: recyclerId,
    });
    await this.repo.appendToFeed({
      collectorId: record.collectorId,
      entity: 'handover',
      entityId: handoverRef,
      op: 'upsert',
      payload: updated,
    });
    return updated;
  }

  async setDownstreamStatus(
    handoverRef: string,
    recyclerId: string,
    status: NonNullable<HandoverRecord['downstreamStatus']>,
  ): Promise<HandoverRecord> {
    const record = await this.repo.getHandover(handoverRef);
    if (!record) throw new HandoverError(404, 'handover.not_found');
    if (record.recyclerId !== recyclerId) throw new HandoverError(403, 'handover.wrong_recycler');
    return this.repo.updateHandover(handoverRef, { downstreamStatus: status });
  }

  private async screen(
    lot: Lot,
    record: HandoverRecord,
    extra: { finalPriceInr?: number; quotedPriceInr?: number; weighedWeightKg?: number } = {},
  ): Promise<AnomalyFlag[]> {
    const priceIndex = await this.prices.getIndex(lot.collectionPlace.district);
    const knownPhotoHashes = await this.repo.knownPhotoHashes(lot.lotId);
    const collectorHistory = await this.repo.listTransactions({ collectorId: lot.collectorId, limit: 30 });

    return this.detector.detect(
      {
        district: lot.collectionPlace.district,
        items: lot.items.map((i) => ({
          subCategoryId: i.subCategoryId,
          approxWeightKg: i.approxWeightKg,
          quantity: i.quantity,
          condition: i.condition,
        })),
        declaredWeightKg: record.declaredWeightKg,
        weighedWeightKg: extra.weighedWeightKg ?? record.weighedWeightKg,
        estimatedValueInr: lot.estimatedValueInr,
        quotedPriceInr: extra.quotedPriceInr,
        finalPriceInr: extra.finalPriceInr,
        photoHashes: record.photoHashes,
        collectionPoint: lot.collectionPlace.point,
        collectedAt: lot.collectedAt,
        handoverPoint: record.handoverPoint,
        handoverAt: record.createdAt,
      },
      { priceIndex, knownPhotoHashes, collectorHistory },
    );
  }

  private async updateLedger(collectorId: string): Promise<void> {
    const collector = await this.repo.getCollector(collectorId);
    if (!collector) return;
    const all = await this.repo.listTransactions({ collectorId });
    collector.completedTransactions = all.filter((t) => t.status === 'completed').length;
    collector.lifetimeEarningsInr = round2(
      all.filter((t) => t.paymentStatus === 'paid').reduce((s, t) => s + t.finalPriceInr, 0),
    );
    collector.pendingDuesInr = round2(
      all
        .filter((t) => t.paymentStatus !== 'paid' && t.status !== 'cancelled')
        .reduce((s, t) => s + (t.paymentStatus === 'partial' ? t.finalPriceInr / 2 : t.finalPriceInr), 0),
    );
    await this.repo.upsertCollector(collector);
  }

  private async recordPriceObservations(lot: Lot, transaction: Transaction): Promise<void> {
    if (lot.estimatedValueInr <= 0) return;
    const observedAt = transaction.handoverAt;
    for (const item of lot.items) {
      if (item.approxWeightKg <= 0) continue;
      // Split the settled price across items in proportion to their estimate,
      // which is the only defensible attribution without a per-item weighing.
      const share = item.estimatedValueInr / lot.estimatedValueInr;
      const realisedRate = (transaction.finalPriceInr * share) / item.approxWeightKg;
      await this.repo.appendPricePoint({
        priceId: `PRC_TXN_${transaction.transactionId}_${item.materialId}`,
        categoryId: item.categoryId,
        subCategoryId: item.subCategoryId,
        district: lot.collectionPlace.district,
        state: lot.collectionPlace.state,
        observedAt,
        buyingPriceInr: round2(realisedRate),
        unit: item.unit,
        currency: 'INR',
        marketLowInr: round2(realisedRate * 0.85),
        marketHighInr: round2(realisedRate * 1.15),
        recyclerId: transaction.recyclerId,
        source: 'completed_transaction',
        confidence: 0.9,
      });
    }
    this.prices.invalidate();
  }
}

export class HandoverError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

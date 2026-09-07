import { generateDataset, type GeneratedDataset } from '@ewaste/datasets';
import type {
  Collector,
  HandoverRecord,
  Lot,
  PricePoint,
  Recycler,
  Transaction,
} from '@ewaste/shared';
import type { Repository } from './types.ts';

/**
 * In-memory adapter backed by the synthetic seed dataset.
 *
 * This is what makes the whole system demonstrable with no infrastructure: the
 * recycler console, the price board and the matcher all work against a real
 * dataset the moment the process starts. It is also what the API tests run
 * against, so route behaviour is verified without a database in CI.
 *
 * Not for production - it is process-local and loses writes on restart.
 */
export class MemoryRepository implements Repository {
  readonly kind = 'memory' as const;

  private recyclers = new Map<string, Recycler>();
  private prices: PricePoint[] = [];
  private collectors = new Map<string, Collector>();
  private lots = new Map<string, Lot>();
  private handovers = new Map<string, HandoverRecord>();
  private transactions = new Map<string, Transaction>();
  private appliedChanges = new Set<string>();
  private feed: Array<{
    serverSeq: number;
    collectorId: string;
    entity: string;
    entityId: string;
    op: string;
    payload: unknown;
    createdAt: string;
  }> = [];
  private seq = 0;

  constructor(dataset: GeneratedDataset = generateDataset()) {
    for (const r of dataset.recyclers) this.recyclers.set(r.recyclerId, r);
    for (const c of dataset.collectors) this.collectors.set(c.collectorId, c);
    for (const l of dataset.lots) this.lots.set(l.lotId, l);
    for (const h of dataset.handovers) this.handovers.set(h.handoverRef, h);
    for (const t of dataset.transactions) this.transactions.set(t.transactionId, t);
    this.prices = dataset.prices;
  }

  async listRecyclers(filter: { district?: string; authorizedOnly?: boolean } = {}): Promise<Recycler[]> {
    return [...this.recyclers.values()].filter(
      (r) =>
        (!filter.district || r.place.district === filter.district) &&
        (!filter.authorizedOnly || r.authorizationStatus === 'authorized'),
    );
  }

  async getRecycler(recyclerId: string): Promise<Recycler | undefined> {
    return this.recyclers.get(recyclerId);
  }

  async listPricePoints(
    filter: { district?: string; subCategoryId?: string; since?: Date; limit?: number } = {},
  ): Promise<PricePoint[]> {
    let rows = this.prices;
    if (filter.district) rows = rows.filter((p) => p.district === filter.district);
    if (filter.subCategoryId) rows = rows.filter((p) => p.subCategoryId === filter.subCategoryId);
    if (filter.since) {
      const cutoff = filter.since.getTime();
      rows = rows.filter((p) => Date.parse(p.observedAt) >= cutoff);
    }
    return filter.limit ? rows.slice(-filter.limit) : rows;
  }

  async appendPricePoint(point: PricePoint): Promise<void> {
    this.prices.push(point);
  }

  async getCollector(collectorId: string): Promise<Collector | undefined> {
    return this.collectors.get(collectorId);
  }

  async getCollectorByPhoneHash(phoneHash: string): Promise<Collector | undefined> {
    return [...this.collectors.values()].find((c) => c.phoneHash === phoneHash);
  }

  async upsertCollector(collector: Collector): Promise<Collector> {
    this.collectors.set(collector.collectorId, collector);
    return collector;
  }

  async getLot(lotId: string): Promise<Lot | undefined> {
    return this.lots.get(lotId);
  }

  async listLots(filter: {
    collectorId?: string;
    district?: string;
    status?: string;
    limit?: number;
  }): Promise<Lot[]> {
    let rows = [...this.lots.values()];
    if (filter.collectorId) rows = rows.filter((l) => l.collectorId === filter.collectorId);
    if (filter.district) rows = rows.filter((l) => l.collectionPlace.district === filter.district);
    if (filter.status) rows = rows.filter((l) => l.status === filter.status);
    rows.sort((a, b) => (a.collectedAt < b.collectedAt ? 1 : -1));
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  async upsertLot(lot: Lot): Promise<Lot> {
    this.lots.set(lot.lotId, lot);
    return lot;
  }

  async getHandover(handoverRef: string): Promise<HandoverRecord | undefined> {
    return this.handovers.get(handoverRef);
  }

  async listHandovers(filter: {
    recyclerId?: string;
    collectorId?: string;
    confirmationStatus?: HandoverRecord['confirmationStatus'];
    limit?: number;
  }): Promise<HandoverRecord[]> {
    let rows = [...this.handovers.values()];
    if (filter.recyclerId) rows = rows.filter((h) => h.recyclerId === filter.recyclerId);
    if (filter.collectorId) rows = rows.filter((h) => h.collectorId === filter.collectorId);
    if (filter.confirmationStatus) rows = rows.filter((h) => h.confirmationStatus === filter.confirmationStatus);
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  async createHandover(record: HandoverRecord): Promise<HandoverRecord> {
    this.handovers.set(record.handoverRef, record);
    return record;
  }

  async updateHandover(handoverRef: string, patch: Partial<HandoverRecord>): Promise<HandoverRecord> {
    const existing = this.handovers.get(handoverRef);
    if (!existing) throw new Error(`Unknown handover: ${handoverRef}`);
    const updated = { ...existing, ...patch };
    this.handovers.set(handoverRef, updated);
    return updated;
  }

  async knownPhotoHashes(excludeLotId?: string): Promise<Set<string>> {
    const hashes = new Set<string>();
    for (const h of this.handovers.values()) {
      if (excludeLotId && h.lotId === excludeLotId) continue;
      for (const hash of h.photoHashes) hashes.add(hash);
    }
    return hashes;
  }

  async getTransaction(transactionId: string): Promise<Transaction | undefined> {
    return this.transactions.get(transactionId);
  }

  async listTransactions(filter: {
    collectorId?: string;
    recyclerId?: string;
    since?: Date;
    limit?: number;
  }): Promise<Transaction[]> {
    let rows = [...this.transactions.values()];
    if (filter.collectorId) rows = rows.filter((t) => t.collectorId === filter.collectorId);
    if (filter.recyclerId) rows = rows.filter((t) => t.recyclerId === filter.recyclerId);
    if (filter.since) {
      const cutoff = filter.since.getTime();
      rows = rows.filter((t) => Date.parse(t.handoverAt) >= cutoff);
    }
    rows.sort((a, b) => (a.handoverAt < b.handoverAt ? 1 : -1));
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  async upsertTransaction(transaction: Transaction): Promise<Transaction> {
    this.transactions.set(transaction.transactionId, transaction);
    return transaction;
  }

  async wasChangeApplied(changeId: string): Promise<boolean> {
    return this.appliedChanges.has(changeId);
  }

  async recordChange(entry: { changeId: string }): Promise<void> {
    this.appliedChanges.add(entry.changeId);
  }

  async appendToFeed(entry: {
    collectorId: string;
    entity: string;
    entityId: string;
    op: string;
    payload: unknown;
  }): Promise<void> {
    this.seq += 1;
    this.feed.push({ ...entry, serverSeq: this.seq, createdAt: new Date().toISOString() });
  }

  async readFeed(collectorId: string, cursor: string | undefined, limit: number) {
    const after = cursor ? Number(cursor) : 0;
    const all = this.feed.filter((e) => e.collectorId === collectorId && e.serverSeq > after);
    const entries = all.slice(0, limit);
    return {
      entries: entries.map((e) => ({
        serverSeq: String(e.serverSeq),
        entity: e.entity,
        entityId: e.entityId,
        op: e.op,
        payload: e.payload,
        createdAt: e.createdAt,
      })),
      cursor: String(entries.at(-1)?.serverSeq ?? after),
      hasMore: all.length > entries.length,
    };
  }
}

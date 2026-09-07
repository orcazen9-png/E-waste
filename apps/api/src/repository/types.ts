import type {
  Collector,
  HandoverRecord,
  Lot,
  PricePoint,
  Recycler,
  Transaction,
} from '@ewaste/shared';

/**
 * The storage port.
 *
 * Routes and services depend on this interface, never on Prisma. That keeps
 * two things honest: the API can run with no database at all for a demo or a
 * test (the in-memory adapter), and the Postgres adapter can be swapped or
 * sharded later without touching a route.
 */
export interface Repository {
  readonly kind: 'memory' | 'postgres';

  /* Reference data */
  listRecyclers(filter?: { district?: string; authorizedOnly?: boolean }): Promise<Recycler[]>;
  getRecycler(recyclerId: string): Promise<Recycler | undefined>;
  listPricePoints(filter?: {
    district?: string;
    subCategoryId?: string;
    since?: Date;
    limit?: number;
  }): Promise<PricePoint[]>;
  appendPricePoint(point: PricePoint): Promise<void>;

  /* Collectors */
  getCollector(collectorId: string): Promise<Collector | undefined>;
  getCollectorByPhoneHash(phoneHash: string): Promise<Collector | undefined>;
  upsertCollector(collector: Collector): Promise<Collector>;

  /* Lots */
  getLot(lotId: string): Promise<Lot | undefined>;
  listLots(filter: { collectorId?: string; district?: string; status?: string; limit?: number }): Promise<Lot[]>;
  upsertLot(lot: Lot): Promise<Lot>;

  /* Handovers - the traceability record */
  getHandover(handoverRef: string): Promise<HandoverRecord | undefined>;
  listHandovers(filter: {
    recyclerId?: string;
    collectorId?: string;
    confirmationStatus?: HandoverRecord['confirmationStatus'];
    limit?: number;
  }): Promise<HandoverRecord[]>;
  createHandover(record: HandoverRecord): Promise<HandoverRecord>;
  updateHandover(handoverRef: string, patch: Partial<HandoverRecord>): Promise<HandoverRecord>;
  /** Used by the duplicate-photo check. */
  knownPhotoHashes(excludeLotId?: string): Promise<Set<string>>;

  /* Transactions */
  getTransaction(transactionId: string): Promise<Transaction | undefined>;
  listTransactions(filter: {
    collectorId?: string;
    recyclerId?: string;
    since?: Date;
    limit?: number;
  }): Promise<Transaction[]>;
  upsertTransaction(transaction: Transaction): Promise<Transaction>;

  /* Sync */
  wasChangeApplied(changeId: string): Promise<boolean>;
  recordChange(entry: {
    changeId: string;
    deviceId: string;
    collectorId: string;
    entity: string;
    entityId: string;
    op: string;
    outcome: string;
  }): Promise<void>;
  appendToFeed(entry: {
    collectorId: string;
    entity: string;
    entityId: string;
    op: string;
    payload: unknown;
  }): Promise<void>;
  readFeed(collectorId: string, cursor: string | undefined, limit: number): Promise<{
    entries: Array<{ serverSeq: string; entity: string; entityId: string; op: string; payload: unknown; createdAt: string }>;
    cursor: string;
    hasMore: boolean;
  }>;
}

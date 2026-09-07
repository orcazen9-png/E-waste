import {
  newId,
  backoffMs,
  type HandoverRecord,
  type Lot,
  type MaterialItem,
  type OutboxEntry,
  type PriceIndex,
  type Recycler,
  type Transaction,
} from '@ewaste/shared';

/**
 * Web storage.
 *
 * expo-sqlite has no web build, so the browser needs its own store. Metro
 * picks this file automatically for the web platform; the phone still uses
 * SQLite via `index.ts`, and the two expose exactly the same API.
 *
 * This exists so the app can be opened, driven and demonstrated in a browser -
 * for evaluation and for automated UI tests. **The phone is the real target**:
 * this store is a plain object graph persisted to localStorage, with none of
 * SQLite's durability guarantees, and it is not what ships to a collector.
 */

interface WebState {
  meta: Record<string, string>;
  lots: Record<string, Lot>;
  handovers: Record<string, HandoverRecord>;
  transactions: Record<string, LocalTransaction>;
  outbox: Record<string, StoredOutboxEntry>;
  reference: Record<string, { version: string; payload: unknown; fetchedAt: string }>;
}

interface StoredOutboxEntry {
  changeId: string;
  entity: OutboxEntry['entity'];
  entityId: string;
  op: OutboxEntry['op'];
  payload: unknown;
  clientUpdatedAt: string;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
}

const STORAGE_KEY = 'ewaste.web.v1';

const empty = (): WebState => ({
  meta: {},
  lots: {},
  handovers: {},
  transactions: {},
  outbox: {},
  reference: {},
});

let state: WebState | undefined;

function load(): WebState {
  if (state) return state;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    state = raw ? (JSON.parse(raw) as WebState) : empty();
  } catch {
    // A private window, or storage disabled. Run in memory rather than refuse
    // to start - losing data on reload beats not starting at all.
    state = empty();
  }
  return state;
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(load()));
  } catch {
    /* over quota or unavailable; keep going in memory */
  }
}

export async function openDatabase(): Promise<void> {
  load();
}

/* ------------------------------------------------------------------ */
/* Meta                                                                */
/* ------------------------------------------------------------------ */

export async function getMeta(key: string): Promise<string | undefined> {
  const value = load().meta[key];
  return value === '' ? undefined : value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  load().meta[key] = value;
  persist();
}

/* ------------------------------------------------------------------ */
/* Lots                                                                */
/* ------------------------------------------------------------------ */

function enqueue(entry: {
  entity: OutboxEntry['entity'];
  entityId: string;
  op: OutboxEntry['op'];
  payload: unknown;
  clientUpdatedAt: string;
}): void {
  const changeId = newId('CHG');
  load().outbox[changeId] = {
    changeId,
    ...entry,
    attempts: 0,
    nextAttemptAt: new Date().toISOString(),
  };
}

export async function saveLot(lot: Lot): Promise<void> {
  const store = load();
  store.lots[lot.lotId] = lot;
  enqueue({
    entity: 'lot',
    entityId: lot.lotId,
    op: 'upsert',
    payload: lot,
    clientUpdatedAt: lot.updatedAt,
  });
  persist();
}

export async function listLots(limit = 50): Promise<Lot[]> {
  return Object.values(load().lots)
    .sort((a, b) => (a.collectedAt < b.collectedAt ? 1 : -1))
    .slice(0, limit);
}

export async function getLot(lotId: string): Promise<Lot | undefined> {
  return load().lots[lotId];
}

/* ------------------------------------------------------------------ */
/* Handovers and transactions                                          */
/* ------------------------------------------------------------------ */

export async function saveHandover(record: HandoverRecord): Promise<void> {
  const store = load();
  store.handovers[record.handoverRef] = record;
  const lot = store.lots[record.lotId];
  if (lot) {
    lot.status = 'handed_over';
    lot.recyclerId = record.recyclerId;
    lot.updatedAt = record.createdAt;
  }
  enqueue({
    entity: 'handover',
    entityId: record.handoverRef,
    op: 'upsert',
    payload: record,
    clientUpdatedAt: record.createdAt,
  });
  persist();
}

export async function getHandoverForLot(lotId: string): Promise<HandoverRecord | undefined> {
  return Object.values(load().handovers)
    .filter((h) => h.lotId === lotId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

export type TransactionRow = Pick<
  Transaction,
  | 'transactionId'
  | 'lotId'
  | 'recyclerId'
  | 'totalWeightKg'
  | 'finalPriceInr'
  | 'handoverAt'
  | 'paymentStatus'
  | 'paymentMode'
  | 'status'
  | 'anomalyFlags'
>;

export interface LocalTransaction {
  transactionId: string;
  lotId: string;
  recyclerId: string;
  totalWeightKg: number;
  finalPriceInr: number;
  handoverAt: string;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  paymentMode: 'cash' | 'upi' | 'bank_transfer';
  status: string;
  anomalyFlags: string[];
}

export async function saveTransactions(transactions: TransactionRow[]): Promise<void> {
  const store = load();
  for (const t of transactions) {
    store.transactions[t.transactionId] = {
      transactionId: t.transactionId,
      lotId: t.lotId,
      recyclerId: t.recyclerId,
      totalWeightKg: t.totalWeightKg,
      finalPriceInr: t.finalPriceInr,
      handoverAt: t.handoverAt,
      paymentStatus: t.paymentStatus,
      paymentMode: t.paymentMode,
      status: t.status,
      anomalyFlags: t.anomalyFlags,
    };
  }
  persist();
}

export async function listTransactions(limit = 100): Promise<LocalTransaction[]> {
  return Object.values(load().transactions)
    .sort((a, b) => (a.handoverAt < b.handoverAt ? 1 : -1))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Outbox                                                              */
/* ------------------------------------------------------------------ */

export async function readyOutbox(limit = 50): Promise<OutboxEntry[]> {
  const now = new Date().toISOString();
  return Object.values(load().outbox)
    .filter((e) => e.nextAttemptAt <= now)
    .sort((a, b) => (a.clientUpdatedAt < b.clientUpdatedAt ? -1 : 1))
    .slice(0, limit)
    .map((e) => ({
      changeId: e.changeId,
      entity: e.entity,
      entityId: e.entityId,
      op: e.op,
      payload: e.payload,
      clientUpdatedAt: e.clientUpdatedAt,
      deviceId: '',
      attempts: e.attempts,
      lastError: e.lastError,
    }));
}

export async function pendingCount(): Promise<number> {
  return Object.keys(load().outbox).length;
}

export async function dropFromOutbox(changeIds: string[]): Promise<void> {
  const store = load();
  for (const id of changeIds) delete store.outbox[id];
  persist();
}

export async function deferOutbox(changeId: string, attempts: number, error: string): Promise<void> {
  const entry = load().outbox[changeId];
  if (!entry) return;
  entry.attempts = attempts + 1;
  entry.nextAttemptAt = new Date(Date.now() + backoffMs(attempts + 1)).toISOString();
  entry.lastError = error.slice(0, 300);
  persist();
}

/* ------------------------------------------------------------------ */
/* Reference cache                                                     */
/* ------------------------------------------------------------------ */

export async function cacheReference(key: string, version: string, payload: unknown): Promise<void> {
  load().reference[key] = { version, payload, fetchedAt: new Date().toISOString() };
  persist();
}

export async function readReference<T>(
  key: string,
): Promise<{ version: string; payload: T; fetchedAt: string } | undefined> {
  const entry = load().reference[key];
  return entry ? { version: entry.version, payload: entry.payload as T, fetchedAt: entry.fetchedAt } : undefined;
}

export const REFERENCE_KEYS = {
  priceIndex: 'price_index',
  recyclers: 'recyclers',
} as const;

export async function cachedPriceIndex(): Promise<{ index: PriceIndex; fetchedAt: string } | undefined> {
  const cached = await readReference<PriceIndex>(REFERENCE_KEYS.priceIndex);
  return cached ? { index: cached.payload, fetchedAt: cached.fetchedAt } : undefined;
}

export async function cachedRecyclers(): Promise<Recycler[]> {
  const cached = await readReference<Recycler[]>(REFERENCE_KEYS.recyclers);
  return cached?.payload ?? [];
}

/** Unused on web, but kept so the module's shape matches the native one. */
export type { MaterialItem };

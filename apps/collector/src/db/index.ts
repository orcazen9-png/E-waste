import * as SQLite from 'expo-sqlite';
import {
  newId,
  type HandoverRecord,
  type Lot,
  type MaterialItem,
  type OutboxEntry,
  type PriceIndex,
  type Recycler,
  type Transaction,
  backoffMs,
} from '@ewaste/shared';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.ts';

let database: SQLite.SQLiteDatabase | undefined;

export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  const db = await SQLite.openDatabaseAsync('ewaste.db');
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrate(db);
  database = db;
  return db;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let version = current; version < SCHEMA_VERSION; version++) {
    const statements = MIGRATIONS[version];
    if (!statements) continue;
    await db.withTransactionAsync(async () => {
      for (const statement of statements) await db.execAsync(statement);
    });
  }
  if (current < SCHEMA_VERSION) await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/* ------------------------------------------------------------------ */
/* Meta                                                                */
/* ------------------------------------------------------------------ */

export async function getMeta(key: string): Promise<string | undefined> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await openDatabase();
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

/* ------------------------------------------------------------------ */
/* Lots                                                                */
/* ------------------------------------------------------------------ */

/**
 * Saves a lot and queues it for sync in one transaction. If the app dies
 * between the two, the collector would otherwise have a lot on screen that the
 * server will never hear about.
 */
export async function saveLot(lot: Lot): Promise<void> {
  const db = await openDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO lots
        (lot_id, collector_id, status, total_weight_kg, estimated_value_inr, locality, district, state,
         lat, lon, collected_at, created_at, updated_at, recycler_id, quoted_price_inr, synced)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      lot.lotId,
      lot.collectorId,
      lot.status,
      lot.totalWeightKg,
      lot.estimatedValueInr,
      lot.collectionPlace.locality,
      lot.collectionPlace.district,
      lot.collectionPlace.state,
      lot.collectionPlace.point?.lat ?? null,
      lot.collectionPlace.point?.lon ?? null,
      lot.collectedAt,
      lot.createdAt,
      lot.updatedAt,
      lot.recyclerId ?? null,
      lot.quotedPriceInr ?? null,
    );

    await db.runAsync('DELETE FROM material_items WHERE lot_id = ?', lot.lotId);
    for (const item of lot.items) {
      await db.runAsync(
        `INSERT INTO material_items
          (material_id, lot_id, category_id, sub_category_id, description, image_refs, approx_weight_kg,
           unit, quantity, condition, source_type, estimated_value_inr, classification_source,
           model_confidence, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        item.materialId,
        item.lotId,
        item.categoryId,
        item.subCategoryId,
        item.description,
        item.imageRefs.join('|'),
        item.approxWeightKg,
        item.unit,
        item.quantity,
        item.condition,
        item.sourceType,
        item.estimatedValueInr,
        item.classificationSource,
        item.modelConfidence ?? null,
        item.createdAt,
      );
    }

    await enqueueInTransaction(db, {
      entity: 'lot',
      entityId: lot.lotId,
      op: 'upsert',
      payload: lot,
      clientUpdatedAt: lot.updatedAt,
    });
  });
}

export async function listLots(limit = 50): Promise<Lot[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<LotRow>(
    'SELECT * FROM lots ORDER BY collected_at DESC LIMIT ?',
    limit,
  );
  const lots: Lot[] = [];
  for (const row of rows) lots.push(await hydrateLot(db, row));
  return lots;
}

export async function getLot(lotId: string): Promise<Lot | undefined> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<LotRow>('SELECT * FROM lots WHERE lot_id = ?', lotId);
  return row ? hydrateLot(db, row) : undefined;
}

interface LotRow {
  lot_id: string;
  collector_id: string;
  status: string;
  total_weight_kg: number;
  estimated_value_inr: number;
  locality: string;
  district: string;
  state: string;
  lat: number | null;
  lon: number | null;
  collected_at: string;
  created_at: string;
  updated_at: string;
  recycler_id: string | null;
  quoted_price_inr: number | null;
  synced: number;
}

async function hydrateLot(db: SQLite.SQLiteDatabase, row: LotRow): Promise<Lot> {
  const items = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM material_items WHERE lot_id = ?',
    row.lot_id,
  );
  return {
    lotId: row.lot_id,
    collectorId: row.collector_id,
    status: row.status as Lot['status'],
    items: items.map(
      (i) =>
        ({
          materialId: String(i['material_id']),
          lotId: String(i['lot_id']),
          categoryId: i['category_id'],
          subCategoryId: String(i['sub_category_id']),
          description: String(i['description'] ?? ''),
          imageRefs: String(i['image_refs'] ?? '')
            .split('|')
            .filter(Boolean),
          approxWeightKg: Number(i['approx_weight_kg']),
          unit: i['unit'],
          quantity: Number(i['quantity']),
          condition: i['condition'],
          sourceType: i['source_type'],
          estimatedValueInr: Number(i['estimated_value_inr']),
          classificationSource: i['classification_source'],
          modelConfidence: i['model_confidence'] === null ? undefined : Number(i['model_confidence']),
          createdAt: String(i['created_at']),
        }) as MaterialItem,
    ),
    totalWeightKg: row.total_weight_kg,
    estimatedValueInr: row.estimated_value_inr,
    collectionPlace: {
      locality: row.locality,
      district: row.district,
      state: row.state,
      point: row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : undefined,
    },
    collectedAt: row.collected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recyclerId: row.recycler_id ?? undefined,
    quotedPriceInr: row.quoted_price_inr ?? undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Handovers and transactions                                          */
/* ------------------------------------------------------------------ */

export async function saveHandover(record: HandoverRecord): Promise<void> {
  const db = await openDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO handovers
        (handover_ref, lot_id, collector_id, recycler_id, verification_code, digest, photo_refs,
         photo_hashes, declared_weight_kg, weighed_weight_kg, lat, lon, locality, district, state,
         created_at, confirmed_at, confirmation_status, transaction_id, synced)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      record.handoverRef,
      record.lotId,
      record.collectorId,
      record.recyclerId,
      record.verificationCode,
      record.digest,
      record.photoRefs.join('|'),
      record.photoHashes.join('|'),
      record.declaredWeightKg,
      record.weighedWeightKg,
      record.handoverPoint.lat,
      record.handoverPoint.lon,
      record.handoverPlace.locality,
      record.handoverPlace.district,
      record.handoverPlace.state,
      record.createdAt,
      record.confirmedAt ?? null,
      record.confirmationStatus,
      record.transactionId ?? null,
    );
    await db.runAsync('UPDATE lots SET status = ?, recycler_id = ?, updated_at = ? WHERE lot_id = ?',
      'handed_over', record.recyclerId, record.createdAt, record.lotId);
    await enqueueInTransaction(db, {
      entity: 'handover',
      entityId: record.handoverRef,
      op: 'upsert',
      payload: record,
      clientUpdatedAt: record.createdAt,
    });
  });
}

export async function getHandoverForLot(lotId: string): Promise<HandoverRecord | undefined> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM handovers WHERE lot_id = ? ORDER BY created_at DESC LIMIT 1',
    lotId,
  );
  if (!row) return undefined;
  return {
    handoverRef: String(row['handover_ref']),
    lotId: String(row['lot_id']),
    collectorId: String(row['collector_id']),
    recyclerId: String(row['recycler_id']),
    verificationCode: String(row['verification_code']),
    digest: String(row['digest']),
    photoRefs: String(row['photo_refs'] ?? '').split('|').filter(Boolean),
    photoHashes: String(row['photo_hashes'] ?? '').split('|').filter(Boolean),
    declaredWeightKg: Number(row['declared_weight_kg']),
    weighedWeightKg: Number(row['weighed_weight_kg']),
    handoverPoint: { lat: Number(row['lat']), lon: Number(row['lon']) },
    handoverPlace: {
      locality: String(row['locality']),
      district: String(row['district']),
      state: String(row['state']),
    },
    createdAt: String(row['created_at']),
    confirmedAt: row['confirmed_at'] ? String(row['confirmed_at']) : undefined,
    confirmationStatus: row['confirmation_status'] as HandoverRecord['confirmationStatus'],
    transactionId: row['transaction_id'] ? String(row['transaction_id']) : undefined,
  };
}

export async function saveTransactions(transactions: Transaction[]): Promise<void> {
  const db = await openDatabase();
  await db.withTransactionAsync(async () => {
    for (const t of transactions) {
      await db.runAsync(
        `INSERT OR REPLACE INTO transactions
          (transaction_id, lot_id, recycler_id, total_weight_kg, final_price_inr, handover_at,
           payment_status, payment_mode, status, anomaly_flags)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        t.transactionId,
        t.lotId,
        t.recyclerId,
        t.totalWeightKg,
        t.finalPriceInr,
        t.handoverAt,
        t.paymentStatus,
        t.paymentMode,
        t.status,
        t.anomalyFlags.join('|'),
      );
    }
  });
}

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

export async function listTransactions(limit = 100): Promise<LocalTransaction[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM transactions ORDER BY handover_at DESC LIMIT ?',
    limit,
  );
  return rows.map((r) => ({
    transactionId: String(r['transaction_id']),
    lotId: String(r['lot_id']),
    recyclerId: String(r['recycler_id']),
    totalWeightKg: Number(r['total_weight_kg']),
    finalPriceInr: Number(r['final_price_inr']),
    handoverAt: String(r['handover_at']),
    paymentStatus: r['payment_status'] as LocalTransaction['paymentStatus'],
    paymentMode: r['payment_mode'] as LocalTransaction['paymentMode'],
    status: String(r['status']),
    anomalyFlags: String(r['anomaly_flags'] ?? '').split('|').filter(Boolean),
  }));
}

/* ------------------------------------------------------------------ */
/* Outbox                                                              */
/* ------------------------------------------------------------------ */

async function enqueueInTransaction(
  db: SQLite.SQLiteDatabase,
  entry: Pick<OutboxEntry, 'entity' | 'entityId' | 'op' | 'clientUpdatedAt'> & { payload: unknown },
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO outbox (change_id, entity, entity_id, op, payload, client_updated_at, attempts, next_attempt_at)
     VALUES (?,?,?,?,?,?,0,?)`,
    newId('CHG'),
    entry.entity,
    entry.entityId,
    entry.op,
    JSON.stringify(entry.payload),
    entry.clientUpdatedAt,
    new Date().toISOString(),
  );
}

export async function readyOutbox(limit = 50): Promise<OutboxEntry[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM outbox WHERE next_attempt_at <= ? ORDER BY client_updated_at ASC LIMIT ?',
    new Date().toISOString(),
    limit,
  );
  return rows.map((r) => ({
    changeId: String(r['change_id']),
    entity: r['entity'] as OutboxEntry['entity'],
    entityId: String(r['entity_id']),
    op: r['op'] as OutboxEntry['op'],
    payload: JSON.parse(String(r['payload'])) as unknown,
    clientUpdatedAt: String(r['client_updated_at']),
    deviceId: '',
    attempts: Number(r['attempts']),
    lastError: r['last_error'] ? String(r['last_error']) : undefined,
  }));
}

export async function pendingCount(): Promise<number> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
  return row?.n ?? 0;
}

export async function dropFromOutbox(changeIds: string[]): Promise<void> {
  if (changeIds.length === 0) return;
  const db = await openDatabase();
  const placeholders = changeIds.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM outbox WHERE change_id IN (${placeholders})`, ...changeIds);
}

/** Schedules a retry with exponential backoff rather than spinning on failure. */
export async function deferOutbox(changeId: string, attempts: number, error: string): Promise<void> {
  const db = await openDatabase();
  const nextAt = new Date(Date.now() + backoffMs(attempts + 1)).toISOString();
  await db.runAsync(
    'UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE change_id = ?',
    attempts + 1,
    nextAt,
    error.slice(0, 300),
    changeId,
  );
}

/* ------------------------------------------------------------------ */
/* Reference cache                                                     */
/* ------------------------------------------------------------------ */

export async function cacheReference(key: string, version: string, payload: unknown): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO reference_cache (key, version, payload, fetched_at) VALUES (?,?,?,?)',
    key,
    version,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
}

export async function readReference<T>(
  key: string,
): Promise<{ version: string; payload: T; fetchedAt: string } | undefined> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM reference_cache WHERE key = ?',
    key,
  );
  if (!row) return undefined;
  return {
    version: String(row['version']),
    payload: JSON.parse(String(row['payload'])) as T,
    fetchedAt: String(row['fetched_at']),
  };
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

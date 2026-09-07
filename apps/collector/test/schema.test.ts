import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, SCHEMA_VERSION } from '../src/db/schema.ts';

/**
 * The migration SQL runs on a phone, where a syntax error means an app that
 * never gets past its loading screen and no way to see why. Node ships a real
 * SQLite, so the statements can be executed for real here instead of being
 * trusted because they look right.
 *
 * This is not a substitute for running on a device, but it does mean a broken
 * CREATE TABLE cannot reach one.
 */
function migrate(db: DatabaseSync): void {
  for (const statements of MIGRATIONS) {
    for (const statement of statements) db.exec(statement);
  }
}

describe('local database schema', () => {
  it('has a migration for every version', () => {
    assert.equal(MIGRATIONS.length, SCHEMA_VERSION);
  });

  it('every statement executes against a real SQLite', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    // Throws with the offending SQL if any statement is malformed.
    migrate(db);
    db.close();
  });

  it('is re-runnable, so a half-applied migration recovers', () => {
    // The app applies migrations outside a transaction precisely because every
    // statement is IF NOT EXISTS. If that ever stops being true, a phone
    // interrupted mid-migration is bricked until reinstall.
    const db = new DatabaseSync(':memory:');
    migrate(db);
    migrate(db);
    migrate(db);
    db.close();
  });

  it('creates every table the app reads and writes', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String((row as { name: string }).name)),
    );
    for (const table of [
      'meta',
      'lots',
      'material_items',
      'handovers',
      'transactions',
      'outbox',
      'reference_cache',
    ]) {
      assert.ok(tables.has(table), `missing table: ${table}`);
    }
    db.close();
  });

  it('accepts the writes the app actually makes', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);

    // The exact shapes from db/index.ts, so a column rename breaks here rather
    // than on a phone.
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('language', 'mr');

    db.prepare(
      `INSERT OR REPLACE INTO lots
        (lot_id, collector_id, status, total_weight_kg, estimated_value_inr, locality, district,
         state, lat, lon, collected_at, created_at, updated_at, recycler_id, quoted_price_inr, synced)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    ).run('LOT_1', 'COL_1', 'ready', 12.5, 4000, 'Kothrud', 'Pune', 'Maharashtra', 18.5, 73.8,
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', null, null);

    db.prepare(
      `INSERT INTO material_items
        (material_id, lot_id, category_id, sub_category_id, description, image_refs, approx_weight_kg,
         unit, quantity, condition, source_type, estimated_value_inr, classification_source,
         model_confidence, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('MAT_1', 'LOT_1', 'cable', 'cable_copper_house', '', '', 12.5, 'kg', 1, 'intact',
      'household', 4000, 'collector', null, '2026-09-01T00:00:00.000Z');

    db.prepare(
      `INSERT OR REPLACE INTO outbox
        (change_id, entity, entity_id, op, payload, client_updated_at, attempts, next_attempt_at)
       VALUES (?,?,?,?,?,?,0,?)`,
    ).run('CHG_1', 'lot', 'LOT_1', 'upsert', '{}', '2026-09-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');

    db.prepare(
      'INSERT OR REPLACE INTO reference_cache (key, version, payload, fetched_at) VALUES (?,?,?,?)',
    ).run('price_index', 'v1', '{}', '2026-09-01T00:00:00.000Z');

    db.prepare(
      `INSERT OR REPLACE INTO transactions
        (transaction_id, lot_id, recycler_id, total_weight_kg, final_price_inr, handover_at,
         payment_status, payment_mode, status, anomaly_flags)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run('TXN_1', 'LOT_1', 'REC_1', 12.5, 3900, '2026-09-02T00:00:00.000Z', 'paid', 'cash', 'completed', '');

    const items = db.prepare('SELECT COUNT(*) AS n FROM material_items WHERE lot_id = ?').get('LOT_1');
    assert.equal((items as { n: number }).n, 1);
    db.close();
  });

  it('cascades material items when a lot is deleted', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    db.prepare(
      `INSERT INTO lots (lot_id, collector_id, status, total_weight_kg, estimated_value_inr,
        locality, district, state, collected_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('LOT_2', 'COL_1', 'ready', 1, 1, 'x', 'Pune', 'MH', 'a', 'a', 'a');
    db.prepare(
      `INSERT INTO material_items (material_id, lot_id, category_id, sub_category_id, description,
        image_refs, approx_weight_kg, unit, quantity, condition, source_type, estimated_value_inr,
        classification_source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('MAT_2', 'LOT_2', 'cable', 'cable_copper_house', '', '', 1, 'kg', 1, 'intact', 'household', 1, 'collector', 'a');

    db.prepare('DELETE FROM lots WHERE lot_id = ?').run('LOT_2');
    const left = db.prepare('SELECT COUNT(*) AS n FROM material_items').get();
    assert.equal((left as { n: number }).n, 0, 'orphaned items would accumulate forever on the phone');
    db.close();
  });
});

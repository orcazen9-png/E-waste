/**
 * Local SQLite schema.
 *
 * The phone is the source of truth for what the collector did. Everything is
 * written here first and pushed later; no screen ever waits on the network.
 *
 * Two design points:
 *  - `outbox` is a durable queue, not an in-memory list. A crash, a battery
 *    pull or a force-stop must not lose a lot the collector already recorded.
 *  - reference data (`price_index`, `recyclers`) is cached wholesale with a
 *    version string, so a sync can skip re-downloading it on a metered
 *    connection.
 */
export const SCHEMA_VERSION = 1;

export const MIGRATIONS: string[][] = [
  // v1
  [
    `CREATE TABLE IF NOT EXISTS meta (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );`,

    `CREATE TABLE IF NOT EXISTS lots (
       lot_id TEXT PRIMARY KEY,
       collector_id TEXT NOT NULL,
       status TEXT NOT NULL,
       total_weight_kg REAL NOT NULL,
       estimated_value_inr REAL NOT NULL,
       locality TEXT NOT NULL,
       district TEXT NOT NULL,
       state TEXT NOT NULL,
       lat REAL,
       lon REAL,
       collected_at TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       recycler_id TEXT,
       quoted_price_inr REAL,
       synced INTEGER NOT NULL DEFAULT 0
     );`,
    `CREATE INDEX IF NOT EXISTS idx_lots_status ON lots(status, collected_at DESC);`,

    `CREATE TABLE IF NOT EXISTS material_items (
       material_id TEXT PRIMARY KEY,
       lot_id TEXT NOT NULL,
       category_id TEXT NOT NULL,
       sub_category_id TEXT NOT NULL,
       description TEXT NOT NULL DEFAULT '',
       image_refs TEXT NOT NULL DEFAULT '',
       approx_weight_kg REAL NOT NULL,
       unit TEXT NOT NULL,
       quantity INTEGER NOT NULL DEFAULT 1,
       condition TEXT NOT NULL,
       source_type TEXT NOT NULL,
       estimated_value_inr REAL NOT NULL,
       classification_source TEXT NOT NULL,
       model_confidence REAL,
       created_at TEXT NOT NULL,
       FOREIGN KEY (lot_id) REFERENCES lots(lot_id) ON DELETE CASCADE
     );`,
    `CREATE INDEX IF NOT EXISTS idx_items_lot ON material_items(lot_id);`,

    `CREATE TABLE IF NOT EXISTS handovers (
       handover_ref TEXT PRIMARY KEY,
       lot_id TEXT NOT NULL,
       collector_id TEXT NOT NULL,
       recycler_id TEXT NOT NULL,
       verification_code TEXT NOT NULL,
       digest TEXT NOT NULL,
       photo_refs TEXT NOT NULL DEFAULT '',
       photo_hashes TEXT NOT NULL DEFAULT '',
       declared_weight_kg REAL NOT NULL,
       weighed_weight_kg REAL NOT NULL,
       lat REAL NOT NULL,
       lon REAL NOT NULL,
       locality TEXT NOT NULL,
       district TEXT NOT NULL,
       state TEXT NOT NULL,
       created_at TEXT NOT NULL,
       confirmed_at TEXT,
       confirmation_status TEXT NOT NULL,
       transaction_id TEXT,
       synced INTEGER NOT NULL DEFAULT 0
     );`,

    `CREATE TABLE IF NOT EXISTS transactions (
       transaction_id TEXT PRIMARY KEY,
       lot_id TEXT NOT NULL,
       recycler_id TEXT NOT NULL,
       total_weight_kg REAL NOT NULL,
       final_price_inr REAL NOT NULL,
       handover_at TEXT NOT NULL,
       payment_status TEXT NOT NULL,
       payment_mode TEXT NOT NULL,
       status TEXT NOT NULL,
       anomaly_flags TEXT NOT NULL DEFAULT ''
     );`,
    `CREATE INDEX IF NOT EXISTS idx_txn_time ON transactions(handover_at DESC);`,

    // The durable outbox. Nothing leaves the phone except through this table.
    `CREATE TABLE IF NOT EXISTS outbox (
       change_id TEXT PRIMARY KEY,
       entity TEXT NOT NULL,
       entity_id TEXT NOT NULL,
       op TEXT NOT NULL,
       payload TEXT NOT NULL,
       client_updated_at TEXT NOT NULL,
       attempts INTEGER NOT NULL DEFAULT 0,
       next_attempt_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
       last_error TEXT
     );`,
    `CREATE INDEX IF NOT EXISTS idx_outbox_ready ON outbox(next_attempt_at);`,

    // Reference data, cached by version so an unchanged copy is never re-fetched.
    `CREATE TABLE IF NOT EXISTS reference_cache (
       key TEXT PRIMARY KEY,
       version TEXT NOT NULL,
       payload TEXT NOT NULL,
       fetched_at TEXT NOT NULL
     );`,
  ],
];

import type { ISODateTime } from './types.ts';

/**
 * Offline-first sync protocol.
 *
 * The phone is the source of truth for what the collector did; the server is
 * the source of truth for reference data (prices, recyclers). Everything the
 * collector can do works against the local SQLite database first and lands in
 * an outbox. Nothing in the app ever blocks on the network.
 */

export type SyncEntity =
  | 'lot'
  | 'material_item'
  | 'handover'
  | 'transaction'
  | 'collector'
  | 'rating';

export type SyncOp = 'upsert' | 'delete';

export interface OutboxEntry<T = unknown> {
  /** Client-generated, idempotent: replaying the outbox never double-applies. */
  changeId: string;
  entity: SyncEntity;
  entityId: string;
  op: SyncOp;
  payload: T;
  clientUpdatedAt: ISODateTime;
  deviceId: string;
  /** Attempts so far; used for exponential backoff and for surfacing stuck items. */
  attempts: number;
  lastError?: string;
}

export interface SyncPushRequest {
  deviceId: string;
  collectorId: string;
  changes: OutboxEntry[];
}

export type ChangeOutcome = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface ChangeResult {
  changeId: string;
  outcome: ChangeOutcome;
  /** Present when outcome is 'conflict' - the server's version, for the UI to reconcile. */
  serverPayload?: unknown;
  reason?: string;
}

export interface SyncPushResponse {
  results: ChangeResult[];
  serverTime: ISODateTime;
}

export interface SyncPullRequest {
  collectorId: string;
  /** Opaque cursor from the previous pull; omit for a full bootstrap. */
  cursor?: string;
  /** Districts whose price index and recycler list this device needs. */
  districts: string[];
  /** Skip payloads the device already has. */
  knownPriceIndexVersion?: string;
  knownRecyclerVersion?: string;
}

export interface SyncPullResponse {
  cursor: string;
  serverTime: ISODateTime;
  /** Reference data, only when the version changed. */
  priceIndexVersion?: string;
  priceIndex?: unknown;
  recyclerVersion?: string;
  recyclers?: unknown[];
  /** Collector-owned records changed elsewhere (e.g. recycler confirmed a handover). */
  entities: Array<{ entity: SyncEntity; entityId: string; op: SyncOp; payload: unknown; serverUpdatedAt: ISODateTime }>;
  hasMore: boolean;
}

/**
 * Records the collector has already handed over are immutable on the client:
 * once a recycler has counter-signed, the phone must not be able to rewrite
 * history. Everything before that point is last-write-wins on client time,
 * which is what a single-device user expects.
 */
export const TERMINAL_LOT_STATUSES = ['handed_over', 'confirmed', 'paid', 'cancelled'] as const;

export interface ConflictInput {
  local: { updatedAt: ISODateTime; status?: string };
  server: { updatedAt: ISODateTime; status?: string };
}

export type ConflictResolution = 'take_local' | 'take_server' | 'manual';

export function resolveConflict(input: ConflictInput): ConflictResolution {
  const serverTerminal =
    input.server.status !== undefined &&
    (TERMINAL_LOT_STATUSES as readonly string[]).includes(input.server.status);
  const localTerminal =
    input.local.status !== undefined &&
    (TERMINAL_LOT_STATUSES as readonly string[]).includes(input.local.status);

  // A counter-signed record wins over anything the phone did afterwards.
  if (serverTerminal && !localTerminal) return 'take_server';
  // Both sides finalised differently: a human has to look at it.
  if (serverTerminal && localTerminal && input.local.status !== input.server.status) return 'manual';
  return Date.parse(input.local.updatedAt) >= Date.parse(input.server.updatedAt) ? 'take_local' : 'take_server';
}

/** Backoff in milliseconds for a failed outbox entry - capped so a long outage still retries hourly. */
export function backoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 2 ** Math.min(attempts, 12) * 1000);
}

export const SYNC_BATCH_SIZE = 50;

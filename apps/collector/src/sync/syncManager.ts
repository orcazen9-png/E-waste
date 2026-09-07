import * as Network from 'expo-network';
import {
  SYNC_BATCH_SIZE,
  type OutboxEntry,
  type PriceIndex,
  type Recycler,
  type Transaction,
} from '@ewaste/shared';
import { api, OfflineError, UnauthorizedError } from '../api/client.ts';
import {
  REFERENCE_KEYS,
  cacheReference,
  deferOutbox,
  dropFromOutbox,
  getMeta,
  pendingCount,
  readReference,
  readyOutbox,
  saveTransactions,
  setMeta,
} from '../db';

/**
 * Sync.
 *
 * Rules that matter in the field:
 *  - it is never on the critical path of anything the collector is doing;
 *  - a failed item backs off rather than retrying in a tight loop, because a
 *    tight loop on a weak signal drains a battery that has to last the day;
 *  - a handover is pushed on its own dedicated endpoint before the generic
 *    outbox, because that is the record with money attached.
 */

export type SyncState =
  | { kind: 'idle'; pending: number; lastSyncAt?: string }
  | { kind: 'offline'; pending: number; lastSyncAt?: string }
  | { kind: 'syncing'; pending: number }
  /** The token was rejected. Work stays queued; the collector must sign in again. */
  | { kind: 'signed_out'; pending: number }
  | { kind: 'error'; pending: number; message: string };

export async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch {
    return false;
  }
}

export interface SyncResult {
  pushed: number;
  failed: number;
  pulled: number;
  priceIndexUpdated: boolean;
  recyclersUpdated: boolean;
}

export async function runSync(options: {
  collectorId: string;
  deviceId: string;
  deviceSecret: string;
  district: string;
  onState?: (state: SyncState) => void;
}): Promise<SyncResult | undefined> {
  const { collectorId, deviceId, deviceSecret, district, onState } = options;

  if (!(await isOnline())) {
    onState?.({ kind: 'offline', pending: await pendingCount(), lastSyncAt: await getMeta('lastSyncAt') });
    return undefined;
  }

  onState?.({ kind: 'syncing', pending: await pendingCount() });

  const result: SyncResult = {
    pushed: 0,
    failed: 0,
    pulled: 0,
    priceIndexUpdated: false,
    recyclersUpdated: false,
  };

  try {
    const queued = await readyOutbox(SYNC_BATCH_SIZE);

    // Handovers go first, and through their own endpoint: the server has to
    // verify the digest, which the generic sync path deliberately will not do.
    const handovers = queued.filter((entry) => entry.entity === 'handover');
    const rest = queued.filter((entry) => entry.entity !== 'handover');

    for (const entry of handovers) {
      try {
        await api.postHandover(deviceSecret, entry.payload);
        await dropFromOutbox([entry.changeId]);
        result.pushed += 1;
      } catch (error) {
        if (error instanceof OfflineError || error instanceof UnauthorizedError) throw error;
        await deferOutbox(entry.changeId, entry.attempts, String(error));
        result.failed += 1;
      }
    }

    if (rest.length > 0) {
      const response = await api.syncPush({
        deviceId,
        collectorId,
        changes: rest.map((entry) => ({ ...entry, deviceId })) as OutboxEntry[],
      });
      const settled: string[] = [];
      for (const outcome of response.results) {
        if (outcome.outcome === 'applied' || outcome.outcome === 'duplicate') {
          settled.push(outcome.changeId);
          result.pushed += 1;
        } else {
          const entry = rest.find((e) => e.changeId === outcome.changeId);
          // A rejection is permanent - retrying an invalid change forever just
          // clogs the queue - but a conflict is worth another look after pull.
          if (outcome.outcome === 'rejected') settled.push(outcome.changeId);
          else if (entry) await deferOutbox(entry.changeId, entry.attempts, outcome.reason ?? 'conflict');
          result.failed += 1;
        }
      }
      await dropFromOutbox(settled);
    }

    const knownIndex = await readReference<PriceIndex>(REFERENCE_KEYS.priceIndex);
    const knownRecyclers = await readReference<Recycler[]>(REFERENCE_KEYS.recyclers);

    const pull = await api.syncPull({
      collectorId,
      cursor: await getMeta('syncCursor'),
      districts: [district],
      knownPriceIndexVersion: knownIndex?.version,
      knownRecyclerVersion: knownRecyclers?.version,
    });

    if (pull.priceIndex && pull.priceIndexVersion) {
      await cacheReference(REFERENCE_KEYS.priceIndex, pull.priceIndexVersion, pull.priceIndex);
      result.priceIndexUpdated = true;
    }
    if (pull.recyclers && pull.recyclerVersion) {
      await cacheReference(REFERENCE_KEYS.recyclers, pull.recyclerVersion, pull.recyclers);
      result.recyclersUpdated = true;
    }

    const transactions = pull.entities
      .filter((e) => e.entity === 'transaction' && e.op === 'upsert')
      .map((e) => e.payload as Transaction);
    if (transactions.length > 0) await saveTransactions(transactions);
    result.pulled = pull.entities.length;

    await setMeta('syncCursor', pull.cursor);
    await setMeta('lastSyncAt', pull.serverTime);

    onState?.({ kind: 'idle', pending: await pendingCount(), lastSyncAt: pull.serverTime });
    return result;
  } catch (error) {
    const pending = await pendingCount();
    if (error instanceof OfflineError) {
      onState?.({ kind: 'offline', pending, lastSyncAt: await getMeta('lastSyncAt') });
    } else if (error instanceof UnauthorizedError) {
      // Nothing is discarded: the outbox keeps everything until a new token
      // arrives, so a rejected token costs a sign-in, never a day's work.
      onState?.({ kind: 'signed_out', pending });
    } else {
      onState?.({ kind: 'error', pending, message: String(error) });
    }
    return result;
  }
}

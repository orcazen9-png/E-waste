import {
  resolveConflict,
  SYNC_BATCH_SIZE,
  type ChangeResult,
  type Lot,
  type OutboxEntry,
  type SyncPullRequest,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@ewaste/shared';
import type { Repository } from '../repository/types.ts';
import type { PriceService } from './prices.ts';

/**
 * Sync.
 *
 * Two rules do most of the work here:
 *  - every change carries a client-generated id, and an id already seen is
 *    reported as a duplicate rather than applied again. A phone that loses the
 *    response on a flaky tower will resend; that must never create a second
 *    lot for the same pile of scrap.
 *  - a record the recycler has already counter-signed cannot be overwritten by
 *    a later edit from the phone. History is not rewritable from the device
 *    that stands to gain from rewriting it.
 */
export class SyncService {
  constructor(
    private readonly repo: Repository,
    private readonly prices: PriceService,
  ) {}

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const results: ChangeResult[] = [];

    for (const change of request.changes.slice(0, SYNC_BATCH_SIZE)) {
      try {
        results.push(await this.applyChange(request, change));
      } catch (error) {
        results.push({
          changeId: change.changeId,
          outcome: 'rejected',
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    return { results, serverTime: new Date().toISOString() };
  }

  private async applyChange(request: SyncPushRequest, change: OutboxEntry): Promise<ChangeResult> {
    if (await this.repo.wasChangeApplied(change.changeId)) {
      return { changeId: change.changeId, outcome: 'duplicate' };
    }

    let outcome: ChangeResult['outcome'] = 'applied';
    let serverPayload: unknown;

    switch (change.entity) {
      case 'lot': {
        const incoming = change.payload as Lot;
        if (incoming.collectorId !== request.collectorId) {
          return { changeId: change.changeId, outcome: 'rejected', reason: 'collector mismatch' };
        }
        const existing = await this.repo.getLot(incoming.lotId);
        if (existing) {
          const resolution = resolveConflict({
            local: { updatedAt: change.clientUpdatedAt, status: incoming.status },
            server: { updatedAt: existing.updatedAt, status: existing.status },
          });
          if (resolution === 'take_server') {
            outcome = 'conflict';
            serverPayload = existing;
            break;
          }
          if (resolution === 'manual') {
            await this.repo.upsertLot({ ...existing, status: 'disputed', updatedAt: new Date().toISOString() });
            outcome = 'conflict';
            serverPayload = { ...existing, status: 'disputed' };
            break;
          }
        }
        await this.repo.upsertLot({ ...incoming, updatedAt: change.clientUpdatedAt });
        break;
      }

      case 'collector': {
        const incoming = change.payload as { collectorId: string; preferredLanguage?: string };
        const existing = await this.repo.getCollector(incoming.collectorId);
        if (!existing) return { changeId: change.changeId, outcome: 'rejected', reason: 'unknown collector' };
        await this.repo.upsertCollector({ ...existing, ...(change.payload as object) });
        break;
      }

      case 'handover':
      case 'transaction':
      case 'material_item':
      case 'rating':
        // These arrive through their own endpoints, where the digest and the
        // recycler's identity are checked. Accepting them here would let a
        // phone write a confirmed transaction directly.
        return {
          changeId: change.changeId,
          outcome: 'rejected',
          reason: `entity ${change.entity} is not writable through sync`,
        };

      default:
        return { changeId: change.changeId, outcome: 'rejected', reason: 'unknown entity' };
    }

    await this.repo.recordChange({
      changeId: change.changeId,
      deviceId: request.deviceId,
      collectorId: request.collectorId,
      entity: change.entity,
      entityId: change.entityId,
      op: change.op,
      outcome,
    });

    return { changeId: change.changeId, outcome, serverPayload };
  }

  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    const feed = await this.repo.readFeed(request.collectorId, request.cursor, SYNC_BATCH_SIZE);

    const response: SyncPullResponse = {
      cursor: feed.cursor,
      serverTime: new Date().toISOString(),
      entities: feed.entries.map((e) => ({
        entity: e.entity as SyncPullResponse['entities'][number]['entity'],
        entityId: e.entityId,
        op: e.op as 'upsert' | 'delete',
        payload: e.payload,
        serverUpdatedAt: e.createdAt,
      })),
      hasMore: feed.hasMore,
    };

    // Reference data is versioned by content, so a device on a metered
    // connection re-downloads the price index only when it actually changed.
    const district = request.districts[0];
    if (district) {
      const index = await this.prices.getIndex(district);
      const version = index.generatedAt;
      if (request.knownPriceIndexVersion !== version) {
        response.priceIndexVersion = version;
        response.priceIndex = index;
      }

      const recyclers = await this.repo.listRecyclers({ district, authorizedOnly: true });
      const recyclerVersion = recyclers
        .map((r) => r.updatedAt)
        .sort()
        .at(-1);
      if (recyclerVersion && request.knownRecyclerVersion !== recyclerVersion) {
        response.recyclerVersion = recyclerVersion;
        response.recyclers = recyclers;
      }
    }

    return response;
  }
}

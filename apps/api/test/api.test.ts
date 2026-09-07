import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

import { generateDataset } from '@ewaste/datasets';
import { createHandover, handoverQrPayload, type Lot, type Recycler } from '@ewaste/shared';

import { buildServer } from '../src/server.ts';
import { MemoryRepository } from '../src/repository/memory.ts';

/**
 * These run against the in-memory repository, so the whole API surface is
 * covered with no database. A small dataset keeps the suite quick while
 * exercising the same code paths as production.
 */
const dataset = generateDataset({ seed: 11, days: 150, lotCount: 220, collectorCount: 10 });

let app: FastifyInstance;
const DEVICE_SECRET = 'test-device-secret-0001';

before(async () => {
  app = await buildServer({
    repository: new MemoryRepository(dataset),
    config: { dataSource: 'seed', logLevel: 'silent' },
  });
});

const json = (res: { payload: string }) => JSON.parse(res.payload);

describe('health and reference data', () => {
  it('reports which data source it is running on', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).dataSource, 'memory');
  });

  it('serves the pictorial taxonomy', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/reference/taxonomy' });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).categories.length, 7);
  });

  it('serves translation bundles so wording fixes ship without an app update', async () => {
    for (const lang of ['mr', 'hi', 'en']) {
      const res = await app.inject({ method: 'GET', url: `/v1/reference/strings/${lang}` });
      assert.equal(res.statusCode, 200);
      assert.ok(Object.keys(json(res).strings).length > 100);
    }
    const missing = await app.inject({ method: 'GET', url: '/v1/reference/strings/ta' });
    assert.equal(missing.statusCode, 404);
  });

  it('serves safety cards for every category', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/reference/safety' });
    assert.ok(json(res).cards.length >= 14);
  });
});

describe('price board', () => {
  it('returns rows with a spoken price and a trend', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/prices/board?district=Pune&lang=mr' });
    assert.equal(res.statusCode, 200);
    const body = json(res);
    assert.ok(body.entries.length > 0);

    const entry = body.entries[0];
    assert.ok(entry.fairPriceInr > 0);
    assert.ok(entry.speak.length > 0, 'every row must carry text-to-speech copy');
    assert.ok(['up', 'down', 'flat'].includes(entry.trend.direction));
    assert.ok(entry.sampleSize > 0);
    assert.equal(entry.basis, 'local_data');
  });

  it('rejects a request with no district rather than guessing one', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/prices/board' });
    assert.equal(res.statusCode, 400);
  });

  it('serves the offline price index the phone caches', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/prices/index?district=Pune' });
    assert.equal(res.statusCode, 200);
    assert.ok(Object.keys(json(res).stats).length > 0);
  });

  it('labels a national fallback as such rather than passing it off as local', async () => {
    const local = json(
      await app.inject({
        method: 'GET',
        url: '/v1/prices/trend?subCategoryId=pcb_cpu_processor&district=Pune',
      }),
    );
    assert.equal(local.basis, 'local_data');

    const fallback = json(
      await app.inject({
        method: 'GET',
        url: '/v1/prices/trend?subCategoryId=pcb_cpu_processor&district=Nowhere',
      }),
    );
    assert.equal(fallback.basis, 'national_data');
    assert.equal(fallback.stat.district, '*');
  });

  it('404s for a sub-category with no observations anywhere', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/prices/trend?subCategoryId=not_a_material&district=Pune',
    });
    assert.equal(res.statusCode, 404);
  });
});

describe('recyclers', () => {
  it('lists only authorised facilities by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/recyclers?district=Pune' });
    const { recyclers } = json(res) as { recyclers: Recycler[] };
    assert.ok(recyclers.length > 0);
    for (const r of recyclers) assert.equal(r.authorizationStatus, 'authorized');
  });

  it('marks every seeded facility as a demo record', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/recyclers' });
    for (const r of (json(res) as { recyclers: Recycler[] }).recyclers) {
      assert.ok(r.name.startsWith('[Demo] '));
    }
  });
});

describe('lot creation and matching', () => {
  const collectorId = dataset.collectors[0]!.collectorId;

  const draft = {
    collectorId,
    collectionPlace: {
      locality: 'Kothrud',
      district: 'Pune',
      state: 'Maharashtra',
      point: { lat: 18.5074, lon: 73.8077 },
    },
    items: [
      { categoryId: 'cable', subCategoryId: 'cable_copper_house', approxWeightKg: 12, condition: 'intact' },
      { categoryId: 'pcb', subCategoryId: 'pcb_motherboard', approxWeightKg: 3, quantity: 4, condition: 'intact' },
    ],
  };

  it('creates a lot and values it', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/lots', payload: { ...draft, lotId: 'LOT_TEST_A' } });
    assert.equal(res.statusCode, 201);
    const lot = json(res) as Lot;
    assert.equal(lot.totalWeightKg, 15);
    assert.ok(lot.estimatedValueInr > 0);
    assert.equal(lot.items.length, 2);
    assert.ok(lot.items.every((i) => i.estimatedValueInr > 0));
  });

  it('is idempotent for a lot the phone created offline', async () => {
    const again = await app.inject({ method: 'POST', url: '/v1/lots', payload: { ...draft, lotId: 'LOT_TEST_A' } });
    assert.equal(again.statusCode, 200, 'a resent lot must not create a duplicate');
    assert.equal((json(again) as Lot).lotId, 'LOT_TEST_A');
  });

  it('rejects an unknown sub-category', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      payload: { ...draft, items: [{ ...draft.items[0], subCategoryId: 'not_a_real_material' }] },
    });
    assert.equal(res.statusCode, 400);
  });

  it('ranks authorised buyers and explains the ranking', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/lots/LOT_TEST_A/matches?limit=5' });
    assert.equal(res.statusCode, 200);
    const body = json(res);
    assert.ok(body.matches.length > 0, 'expected at least one nearby buyer');

    for (const match of body.matches) {
      assert.equal(match.recycler.authorizationStatus, 'authorized');
      assert.ok(match.estimatedPayoutInr > 0);
      assert.ok(match.distanceKm >= 0);
      assert.ok(match.breakdown.rate >= 0 && match.breakdown.rate <= 1);
    }
    // Ranked best first.
    const scores = body.matches.map((m: { score: number }) => m.score);
    assert.deepEqual(scores, [...scores].sort((a: number, b: number) => b - a));
  });

  it('404s when matching a lot that does not exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/lots/LOT_NOPE/matches' });
    assert.equal(res.statusCode, 404);
  });
});

describe('handover, confirmation and traceability', () => {
  const collectorId = dataset.collectors[1]!.collectorId;
  let lot: Lot;
  let recyclerId: string;
  let handoverRef: string;
  let verificationCode: string;
  let qr: string;

  it('creates the lot being handed over', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      payload: {
        lotId: 'LOT_TEST_B',
        collectorId,
        collectionPlace: {
          locality: 'Bhosari',
          district: 'Pune',
          state: 'Maharashtra',
          point: { lat: 18.62, lon: 73.85 },
        },
        items: [
          { categoryId: 'cable', subCategoryId: 'cable_copper_house', approxWeightKg: 20, condition: 'intact' },
        ],
      },
    });
    lot = json(res) as Lot;
    assert.equal(res.statusCode, 201);

    const matches = json(await app.inject({ method: 'GET', url: '/v1/lots/LOT_TEST_B/matches' }));
    recyclerId = matches.matches[0].recycler.recyclerId;
  });

  it('accepts a slip the phone signed offline', async () => {
    const record = createHandover(
      {
        lotId: lot.lotId,
        collectorId,
        recyclerId,
        declaredWeightKg: 20,
        weighedWeightKg: 19.6,
        photoHashes: ['testhash0001'],
        handoverPoint: { lat: 18.62, lon: 73.85 },
        handoverPlace: { locality: 'Bhosari', district: 'Pune', state: 'Maharashtra' },
        createdAt: new Date().toISOString(),
      },
      DEVICE_SECRET,
    );
    handoverRef = record.handoverRef;
    verificationCode = record.verificationCode;
    qr = handoverQrPayload(record);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/handovers',
      payload: { deviceSecret: DEVICE_SECRET, record },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(json(res).record.handoverRef, handoverRef);
  });

  it('rejects a slip whose weight was edited after signing', async () => {
    const record = createHandover(
      {
        lotId: lot.lotId,
        collectorId,
        recyclerId,
        declaredWeightKg: 20,
        weighedWeightKg: 19.6,
        photoHashes: ['testhash0002'],
        handoverPoint: { lat: 18.62, lon: 73.85 },
        handoverPlace: { locality: 'Bhosari', district: 'Pune', state: 'Maharashtra' },
        createdAt: new Date().toISOString(),
      },
      DEVICE_SECRET,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/handovers',
      payload: { deviceSecret: DEVICE_SECRET, record: { ...record, weighedWeightKg: 40 } },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'handover.invalid_digest');
  });

  it('looks the slip up from the scanned QR code', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/handovers/lookup', payload: { qr } });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).record.handoverRef, handoverRef);
    assert.equal(json(res).lot.lotId, lot.lotId);
  });

  it('falls back to the reference and 6-digit code when the QR will not scan', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/handovers/lookup',
      payload: { handoverRef, verificationCode },
    });
    assert.equal(ok.statusCode, 200);

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/handovers/lookup',
      payload: { handoverRef, verificationCode: '000000' },
    });
    assert.equal(wrong.statusCode, 403);
  });

  it('will not let another recycler confirm someone else’s slip', async () => {
    const other = dataset.recyclers.find((r) => r.recyclerId !== recyclerId)!;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/handovers/${handoverRef}/confirm`,
      payload: {
        recyclerId: other.recyclerId,
        finalPriceInr: 7000,
        paymentMode: 'cash',
        paymentStatus: 'paid',
      },
    });
    assert.equal(res.statusCode, 403);
  });

  it('confirms the handover and writes a transaction', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/handovers/${handoverRef}/confirm`,
      payload: {
        recyclerId,
        finalPriceInr: Math.round(lot.estimatedValueInr),
        paymentMode: 'cash',
        paymentStatus: 'paid',
        weighedWeightKg: 19.6,
      },
    });
    assert.equal(res.statusCode, 200);
    const body = json(res);
    assert.equal(body.handover.confirmationStatus, 'confirmed');
    assert.equal(body.transaction.status, 'completed');
    assert.equal(body.transaction.paymentStatus, 'paid');
    assert.ok(body.transaction.paidAt);
    assert.deepEqual(body.flags, [], 'a fair, well-formed transaction should raise no flags');
  });

  it('is idempotent if the recycler taps confirm twice', async () => {
    const first = json(await app.inject({ method: 'GET', url: `/v1/handovers/${handoverRef}` }));
    const res = await app.inject({
      method: 'POST',
      url: `/v1/handovers/${handoverRef}/confirm`,
      payload: { recyclerId, finalPriceInr: 1, paymentMode: 'cash', paymentStatus: 'paid' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).transaction.transactionId, first.record.transactionId);
  });

  it('tracks the material downstream after receipt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/handovers/${handoverRef}/downstream`,
      payload: { recyclerId, status: 'reported_to_epr' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).downstreamStatus, 'reported_to_epr');
  });

  it('shows the confirmed handover in the recycler inbox', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/recyclers/${recyclerId}/handovers?status=confirmed` });
    const refs = json(res).handovers.map((h: { record: { handoverRef: string } }) => h.record.handoverRef);
    assert.ok(refs.includes(handoverRef));
  });

  it('credits the collector ledger', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/collectors/${collectorId}/ledger` });
    assert.equal(res.statusCode, 200);
    const ledger = json(res);
    assert.ok(ledger.totalEarnedInr > 0);
    assert.ok(ledger.entries.some((e: { lotId: string }) => e.lotId === lot.lotId));
    assert.ok(ledger.byPaymentMode.cash > 0, 'cash transactions must appear in the ledger');
  });
});

describe('protecting the collector', () => {
  it('flags a payment far below the local rate', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      payload: {
        lotId: 'LOT_TEST_C',
        collectorId: dataset.collectors[2]!.collectorId,
        collectionPlace: {
          locality: 'Hadapsar',
          district: 'Pune',
          state: 'Maharashtra',
          point: { lat: 18.5, lon: 73.94 },
        },
        items: [
          { categoryId: 'cable', subCategoryId: 'cable_copper_house', approxWeightKg: 25, condition: 'intact' },
        ],
      },
    });
    const lot = json(create) as Lot;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/ml/screen',
      payload: {
        district: 'Pune',
        items: [
          { subCategoryId: 'cable_copper_house', approxWeightKg: 25, quantity: 1, condition: 'intact' },
        ],
        declaredWeightKg: 25,
        estimatedValueInr: lot.estimatedValueInr,
        finalPriceInr: Math.round(lot.estimatedValueInr * 0.4),
      },
    });
    assert.equal(res.statusCode, 200);
    const codes = json(res).flags.map((f: { code: string }) => f.code);
    assert.ok(codes.includes('PRICE_FAR_BELOW_MARKET'));
  });

  it('does not flag a fair price on legitimately burnt material', async () => {
    const value = json(
      await app.inject({
        method: 'POST',
        url: '/v1/ml/value',
        payload: {
          subCategoryId: 'cable_copper_house',
          weightKg: 10,
          condition: 'burnt',
          district: 'Pune',
        },
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/ml/screen',
      payload: {
        district: 'Pune',
        items: [{ subCategoryId: 'cable_copper_house', approxWeightKg: 10, quantity: 1, condition: 'burnt' }],
        declaredWeightKg: 10,
        estimatedValueInr: value.estimateInr,
        finalPriceInr: value.estimateInr,
      },
    });
    assert.deepEqual(json(res).flags, [], 'a discounted condition is not underpayment');
  });

  it('never auto-selects a category from an image', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ml/classify',
      payload: { imageRef: 'file://photo.jpg', district: 'Pune' },
    });
    const body = json(res);
    assert.equal(body.isPrior, true);
    assert.ok(body.candidates[0].probability < body.autoSelectThreshold);
    assert.ok(body.note.includes('No image model'));
  });
});

describe('offline sync', () => {
  const collectorId = dataset.collectors[3]!.collectorId;
  const deviceId = 'DEV_TEST_1';

  const lotPayload = (lotId: string) => ({
    lotId,
    collectorId,
    status: 'ready',
    items: [],
    totalWeightKg: 8,
    estimatedValueInr: 2400,
    collectionPlace: { locality: 'Katraj', district: 'Pune', state: 'Maharashtra' },
    collectedAt: '2026-05-01T08:00:00.000Z',
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:00:00.000Z',
  });

  it('applies a change pushed from the phone', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      payload: {
        deviceId,
        collectorId,
        changes: [
          {
            changeId: 'CHG_1',
            entity: 'lot',
            entityId: 'LOT_SYNC_1',
            op: 'upsert',
            payload: lotPayload('LOT_SYNC_1'),
            clientUpdatedAt: '2026-05-01T08:00:00.000Z',
            deviceId,
            attempts: 0,
          },
        ],
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).results[0].outcome, 'applied');
  });

  it('reports a replayed change as a duplicate instead of applying it twice', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      payload: {
        deviceId,
        collectorId,
        changes: [
          {
            changeId: 'CHG_1',
            entity: 'lot',
            entityId: 'LOT_SYNC_1',
            op: 'upsert',
            payload: lotPayload('LOT_SYNC_1'),
            clientUpdatedAt: '2026-05-01T09:00:00.000Z',
            deviceId,
            attempts: 1,
          },
        ],
      },
    });
    assert.equal(json(res).results[0].outcome, 'duplicate');
  });

  it('refuses a lot pushed for a different collector', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      payload: {
        deviceId,
        collectorId,
        changes: [
          {
            changeId: 'CHG_2',
            entity: 'lot',
            entityId: 'LOT_SYNC_2',
            op: 'upsert',
            payload: { ...lotPayload('LOT_SYNC_2'), collectorId: 'COL_SOMEONE_ELSE' },
            clientUpdatedAt: '2026-05-01T08:00:00.000Z',
            deviceId,
            attempts: 0,
          },
        ],
      },
    });
    assert.equal(json(res).results[0].outcome, 'rejected');
  });

  it('refuses a transaction written directly through sync', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      payload: {
        deviceId,
        collectorId,
        changes: [
          {
            changeId: 'CHG_3',
            entity: 'transaction',
            entityId: 'TXN_FAKE',
            op: 'upsert',
            payload: { finalPriceInr: 999999 },
            clientUpdatedAt: '2026-05-01T08:00:00.000Z',
            deviceId,
            attempts: 0,
          },
        ],
      },
    });
    const result = json(res).results[0];
    assert.equal(result.outcome, 'rejected');
    assert.match(result.reason, /not writable through sync/);
  });

  it('sends the price index on first pull and skips it when unchanged', async () => {
    const first = json(
      await app.inject({
        method: 'POST',
        url: '/v1/sync/pull',
        payload: { collectorId, districts: ['Pune'] },
      }),
    );
    assert.ok(first.priceIndex, 'a device with no index must receive one');
    assert.ok(first.priceIndexVersion);

    const second = json(
      await app.inject({
        method: 'POST',
        url: '/v1/sync/pull',
        payload: {
          collectorId,
          districts: ['Pune'],
          knownPriceIndexVersion: first.priceIndexVersion,
          knownRecyclerVersion: first.recyclerVersion,
        },
      }),
    );
    assert.equal(second.priceIndex, undefined, 'an unchanged index must not be re-sent over a metered connection');
    assert.equal(second.recyclers, undefined);
  });
});

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
  alice = await signInCollector('9876543210', 'DEV_ALICE');
  bob = await signInCollector('9876500001', 'DEV_BOB');
});

const json = (res: { payload: string }) => JSON.parse(res.payload);

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * Signs in the way a real client does: request a code, read it back (dev mode
 * returns it in the response since no SMS provider is wired up), verify.
 */
async function signInCollector(phone: string, deviceId: string) {
  const requested = json(
    await app.inject({ method: 'POST', url: '/v1/auth/collector/request', payload: { phone } }),
  );
  const verified = json(
    await app.inject({
      method: 'POST',
      url: '/v1/auth/collector/verify',
      payload: {
        challengeId: requested.challengeId,
        code: requested.devCode,
        phone,
        deviceId,
        district: 'Pune',
        state: 'Maharashtra',
      },
    }),
  );
  return { token: verified.token as string, collectorId: verified.collector.collectorId as string };
}

async function signInRecycler(recyclerId: string) {
  const requested = json(
    await app.inject({ method: 'POST', url: '/v1/auth/recycler/request', payload: { recyclerId } }),
  );
  const verified = json(
    await app.inject({
      method: 'POST',
      url: '/v1/auth/recycler/verify',
      payload: { challengeId: requested.challengeId, code: requested.devCode },
    }),
  );
  return verified.token as string;
}

/** Two collector identities, created once and reused across the suite. */
let alice: { token: string; collectorId: string };
let bob: { token: string; collectorId: string };

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
  const draft = () => ({
    collectorId: alice.collectorId,
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
  });

  it('creates a lot and values it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: bearer(alice.token),
      payload: { ...draft(), lotId: 'LOT_TEST_A' },
    });
    assert.equal(res.statusCode, 201);
    const lot = json(res) as Lot;
    assert.equal(lot.totalWeightKg, 15);
    assert.ok(lot.estimatedValueInr > 0);
    assert.equal(lot.items.length, 2);
    assert.ok(lot.items.every((i) => i.estimatedValueInr > 0));
  });

  it('is idempotent for a lot the phone created offline', async () => {
    const again = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: bearer(alice.token),
      payload: { ...draft(), lotId: 'LOT_TEST_A' },
    });
    assert.equal(again.statusCode, 200, 'a resent lot must not create a duplicate');
    assert.equal((json(again) as Lot).lotId, 'LOT_TEST_A');
  });

  it('rejects an unknown sub-category', async () => {
    const base = draft();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: bearer(alice.token),
      payload: { ...base, items: [{ ...base.items[0], subCategoryId: 'not_a_real_material' }] },
    });
    assert.equal(res.statusCode, 400);
  });

  it('ranks authorised buyers and explains the ranking', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/lots/LOT_TEST_A/matches?limit=5',
      headers: bearer(alice.token),
    });
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
    const res = await app.inject({
      method: 'GET',
      url: '/v1/lots/LOT_NOPE/matches',
      headers: bearer(alice.token),
    });
    assert.equal(res.statusCode, 404);
  });
});

describe('handover, confirmation and traceability', () => {
  let lot: Lot;
  let recyclerId: string;
  let recyclerAuth: string;
  let handoverRef: string;
  let verificationCode: string;
  let qr: string;

  it('creates the lot being handed over', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: bearer(bob.token),
      payload: {
        lotId: 'LOT_TEST_B',
        collectorId: bob.collectorId,
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

    const matches = json(
      await app.inject({
        method: 'GET',
        url: '/v1/lots/LOT_TEST_B/matches',
        headers: bearer(bob.token),
      }),
    );
    recyclerId = matches.matches[0].recycler.recyclerId;
    recyclerAuth = await signInRecycler(recyclerId);
  });

  it('accepts a slip the phone signed offline', async () => {
    const record = createHandover(
      {
        lotId: lot.lotId,
        collectorId: bob.collectorId,
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
      headers: bearer(bob.token),
      payload: { deviceSecret: DEVICE_SECRET, record },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(json(res).record.handoverRef, handoverRef);
  });

  it('rejects a slip whose weight was edited after signing', async () => {
    const record = createHandover(
      {
        lotId: lot.lotId,
        collectorId: bob.collectorId,
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
      headers: bearer(bob.token),
      payload: { deviceSecret: DEVICE_SECRET, record: { ...record, weighedWeightKg: 40 } },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'handover.invalid_digest');
  });

  it('looks the slip up from the scanned QR code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/handovers/lookup',
      headers: bearer(recyclerAuth),
      payload: { qr },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).record.handoverRef, handoverRef);
    assert.equal(json(res).lot.lotId, lot.lotId);
  });

  it('refuses a QR whose claims disagree with the stored slip', async () => {
    const tampered = JSON.parse(qr) as Record<string, unknown>;
    tampered['w'] = 60; // same digest prefix, different declared facts
    const res = await app.inject({
      method: 'POST',
      url: '/v1/handovers/lookup',
      headers: bearer(recyclerAuth),
      payload: { qr: JSON.stringify(tampered) },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(json(res).error, 'handover.qr_mismatch');
  });

  it('falls back to the reference and 6-digit code when the QR will not scan', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/handovers/lookup',
      headers: bearer(recyclerAuth),
      payload: { handoverRef, verificationCode },
    });
    assert.equal(ok.statusCode, 200);

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/handovers/lookup',
      headers: bearer(recyclerAuth),
      payload: { handoverRef, verificationCode: '000000' },
    });
    assert.equal(wrong.statusCode, 403);
  });

  it('will not let another recycler confirm someone else’s slip', async () => {
    // The identity comes from the token, so "confirm as someone else" now
    // means signing in as them - which is exactly the point.
    const other = dataset.recyclers.find(
      (r) => r.recyclerId !== recyclerId && r.authorizationStatus === 'authorized',
    )!;
    const otherToken = await signInRecycler(other.recyclerId);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/handovers/${handoverRef}/confirm`,
      headers: bearer(otherToken),
      payload: { finalPriceInr: 7000, paymentMode: 'cash', paymentStatus: 'paid' },
    });
    assert.equal(res.statusCode, 403);
  });

  it('will not let a collector confirm their own handover', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/handovers/${handoverRef}/confirm`,
      headers: bearer(bob.token),
      payload: { finalPriceInr: 99999, paymentMode: 'cash', paymentStatus: 'paid' },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(json(res).error, 'auth.wrong_principal');
  });

  it('confirms the handover and writes a transaction', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/handovers/${handoverRef}/confirm`,
      headers: bearer(recyclerAuth),
      payload: {
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
    const first = json(
      await app.inject({
        method: 'GET',
        url: `/v1/handovers/${handoverRef}`,
        headers: bearer(recyclerAuth),
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/v1/handovers/${handoverRef}/confirm`,
      headers: bearer(recyclerAuth),
      payload: { finalPriceInr: 1, paymentMode: 'cash', paymentStatus: 'paid' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).transaction.transactionId, first.record.transactionId);
  });

  it('tracks the material downstream after receipt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/handovers/${handoverRef}/downstream`,
      headers: bearer(recyclerAuth),
      payload: { status: 'reported_to_epr' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).downstreamStatus, 'reported_to_epr');
  });

  it('shows the confirmed handover in the recycler inbox', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/recyclers/${recyclerId}/handovers?status=confirmed`,
      headers: bearer(recyclerAuth),
    });
    const refs = json(res).handovers.map((h: { record: { handoverRef: string } }) => h.record.handoverRef);
    assert.ok(refs.includes(handoverRef));
  });

  it('credits the collector ledger', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/collectors/${bob.collectorId}/ledger`,
      headers: bearer(bob.token),
    });
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
      headers: bearer(alice.token),
      payload: {
        lotId: 'LOT_TEST_C',
        collectorId: alice.collectorId,
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
      headers: bearer(alice.token),
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
        headers: bearer(alice.token),
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
      headers: bearer(alice.token),
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
      headers: bearer(alice.token),
      payload: { imageRef: 'file://photo.jpg', district: 'Pune' },
    });
    const body = json(res);
    assert.equal(body.isPrior, true);
    assert.ok(body.candidates[0].probability < body.autoSelectThreshold);
    assert.ok(body.note.includes('No image model'));
  });
});

describe('offline sync', () => {
  const deviceId = 'DEV_ALICE';

  const lotPayload = (lotId: string) => ({
    lotId,
    collectorId: alice.collectorId,
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
      headers: bearer(alice.token),
      payload: {
        deviceId,
        collectorId: alice.collectorId,
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
      headers: bearer(alice.token),
      payload: {
        deviceId,
        collectorId: alice.collectorId,
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
      headers: bearer(alice.token),
      payload: {
        deviceId,
        collectorId: alice.collectorId,
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
      headers: bearer(alice.token),
      payload: {
        deviceId,
        collectorId: alice.collectorId,
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
        headers: bearer(alice.token),
        payload: { collectorId: alice.collectorId, districts: ['Pune'] },
      }),
    );
    assert.ok(first.priceIndex, 'a device with no index must receive one');
    assert.ok(first.priceIndexVersion);

    const second = json(
      await app.inject({
        method: 'POST',
        url: '/v1/sync/pull',
        headers: bearer(alice.token),
        payload: {
          collectorId: alice.collectorId,
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

describe('authentication', () => {
  it('issues a token for a valid code and identifies the caller', async () => {
    const phone = '9876511111';
    const requested = json(
      await app.inject({ method: 'POST', url: '/v1/auth/collector/request', payload: { phone } }),
    );
    assert.ok(requested.challengeId);
    assert.match(requested.devCode, /^\d{6}$/);

    const verified = json(
      await app.inject({
        method: 'POST',
        url: '/v1/auth/collector/verify',
        payload: {
          challengeId: requested.challengeId,
          code: requested.devCode,
          phone,
          deviceId: 'DEV_NEW',
        },
      }),
    );
    assert.ok(verified.token);
    assert.ok(verified.collector.collectorId);
    // The number itself is never stored, only a hash of it.
    assert.equal(verified.collector.phone, undefined);
    assert.notEqual(verified.collector.phoneHash, phone);

    const me = json(
      await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(verified.token) }),
    );
    assert.equal(me.kind, 'collector');
    assert.equal(me.id, verified.collector.collectorId);
    assert.equal(me.deviceId, 'DEV_NEW');
  });

  it('returns the same collector when the same number signs in again', async () => {
    const phone = '9876522222';
    const first = await signInCollector(phone, 'DEV_A');
    const second = await signInCollector(phone, 'DEV_B');
    assert.equal(second.collectorId, first.collectorId, 'one number is one collector');
    assert.notEqual(second.token, first.token);
  });

  it('rejects a wrong code', async () => {
    const phone = '9876533333';
    const requested = json(
      await app.inject({ method: 'POST', url: '/v1/auth/collector/request', payload: { phone } }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/collector/verify',
      payload: { challengeId: requested.challengeId, code: '000000', phone, deviceId: 'DEV_X' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'auth.invalid_code');
  });

  it('will not let a code be used twice', async () => {
    const phone = '9876544444';
    const requested = json(
      await app.inject({ method: 'POST', url: '/v1/auth/collector/request', payload: { phone } }),
    );
    const payload = {
      challengeId: requested.challengeId,
      code: requested.devCode,
      phone,
      deviceId: 'DEV_Y',
    };
    assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/collector/verify', payload })).statusCode, 200);
    const replay = await app.inject({ method: 'POST', url: '/v1/auth/collector/verify', payload });
    assert.equal(replay.statusCode, 400);
    assert.equal(json(replay).error, 'auth.code_already_used');
  });

  it('stops guessing after five wrong attempts', async () => {
    const phone = '9876555555';
    const requested = json(
      await app.inject({ method: 'POST', url: '/v1/auth/collector/request', payload: { phone } }),
    );
    const attempt = (code: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/collector/verify',
        payload: { challengeId: requested.challengeId, code, phone, deviceId: 'DEV_Z' },
      });

    for (let i = 0; i < 5; i++) assert.equal((await attempt('000000')).statusCode, 400);
    const locked = await attempt('000000');
    assert.equal(locked.statusCode, 429);
    assert.equal(json(locked).error, 'auth.too_many_attempts');

    // Even the correct code is refused once the challenge is burned.
    const correct = await attempt(requested.devCode);
    assert.equal(correct.statusCode, 429);
  });

  it('rate limits how many codes one number can request', async () => {
    const phone = '9876566666';
    for (let i = 0; i < 5; i++) {
      const ok = await app.inject({ method: 'POST', url: '/v1/auth/collector/request', payload: { phone } });
      assert.equal(ok.statusCode, 200, `request ${i} should succeed`);
    }
    // Protects someone else's phone from being used as a free SMS cannon.
    const limited = await app.inject({ method: 'POST', url: '/v1/auth/collector/request', payload: { phone } });
    assert.equal(limited.statusCode, 429);
    assert.ok(limited.headers['retry-after']);
  });

  it('rejects a number that cannot be an Indian mobile', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/collector/request',
      payload: { phone: '1234567890' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('refuses to sign in a facility whose authorisation is not current', async () => {
    const lapsed = dataset.recyclers.find((r) => r.authorizationStatus !== 'authorized');
    if (!lapsed) return;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/recycler/request',
      payload: { recyclerId: lapsed.recyclerId },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(json(res).error, 'auth.facility_not_authorized');
  });

  it('ignores a token whose payload was edited', async () => {
    const [version, body, signature] = alice.token.split('.') as [string, string, string];
    void body;
    const forged = Buffer.from(
      JSON.stringify({ sub: bob.collectorId, kind: 'collector', iat: 0, exp: 9_999_999_999 }),
    ).toString('base64url');
    const res = await app.inject({
      method: 'GET',
      url: `/v1/collectors/${bob.collectorId}/ledger`,
      headers: bearer(`${version}.${forged}.${signature}`),
    });
    assert.equal(res.statusCode, 401);
  });

  it('cuts off every token issued to a revoked device', async () => {
    const phone = '9876577777';
    const session = await signInCollector(phone, 'DEV_LOST');
    const before = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(session.token) });
    assert.equal(before.statusCode, 200);

    // Losing the phone must not mean waiting 90 days for the token to expire.
    await app.repository.upsertDevice({
      deviceId: 'DEV_LOST',
      collectorId: session.collectorId,
      platform: 'android',
      createdAt: new Date().toISOString(),
      revokedAt: new Date().toISOString(),
    });

    const after = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(session.token) });
    assert.equal(after.statusCode, 401);
  });
});

describe('authorisation boundaries', () => {
  it('refuses guarded routes with no token', async () => {
    const guarded: Array<[string, string]> = [
      ['GET', `/v1/collectors/${alice.collectorId}/ledger`],
      ['GET', `/v1/collectors/${alice.collectorId}/lots`],
      ['GET', '/v1/lots/LOT_TEST_A'],
      ['POST', '/v1/ml/classify'],
      ['POST', '/v1/sync/pull'],
    ];
    for (const [method, url] of guarded) {
      const res = await app.inject({ method: method as 'GET', url, payload: method === 'POST' ? {} : undefined });
      assert.equal(res.statusCode, 401, `${method} ${url} should require a token`);
    }
  });

  it('will not show one collector another collector’s earnings', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/collectors/${bob.collectorId}/ledger`,
      headers: bearer(alice.token),
    });
    // 404, not 403: a 403 would confirm the id exists, which is an enumeration
    // oracle over a list of people whose earnings these are.
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error, 'not_found');
  });

  it('will not let a collector create a lot for someone else', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: bearer(alice.token),
      payload: {
        collectorId: bob.collectorId,
        collectionPlace: { locality: 'Kothrud', district: 'Pune', state: 'Maharashtra' },
        items: [
          { categoryId: 'cable', subCategoryId: 'cable_copper_house', approxWeightKg: 5, condition: 'intact' },
        ],
      },
    });
    assert.equal(res.statusCode, 404);
  });

  it('will not let a collector push sync changes for someone else', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: bearer(alice.token),
      payload: { deviceId: 'DEV_ALICE', collectorId: bob.collectorId, changes: [] },
    });
    assert.equal(res.statusCode, 404);
  });

  it('will not show one facility another facility’s transactions', async () => {
    const authorised = dataset.recyclers.filter((r) => r.authorizationStatus === 'authorized');
    const token = await signInRecycler(authorised[0]!.recyclerId);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/recyclers/${authorised[1]!.recyclerId}/transactions`,
      headers: bearer(token),
    });
    assert.equal(res.statusCode, 404);
  });

  it('keeps the price board and reference data public', async () => {
    // Price transparency is the point of the platform, so it is not gated.
    for (const url of [
      '/v1/prices/board?district=Pune',
      '/v1/reference/taxonomy',
      '/v1/reference/safety',
      '/v1/reference/strings/mr',
      '/v1/recyclers?district=Pune',
    ]) {
      assert.equal((await app.inject({ method: 'GET', url })).statusCode, 200, `${url} should be public`);
    }
  });

  it('hides rate cards and contact numbers from anonymous callers', async () => {
    const anonymous = json(await app.inject({ method: 'GET', url: '/v1/recyclers?district=Pune' }));
    assert.equal(anonymous.directoryOnly, true);
    for (const recycler of anonymous.recyclers) {
      assert.equal(recycler.offeredRatesInr, undefined, 'rate cards are commercially sensitive');
      assert.equal(recycler.contactPhone, undefined);
      // The directory still answers "who near me is authorised?".
      assert.ok(recycler.name);
      assert.equal(recycler.authorizationStatus, 'authorized');
    }

    const authenticated = json(
      await app.inject({ method: 'GET', url: '/v1/recyclers?district=Pune', headers: bearer(alice.token) }),
    );
    assert.equal(authenticated.directoryOnly, undefined);
    assert.ok(authenticated.recyclers[0].offeredRatesInr);
    assert.ok(authenticated.recyclers[0].contactPhone);
  });
});

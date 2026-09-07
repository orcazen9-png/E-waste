import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPriceIndex, lookupStat, ALL_SUB_CATEGORY_IDS } from '@ewaste/shared';
import { generateDataset } from '../src/generate.ts';
import { DATASET_SCHEMAS } from '../src/schemas.ts';
import { toCsv, parseCsv } from '../src/csv.ts';
import { Rng } from '../src/random.ts';

/** A small dataset keeps the suite fast; the shape is identical to the full seed. */
const dataset = generateDataset({ seed: 7, days: 120, lotCount: 150, collectorCount: 12 });

describe('seeded rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = Array.from({ length: 20 }, () => new Rng(99).next());
    const b = Array.from({ length: 20 }, () => new Rng(99).next());
    assert.deepEqual(a, b);
  });

  it('produces different streams for different seeds', () => {
    assert.notEqual(new Rng(1).next(), new Rng(2).next());
  });
});

describe('csv round trip', () => {
  it('preserves values containing commas, quotes and newlines', () => {
    const rows = [{ id: 'a', note: 'has, comma' }, { id: 'b', note: 'has "quotes"' }, { id: 'c', note: 'line\nbreak' }];
    const parsed = parseCsv(toCsv(rows, ['id', 'note']));
    assert.deepEqual(parsed, rows);
  });
});

describe('generated dataset', () => {
  it('is reproducible from the seed alone', () => {
    const again = generateDataset({ seed: 7, days: 120, lotCount: 150, collectorCount: 12 });
    assert.equal(JSON.stringify(again.transactions), JSON.stringify(dataset.transactions));
    assert.equal(JSON.stringify(again.prices), JSON.stringify(dataset.prices));
  });

  it('conforms to the published schemas', () => {
    for (const r of dataset.recyclers) assert.equal(DATASET_SCHEMAS.recycler.safeParse(r).success, true);
    for (const p of dataset.prices.slice(0, 500)) assert.equal(DATASET_SCHEMAS.price.safeParse(p).success, true);
    for (const m of dataset.materials.slice(0, 500)) assert.equal(DATASET_SCHEMAS.material.safeParse(m).success, true);
    for (const t of dataset.transactions.slice(0, 500)) assert.equal(DATASET_SCHEMAS.transaction.safeParse(t).success, true);
    for (const h of dataset.handovers.slice(0, 500)) assert.equal(DATASET_SCHEMAS.handover.safeParse(h).success, true);
  });

  it('marks every seeded facility as synthetic', () => {
    for (const r of dataset.recyclers) {
      assert.ok(r.name.startsWith('[Demo] '), `unmarked facility name: ${r.name}`);
      assert.ok(r.authorizationNumber.startsWith('SYN/'), `unmarked authorisation: ${r.authorizationNumber}`);
    }
  });

  it('covers every sub-category with price observations', () => {
    const covered = new Set(dataset.prices.map((p) => p.subCategoryId));
    const missing = ALL_SUB_CATEGORY_IDS.filter((id) => !covered.has(id));
    assert.deepEqual(missing, []);
  });

  it('never lets an unauthorised facility appear in a transaction', () => {
    const byId = new Map(dataset.recyclers.map((r) => [r.recyclerId, r]));
    for (const t of dataset.transactions) {
      assert.equal(byId.get(t.recyclerId)?.authorizationStatus, 'authorized');
    }
  });

  it('keeps every transaction linked to a lot and a handover', () => {
    const lotIds = new Set(dataset.lots.map((l) => l.lotId));
    const handoverLots = new Set(dataset.handovers.map((h) => h.lotId));
    for (const t of dataset.transactions) {
      assert.ok(lotIds.has(t.lotId), `transaction ${t.transactionId} has no lot`);
      assert.ok(handoverLots.has(t.lotId), `transaction ${t.transactionId} has no handover`);
    }
  });

  it('reconciles collector earnings with the transaction dataset', () => {
    for (const c of dataset.collectors) {
      const paid = dataset.transactions
        .filter((t) => t.collectorId === c.collectorId && t.paymentStatus === 'paid')
        .reduce((s, t) => s + t.finalPriceInr, 0);
      assert.ok(Math.abs(paid - c.lifetimeEarningsInr) < 0.05);
    }
  });

  it('builds a price index that resolves a rate for the busiest district', () => {
    const index = buildPriceIndex(dataset.prices, { now: new Date(dataset.meta.windowEnd) });
    const stat = lookupStat(index, 'cable_copper_house', 'Pune');
    assert.ok(stat);
    assert.ok(stat.medianBuyingInr > 0);
  });

  it('catches the anomalies it deliberately injected', () => {
    const flagged = new Set(dataset.transactions.filter((t) => t.anomalyFlags.length > 0).map((t) => t.transactionId));
    const missed = dataset.injectedAnomalies.filter((a) => !flagged.has(a.transactionId));
    // The detector must not silently regress; a miss here means a rule broke.
    assert.deepEqual(missed, []);
  });

  it('does not flag more than a small fraction of clean transactions', () => {
    const injected = new Set(dataset.injectedAnomalies.map((a) => a.transactionId));
    const clean = dataset.transactions.filter((t) => !injected.has(t.transactionId));
    const falsePositives = clean.filter((t) => t.anomalyFlags.length > 0).length;
    const rate = falsePositives / clean.length;
    assert.ok(rate < 0.05, `false positive rate too high: ${(rate * 100).toFixed(1)}%`);
  });

  it('assigns training samples to exactly one split per image', () => {
    const splits = new Map<string, string>();
    for (const s of dataset.trainingSamples) {
      const existing = splits.get(s.imageHash);
      if (existing) assert.equal(existing, s.split);
      splits.set(s.imageHash, s.split);
    }
  });
});

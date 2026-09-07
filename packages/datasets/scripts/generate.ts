/**
 * Regenerates every seed dataset from the seed number alone.
 *
 *   pnpm data:generate            # default seed, 365 days
 *   pnpm data:generate -- --seed 42 --days 180 --lots 500
 *
 * Output is deterministic: the same arguments always produce byte-identical
 * files, so a diff in `data/` means the generator changed, not the dice.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPriceIndex } from '@ewaste/shared';
import { generateDataset, DEFAULT_SEED } from '../src/generate.ts';
import { toCsv } from '../src/csv.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const seed = arg('seed', DEFAULT_SEED);
const days = arg('days', 365);
const lotCount = arg('lots', 1400);
const collectorCount = arg('collectors', 60);

console.log(`Generating seed dataset (seed=${seed}, days=${days}, lots=${lotCount})...`);
const dataset = generateDataset({ seed, days, lotCount, collectorCount });

mkdirSync(dataDir, { recursive: true });

const write = (file: string, contents: string) => {
  writeFileSync(join(dataDir, file), contents);
  const kb = (Buffer.byteLength(contents) / 1024).toFixed(0);
  console.log(`  ${file.padEnd(28)} ${kb.padStart(6)} KB`);
};

write('meta.json', `${JSON.stringify(dataset.meta, null, 2)}\n`);

write('recyclers.json', `${JSON.stringify(dataset.recyclers, null, 2)}\n`);

write(
  'prices.csv',
  toCsv(
    dataset.prices.map((p) => ({ ...p, quotedPriceInr: p.quotedPriceInr ?? '', recyclerId: p.recyclerId ?? '' })),
    [
      'priceId',
      'categoryId',
      'subCategoryId',
      'district',
      'state',
      'observedAt',
      'buyingPriceInr',
      'quotedPriceInr',
      'unit',
      'currency',
      'marketLowInr',
      'marketHighInr',
      'recyclerId',
      'source',
      'confidence',
    ],
  ),
);

write(
  'collectors.csv',
  toCsv(dataset.collectors, [
    'collectorId',
    'phoneHash',
    'preferredLanguage',
    'operatingDistrict',
    'operatingState',
    'createdAt',
    'lifetimeEarningsInr',
    'pendingDuesInr',
    'completedTransactions',
  ]),
);

write(
  'materials.csv',
  toCsv(
    dataset.materials.map((m) => ({ ...m, imageRefs: m.imageRefs.join('|') })),
    [
      'materialId',
      'lotId',
      'categoryId',
      'subCategoryId',
      'description',
      'imageRefs',
      'approxWeightKg',
      'unit',
      'quantity',
      'condition',
      'sourceType',
      'estimatedValueInr',
      'classificationSource',
      'createdAt',
    ],
  ),
);

write(
  'lots.csv',
  toCsv(
    dataset.lots.map((l) => ({
      lotId: l.lotId,
      collectorId: l.collectorId,
      status: l.status,
      itemCount: l.items.length,
      totalWeightKg: l.totalWeightKg,
      estimatedValueInr: l.estimatedValueInr,
      locality: l.collectionPlace.locality,
      district: l.collectionPlace.district,
      state: l.collectionPlace.state,
      lat: l.collectionPlace.point?.lat ?? '',
      lon: l.collectionPlace.point?.lon ?? '',
      collectedAt: l.collectedAt,
      recyclerId: l.recyclerId ?? '',
      quotedPriceInr: l.quotedPriceInr ?? '',
      updatedAt: l.updatedAt,
    })),
    [
      'lotId',
      'collectorId',
      'status',
      'itemCount',
      'totalWeightKg',
      'estimatedValueInr',
      'locality',
      'district',
      'state',
      'lat',
      'lon',
      'collectedAt',
      'recyclerId',
      'quotedPriceInr',
      'updatedAt',
    ],
  ),
);

write(
  'transactions.csv',
  toCsv(
    dataset.transactions.map((t) => ({
      transactionId: t.transactionId,
      lotId: t.lotId,
      collectorId: t.collectorId,
      recyclerId: t.recyclerId,
      categorySummary: t.categorySummary.join('|'),
      totalWeightKg: t.totalWeightKg,
      estimatedValueInr: t.estimatedValueInr,
      quotedPriceInr: t.quotedPriceInr,
      finalPriceInr: t.finalPriceInr,
      collectionDistrict: t.collectionPlace.district,
      handoverDistrict: t.handoverPlace.district,
      handoverAt: t.handoverAt,
      paymentStatus: t.paymentStatus,
      paymentMode: t.paymentMode,
      paidAt: t.paidAt ?? '',
      status: t.status,
      anomalyFlags: t.anomalyFlags.join('|'),
    })),
    [
      'transactionId',
      'lotId',
      'collectorId',
      'recyclerId',
      'categorySummary',
      'totalWeightKg',
      'estimatedValueInr',
      'quotedPriceInr',
      'finalPriceInr',
      'collectionDistrict',
      'handoverDistrict',
      'handoverAt',
      'paymentStatus',
      'paymentMode',
      'paidAt',
      'status',
      'anomalyFlags',
    ],
  ),
);

write(
  'traceability.csv',
  toCsv(
    dataset.handovers.map((h) => ({
      handoverRef: h.handoverRef,
      lotId: h.lotId,
      collectorId: h.collectorId,
      recyclerId: h.recyclerId,
      transactionId: h.transactionId ?? '',
      verificationCode: h.verificationCode,
      digest: h.digest,
      photoCount: h.photoRefs.length,
      photoHashes: h.photoHashes.join('|'),
      declaredWeightKg: h.declaredWeightKg,
      weighedWeightKg: h.weighedWeightKg,
      lat: h.handoverPoint.lat,
      lon: h.handoverPoint.lon,
      district: h.handoverPlace.district,
      createdAt: h.createdAt,
      confirmedAt: h.confirmedAt ?? '',
      confirmationStatus: h.confirmationStatus,
      downstreamStatus: h.downstreamStatus ?? '',
    })),
    [
      'handoverRef',
      'lotId',
      'collectorId',
      'recyclerId',
      'transactionId',
      'verificationCode',
      'digest',
      'photoCount',
      'photoHashes',
      'declaredWeightKg',
      'weighedWeightKg',
      'lat',
      'lon',
      'district',
      'createdAt',
      'confirmedAt',
      'confirmationStatus',
      'downstreamStatus',
    ],
  ),
);

write(
  'training_manifest.csv',
  toCsv(
    dataset.trainingSamples.map((s) => ({ ...s, finalPriceInr: s.finalPriceInr ?? '' })),
    [
      'sampleId',
      'imageRef',
      'imageHash',
      'labelCategoryId',
      'labelSubCategoryId',
      'labelSource',
      'weightKg',
      'district',
      'observedPriceInr',
      'finalPriceInr',
      'capturedAt',
      'split',
      'synthetic',
    ],
  ),
);

write(
  'anomaly_ground_truth.csv',
  toCsv(dataset.injectedAnomalies, ['transactionId', 'kind']),
);

// The price index is a derived artefact, but it ships to phones, so it is
// generated here rather than being recomputed on every device.
const priceIndex = buildPriceIndex(dataset.prices, {
  now: new Date(dataset.meta.windowEnd),
  windowDays: 90,
});
write('price_index.json', `${JSON.stringify(priceIndex)}\n`);

console.log('\nSummary');
console.log(`  recyclers        ${dataset.recyclers.length}`);
console.log(`  price points     ${dataset.prices.length}`);
console.log(`  collectors       ${dataset.collectors.length}`);
console.log(`  lots             ${dataset.lots.length}`);
console.log(`  material items   ${dataset.materials.length}`);
console.log(`  transactions     ${dataset.transactions.length}`);
console.log(`  handovers        ${dataset.handovers.length}`);
console.log(`  training samples ${dataset.trainingSamples.length}`);
console.log(`  injected anomalies ${dataset.injectedAnomalies.length}`);
console.log('\nAll records are synthetic. Run `pnpm data:validate` to check them.');

/**
 * Builds the offline demo bundle shipped inside the collector app.
 *
 * The app normally receives its price index and recycler list from a sync.
 * For a field demo - or a judge holding the phone with no server anywhere -
 * that is a hard dependency on connectivity at exactly the wrong moment. This
 * emits a trimmed copy of both, plus a few settled transactions so the ledger
 * has something in it, small enough to sit in the APK.
 *
 *   node --experimental-transform-types scripts/build-demo-bundle.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPriceIndex, statKey, NATIONAL, type PricePoint, type Recycler } from '@ewaste/shared';
import { parseCsv } from '../src/csv.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const outDir = join(here, '..', '..', '..', 'apps', 'collector', 'src', 'demo');

/** The demo is scoped to one district; a national dataset would not fit usefully. */
const DEMO_DISTRICT = 'Pune';
const DEMO_STATE = 'Maharashtra';

const meta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf8')) as { windowEnd: string };
const now = new Date(meta.windowEnd);

const prices = parseCsv(readFileSync(join(dataDir, 'prices.csv'), 'utf8')).map(
  (r) =>
    ({
      priceId: r['priceId'],
      categoryId: r['categoryId'],
      subCategoryId: r['subCategoryId'],
      district: r['district'],
      state: r['state'],
      observedAt: r['observedAt'],
      buyingPriceInr: Number(r['buyingPriceInr']),
      unit: r['unit'],
      currency: 'INR',
      marketLowInr: Number(r['marketLowInr']),
      marketHighInr: Number(r['marketHighInr']),
      source: r['source'],
      confidence: Number(r['confidence']),
    }) as PricePoint,
);

const fullIndex = buildPriceIndex(prices, { now, windowDays: 90 });

// Keep this district's cells plus the national rollups they fall back to.
const stats: typeof fullIndex.stats = {};
for (const [key, stat] of Object.entries(fullIndex.stats)) {
  if (stat.district === DEMO_DISTRICT || stat.district === NATIONAL) {
    // The daily series is the bulk of the payload and only drives a sparkline;
    // the last three weeks is enough to show a trend.
    stats[key] = { ...stat, series: stat.series.slice(-21) };
  }
}
const priceIndex = { generatedAt: fullIndex.generatedAt, stats };

const allRecyclers = JSON.parse(readFileSync(join(dataDir, 'recyclers.json'), 'utf8')) as Recycler[];
const recyclers = allRecyclers.filter(
  (r) => r.place.district === DEMO_DISTRICT && r.authorizationStatus === 'authorized',
);

/** A handful of settled sales, so the ledger is not an empty screen. */
const transactions = parseCsv(readFileSync(join(dataDir, 'transactions.csv'), 'utf8'))
  .filter((t) => t['collectionDistrict'] === DEMO_DISTRICT && t['status'] === 'completed')
  .slice(-6)
  .map((t, i) => ({
    transactionId: `DEMO_TXN_${i + 1}`,
    lotId: `DEMO_LOT_${i + 1}`,
    recyclerId: t['recyclerId']!,
    totalWeightKg: Number(t['totalWeightKg']),
    finalPriceInr: Number(t['finalPriceInr']),
    // Re-dated relative to install so "this week" is not empty on the demo phone.
    daysAgo: [2, 5, 9, 16, 24, 33][i] ?? 40,
    paymentStatus: t['paymentStatus']!,
    paymentMode: t['paymentMode']!,
    status: t['status']!,
    anomalyFlags: t['anomalyFlags'] ? t['anomalyFlags']!.split('|') : [],
  }));

const bundle = {
  note: 'SYNTHETIC demo data bundled into the app so it runs with no server. Not real prices or facilities.',
  district: DEMO_DISTRICT,
  state: DEMO_STATE,
  generatedAt: fullIndex.generatedAt,
  priceIndex,
  recyclers,
  transactions,
};

mkdirSync(outDir, { recursive: true });
const json = `${JSON.stringify(bundle)}\n`;
writeFileSync(join(outDir, 'bundle.json'), json);

console.log(`Wrote demo bundle: ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`);
console.log(`  price cells   ${Object.keys(stats).length}`);
console.log(`  recyclers     ${recyclers.length}`);
console.log(`  transactions  ${transactions.length}`);

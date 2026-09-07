/**
 * Validates the generated datasets: schema conformance, referential integrity,
 * and a set of data-quality checks that matter for the models downstream.
 *
 * Exits non-zero on any error, so CI can gate on it. Warnings are reported but
 * do not fail the run - a thin price series in a small district is a fact
 * about the field, not a bug.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_SUB_CATEGORY_IDS, verifyHandover, type HandoverRecord } from '@ewaste/shared';
import { parseCsv } from '../src/csv.ts';
import { DATASET_SCHEMAS } from '../src/schemas.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

const errors: string[] = [];
const warnings: string[] = [];
const checks: string[] = [];

function fail(message: string) {
  errors.push(message);
}
function warn(message: string) {
  warnings.push(message);
}
function pass(message: string) {
  checks.push(message);
}

function read(file: string): string {
  const path = join(dataDir, file);
  if (!existsSync(path)) {
    fail(`missing file: ${file} - run \`pnpm data:generate\` first`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

/** CSV loses types; restore the numeric and array columns before validating. */
function coerce(row: Record<string, string>, spec: {
  numbers?: string[];
  ints?: string[];
  arrays?: string[];
  booleans?: string[];
  optional?: string[];
}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const key of spec.optional ?? []) if (out[key] === '') delete out[key];
  for (const key of spec.numbers ?? []) if (out[key] !== undefined) out[key] = Number(out[key]);
  for (const key of spec.ints ?? []) if (out[key] !== undefined) out[key] = parseInt(String(out[key]), 10);
  for (const key of spec.arrays ?? []) out[key] = out[key] ? String(out[key]).split('|') : [];
  for (const key of spec.booleans ?? []) out[key] = out[key] === 'true';
  return out;
}

function validateAll<T>(label: string, rows: unknown[], schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }): void {
  let bad = 0;
  const samples: string[] = [];
  for (const [i, row] of rows.entries()) {
    const result = schema.safeParse(row);
    if (!result.success) {
      bad++;
      if (samples.length < 3) {
        const issues = (result.error as { issues?: Array<{ path: unknown[]; message: string }> })?.issues ?? [];
        samples.push(`row ${i}: ${issues.map((iss) => `${iss.path.join('.')} ${iss.message}`).join('; ')}`);
      }
    }
  }
  if (bad > 0) fail(`${label}: ${bad}/${rows.length} rows failed schema validation\n      ${samples.join('\n      ')}`);
  else pass(`${label}: ${rows.length} rows conform to schema`);
}

/* ---------------------------------------------------------------- */

const recyclers = JSON.parse(read('recyclers.json') || '[]') as Array<Record<string, unknown>>;
validateAll('recyclers', recyclers, DATASET_SCHEMAS.recycler);

const prices = parseCsv(read('prices.csv')).map((r) =>
  coerce(r, {
    numbers: ['buyingPriceInr', 'quotedPriceInr', 'marketLowInr', 'marketHighInr', 'confidence'],
    optional: ['quotedPriceInr', 'recyclerId'],
  }),
);
validateAll('prices', prices, DATASET_SCHEMAS.price);

const collectors = parseCsv(read('collectors.csv')).map((r) =>
  coerce(r, { numbers: ['lifetimeEarningsInr', 'pendingDuesInr'], ints: ['completedTransactions'] }),
);
validateAll('collectors', collectors, DATASET_SCHEMAS.collector);

const materials = parseCsv(read('materials.csv')).map((r) =>
  coerce(r, {
    numbers: ['approxWeightKg', 'estimatedValueInr'],
    ints: ['quantity'],
    arrays: ['imageRefs'],
  }),
);
validateAll('materials', materials, DATASET_SCHEMAS.material);

const lots = parseCsv(read('lots.csv'));
const transactions = parseCsv(read('transactions.csv')).map((r) =>
  coerce(r, {
    numbers: ['totalWeightKg', 'estimatedValueInr', 'quotedPriceInr', 'finalPriceInr'],
    arrays: ['categorySummary', 'anomalyFlags'],
    optional: ['paidAt'],
  }),
);

const traceability = parseCsv(read('traceability.csv')).map((r) =>
  coerce(r, {
    numbers: ['declaredWeightKg', 'weighedWeightKg', 'lat', 'lon'],
    ints: ['photoCount'],
    arrays: ['photoHashes'],
    optional: ['confirmedAt', 'downstreamStatus', 'transactionId'],
  }),
);

const training = parseCsv(read('training_manifest.csv')).map((r) =>
  coerce(r, {
    numbers: ['weightKg', 'observedPriceInr', 'finalPriceInr'],
    booleans: ['synthetic'],
    optional: ['finalPriceInr'],
  }),
);
validateAll('training manifest', training, DATASET_SCHEMAS.training);

/* ---------------------------------------------------------------- */
/* Referential integrity                                             */
/* ---------------------------------------------------------------- */

const lotIds = new Set(lots.map((l) => l['lotId']));
const collectorIds = new Set(collectors.map((c) => String(c['collectorId'])));
const recyclerIds = new Set(recyclers.map((r) => String(r['recyclerId'])));
const transactionIds = new Set(transactions.map((t) => String(t['transactionId'])));

function checkRefs(label: string, rows: Array<Record<string, unknown>>, column: string, known: Set<unknown>, allowEmpty = false) {
  const orphans = rows.filter((r) => {
    const value = r[column];
    if (allowEmpty && (value === '' || value === undefined)) return false;
    return !known.has(value);
  });
  if (orphans.length) fail(`${label}: ${orphans.length} rows reference an unknown ${column} (e.g. ${String(orphans[0]![column])})`);
  else pass(`${label}: every ${column} resolves`);
}

checkRefs('materials -> lots', materials, 'lotId', lotIds);
checkRefs('lots -> collectors', lots, 'collectorId', collectorIds);
checkRefs('lots -> recyclers', lots, 'recyclerId', recyclerIds, true);
checkRefs('transactions -> lots', transactions, 'lotId', lotIds);
checkRefs('transactions -> collectors', transactions, 'collectorId', collectorIds);
checkRefs('transactions -> recyclers', transactions, 'recyclerId', recyclerIds);
checkRefs('traceability -> lots', traceability, 'lotId', lotIds);
checkRefs('traceability -> transactions', traceability, 'transactionId', transactionIds, true);
checkRefs('prices -> recyclers', prices as Array<Record<string, unknown>>, 'recyclerId', recyclerIds, true);

/* ---------------------------------------------------------------- */
/* Traceability integrity: the digests must actually verify          */
/* ---------------------------------------------------------------- */

let digestFailures = 0;
for (const row of traceability) {
  const record = {
    handoverRef: String(row['handoverRef']),
    lotId: String(row['lotId']),
    collectorId: String(row['collectorId']),
    recyclerId: String(row['recyclerId']),
    verificationCode: String(row['verificationCode']),
    digest: String(row['digest']),
    photoRefs: [],
    photoHashes: row['photoHashes'] as string[],
    weighedWeightKg: Number(row['weighedWeightKg']),
    declaredWeightKg: Number(row['declaredWeightKg']),
    handoverPoint: { lat: Number(row['lat']), lon: Number(row['lon']) },
    handoverPlace: { locality: '', district: String(row['district']), state: '' },
    createdAt: String(row['createdAt']),
    confirmationStatus: 'pending',
  } satisfies HandoverRecord;
  if (!verifyHandover(record, `synthetic-device-secret-${record.collectorId}`).valid) digestFailures++;
}
if (digestFailures) fail(`traceability: ${digestFailures}/${traceability.length} handover digests do not verify`);
else pass(`traceability: all ${traceability.length} handover digests verify`);

/* ---------------------------------------------------------------- */
/* Data quality                                                      */
/* ---------------------------------------------------------------- */

// Every sub-category needs price coverage, or the app shows an empty board.
const coveredSubs = new Set(prices.map((p) => String(p['subCategoryId'])));
const uncovered = ALL_SUB_CATEGORY_IDS.filter((id) => !coveredSubs.has(id));
if (uncovered.length) fail(`prices: no observations for ${uncovered.length} sub-categories (${uncovered.slice(0, 5).join(', ')})`);
else pass(`prices: all ${ALL_SUB_CATEGORY_IDS.length} sub-categories have observations`);

// Thin district/sub-category cells fall back to the national rollup. That is
// by design, but it should be visible.
const cellCounts = new Map<string, number>();
for (const p of prices) {
  const key = `${p['subCategoryId']}|${p['district']}`;
  cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
}
const thin = [...cellCounts.values()].filter((n) => n < 5).length;
if (thin > 0) warn(`prices: ${thin}/${cellCounts.size} district cells have fewer than 5 observations (national fallback applies)`);
else pass('prices: every district cell has at least 5 observations');

// Duplicate primary keys would silently corrupt any join.
for (const [label, rows, key] of [
  ['prices', prices, 'priceId'],
  ['materials', materials, 'materialId'],
  ['lots', lots, 'lotId'],
  ['transactions', transactions, 'transactionId'],
  ['traceability', traceability, 'handoverRef'],
  ['training manifest', training, 'sampleId'],
] as const) {
  const seen = new Set<unknown>();
  const dupes = (rows as Array<Record<string, unknown>>).filter((r) => {
    if (seen.has(r[key])) return true;
    seen.add(r[key]);
    return false;
  });
  if (dupes.length) fail(`${label}: ${dupes.length} duplicate ${key} values`);
}
pass('primary keys are unique across all datasets');

// A training split that leaks the same image across train and test would make
// every reported accuracy meaningless.
const splitByHash = new Map<string, Set<string>>();
for (const s of training) {
  const hash = String(s['imageHash']);
  if (!splitByHash.has(hash)) splitByHash.set(hash, new Set());
  splitByHash.get(hash)!.add(String(s['split']));
}
const leaked = [...splitByHash.values()].filter((s) => s.size > 1).length;
if (leaked) fail(`training manifest: ${leaked} image hashes appear in more than one split`);
else pass('training manifest: no image appears in more than one split');

const splitCounts = training.reduce<Record<string, number>>((acc, s) => {
  const key = String(s['split']);
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});
pass(`training manifest split: ${Object.entries(splitCounts).map(([k, v]) => `${k}=${v}`).join(' ')}`);

// Every seeded facility must be identifiable as synthetic.
const notMarked = recyclers.filter((r) => !String(r['name']).startsWith('[Demo]') || !String(r['authorizationNumber']).startsWith('SYN/'));
if (notMarked.length) fail(`recyclers: ${notMarked.length} facilities are not marked as synthetic`);
else pass('recyclers: every seeded facility is marked synthetic');

// Ledger counters must agree with the transactions they summarise.
const paidByCollector = new Map<string, number>();
for (const t of transactions) {
  if (t['paymentStatus'] !== 'paid') continue;
  const id = String(t['collectorId']);
  paidByCollector.set(id, (paidByCollector.get(id) ?? 0) + Number(t['finalPriceInr']));
}
const ledgerMismatches = collectors.filter((c) => {
  const expected = Math.round((paidByCollector.get(String(c['collectorId'])) ?? 0) * 100) / 100;
  return Math.abs(expected - Number(c['lifetimeEarningsInr'])) > 0.05;
});
if (ledgerMismatches.length) fail(`collectors: ${ledgerMismatches.length} lifetime earnings totals disagree with the transaction dataset`);
else pass('collectors: ledger totals reconcile with transactions');

/* ---------------------------------------------------------------- */

console.log('\nChecks passed:');
for (const c of checks) console.log(`  ok    ${c}`);
if (warnings.length) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log(`  warn  ${w}`);
}
if (errors.length) {
  console.log('\nErrors:');
  for (const e of errors) console.log(`  FAIL  ${e}`);
  console.log(`\n${errors.length} error(s).`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);

import type { PriceIndex, Recycler } from '@ewaste/shared';
import { REFERENCE_KEYS, cacheReference, saveTransactions, type TransactionRow } from '../db/index.ts';
import bundle from './bundle.json';

/**
 * Offline demo mode.
 *
 * The app normally gets its price index and recycler list from a sync, which
 * makes the first run depend on connectivity at exactly the wrong moment - a
 * field demo in a scrap yard, or a phone handed to someone with no server
 * anywhere. This seeds both from data compiled into the APK, so every screen
 * works standing still with aeroplane mode on.
 *
 * What it is not: a fake. The same valuer, matcher and handover signing run on
 * the same shapes of data. The only difference is where the reference data
 * came from and that nothing is uploaded. The UI says so on every screen,
 * because a demo that looks identical to the real thing is how people end up
 * believing a synthetic price.
 */

export interface DemoBundle {
  note: string;
  district: string;
  state: string;
  generatedAt: string;
  priceIndex: PriceIndex;
  recyclers: Recycler[];
  transactions: Array<{
    transactionId: string;
    lotId: string;
    recyclerId: string;
    totalWeightKg: number;
    finalPriceInr: number;
    daysAgo: number;
    paymentStatus: string;
    paymentMode: string;
    status: string;
    anomalyFlags: string[];
  }>;
}

export const demoBundle = bundle as unknown as DemoBundle;

export const DEMO_DISTRICT = demoBundle.district;
export const DEMO_STATE = demoBundle.state;

/**
 * Writes the bundled reference data into the same cache a real sync fills, so
 * nothing downstream needs to know it is in demo mode.
 */
export async function seedDemoData(): Promise<void> {
  await cacheReference(REFERENCE_KEYS.priceIndex, `demo-${demoBundle.generatedAt}`, demoBundle.priceIndex);
  await cacheReference(REFERENCE_KEYS.recyclers, `demo-${demoBundle.generatedAt}`, demoBundle.recyclers);

  // Dated relative to install, so "this week" on the ledger is not empty on a
  // phone opened months after the dataset was generated.
  const now = Date.now();
  const rows: TransactionRow[] = demoBundle.transactions.map((t) => ({
    transactionId: t.transactionId,
    lotId: t.lotId,
    recyclerId: t.recyclerId,
    totalWeightKg: t.totalWeightKg,
    finalPriceInr: t.finalPriceInr,
    handoverAt: new Date(now - t.daysAgo * 86_400_000).toISOString(),
    paymentStatus: t.paymentStatus as TransactionRow['paymentStatus'],
    paymentMode: t.paymentMode as TransactionRow['paymentMode'],
    status: t.status as TransactionRow['status'],
    anomalyFlags: t.anomalyFlags,
  }));
  await saveTransactions(rows);
}

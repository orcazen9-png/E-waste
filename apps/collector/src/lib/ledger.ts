import type { LocalTransaction } from '../db/index.ts';

/**
 * Ledger totals.
 *
 * This lives in one place on purpose. The home screen and the ledger screen
 * both show what the collector is owed, and if those two numbers ever disagree
 * the app has destroyed the only thing it is really selling. One function, one
 * definition of "pending", used by both.
 *
 * It is also pure, so it is testable without a device.
 */
export interface LedgerTotals {
  /** Everything actually received, all time. */
  earnedInr: number;
  /** Received in the last seven days. */
  weekInr: number;
  /** Owed and not yet received. A part-paid sale counts half. */
  pendingInr: number;
  completed: number;
  /** Sales carrying at least one anomaly flag - shown as advice, never a block. */
  flagged: number;
}

export function summariseTransactions(
  transactions: LocalTransaction[],
  now: Date = new Date(),
): LedgerTotals {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  let earnedInr = 0;
  let weekInr = 0;
  let pendingInr = 0;
  let completed = 0;
  let flagged = 0;

  for (const transaction of transactions) {
    // A cancelled sale is not money owed, however it was marked before.
    const live = transaction.status !== 'cancelled';

    if (transaction.paymentStatus === 'paid') {
      earnedInr += transaction.finalPriceInr;
      if (Date.parse(transaction.handoverAt) >= weekAgo) weekInr += transaction.finalPriceInr;
    } else if (live) {
      // Half is a convention, not a measurement: without a recorded part
      // payment amount it is the least wrong assumption, and it is applied
      // identically everywhere so the two screens cannot disagree.
      pendingInr += transaction.paymentStatus === 'partial'
        ? transaction.finalPriceInr / 2
        : transaction.finalPriceInr;
    }

    if (transaction.status === 'completed') completed += 1;
    if (transaction.anomalyFlags.length > 0) flagged += 1;
  }

  return {
    earnedInr: round2(earnedInr),
    weekInr: round2(weekInr),
    pendingInr: round2(pendingInr),
    completed,
    flagged,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

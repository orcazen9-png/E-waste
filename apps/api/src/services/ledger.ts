import { formatInr, type PaymentMode, type Transaction } from '@ewaste/shared';
import type { Repository } from '../repository/types.ts';

/**
 * The earnings ledger.
 *
 * Everything here is computed from the transaction dataset rather than stored
 * as a running balance, because a collector disputing a number needs to be
 * shown the transactions behind it, not a total they have to take on faith.
 */
export interface LedgerSummary {
  collectorId: string;
  totalEarnedInr: number;
  pendingDuesInr: number;
  completedTransactions: number;
  thisWeekInr: number;
  thisMonthInr: number;
  byPaymentMode: Record<PaymentMode, number>;
  /** Recent activity, newest first, ready to render as a list of rows. */
  entries: LedgerEntry[];
  /** Buyers who owe money right now - the thing collectors actually chase. */
  outstanding: Array<{ recyclerId: string; amountInr: number; transactions: number; oldestAt: string }>;
}

export interface LedgerEntry {
  transactionId: string;
  lotId: string;
  recyclerId: string;
  at: string;
  weightKg: number;
  amountInr: number;
  amountLabel: string;
  paymentStatus: Transaction['paymentStatus'];
  paymentMode: PaymentMode;
  flagged: boolean;
}

export class LedgerService {
  constructor(private readonly repo: Repository) {}

  async summary(collectorId: string, options: { limit?: number; now?: Date } = {}): Promise<LedgerSummary> {
    const now = options.now ?? new Date();
    const transactions = await this.repo.listTransactions({ collectorId });

    const weekAgo = now.getTime() - 7 * 86_400_000;
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

    const paid = transactions.filter((t) => t.paymentStatus === 'paid');
    const outstandingTxns = transactions.filter(
      (t) => t.paymentStatus !== 'paid' && t.status !== 'cancelled',
    );

    const byPaymentMode: Record<PaymentMode, number> = { cash: 0, upi: 0, bank_transfer: 0 };
    for (const t of paid) byPaymentMode[t.paymentMode] += t.finalPriceInr;

    const outstandingByRecycler = new Map<string, { amountInr: number; transactions: number; oldestAt: string }>();
    for (const t of outstandingTxns) {
      const due = t.paymentStatus === 'partial' ? t.finalPriceInr / 2 : t.finalPriceInr;
      const entry = outstandingByRecycler.get(t.recyclerId) ?? {
        amountInr: 0,
        transactions: 0,
        oldestAt: t.handoverAt,
      };
      entry.amountInr += due;
      entry.transactions += 1;
      if (t.handoverAt < entry.oldestAt) entry.oldestAt = t.handoverAt;
      outstandingByRecycler.set(t.recyclerId, entry);
    }

    return {
      collectorId,
      totalEarnedInr: round2(paid.reduce((s, t) => s + t.finalPriceInr, 0)),
      pendingDuesInr: round2(
        outstandingTxns.reduce((s, t) => s + (t.paymentStatus === 'partial' ? t.finalPriceInr / 2 : t.finalPriceInr), 0),
      ),
      completedTransactions: transactions.filter((t) => t.status === 'completed').length,
      thisWeekInr: round2(
        paid.filter((t) => Date.parse(t.handoverAt) >= weekAgo).reduce((s, t) => s + t.finalPriceInr, 0),
      ),
      thisMonthInr: round2(
        paid.filter((t) => Date.parse(t.handoverAt) >= monthStart).reduce((s, t) => s + t.finalPriceInr, 0),
      ),
      byPaymentMode: {
        cash: round2(byPaymentMode.cash),
        upi: round2(byPaymentMode.upi),
        bank_transfer: round2(byPaymentMode.bank_transfer),
      },
      entries: transactions.slice(0, options.limit ?? 50).map((t) => ({
        transactionId: t.transactionId,
        lotId: t.lotId,
        recyclerId: t.recyclerId,
        at: t.handoverAt,
        weightKg: t.totalWeightKg,
        amountInr: t.finalPriceInr,
        amountLabel: formatInr(t.finalPriceInr),
        paymentStatus: t.paymentStatus,
        paymentMode: t.paymentMode,
        flagged: t.anomalyFlags.length > 0,
      })),
      outstanding: [...outstandingByRecycler.entries()]
        .map(([recyclerId, v]) => ({ recyclerId, ...v, amountInr: round2(v.amountInr) }))
        .sort((a, b) => b.amountInr - a.amountInr),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

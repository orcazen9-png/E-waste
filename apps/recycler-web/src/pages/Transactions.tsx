import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '@ewaste/shared';
import { api } from '../lib/api.ts';
import { inr, dateTime } from '../lib/format.ts';

export function Transactions({ recyclerId }: { recyclerId: string }) {
  const [rows, setRows] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    api
      .transactions(recyclerId)
      .then((r) => !cancelled && setRows(r.transactions))
      .catch(() => !cancelled && setError('Could not load transactions.'));
    return () => {
      cancelled = true;
    };
  }, [recyclerId]);

  const totals = useMemo(() => {
    if (!rows) return undefined;
    return {
      count: rows.length,
      weightKg: rows.reduce((s, t) => s + t.totalWeightKg, 0),
      paidInr: rows.filter((t) => t.paymentStatus === 'paid').reduce((s, t) => s + t.finalPriceInr, 0),
      owedInr: rows
        .filter((t) => t.paymentStatus !== 'paid')
        .reduce((s, t) => s + (t.paymentStatus === 'partial' ? t.finalPriceInr / 2 : t.finalPriceInr), 0),
      flagged: rows.filter((t) => t.anomalyFlags.length > 0).length,
    };
  }, [rows]);

  return (
    <>
      {totals && (
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div className="stat">
            <div className="k">Transactions</div>
            <div className="big-number">{totals.count}</div>
          </div>
          <div className="stat">
            <div className="k">Material received</div>
            <div className="big-number">{Math.round(totals.weightKg).toLocaleString('en-IN')} kg</div>
          </div>
          <div className="stat">
            <div className="k">Paid to collectors</div>
            <div className="big-number">{inr(totals.paidInr)}</div>
          </div>
          <div className="stat">
            <div className="k">Still owed</div>
            <div className="big-number" style={{ color: totals.owedInr > 0 ? 'var(--warn)' : undefined }}>
              {inr(totals.owedInr)}
            </div>
            <div className="small muted">
              {totals.flagged > 0 ? `${totals.flagged} transaction(s) carry a check flag` : 'No flagged transactions'}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Transaction history</h2>
        {error && <div className="banner danger">{error}</div>}
        {!rows && !error && <div className="empty">Loading…</div>}
        {rows?.length === 0 && <div className="empty">No transactions yet.</div>}
        {rows && rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Collector</th>
                <th>Materials</th>
                <th className="num">Weight</th>
                <th className="num">Paid</th>
                <th>Payment</th>
                <th>Checks</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((t) => (
                <tr key={t.transactionId}>
                  <td className="small">{dateTime(t.handoverAt)}</td>
                  <td className="mono small">{t.collectorId}</td>
                  <td className="small">{t.categorySummary.join(', ')}</td>
                  <td className="num">{t.totalWeightKg} kg</td>
                  <td className="num">{inr(t.finalPriceInr)}</td>
                  <td>
                    <span className={t.paymentStatus === 'paid' ? 'pill ok' : 'pill warn'}>
                      {t.paymentStatus} · {t.paymentMode}
                    </span>
                  </td>
                  <td>
                    {t.anomalyFlags.length === 0 ? (
                      <span className="muted small">clear</span>
                    ) : (
                      <span className="pill danger" title={t.anomalyFlags.join(', ')}>
                        {t.anomalyFlags.length} flag{t.anomalyFlags.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

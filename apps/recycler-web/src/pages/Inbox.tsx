import { useEffect, useState } from 'react';
import { getSubCategory, type HandoverRecord } from '@ewaste/shared';
import { api, type HandoverWithLot } from '../lib/api.ts';
import { inr, label, timeAgo } from '../lib/format.ts';

/** Slips waiting on this facility, oldest pressure first. */
export function Inbox({ recyclerId }: { recyclerId: string }) {
  const [status, setStatus] = useState<HandoverRecord['confirmationStatus']>('pending');
  const [rows, setRows] = useState<HandoverWithLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    api
      .inbox(recyclerId, status)
      .then((r) => !cancelled && setRows(r.handovers))
      .catch(() => !cancelled && setError('Could not load the inbox.'));
    return () => {
      cancelled = true;
    };
  }, [recyclerId, status]);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Handovers</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="pending">Waiting for you</option>
          <option value="confirmed">Confirmed</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {error && <div className="banner danger">{error}</div>}
      {!rows && !error && <div className="empty">Loading…</div>}
      {rows?.length === 0 && (
        <div className="empty">
          {status === 'pending' ? 'Nothing waiting. Collectors will appear here as they arrive.' : 'Nothing here yet.'}
        </div>
      )}

      {rows && rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Materials</th>
              <th className="num">Declared</th>
              <th className="num">Their estimate</th>
              <th>Signed</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ record, lot }) => (
              <tr key={record.handoverRef}>
                <td className="mono">{record.handoverRef}</td>
                <td>
                  {lot
                    ? lot.items
                        .map((i) => `${getSubCategory(i.subCategoryId).sub.glyph} ${label(getSubCategory(i.subCategoryId).sub.labelKey)}`)
                        .join(', ')
                    : '—'}
                </td>
                <td className="num">{record.declaredWeightKg} kg</td>
                <td className="num">{lot ? inr(lot.estimatedValueInr) : '—'}</td>
                <td className="muted small">{timeAgo(record.createdAt)}</td>
                <td>
                  <span
                    className={
                      record.confirmationStatus === 'confirmed'
                        ? 'pill ok'
                        : record.confirmationStatus === 'rejected'
                          ? 'pill danger'
                          : 'pill warn'
                    }
                  >
                    {record.confirmationStatus}
                  </span>
                  {record.downstreamStatus && (
                    <span className="pill" style={{ marginLeft: 6 }}>
                      {record.downstreamStatus.replace(/_/g, ' ')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

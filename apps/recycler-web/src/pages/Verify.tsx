import { useState } from 'react';
import { getSubCategory, type HandoverRecord, type Lot, type PaymentMode } from '@ewaste/shared';
import { api, ApiError, type HandoverWithLot } from '../lib/api.ts';
import { inr, label, dateTime } from '../lib/format.ts';

/**
 * The counter screen: scan or type a slip, check what is in the sack against
 * what the collector declared, weigh it, pay, confirm.
 *
 * The declared weight is shown next to the weighed weight with the difference
 * spelled out, because that gap is where a collector most often loses money
 * and where a recycler most often gets a bad sack.
 */
export function Verify({ recyclerId }: { recyclerId: string }) {
  const [qr, setQr] = useState('');
  const [ref, setRef] = useState('');
  const [code, setCode] = useState('');
  const [found, setFound] = useState<HandoverWithLot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(body: Parameters<typeof api.lookup>[0]) {
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      setFound(await api.lookup(body));
    } catch (e) {
      setError(e instanceof ApiError ? describe(e) : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Find a handover slip</h2>
        <p className="muted small">
          Scan the collector&rsquo;s QR code into the first box, or type the reference and the
          six-digit code from their screen. Both work offline on their phone.
        </p>

        <div className="col" style={{ marginBottom: 14 }}>
          <label htmlFor="qr">Scanned QR contents</label>
          <textarea
            id="qr"
            rows={3}
            className="mono"
            placeholder='{"v":1,"r":"HO-XXXX-XXXX",...}'
            value={qr}
            onChange={(e) => setQr(e.target.value)}
          />
          <button
            className="primary"
            style={{ alignSelf: 'flex-start', marginTop: 8 }}
            disabled={!qr.trim() || busy}
            onClick={() => lookup({ qr: qr.trim() })}
          >
            Look up from QR
          </button>
        </div>

        <div className="row">
          <div className="col grow">
            <label htmlFor="ref">Reference</label>
            <input
              id="ref"
              className="mono"
              placeholder="HO-XXXX-XXXX"
              value={ref}
              onChange={(e) => setRef(e.target.value.toUpperCase())}
            />
          </div>
          <div className="col">
            <label htmlFor="code">6-digit code</label>
            <input
              id="code"
              className="mono"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <button
            className="secondary"
            disabled={!ref || code.length !== 6 || busy}
            onClick={() => lookup({ handoverRef: ref, verificationCode: code })}
          >
            Look up by code
          </button>
        </div>

        {error && (
          <div className="banner danger" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}
      </div>

      {found && <SlipDetail key={found.record.handoverRef} found={found} recyclerId={recyclerId} />}
    </>
  );
}

function describe(error: ApiError): string {
  switch (error.code) {
    case 'handover.invalid_digest':
      return 'This slip has been altered since it was signed. Do not accept it.';
    case 'handover.qr_mismatch':
      return 'This code does not match the saved slip. Do not accept it.';
    case 'handover.invalid_code':
      return 'That code does not match this reference.';
    case 'handover_not_found':
      return 'No slip found. Check the reference, or ask the collector to sync their phone.';
    default:
      return label(error.code) || error.code;
  }
}

function SlipDetail({ found, recyclerId }: { found: HandoverWithLot; recyclerId: string }) {
  const { record, lot } = found;
  const [weighed, setWeighed] = useState(String(record.weighedWeightKg));
  const [price, setPrice] = useState(String(Math.round(lot?.estimatedValueInr ?? 0)));
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'partial' | 'paid'>('paid');
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.confirm>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mine = record.recyclerId === recyclerId;
  const already = record.confirmationStatus !== 'pending';
  const weighedNum = Number(weighed);
  const diffPct =
    record.declaredWeightKg > 0
      ? ((weighedNum - record.declaredWeightKg) / record.declaredWeightKg) * 100
      : 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.confirm(record.handoverRef, {
          recyclerId,
          finalPriceInr: Number(price),
          paymentMode,
          paymentStatus,
          weighedWeightKg: weighedNum,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? describe(e) : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>
        Slip <span className="mono">{record.handoverRef}</span>
      </h2>

      {!mine && (
        <div className="banner danger">
          This slip is addressed to a different facility. You cannot confirm it.
        </div>
      )}
      {already && !result && (
        <div className="banner warn">
          Already {record.confirmationStatus}
          {record.confirmedAt ? ` on ${dateTime(record.confirmedAt)}` : ''}.
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="k">Collector declared</div>
          <div className="big-number">{record.declaredWeightKg} kg</div>
        </div>
        <div className="stat">
          <div className="k">Weighed here</div>
          <div className="big-number">{weighedNum || 0} kg</div>
          <div className={Math.abs(diffPct) >= 20 ? 'small' : 'small muted'}>
            {diffPct >= 0 ? '+' : ''}
            {diffPct.toFixed(1)}% vs declared
            {Math.abs(diffPct) >= 20 && ' — large gap, check the sack together'}
          </div>
        </div>
      </div>

      {lot && (
        <>
          <h3>What the collector recorded</h3>
          <table style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th>Material</th>
                <th>Condition</th>
                <th className="num">Weight</th>
                <th className="num">Their estimate</th>
              </tr>
            </thead>
            <tbody>
              {lot.items.map((item) => {
                const { sub } = getSubCategory(item.subCategoryId);
                return (
                  <tr key={item.materialId}>
                    <td>
                      {sub.glyph} {label(sub.labelKey)}
                    </td>
                    <td className="muted">{label(`condition.${item.condition}`)}</td>
                    <td className="num">{item.approxWeightKg} kg</td>
                    <td className="num">{inr(item.estimatedValueInr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            Collected {dateTime(lot.collectedAt)} in {lot.collectionPlace.locality},{' '}
            {lot.collectionPlace.district}. Slip signed {dateTime(record.createdAt)}.
            {record.photoHashes.length > 0 && ` ${record.photoHashes.length} photo(s) attached.`}
          </p>
        </>
      )}

      {!result && mine && !already && (
        <>
          <h3 style={{ marginTop: 18 }}>Settle</h3>
          <div className="row">
            <div className="col">
              <label htmlFor="w">Weighed (kg)</label>
              <input id="w" type="number" step="0.1" value={weighed} onChange={(e) => setWeighed(e.target.value)} />
            </div>
            <div className="col">
              <label htmlFor="p">Amount paid (₹)</label>
              <input id="p" type="number" step="1" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="col">
              <label htmlFor="pm">Paid by</label>
              <select id="pm" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </div>
            <div className="col">
              <label htmlFor="ps">Payment</label>
              <select
                id="ps"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as typeof paymentStatus)}
              >
                <option value="paid">Paid in full</option>
                <option value="partial">Part paid</option>
                <option value="unpaid">Not paid yet</option>
              </select>
            </div>
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" disabled={busy || !Number(price)} onClick={confirm}>
              Confirm receipt
            </button>
            <button
              className="secondary danger"
              disabled={busy}
              onClick={async () => {
                const reason = window.prompt('Why are you rejecting this slip?');
                if (!reason) return;
                setBusy(true);
                try {
                  await api.reject(record.handoverRef, recyclerId, reason);
                  setError('Slip rejected. The collector will see the reason on their phone.');
                } catch (e) {
                  setError(e instanceof ApiError ? describe(e) : 'Could not reach the server.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reject
            </button>
          </div>
        </>
      )}

      {error && (
        <div className="banner danger" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}

      {result && <ConfirmationResult result={result} recyclerId={recyclerId} record={record} />}
    </div>
  );
}

function ConfirmationResult({
  result,
  recyclerId,
  record,
}: {
  result: Awaited<ReturnType<typeof api.confirm>>;
  recyclerId: string;
  record: HandoverRecord;
}) {
  const [downstream, setDownstream] = useState(result.handover.downstreamStatus ?? 'received');
  const [saved, setSaved] = useState(false);

  return (
    <>
      <div className="banner ok" style={{ marginTop: 14 }}>
        Confirmed. Transaction <span className="mono">{result.transaction.transactionId}</span> recorded for{' '}
        {inr(result.transaction.finalPriceInr)}. The collector&rsquo;s ledger is updated.
      </div>

      {result.flags.length > 0 && (
        <div className="banner warn">
          <strong>Checks raised {result.flags.length} flag(s):</strong>
          <ul style={{ margin: '6px 0 0 18px' }}>
            {result.flags.map((f) => (
              <li key={f.code}>
                {label(f.messageKey)} <span className="muted small">({f.code})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>Downstream status</h3>
      <p className="small muted">
        Recording what happens after receipt is what makes the collector&rsquo;s material traceable all
        the way to EPR reporting.
      </p>
      <div className="row">
        <select value={downstream} onChange={(e) => setDownstream(e.target.value as typeof downstream)}>
          <option value="received">Received</option>
          <option value="sorted">Sorted</option>
          <option value="processed">Processed</option>
          <option value="reported_to_epr">Reported to EPR</option>
        </select>
        <button
          className="secondary"
          onClick={async () => {
            await api.setDownstream(record.handoverRef, recyclerId, downstream);
            setSaved(true);
          }}
        >
          Save
        </button>
        {saved && <span className="pill ok">Saved</span>}
      </div>
    </>
  );
}

export type { Lot };

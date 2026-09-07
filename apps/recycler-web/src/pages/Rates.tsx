import { useEffect, useState } from 'react';
import { getSubCategory, rateKey, type Recycler } from '@ewaste/shared';
import { api } from '../lib/api.ts';
import { inr, label } from '../lib/format.ts';

/**
 * The facility's published rate card, next to the district's prevailing price.
 *
 * Showing both is the point: a facility paying under the local median will see
 * it here, and so will every collector in the matching list. Transparency is
 * the mechanism, not a nice-to-have.
 */
export function Rates({ recycler }: { recycler: Recycler }) {
  const [board, setBoard] = useState<Awaited<ReturnType<typeof api.priceBoard>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .priceBoard(recycler.place.district)
      .then((b) => !cancelled && setBoard(b))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [recycler.place.district]);

  const fairBySub = new Map(board?.entries.map((e) => [e.subCategoryId, e]) ?? []);

  const rows = Object.entries(recycler.offeredRatesInr)
    .filter(([key]) => !key.endsWith(':*'))
    .map(([key, rate]) => {
      const subCategoryId = key.split(':')[1]!;
      const found = getSubCategory(subCategoryId);
      const fair = fairBySub.get(subCategoryId);
      return {
        key,
        subCategoryId,
        glyph: found.sub.glyph,
        name: label(found.sub.labelKey),
        unit: found.sub.unit,
        rate,
        fair: fair?.fairPriceInr,
        deltaPct: fair?.fairPriceInr ? ((rate - fair.fairPriceInr) / fair.fairPriceInr) * 100 : undefined,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));

  return (
    <div className="card">
      <h2>Your rate card</h2>
      <p className="small muted">
        Collectors see these rates, and see how they compare with the prevailing price in{' '}
        {recycler.place.district}. Rates are read-only in this prototype; editing them is the next
        piece of work.
      </p>

      <table>
        <thead>
          <tr>
            <th>Material</th>
            <th className="num">Your rate</th>
            <th className="num">District median</th>
            <th className="num">Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                {row.glyph} {row.name}
              </td>
              <td className="num">
                {inr(row.rate)}/{row.unit}
              </td>
              <td className="num muted">{row.fair !== undefined ? `${inr(row.fair)}/${row.unit}` : '—'}</td>
              <td className="num">
                {row.deltaPct === undefined ? (
                  '—'
                ) : (
                  <span className={row.deltaPct >= 0 ? 'pill ok' : row.deltaPct < -10 ? 'pill danger' : 'pill warn'}>
                    {row.deltaPct >= 0 ? '+' : ''}
                    {row.deltaPct.toFixed(0)}%
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 20 }}>Facility</h3>
      <table>
        <tbody>
          <tr>
            <th>Authorisation</th>
            <td className="mono">{recycler.authorizationNumber}</td>
          </tr>
          <tr>
            <th>Issued by</th>
            <td>{recycler.authorizationIssuer}</td>
          </tr>
          <tr>
            <th>Valid till</th>
            <td>{recycler.authorizationValidTill}</td>
          </tr>
          <tr>
            <th>Materials accepted</th>
            <td>{recycler.materialsAccepted.join(', ')}</td>
          </tr>
          <tr>
            <th>Pickup</th>
            <td>
              {recycler.pickupAvailable
                ? `Yes, from ${recycler.pickupMinWeightKg ?? 0} kg, within ${recycler.serviceAreaRadiusKm} km`
                : 'Collectors come to the facility'}
            </td>
          </tr>
          <tr>
            <th>Pays by</th>
            <td>{recycler.paymentModes.join(', ')}</td>
          </tr>
        </tbody>
      </table>
      <p className="small muted" style={{ marginTop: 10 }}>
        Rate-card keys use the <span className="mono">{rateKey('cable', 'cable_copper_house')}</span> convention, with
        a <span className="mono">{rateKey('cable')}</span> fallback per category.
      </p>
    </div>
  );
}

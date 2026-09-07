import { useEffect, useState } from 'react';
import type { Recycler } from '@ewaste/shared';
import { api } from './lib/api.ts';
import { Inbox } from './pages/Inbox.tsx';
import { Verify } from './pages/Verify.tsx';
import { Transactions } from './pages/Transactions.tsx';
import { Rates } from './pages/Rates.tsx';

type Tab = 'verify' | 'inbox' | 'transactions' | 'rates';

const STORAGE_KEY = 'ewaste.recyclerId';

export function App() {
  const [recyclers, setRecyclers] = useState<Recycler[] | null>(null);
  const [recyclerId, setRecyclerId] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? '');
  const [tab, setTab] = useState<Tab>('verify');
  const [health, setHealth] = useState<{ dataSource: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    api
      .listRecyclers()
      .then((r) => {
        setRecyclers(r.recyclers);
        setRecyclerId((current) => current || (r.recyclers[0]?.recyclerId ?? ''));
      })
      .catch(() => setError('Could not reach the API. Start it with `pnpm api:dev`.'));
  }, []);

  useEffect(() => {
    if (recyclerId) localStorage.setItem(STORAGE_KEY, recyclerId);
  }, [recyclerId]);

  const recycler = recyclers?.find((r) => r.recyclerId === recyclerId);

  return (
    <div className="app">
      <header className="top">
        <h1>Recycler console</h1>
        {recyclers && (
          <select
            aria-label="Facility"
            value={recyclerId}
            onChange={(e) => setRecyclerId(e.target.value)}
            style={{ maxWidth: 340 }}
          >
            {recyclers.map((r) => (
              <option key={r.recyclerId} value={r.recyclerId}>
                {r.name} — {r.place.district}
              </option>
            ))}
          </select>
        )}
        <span className="env">
          {health ? `API up · ${health.dataSource}` : 'API unreachable'}
        </span>
      </header>

      {error && <div className="banner danger">{error}</div>}

      {/* There is no sign-in yet, so this cannot be mistaken for a real console. */}
      <div className="banner warn small">
        Prototype: no sign-in. Anyone with this page can act as any facility, and all facility
        records shown are synthetic demo data.
      </div>

      <nav className="tabs">
        {(
          [
            ['verify', 'Verify a slip'],
            ['inbox', 'Handovers'],
            ['transactions', 'Transactions'],
            ['rates', 'Rates & facility'],
          ] as Array<[Tab, string]>
        ).map(([key, title]) => (
          <button key={key} aria-current={tab === key} onClick={() => setTab(key)}>
            {title}
          </button>
        ))}
      </nav>

      {!recyclerId && !error && <div className="empty">Loading facilities…</div>}

      {recyclerId && tab === 'verify' && <Verify recyclerId={recyclerId} />}
      {recyclerId && tab === 'inbox' && <Inbox recyclerId={recyclerId} />}
      {recyclerId && tab === 'transactions' && <Transactions recyclerId={recyclerId} />}
      {recycler && tab === 'rates' && <Rates recycler={recycler} />}
    </div>
  );
}

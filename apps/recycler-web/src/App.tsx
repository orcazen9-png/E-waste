import { useCallback, useEffect, useState } from 'react';
import type { Recycler } from '@ewaste/shared';
import { api, clearSession, loadSession, setUnauthorizedHandler, type Session } from './lib/api.ts';
import { SignIn } from './pages/SignIn.tsx';
import { Inbox } from './pages/Inbox.tsx';
import { Verify } from './pages/Verify.tsx';
import { Transactions } from './pages/Transactions.tsx';
import { Rates } from './pages/Rates.tsx';

type Tab = 'verify' | 'inbox' | 'transactions' | 'rates';

export function App() {
  const [session, setSession] = useState<Session | undefined>(() => loadSession());
  const [recycler, setRecycler] = useState<Recycler | null>(null);
  const [tab, setTab] = useState<Tab>('verify');
  const [health, setHealth] = useState<{ dataSource: string; authDevMode: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A rejected token drops straight back to sign-in rather than leaving the
  // console showing stale data it can no longer refresh.
  const signOut = useCallback(() => {
    clearSession();
    setSession(undefined);
    setRecycler(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
  }, [signOut]);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (!session) return;
    setError(null);
    api
      .getRecycler(session.recyclerId)
      .then(setRecycler)
      .catch(() => setError('Could not load this facility.'));
  }, [session]);

  if (!session) return <SignIn onSignedIn={setSession} />;

  return (
    <div className="app">
      <header className="top">
        <h1>{recycler?.name ?? 'Recycler console'}</h1>
        <span className="env">
          {health ? `API up · ${health.dataSource}` : 'API unreachable'}
        </span>
        <button className="secondary" style={{ minHeight: 38, padding: '6px 14px' }} onClick={signOut}>
          Sign out
        </button>
      </header>

      {error && <div className="banner danger">{error}</div>}

      {health?.authDevMode && (
        <div className="banner warn small">
          Development mode: the server returns one-time codes in API responses. Never enable this in
          production.
        </div>
      )}

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

      {tab === 'verify' && <Verify recyclerId={session.recyclerId} />}
      {tab === 'inbox' && <Inbox recyclerId={session.recyclerId} />}
      {tab === 'transactions' && <Transactions recyclerId={session.recyclerId} />}
      {tab === 'rates' && recycler && <Rates recycler={recycler} />}
      {tab === 'rates' && !recycler && <div className="empty">Loading facility…</div>}
    </div>
  );
}

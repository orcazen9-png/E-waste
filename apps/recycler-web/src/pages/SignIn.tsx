import { useEffect, useState } from 'react';
import type { Recycler } from '@ewaste/shared';
import { api, ApiError, saveSession, type Session } from '../lib/api.ts';

/**
 * Facility sign-in.
 *
 * You name the facility; the code goes to the contact number on its
 * authorisation record. That means signing in requires control of a number the
 * regulator already has, and the page never reveals what that number is.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [facilities, setFacilities] = useState<Recycler[] | null>(null);
  const [recyclerId, setRecyclerId] = useState('');
  const [challengeId, setChallengeId] = useState<string>();
  const [devCode, setDevCode] = useState<string>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listRecyclers()
      .then((r) => {
        setFacilities(r.recyclers);
        setRecyclerId((current) => current || (r.recyclers[0]?.recyclerId ?? ''));
      })
      .catch(() => setError('Could not reach the API. Start it with `pnpm api:dev`.'));
  }, []);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.requestCode(recyclerId);
      setChallengeId(result.challengeId);
      setDevCode(result.devCode);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!challengeId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.verifyCode(challengeId, code);
      const session: Session = {
        token: result.token,
        recyclerId: result.recyclerId,
        expiresAt: result.expiresAt,
      };
      saveSession(session);
      onSignedIn(session);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app" style={{ maxWidth: 520 }}>
      <header className="top">
        <h1>Recycler console</h1>
      </header>

      <div className="card">
        <h2>Sign in</h2>

        {!challengeId ? (
          <>
            <p className="muted small">
              Choose your facility. A six-digit code is sent to the contact number on its
              authorisation record.
            </p>
            <div className="col" style={{ marginBottom: 14 }}>
              <label htmlFor="facility">Facility</label>
              <select
                id="facility"
                value={recyclerId}
                onChange={(e) => setRecyclerId(e.target.value)}
                disabled={!facilities}
              >
                {(facilities ?? []).map((r) => (
                  <option key={r.recyclerId} value={r.recyclerId}>
                    {r.name} — {r.place.district}
                  </option>
                ))}
              </select>
            </div>
            <button className="primary" onClick={() => void sendCode()} disabled={!recyclerId || busy}>
              Send code
            </button>
          </>
        ) : (
          <>
            <p className="muted small">Enter the six-digit code sent to your registered number.</p>
            {devCode && (
              <div className="banner warn small">
                Development mode: no SMS provider is configured, so the code is shown here —{' '}
                <strong className="mono">{devCode}</strong>. This never happens in production.
              </div>
            )}
            <div className="row">
              <div className="col grow">
                <label htmlFor="code">Code</label>
                <input
                  id="code"
                  className="mono"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void verify()}
                />
              </div>
              <button className="primary" onClick={() => void verify()} disabled={code.length !== 6 || busy}>
                Sign in
              </button>
            </div>
            <button
              className="secondary"
              style={{ marginTop: 12 }}
              onClick={() => {
                setChallengeId(undefined);
                setCode('');
                setDevCode(undefined);
              }}
            >
              Use a different facility
            </button>
          </>
        )}

        {error && (
          <div className="banner danger" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Could not reach the server.';
  switch (error.code) {
    case 'auth.facility_not_authorized':
      return 'This facility’s authorisation is not current, so it cannot sign in.';
    case 'auth.unknown_facility':
      return 'No such facility.';
    case 'auth.too_many_requests':
      return 'Too many codes requested. Wait a few minutes and try again.';
    case 'auth.too_many_attempts':
      return 'Too many wrong attempts. Request a new code.';
    case 'auth.invalid_code':
      return 'That code is not right.';
    case 'auth.code_expired':
      return 'That code has expired. Request a new one.';
    case 'auth.code_already_used':
      return 'That code has already been used. Request a new one.';
    case 'auth.sms_not_configured':
      return 'No SMS provider is configured on the server, so codes cannot be delivered.';
    default:
      return error.code;
  }
}

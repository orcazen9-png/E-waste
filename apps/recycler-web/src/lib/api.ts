import type {
  HandoverRecord,
  Lot,
  PaymentMode,
  Recycler,
  Transaction,
} from '@ewaste/shared';

/**
 * Thin API client. Errors carry the server's translation key so the console
 * can show the same wording the collector's phone shows - a recycler and a
 * collector disputing a slip should be reading the same sentence.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

const SESSION_KEY = 'ewaste.session';

export interface Session {
  token: string;
  recyclerId: string;
  expiresAt: string;
}

export function loadSession(): Session | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const session = JSON.parse(raw) as Session;
    // A 12-hour token on a shared yard terminal expires mid-shift; treat an
    // expired one as absent rather than letting every request 401.
    if (Date.parse(session.expiresAt) <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return undefined;
    }
    return session;
  } catch {
    return undefined;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** Called when the server rejects our token, so the UI can send them back to sign-in. */
let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = loadSession();
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session.token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401) {
      clearSession();
      onUnauthorized?.();
    }
    throw new ApiError(response.status, body.error ?? `http_${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface HandoverWithLot {
  record: HandoverRecord;
  lot: Lot | undefined;
}

export const api = {
  health: () => request<{ status: string; dataSource: string; authDevMode: boolean }>('/health'),

  requestCode: (recyclerId: string) =>
    request<{ challengeId: string; expiresAt: string; devCode?: string }>('/v1/auth/recycler/request', {
      method: 'POST',
      body: JSON.stringify({ recyclerId }),
    }),

  verifyCode: (challengeId: string, code: string) =>
    request<{ token: string; expiresAt: string; recyclerId: string }>('/v1/auth/recycler/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId, code }),
    }),

  listRecyclers: (district?: string) =>
    request<{ recyclers: Recycler[] }>(
      `/v1/recyclers${district ? `?district=${encodeURIComponent(district)}` : ''}`,
    ),

  getRecycler: (recyclerId: string) => request<Recycler>(`/v1/recyclers/${recyclerId}`),

  inbox: (recyclerId: string, status?: HandoverRecord['confirmationStatus']) =>
    request<{ handovers: HandoverWithLot[] }>(
      `/v1/recyclers/${recyclerId}/handovers${status ? `?status=${status}` : ''}`,
    ),

  transactions: (recyclerId: string) =>
    request<{ transactions: Transaction[] }>(`/v1/recyclers/${recyclerId}/transactions?limit=100`),

  lookup: (body: { qr?: string; handoverRef?: string; verificationCode?: string }) =>
    request<HandoverWithLot>('/v1/handovers/lookup', { method: 'POST', body: JSON.stringify(body) }),

  confirm: (
    handoverRef: string,
    // recyclerId is not sent: the server takes it from the signed token.
    body: {
      finalPriceInr: number;
      paymentMode: PaymentMode;
      paymentStatus: 'unpaid' | 'partial' | 'paid';
      weighedWeightKg?: number;
    },
  ) =>
    request<{ handover: HandoverRecord; transaction: Transaction; flags: Array<{ code: string; severity: string; messageKey: string }> }>(
      `/v1/handovers/${handoverRef}/confirm`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  reject: (handoverRef: string, reason: string) =>
    request<HandoverRecord>(`/v1/handovers/${handoverRef}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  setDownstream: (handoverRef: string, status: string) =>
    request<HandoverRecord>(`/v1/handovers/${handoverRef}/downstream`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  priceBoard: (district: string) =>
    request<{ entries: Array<{ subCategoryId: string; labelKey: string; glyph: string; fairPriceInr: number; unit: string; basis: string }> }>(
      `/v1/prices/board?district=${encodeURIComponent(district)}&lang=en`,
    ),
};

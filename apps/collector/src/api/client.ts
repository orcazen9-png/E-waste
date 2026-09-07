import Constants from 'expo-constants';
import type {
  MatchResult,
  PriceIndex,
  Recycler,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from '@ewaste/shared';

/**
 * API client.
 *
 * Every call has a short timeout and every caller is expected to carry on
 * without it. Nothing in this app blocks on the network - a request that hangs
 * on a two-bar connection must not leave a collector staring at a spinner while
 * a buyer waits at the scale.
 */
const DEFAULT_TIMEOUT_MS = 8000;

function baseUrl(): string {
  const configured = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  // 10.0.2.2 is the host machine as seen from the Android emulator.
  return configured ?? 'http://10.0.2.2:3001';
}

export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super('offline');
    this.cause = cause;
  }
}

/** The server rejected our token. The app must sign in again before syncing. */
export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
  }
}

/*
 * The token is held in module state rather than read from SQLite on every
 * call: sync runs in a background loop and an extra database round trip per
 * request is wasted battery.
 */
let accessToken: string | undefined;

export function setAccessToken(token: string | undefined): void {
  accessToken = token;
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number; anonymous?: boolean }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(accessToken && !init?.anonymous ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (response.status === 401) throw new UnauthorizedError();
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `http_${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('Network'))) {
      throw new OfflineError(error);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  /* Sign-in. These two are the only calls made without a token. */
  requestCode: (phone: string) =>
    request<{ challengeId: string; expiresAt: string; devCode?: string }>('/v1/auth/collector/request', {
      method: 'POST',
      anonymous: true,
      body: JSON.stringify({ phone }),
    }),

  verifyCode: (body: {
    challengeId: string;
    code: string;
    phone: string;
    deviceId: string;
    preferredLanguage?: string;
    district?: string;
    state?: string;
    platform?: string;
  }) =>
    request<{ token: string; expiresAt: string; collector: { collectorId: string } }>(
      '/v1/auth/collector/verify',
      { method: 'POST', anonymous: true, body: JSON.stringify(body) },
    ),

  priceIndex: (district: string) =>
    request<PriceIndex>(`/v1/prices/index?district=${encodeURIComponent(district)}`),

  recyclers: (district: string) =>
    request<{ recyclers: Recycler[] }>(`/v1/recyclers?district=${encodeURIComponent(district)}`),

  matches: (lotId: string, lat: number, lon: number, preferredPayment = 'cash') =>
    request<MatchResult>(
      `/v1/lots/${lotId}/matches?lat=${lat}&lon=${lon}&preferredPayment=${preferredPayment}&limit=8`,
    ),

  postHandover: (deviceSecret: string, record: unknown) =>
    request<{ record: unknown; flags: unknown[] }>('/v1/handovers', {
      method: 'POST',
      body: JSON.stringify({ deviceSecret, record }),
    }),

  syncPush: (body: SyncPushRequest) =>
    request<SyncPushResponse>('/v1/sync/push', { method: 'POST', body: JSON.stringify(body), timeoutMs: 15000 }),

  syncPull: (body: SyncPullRequest) =>
    request<SyncPullResponse>('/v1/sync/pull', { method: 'POST', body: JSON.stringify(body), timeoutMs: 15000 }),
};

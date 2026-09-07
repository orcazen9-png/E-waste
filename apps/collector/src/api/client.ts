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

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
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

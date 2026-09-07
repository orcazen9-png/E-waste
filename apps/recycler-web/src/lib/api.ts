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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body.error ?? `http_${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface HandoverWithLot {
  record: HandoverRecord;
  lot: Lot | undefined;
}

export const api = {
  health: () => request<{ status: string; dataSource: string }>('/health'),

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
    body: {
      recyclerId: string;
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

  reject: (handoverRef: string, recyclerId: string, reason: string) =>
    request<HandoverRecord>(`/v1/handovers/${handoverRef}/reject`, {
      method: 'POST',
      body: JSON.stringify({ recyclerId, reason }),
    }),

  setDownstream: (handoverRef: string, recyclerId: string, status: string) =>
    request<HandoverRecord>(`/v1/handovers/${handoverRef}/downstream`, {
      method: 'POST',
      body: JSON.stringify({ recyclerId, status }),
    }),

  priceBoard: (district: string) =>
    request<{ entries: Array<{ subCategoryId: string; labelKey: string; glyph: string; fairPriceInr: number; unit: string; basis: string }> }>(
      `/v1/prices/board?district=${encodeURIComponent(district)}&lang=en`,
    ),
};

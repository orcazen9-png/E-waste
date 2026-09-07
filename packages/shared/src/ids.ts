import { sha256Hex } from './hash.ts';

/** Crockford base32 without I, L, O, U - safe to read aloud over a phone call. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.getRandomValues) return g.crypto.getRandomValues(out);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 32];
  return s;
}

/**
 * Sortable, offline-generatable id: 8 chars of timestamp + 6 random.
 * Two phones with no connectivity will not collide in practice.
 */
export function newId(prefix: string): string {
  const ts = Date.now();
  let t = '';
  let n = ts;
  for (let i = 0; i < 8; i++) {
    t = ALPHABET[n % 32] + t;
    n = Math.floor(n / 32);
  }
  return `${prefix}_${t}${encode(randomBytes(6))}`;
}

export const newLotId = () => newId('LOT');
export const newMaterialId = () => newId('MAT');
export const newTransactionId = () => newId('TXN');
export const newCollectorId = () => newId('COL');
export const newPriceId = () => newId('PRC');

/** Handover references are spoken aloud and typed by hand, so they stay short. */
export function newHandoverRef(): string {
  return `HO-${encode(randomBytes(4))}-${encode(randomBytes(4))}`;
}

/** 6-digit fallback code, derived from the reference so it never needs storing separately. */
export function verificationCodeFor(handoverRef: string, secret: string): string {
  const digest = sha256Hex(`${secret}:${handoverRef}`);
  return (parseInt(digest.slice(0, 8), 16) % 1_000_000).toString().padStart(6, '0');
}

/** Deterministic train/val/test assignment, stable as the dataset grows. */
export function splitForKey(key: string): 'train' | 'val' | 'test' {
  const bucket = parseInt(sha256Hex(key).slice(0, 4), 16) % 100;
  if (bucket < 70) return 'train';
  if (bucket < 85) return 'val';
  return 'test';
}

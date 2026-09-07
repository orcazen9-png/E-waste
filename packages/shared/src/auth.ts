import { hmacSha256Hex } from './hash.ts';

/**
 * Access tokens.
 *
 * A compact signed token rather than a JWT library: the same code has to run
 * on an entry-level phone, in a browser and on the server, and this is ~60
 * lines against a dependency with a long history of algorithm-confusion bugs.
 * There is exactly one algorithm here, and `none` is not a thing it can parse.
 *
 * Format: `v1.<base64url(payload)>.<hmac-sha256>`
 */

export type Principal = 'collector' | 'recycler';

export interface TokenPayload {
  /** Who this is: a collector id or a recycler id. */
  sub: string;
  kind: Principal;
  /** Which device the token was issued to. Lets a single phone be revoked. */
  did?: string;
  /** Issued at / expires at, epoch seconds. */
  iat: number;
  exp: number;
}

const PREFIX = 'v1';

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function signToken(payload: TokenPayload, secret: string): string {
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${PREFIX}.${body}.${hmacSha256Hex(secret, `${PREFIX}.${body}`)}`;
}

export type TokenFailure =
  | 'malformed'
  | 'bad_version'
  | 'bad_signature'
  | 'expired'
  | 'bad_payload';

export type TokenResult =
  | { valid: true; payload: TokenPayload }
  | { valid: false; reason: TokenFailure };

export function verifyToken(token: string, secret: string, now = new Date()): TokenResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  const [version, body, signature] = parts as [string, string, string];
  if (version !== PREFIX) return { valid: false, reason: 'bad_version' };

  // Signature is checked before the payload is parsed or trusted for anything.
  const expected = hmacSha256Hex(secret, `${version}.${body}`);
  if (!constantTimeEqual(expected, signature)) return { valid: false, reason: 'bad_signature' };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as TokenPayload;
  } catch {
    return { valid: false, reason: 'bad_payload' };
  }
  if (typeof payload.sub !== 'string' || (payload.kind !== 'collector' && payload.kind !== 'recycler')) {
    return { valid: false, reason: 'bad_payload' };
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, payload };
}

/**
 * Length-independent comparison. Both inputs here are fixed-length hex
 * digests, so this is belt and braces rather than strictly necessary - but a
 * comparison that returns early on the first differing character is the kind
 * of thing that quietly becomes exploitable when someone changes the format.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** Collector tokens are long-lived: the phone is often offline for days. */
export const COLLECTOR_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
/** Recycler sessions are a shared desk in a yard, so they expire in a shift. */
export const RECYCLER_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export function buildToken(
  kind: Principal,
  sub: string,
  secret: string,
  options: { deviceId?: string; now?: Date; ttlSeconds?: number } = {},
): { token: string; expiresAt: string } {
  const now = options.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const ttl =
    options.ttlSeconds ??
    (kind === 'collector' ? COLLECTOR_TOKEN_TTL_SECONDS : RECYCLER_TOKEN_TTL_SECONDS);
  const payload: TokenPayload = {
    sub,
    kind,
    did: options.deviceId,
    iat: issuedAt,
    exp: issuedAt + ttl,
  };
  return {
    token: signToken(payload, secret),
    expiresAt: new Date((issuedAt + ttl) * 1000).toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* One-time passcodes                                                  */
/* ------------------------------------------------------------------ */

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;

/**
 * The code is stored only as a hash, keyed to the phone hash so a stolen
 * challenge row cannot be replayed against a different number.
 */
export function hashOtp(phoneHash: string, code: string, secret: string): string {
  return hmacSha256Hex(secret, `otp:${phoneHash}:${code}`);
}

/** Normalises to the last 10 digits, the way Indian numbers are actually typed. */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

export function isPlausibleIndianMobile(phone: string): boolean {
  const digits = normalisePhone(phone);
  return /^[6-9]\d{9}$/.test(digits);
}

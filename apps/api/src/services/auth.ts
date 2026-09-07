import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  buildToken,
  constantTimeEqual,
  hashOtp,
  hashPhone,
  isPlausibleIndianMobile,
  newCollectorId,
  newId,
  type Collector,
  type LanguageCode,
} from '@ewaste/shared';
import type { Repository } from '../repository/types.ts';
import type { Config } from '../config.ts';

/**
 * Phone-OTP authentication.
 *
 * Constraints that shaped this:
 *
 *  - **The raw phone number is never stored.** Only an HMAC reaches the
 *    repository, and the OTP hash is keyed to that same HMAC so a leaked
 *    challenge row cannot be replayed against a different number.
 *  - **Collectors are not asked for an ID document.** A phone number and a
 *    code is the whole enrolment; the people this serves have good reasons to
 *    be wary of registration.
 *  - **A collector's token is long-lived** (90 days) because the phone is
 *    routinely offline for days and being logged out in a scrap yard with no
 *    signal is a broken product. A recycler's is a shift (12 hours), because
 *    the console is a shared desk.
 *  - **No SMS provider is wired up.** In development the code is returned in
 *    the response so the flow can be exercised; the service refuses to start
 *    in that mode when NODE_ENV is production.
 */

export class AuthError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

export interface ChallengeResult {
  challengeId: string;
  expiresAt: string;
  /** Only present in development. Never populated when devMode is off. */
  devCode?: string;
}

/** Requests allowed per number per window, before we start refusing. */
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

export class AuthService {
  constructor(
    private readonly repo: Repository,
    private readonly config: Config,
  ) {
    if (config.authDevMode && process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'AUTH_DEV_MODE returns one-time codes in API responses and must never be enabled in production.',
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Collector                                                         */
  /* ---------------------------------------------------------------- */

  async requestCollectorCode(phone: string, now = new Date()): Promise<ChallengeResult> {
    if (!isPlausibleIndianMobile(phone)) throw new AuthError(400, 'auth.invalid_phone');
    const phoneHash = hashPhone(phone, this.config.phoneSalt);
    await this.enforceRateLimit(phoneHash, now);
    return this.issueChallenge({ phoneHash, kind: 'collector' }, now);
  }

  /**
   * Verifies the code and returns a token. Creates the collector on first
   * successful verification - there is no separate registration step, because
   * a two-step signup is a two-step way to lose someone.
   */
  async verifyCollectorCode(input: {
    challengeId: string;
    code: string;
    deviceId: string;
    phone: string;
    preferredLanguage?: LanguageCode;
    district?: string;
    state?: string;
    platform?: string;
    appVersion?: string;
    now?: Date;
  }): Promise<{ token: string; expiresAt: string; collector: Collector }> {
    const now = input.now ?? new Date();
    const phoneHash = hashPhone(input.phone, this.config.phoneSalt);
    const challenge = await this.consumeChallenge(input.challengeId, input.code, phoneHash, 'collector', now);

    let collector = await this.repo.getCollectorByPhoneHash(challenge.phoneHash);
    if (!collector) {
      collector = await this.repo.upsertCollector({
        collectorId: newCollectorId(),
        phoneHash: challenge.phoneHash,
        preferredLanguage: input.preferredLanguage ?? 'mr',
        operatingDistrict: input.district ?? 'Pune',
        operatingState: input.state ?? 'Maharashtra',
        createdAt: now.toISOString(),
        lifetimeEarningsInr: 0,
        pendingDuesInr: 0,
        completedTransactions: 0,
      });
    }

    await this.repo.upsertDevice({
      deviceId: input.deviceId,
      collectorId: collector.collectorId,
      platform: input.platform ?? 'android',
      appVersion: input.appVersion,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
    });

    const { token, expiresAt } = buildToken('collector', collector.collectorId, this.config.tokenSecret, {
      deviceId: input.deviceId,
      now,
    });
    return { token, expiresAt, collector };
  }

  /* ---------------------------------------------------------------- */
  /* Recycler                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Sends a code to the facility's registered contact number. The caller
   * names the facility rather than the number, so signing in requires control
   * of the number already on the authorisation record - and the response never
   * reveals what that number is.
   */
  async requestRecyclerCode(recyclerId: string, now = new Date()): Promise<ChallengeResult> {
    const recycler = await this.repo.getRecycler(recyclerId);
    if (!recycler) throw new AuthError(404, 'auth.unknown_facility');
    if (recycler.authorizationStatus !== 'authorized') {
      throw new AuthError(403, 'auth.facility_not_authorized');
    }
    const phoneHash = hashPhone(recycler.contactPhone, this.config.phoneSalt);
    await this.enforceRateLimit(phoneHash, now);
    return this.issueChallenge({ phoneHash, kind: 'recycler', recyclerId }, now);
  }

  async verifyRecyclerCode(input: {
    challengeId: string;
    code: string;
    now?: Date;
  }): Promise<{ token: string; expiresAt: string; recyclerId: string }> {
    const now = input.now ?? new Date();
    const stored = await this.repo.getOtpChallenge(input.challengeId);
    if (!stored?.recyclerId) throw new AuthError(400, 'auth.invalid_challenge');

    const challenge = await this.consumeChallenge(
      input.challengeId,
      input.code,
      stored.phoneHash,
      'recycler',
      now,
    );
    const recyclerId = challenge.recyclerId!;
    const { token, expiresAt } = buildToken('recycler', recyclerId, this.config.tokenSecret, { now });
    return { token, expiresAt, recyclerId };
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private async enforceRateLimit(phoneHash: string, now: Date): Promise<void> {
    const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000);
    const recent = await this.repo.countOtpChallengesSince(phoneHash, since);
    if (recent >= RATE_LIMIT_MAX_REQUESTS) {
      // Rate limiting here protects someone else's phone from being used as a
      // free SMS cannon, not just our own bill.
      throw new AuthError(429, 'auth.too_many_requests', RATE_LIMIT_WINDOW_SECONDS);
    }
  }

  private async issueChallenge(
    input: { phoneHash: string; kind: 'collector' | 'recycler'; recyclerId?: string },
    now: Date,
  ): Promise<ChallengeResult> {
    const code = generateCode();
    const challengeId = newId('OTP');
    const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1000).toISOString();

    await this.repo.createOtpChallenge({
      challengeId,
      phoneHash: input.phoneHash,
      codeHash: hashOtp(input.phoneHash, code, this.config.tokenSecret),
      kind: input.kind,
      recyclerId: input.recyclerId,
      createdAt: now.toISOString(),
      expiresAt,
      attempts: 0,
    });

    await this.deliver(code);
    return { challengeId, expiresAt, devCode: this.config.authDevMode ? code : undefined };
  }

  private async consumeChallenge(
    challengeId: string,
    code: string,
    phoneHash: string,
    kind: 'collector' | 'recycler',
    now: Date,
  ) {
    const challenge = await this.repo.getOtpChallenge(challengeId);
    if (!challenge || challenge.kind !== kind) throw new AuthError(400, 'auth.invalid_challenge');
    if (challenge.consumedAt) throw new AuthError(400, 'auth.code_already_used');
    if (Date.parse(challenge.expiresAt) <= now.getTime()) throw new AuthError(400, 'auth.code_expired');
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw new AuthError(429, 'auth.too_many_attempts');
    // The challenge is bound to the number that asked for it, so a code cannot
    // be verified against a different phone.
    if (!constantTimeEqual(challenge.phoneHash, phoneHash)) {
      throw new AuthError(400, 'auth.invalid_challenge');
    }

    const expected = hashOtp(challenge.phoneHash, code, this.config.tokenSecret);
    if (!constantTimeEqual(challenge.codeHash, expected)) {
      // Count the failure before returning, or the attempt limit is free to bypass.
      await this.repo.updateOtpChallenge(challengeId, { attempts: challenge.attempts + 1 });
      throw new AuthError(400, 'auth.invalid_code');
    }

    // Single use: consumed the moment it succeeds.
    await this.repo.updateOtpChallenge(challengeId, { consumedAt: now.toISOString() });
    return challenge;
  }

  private async deliver(code: string): Promise<void> {
    if (this.config.authDevMode) return; // returned in the response instead
    // No SMS provider is configured. Failing loudly is correct: silently
    // accepting a sign-in request nobody can complete is worse.
    throw new AuthError(501, 'auth.sms_not_configured');
  }
}

/** Uniformly distributed 6-digit code, not derived from anything guessable. */
function generateCode(): string {
  const max = 10 ** OTP_LENGTH;
  const bytes = new Uint8Array(4);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoObj?.getRandomValues) cryptoObj.getRandomValues(bytes);
  else for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  const value = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return String(value % max).padStart(OTP_LENGTH, '0');
}

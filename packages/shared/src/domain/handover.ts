import type { GeoPoint, HandoverRecord, PlaceRef } from '../types.ts';
import { hmacSha256Hex } from '../hash.ts';
import { newHandoverRef, verificationCodeFor } from '../ids.ts';

/**
 * The handover record is the artefact that makes a collector's material
 * traceable, and it is the one thing that must work with no network at all.
 * The phone builds it, signs it with a device key, and shows a QR code; the
 * recycler scans it (also offline) and counter-signs. Both halves sync later
 * and the server checks that the digest still matches.
 */

export interface HandoverDraft {
  lotId: string;
  collectorId: string;
  recyclerId: string;
  declaredWeightKg: number;
  weighedWeightKg: number;
  photoHashes: string[];
  handoverPoint: GeoPoint;
  handoverPlace: PlaceRef;
  createdAt: string;
}

/**
 * Canonical serialisation of the immutable fields. Field order is fixed and
 * numbers are rounded, so the same draft digests identically on a phone, in a
 * browser and on the server.
 */
export function canonicalPayload(draft: HandoverDraft, handoverRef: string): string {
  return [
    handoverRef,
    draft.lotId,
    draft.collectorId,
    draft.recyclerId,
    draft.declaredWeightKg.toFixed(3),
    draft.weighedWeightKg.toFixed(3),
    [...draft.photoHashes].sort().join(','),
    draft.handoverPoint.lat.toFixed(5),
    draft.handoverPoint.lon.toFixed(5),
    draft.createdAt,
  ].join('|');
}

export function createHandover(
  draft: HandoverDraft,
  deviceSecret: string,
  photoRefs: string[] = [],
): HandoverRecord {
  const handoverRef = newHandoverRef();
  return {
    handoverRef,
    lotId: draft.lotId,
    collectorId: draft.collectorId,
    recyclerId: draft.recyclerId,
    verificationCode: verificationCodeFor(handoverRef, deviceSecret),
    digest: hmacSha256Hex(deviceSecret, canonicalPayload(draft, handoverRef)),
    photoRefs,
    photoHashes: draft.photoHashes,
    weighedWeightKg: draft.weighedWeightKg,
    declaredWeightKg: draft.declaredWeightKg,
    handoverPoint: draft.handoverPoint,
    handoverPlace: draft.handoverPlace,
    createdAt: draft.createdAt,
    confirmationStatus: 'pending',
  };
}

export function verifyHandover(
  record: HandoverRecord,
  deviceSecret: string,
): { valid: boolean; reason?: string } {
  const draft: HandoverDraft = {
    lotId: record.lotId,
    collectorId: record.collectorId,
    recyclerId: record.recyclerId,
    declaredWeightKg: record.declaredWeightKg,
    weighedWeightKg: record.weighedWeightKg,
    photoHashes: record.photoHashes,
    handoverPoint: record.handoverPoint,
    handoverPlace: record.handoverPlace,
    createdAt: record.createdAt,
  };
  const expected = hmacSha256Hex(deviceSecret, canonicalPayload(draft, record.handoverRef));
  if (expected !== record.digest) return { valid: false, reason: 'handover.invalid_digest' };
  if (verificationCodeFor(record.handoverRef, deviceSecret) !== record.verificationCode) {
    return { valid: false, reason: 'handover.invalid_code' };
  }
  return { valid: true };
}

/** Compact payload for the QR code - kept under 300 bytes so it scans on a cracked screen. */
export function handoverQrPayload(record: HandoverRecord): string {
  return JSON.stringify({
    v: 1,
    r: record.handoverRef,
    l: record.lotId,
    c: record.collectorId,
    y: record.recyclerId,
    w: record.weighedWeightKg,
    t: record.createdAt,
    d: record.digest.slice(0, 32),
  });
}

export function parseHandoverQr(payload: string): {
  handoverRef: string;
  lotId: string;
  collectorId: string;
  recyclerId: string;
  weighedWeightKg: number;
  createdAt: string;
  digestPrefix: string;
} {
  const raw = JSON.parse(payload) as Record<string, unknown>;
  if (raw['v'] !== 1) throw new Error('Unsupported handover QR version');
  return {
    handoverRef: String(raw['r']),
    lotId: String(raw['l']),
    collectorId: String(raw['c']),
    recyclerId: String(raw['y']),
    weighedWeightKg: Number(raw['w']),
    createdAt: String(raw['t']),
    digestPrefix: String(raw['d']),
  };
}

import type { GeoPoint } from './types.ts';

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rounds a point to ~1.1 km so collection locations can be published without exposing a route. */
export function coarsen(point: GeoPoint, decimals = 2): GeoPoint {
  const f = 10 ** decimals;
  return { lat: Math.round(point.lat * f) / f, lon: Math.round(point.lon * f) / f };
}

/** Speed in km/h implied by moving between two stamped points; used by anomaly checks. */
export function impliedSpeedKmh(
  from: { point: GeoPoint; at: string },
  to: { point: GeoPoint; at: string },
): number {
  const hours = (Date.parse(to.at) - Date.parse(from.at)) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) return Number.POSITIVE_INFINITY;
  return haversineKm(from.point, to.point) / hours;
}

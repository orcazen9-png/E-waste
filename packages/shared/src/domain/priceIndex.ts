import type { ISODate, ISODateTime, MaterialCategoryId, PricePoint, PriceTrend } from '../types.ts';
import { getSubCategory } from '../taxonomy.ts';

/**
 * A price index is the compact, offline-shippable summary of the price
 * dataset. The raw dataset lives on the server; the phone syncs this index
 * (a few KB per district) and can then value a lot with no connectivity.
 */

export interface PriceStat {
  subCategoryId: string;
  categoryId: MaterialCategoryId;
  district: string;
  /** Median of recent buying prices - robust to a single outlier quote. */
  medianBuyingInr: number;
  p25Inr: number;
  p75Inr: number;
  marketLowInr: number;
  marketHighInr: number;
  sampleSize: number;
  asOf: ISODateTime;
  /** Daily means, oldest first, for the sparkline and trend maths. */
  series: Array<{ date: ISODate; meanPriceInr: number }>;
}

export interface PriceIndex {
  generatedAt: ISODateTime;
  /** Key: `${subCategoryId}|${district}`, plus `${subCategoryId}|*` national rollups. */
  stats: Record<string, PriceStat>;
}

export const NATIONAL = '*';

export function statKey(subCategoryId: string, district: string): string {
  return `${subCategoryId}|${district}`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

function dayOf(iso: ISODateTime): ISODate {
  return iso.slice(0, 10);
}

interface BuildOptions {
  /** Only consider observations no older than this many days. */
  windowDays?: number;
  now?: Date;
}

export function buildPriceIndex(points: PricePoint[], options: BuildOptions = {}): PriceIndex {
  const windowDays = options.windowDays ?? 90;
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - windowDays * 86_400_000;

  const groups = new Map<string, PricePoint[]>();
  for (const p of points) {
    if (Date.parse(p.observedAt) < cutoff) continue;
    push(groups, statKey(p.subCategoryId, p.district), p);
    push(groups, statKey(p.subCategoryId, NATIONAL), p);
  }

  const stats: Record<string, PriceStat> = {};
  for (const [key, group] of groups) {
    const [subCategoryId, district] = key.split('|') as [string, string];
    // Recent observations dominate: weight the median window to the last 30 days
    // when we have enough of them, otherwise use everything we have.
    const recent = group.filter((p) => Date.parse(p.observedAt) >= now.getTime() - 30 * 86_400_000);
    const used = recent.length >= 5 ? recent : group;
    const prices = used.map((p) => p.buyingPriceInr).sort((a, b) => a - b);

    stats[key] = {
      subCategoryId,
      district,
      categoryId: getSubCategory(subCategoryId).category.id,
      medianBuyingInr: round2(quantile(prices, 0.5)),
      p25Inr: round2(quantile(prices, 0.25)),
      p75Inr: round2(quantile(prices, 0.75)),
      marketLowInr: round2(Math.min(...used.map((p) => p.marketLowInr))),
      marketHighInr: round2(Math.max(...used.map((p) => p.marketHighInr))),
      sampleSize: used.length,
      asOf: used.reduce((max, p) => (p.observedAt > max ? p.observedAt : max), used[0]!.observedAt),
      series: dailyMeans(group),
    };
  }
  return { generatedAt: now.toISOString(), stats };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dailyMeans(points: PricePoint[]): Array<{ date: ISODate; meanPriceInr: number }> {
  const byDay = new Map<ISODate, number[]>();
  for (const p of points) push(byDay, dayOf(p.observedAt), p.buyingPriceInr);
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, values]) => ({
      date,
      meanPriceInr: round2(values.reduce((s, v) => s + v, 0) / values.length),
    }));
}

export function lookupStat(index: PriceIndex, subCategoryId: string, district: string): PriceStat | undefined {
  return (
    index.stats[statKey(subCategoryId, district)] ?? index.stats[statKey(subCategoryId, NATIONAL)]
  );
}

/**
 * Trend over the requested window: mean of the most recent half compared with
 * the half before it. Under 3% either way is reported as flat, because a
 * collector should not be told "prices are up" on noise.
 */
export function computeTrend(stat: PriceStat, window: '7d' | '30d' = '7d'): PriceTrend {
  const days = window === '7d' ? 7 : 30;
  const series = stat.series.slice(-days * 2);
  const half = Math.floor(series.length / 2);
  const older = series.slice(0, half);
  const newer = series.slice(half);
  const mean = (xs: Array<{ meanPriceInr: number }>) =>
    xs.length ? xs.reduce((s, x) => s + x.meanPriceInr, 0) / xs.length : 0;
  const before = mean(older);
  const after = mean(newer);
  const changePct = before > 0 ? round2(((after - before) / before) * 100) : 0;
  const direction = Math.abs(changePct) < 3 ? 'flat' : changePct > 0 ? 'up' : 'down';
  return { direction, changePct, window, series: stat.series.slice(-days) };
}

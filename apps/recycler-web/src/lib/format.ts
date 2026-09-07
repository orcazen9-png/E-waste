import { formatInr, t, translateCoded, type TranslationKey } from '@ewaste/shared';

export const inr = (n: number) => formatInr(n);

/** The console runs in English; collectors see the same strings in mr/hi. */
export const label = (key: string) => t('en', key as TranslationKey);

export const reason = (coded: string) => translateCoded('en', coded);

export function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

import type { LanguageCode } from '../types.ts';
import { en, type TranslationKey } from './en.ts';
import { mr } from './mr.ts';
import { hi } from './hi.ts';

export { en, mr, hi };
export type { TranslationKey };

export const BUNDLES: Record<LanguageCode, Record<TranslationKey, string>> = { en, mr, hi };

export const LANGUAGES: Array<{ code: LanguageCode; nativeName: string; glyph: string }> = [
  { code: 'mr', nativeName: 'मराठी', glyph: '🟠' },
  { code: 'hi', nativeName: 'हिंदी', glyph: '🟢' },
  { code: 'en', nativeName: 'English', glyph: '🔵' },
];

export type Interpolations = Record<string, string | number>;

/**
 * Translate a key. Missing strings fall back to English rather than showing a
 * raw key: a collector should never see `lot.enter_weight` on screen.
 */
export function t(locale: LanguageCode, key: TranslationKey, values?: Interpolations): string {
  const template = BUNDLES[locale]?.[key] ?? en[key] ?? key;
  return interpolate(template, values);
}

function interpolate(template: string, values?: Interpolations): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/**
 * Domain services emit coded reasons like `valuation.reason.local:12:Pune`
 * (key, then positional arguments) so they stay language-free. This expands
 * one into a sentence, translating any argument that is itself a known key.
 */
export function translateCoded(locale: LanguageCode, coded: string): string {
  const [key, ...args] = coded.split(':');
  const bundle = BUNDLES[locale] ?? en;
  const template = bundle[key as TranslationKey] ?? en[key as TranslationKey];
  if (!template) return coded;

  const resolved = args.map((arg) => {
    const nested = `condition.${arg}` as TranslationKey;
    if (nested in bundle) return bundle[nested];
    return arg;
  });
  return template.replace(/\{(\d+)\}/g, (match, i: string) => resolved[Number(i)] ?? match);
}

/** Indian digit grouping (1,23,456) with a rupee sign. Latin digits throughout: the trade reads these. */
export function formatInr(amount: number, options: { decimals?: boolean } = {}): string {
  const rounded = options.decimals ? amount : Math.round(amount);
  return `₹${rounded.toLocaleString('en-IN', {
    minimumFractionDigits: options.decimals ? 2 : 0,
    maximumFractionDigits: options.decimals ? 2 : 0,
  })}`;
}

export function formatWeight(locale: LanguageCode, kg: number): string {
  const value = kg >= 10 ? Math.round(kg) : Math.round(kg * 10) / 10;
  return `${value} ${t(locale, 'lot.weight_unit_kg')}`;
}

/**
 * Text handed to the device's text-to-speech engine.
 *
 * Written out in words rather than symbols: "₹340" is read as "three hundred
 * forty" by some engines and skipped entirely by others, so the caller gets a
 * spelled-out string instead.
 */
export function speakPrice(
  locale: LanguageCode,
  amount: number,
  perUnit: 'kg' | 'piece' = 'kg',
): string {
  const rupees = Math.round(amount);
  const unit = perUnit === 'kg' ? t(locale, 'price.per_kg') : t(locale, 'price.per_piece');
  const currencyWord = locale === 'en' ? 'rupees' : 'रुपये';
  return `${rupees} ${currencyWord} ${unit}`;
}

export function speakEstimate(locale: LanguageCode, low: number, high: number): string {
  const currencyWord = locale === 'en' ? 'rupees' : 'रुपये';
  return `${t(locale, 'lot.estimate_title')}. ${Math.round(low)} ${currencyWord} ${
    locale === 'en' ? 'to' : locale === 'mr' ? 'ते' : 'से'
  } ${Math.round(high)} ${currencyWord}.`;
}

/** BCP-47 tag for the platform TTS engine. */
export function ttsLocale(locale: LanguageCode): string {
  return { mr: 'mr-IN', hi: 'hi-IN', en: 'en-IN' }[locale];
}

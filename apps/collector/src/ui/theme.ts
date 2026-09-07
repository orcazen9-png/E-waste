/**
 * Design constraints, written down because they are not stylistic preferences:
 *
 *  - The user may not read. Every action is a picture plus a colour plus,
 *    optionally, a spoken line. Text is a label on something already
 *    identifiable, never the only carrier of meaning.
 *  - The phone is cheap, the screen is scratched, the sun is bright. High
 *    contrast, large type, no thin greys for anything that matters.
 *  - Hands are dirty and often gloved. Touch targets are at least 56dp, and
 *    destructive actions are never adjacent to common ones.
 */
export const colors = {
  bg: '#FFFFFF',
  surface: '#F4F6F8',
  border: '#D5DBE1',
  text: '#111417',
  textMuted: '#5A6570',
  primary: '#0B6B4F',
  primaryText: '#FFFFFF',
  money: '#0B6B4F',
  danger: '#A4262C',
  dangerBg: '#FDECEE',
  warn: '#8A5A00',
  warnBg: '#FFF4D6',
  ok: '#0B6B4F',
  okBg: '#E6F3EE',
  offline: '#5A6570',
} as const;

/** Category colours, mirrored from the shared taxonomy's colour tokens. */
export const categoryColors: Record<string, string> = {
  slate: '#4A5568',
  cyan: '#0E7490',
  emerald: '#047857',
  amber: '#B45309',
  rose: '#9F1239',
  violet: '#6D28D9',
  teal: '#0F766E',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 18, xl: 26, xxl: 36 } as const;

export const type = {
  /** The rupee amount on the estimate screen. Readable at arm's length. */
  hero: { fontSize: 46, fontWeight: '800' as const },
  title: { fontSize: 24, fontWeight: '700' as const },
  heading: { fontSize: 19, fontWeight: '700' as const },
  body: { fontSize: 17, fontWeight: '500' as const },
  small: { fontSize: 14, fontWeight: '500' as const },
} as const;

export const radius = { sm: 8, md: 14, lg: 20 } as const;

/** Minimum touch target. Below this, a gloved thumb misses. */
export const TOUCH_MIN = 56;

import type { MaterialCategoryId } from './types.ts';

/**
 * Safety guidance. Every card is a picture plus a spoken line: no card depends
 * on reading. Cards surface automatically when a matching category is added to
 * a lot, not only in a menu nobody opens.
 */

export interface SafetyCard {
  key: string;
  glyph: string;
  /** 'stop' cards are the practices the platform exists to displace. */
  kind: 'stop' | 'do' | 'store';
  categories: MaterialCategoryId[];
  /** i18n keys; the audio file per language is named after the key. */
  titleKey: string;
  bodyKey: string;
  audioKey: string;
}

export const SAFETY_CARDS: SafetyCard[] = [
  {
    key: 'safety.no_burning',
    glyph: '🔥',
    kind: 'stop',
    categories: ['cable', 'pcb', 'mixed_plastic'],
    titleKey: 'safety.no_burning.title',
    bodyKey: 'safety.no_burning.body',
    audioKey: 'safety.no_burning',
  },
  {
    key: 'safety.strip_dont_burn',
    glyph: '✂️',
    kind: 'do',
    categories: ['cable'],
    titleKey: 'safety.strip_dont_burn.title',
    bodyKey: 'safety.strip_dont_burn.body',
    audioKey: 'safety.strip_dont_burn',
  },
  {
    key: 'safety.dioxin',
    glyph: '🫁',
    kind: 'stop',
    categories: ['cable', 'mixed_plastic'],
    titleKey: 'safety.dioxin.title',
    bodyKey: 'safety.dioxin.body',
    audioKey: 'safety.dioxin',
  },
  {
    key: 'safety.no_acid',
    glyph: '🧪',
    kind: 'stop',
    categories: ['pcb'],
    titleKey: 'safety.no_acid.title',
    bodyKey: 'safety.no_acid.body',
    audioKey: 'safety.no_acid',
  },
  {
    key: 'safety.no_desolder_home',
    glyph: '🔥',
    kind: 'stop',
    categories: ['pcb'],
    titleKey: 'safety.no_desolder_home.title',
    bodyKey: 'safety.no_desolder_home.body',
    audioKey: 'safety.no_desolder_home',
  },
  {
    key: 'safety.battery_no_puncture',
    glyph: '🔋',
    kind: 'stop',
    categories: ['battery'],
    titleKey: 'safety.battery_no_puncture.title',
    bodyKey: 'safety.battery_no_puncture.body',
    audioKey: 'safety.battery_no_puncture',
  },
  {
    key: 'safety.battery_fire',
    glyph: '🧯',
    kind: 'do',
    categories: ['battery'],
    titleKey: 'safety.battery_fire.title',
    bodyKey: 'safety.battery_fire.body',
    audioKey: 'safety.battery_fire',
  },
  {
    key: 'safety.battery_store_dry',
    glyph: '📦',
    kind: 'store',
    categories: ['battery'],
    titleKey: 'safety.battery_store_dry.title',
    bodyKey: 'safety.battery_store_dry.body',
    audioKey: 'safety.battery_store_dry',
  },
  {
    key: 'safety.crt_implosion',
    glyph: '💥',
    kind: 'stop',
    categories: ['crt'],
    titleKey: 'safety.crt_implosion.title',
    bodyKey: 'safety.crt_implosion.body',
    audioKey: 'safety.crt_implosion',
  },
  {
    key: 'safety.crt_lead_dust',
    glyph: '😷',
    kind: 'do',
    categories: ['crt'],
    titleKey: 'safety.crt_lead_dust.title',
    bodyKey: 'safety.crt_lead_dust.body',
    audioKey: 'safety.crt_lead_dust',
  },
  {
    key: 'safety.lcd_mercury_lamp',
    glyph: '💡',
    kind: 'stop',
    categories: ['lcd_panel'],
    titleKey: 'safety.lcd_mercury_lamp.title',
    bodyKey: 'safety.lcd_mercury_lamp.body',
    audioKey: 'safety.lcd_mercury_lamp',
  },
  {
    key: 'safety.no_break',
    glyph: '🚫',
    kind: 'stop',
    categories: ['crt', 'lcd_panel'],
    titleKey: 'safety.no_break.title',
    bodyKey: 'safety.no_break.body',
    audioKey: 'safety.no_break',
  },
  {
    key: 'safety.gloves',
    glyph: '🧤',
    kind: 'do',
    categories: ['crt', 'lcd_panel', 'pcb', 'battery'],
    titleKey: 'safety.gloves.title',
    bodyKey: 'safety.gloves.body',
    audioKey: 'safety.gloves',
  },
  {
    key: 'safety.magnet_pinch',
    glyph: '🧲',
    kind: 'do',
    categories: ['motor_magnet'],
    titleKey: 'safety.magnet_pinch.title',
    bodyKey: 'safety.magnet_pinch.body',
    audioKey: 'safety.magnet_pinch',
  },
  {
    key: 'safety.sharp_edges',
    glyph: '🩹',
    kind: 'do',
    categories: ['motor_magnet', 'mixed_plastic'],
    titleKey: 'safety.sharp_edges.title',
    bodyKey: 'safety.sharp_edges.body',
    audioKey: 'safety.sharp_edges',
  },
  {
    key: 'safety.brominated_plastic',
    glyph: '☠️',
    kind: 'stop',
    categories: ['mixed_plastic'],
    titleKey: 'safety.brominated_plastic.title',
    bodyKey: 'safety.brominated_plastic.body',
    audioKey: 'safety.brominated_plastic',
  },
];

export function safetyCardsFor(categories: MaterialCategoryId[]): SafetyCard[] {
  const wanted = new Set(categories);
  return SAFETY_CARDS.filter((card) => card.categories.some((c) => wanted.has(c)));
}

export function safetyCard(key: string): SafetyCard | undefined {
  return SAFETY_CARDS.find((c) => c.key === key);
}

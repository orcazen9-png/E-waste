import type { MaterialCategoryId, Unit } from './types.ts';

/**
 * The material taxonomy is the backbone of the whole product: it drives the
 * pictorial category picker, the price board, the valuation rules, the
 * recycler rate cards and the training labels. It is defined once, here.
 */

export interface SubCategory {
  id: string;
  /** Translation key; the label itself lives in i18n. */
  labelKey: string;
  /** Emoji stand-in for the illustration shipped with the app. */
  glyph: string;
  /** Reference band in INR per unit, national, used as a prior when local price data is thin. */
  baseLowInr: number;
  baseHighInr: number;
  unit: Unit;
  /** Typical mass of one piece, used to sanity-check declared weights. */
  typicalPieceWeightKg?: number;
}

export interface MaterialCategory {
  id: MaterialCategoryId;
  labelKey: string;
  glyph: string;
  /** Colour token used consistently across app and recycler console. */
  colorToken: string;
  hazardLevel: 'low' | 'medium' | 'high';
  /** Safety guidance keys shown when this category is picked. */
  safetyKeys: string[];
  /** Critical materials lost when this is processed informally. */
  criticalMaterials: string[];
  subCategories: SubCategory[];
}

export const MATERIAL_CATEGORIES: MaterialCategory[] = [
  {
    id: 'crt',
    labelKey: 'material.crt',
    glyph: '📺',
    colorToken: 'slate',
    hazardLevel: 'high',
    safetyKeys: ['safety.crt_implosion', 'safety.crt_lead_dust', 'safety.no_break'],
    criticalMaterials: ['leaded glass', 'yttrium', 'europium'],
    subCategories: [
      { id: 'crt_tv', labelKey: 'material.crt.tv', glyph: '📺', baseLowInr: 4, baseHighInr: 9, unit: 'kg', typicalPieceWeightKg: 18 },
      { id: 'crt_monitor', labelKey: 'material.crt.monitor', glyph: '🖥️', baseLowInr: 5, baseHighInr: 11, unit: 'kg', typicalPieceWeightKg: 12 },
      { id: 'crt_yoke', labelKey: 'material.crt.yoke', glyph: '🧲', baseLowInr: 55, baseHighInr: 95, unit: 'kg', typicalPieceWeightKg: 0.6 },
    ],
  },
  {
    id: 'lcd_panel',
    labelKey: 'material.lcd',
    glyph: '🖥️',
    colorToken: 'cyan',
    hazardLevel: 'high',
    safetyKeys: ['safety.lcd_mercury_lamp', 'safety.no_break', 'safety.gloves'],
    criticalMaterials: ['indium', 'mercury (backlight)', 'rare-earth phosphors'],
    subCategories: [
      { id: 'lcd_tv_panel', labelKey: 'material.lcd.tv', glyph: '📺', baseLowInr: 14, baseHighInr: 28, unit: 'kg', typicalPieceWeightKg: 8 },
      { id: 'lcd_monitor_panel', labelKey: 'material.lcd.monitor', glyph: '🖥️', baseLowInr: 16, baseHighInr: 32, unit: 'kg', typicalPieceWeightKg: 3.5 },
      { id: 'lcd_laptop_panel', labelKey: 'material.lcd.laptop', glyph: '💻', baseLowInr: 30, baseHighInr: 70, unit: 'kg', typicalPieceWeightKg: 0.5 },
      { id: 'led_backlight_strip', labelKey: 'material.lcd.backlight', glyph: '💡', baseLowInr: 60, baseHighInr: 130, unit: 'kg' },
    ],
  },
  {
    id: 'pcb',
    labelKey: 'material.pcb',
    glyph: '🔲',
    colorToken: 'emerald',
    hazardLevel: 'high',
    safetyKeys: ['safety.no_acid', 'safety.no_burning', 'safety.no_desolder_home'],
    criticalMaterials: ['gold', 'palladium', 'tantalum', 'gallium', 'copper'],
    subCategories: [
      { id: 'pcb_motherboard', labelKey: 'material.pcb.motherboard', glyph: '🔲', baseLowInr: 210, baseHighInr: 420, unit: 'kg', typicalPieceWeightKg: 0.8 },
      { id: 'pcb_ram_gold', labelKey: 'material.pcb.ram', glyph: '💾', baseLowInr: 900, baseHighInr: 2200, unit: 'kg', typicalPieceWeightKg: 0.03 },
      { id: 'pcb_cpu_processor', labelKey: 'material.pcb.cpu', glyph: '🧠', baseLowInr: 1800, baseHighInr: 6500, unit: 'kg', typicalPieceWeightKg: 0.02 },
      { id: 'pcb_mobile', labelKey: 'material.pcb.mobile', glyph: '📱', baseLowInr: 700, baseHighInr: 1600, unit: 'kg', typicalPieceWeightKg: 0.02 },
      { id: 'pcb_tv_low_grade', labelKey: 'material.pcb.tv', glyph: '📟', baseLowInr: 70, baseHighInr: 160, unit: 'kg', typicalPieceWeightKg: 0.5 },
      { id: 'pcb_power_supply', labelKey: 'material.pcb.smps', glyph: '🔌', baseLowInr: 90, baseHighInr: 190, unit: 'kg', typicalPieceWeightKg: 1.2 },
    ],
  },
  {
    id: 'cable',
    labelKey: 'material.cable',
    glyph: '🔌',
    colorToken: 'amber',
    hazardLevel: 'high',
    safetyKeys: ['safety.no_burning', 'safety.strip_dont_burn', 'safety.dioxin'],
    criticalMaterials: ['copper', 'aluminium', 'PVC (recoverable)'],
    subCategories: [
      { id: 'cable_copper_house', labelKey: 'material.cable.house', glyph: '🧵', baseLowInr: 320, baseHighInr: 480, unit: 'kg' },
      { id: 'cable_data_thin', labelKey: 'material.cable.data', glyph: '🔗', baseLowInr: 90, baseHighInr: 180, unit: 'kg' },
      { id: 'cable_aluminium', labelKey: 'material.cable.aluminium', glyph: '⚙️', baseLowInr: 110, baseHighInr: 175, unit: 'kg' },
      { id: 'cable_mixed_scrap', labelKey: 'material.cable.mixed', glyph: '🪢', baseLowInr: 130, baseHighInr: 260, unit: 'kg' },
    ],
  },
  {
    id: 'battery',
    labelKey: 'material.battery',
    glyph: '🔋',
    colorToken: 'rose',
    hazardLevel: 'high',
    safetyKeys: ['safety.battery_no_puncture', 'safety.battery_fire', 'safety.battery_store_dry'],
    criticalMaterials: ['lithium', 'cobalt', 'nickel', 'graphite'],
    subCategories: [
      { id: 'battery_li_ion_mobile', labelKey: 'material.battery.mobile', glyph: '📱', baseLowInr: 120, baseHighInr: 260, unit: 'kg', typicalPieceWeightKg: 0.04 },
      { id: 'battery_li_ion_laptop', labelKey: 'material.battery.laptop', glyph: '💻', baseLowInr: 140, baseHighInr: 300, unit: 'kg', typicalPieceWeightKg: 0.35 },
      { id: 'battery_lead_acid_ups', labelKey: 'material.battery.ups', glyph: '🔋', baseLowInr: 75, baseHighInr: 105, unit: 'kg', typicalPieceWeightKg: 7 },
      { id: 'battery_button_cell', labelKey: 'material.battery.button', glyph: '⚪', baseLowInr: 60, baseHighInr: 140, unit: 'kg' },
    ],
  },
  {
    id: 'motor_magnet',
    labelKey: 'material.motor',
    glyph: '🧲',
    colorToken: 'violet',
    hazardLevel: 'medium',
    safetyKeys: ['safety.magnet_pinch', 'safety.sharp_edges'],
    criticalMaterials: ['neodymium', 'dysprosium', 'copper', 'steel'],
    subCategories: [
      { id: 'motor_hdd_assembly', labelKey: 'material.motor.hdd', glyph: '💽', baseLowInr: 180, baseHighInr: 340, unit: 'kg', typicalPieceWeightKg: 0.55 },
      { id: 'motor_small_appliance', labelKey: 'material.motor.small', glyph: '🌀', baseLowInr: 95, baseHighInr: 165, unit: 'kg', typicalPieceWeightKg: 1.5 },
      { id: 'motor_speaker_magnet', labelKey: 'material.motor.speaker', glyph: '🔊', baseLowInr: 45, baseHighInr: 95, unit: 'kg', typicalPieceWeightKg: 0.4 },
      { id: 'motor_fan_ac', labelKey: 'material.motor.fan', glyph: '💨', baseLowInr: 110, baseHighInr: 190, unit: 'kg', typicalPieceWeightKg: 3 },
    ],
  },
  {
    id: 'mixed_plastic',
    labelKey: 'material.plastic',
    glyph: '🧴',
    colorToken: 'teal',
    hazardLevel: 'medium',
    safetyKeys: ['safety.no_burning', 'safety.brominated_plastic'],
    criticalMaterials: ['ABS', 'HIPS', 'polycarbonate'],
    subCategories: [
      { id: 'plastic_abs_casing', labelKey: 'material.plastic.abs', glyph: '⬜', baseLowInr: 22, baseHighInr: 42, unit: 'kg' },
      { id: 'plastic_hips_tv', labelKey: 'material.plastic.hips', glyph: '📦', baseLowInr: 16, baseHighInr: 32, unit: 'kg' },
      { id: 'plastic_mixed_dirty', labelKey: 'material.plastic.mixed', glyph: '🗑️', baseLowInr: 6, baseHighInr: 16, unit: 'kg' },
    ],
  },
];

const CATEGORY_INDEX = new Map(MATERIAL_CATEGORIES.map((c) => [c.id, c]));
const SUB_INDEX = new Map<string, { category: MaterialCategory; sub: SubCategory }>();
for (const category of MATERIAL_CATEGORIES) {
  for (const sub of category.subCategories) SUB_INDEX.set(sub.id, { category, sub });
}

export function getCategory(id: MaterialCategoryId): MaterialCategory {
  const found = CATEGORY_INDEX.get(id);
  if (!found) throw new Error(`Unknown material category: ${id}`);
  return found;
}

export function findSubCategory(id: string): { category: MaterialCategory; sub: SubCategory } | undefined {
  return SUB_INDEX.get(id);
}

export function getSubCategory(id: string): { category: MaterialCategory; sub: SubCategory } {
  const found = SUB_INDEX.get(id);
  if (!found) throw new Error(`Unknown material sub-category: ${id}`);
  return found;
}

export const ALL_SUB_CATEGORY_IDS: string[] = [...SUB_INDEX.keys()];

/** Rate-card key convention shared by recyclers, price points and valuation. */
export function rateKey(categoryId: MaterialCategoryId, subCategoryId?: string): string {
  return `${categoryId}:${subCategoryId ?? '*'}`;
}

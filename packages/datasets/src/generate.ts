import {
  MATERIAL_CATEGORIES,
  rateKey,
  buildPriceIndex,
  RuleBasedValuer,
  RuleBasedAnomalyDetector,
  createHandover,
  splitForKey,
  ID_ALPHABET,
  type Collector,
  type HandoverRecord,
  type Lot,
  type MaterialCategoryId,
  type MaterialCondition,
  type MaterialItem,
  type PricePoint,
  type Recycler,
  type SourceType,
  type TrainingSample,
  type Transaction,
} from '@ewaste/shared';
import { DISTRICTS, placeIn, type District } from './places.ts';
import { Rng } from './random.ts';

/**
 * Seed dataset generator.
 *
 * Everything here is SYNTHETIC. It exists so the app, the API and the models
 * have realistically-shaped data on day one, and so the pipeline that will
 * later consume real field data is exercised end to end. Facility names carry
 * a "[Demo]" prefix and authorisation numbers a "SYN/" prefix so a synthetic
 * record can never be mistaken for a real authorised recycler.
 *
 * Realism comes from three modelled effects rather than uniform noise:
 *  - a shared commodity index per metal group, so copper-bearing categories
 *    move together the way they do in the real scrap market;
 *  - a district price factor, so location actually matters to the matcher;
 *  - a deliberate fraction of bad transactions, so the anomaly detector has
 *    something to catch and can be measured against a known ground truth.
 */

export const GENERATOR_VERSION = '1.0.0';
export const DEFAULT_SEED = 20260907;

/** Which commodity drives each sub-category's price. */
const METAL_GROUP: Record<string, 'copper' | 'precious' | 'battery' | 'plastic' | 'glass' | 'rare_earth'> = {
  crt_tv: 'glass',
  crt_monitor: 'glass',
  crt_yoke: 'copper',
  lcd_tv_panel: 'glass',
  lcd_monitor_panel: 'glass',
  lcd_laptop_panel: 'precious',
  led_backlight_strip: 'precious',
  pcb_motherboard: 'precious',
  pcb_ram_gold: 'precious',
  pcb_cpu_processor: 'precious',
  pcb_mobile: 'precious',
  pcb_tv_low_grade: 'precious',
  pcb_power_supply: 'copper',
  cable_copper_house: 'copper',
  cable_data_thin: 'copper',
  cable_aluminium: 'copper',
  cable_mixed_scrap: 'copper',
  battery_li_ion_mobile: 'battery',
  battery_li_ion_laptop: 'battery',
  battery_lead_acid_ups: 'battery',
  battery_button_cell: 'battery',
  motor_hdd_assembly: 'rare_earth',
  motor_small_appliance: 'copper',
  motor_speaker_magnet: 'rare_earth',
  motor_fan_ac: 'copper',
  plastic_abs_casing: 'plastic',
  plastic_hips_tv: 'plastic',
  plastic_mixed_dirty: 'plastic',
};

const ALL_SUBS = MATERIAL_CATEGORIES.flatMap((c) =>
  c.subCategories.map((s) => ({ categoryId: c.id, sub: s })),
);

export interface GenerateOptions {
  seed?: number;
  /** How far back the price history runs. */
  days?: number;
  /** End of the generated window; defaults to a fixed date so output is reproducible. */
  endDate?: Date;
  collectorCount?: number;
  lotCount?: number;
}

export interface GeneratedDataset {
  meta: {
    generatorVersion: string;
    seed: number;
    generatedAt: string;
    windowStart: string;
    windowEnd: string;
    synthetic: true;
  };
  recyclers: Recycler[];
  prices: PricePoint[];
  collectors: Collector[];
  lots: Lot[];
  materials: MaterialItem[];
  transactions: Transaction[];
  handovers: HandoverRecord[];
  trainingSamples: TrainingSample[];
  /** Ground truth for evaluating the anomaly detector. */
  injectedAnomalies: Array<{ transactionId: string; kind: string }>;
}

/* ------------------------------------------------------------------ */
/* Commodity index                                                     */
/* ------------------------------------------------------------------ */

type MetalGroup = (typeof METAL_GROUP)[string];

/** A daily multiplicative random walk per metal group, mean-reverting to 1.0. */
function commodityIndex(rng: Rng, days: number): Record<MetalGroup, number[]> {
  const groups: MetalGroup[] = ['copper', 'precious', 'battery', 'plastic', 'glass', 'rare_earth'];
  // Battery metals and rare earths are the volatile ones; glass barely moves.
  const volatility: Record<MetalGroup, number> = {
    copper: 0.006,
    precious: 0.007,
    battery: 0.011,
    plastic: 0.005,
    glass: 0.002,
    rare_earth: 0.009,
  };
  const out = {} as Record<MetalGroup, number[]>;
  for (const group of groups) {
    const series: number[] = [];
    let value = 1;
    for (let d = 0; d < days; d++) {
      const drift = (1 - value) * 0.02; // pulls back toward the long-run level
      value *= 1 + drift + rng.normal(0, volatility[group]);
      series.push(value);
    }
    out[group] = series;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Recyclers                                                           */
/* ------------------------------------------------------------------ */

const FACILITY_NAMES = [
  'Sahyadri E-Waste Solutions',
  'Deccan Green Recyclers',
  'Konkan Metals Recovery',
  'Godavari E-Resource',
  'Vidarbha Circular Metals',
  'Panchgani Urban Mining',
  'Sinhagad Recyclers',
  'Arihant E-Scrap Processors',
  'Mahalaxmi Resource Recovery',
  'Bhima Valley Recyclers',
  'Krishna E-Waste Works',
  'Tapi Materials Recovery',
  'Purandar Green Metals',
  'Satpura Circular Resources',
  'Warna Urban Mining',
  'Indrayani E-Recyclers',
  'Melghat Materials',
  'Ajanta Resource Systems',
  'Yamuna E-Waste Collective',
  'Cauvery Circular Works',
  'Nilgiri Metals Recovery',
  'Bhima Aggregators Collective',
];

export function generateRecyclers(rng: Rng, now: Date): Recycler[] {
  const recyclers: Recycler[] = [];
  let nameIndex = 0;

  for (const district of DISTRICTS) {
    // Bigger markets support more facilities; every district gets at least two
    // so the matcher always has a choice to rank.
    const count = Math.max(2, Math.round(district.weight * 18));
    for (let i = 0; i < count; i++) {
      const name = FACILITY_NAMES[nameIndex % FACILITY_NAMES.length]!;
      nameIndex++;
      const facilityType = rng.weighted(
        ['recycler', 'dismantler', 'aggregator', 'collection_centre'] as const,
        (t) => ({ recycler: 0.35, dismantler: 0.2, aggregator: 0.35, collection_centre: 0.1 })[t],
      );

      // Aggregators take a broad mix; specialised recyclers do not.
      const accepted = pickAccepted(rng, facilityType);
      const status = rng.weighted(
        ['authorized', 'expired', 'suspended', 'unverified'] as const,
        (s) => ({ authorized: 0.78, expired: 0.09, suspended: 0.03, unverified: 0.1 })[s],
      );
      const validTill = new Date(now);
      validTill.setDate(validTill.getDate() + (status === 'expired' ? -rng.int(20, 400) : rng.int(90, 900)));

      const jitter = rng.float(-0.16, 0.16);
      const ratingCount = rng.int(0, 60);

      recyclers.push({
        recyclerId: `REC_${String(recyclers.length + 1).padStart(3, '0')}`,
        name: `[Demo] ${name}${i > 0 ? ` - ${district.localities[i % district.localities.length]}` : ''}`,
        facilityType,
        place: placeIn(district, rng.pick(district.localities), jitter),
        materialsAccepted: accepted,
        authorizationNumber: `SYN/${district.state.slice(0, 2).toUpperCase()}/EW/${String(recyclers.length + 1).padStart(4, '0')}`,
        authorizationIssuer: `${district.state} PCB (synthetic seed record)`,
        authorizationValidTill: validTill.toISOString().slice(0, 10),
        authorizationStatus: status,
        contactPhone: `+9198${String(rng.int(10_000_000, 99_999_999))}`,
        contactPersonName: undefined,
        offeredRatesInr: buildRateCard(rng, accepted, district),
        pickupAvailable: rng.bool(facilityType === 'aggregator' ? 0.75 : 0.45),
        pickupMinWeightKg: rng.pick([20, 30, 50, 75, 100]),
        serviceAreaRadiusKm: rng.pick([10, 15, 20, 25, 30, 40]),
        paymentModes: rng.bool(0.6) ? ['cash', 'upi'] : rng.bool(0.5) ? ['cash'] : ['cash', 'upi', 'bank_transfer'],
        rating: ratingCount >= 3 ? Math.round(rng.normal(4.0, 0.5, 2.5, 5) * 10) / 10 : undefined,
        ratingCount,
        updatedAt: now.toISOString(),
      });
    }
  }
  return recyclers;
}

function pickAccepted(rng: Rng, facilityType: Recycler['facilityType']): MaterialCategoryId[] {
  const all = MATERIAL_CATEGORIES.map((c) => c.id);
  if (facilityType === 'aggregator') return all.filter(() => rng.bool(0.8));
  const chosen = all.filter(() => rng.bool(0.45));
  return chosen.length > 0 ? chosen : [rng.pick(all)];
}

function buildRateCard(rng: Rng, accepted: MaterialCategoryId[], district: District): Record<string, number> {
  const card: Record<string, number> = {};
  for (const categoryId of accepted) {
    // Each facility has a house margin: some consistently pay above the band.
    const houseFactor = rng.normal(1.0, 0.09, 0.75, 1.3);
    for (const { sub } of ALL_SUBS.filter((s) => s.categoryId === categoryId)) {
      const mid = (sub.baseLowInr + sub.baseHighInr) / 2;
      card[rateKey(categoryId, sub.id)] = round2(mid * district.priceFactor * houseFactor);
    }
    card[rateKey(categoryId)] = round2(
      ALL_SUBS.filter((s) => s.categoryId === categoryId).reduce(
        (sum, s) => sum + (s.sub.baseLowInr + s.sub.baseHighInr) / 2,
        0,
      ) /
        ALL_SUBS.filter((s) => s.categoryId === categoryId).length *
        district.priceFactor *
        houseFactor,
    );
  }
  return card;
}

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

export function generatePrices(rng: Rng, options: { days: number; endDate: Date; recyclers: Recycler[] }): PricePoint[] {
  const { days, endDate, recyclers } = options;
  const index = commodityIndex(rng, days);
  const points: PricePoint[] = [];
  let serial = 0;

  for (const district of DISTRICTS) {
    const districtRecyclers = recyclers.filter((r) => r.place.district === district.district);
    for (const { categoryId, sub } of ALL_SUBS) {
      const group = METAL_GROUP[sub.id] ?? 'copper';
      const mid = (sub.baseLowInr + sub.baseHighInr) / 2;
      // A per-pair local premium that persists across the year.
      const localBias = rng.normal(1, 0.05, 0.85, 1.15);

      for (let d = 0; d < days; d++) {
        // Observations are sparse and irregular, exactly as field collection is.
        if (!rng.bool(0.2)) continue;
        const date = new Date(endDate);
        date.setDate(date.getDate() - (days - 1 - d));
        date.setUTCHours(rng.int(7, 18), rng.int(0, 59), 0, 0);

        const commodity = index[group]![d]!;
        const fair = mid * district.priceFactor * localBias * commodity;
        const source = rng.weighted(
          ['completed_transaction', 'recycler_quote', 'aggregator_board', 'field_survey'] as const,
          (s) =>
            ({ completed_transaction: 0.45, recycler_quote: 0.3, aggregator_board: 0.18, field_survey: 0.07 })[s],
        );
        // Quotes scatter more than settled transactions.
        const spread = source === 'completed_transaction' ? 0.05 : 0.1;
        const buying = Math.max(1, rng.normal(fair, fair * spread, fair * 0.5, fair * 1.6));
        const recycler = districtRecyclers.length && rng.bool(0.7) ? rng.pick(districtRecyclers) : undefined;

        serial++;
        points.push({
          priceId: `PRC_${String(serial).padStart(6, '0')}`,
          categoryId,
          subCategoryId: sub.id,
          district: district.district,
          state: district.state,
          observedAt: date.toISOString(),
          buyingPriceInr: round2(buying),
          quotedPriceInr: rng.bool(0.6) ? round2(buying * rng.float(1.05, 1.3)) : undefined,
          unit: sub.unit,
          currency: 'INR',
          marketLowInr: round2(sub.baseLowInr * district.priceFactor * commodity),
          marketHighInr: round2(sub.baseHighInr * district.priceFactor * commodity),
          recyclerId: recycler?.recyclerId,
          source,
          confidence:
            source === 'completed_transaction' ? 0.9 : source === 'field_survey' ? 0.85 : source === 'recycler_quote' ? 0.7 : 0.55,
        });
      }
    }
  }
  return points.sort((a, b) => (a.observedAt < b.observedAt ? -1 : 1));
}

/* ------------------------------------------------------------------ */
/* Collectors                                                          */
/* ------------------------------------------------------------------ */

export function generateCollectors(rng: Rng, count: number, now: Date): Collector[] {
  return Array.from({ length: count }, (_, i) => {
    const district = rng.weighted(DISTRICTS, (d) => d.weight);
    const createdAt = new Date(now);
    createdAt.setDate(createdAt.getDate() - rng.int(30, 360));
    return {
      collectorId: `COL_${String(i + 1).padStart(4, '0')}`,
      // Synthetic hash: no real phone number exists behind these records.
      phoneHash: `syn_${rng.hex(56)}`,
      preferredLanguage: rng.weighted(['mr', 'hi', 'en'] as const, (l) => ({ mr: 0.55, hi: 0.4, en: 0.05 })[l]),
      operatingDistrict: district.district,
      operatingState: district.state,
      createdAt: createdAt.toISOString(),
      lifetimeEarningsInr: 0,
      pendingDuesInr: 0,
      completedTransactions: 0,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Lots, handovers, transactions                                       */
/* ------------------------------------------------------------------ */

const CONDITIONS: MaterialCondition[] = ['intact', 'partially_dismantled', 'broken', 'burnt', 'wet'];
const SOURCE_TYPES: SourceType[] = ['household', 'shop', 'office', 'repair_shop', 'street_pickup', 'aggregator'];

interface ActivityOptions {
  collectors: Collector[];
  recyclers: Recycler[];
  prices: PricePoint[];
  lotCount: number;
  days: number;
  endDate: Date;
}

export function generateActivity(rng: Rng, options: ActivityOptions) {
  const { collectors, recyclers, prices, lotCount, days, endDate } = options;

  // Point-in-time indexes, one per month of the window. A lot collected in
  // January must be valued - and judged - against January's prices, not
  // against a median smeared across the whole year. Using a single index for
  // the full window makes every older transaction look mispriced.
  const monthlyIndexes = buildMonthlyIndexes(prices, endDate, days);
  // Final fallback for any date outside the generated months, so a missing
  // month degrades to a whole-window index rather than crashing.
  const fallbackIndex = buildPriceIndex(prices, { now: endDate, windowDays: 90 });
  const indexFor = (at: Date) => monthlyIndexes.get(monthKey(at)) ?? fallbackIndex;
  const priceIndex = indexFor(endDate);
  const detector = new RuleBasedAnomalyDetector();

  // Photo hashes already committed to a transaction. The detector needs this
  // to catch a reused photograph; without it the check is dead code.
  const seenPhotoHashes = new Set<string>();
  const seenPhotoHashList: string[] = [];

  const lots: Lot[] = [];
  const materials: MaterialItem[] = [];
  const transactions: Transaction[] = [];
  const handovers: HandoverRecord[] = [];
  const injectedAnomalies: Array<{ transactionId: string; kind: string }> = [];

  for (let i = 0; i < lotCount; i++) {
    const collector = rng.pick(collectors);
    const district = DISTRICTS.find((d) => d.district === collector.operatingDistrict)!;
    const collectedAt = new Date(endDate);
    collectedAt.setDate(collectedAt.getDate() - rng.int(0, days - 1));
    collectedAt.setUTCHours(rng.int(6, 19), rng.int(0, 59), 0, 0);

    const lotId = `LOT_${String(i + 1).padStart(5, '0')}`;
    const lotPriceIndex = indexFor(collectedAt);
    const valuer = new RuleBasedValuer(lotPriceIndex);
    const itemCount = rng.weighted([1, 2, 3, 4], (n) => [0.42, 0.32, 0.18, 0.08][n - 1]!);
    const items: MaterialItem[] = [];

    for (let j = 0; j < itemCount; j++) {
      const { categoryId, sub } = rng.weighted(ALL_SUBS, ({ categoryId }) =>
        ({ cable: 0.24, mixed_plastic: 0.2, pcb: 0.16, motor_magnet: 0.14, battery: 0.12, crt: 0.08, lcd_panel: 0.06 })[
          categoryId
        ],
      );
      const quantity = sub.typicalPieceWeightKg ? rng.int(1, 12) : 1;
      const weight = sub.typicalPieceWeightKg
        ? round2(sub.typicalPieceWeightKg * quantity * rng.float(0.75, 1.3))
        : round2(rng.float(1, 45));
      const condition = rng.weighted(CONDITIONS, (c) =>
        ({ intact: 0.45, partially_dismantled: 0.25, broken: 0.20, burnt: 0.05, wet: 0.05 })[c] ?? 0.1,
      );
      const valuation = valuer.estimate({
        subCategoryId: sub.id,
        weightKg: weight,
        quantity,
        condition,
        district: district.district,
      });
      const photoHash = rng.hex(64);

      items.push({
        materialId: `MAT_${String(materials.length + items.length + 1).padStart(6, '0')}`,
        lotId,
        categoryId,
        subCategoryId: sub.id,
        description: '',
        imageRefs: [`synthetic://images/${sub.id}/${photoHash.slice(0, 12)}.jpg`],
        approxWeightKg: weight,
        unit: sub.unit,
        quantity,
        condition,
        sourceType: rng.pick(SOURCE_TYPES),
        estimatedValueInr: valuation.estimateInr,
        classificationSource: rng.bool(0.85) ? 'collector' : 'recycler_corrected',
        createdAt: collectedAt.toISOString(),
      });
    }

    const totalWeight = round2(items.reduce((s, it) => s + it.approxWeightKg, 0));
    const estimatedValue = round2(items.reduce((s, it) => s + it.estimatedValueInr, 0));
    const locality = rng.pick(district.localities);
    const collectionPlace = placeIn(district, locality, rng.float(-0.08, 0.08));

    const lot: Lot = {
      lotId,
      collectorId: collector.collectorId,
      status: 'ready',
      items,
      totalWeightKg: totalWeight,
      estimatedValueInr: estimatedValue,
      collectionPlace,
      collectedAt: collectedAt.toISOString(),
      createdAt: collectedAt.toISOString(),
      updatedAt: collectedAt.toISOString(),
    };

    // A realistic share of lots never reach a recycler: no buyer nearby takes
    // the material, or the collector simply has not sold yet.
    const eligible = recyclers.filter(
      (r) =>
        r.authorizationStatus === 'authorized' &&
        r.place.district === district.district &&
        items.some((it) => r.materialsAccepted.includes(it.categoryId)),
    );
    if (eligible.length === 0 || rng.bool(0.12)) {
      lots.push(lot);
      materials.push(...items);
      continue;
    }

    const recycler = rng.weighted(eligible, (r) => (r.rating ?? 3.5) ** 2);
    const handoverAt = new Date(collectedAt.getTime() + rng.int(2, 72) * 3_600_000);
    if (handoverAt > endDate) {
      lots.push(lot);
      materials.push(...items);
      continue;
    }

    const transactionId = `TXN_${String(transactions.length + 1).padStart(5, '0')}`;
    const quoted = round2(estimatedValue * rng.normal(0.98, 0.06, 0.8, 1.2));

    // Inject known-bad transactions so the detector can be evaluated against
    // ground truth rather than against itself.
    const anomalyKind = rng.bool(0.05)
      ? rng.pick(['underpayment', 'weight_shortfall', 'duplicate_photo'] as const)
      : undefined;

    let final = round2(quoted * rng.normal(1, 0.02, 0.94, 1.06));
    let weighed = round2(totalWeight * rng.normal(1, 0.03, 0.9, 1.1));
    let photoHashes = items.map((it) => it.imageRefs[0]!.split('/').pop()!.replace('.jpg', ''));

    if (anomalyKind === 'underpayment') final = round2(quoted * rng.float(0.5, 0.75));
    if (anomalyKind === 'weight_shortfall') weighed = round2(totalWeight * rng.float(0.6, 0.75));
    if (anomalyKind === 'duplicate_photo' && seenPhotoHashList.length > 10) {
      photoHashes = [seenPhotoHashList[rng.int(0, seenPhotoHashList.length - 1)]!];
    }
    if (anomalyKind) injectedAnomalies.push({ transactionId, kind: anomalyKind });

    const handoverPlace = recycler.place;
    const handover = createHandover(
      {
        lotId,
        collectorId: collector.collectorId,
        recyclerId: recycler.recyclerId,
        declaredWeightKg: totalWeight,
        weighedWeightKg: weighed,
        photoHashes,
        handoverPoint: handoverPlace.point!,
        handoverPlace,
        createdAt: handoverAt.toISOString(),
      },
      `synthetic-device-secret-${collector.collectorId}`,
      items.flatMap((it) => it.imageRefs),
      // Seeded, so regenerating the dataset produces identical files. The app
      // never passes this - it mints a random reference on the device.
      seededHandoverRef(rng),
    );
    handover.confirmationStatus = rng.bool(0.94) ? 'confirmed' : 'pending';
    if (handover.confirmationStatus === 'confirmed') {
      handover.confirmedAt = new Date(handoverAt.getTime() + rng.int(1, 240) * 60_000).toISOString();
      handover.confirmedBy = recycler.recyclerId;
      handover.downstreamStatus = rng.weighted(
        ['received', 'sorted', 'processed', 'reported_to_epr'] as const,
        (s) => ({ received: 0.3, sorted: 0.25, processed: 0.25, reported_to_epr: 0.2 })[s],
      );
    }
    handover.transactionId = transactionId;

    const paymentMode = rng.weighted(recycler.paymentModes, (m) => (m === 'cash' ? 0.72 : 0.14));
    const paymentStatus =
      handover.confirmationStatus !== 'confirmed'
        ? 'unpaid'
        : rng.weighted(['paid', 'partial', 'unpaid'] as const, (s) => ({ paid: 0.85, partial: 0.07, unpaid: 0.08 })[s]);

    const detected = detector.detect(
      {
        district: district.district,
        items: items.map((it) => ({
          subCategoryId: it.subCategoryId,
          approxWeightKg: it.approxWeightKg,
          quantity: it.quantity,
          condition: it.condition,
        })),
        photoHashes,
        declaredWeightKg: totalWeight,
        weighedWeightKg: weighed,
        estimatedValueInr: estimatedValue,
        quotedPriceInr: quoted,
        finalPriceInr: final,
        collectionPoint: collectionPlace.point,
        collectedAt: collectedAt.toISOString(),
        handoverPoint: handoverPlace.point,
        handoverAt: handoverAt.toISOString(),
      },
      { priceIndex: lotPriceIndex, knownPhotoHashes: seenPhotoHashes },
    );

    for (const hash of photoHashes) {
      if (!seenPhotoHashes.has(hash)) {
        seenPhotoHashes.add(hash);
        seenPhotoHashList.push(hash);
      }
    }

    const transaction: Transaction = {
      transactionId,
      lotId,
      collectorId: collector.collectorId,
      recyclerId: recycler.recyclerId,
      categorySummary: [...new Set(items.map((it) => it.categoryId))],
      totalWeightKg: totalWeight,
      estimatedValueInr: estimatedValue,
      quotedPriceInr: quoted,
      finalPriceInr: final,
      collectionPlace,
      handoverPlace,
      handoverAt: handoverAt.toISOString(),
      paymentStatus,
      paymentMode,
      paidAt: paymentStatus === 'paid' ? handover.confirmedAt : undefined,
      status: handover.confirmationStatus === 'confirmed' ? 'completed' : 'pending',
      anomalyFlags: detected.map((f) => f.code),
      createdAt: handoverAt.toISOString(),
      updatedAt: (handover.confirmedAt ?? handoverAt.toISOString()) as string,
    };

    lot.status =
      paymentStatus === 'paid' ? 'paid' : handover.confirmationStatus === 'confirmed' ? 'confirmed' : 'handed_over';
    lot.recyclerId = recycler.recyclerId;
    lot.quotedPriceInr = quoted;
    lot.updatedAt = transaction.updatedAt;

    lots.push(lot);
    materials.push(...items);
    handovers.push(handover);
    transactions.push(transaction);
  }

  // Roll the ledger counters up onto the collector records.
  for (const collector of collectors) {
    const own = transactions.filter((t) => t.collectorId === collector.collectorId);
    collector.completedTransactions = own.filter((t) => t.status === 'completed').length;
    collector.lifetimeEarningsInr = round2(
      own.filter((t) => t.paymentStatus === 'paid').reduce((s, t) => s + t.finalPriceInr, 0),
    );
    collector.pendingDuesInr = round2(
      own
        .filter((t) => t.paymentStatus !== 'paid' && t.status !== 'cancelled')
        .reduce((s, t) => s + (t.paymentStatus === 'partial' ? t.finalPriceInr / 2 : t.finalPriceInr), 0),
    );
  }

  return { lots, materials, transactions, handovers, injectedAnomalies, priceIndex };
}

/* ------------------------------------------------------------------ */
/* Training manifest                                                   */
/* ------------------------------------------------------------------ */

/**
 * The AI/ML manifest. Note what it is and is not: it lists image *references*
 * with labels, weights, districts and settled prices. The images themselves do
 * not exist in this repository - real photographs have to come from the field
 * study. See docs/ai-ml.md.
 */
export function buildTrainingSamples(
  materials: MaterialItem[],
  transactions: Transaction[],
  lots: Lot[],
): TrainingSample[] {
  const txnByLot = new Map(transactions.map((t) => [t.lotId, t]));
  const lotById = new Map(lots.map((l) => [l.lotId, l]));

  return materials
    .filter((m) => m.imageRefs.length > 0)
    .map((m) => {
      const txn = txnByLot.get(m.lotId);
      const lot = lotById.get(m.lotId);
      const imageHash = m.imageRefs[0]!.split('/').pop()!.replace('.jpg', '');
      const share = lot && lot.estimatedValueInr > 0 ? m.estimatedValueInr / lot.estimatedValueInr : 1;
      return {
        sampleId: `TRN_${m.materialId.slice(4)}`,
        imageRef: m.imageRefs[0]!,
        imageHash,
        labelCategoryId: m.categoryId,
        labelSubCategoryId: m.subCategoryId,
        labelSource: m.classificationSource === 'recycler_corrected' ? 'recycler_corrected' : 'collector',
        weightKg: m.approxWeightKg,
        district: lot?.collectionPlace.district ?? 'unknown',
        observedPriceInr: m.estimatedValueInr,
        finalPriceInr: txn ? round2(txn.finalPriceInr * share) : undefined,
        capturedAt: m.createdAt,
        split: splitForKey(imageHash),
        synthetic: true,
      } satisfies TrainingSample;
    });
}

/* ------------------------------------------------------------------ */
/* Top level                                                           */
/* ------------------------------------------------------------------ */

export function generateDataset(options: GenerateOptions = {}): GeneratedDataset {
  const seed = options.seed ?? DEFAULT_SEED;
  const days = options.days ?? 365;
  const endDate = options.endDate ?? new Date('2026-09-01T00:00:00.000Z');
  const rng = new Rng(seed);

  const recyclers = generateRecyclers(rng, endDate);
  const prices = generatePrices(rng, { days, endDate, recyclers });
  const collectors = generateCollectors(rng, options.collectorCount ?? 60, endDate);
  const activity = generateActivity(rng, {
    collectors,
    recyclers,
    prices,
    lotCount: options.lotCount ?? 1400,
    days,
    endDate,
  });
  const trainingSamples = buildTrainingSamples(activity.materials, activity.transactions, activity.lots);

  const windowStart = new Date(endDate);
  windowStart.setDate(windowStart.getDate() - days);

  return {
    meta: {
      generatorVersion: GENERATOR_VERSION,
      seed,
      generatedAt: endDate.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: endDate.toISOString(),
      synthetic: true,
    },
    recyclers,
    prices,
    collectors,
    lots: activity.lots,
    materials: activity.materials,
    transactions: activity.transactions,
    handovers: activity.handovers,
    trainingSamples,
    injectedAnomalies: activity.injectedAnomalies,
  };
}

/** A handover reference drawn from the seeded stream, in the same format as the real one. */
function seededHandoverRef(rng: Rng): string {
  const block = () =>
    Array.from({ length: 4 }, () => ID_ALPHABET[rng.int(0, ID_ALPHABET.length - 1)]).join('');
  return `HO-${block()}-${block()}`;
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * One 90-day-window price index per calendar month in the generated range.
 *
 * Iteration walks month *boundaries*, not a fixed day-of-month offset. Stepping
 * a mid-month cursor forward drops the final month whenever the window start
 * falls later in the month than the end date does - which leaves lots
 * collected in that month with no index at all.
 */
function buildMonthlyIndexes(prices: PricePoint[], endDate: Date, days: number) {
  const indexes = new Map<string, ReturnType<typeof buildPriceIndex>>();
  const start = new Date(endDate);
  start.setUTCDate(start.getUTCDate() - days);

  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  while (Date.UTC(year, month, 1) <= endDate.getTime()) {
    const monthEndMs = Date.UTC(year, month + 1, 0, 23, 59, 59);
    const at = new Date(Math.min(monthEndMs, endDate.getTime()));
    indexes.set(`${year}-${String(month + 1).padStart(2, '0')}`, buildPriceIndex(prices, { now: at, windowDays: 90 }));
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return indexes;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

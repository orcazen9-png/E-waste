import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MATERIAL_CATEGORIES, getSubCategory, ALL_SUB_CATEGORY_IDS } from '../src/taxonomy.ts';
import { buildPriceIndex, computeTrend, lookupStat } from '../src/domain/priceIndex.ts';
import { RuleBasedValuer, valueLot } from '../src/domain/valuation.ts';
import { WeightedRecyclerMatcher } from '../src/domain/matching.ts';
import { RuleBasedAnomalyDetector, robustZ, worstSeverity } from '../src/domain/anomaly.ts';
import { PriorBasedClassifier } from '../src/domain/classification.ts';
import { createHandover, verifyHandover, handoverQrPayload, parseHandoverQr } from '../src/domain/handover.ts';
import { resolveConflict, backoffMs } from '../src/sync.ts';
import {
  buildToken,
  constantTimeEqual,
  hashOtp,
  isPlausibleIndianMobile,
  normalisePhone,
  verifyToken,
  COLLECTOR_TOKEN_TTL_SECONDS,
  RECYCLER_TOKEN_TTL_SECONDS,
} from '../src/auth.ts';
import { sha256Hex, hmacSha256Hex, hashPhone } from '../src/hash.ts';
import { haversineKm } from '../src/geo.ts';
import { verificationCodeFor, splitForKey, newLotId } from '../src/ids.ts';
import { BUNDLES, t, translateCoded, formatInr } from '../src/i18n/index.ts';
import { en } from '../src/i18n/en.ts';
import { safetyCardsFor, SAFETY_CARDS } from '../src/safety.ts';
import type { PricePoint, Recycler } from '../src/types.ts';

const NOW = new Date('2026-03-01T00:00:00.000Z');

function pricePoint(over: Partial<PricePoint> & Pick<PricePoint, 'subCategoryId'>): PricePoint {
  return {
    priceId: `PRC_${Math.random().toString(36).slice(2)}`,
    categoryId: getSubCategory(over.subCategoryId).category.id,
    district: 'Pune',
    state: 'Maharashtra',
    observedAt: '2026-02-25T10:00:00.000Z',
    buyingPriceInr: 100,
    unit: 'kg',
    currency: 'INR',
    marketLowInr: 90,
    marketHighInr: 120,
    source: 'completed_transaction',
    confidence: 0.8,
    ...over,
  };
}

/** Ten observations oscillating around 400/kg for house cable in Pune - no trend. */
function cablePrices(): PricePoint[] {
  return Array.from({ length: 10 }, (_, i) =>
    pricePoint({
      subCategoryId: 'cable_copper_house',
      buyingPriceInr: 400 + ((i % 3) - 1) * 5,
      marketLowInr: 350,
      marketHighInr: 460,
      observedAt: new Date(NOW.getTime() - (i + 1) * 86_400_000).toISOString(),
    }),
  );
}

describe('taxonomy', () => {
  it('has unique sub-category ids across all categories', () => {
    assert.equal(new Set(ALL_SUB_CATEGORY_IDS).size, ALL_SUB_CATEGORY_IDS.length);
  });

  it('covers every category named in the problem statement', () => {
    const ids = MATERIAL_CATEGORIES.map((c) => c.id).sort();
    assert.deepEqual(ids, [
      'battery',
      'cable',
      'crt',
      'lcd_panel',
      'mixed_plastic',
      'motor_magnet',
      'pcb',
    ]);
  });

  it('keeps every reference band ordered low to high', () => {
    for (const category of MATERIAL_CATEGORIES) {
      for (const sub of category.subCategories) {
        assert.ok(sub.baseLowInr < sub.baseHighInr, `${sub.id} band inverted`);
      }
    }
  });
});

describe('price index', () => {
  it('summarises local prices and rolls them up nationally', () => {
    const index = buildPriceIndex(cablePrices(), { now: NOW });
    const local = lookupStat(index, 'cable_copper_house', 'Pune');
    assert.ok(local);
    assert.equal(local.district, 'Pune');
    assert.equal(local.sampleSize, 10);
    assert.ok(local.medianBuyingInr > 395 && local.medianBuyingInr < 410);

    // An unknown district falls back to the national rollup rather than failing.
    const fallback = lookupStat(index, 'cable_copper_house', 'Latur');
    assert.ok(fallback);
    assert.equal(fallback.district, '*');
  });

  it('ignores observations older than the window', () => {
    const stale = pricePoint({
      subCategoryId: 'pcb_motherboard',
      observedAt: '2024-01-01T00:00:00.000Z',
    });
    const index = buildPriceIndex([stale], { now: NOW, windowDays: 90 });
    assert.equal(lookupStat(index, 'pcb_motherboard', 'Pune'), undefined);
  });

  it('reports a rising trend only when the move clears the noise floor', () => {
    const flat = buildPriceIndex(cablePrices(), { now: NOW });
    const flatStat = lookupStat(flat, 'cable_copper_house', 'Pune')!;
    assert.equal(computeTrend(flatStat, '7d').direction, 'flat');

    const rising = buildPriceIndex(
      Array.from({ length: 14 }, (_, i) =>
        pricePoint({
          subCategoryId: 'cable_copper_house',
          // Oldest first: 300 -> 600 over two weeks.
          buyingPriceInr: 300 + i * 23,
          observedAt: new Date(NOW.getTime() - (14 - i) * 86_400_000).toISOString(),
        }),
      ),
      { now: NOW },
    );
    const trend = computeTrend(lookupStat(rising, 'cable_copper_house', 'Pune')!, '7d');
    assert.equal(trend.direction, 'up');
    assert.ok(trend.changePct > 3);
  });
});

describe('valuation', () => {
  const index = buildPriceIndex(cablePrices(), { now: NOW });
  const valuer = new RuleBasedValuer(index);

  it('prices a lot off local data when there is enough of it', () => {
    const result = valuer.estimate({
      subCategoryId: 'cable_copper_house',
      weightKg: 10,
      condition: 'intact',
      district: 'Pune',
    });
    assert.equal(result.basis, 'local_data');
    assert.ok(result.confidence > 0.6);
    assert.ok(result.estimateInr > 3900 && result.estimateInr < 4200);
    assert.ok(result.lowInr <= result.estimateInr && result.estimateInr <= result.highInr);
  });

  it('falls back to the reference band with low confidence when data is missing', () => {
    const result = valuer.estimate({
      subCategoryId: 'battery_li_ion_laptop',
      weightKg: 5,
      condition: 'intact',
      district: 'Pune',
    });
    assert.equal(result.basis, 'reference_band');
    assert.ok(result.confidence <= 0.35);
    assert.deepEqual(result.reasons, ['valuation.reason.reference_band']);
  });

  it('pays less for burnt material than for intact material', () => {
    const base = { subCategoryId: 'cable_copper_house', weightKg: 10, district: 'Pune' } as const;
    const intact = valuer.estimate({ ...base, condition: 'intact' });
    const burnt = valuer.estimate({ ...base, condition: 'burnt' });
    assert.ok(burnt.estimateInr < intact.estimateInr * 0.6);
  });

  it('always returns a range that contains its own estimate', () => {
    // The bug this covers: the low bound omitted the bulk factor, so a small
    // parcel produced low > high with the estimate outside both. Sweeping
    // weights across every bulk band and every condition is what catches it -
    // the original test used a single 10 kg lot, where bulk is exactly 1.
    const weights = [0.2, 0.6, 1, 1.9, 2, 8, 12, 49, 50, 120, 200, 500];
    const conditions = ['intact', 'partially_dismantled', 'broken', 'burnt', 'wet'] as const;
    for (const weightKg of weights) {
      for (const condition of conditions) {
        for (const subCategoryId of ['cable_copper_house', 'battery_li_ion_laptop']) {
          const v = valuer.estimate({ subCategoryId, weightKg, condition, district: 'Pune' });
          assert.ok(
            v.lowInr <= v.highInr,
            `low ${v.lowInr} > high ${v.highInr} for ${subCategoryId} ${weightKg}kg ${condition}`,
          );
          assert.ok(
            v.lowInr <= v.estimateInr && v.estimateInr <= v.highInr,
            `estimate ${v.estimateInr} outside [${v.lowInr}, ${v.highInr}] for ${subCategoryId} ${weightKg}kg ${condition}`,
          );
        }
      }
    }
  });

  it('sums a multi-item lot', () => {
    const lot = valueLot(
      valuer,
      [
        { subCategoryId: 'cable_copper_house', approxWeightKg: 5, quantity: 1, condition: 'intact' },
        { subCategoryId: 'cable_copper_house', approxWeightKg: 3, quantity: 1, condition: 'broken' },
      ],
      'Pune',
    );
    assert.equal(lot.perItem.length, 2);
    assert.ok(lot.totalInr > 0);
    assert.equal(
      lot.totalInr,
      Math.round((lot.perItem[0]!.estimateInr + lot.perItem[1]!.estimateInr) * 100) / 100,
    );
  });
});

describe('recycler matching', () => {
  const index = buildPriceIndex(cablePrices(), { now: NOW });
  const collectorPoint = { lat: 18.5204, lon: 73.8567 };

  function recycler(over: Partial<Recycler> & Pick<Recycler, 'recyclerId'>): Recycler {
    return {
      name: `Facility ${over.recyclerId}`,
      facilityType: 'recycler',
      place: {
        locality: 'Bhosari',
        district: 'Pune',
        state: 'Maharashtra',
        point: { lat: 18.62, lon: 73.85 },
      },
      materialsAccepted: ['cable'],
      authorizationNumber: 'SYN/MPCB/EW/0001',
      authorizationIssuer: 'MPCB (synthetic)',
      authorizationValidTill: '2027-12-31',
      authorizationStatus: 'authorized',
      contactPhone: '+910000000000',
      offeredRatesInr: { 'cable:*': 400 },
      pickupAvailable: false,
      serviceAreaRadiusKm: 30,
      paymentModes: ['cash'],
      ratingCount: 0,
      updatedAt: NOW.toISOString(),
      ...over,
    };
  }

  const lot = {
    items: [
      { categoryId: 'cable' as const, subCategoryId: 'cable_copper_house', approxWeightKg: 20 },
    ],
    totalWeightKg: 20,
    collectionPlace: { locality: 'Kothrud', district: 'Pune', state: 'Maharashtra' },
  };

  it('ranks the better-paying, closer facility first', () => {
    const result = new WeightedRecyclerMatcher().match({
      lot: lot as never,
      collectorPoint,
      recyclers: [
        recycler({ recyclerId: 'R_LOW', offeredRatesInr: { 'cable:*': 330 } }),
        recycler({ recyclerId: 'R_HIGH', offeredRatesInr: { 'cable:*': 450 }, pickupAvailable: true }),
      ],
      priceIndex: index,
      now: NOW,
    });
    assert.equal(result.matches[0]!.recycler.recyclerId, 'R_HIGH');
    assert.ok(result.matches[0]!.vsFairPricePct > 0);
    assert.ok(result.matches[0]!.reasons.includes('match.reason.pickup_available'));
  });

  it('never ranks an unauthorised or expired facility', () => {
    const result = new WeightedRecyclerMatcher().match({
      lot: lot as never,
      collectorPoint,
      recyclers: [
        recycler({ recyclerId: 'R_SUSPENDED', authorizationStatus: 'suspended' }),
        recycler({ recyclerId: 'R_EXPIRED', authorizationValidTill: '2025-01-01' }),
      ],
      priceIndex: index,
      now: NOW,
    });
    assert.equal(result.matches.length, 0);
    assert.deepEqual(
      result.excluded.map((e) => e.recyclerId).sort(),
      ['R_EXPIRED', 'R_SUSPENDED'],
    );
  });

  it('excludes facilities outside their own service radius', () => {
    const result = new WeightedRecyclerMatcher().match({
      lot: lot as never,
      collectorPoint,
      recyclers: [
        recycler({
          recyclerId: 'R_FAR',
          place: {
            locality: 'Nagpur',
            district: 'Nagpur',
            state: 'Maharashtra',
            point: { lat: 21.1458, lon: 79.0882 },
          },
        }),
      ],
      priceIndex: index,
      now: NOW,
    });
    assert.equal(result.matches.length, 0);
    assert.equal(result.excluded[0]!.reason, 'match.excluded.too_far');
  });

  it('warns when a buyer only takes part of the lot', () => {
    const mixedLot = {
      items: [
        { categoryId: 'cable' as const, subCategoryId: 'cable_copper_house', approxWeightKg: 10 },
        { categoryId: 'battery' as const, subCategoryId: 'battery_li_ion_laptop', approxWeightKg: 4 },
      ],
      totalWeightKg: 14,
      collectionPlace: lot.collectionPlace,
    };
    const result = new WeightedRecyclerMatcher().match({
      lot: mixedLot as never,
      collectorPoint,
      recyclers: [recycler({ recyclerId: 'R_CABLE_ONLY' })],
      priceIndex: index,
      now: NOW,
    });
    assert.equal(result.matches.length, 1);
    assert.ok(
      result.matches[0]!.warnings.some((w) => w.startsWith('match.warning.partial_coverage')),
    );
  });
});

describe('anomaly detection', () => {
  const index = buildPriceIndex(cablePrices(), { now: NOW });
  const detector = new RuleBasedAnomalyDetector();
  const items = [
    { subCategoryId: 'cable_copper_house', approxWeightKg: 10, quantity: 1, condition: 'intact' as const },
  ];

  it('flags a price far below the local band as critical', () => {
    const flags = detector.detect(
      { district: 'Pune', items, declaredWeightKg: 10, estimatedValueInr: 4000, finalPriceInr: 1500 },
      { priceIndex: index },
    );
    assert.equal(worstSeverity(flags), 'critical');
    assert.ok(flags.some((f) => f.code === 'PRICE_FAR_BELOW_MARKET'));
  });

  it('accepts a fair price without flagging it', () => {
    const flags = detector.detect(
      { district: 'Pune', items, declaredWeightKg: 10, estimatedValueInr: 4000, finalPriceInr: 3950 },
      { priceIndex: index },
    );
    assert.deepEqual(flags, []);
  });

  it('flags a payment below the agreed quote', () => {
    const flags = detector.detect(
      {
        district: 'Pune',
        items,
        declaredWeightKg: 10,
        estimatedValueInr: 4000,
        quotedPriceInr: 4000,
        finalPriceInr: 3200,
      },
      { priceIndex: index },
    );
    assert.ok(flags.some((f) => f.code === 'FINAL_BELOW_QUOTE' && f.severity === 'critical'));
  });

  it('flags a weight that cannot match the category', () => {
    const flags = detector.detect(
      {
        district: 'Pune',
        items: [
          { subCategoryId: 'battery_li_ion_mobile', approxWeightKg: 20, quantity: 1, condition: 'intact' as const },
        ],
        declaredWeightKg: 20,
        estimatedValueInr: 100,
      },
      { priceIndex: index },
    );
    assert.ok(flags.some((f) => f.code === 'WEIGHT_IMPLAUSIBLE_FOR_CATEGORY'));
  });

  it('flags a scale reading well under the declared weight', () => {
    const flags = detector.detect(
      { district: 'Pune', items, declaredWeightKg: 10, weighedWeightKg: 7, estimatedValueInr: 4000 },
      { priceIndex: index },
    );
    assert.ok(flags.some((f) => f.code === 'WEIGHT_MISMATCH_AT_HANDOVER' && f.severity === 'critical'));
  });

  it('flags a photo reused from another lot', () => {
    const flags = detector.detect(
      { district: 'Pune', items, declaredWeightKg: 10, estimatedValueInr: 4000, photoHashes: ['abc123'] },
      { priceIndex: index, knownPhotoHashes: new Set(['abc123']) },
    );
    assert.ok(flags.some((f) => f.code === 'DUPLICATE_PHOTO'));
  });

  it('flags impossible travel between collection and handover', () => {
    const flags = detector.detect(
      {
        district: 'Pune',
        items,
        declaredWeightKg: 10,
        estimatedValueInr: 4000,
        collectionPoint: { lat: 18.52, lon: 73.85 },
        collectedAt: '2026-03-01T09:00:00.000Z',
        handoverPoint: { lat: 21.14, lon: 79.08 },
        handoverAt: '2026-03-01T10:00:00.000Z',
      },
      { priceIndex: index },
    );
    assert.ok(flags.some((f) => f.code === 'IMPOSSIBLE_TRAVEL'));
  });

  it('uses a median-based z-score that one outlier cannot hide', () => {
    const sample = [1, 1.02, 0.98, 1.01, 0.99, 20];
    assert.ok(robustZ(0.4, sample) < -3);
  });
});

describe('handover record', () => {
  const draft = {
    lotId: 'LOT_TEST',
    collectorId: 'COL_TEST',
    recyclerId: 'REC_TEST',
    declaredWeightKg: 12.5,
    weighedWeightKg: 12.2,
    photoHashes: ['h1', 'h2'],
    handoverPoint: { lat: 18.62, lon: 73.85 },
    handoverPlace: { locality: 'Bhosari', district: 'Pune', state: 'Maharashtra' },
    createdAt: '2026-03-01T09:30:00.000Z',
  };

  it('verifies a record it just signed', () => {
    const record = createHandover(draft, 'device-secret');
    assert.equal(verifyHandover(record, 'device-secret').valid, true);
    assert.match(record.handoverRef, /^HO-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.match(record.verificationCode, /^\d{6}$/);
  });

  it('rejects a record whose weight was edited after signing', () => {
    const record = createHandover(draft, 'device-secret');
    const tampered = { ...record, weighedWeightKg: 30 };
    const result = verifyHandover(tampered, 'device-secret');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'handover.invalid_digest');
  });

  it('round-trips through the QR payload and stays small enough to scan', () => {
    const record = createHandover(draft, 'device-secret');
    const payload = handoverQrPayload(record);
    assert.ok(payload.length < 300, `QR payload too large: ${payload.length}`);
    const parsed = parseHandoverQr(payload);
    assert.equal(parsed.handoverRef, record.handoverRef);
    assert.equal(parsed.weighedWeightKg, 12.2);
  });

  it('accepts an injected reference so a seeded generator is reproducible', () => {
    // The app never passes this; the dataset generator does, and without it
    // regenerating the seed produced different bytes every run.
    const a = createHandover(draft, 'device-secret', [], 'HO-ABCD-1234');
    const b = createHandover(draft, 'device-secret', [], 'HO-ABCD-1234');
    assert.equal(a.handoverRef, 'HO-ABCD-1234');
    assert.equal(a.digest, b.digest);
    assert.equal(a.verificationCode, b.verificationCode);
    assert.equal(verifyHandover(a, 'device-secret').valid, true);
  });

  it('mints a different reference each time when none is supplied', () => {
    const refs = new Set(Array.from({ length: 200 }, () => createHandover(draft, 's').handoverRef));
    assert.equal(refs.size, 200);
  });

  it('derives a stable verification code from the reference', () => {
    assert.equal(verificationCodeFor('HO-AAAA-BBBB', 's'), verificationCodeFor('HO-AAAA-BBBB', 's'));
    assert.notEqual(verificationCodeFor('HO-AAAA-BBBB', 's'), verificationCodeFor('HO-AAAA-BBBC', 's'));
  });
});

describe('sync', () => {
  it('lets a counter-signed server record win over later local edits', () => {
    assert.equal(
      resolveConflict({
        local: { updatedAt: '2026-03-02T00:00:00.000Z', status: 'ready' },
        server: { updatedAt: '2026-03-01T00:00:00.000Z', status: 'confirmed' },
      }),
      'take_server',
    );
  });

  it('escalates two different terminal states to manual review', () => {
    assert.equal(
      resolveConflict({
        local: { updatedAt: '2026-03-02T00:00:00.000Z', status: 'cancelled' },
        server: { updatedAt: '2026-03-01T00:00:00.000Z', status: 'confirmed' },
      }),
      'manual',
    );
  });

  it('is last-write-wins for in-progress records', () => {
    assert.equal(
      resolveConflict({
        local: { updatedAt: '2026-03-02T00:00:00.000Z', status: 'draft' },
        server: { updatedAt: '2026-03-01T00:00:00.000Z', status: 'draft' },
      }),
      'take_local',
    );
  });

  it('caps retry backoff at an hour', () => {
    assert.equal(backoffMs(1), 2000);
    assert.equal(backoffMs(50), 3_600_000);
  });
});

describe('hashing and ids', () => {
  it('matches known SHA-256 vectors', () => {
    assert.equal(
      sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    assert.equal(
      sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches a known HMAC-SHA256 vector', () => {
    assert.equal(
      hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'),
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  it('hashes phone numbers irreversibly and ignores formatting', () => {
    assert.equal(hashPhone('+91 98765 43210', 'salt'), hashPhone('9876543210', 'salt'));
    assert.notEqual(hashPhone('9876543210', 'salt-a'), hashPhone('9876543210', 'salt-b'));
  });

  it('generates sortable, unique lot ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newLotId()));
    assert.equal(ids.size, 500);
  });

  it('splits training samples deterministically into roughly 70/15/15', () => {
    const counts = { train: 0, val: 0, test: 0 };
    for (let i = 0; i < 2000; i++) counts[splitForKey(`sample-${i}`)]++;
    assert.ok(counts.train > 1300 && counts.train < 1500);
    assert.ok(counts.val > 200 && counts.val < 400);
    assert.ok(counts.test > 200 && counts.test < 400);
  });
});

describe('geo', () => {
  it('measures the Pune to Nagpur great-circle distance', () => {
    const km = haversineKm({ lat: 18.5204, lon: 73.8567 }, { lat: 21.1458, lon: 79.0882 });
    assert.ok(km > 610 && km < 630, `got ${km}`);
  });
});

describe('i18n', () => {
  it('has no missing strings in Marathi or Hindi', () => {
    const keys = Object.keys(en) as Array<keyof typeof en>;
    for (const locale of ['mr', 'hi'] as const) {
      const missing = keys.filter((k) => !BUNDLES[locale][k]);
      assert.deepEqual(missing, [], `${locale} missing: ${missing.join(', ')}`);
    }
  });

  it('does not leave English text in the Marathi or Hindi safety bodies', () => {
    for (const locale of ['mr', 'hi'] as const) {
      for (const card of SAFETY_CARDS) {
        const body = BUNDLES[locale][card.bodyKey as keyof typeof en];
        assert.notEqual(body, en[card.bodyKey as keyof typeof en], `${locale} ${card.key} untranslated`);
      }
    }
  });

  it('interpolates named values', () => {
    assert.equal(t('en', 'match.distance', { km: 3.2 }), '3.2 km away');
  });

  it('expands coded reasons from the domain services', () => {
    assert.equal(
      translateCoded('en', 'valuation.reason.local:12:Pune'),
      'Based on 12 recent sales in Pune',
    );
    assert.equal(translateCoded('en', 'valuation.reason.condition:burnt'), 'Adjusted because it is Burnt');
    assert.equal(translateCoded('mr', 'match.reason.above_fair:12'), 'नेहमीच्या भावापेक्षा 12% जास्त देतात');
  });

  it('uses the same placeholders in every language', () => {
    // A key whose translations disagree on placeholders renders a raw {amount}
    // to whichever language was missed. Found exactly that on the handover
    // slip, in Marathi only.
    const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      for (const locale of ['mr', 'hi'] as const) {
        assert.equal(
          placeholders(BUNDLES[locale][key]),
          placeholders(en[key]),
          `placeholder mismatch for ${key} in ${locale}`,
        );
      }
    }
  });

  it('formats rupees with Indian digit grouping', () => {
    assert.equal(formatInr(123456), '₹1,23,456');
  });
});

describe('safety guidance', () => {
  it('offers a card for every material category', () => {
    for (const category of MATERIAL_CATEGORIES) {
      assert.ok(safetyCardsFor([category.id]).length > 0, `no safety card for ${category.id}`);
    }
  });

  it('references only keys that exist in the bundles', () => {
    for (const card of SAFETY_CARDS) {
      assert.ok(card.titleKey in en, `missing ${card.titleKey}`);
      assert.ok(card.bodyKey in en, `missing ${card.bodyKey}`);
    }
  });
});

describe('classification', () => {
  it('suggests candidates but never crosses its own auto-select threshold', async () => {
    const result = await new PriorBasedClassifier().classify({ imageRef: 'file://x.jpg' });
    assert.ok(result.candidates.length > 0);
    assert.equal(result.isPrior, true);
    assert.ok(result.candidates[0]!.probability < result.autoSelectThreshold);
  });

  it('promotes what the collector picked recently', async () => {
    const result = await new PriorBasedClassifier().classify({
      imageRef: 'file://x.jpg',
      recentSubCategoryIds: ['crt_tv', 'crt_tv', 'crt_tv'],
    });
    assert.equal(result.candidates[0]!.subCategoryId, 'crt_tv');
  });
});

describe('access tokens', () => {
  const SECRET = 'server-signing-secret';
  const NOW_AUTH = new Date('2026-09-07T12:00:00.000Z');

  it('round-trips a token it signed', () => {
    const { token, expiresAt } = buildToken('collector', 'COL_1', SECRET, {
      deviceId: 'DEV_1',
      now: NOW_AUTH,
    });
    const result = verifyToken(token, SECRET, NOW_AUTH);
    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.equal(result.payload.sub, 'COL_1');
    assert.equal(result.payload.kind, 'collector');
    assert.equal(result.payload.did, 'DEV_1');
    assert.ok(Date.parse(expiresAt) > NOW_AUTH.getTime());
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = buildToken('collector', 'COL_1', SECRET, { now: NOW_AUTH });
    const result = verifyToken(token, 'other-secret', NOW_AUTH);
    assert.equal(result.valid, false);
    if (result.valid) return;
    assert.equal(result.reason, 'bad_signature');
  });

  it('rejects a payload edited after signing', () => {
    const { token } = buildToken('collector', 'COL_1', SECRET, { now: NOW_AUTH });
    const [version, , signature] = token.split('.') as [string, string, string];
    // Re-encode the payload as a recycler and keep the original signature.
    const forged = Buffer.from(
      JSON.stringify({ sub: 'REC_1', kind: 'recycler', iat: 0, exp: 9_999_999_999 }),
    )
      .toString('base64url');
    const result = verifyToken(`${version}.${forged}.${signature}`, SECRET, NOW_AUTH);
    assert.equal(result.valid, false);
    if (result.valid) return;
    assert.equal(result.reason, 'bad_signature');
  });

  it('rejects an expired token', () => {
    const { token } = buildToken('recycler', 'REC_1', SECRET, { now: NOW_AUTH, ttlSeconds: 60 });
    const later = new Date(NOW_AUTH.getTime() + 61_000);
    const result = verifyToken(token, SECRET, later);
    assert.equal(result.valid, false);
    if (result.valid) return;
    assert.equal(result.reason, 'expired');
  });

  it('rejects malformed tokens without throwing', () => {
    for (const bad of ['', 'nonsense', 'v1.only-two', 'v2.abc.def', 'v1..', 'v1.!!!.!!!']) {
      const result = verifyToken(bad, SECRET, NOW_AUTH);
      assert.equal(result.valid, false, `expected ${bad} to be rejected`);
    }
  });

  it('gives collectors a long life and recyclers a short one', () => {
    // A phone can be offline for days; a shared yard terminal should not stay
    // signed in overnight.
    assert.ok(COLLECTOR_TOKEN_TTL_SECONDS > RECYCLER_TOKEN_TTL_SECONDS * 100);
  });

  it('compares in constant time regardless of where strings differ', () => {
    assert.equal(constantTimeEqual('abc', 'abc'), true);
    assert.equal(constantTimeEqual('abc', 'abd'), false);
    assert.equal(constantTimeEqual('abc', 'abcd'), false);
  });
});

describe('one-time passcodes', () => {
  it('binds the code hash to the phone hash so it cannot be replayed elsewhere', () => {
    const a = hashOtp('phone-hash-a', '123456', 'secret');
    const b = hashOtp('phone-hash-b', '123456', 'secret');
    assert.notEqual(a, b);
    assert.equal(a, hashOtp('phone-hash-a', '123456', 'secret'));
  });

  it('normalises the ways an Indian mobile number gets typed', () => {
    for (const input of ['+91 98765 43210', '098765-43210', '9876543210', '+919876543210']) {
      assert.equal(normalisePhone(input), '9876543210', `failed for ${input}`);
    }
  });

  it('rejects numbers that cannot be Indian mobiles', () => {
    assert.equal(isPlausibleIndianMobile('9876543210'), true);
    assert.equal(isPlausibleIndianMobile('1234567890'), false, 'must start 6-9');
    assert.equal(isPlausibleIndianMobile('98765'), false, 'too short');
  });
});

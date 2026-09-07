import { z } from 'zod';
import { ALL_SUB_CATEGORY_IDS, MATERIAL_CATEGORIES } from '@ewaste/shared';

/**
 * Validation schemas.
 *
 * These are not decoration: every record entering the platform - a seed row, a
 * sync push from a phone, a recycler's rate update - goes through the matching
 * schema. A dataset that is only validated at generation time drifts the
 * moment real data arrives.
 */

const categoryId = z.enum(MATERIAL_CATEGORIES.map((c) => c.id) as [string, ...string[]]);
const subCategoryId = z.enum(ALL_SUB_CATEGORY_IDS as [string, ...string[]]);
const isoDateTime = z.string().datetime();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().optional(),
});

export const placeRefSchema = z.object({
  locality: z.string().min(1),
  district: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().regex(/^\d{6}$/).optional(),
  point: geoPointSchema.optional(),
});

export const materialItemSchema = z.object({
  materialId: z.string().min(1),
  lotId: z.string().min(1),
  categoryId,
  subCategoryId,
  description: z.string(),
  imageRefs: z.array(z.string()),
  approxWeightKg: z.number().positive().max(5000),
  unit: z.enum(['kg', 'piece']),
  quantity: z.number().int().positive(),
  condition: z.enum(['intact', 'partially_dismantled', 'broken', 'burnt', 'wet']),
  sourceType: z.enum(['household', 'shop', 'office', 'repair_shop', 'street_pickup', 'aggregator']),
  estimatedValueInr: z.number().nonnegative(),
  classificationSource: z.enum(['collector', 'model', 'recycler_corrected']),
  modelConfidence: z.number().min(0).max(1).optional(),
  createdAt: isoDateTime,
});

export const pricePointSchema = z
  .object({
    priceId: z.string().min(1),
    categoryId,
    subCategoryId,
    district: z.string().min(1),
    state: z.string().min(1),
    observedAt: isoDateTime,
    buyingPriceInr: z.number().positive(),
    quotedPriceInr: z.number().positive().optional(),
    unit: z.enum(['kg', 'piece']),
    currency: z.literal('INR'),
    marketLowInr: z.number().positive(),
    marketHighInr: z.number().positive(),
    recyclerId: z.string().optional(),
    source: z.enum(['recycler_quote', 'aggregator_board', 'completed_transaction', 'field_survey']),
    confidence: z.number().min(0).max(1),
  })
  .refine((p) => p.marketLowInr <= p.marketHighInr, {
    message: 'marketLowInr must not exceed marketHighInr',
    path: ['marketLowInr'],
  });

export const recyclerSchema = z.object({
  recyclerId: z.string().min(1),
  name: z.string().min(1),
  facilityType: z.enum(['recycler', 'dismantler', 'aggregator', 'collection_centre']),
  place: placeRefSchema,
  materialsAccepted: z.array(categoryId).min(1),
  authorizationNumber: z.string().min(1),
  authorizationIssuer: z.string().min(1),
  authorizationValidTill: isoDate,
  authorizationStatus: z.enum(['authorized', 'expired', 'suspended', 'unverified']),
  contactPhone: z.string().min(6),
  contactPersonName: z.string().optional(),
  offeredRatesInr: z.record(z.string(), z.number().nonnegative()),
  pickupAvailable: z.boolean(),
  pickupMinWeightKg: z.number().nonnegative().optional(),
  serviceAreaRadiusKm: z.number().positive().max(500),
  paymentModes: z.array(z.enum(['cash', 'upi', 'bank_transfer'])).min(1),
  rating: z.number().min(0).max(5).optional(),
  ratingCount: z.number().int().nonnegative(),
  updatedAt: isoDateTime,
});

export const collectorSchema = z.object({
  collectorId: z.string().min(1),
  phoneHash: z.string().min(8),
  preferredLanguage: z.enum(['mr', 'hi', 'en']),
  operatingDistrict: z.string().min(1),
  operatingState: z.string().min(1),
  createdAt: isoDateTime,
  lifetimeEarningsInr: z.number().nonnegative(),
  pendingDuesInr: z.number().nonnegative(),
  completedTransactions: z.number().int().nonnegative(),
});

export const lotSchema = z.object({
  lotId: z.string().min(1),
  collectorId: z.string().min(1),
  status: z.enum(['draft', 'ready', 'offered', 'accepted', 'handed_over', 'confirmed', 'paid', 'cancelled', 'disputed']),
  items: z.array(materialItemSchema).min(1),
  totalWeightKg: z.number().positive(),
  estimatedValueInr: z.number().nonnegative(),
  collectionPlace: placeRefSchema,
  collectedAt: isoDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  recyclerId: z.string().optional(),
  quotedPriceInr: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export const transactionSchema = z
  .object({
    transactionId: z.string().min(1),
    lotId: z.string().min(1),
    collectorId: z.string().min(1),
    recyclerId: z.string().min(1),
    categorySummary: z.array(categoryId).min(1),
    totalWeightKg: z.number().positive(),
    estimatedValueInr: z.number().nonnegative(),
    quotedPriceInr: z.number().nonnegative(),
    finalPriceInr: z.number().nonnegative(),
    collectionPlace: placeRefSchema,
    handoverPlace: placeRefSchema,
    handoverAt: isoDateTime,
    paymentStatus: z.enum(['unpaid', 'partial', 'paid']),
    paymentMode: z.enum(['cash', 'upi', 'bank_transfer']),
    paidAt: isoDateTime.optional(),
    status: z.enum(['pending', 'completed', 'cancelled', 'disputed']),
    anomalyFlags: z.array(z.string()),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .refine((t) => !(t.paymentStatus === 'paid' && !t.paidAt), {
    message: 'a paid transaction must carry paidAt',
    path: ['paidAt'],
  });

export const handoverSchema = z.object({
  handoverRef: z.string().regex(/^HO-[0-9A-Z]{4}-[0-9A-Z]{4}$/),
  lotId: z.string().min(1),
  collectorId: z.string().min(1),
  recyclerId: z.string().min(1),
  verificationCode: z.string().regex(/^\d{6}$/),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  photoRefs: z.array(z.string()),
  photoHashes: z.array(z.string()),
  weighedWeightKg: z.number().positive(),
  declaredWeightKg: z.number().positive(),
  handoverPoint: geoPointSchema,
  handoverPlace: placeRefSchema,
  createdAt: isoDateTime,
  confirmedAt: isoDateTime.optional(),
  confirmedBy: z.string().optional(),
  confirmationStatus: z.enum(['pending', 'confirmed', 'rejected']),
  rejectionReason: z.string().optional(),
  downstreamStatus: z.enum(['received', 'sorted', 'processed', 'reported_to_epr']).optional(),
  transactionId: z.string().optional(),
});

export const trainingSampleSchema = z.object({
  sampleId: z.string().min(1),
  imageRef: z.string().min(1),
  imageHash: z.string().min(8),
  labelCategoryId: categoryId,
  labelSubCategoryId: subCategoryId,
  labelSource: z.enum(['collector', 'recycler_corrected', 'expert_review']),
  weightKg: z.number().positive(),
  district: z.string().min(1),
  observedPriceInr: z.number().nonnegative(),
  finalPriceInr: z.number().nonnegative().optional(),
  capturedAt: isoDateTime,
  split: z.enum(['train', 'val', 'test']),
  synthetic: z.boolean(),
});

export const DATASET_SCHEMAS = {
  material: materialItemSchema,
  price: pricePointSchema,
  recycler: recyclerSchema,
  collector: collectorSchema,
  lot: lotSchema,
  transaction: transactionSchema,
  handover: handoverSchema,
  training: trainingSampleSchema,
} as const;

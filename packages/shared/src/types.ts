/**
 * Canonical data model for the platform.
 *
 * Every entity here maps 1:1 to one of the datasets required by the problem
 * statement (Material, Price, Recycler, Transaction, Traceability, Collector,
 * AI/ML training). The same shapes are used by the mobile app's local SQLite
 * store, the API, and the dataset seed files, so a record can travel from a
 * collector's phone to the analytics warehouse without being reshaped.
 */

export type ISODateTime = string; // e.g. "2026-03-14T09:12:00.000Z"
export type ISODate = string; // e.g. "2026-03-14"
export type LanguageCode = 'mr' | 'hi' | 'en';
export type Unit = 'kg' | 'piece';
export type Currency = 'INR';

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres, as reported by the device. */
  accuracyM?: number;
}

export interface PlaceRef {
  /** Free-text locality, e.g. "Bhosari, Pune". */
  locality: string;
  district: string;
  state: string;
  pincode?: string;
  point?: GeoPoint;
}

/* ------------------------------------------------------------------ */
/* Material dataset                                                    */
/* ------------------------------------------------------------------ */

export type MaterialCategoryId =
  | 'crt'
  | 'lcd_panel'
  | 'pcb'
  | 'cable'
  | 'battery'
  | 'motor_magnet'
  | 'mixed_plastic';

export type MaterialCondition = 'intact' | 'partially_dismantled' | 'broken' | 'burnt' | 'wet';

export type SourceType =
  | 'household'
  | 'shop'
  | 'office'
  | 'repair_shop'
  | 'street_pickup'
  | 'aggregator';

/** One physical parcel of material inside a lot. */
export interface MaterialItem {
  materialId: string;
  lotId: string;
  categoryId: MaterialCategoryId;
  subCategoryId: string;
  /** Collector-supplied or auto-generated description; may be empty for low-literacy users. */
  description: string;
  /** Local file URI on device, and object key once synced. */
  imageRefs: string[];
  approxWeightKg: number;
  unit: Unit;
  quantity: number;
  condition: MaterialCondition;
  sourceType: SourceType;
  estimatedValueInr: number;
  /** How the category was decided - important for the AI/ML training set. */
  classificationSource: 'collector' | 'model' | 'recycler_corrected';
  modelConfidence?: number;
  createdAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Price dataset                                                       */
/* ------------------------------------------------------------------ */

export type PriceSource =
  | 'recycler_quote'
  | 'aggregator_board'
  | 'completed_transaction'
  | 'field_survey';

export interface PricePoint {
  priceId: string;
  categoryId: MaterialCategoryId;
  subCategoryId: string;
  /** District-level granularity keeps the dataset useful without exposing collectors. */
  district: string;
  state: string;
  observedAt: ISODateTime;
  /** What a buyer pays the collector. */
  buyingPriceInr: number;
  /** What the buyer quotes onward, when known. */
  quotedPriceInr?: number;
  unit: Unit;
  currency: Currency;
  marketLowInr: number;
  marketHighInr: number;
  recyclerId?: string;
  source: PriceSource;
  /** 0-1; survey and completed transactions score higher than scraped boards. */
  confidence: number;
}

export interface PriceBoardEntry {
  categoryId: MaterialCategoryId;
  subCategoryId: string;
  district: string;
  unit: Unit;
  fairPriceInr: number;
  marketLowInr: number;
  marketHighInr: number;
  bestRecyclerRateInr?: number;
  bestRecyclerId?: string;
  asOf: ISODateTime;
  sampleSize: number;
  trend: PriceTrend;
  /**
   * Whether this row is built from observations in the requested district or
   * from the national rollup. A national figure shown under a local heading is
   * a lie a collector would act on, so the basis travels with the number.
   */
  basis: 'local_data' | 'national_data';
}

export interface PriceTrend {
  direction: 'up' | 'down' | 'flat';
  /** Percentage change of the 7-day mean against the previous 7-day mean. */
  changePct: number;
  window: '7d' | '30d';
  /** Sparkline-friendly series of daily means, oldest first. */
  series: Array<{ date: ISODate; meanPriceInr: number }>;
}

/* ------------------------------------------------------------------ */
/* Recycler dataset                                                    */
/* ------------------------------------------------------------------ */

export type AuthorizationStatus = 'authorized' | 'expired' | 'suspended' | 'unverified';
export type FacilityType = 'recycler' | 'dismantler' | 'aggregator' | 'collection_centre';

export interface Recycler {
  recyclerId: string;
  name: string;
  facilityType: FacilityType;
  place: PlaceRef;
  /** Category ids this facility will take. */
  materialsAccepted: MaterialCategoryId[];
  /** Registration reference issued under the E-Waste (Management) Rules, 2022. */
  authorizationNumber: string;
  authorizationIssuer: string;
  authorizationValidTill: ISODate;
  authorizationStatus: AuthorizationStatus;
  contactPhone: string;
  contactPersonName?: string;
  /** Rate card, keyed by `${categoryId}:${subCategoryId}` or `${categoryId}:*`. */
  offeredRatesInr: Record<string, number>;
  pickupAvailable: boolean;
  pickupMinWeightKg?: number;
  serviceAreaRadiusKm: number;
  paymentModes: Array<'cash' | 'upi' | 'bank_transfer'>;
  /** Rolling average of collector ratings, 0-5. Undefined until 3 ratings exist. */
  rating?: number;
  ratingCount: number;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Collector dataset                                                   */
/* ------------------------------------------------------------------ */

/**
 * Deliberately minimal. No name, no address, no ID document: a phone hash and
 * an operating district are enough to run the platform.
 */
export interface Collector {
  collectorId: string;
  /** Salted hash of the phone number. The raw number never leaves the device. */
  phoneHash: string;
  preferredLanguage: LanguageCode;
  operatingDistrict: string;
  operatingState: string;
  createdAt: ISODateTime;
  /** Denormalised counters so the ledger renders instantly offline. */
  lifetimeEarningsInr: number;
  pendingDuesInr: number;
  completedTransactions: number;
}

/* ------------------------------------------------------------------ */
/* Lot + transaction dataset                                           */
/* ------------------------------------------------------------------ */

export type LotStatus =
  | 'draft'
  | 'ready'
  | 'offered'
  | 'accepted'
  | 'handed_over'
  | 'confirmed'
  | 'paid'
  | 'cancelled'
  | 'disputed';

export interface Lot {
  lotId: string;
  collectorId: string;
  status: LotStatus;
  items: MaterialItem[];
  totalWeightKg: number;
  estimatedValueInr: number;
  collectionPlace: PlaceRef;
  collectedAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Set once a recycler accepts. */
  recyclerId?: string;
  quotedPriceInr?: number;
  notes?: string;
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type PaymentMode = 'cash' | 'upi' | 'bank_transfer';
export type TransactionStatus = 'pending' | 'completed' | 'cancelled' | 'disputed';

export interface Transaction {
  transactionId: string;
  lotId: string;
  collectorId: string;
  recyclerId: string;
  categorySummary: MaterialCategoryId[];
  totalWeightKg: number;
  estimatedValueInr: number;
  quotedPriceInr: number;
  finalPriceInr: number;
  collectionPlace: PlaceRef;
  handoverPlace: PlaceRef;
  handoverAt: ISODateTime;
  paymentStatus: PaymentStatus;
  paymentMode: PaymentMode;
  paidAt?: ISODateTime;
  status: TransactionStatus;
  /** Populated by the anomaly service; null means "checked, looked normal". */
  anomalyFlags: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Traceability dataset                                                */
/* ------------------------------------------------------------------ */

export interface HandoverRecord {
  handoverRef: string;
  lotId: string;
  collectorId: string;
  recyclerId: string;
  /** Short code the recycler types in if the QR cannot be scanned. */
  verificationCode: string;
  /** Tamper-evident digest over the immutable fields below. */
  digest: string;
  photoRefs: string[];
  /** Hashes of the photos, so a photo swap is detectable after sync. */
  photoHashes: string[];
  weighedWeightKg: number;
  declaredWeightKg: number;
  handoverPoint: GeoPoint;
  handoverPlace: PlaceRef;
  createdAt: ISODateTime;
  confirmedAt?: ISODateTime;
  confirmedBy?: string;
  confirmationStatus: 'pending' | 'confirmed' | 'rejected';
  rejectionReason?: string;
  /** Downstream status reported by the recycler after processing. */
  downstreamStatus?: 'received' | 'sorted' | 'processed' | 'reported_to_epr';
  transactionId?: string;
}

/* ------------------------------------------------------------------ */
/* AI/ML training dataset                                              */
/* ------------------------------------------------------------------ */

export interface TrainingSample {
  sampleId: string;
  imageRef: string;
  imageHash: string;
  /** Label as finally agreed - recycler correction wins over collector entry. */
  labelCategoryId: MaterialCategoryId;
  labelSubCategoryId: string;
  labelSource: 'collector' | 'recycler_corrected' | 'expert_review';
  weightKg: number;
  district: string;
  observedPriceInr: number;
  finalPriceInr?: number;
  capturedAt: ISODateTime;
  /** Train / validation / test split, assigned deterministically by hash. */
  split: 'train' | 'val' | 'test';
  /** True when the sample came from the synthetic seed rather than the field. */
  synthetic: boolean;
}

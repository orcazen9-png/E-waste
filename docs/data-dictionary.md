# Data dictionary

Every dataset the problem statement requires, with its field list, where the
values come from, and how they are validated. The authoritative definitions are
`packages/shared/src/types.ts` (shape) and `packages/datasets/src/schemas.ts`
(validation); this document explains the fields that are not self-evident.

Storage: `apps/api/prisma/schema.prisma` (Postgres) and
`apps/collector/src/db/schema.ts` (on-device SQLite). Both mirror the same
model; the phone carries a subset.

---

## 1. Material dataset — `MaterialItem`

One physical parcel inside a lot.

| Field | Type | Source | Notes |
| --- | --- | --- | --- |
| `materialId` | id | device | Generated offline; sortable by time |
| `lotId` | ref → Lot | device | |
| `categoryId` | enum(7) | collector tap | `crt`, `lcd_panel`, `pcb`, `cable`, `battery`, `motor_magnet`, `mixed_plastic` |
| `subCategoryId` | enum(28) | collector tap | e.g. `cable_copper_house` |
| `description` | text | optional | Usually empty — typing is not required of a low-literacy user |
| `imageRefs` | uri[] | camera | Local file URIs; not uploaded yet |
| `approxWeightKg` | float | collector | Entered with +/- steppers, not a keyboard |
| `unit` | enum | taxonomy | `kg` or `piece` |
| `quantity` | int | collector | Used with `typicalPieceWeightKg` for plausibility checks |
| `condition` | enum(5) | collector tap | `intact`, `partially_dismantled`, `broken`, `burnt`, `wet` |
| `sourceType` | enum(6) | collector | household, shop, office, repair shop, street pickup, aggregator |
| `estimatedValueInr` | money | **derived** | `RuleBasedValuer` over the cached price index |
| `classificationSource` | enum | system | `collector`, `model`, or `recycler_corrected` — the provenance of the label |
| `modelConfidence` | 0–1 | model | Present only when a model proposed the category |

`classificationSource` is the field that makes the AI/ML story possible.
`recycler_corrected` marks a label a professional disagreed with and fixed;
those are the highest-value training rows the platform produces.

## 2. Price dataset — `PricePoint`

| Field | Type | Source | Notes |
| --- | --- | --- | --- |
| `priceId` | id | system | |
| `categoryId`, `subCategoryId` | enum | taxonomy | |
| `district`, `state` | text | — | District granularity: fine enough to be useful, coarse enough not to expose a collector's route |
| `observedAt` | timestamp | — | |
| `buyingPriceInr` | money | — | What a buyer pays the collector |
| `quotedPriceInr` | money? | — | What the buyer quotes onward, when known |
| `unit` | enum | taxonomy | |
| `marketLowInr`, `marketHighInr` | money | — | Observed band |
| `recyclerId` | ref? | — | Null for survey and board observations |
| `source` | enum(4) | system | `completed_transaction`, `recycler_quote`, `aggregator_board`, `field_survey` |
| `confidence` | 0–1 | system | 0.9 settled, 0.85 survey, 0.7 quote, 0.55 board |

**Derived artefact — `PriceIndex`.** Per `(subCategory, district)`: median, p25,
p75, market band, sample size, `asOf`, and a daily-mean series. Plus a `*`
national rollup used as fallback. A few KB per district, shipped to phones so
valuation works offline. Rebuilt nightly and on every confirmed transaction.

Medians and MAD are used throughout, never means and standard deviations: with
a handful of observations per district, one bad quote would drag a mean-based
statistic far enough to hide everything else.

## 3. Recycler dataset — `Recycler`

| Field | Type | Notes |
| --- | --- | --- |
| `recyclerId` | id | |
| `name` | text | Seed records are prefixed `[Demo]` |
| `facilityType` | enum(4) | recycler, dismantler, aggregator, collection centre |
| `place` | PlaceRef | locality, district, state, optional point |
| `materialsAccepted` | categoryId[] | Hard filter in matching |
| `authorizationNumber` | text | Seed records prefixed `SYN/` |
| `authorizationIssuer` | text | SPCB / CPCB in production |
| `authorizationValidTill` | date | Expiry is checked at match time, not just status |
| `authorizationStatus` | enum(4) | `authorized`, `expired`, `suspended`, `unverified` |
| `contactPhone` | text | |
| `offeredRatesInr` | map | Keys `categoryId:subCategoryId`, with a `categoryId:*` fallback |
| `pickupAvailable`, `pickupMinWeightKg` | bool, float | |
| `serviceAreaRadiusKm` | float | A facility beyond its own radius is excluded — an offer it will not honour is not an offer |
| `paymentModes` | enum[] | cash, upi, bank_transfer |
| `rating`, `ratingCount` | float?, int | Undefined below 3 ratings; unknown scores neutral, not bad |

Only `authorized` facilities are ever ranked. Others appear in `excluded` with
a reason the collector can read.

## 4. Collector dataset — `Collector`

Deliberately minimal. No name, no address, no ID document.

| Field | Type | Notes |
| --- | --- | --- |
| `collectorId` | id | Generated on-device on first run |
| `phoneHash` | hash | HMAC of the number with a server salt. **The raw number never leaves the device.** |
| `preferredLanguage` | enum | `mr`, `hi`, `en` |
| `operatingDistrict`, `operatingState` | text | |
| `lifetimeEarningsInr`, `pendingDuesInr`, `completedTransactions` | derived | Denormalised so the ledger renders instantly offline; reconciled against transactions by the validator |

The people this serves have good reasons to be wary of registration. Collecting
less is a feature.

## 5. Transaction dataset — `Transaction`

| Field | Type | Notes |
| --- | --- | --- |
| `transactionId`, `lotId`, `collectorId`, `recyclerId` | ids | |
| `categorySummary` | categoryId[] | Denormalised for reporting |
| `totalWeightKg` | float | |
| `estimatedValueInr` | money | What the app told the collector to expect |
| `quotedPriceInr` | money | What the buyer offered |
| `finalPriceInr` | money | What was actually paid |
| `collectionPlace`, `handoverPlace` | PlaceRef | |
| `handoverAt`, `paidAt` | timestamps | |
| `paymentStatus` | enum(3) | `unpaid`, `partial`, `paid` |
| `paymentMode` | enum(3) | cash first |
| `status` | enum(4) | `pending`, `completed`, `cancelled`, `disputed` |
| `anomalyFlags` | code[] | Empty array means *checked and clean*, not *unchecked* |

Keeping estimate, quote and final price as three separate fields is what makes
underpayment detectable. Collapsing them into one "price" would destroy the
signal.

## 6. Traceability dataset — `HandoverRecord`

| Field | Type | Notes |
| --- | --- | --- |
| `handoverRef` | `HO-XXXX-XXXX` | Crockford base32 without I/L/O/U — safe to read aloud |
| `verificationCode` | 6 digits | Derived from the reference and the device secret |
| `digest` | sha256 hex | HMAC over the canonical payload |
| `photoRefs`, `photoHashes` | uri[], hash[] | Hashes make a photo swap detectable after sync |
| `declaredWeightKg` | float | What the collector said |
| `weighedWeightKg` | float | What the scale said |
| `handoverPoint`, `handoverPlace` | GeoPoint, PlaceRef | |
| `createdAt`, `confirmedAt`, `confirmedBy` | — | |
| `confirmationStatus` | enum(3) | `pending`, `confirmed`, `rejected` |
| `downstreamStatus` | enum(4)? | `received` → `sorted` → `processed` → `reported_to_epr` |
| `transactionId` | ref? | |

Declared and weighed weight are kept separately and shown side by side in the
recycler console. That gap is where a collector most often loses money.

Records are immutable once confirmed. Corrections are new rows, never edits.

## 7. AI/ML training dataset — `TrainingSample`

| Field | Type | Notes |
| --- | --- | --- |
| `sampleId` | id | |
| `imageRef`, `imageHash` | uri, hash | |
| `labelCategoryId`, `labelSubCategoryId` | enum | Recycler correction wins over collector entry |
| `labelSource` | enum(3) | `collector`, `recycler_corrected`, `expert_review` |
| `weightKg`, `district`, `observedPriceInr`, `finalPriceInr` | — | |
| `split` | enum(3) | Assigned by hash of the image, so it is stable as the dataset grows |
| `synthetic` | bool | True for every seed row |

Splitting by image hash rather than at random is what stops the same photograph
appearing in train and test. The validator fails the build if it ever does.

---

## Validation

`pnpm data:validate` — 22 checks, non-zero exit on failure:

- schema conformance for every row of every dataset (zod);
- nine referential-integrity relationships;
- all ~1,040 handover digests re-verified cryptographically;
- price coverage across all 28 sub-categories, with thin district cells warned;
- primary-key uniqueness;
- no image hash in more than one split;
- every seeded facility marked synthetic;
- collector ledger totals reconciled against transactions.

The same zod schemas validate sync pushes from phones and rate updates from
recyclers. A dataset validated only at build time drifts the moment real data
arrives.

## How data is created and updated in production

| Dataset | Created by | Updated by |
| --- | --- | --- |
| Material | Collector recording a lot | Recycler correcting a category |
| Price | Seed + partner rate cards | **Every confirmed transaction** |
| Recycler | SPCB/CPCB authorisation lists | Facility rate updates, authorisation renewals |
| Collector | First app run | Transaction confirmations |
| Transaction | Recycler confirming a handover | Payment settlement |
| Traceability | Collector's phone, offline | Recycler confirmation, then downstream status |
| Training | Derived from material + transactions | Every recycler correction |

## Privacy

- Raw phone numbers never reach the server — only an HMAC.
- No name, address or ID document is collected.
- Collection coordinates can be coarsened to ~1.1 km (`coarsen`) before any
  aggregate publication, so a route cannot be reconstructed.
- Photos stay on the device; only hashes travel.
- Analytical exports should carry district, not point, and a rotating
  pseudonymous collector id rather than the stable one.

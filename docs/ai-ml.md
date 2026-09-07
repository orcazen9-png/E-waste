# AI / ML

## Position

No learned model is deployed. Four capabilities the brief asks for —
classification, valuation, recycler matching, anomaly detection — are
implemented as transparent rules behind interfaces a model can later implement.

This is a deliberate choice, not a shortfall, and the reasoning matters:

**There is no honest image model without field photographs.** A classifier
trained on web images of clean, well-lit electronics will not survive a sack of
mixed scrap photographed at dusk on a cracked camera. Shipping one and calling
it accurate would mislead the people who need it most.

**A collector must be able to argue with the number.** The rule-based valuer
returns reason codes — "based on 12 recent sales in Pune", "adjusted because it
is burnt" — that the app renders in Marathi. A regression that outputs ₹340
with no explanation is, from the collector's side, indistinguishable from the
aggregator who says "this is what it's worth" today.

**Rules give the model something to beat.** `scripts/evaluate.ts` scores the
rules against ground truth. A model that does not beat these numbers on the
same split does not ship.

## The four interfaces

| Capability | Interface | Implementation now | What replaces it |
| --- | --- | --- | --- |
| Material classification | `MaterialClassifier` | `PriorBasedClassifier` — district and recency priors that re-order the picker | On-device CNN (MobileNetV3 / EfficientNet-Lite, TFLite) |
| Valuation | `Valuer` | `RuleBasedValuer` — median of local price index, condition and bulk factors | Gradient-boosted regressor on category × weight × district × time × condition |
| Recycler matching | `RecyclerMatcher` | `WeightedRecyclerMatcher` — weighted score with per-factor breakdown | Learning-to-rank on accepted-vs-ignored offers |
| Anomaly detection | `AnomalyDetector` | `RuleBasedAnomalyDetector` — price, weight, photo and geography checks | Isolation forest / autoencoder over the same features, rules retained as a floor |

Swapping one means constructing the service with a different implementation.
No route changes, no UI changes.

## The classifier never auto-selects

`PriorBasedClassifier` returns candidates with an `autoSelectThreshold` of
`1.1` — deliberately unreachable. It re-orders the pictorial picker so likely
answers come first; the collector always taps the final choice.

That tap is the label. It is also why the honest thing to do today is a prior
rather than a fake model: the interaction that collects training data is the
same either way, and the collector is not misled in the meantime.

The endpoint says so in its response:

```json
{ "isPrior": true, "note": "No image model is deployed. These are frequency
  priors that re-order the picker; the collector chooses." }
```

## Training data: what exists and what does not

`packages/datasets/data/training_manifest.csv` — 2,653 rows with labels,
weights, districts, settled prices and a deterministic train/val/test split
(1,813 / 431 / 409).

**The images do not exist.** The manifest lists `synthetic://` references. No
photographs are in this repository and none can be synthesised honestly.

To train a real classifier you need, at minimum:

- **2,000–5,000 field photographs**, 100+ per sub-category, taken on the phones
  collectors actually use, in the light they actually work in — not studio
  shots, not web scrapes;
- **labels confirmed by a recycler**, not only by the collector who took the
  photo;
- **an explicit consent process**, since the photographs come from people's
  work and sometimes their homes;
- **a split by collector**, not only by image, so the model is not evaluated on
  photographs from the same person, camera and lane it trained on.

Once the app is in the field, that dataset builds itself: every lot is a
photograph plus a collector label, and every recycler correction is a
professional's label on the same image.

## The label loop

```
collector photographs  →  picker (prior-ordered)  →  collector taps a category
        │                                                     │
        │                                    classificationSource = 'collector'
        ▼                                                     │
recycler receives the lot  →  disagrees  →  corrects  ────────┘
                                              │
                              classificationSource = 'recycler_corrected'
                                              │
                                     highest-value training row
```

Corrections are worth far more than agreements: they are precisely the cases a
model would get wrong.

## Evaluation harness

`node --experimental-transform-types scripts/evaluate.ts`:

```
Anomaly detection vs injected ground truth
  transactions 1042   injected 56   flagged 57
  precision 0.982   recall 1.000   f1 0.991
  underpayment 24/24   weight_shortfall 12/12   duplicate_photo 20/20

Valuation estimate vs settled price (clean transactions)
  median error 4.7%   mean absolute error 5.5%   within 20%: 99.9%
```

**These are a regression baseline, not field accuracy.** They score rules
against synthetic data generated by a related process. They prove the rules are
wired up and catch what they are meant to catch, and they fail loudly when a
rule breaks — which they did, twice, during development:

- the anomaly detector derived fair value from raw median rates while the app's
  valuer applied condition discounts, so every legitimately discounted lot read
  as underpayment: 259 of 1,042 transactions falsely flagged, precision 0.147;
- duplicate-photo detection never ran, because the known-hash set was never
  passed to it — recall 0.15 on that class, a dead rule.

Neither was visible to the 22 schema and integrity checks. Scoring against
ground truth is what found them.

## Anomaly detection, and why it uses medians

Median + MAD, never mean + standard deviation. With a handful of observations
per district, one bad quote drags a mean far enough to hide everything else.

The checks:

| Code | Severity | Catches |
| --- | --- | --- |
| `PRICE_FAR_BELOW_MARKET` | critical | ≥35% under condition-adjusted fair value |
| `PRICE_BELOW_MARKET` | warn | ≥18% under |
| `PRICE_IMPLAUSIBLY_HIGH` | warn | ≥60% over — usually a unit mix-up |
| `FINAL_BELOW_QUOTE` | critical | Paid ≥15% less than promised |
| `OUTLIER_VS_COLLECTOR_HISTORY` | warn | Robust z ≤ −3 against this collector's own norm |
| `WEIGHT_IMPLAUSIBLE_FOR_CATEGORY` | warn | Per-piece mass outside 4× the reference |
| `WEIGHT_MISMATCH_AT_HANDOVER` | critical/warn | Declared vs weighed differ ≥20% |
| `DUPLICATE_PHOTO` | critical | Photo reused from another lot |
| `HANDOVER_BEFORE_COLLECTION` | critical | Impossible ordering |
| `IMPOSSIBLE_TRAVEL` | warn | >120 km/h implied |
| `HANDOVER_FAR_FROM_COLLECTION` | info | >150 km |

**The fair-value baseline comes from the same `Valuer` the collector was
shown.** This is the single most important detail in the module. Warning a
collector that an honest offer is a rip-off is the fastest way to lose their
trust, and a platform whose warnings are noise is worse than no platform.

## Bias and harm

- **Thin districts get national prices.** A collector in a district with few
  observations sees a national median. The API and app label it
  `national_data`, because a national figure under a local heading is a number
  someone would act on.
- **A model trained on early adopters** will fit their materials, their light
  and their phones. Reporting accuracy per district and per collector cohort is
  a requirement, not a nicety.
- **Anomaly flags can become accusations.** They are shown to the collector as
  advice ("check before selling"), never as an automatic block, and never as a
  score attached to a recycler without evidence.
- **A confident wrong valuation costs someone a day's earnings.** Below 0.45
  confidence the app says "this is a rough guess" instead of showing a firm
  number.

## Roadmap

1. **Field data collection** (pilot) — 2,000+ labelled photographs with
   consent, split by collector.
2. **Valuation regressor** — the easiest honest win: the data is already
   structured and the label (settled price) is unambiguous. Ship behind the
   `Valuer` interface, A/B against rules on the same split.
3. **Image classifier** — TFLite on-device, quantised to fit an entry-level
   phone. Must stay a picker re-ordering, not an auto-selection, until it is
   demonstrably better than the collector.
4. **Learning-to-rank matching** — needs accepted/ignored offer data the
   platform does not yet generate.
5. **Learned anomaly detection** — with the rules retained as a floor, because
   an unexplainable fraud flag against a named recycler is not defensible.

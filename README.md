# A digital bridge between informal e-waste collectors and authorised recyclers

Most of India's end-of-life electronics is collected by informal scrap dealers
and waste-pickers who have the last-mile reach the formal system lacks — and
almost no access to it. Material that could yield lithium, cobalt, neodymium,
tantalum, gallium and indium instead gets burned for copper in the open, or
acid-stripped for gold in a backyard.

The gap is not mainly technological. A collector usually cannot find out what
their material is worth today, which nearby recycler is actually authorised,
how to hand material over in a way that counts, or how to get a record of the
sale. Without those, the formal route is extra work for no gain.

This repository is a working prototype of the four things that close that gap:
**a fair price you can hear in your own language, an authorised buyer you can
reach, a handover that produces a record, and money you can point at.**

---

## Quick start

```bash
pnpm install

pnpm api:dev      # http://localhost:3001  — no database needed
pnpm web:dev      # http://localhost:5173  — recycler console
pnpm app:start    # Expo; press 'a' for an Android device or emulator

pnpm test         # 134 tests across shared, datasets, API and collector
pnpm data:validate   # 22 dataset checks
```

The API defaults to `DATA_SOURCE=seed` and runs entirely in memory off the
synthetic dataset, so the whole system works on a clean checkout with no
infrastructure. Postgres is a one-line switch (`apps/api/README.md`).

## What is here

```
packages/shared      Domain logic, framework-free. Taxonomy, valuation,
                     matching, anomaly detection, handover signing, sync
                     rules, safety cards, mr/hi/en strings.
packages/datasets    Seeded generator for all seven datasets, zod validation,
                     and the harness that scores the rules against ground truth.
apps/api             Fastify. Repository port with in-memory and Postgres
                     adapters.
apps/collector       Expo / React Native. Offline-first, pictorial, spoken.
apps/recycler-web    Vite + React. Verify, weigh, settle, confirm, trace.
docs/                Architecture, data dictionary, offline sync, AI/ML,
                     unit economics, field-research protocol.
```

### One domain library, three runtimes

`@ewaste/shared` is imported as **TypeScript source** by the phone, the browser
and the server. A collector offline sees a price computed by the same
`RuleBasedValuer` the server runs when the lot syncs, and the recycler's
console renders the same explanation from the same reason codes.

In a product whose whole proposition is *you can trust this number*, three
implementations that could drift is not an option.

## Decisions worth defending

**The server never mints a handover slip.** The phone builds and signs it
offline; the server verifies. If a slip needed connectivity it would fail
exactly where connectivity is worst — in the yard, at the scale.

**The QR and the six-digit code are equally prominent.** Scanning fails
constantly in the field: cracked screens, bright sun, a recycler with no
camera. Six digits read aloud always work.

**Anomaly detection uses the same valuer the collector was shown.** Getting
this wrong falsely flagged 259 of 1,042 transactions as underpayment, because
legitimately discounted material — broken, burnt, wet — looked cheap. Warning
a collector that an honest offer is a rip-off is the fastest way to lose them.

**Local and national prices are never conflated.** Where a district has no
observations the national rollup is used and the response says
`basis: 'national_data'`. A national median under a local heading is a number
someone would act on.

**The classifier never auto-selects.** It re-orders the pictorial picker; the
collector always taps. That tap is the training label, and nobody is misled in
the meantime.

**Commission is charged to the recycler, not the collector.** Taking a cut from
the collector recreates the middleman the platform routes around — and they can
see it happen in their own ledger.

**Cash is first-class.** No screen requires a UPI ID or a bank account.

**Identity comes from the token, never the request body.** A collector asking
for someone else's record gets 404, not 403 — a 403 confirms the id exists,
which is an enumeration oracle over a list of people whose earnings these are.

## Verified, and not

**Verified here:**

- 134 automated tests — 57 domain, 14 dataset, 54 API integration, 9 collector
  ledger — all passing.
- 22 dataset validation checks, including cryptographic re-verification of every
  handover digest.
- Rule scoring against injected ground truth: anomaly precision 0.962, recall
  1.000; valuation median error 4.3% against settled prices. Thresholded, so a
  regression fails CI. **A regression baseline on synthetic data, not field
  accuracy.**
- The API booted and driven over HTTP; the recycler console driven end-to-end
  in a real browser, including sign-in, refusal of a wrong code, session
  persistence across reload, sign-out, and refusal of a tampered handover QR.
- The collector app typechecks under `strict` and bundles for Android
  (761 modules, 2.46 MB Hermes bytecode).

**Not verified:**

- The collector app has not run on a device or emulator. Layouts, camera, GPS
  and the text-to-speech fallback chain are unexercised.
- The Postgres adapter is typechecked and reviewed but not exercised by tests,
  which run without a database.
- **No field research has been conducted.** `docs/field-research.md` is the
  protocol for it, not a report. The assumption the economics hinge on — what a
  collector receives versus the authorised gate rate — is untested.

## Honest limitations

- **No SMS provider is wired up.** Sign-in works, but in development the
  one-time code comes back in the API response; with `AUTH_DEV_MODE` off the
  request fails loudly rather than pretending to send anything.
- **No account recovery.** Losing the phone number loses the account. For a
  record meant to become someone's financial history, this must be solved
  before a pilot.
- **All seed data is synthetic.** Facilities are prefixed `[Demo]` and their
  authorisation numbers `SYN/`. Replace `recyclers.json` from SPCB/CPCB
  authorisation lists before any pilot.
- **No image model exists**, and no training photographs exist. See
  `docs/ai-ml.md` for what collecting them honestly requires.
- **A recycler cannot verify a slip offline.** The digest is symmetric, so the
  QR is a lookup token rather than a self-proving credential.
- **~25–40 MB release APK** is realistic for entry-level Android but is not
  "small" by the standard the brief sets.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | System shape, the handover record, sync rules, known gaps |
| [`docs/data-dictionary.md`](docs/data-dictionary.md) | All seven datasets, field by field, with provenance and privacy |
| [`docs/offline-sync.md`](docs/offline-sync.md) | Local storage, outbox, conflicts, idempotency, degradation |
| [`docs/ai-ml.md`](docs/ai-ml.md) | The four interfaces, why rules ship first, the label loop, bias |
| [`docs/unit-economics.md`](docs/unit-economics.md) | Parametric model, sensitivity, what breaks it, what to measure |
| [`docs/security.md`](docs/security.md) | Sign-in, tokens, rate limits, authorisation rules, gaps |
| [`docs/field-research.md`](docs/field-research.md) | Protocol, consent, questions, usability scoring |
| [`packages/datasets/README.md`](packages/datasets/README.md) | Dataset card: generation, validation, scoring, limitations |

## Next

1. Field research with 2–4 collectors and an aggregator — settle the margin
   assumption before building anything else.
2. Wire an SMS provider, and design account recovery.
3. Photo upload and storage, so traceability evidence is viewable downstream.
4. Run the app on real devices; fix what the usability sessions surface.
5. Replace synthetic recyclers with a real authorisation list for one district.

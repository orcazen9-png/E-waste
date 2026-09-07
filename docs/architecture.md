# Architecture

## The problem this shape is solving

An informal collector's day is: walk a route, buy or pick material, carry it to
whoever will take it, get paid in cash, go home. The platform has to fit inside
that day without adding a step, and it has to work in the places where that day
happens — a lane with one bar of signal, a yard with no signal at all, on a
phone shared with a family.

That constraint drives nearly every decision below. If a feature needs the
network at the moment a collector is standing at a scale with a buyer waiting,
it will fail exactly when it matters.

## Shape

```
┌─────────────────────────┐        ┌──────────────────────────┐
│  Collector app          │        │  Recycler console        │
│  Expo / React Native    │        │  Vite + React            │
│  SQLite + outbox        │        │                          │
└───────────┬─────────────┘        └────────────┬─────────────┘
            │  sync push/pull                   │  REST
            │  (batched, backed off)            │
            └───────────────┬───────────────────┘
                            │
                  ┌─────────▼──────────┐
                  │  API (Fastify)     │
                  │  Repository port   │
                  └─────────┬──────────┘
                  ┌─────────┴──────────┐
        ┌─────────▼────────┐  ┌────────▼─────────┐
        │ MemoryRepository │  │ PrismaRepository │
        │ (seed dataset)   │  │ (Postgres)       │
        └──────────────────┘  └──────────────────┘

              @ewaste/shared  ← imported by all three
              taxonomy · valuation · matching · anomaly
              handover digest · sync rules · i18n · safety
```

## One domain library, three runtimes

`@ewaste/shared` is framework-free TypeScript, consumed as **source** by the
phone (Metro), the browser (Vite) and the server (Node). Not as a built
artefact — as source.

This is the load-bearing decision in the whole repository. A collector offline
sees a price computed by `RuleBasedValuer`; the server computes the same number
when the lot syncs; the recycler's console renders the same explanation from
the same reason codes. If those three drifted, the app would be lying to
someone — and in a product whose entire proposition is *you can trust this
number*, that is fatal.

It also means the interesting logic is unit-tested once, off-device, in 45
tests that run in under a second.

## Offline-first, precisely

"Offline-first" is often decoration. Here it means specific things:

**The phone is the source of truth for what the collector did.** Lots,
material items and handover slips are written to SQLite and only then queued.
`saveLot` writes the lot, its items and the outbox entry in one transaction —
if the app dies between them, the collector would otherwise have a lot on
screen the server will never hear about.

**The outbox is durable, not in-memory.** A crash, a battery pull or a
force-stop must not lose a recorded lot. Failed entries back off exponentially
(capped at an hour) rather than retrying in a tight loop, because a tight loop
on a weak signal drains a battery that has to last the day.

**Reference data is versioned.** The price index (a few KB per district) and
the recycler list carry version strings; an unchanged copy is never re-sent.
Data costs money to the people using this.

**The server never mints a handover slip.** The phone creates and signs it; the
server verifies. If a slip needed the server, the feature would fail exactly
where connectivity is worst.

## The handover record

This is the artefact that makes material traceable, and the thing a dispute is
settled with.

The phone builds a canonical serialisation — reference, lot, collector,
recycler, weights to three decimals, sorted photo hashes, coordinates to five
decimals, timestamp — and HMACs it with a device secret that never leaves the
device. A six-digit verification code is derived from the reference and the
same secret, so it never needs storing separately.

Two ways in for the recycler: scan the QR, or type the reference and the code
the collector reads aloud. Both are equally prominent in the app, because
scanning fails constantly in practice.

**What this does and does not prove.** The digest is symmetric, so only the
phone and the server can verify it. A recycler console with no connectivity
**cannot** cryptographically verify a slip — the QR is a lookup token, not a
self-proving credential. Online, the server checks the digest *and* that the
QR's restated facts match the stored record; a mismatch is refused with
`handover.qr_mismatch`. Genuine offline verification on the recycler side needs
asymmetric device keys with the public half distributed in advance. That is a
known gap, not a solved problem.

## Sync rules

| Rule | Why |
| --- | --- |
| Every change carries a client-generated id | A phone on a flaky tower resends. An id already seen is reported `duplicate`, never applied twice. One pile of scrap, one lot. |
| Records past `handed_over` are immutable on the client | History is not rewritable from the device that stands to gain from rewriting it. |
| Two conflicting terminal states escalate to `manual` | Better a flagged dispute than a silent overwrite. |
| Sync cannot write transactions or handovers | Those go through endpoints that check the digest and the recycler's identity. Otherwise a phone could write itself a confirmed payment. |
| Rejections are dropped; conflicts are retried | An invalid change retried forever just clogs the queue. |

## Ports and adapters

Routes and services depend on a `Repository` interface, never on Prisma. Two
adapters: `MemoryRepository` (backed by the synthetic seed dataset) and
`PrismaRepository` (Postgres).

That split earns its keep twice. The API runs for a field demo on a laptop with
no infrastructure, and CI tests all 36 route behaviours without provisioning a
database. The production story is still Postgres.

## Money and rounding

Money is `Decimal` in Postgres and `number` in the domain, converted at the
repository boundary and nowhere else. A rounding drift of a few paise per
transaction is a real argument with someone who counted the cash.

## The dataset improves with use

A confirmed transaction writes `completed_transaction` price points back into
the price dataset — the highest-confidence source there is, because it is what
someone actually paid. A recycler correcting a collector's category produces a
`recycler_corrected` training label, which is the most valuable record the
platform generates.

This is why the price signal gets better as the platform is used, rather than
decaying like a scraped rate board.

## Known gaps

These are prototype boundaries, stated plainly rather than buried:

- **No authentication anywhere.** The API trusts the ids in the request; the
  recycler console has no sign-in. Do not expose either publicly. The intended
  design is phone-OTP onboarding issuing a device-scoped token.
- **No offline verification for recyclers** (above).
- **No media storage.** Photos stay on the phone; only hashes travel.
- **On-device-only identity with no recovery.** Losing the phone loses the
  earnings history. For people whose financial record this is meant to become,
  that must be solved before a pilot.
- **No rate limiting or audit log.**

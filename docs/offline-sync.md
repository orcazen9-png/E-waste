# Offline-first design

## The situation this is built for

A collector is standing in a yard with one bar of signal, a buyer waiting, and
20 kg of cable on a scale. Anything that needs the network right now will fail
right now.

So the rule is absolute: **no screen the collector uses waits on the network.**
Not the price board, not the valuation, not buyer matching, not the handover
slip. Sync is a background job that catches up afterwards.

## Local storage

SQLite via `expo-sqlite`, migrated by `PRAGMA user_version`. Six tables:

| Table | Holds |
| --- | --- |
| `meta` | Language, collector id, device id, device secret, sync cursor |
| `lots`, `material_items` | What the collector recorded |
| `handovers` | Signed slips, with their digests |
| `transactions` | Settled sales pulled back from the server |
| `outbox` | The durable change queue |
| `reference_cache` | Price index and recycler list, with version strings |

## Writes

`saveLot` writes the lot, its items **and** the outbox entry inside one
transaction. If the process dies between them, the collector would otherwise be
looking at a lot the server will never hear about — the exact failure that
destroys trust in a record-keeping app.

The outbox is a table, not an in-memory array. A crash, a battery pull or a
force-stop must not lose a recorded lot.

## Push

```
outbox (ready, next_attempt_at <= now)
  ├── handovers ──→ POST /v1/handovers   (digest verified server-side)
  └── everything else ──→ POST /v1/sync/push  (batched, max 50)
```

Handovers go first and through their own endpoint, because that is the record
with money attached and the server has to verify its digest — something the
generic sync path deliberately refuses to do.

Outcomes:

| Outcome | Action |
| --- | --- |
| `applied` | Drop from outbox |
| `duplicate` | Drop — the server already has it |
| `rejected` | Drop; retrying an invalid change forever only clogs the queue |
| `conflict` | Defer with backoff and re-examine after the next pull |

Backoff is `2^attempts` seconds, capped at one hour. A tight retry loop on a
weak signal drains a battery that has to last the day.

## Pull

Cursor-based over an append-only change feed, plus reference data guarded by
version strings:

```json
{
  "collectorId": "COL_…",
  "cursor": "1487",
  "districts": ["Pune"],
  "knownPriceIndexVersion": "2026-09-01T00:00:00.000Z",
  "knownRecyclerVersion": "2026-08-30T…"
}
```

If the versions match, the server sends neither payload. Data costs money to
the people using this, and a price index re-downloaded daily for no reason is
their money.

Sync runs on app start and then every 15 minutes. More often wastes battery and
data on a phone that may be charged once a day.

## Conflicts

| Situation | Resolution | Why |
| --- | --- | --- |
| Server record is terminal (`handed_over`/`confirmed`/`paid`/`cancelled`), local is not | **Take server** | A counter-signed record is not rewritable from the device that gains by rewriting it |
| Both terminal, different states | **Manual** — mark `disputed` | Better a flagged dispute than a silent overwrite of someone's payment record |
| Neither terminal | **Last write wins** on client time | What a single-device user expects |

## Idempotency

Every outbox entry carries a client-generated `changeId`. The server records
each one and reports a repeat as `duplicate` rather than applying it again.

This is not a nicety. A phone that loses the response on a flaky tower *will*
resend. Without it, one pile of scrap becomes two lots, and the collector's
ledger — the thing this app exists to give them — becomes fiction.

The same applies at the endpoints: reposting a lot with the same `lotId`
returns the existing one; confirming a handover twice returns the first
transaction. All three are covered by tests.

## What the phone will not accept from the server

Nothing overwrites a signed handover digest. Corrections are new records.

## What the server will not accept from the phone

`transaction`, `handover`, `material_item` and `rating` are rejected through
`/v1/sync/push` with `entity … is not writable through sync`. They have their
own endpoints where the digest and the recycler's identity are checked.
Accepting them through the generic path would let a phone write itself a
confirmed payment.

## Degradation

| Offline for | Still works | Degrades |
| --- | --- | --- |
| Hours | Everything | Nothing |
| Days | Everything | Prices drift from the market |
| A week+ | Recording, matching, handover slips | Price board shows a staleness warning; new recyclers and rate changes are invisible |

The price board warns after three days rather than silently showing old
numbers. A stale price presented as current is worse than no price, because the
collector will negotiate on it.

## What is not solved

- **No conflict UI.** A lot marked `disputed` is flagged but there is no screen
  for the collector to resolve it.
- **Photos never leave the phone.** Only hashes sync, so storage grows
  unbounded on the device and nobody downstream can view the evidence.
- **No multi-device support.** Identity is per-device; a collector with two
  phones has two histories.
- **Clock skew is unhandled.** Conflict resolution uses client timestamps, so a
  badly wrong device clock resolves conflicts wrongly. A server-side sanity
  check on `clientUpdatedAt` is the obvious fix and is not implemented.

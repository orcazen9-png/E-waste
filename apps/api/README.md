# `@ewaste/api`

Fastify API for the collector app and the recycler console.

## Running it

```bash
pnpm api:dev          # http://localhost:3001, no database needed
```

The default `DATA_SOURCE=seed` runs entirely in memory off the synthetic seed
dataset, so the whole system is demonstrable on a clean checkout. For
persistence:

```bash
docker compose -f apps/api/docker-compose.yml up -d
export DATABASE_URL=postgresql://ewaste:ewaste@localhost:5432/ewaste
pnpm --filter @ewaste/api prisma:migrate
pnpm --filter @ewaste/api db:seed
DATA_SOURCE=postgres pnpm api:dev
```

## Shape

Routes and services depend on a `Repository` interface, never on Prisma
directly. Two adapters implement it:

| Adapter | Use | Status |
| --- | --- | --- |
| `MemoryRepository` | demos, tests, offline development | covered by the 35 integration tests in `test/` |
| `PrismaRepository` | Postgres | typechecked and reviewed; not exercised by automated tests, which run without a database |

That split is deliberate. The API needs to run for a field demo on a laptop
with no infrastructure, and CI needs to test every route without provisioning
a database — but the production story is still Postgres.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/auth/collector/request` \| `verify` | Phone-OTP sign-in for collectors |
| POST | `/v1/auth/recycler/request` \| `verify` | Facility sign-in, code to the registered number |
| GET | `/v1/auth/me` | Identity behind the current token |
| GET | `/health` | Liveness, and which data source is active |
| GET | `/v1/reference/taxonomy` | Pictorial category tree |
| GET | `/v1/reference/safety` | Safety cards |
| GET | `/v1/reference/strings/:lang` | Translation bundle (`mr`/`hi`/`en`) |
| GET | `/v1/prices/board?district=&lang=` | Price board, with spoken text per row |
| GET | `/v1/prices/trend?subCategoryId=&district=` | Trend, labelled local or national |
| GET | `/v1/prices/index?district=` | Offline price index the phone caches |
| GET | `/v1/recyclers?district=` | Authorised facilities. Anonymous callers get a directory without rate cards or contact numbers |
| POST | `/v1/lots` | Create a lot and value it; idempotent on `lotId` |
| GET | `/v1/lots/:lotId/matches` | Ranked authorised buyers, with reasons |
| POST | `/v1/handovers` | Record a slip signed offline on the phone |
| POST | `/v1/handovers/lookup` | Recycler scans the QR, or types reference + code |
| POST | `/v1/handovers/:ref/confirm` | Counter-sign, create the transaction, pay. Facility identity comes from the token |
| POST | `/v1/handovers/:ref/reject` | Refuse a slip, with a reason |
| POST | `/v1/handovers/:ref/downstream` | Track material after receipt, to EPR reporting |
| GET | `/v1/recyclers/:id/handovers` | Recycler inbox |
| GET | `/v1/collectors/:id/ledger` | Earnings, pending dues, who owes what |
| POST | `/v1/sync/push` \| `/v1/sync/pull` | Offline sync |
| POST | `/v1/ml/classify` \| `/value` \| `/screen` | AI/ML surface |

## Design decisions worth knowing

**The server never mints a handover slip.** The phone creates and signs it
offline; the server only verifies the digest and records the recycler's
counter-signature. If a slip needed the server, the feature would fail exactly
where connectivity is worst — at a scrap yard on the edge of a city.

**Every write path is idempotent.** A phone on a weak tower resends. Reposting
a lot with the same `lotId` returns the existing one; a replayed sync change is
reported as a duplicate; confirming a handover twice returns the first
transaction. None of these create a second record for one pile of scrap.

**Sync cannot write transactions or handovers.** Those arrive through their own
endpoints, where the digest and the recycler's identity are checked. Accepting
them through the generic sync path would let a phone write itself a confirmed
payment.

**A settled transaction becomes a price observation.** Confirmation feeds
`completed_transaction` price points back into the dataset, which is what makes
the price signal improve with use instead of going stale.

**Local versus national prices are never conflated.** When a district has no
observations the national rollup is used, and the response says so
(`basis: 'national_data'`). A national median shown under a local heading is a
number a collector would act on.

**Identity comes from the token, never the request body.** `confirm` used to
take the recycler id from the body, which meant anyone could settle anyone's
handover. Authentication is also checked *before* body validation, so an
anonymous caller cannot probe request schemas from validation errors. See
`docs/security.md`.

## Not implemented

- **SMS delivery.** Sign-in works, but `AUTH_DEV_MODE` returns the code in the
  response because no provider is wired up. With it off, the request fails
  loudly rather than pretending to send.
- **Account recovery.** Losing the number loses the account.
- **Audit logging and per-IP rate limiting.** Sign-in is rate limited per
  number only.
- **Media storage.** Photos pass by reference and hash only.

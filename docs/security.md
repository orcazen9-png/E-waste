# Authentication and authorisation

## Who the parties are

**Collectors** sign in with their phone number and a six-digit code. No name,
no address, no ID document — the people this serves have good reasons to be
wary of registration, and asking for less is a feature. There is no separate
registration step: the first successful code creates the account, because a
two-step signup is a two-step way to lose someone.

**Recyclers** sign in by naming their facility. The code goes to the contact
number on its authorisation record, so signing in requires control of a number
the regulator already has, and the page never reveals what that number is. A
facility whose authorisation is not current cannot sign in at all.

## What is stored

| Thing | Stored as |
| --- | --- |
| Phone number | HMAC-SHA256 with a server salt. **The raw number is never written anywhere.** |
| One-time code | HMAC keyed to the phone hash, so a leaked challenge row cannot be replayed against a different number |
| Device secret (signs handover slips) | **Not stored at all.** It never leaves the phone |
| Session | A compact signed token, held by the client |

## Tokens

`v1.<base64url(payload)>.<hmac-sha256>` — a small signed token rather than a
JWT library. The same code has to run on an entry-level phone, in a browser and
on the server, and this is about sixty lines against a dependency with a long
history of algorithm-confusion bugs. There is exactly one algorithm, and `none`
is not something it can parse. The signature is verified before the payload is
parsed or trusted for anything.

| Principal | Lifetime | Why |
| --- | --- | --- |
| Collector | 90 days | The phone is routinely offline for days. Being logged out in a scrap yard with no signal is a broken product |
| Recycler | 12 hours | The console is a shared desk in a yard; it should not stay signed in overnight |

A collector's token names its device. **Revoking a device invalidates its
tokens immediately**, without waiting out the 90 days — the only way to cut off
a lost phone.

## Rate limiting and lockout

- **5 code requests per number per 15 minutes.** This protects *someone else's*
  phone from being used as a free SMS cannon, not just our own bill.
- **5 wrong attempts per challenge**, then the challenge is dead — including
  for the correct code. Failures are counted before the response returns, so
  the limit cannot be bypassed by racing.
- **Codes are single-use** and expire after 5 minutes.

## Authorisation rules

Identity comes from the token and nowhere else. Before this existed, `confirm`
took the recycler id from the request body, which meant anyone could settle
anyone's handover.

| Route | Rule |
| --- | --- |
| `POST /v1/lots` | Collector, and `collectorId` must match the token |
| `GET /v1/lots/:id` | Its collector, or the recycler it was offered to |
| `GET /v1/collectors/:id/ledger` | That collector only |
| `POST /v1/handovers` | Collector, and the slip's `collectorId` must match |
| `POST /v1/handovers/:ref/confirm` | Recycler, and the slip must be addressed to them |
| `POST /v1/sync/push` \| `pull` | Collector, and `collectorId` must match |
| `GET /v1/recyclers/:id/handovers` \| `transactions` | That facility only |
| `POST /v1/ml/*` | Any authenticated principal |

**Authentication is checked before request-body validation**, so an anonymous
caller cannot probe request schemas by watching validation errors come back.

**A collector asking for another collector's record gets 404, not 403.** A 403
confirms the id exists, which is an enumeration oracle over a list of people
whose earnings these are.

## What stays public

The price board, the material taxonomy, the safety cards and the translation
bundles need no token. Price transparency is the point of the platform and
gating it behind a login would defeat it.

`GET /v1/recyclers` is public too, because "which buyers near me are actually
authorised?" is the question this exists to answer — but an anonymous caller
gets a **directory entry** without the rate card or the contact number. Those
are commercially sensitive and a scraper's shopping list. Authenticated callers
get the full record.

## Deployment requirements

With `NODE_ENV=production` the server refuses to start unless `TOKEN_SECRET`
and `PHONE_SALT` are set, and refuses outright if `AUTH_DEV_MODE` is on.
Running with a default signing secret would let anyone mint a token for any
collector, so failing to boot is the correct behaviour.

## Known gaps

- **No SMS provider is wired up.** In development the code comes back in the
  API response; in any other mode the request fails loudly with
  `auth.sms_not_configured`. Silently accepting a sign-in nobody can complete
  would be worse.
- **No account recovery.** Losing the phone number loses the account. For a
  record meant to become someone's financial history this must be solved
  before a pilot — likely a trusted-contact or field-officer assisted recovery,
  since a document-based one reintroduces exactly the barrier we removed.
- **No refresh tokens.** A collector re-authenticates every 90 days, which
  needs connectivity at an unpredictable moment.
- **No audit log** of who read what.
- **No per-IP rate limiting**, only per-number.
- **Recycler sign-in has no second factor** beyond the registered number.

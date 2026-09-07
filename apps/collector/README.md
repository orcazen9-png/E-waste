# `@ewaste/collector`

The collector's app. Expo / React Native, Android-first.

```bash
pnpm api:dev        # terminal 1
pnpm app:start      # terminal 2 - then press 'a' for an Android device/emulator
```

The app talks to `http://10.0.2.2:3001` (the host machine as seen from the
Android emulator). Change `expo.extra.apiUrl` in `app.json` for a real device.

## What the design is actually solving for

**The user may not read.** Every action is a picture plus a colour, and every
screen speaks itself. The language picker is written in three scripts and reads
each option aloud when touched, so choosing a language never depends on already
understanding the app's language. Confidence is words — "this is a rough guess"
— never a number, because `0.32` means nothing at a weighing scale.

**Sign-in is the only step that needs connectivity**, and the screen says so.
Putting the network dependency there, once, is what keeps everything after it
usable in a dead zone. A rejected token returns to that screen; nothing queued
is discarded, so it costs a sign-in, never a day's work.

**Nothing else waits on the network.** Photograph, categorise, weigh, value, match a
buyer, generate and sign a handover slip: all of it runs against local SQLite
and a cached price index. Sync is a background job with exponential backoff.
Every request has an 8-second timeout and every caller carries on without it —
a spinner while a buyer waits at the scale is worse than a stale number.

**The slip is signed on the phone.** `createHandover` produces an HMAC over the
lot, weights, photo hashes, GPS and timestamp using a device secret that never
leaves the device. The QR and the six-digit code are shown equally large,
because scanning fails constantly in the field — cracked screens, bright sun, a
recycler with no camera. Reading six digits aloud always works.

**Hazard guidance appears at the moment of choice**, not in a menu. Pick a
category and its "stop" card shows immediately; mark something burnt and the
app says what burning costs you, in money and in lungs.

**Money is on the home screen.** What came in this week and what is still owed
are the two numbers collectors care about, so they are not buried in a ledger
tab.

**Cash is first-class.** No screen requires a UPI ID or a bank account.

## Structure

```
src/db/          SQLite schema, migrations, the durable outbox
src/sync/        background push/pull, backoff, reference-data caching
src/api/         HTTP client, all calls timeout-bounded
src/state/       AppContext: language, identity, cached index, sync state
src/audio/       text-to-speech with mr -> hi -> device fallback
src/screens/     one screen per decision
src/ui/          theme and the shared pictorial components
```

Domain logic — valuation, matching, anomaly checks, the handover digest — is
not here. It lives in `@ewaste/shared` and is consumed as TypeScript source, so
the phone, the recycler's browser and the server compute identical results and
the logic is unit-tested once, off-device.

## Trying it without a server

Tap **"Just try the app"** on the sign-in screen. The price index, the
authorised recycler list and a few settled sales are compiled into the APK, so
every screen works with aeroplane mode on — photograph, categorise, weigh,
value, match a buyer, generate a signed handover slip, read the ledger and the
safety cards.

It is not a mock: the same valuer, matcher and handover signing run on the same
shapes of data. The only differences are where the reference data came from and
that nothing is uploaded. The home screen and the price board say so on every
visit, because a demo that looks identical to the real thing is how someone
ends up trusting a made-up price.

Regenerate the bundle with `pnpm data:demo` after changing the seed dataset.

## Running it in a browser

```bash
pnpm --filter @ewaste/collector web        # or: export:web for a static build
```

expo-sqlite has no web build, so `src/db/index.web.ts` provides the same API
over localStorage and Metro picks it automatically for the web platform. This
exists so the app can be opened, driven and demonstrated without a device, and
so a browser can run it in automated tests. **The phone is the real target**:
the web store has none of SQLite's durability guarantees, the camera and
text-to-speech behave differently, and it is not what ships to a collector.

## Verified

- Typechecks under `strict` with `noUncheckedIndexedAccess`.
- Bundles for Android: 765 modules, 2.53 MB Hermes bytecode
  (`npx expo export --platform android`).
- 16 tests: the ledger maths, and the demo bundle (every material priced, only
  authorised facilities, a buyer always findable, still marked synthetic).
- A debug APK is buildable in CI — Actions → **Android APK** → Run workflow.

Not verified: it has not been run on a device or emulator in this environment,
so screen layouts, camera capture, GPS acquisition and the text-to-speech
fallback chain are unexercised. Treat the UI as reviewed-and-compiling, not
field-tested.

## Size

The JS bundle is 2.46 MB of Hermes bytecode. A release APK with the Expo
runtime lands around 25–40 MB, which is realistic for an entry-level device but
is not "small" by the standard the brief asks for. Getting materially below
that means dropping to a bare React Native build or a native Kotlin client, and
that trade — build simplicity now versus install size later — should be made
after the first field test, not before.

## Not implemented

- **No account recovery.** Sign-in is phone plus a six-digit code, and the
  server is authoritative for the collector id, so signing in again on a new
  phone restores the history. But losing the *number* loses the account, which
  is a real problem for the people this is for and needs solving before a
  pilot.
- **No SMS provider**, so in development the code is shown on screen.
- **No photo upload.** Photos stay on the device; only their hashes travel, so
  the traceability record proves a photo existed and was not swapped, but
  nobody downstream can look at it yet.
- **No push notification** when a recycler confirms — the app finds out on its
  next sync.
- **No in-app dispute flow** for a slip a recycler rejects.

# `@ewaste/recycler-web`

The recycler-side console: the other half of the handover. Vite + React, no UI
framework — the CSS is 3.8 KB and the whole bundle is 63 KB gzipped, because
this runs on whatever laptop is in the shed.

```bash
pnpm api:dev     # terminal 1
pnpm web:dev     # terminal 2 -> http://localhost:5173
```

Vite proxies `/v1` and `/health` to the API, so the browser stays on one origin
and there is no CORS setup in development.

## Screens

- **Verify a slip** — paste scanned QR contents, or type the reference and the
  six-digit code the collector reads aloud. Shows what the collector declared
  next to what the scale says, with the difference spelled out, then settles:
  weight, amount, payment mode, paid/part-paid/unpaid. Confirmation shows any
  checks that fired and lets the facility record downstream status through to
  EPR reporting.
- **Handovers** — the inbox, filterable by waiting / confirmed / rejected.
- **Transactions** — history with totals for material received, paid to
  collectors, and still owed.
- **Rates & facility** — the facility's rate card beside the district median,
  with the gap shown per material, plus its authorisation details.

## Deliberate choices

**The declared/weighed gap is the headline, not a footnote.** That difference
is where a collector most often loses money and where a facility most often
gets a bad sack, so it is two large numbers with the percentage under them, not
a field buried in a form.

**The rate card is shown against the district median.** A facility paying under
the local rate sees it here, and so does every collector in the matching list.
Transparency is the mechanism the platform runs on, so it points both ways.

**Cash is the first payment option** and part-paid is a first-class state,
because that is how the trade actually settles.

**Errors use the same wording the collector sees.** The API returns translation
keys; the console renders the English string for the same key the phone renders
in Marathi. Two people disputing a slip should be reading the same sentence.

## Not implemented

- **No sign-in.** The facility picker is a demo affordance; anyone with the page
  can act as any facility. The banner at the top says so.
- **No camera scanning.** QR contents are pasted. Adding a scanner is a small
  change (`BarcodeDetector` where available, a WASM decoder otherwise) but it
  needs a device to test on.
- **Rates are read-only.** Editing them is the next piece of work.

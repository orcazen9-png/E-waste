# Unit economics

## What this is and is not

This is a **parametric model with stated assumptions**, not a finding. Nobody
has surveyed a collector for this document. Every input below is labelled with
where it came from and how confident it is, and the ones that decide whether
the whole proposition works are called out as such.

The synthetic dataset cannot substitute for that. Its activity rates were
chosen by the generator, so quoting "median collector earns ₹4,590/month" from
it would be quoting an assumption back to itself. Where dataset figures appear
below they are labelled *(synthetic)* and used only to show the shape of a
transaction, never as evidence.

---

## Inputs

| # | Input | Base case | Confidence | Source |
| --- | --- | --- | --- | --- |
| A1 | Margin taken by the informal intermediary chain between collector and authorised gate rate | **22%** | **Low — decides everything** | Assumption. Reported ranges for scrap intermediation sit broadly between 10% and 35%; the base case is mid-range |
| A2 | E-waste handled per active collector per month | **150 kg** | Low | Assumption. Most informal collectors handle mixed scrap; e-waste is a fraction of their volume |
| A3 | Blended realised rate at an authorised gate, mixed e-waste | **₹45/kg** | Medium | Conservative. The seed dataset blends to ₹90/kg *(synthetic)*, but its mix is PCB-rich; real street-collected mixes carry far more plastic and CRT glass |
| A4 | Transport cost per trip when the recycler does not collect | **₹200** | Medium | Assumption, shared tempo / cycle-rickshaw for ~100 kg |
| A5 | Share of lots collected by the recycler (free pickup) | **40%** | Low | Seed recyclers offer pickup at roughly this rate *(synthetic)*; real availability unknown |
| A6 | Platform commission, charged to the **recycler** | **2.0%** | Design choice | See below |
| A7 | EPR documentation fee, charged to producers/PROs per verified kg | **₹1.50/kg** | Low | Assumption |

*(synthetic)* reference figures, for shape only: median lot ₹1,791 / 27.7 kg;
mean lot ₹3,251 / 36.3 kg; value mix cable 38%, PCB 17%, battery 13%,
motors/magnets 12%, plastics 10%, LCD 5%, CRT 5%.

## The collector's side

Per collector per month, at A2 = 150 kg and A3 = ₹45/kg — gross value at the
authorised gate is **₹6,750**.

| | Today (informal chain) | With the platform |
| --- | --- | --- |
| Gross value of material at authorised gate | ₹6,750 | ₹6,750 |
| Less intermediary margin (A1, 22%) | −₹1,485 | — |
| Less platform commission | — | ₹0 *(charged to the recycler)* |
| Less transport on non-pickup lots (A4 × A5) | ₹0 *(intermediary collects)* | −₹120 |
| **Collector receives** | **₹5,265** | **₹6,630** |
| **Monthly uplift** | | **+₹1,365 (+25.9%)** |

Annualised, that is roughly **₹16,400** per collector — meaningful against
incomes in this range, and the entire reason a collector would change a working
habit.

### Costs the table does not price

Honest accounting has to include these, and they are why adoption is not
automatic:

- **Time.** A trip to an authorised facility may take longer than a walk to the
  local kabadiwala. Where pickup is unavailable and the facility is far, the
  uplift can be eaten by a lost half-day. This is why `serviceAreaRadiusKm` is a
  hard filter in matching, and why pickup is a scored factor rather than a
  footnote.
- **Payment timing.** The informal chain pays cash on the spot. If the platform
  route means "paid next week", the uplift is irrelevant to someone who needs
  today's money today. This is why cash is a first-class payment mode and why
  the ledger tracks pending dues prominently — and it is a hard product
  constraint, not a preference.
- **Relationship.** The local aggregator often extends informal credit. A
  platform that pays 25% more but cannot lend ₹2,000 in an emergency is not
  strictly better. We do not solve this, and should not pretend to.

### Sensitivity to A1 — the assumption that decides everything

| Intermediary margin (A1) | Collector today | With platform | Uplift | Uplift % |
| --- | --- | --- | --- | --- |
| 10% | ₹6,075 | ₹6,630 | +₹555 | +9.1% |
| 15% | ₹5,738 | ₹6,630 | +₹893 | +15.6% |
| **22% (base)** | **₹5,265** | **₹6,630** | **+₹1,365** | **+25.9%** |
| 30% | ₹4,725 | ₹6,630 | +₹1,905 | +40.3% |

**If A1 turns out to be near 10%, the price argument is weak** and the platform
has to justify itself on documentation, reliability of payment and safety
instead. That is a survivable outcome but a different product story, and it is
the first thing the field research must settle.

## The platform's side

Revenue per active collector per month:

| Stream | Rate | Per collector/month |
| --- | --- | --- |
| Transaction commission from the recycler (A6) | 2.0% of ₹6,750 | ₹135 |
| EPR documentation fee from producers/PROs (A7) | ₹1.50 × 150 kg | ₹225 |
| **Total** | | **₹360** |

### Why the commission is charged to the recycler, not the collector

Taking a cut from the collector recreates the middleman the platform exists to
route around, and it is visible: a collector who sees ₹6,750 become ₹6,615 has
been shown, in their own ledger, that the app takes money. The recycler is
buying something real — verified authorisation-compliant supply with a
traceable chain of custody they can report against EPR obligations — and can
price it into their gate rate.

The EPR fee is the more durable stream. The E-Waste (Management) Rules, 2022
oblige producers to channel material through authorised recyclers and document
it. Verified, photographed, GPS-stamped, counter-signed handover records are
precisely the evidence that obligation needs, and the informal chain cannot
produce them at all.

### Operating cost, per 1,000 active collectors

| Line | Monthly |
| --- | --- |
| 4 field mobilisers (onboarding, trust, dispute help) | ₹1,00,000 |
| 1 district operations lead | ₹45,000 |
| Vernacular voice support | ₹20,000 |
| Infrastructure (API, storage, sync) | ₹15,000 |
| **Total** | **₹1,80,000** = **₹180 per collector** |

Field staff dominate, and should. Adoption here is a trust problem before it is
a software problem: someone has to sit with a collector, in their language,
and show them the first handover working.

**Contribution margin: ₹360 − ₹180 = ₹180 per collector per month.**

### Break-even

Central costs not scaling with collector count — engineering, compliance,
recycler partnerships, management — at roughly **₹8,00,000/month**:

```
₹8,00,000 ÷ ₹180 = ~4,450 active collectors
```

Around one large metro district cluster. Sensitivity on contribution:

| Contribution/collector/month | Collectors to break even |
| --- | --- |
| ₹100 | 8,000 |
| ₹180 (base) | 4,450 |
| ₹250 | 3,200 |

At base-case volume, 4,450 collectors channel **~667 tonnes/month** of e-waste
into the authorised chain.

### What breaks the model

- **A1 near 10%** — the collector's uplift shrinks and adoption slows; the
  ₹360 revenue is unaffected, but acquisition cost rises sharply.
- **Recyclers refuse the commission.** Gate rates in this trade are thin. If
  2% is unacceptable, the model rests on the EPR fee alone (₹225/collector),
  contribution falls to ₹45, and break-even moves past 17,000 collectors —
  which is a different, much harder company.
- **Volume below 150 kg/month.** Both revenue lines are volume-linked, so this
  scales down proportionally on both sides.
- **Payment latency.** If recyclers pay late at scale, collectors leave, and no
  price advantage compensates.

## What to measure in the pilot

Ordered by how much they change the answer:

1. **A1** — what a collector actually receives versus the authorised gate rate
   for the same material on the same day. Everything hinges on this.
2. **A2** — real e-waste volume per collector per month, separated from other
   scrap.
3. **Payment latency** by recycler, in days.
4. **Round-trip time and cost** to an authorised facility versus the local
   aggregator.
5. **Repeat rate** — collectors who use the platform for a second and third
   lot. The only honest measure of whether any of this is worth their time.

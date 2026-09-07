# Field research protocol

> **Status: not yet conducted.** The brief requires field research with at
> least two working scrap collectors or aggregators. This document is the
> instrument for it — protocol, consent, questions and recording sheets — not a
> report of findings. **No interviews have been run and no findings are
> recorded here.** Fabricating them would poison every downstream decision, and
> the assumptions this research exists to test are named explicitly in
> `unit-economics.md`.

## What the research has to settle

In priority order. The first question decides whether the product's core
argument holds at all.

1. **What does a collector actually receive, versus the authorised gate rate
   for the same material on the same day?** (Assumption A1, base case 22%.)
2. **How much e-waste, specifically, passes through their hands per month?**
   (A2, base case 150 kg.)
3. **What would make them change where they sell — and what would stop them?**
   Price, payment timing, distance, relationship, credit.
4. **Can they use the app without being able to read it?**

## Who to talk to

- **At least 2 working informal collectors** (waste-pickers or itinerant buyers)
  — the brief's minimum. Four is better: two who mostly street-collect and two
  who mostly buy from households and shops, because their economics differ.
- **At least 1 local aggregator/kabadiwala.** They are the incumbent, and the
  margin in A1 is theirs. Understanding their costs is not adversarial — a
  platform that assumes they are simply extracting rent will misjudge how hard
  they are to displace.
- **1 authorised recycler**, on whether they would pay a commission for
  documented supply.

Recruit through a waste-picker collective or an NGO already working with the
group. Cold-approaching people about their income is intrusive and produces
guarded answers.

## Consent

Verbal, recorded in the field notes, in the participant's language. Written
consent forms are a barrier here and can read as officialdom.

Say, before anything else:

- who you are and that this is a student/research project, not a government or
  enforcement body;
- that nothing they say goes to the police, the municipality or their buyer;
- that no name, photo or address will be recorded or published;
- that they can stop at any point, skip any question, and end the session
  without giving a reason;
- that participating changes nothing about their work either way;
- **that they will be paid for their time regardless** — ₹300–500 for 45
  minutes, or the equivalent of the earnings the session costs them, paid at
  the start, not the end.

Do not record audio or photograph faces. Do not ask for a phone number unless
they offer one for follow-up.

## Session structure (45 minutes)

**1. Their day (10 min) — open, no numbers yet.**
- Walk me through yesterday, from when you started.
- What did you pick up or buy? Where did it go?
- Who did you sell to? Have you sold to them before?
- How were you paid — cash, when?

**2. Materials (10 min) — with the material in front of you if possible.**
- Show the pictorial category grid on paper. Which of these do you see most?
- Which is worth the most? Which do you leave behind, and why?
- What do you do with wire? With boards? With batteries?
  *(Ask neutrally. If burning or acid comes up, do not react — the point is to
  learn what happens, not to correct it mid-interview. Safety guidance is what
  the product is for; the interview is for understanding.)*

**3. Price (10 min) — the critical section.**
- What did you get per kilo for [material] last time?
- How do you know if that is a fair price?
- Has a buyer ever paid you less than agreed? What happened?
- Do you ever go to a different buyer for a better rate? What stops you?

**4. The app (10 min) — hands on the phone, no instructions.**
- Hand over the phone on the language screen and say nothing else.
- Ask them to record something they collected recently.
- **Do not help.** Note every point where they hesitate, tap the wrong thing,
  or look up for guidance. Those hesitations are the finding.
- Then: what do you think this number means? Would you trust it?

**5. Close (5 min).**
- If this told you a buyer 3 km away pays 20% more, would you go?
- What would have to be true for you to use this next week?
- Anything I should have asked and did not?

## What to record

Use `field-notes-template.csv` (below). Record numbers as the participant
states them; do not convert, round or reconcile in the moment.

| Column | Notes |
| --- | --- |
| `participant_code` | `P1`, `P2` … Never a name |
| `role` | collector / aggregator / recycler |
| `district`, `locality` | Locality only, never an address |
| `session_date`, `duration_min` | |
| `material` | Sub-category id from the taxonomy |
| `stated_price_inr_per_kg` | As stated |
| `buyer_type` | kabadiwala / aggregator / authorised recycler / other |
| `payment_timing` | on the spot / same day / days / credit |
| `monthly_ewaste_kg_estimate` | Their estimate, marked as such |
| `usability_blocker` | One row per hesitation, with the screen |
| `quote` | Verbatim, translated, attributed only to the code |
| `consent_confirmed` | y/n, plus who witnessed |

## Usability scoring

For the hands-on section, record per task:

| Task | Completed unaided | Completed with help | Abandoned | Time (s) |
| --- | --- | --- | --- | --- |
| Choose a language | | | | |
| Start a new load | | | | |
| Pick the right material | | | | |
| Enter a weight | | | | |
| Understand the estimate | | | | |
| Find a buyer | | | | |
| Show the handover code | | | | |

**"Completed with help" is a failure.** The user will not have a researcher
beside them in the lane.

## Analysis

- Report A1 per participant, not as an average across two people. With n=2,
  a mean is a fiction.
- Feed the observed A1 and A2 straight back into `unit-economics.md` and rerun
  the sensitivity table.
- List every usability blocker with the screen it occurred on and file each as
  an issue. A blocker seen by one of two participants is worth fixing.
- State the sample's limitations plainly: two to four people in one district
  are not representative of informal e-waste collection in India, and nothing
  from this should be generalised.

## What would make the research wrong

- **Leading on price.** "Do you think you're being underpaid?" produces the
  answer the researcher wants. Ask what they received, not what they feel.
- **Interviewing in front of their buyer.** They will not say anything useful.
- **Helping during the hands-on section.** It destroys the only unbiased signal
  in the session.
- **Treating the aggregator as the villain.** They provide credit, aggregation
  and a guaranteed offtake. Understanding what they actually do is how you find
  out what the platform must replace.

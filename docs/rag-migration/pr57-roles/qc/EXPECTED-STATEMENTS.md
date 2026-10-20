# Expected structured statements, from the source pages

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Policy Evidence Reviewer | independent reference for `statements[]` in the shorter-answer change: bottom line and every amount statement per journey | fixtures on main `9a76490` (page text unchanged since C0) | done | fixture pages, cited per row; rulings in `EVIDENCE.md` | DC's real library not available; no suite or model call run |

Written from the fixture pages only, not from any candidate's output. Revising tests against it belongs to the Test engineer, and the sentences to the Developer.

## How to read this

Each journey gives:
- **Bottom line:** what a correct short answer leads with, and the qualifier that must stay attached to it.
- **Statements:** one row per amount. **As printed** is the page's own text. **Currency:** `S$ printed`, or `bare $`, which stays unresolved unless the cited S$ row is from the same benefit on another page. **Basis:** a fixed limit, a percentage of a named sum, or a sum assured. **Must travel with it:** every condition and footnote that has to appear in the same statement. **asOf:** the date the figure is proven for. **Source:** document and stored page (stored index; Product Summary pages print one lower).
- **Must not:** statements that fail the contract.

Rules for every journey (DC's contract):
- An amount is a printed term or a conditional illustration, never a payment or the insurer's decision.
- Amounts from different schedules or documents are never added.
- A dated certificate row proves cover on that date, not now.
- Missing wording is never stated as an exclusion.

Sources:
- **fracture household:** `scripts/fixtures/reliable-chat/fracture-conversation.ts`, real-anonymised (CERT p1; PS p8/12/13/37 of 37; BS p1/3/5/7/8/9, total unknown).
- **actuallib:** `actual-lib.ts`, real-anonymised pages. The certificate dates are the fixture's own.
- **livelib:** `rag2-livelib/household.ts`, synthetic.
- **PR #64 GP pages:** `developer/gp-bill-live-repro.ts` PS p20/p25, invented.

---

## E1 Fracture (fracture household): "grace fell down and broke her arm"

**Bottom line:** "Grace's accident cover prints two different fracture benefits for an arm. The documents don't say which applies, so they are two alternatives, never a total: S$1,250 on one and S$120,000 on the other. The insurer decides which applies and any claim."

| # | person | as printed | currency | basis | must travel with it | asOf | source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Grace | "Arm, Elbow, Wrist or Ribs 25%" of "Simple Fracture Benefit Limit: S$5,000" → **S$1,250** | S$ printed | fixed limit S$5,000; not scaled by Grace's sum insured | only if the fracture was caused by an Accident; `#` "any fractures of thumb, finger and palm are not covered". **No** Core/Voluntary note: PS p13's `*` note is not on this row | none on the page; PS p37 says "accurate as at July 2021" | PS p13 |
| 2 | Grace | "Arm, Elbow, Wrist or Ribs (Other Fracture) 20%" "(% of Sum Insured)" → **S$120,000** | S$ (from CERT p1 S$600,000) | 20% of Grace's Group Personal Accident S$600,000 | only if caused by an Accident; the row is labelled "Other Fracture", and no stored page defines Simple or Other Fracture; "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme." | 6 Oct 2022 (CERT p1 "As of 06/10/2022") | BS p8 + CERT p1 |

Relationship that stays open: which of rows 1 and 2 applies. PS p37 says the precise terms are in the certificate, BS p1 says the Benefit Summary is not a contract, and PS is the Voluntary Scheme summary.

**Must not:**
- S$121,250 or any total.
- Row 2 without its Core/Voluntary condition.
- That condition attached to row 1.
- A `^` toe/foot note.
- An X-ray or medical-certificate requirement.
- "covered" or "will pay".

**Turn 2, the correction** ("Actually it was Daniel..."): same two rows for Daniel. Row 1 stays S$1,250 (fixed limit). Row 2 is 20% of **Daniel's** S$600,000 (row S\*\*\*\*411A, 6 Oct 2022) = S$120,000. The answer says Grace's figures no longer apply. The recompute is shown only by a household with differing sums (acceptance Q3: Daniel S$400,000 → S$80,000).

## E2 GP bill (fracture household): "daniel tripped on the kerb and fell, his GP bill is $800, can he claim for this?"

### E2a Stored pages only (no outpatient page)

**Bottom line:** "In the pages uploaded, none of Daniel's listed cover prints a benefit for a GP or outpatient bill. That is not the same as saying he isn't covered." Qualifiers:
- His certificate lists Group Term Life, Group Personal Accident, Group Living Care and Group Living Care Plus, as of 6 Oct 2022.
- The scheme also has an Outpatient Medicare Policy, which his certificate does not list, and a benefit applies only if its policy is listed (BS p1).
- No stored page describes Living Care or Living Care Plus, and only part of the Product Summary and Benefit Summary was uploaded.

Conditional statements. These keep documented benefits visible, and each one applies only if that event happened:

| # | person | as printed | currency | basis | must travel with it | asOf | source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Daniel | "Ambulance Cost\* Up to S$500 per incident" | S$ printed (BS p8 prints a bare "$500") | fixed limit per incident | only if a ground ambulance took him to hospital after an accident (not reported); "\*This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme." | PS "as at July 2021" | PS p13 (BS p8) |
| 2 | Daniel | "Accidental Hospital Recuperation Benefit\* S$250" | S$ printed (BS p9 bare "$250") | one-time per hospitalisation | only if, within 30 days of the accident, he was confined in hospital for at least 24 continuous hours (not reported); the same injury is not paid twice; Core-or-Voluntary | as above | PS p13, BS p9 |
| 3 | Daniel | the two fracture alternatives of E1 (S$1,250 / S$120,000) | as E1 | as E1 | only if the fall caused a fracture of a listed kind (not reported) | as E1 | as E1 |

- Household figure: "$800" is the household's own figure, with its currency unresolved. Nothing is computed from it.
- Optional, at most one question: whether the fall caused a fracture or a hospital stay.

**Must not:**
- "not covered" or "excluded".
- "Living Care pages describe no GP benefit" (it has no pages).
- Any amount for the GP bill.
- S$250 or S$500 shown as payable for this visit.
- "I haven't yet looked up" after a search.

### E2b With PR #64's invented PS p20 and PS p25

The E2a bottom-line qualifiers stay, plus:

| # | person | as printed | currency | basis | must travel with it | asOf | source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | **unresolved** (the page names no policy and no person) | "Consultation at a panel GP clinic in Singapore: no charge to the Insured Person. Non-panel GP consultation: up to $30 per visit." | bare $ (unresolved) | per visit; panel vs non-panel | it is quoted under "Panel GP Benefit", "SECTION 6: CLINICAL BENEFITS"; the page does not say whose cover it is; whether the visit was at a panel GP is not known | none | PS p25 |
| 5 | unresolved, as row 4 | "reasonable medical expenses for emergency outpatient treatment received outside Singapore following an Accident, up to $1,000 per Accident" | bare $ | per Accident | **only for treatment outside Singapore**; shown only when the message names no place, or names an overseas place | none | PS p20 |

**Must not:**
- $770 or any amount computed from $800 and $30.
- Row 5 for a visit stated as in Singapore.
- A "his certificate does not list it" claim for row 4, since the page prints no policy name.

## E3 Death abroad (livelib, synthetic): "Adrian died in a car accident in Japan. The accident happened on 3 October 2026 and he died on 5 October 2026 ... which death benefits may apply and what I should do next."

**Bottom line:** "Adrian's documents print three death benefits that may apply. They come from separate policies, so they are stated separately and never added. Each is subject to the insurer's decision, and the certificate amounts are as of 6 Oct 2022." Next step: notify Kestrel Life of the death within 6 months, with the death certificate. The page prints that step for Group Term Life; no page prints a procedure for the accident policy.

| # | person | as printed | currency | basis | must travel with it | asOf | source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Adrian | Group Term Life "S$1,000,000"; "Death Benefit: the Sum Assured ... is payable on the death of the Insured Person." | S$ printed | sum assured | "notify ... within 6 months, with the death certificate" | 6 Oct 2022 | CERT p1 + GTL_SUM p1 |
| 2 | Adrian | "Accidental Death: 100% of the Sum Insured." → **S$600,000** | S$ (CERT) | 100% of Adrian's Group Personal Accident S$600,000 ("Sum Insured means the amount shown ... under Group Personal Accident in the Certificate", WORD p2) | death from an Accident (defined WORD p2); "Territorial Limits: worldwide, 24 hours a day" (Japan is within this); exclusions: war, (invasion,) civil war, deliberate self-injury | 6 Oct 2022 | SUMMARY p9 + CERT p1 (WORD p2/p3) |
| 3 | Adrian | "Repatriation of Mortal Remains: S$2,000 per Insured Person, if death occurs outside Singapore as a result of an Accident." | S$ printed on the summary; WORD p3 prints a bare "$2,000" | reimbursement, "up to" (WORD p3: "the reasonable cost of returning the remains to Singapore") | death outside Singapore from an Accident | none | SUMMARY p9 (WORD p3) |

**Not applicable, and must not be shown as an amount that may apply:**
- **Travel "Accidental Death: S$100,000"** (TRAVEL p1). Its printed period is 10/03/2025 to 17/03/2025 and its destination is Indonesia, and both contradict a death in Japan in October 2026. It may be mentioned only with its period, destination and insured person, and with the reason it does not fit.
- **"Daily Hospital Cash: S$40 per day ... payable from the 11th day onwards"** (SUMMARY p5). A 2-day stay does not reach day 11.
- The **Term Life "Terminal Illness Benefit"**, which is irrelevant to a death.
- **Living Care Plus S$300,000** (CERT p1) is listed but no page describes it. It may be named as "listed, terms not uploaded", never with an amount as payable.

**Must not:**
- S$1,602,000 or any total.
- "covered" or "will pay".
- A claim procedure for the accident policy that no page prints.

## E4 Travel (livelib, synthetic): "Does Adrian's travel insurance cover his trip?" (no new trip dates given)

**Bottom line:** "Adrian's travel schedule covered one trip to Indonesia from 10 to 17 March 2025. Today is after that period, so the schedule does not show cover for a trip now." Qualifiers:
- It names Adrian only, not Cheryl.
- The uploaded page prints no other benefit or terms, which is not an exclusion.

| # | person | as printed | currency | basis | must travel with it | asOf | source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Adrian (only) | "Accidental Death: S$100,000" | S$ printed | fixed sum | "Period of Insurance: 10/03/2025 to 17/03/2025"; "Destination: Indonesia"; single trip | document date 1 Mar 2025; period printed | TRAVEL p1 |

**Must not:**
- The S$100,000 without its period, destination and person.
- Cheryl named as insured.
- Medical, delay or baggage cover, which no page prints.
- "valid" or "active" now.

For a stated trip in that period to Indonesia, the bottom line becomes "the schedule prints this cover for that trip", with the same row.

## E5 Conflicting documents (actuallib, real-anonymised pages): "Daniel fractured his hip, it's a closed fracture"

**Bottom line:** "Two of Daniel's documents print different amounts for a hip fracture: S$3,750 on one and S$450,000 on the other. They don't say which applies, so this is two answers, never a total. The insurer decides which applies and any claim." Next step: ask the insurer which schedule applies.

| # | person | as printed | currency | basis | must travel with it | asOf | source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Daniel | "Hip 75%" of "Simple Fracture Benefit Limit: S$5,000" → **S$3,750** | S$ printed | fixed limit | caused by an Accident; a Simple Fracture of the listed nature; the household said "closed", and no page defines Simple Fracture | none on the page | Product Summary p13 (prints "Page 12 of 36") |
| 2 | Daniel | "Hip 75%" "(% of Sum Insured)" in "Simple Fracture or Other Fracture due to Accident" → **S$450,000** | S$ (CERT) | 75% of Daniel's Group Personal Accident S$600,000 | caused by an Accident; the hip row is **not** labelled Other Fracture, and the benefit covers "a Simple Fracture or Other Fracture", so a closed hip is within its wording; "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme." | 1 Apr 2024 (CERT "As of 01/04/2024") | PA Benefit Summary p8 + CERT p1 |

**Must not:**
- S$453,750 or any total.
- The "do not define which fractures count as Other Fracture" note on the hip row (it belongs to the labelled rows).
- S$450,000 dropped, which would hide a documented benefit.
- The superseded 2022 Product Summary's S$4,000 limit (→ S$3,000).
- The other household's S$7,000 or S$900,000.
- Grace's S$100,000 as the base.

**Arm variant on the same pages** ("Daniel broke his arm, closed fracture"):
- S$1,250, which is 25% of S$5,000 (PS p13, with the `#` thumb/finger/palm note).
- S$120,000, which is 20% of S$600,000. That row is labelled "(Other Fracture)", so the note must say the documents do not define which fractures count as Other Fracture, or whether a closed fracture is one, and the insurer decides. It also carries the Core/Voluntary condition.

---

**Not available:**
- DC's real library. These are anonymised copies and synthetic households.
- Unstored pages (fracture household: PS 33 of 37 pages; BS pages 2, 4, 6 and from 10 onward).
- Definitions of Accident and of the fracture types in the fracture household and actuallib.
- Living Care, Living Care Plus and Outpatient Medicare terms.

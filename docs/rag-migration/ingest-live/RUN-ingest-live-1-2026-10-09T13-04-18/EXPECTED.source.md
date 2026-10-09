# Expected facts — DearPolicy ingestion test (Hartwell household)

Source PDFs in /mnt/files/ingest-author/source. All facts read from 100-dpi page renders (all 5 pages viewed).

## Facts

| id | doc | page | location | verbatim |
|---|---|---|---|---|
| F01 | hx-text.pdf | 1 | header table "Policy number | Policy owner | Period of cover", row 1 | MHA-HC-2025-0748213 / Simon Alastair Hartwell / 01 February 2026 to 31 January 2027 (both dates inclusive) |
| F02 | hx-text.pdf | 1 | line under header table | Cover basis: Accident only — see Clause 3.1. |
| F03 | hx-text.pdf | 1 | Schedule of Benefits, row Item A, Adult (each) and Child (each) columns | Accidental death or permanent total disablement (lump sum) / S$150,000 / S$40,000 |
| F04 | hx-text.pdf | 1 | Schedule of Benefits, rows Item D and Item E, Child (each) column | Fractured bones (per Accident) — Simple (closed) fracture / S$600 / Fractured bones (per Accident) — Compound (open) fracture / S$1,500 |
| F05 | hx-text.pdf | 1 | note directly under Schedule of Benefits | Items D and E: the type of fracture must be certified in writing by a registered medical practitioner and confirmed by X-ray. Only one of Item D or Item E is payable for the same bone in the same Accident. See Clause 4.4. |
| F06 | hx-text.pdf | 2 | Clause 4.4 | a Compound fracture means a fracture in which the broken bone breaks through the skin. All other fractures are Simple fractures. Hairline fractures and stress fractures are treated as Simple fractures. |
| F07 | hx-text.pdf | 1 | Schedule of Benefits, row Item F, Child (each) column | Medical expenses due to Accident (per Accident, reimbursement) / up to S$2,000 |
| F08 | hx-text.pdf | 1 | Schedule of Benefits, row Item B, Adult (each) column | Hospital daily allowance (per day of confinement, max 60 days per policy year) — see Clause 4.2 / S$120 per day |
| F09 | hx-text.pdf | 2 | Clause 4.2 (Section 4 Benefit conditions) | Days are counted from the date and time of admission to the date and time of discharge shown on the hospital record. Each complete period of 24 consecutive hours counts as one day. Any remaining period of 12 hours or more counts as one further day; any remaining period of less than 12 hours is disregarded. A Confinement of less than 12 hours in total is not payable. Days are not counted by calendar date or by the number of nights. |
| F10 | hx-text.pdf | 1 | Schedule of Benefits, row Item B, Child (each) column (PRE-ENDORSEMENT value) | S$80 per day |
| F11 | hx-endorsement.pdf | 1 | amendment table "Item | Benefit | Category | Existing | Revised", row B | Hospital daily allowance (per day of confinement) / Child (each) / S$80 per day / S$110 per day |
| F12 | hx-endorsement.pdf | 1 | second header table, column "Effective date of this endorsement"; also body paragraph | 01 July 2026 / with effect from 01 July 2026 |
| F13 | hx-endorsement.pdf | 1 | first header table | ME-26-0412 / MHA-HC-2025-0748213 |
| F14 | hx-endorsement.pdf | 1 | paragraphs under amendment table | The revised amount applies to days of Confinement falling on or after the effective date. Days of Confinement before 01 July 2026 remain payable at the Existing amount. / The maximum of 60 days per policy year, the Adult amounts and all other terms, conditions and exclusions of the Policy remain unchanged. |
| F15 | hx-scanned.pdf | 1 | Table of Benefits, row 1 (benefit cell carries asterisk) | Daily hospital income* / S$150 per day, max 30 days per policy year |
| F16 | hx-scanned.pdf | 1 | footnote directly under Table of Benefits | * Daily hospital income is payable only from the 4th consecutive day of hospitalisation. The first 3 days of each hospitalisation are not payable. |
| F17 | hx-scanned.pdf | 1 | certificate header tables | KBJ-26-00391 / Isla Maren Hartwell / 09 Jan 2020 / Leonie Brigitte Hartwell / 15 March 2026 / 14 March 2027 / Plan 2 |
| F18 | hx-text.pdf | 2 | Clause 3.1 | Accident-only cover. All benefits in this Policy, including Items B and C, are payable only where the Confinement or loss results solely and directly from an Accident and begins within 90 days of that Accident. Confinement due to illness or disease is not covered. |
| F19 | hx-scanned.pdf | 1 | Table of Benefits, row 4 | Hand, foot & mouth disease or dengue fever hospitalisation (lump sum) / S$500 |
| F20 | hx-scanned.pdf | 1 | small print under footnote | This certificate covers illness and accident. Pre-existing conditions are excluded for the first 12 months of cover. |
| F21 | hx-text.pdf | 2 | Section 5 Exclusions, clause 5.2 | participation in professional sports, motor racing, scuba diving below 30 metres, sky-diving or mountaineering requiring ropes or guides; |

## Expected answers

### Q1 — direct_fact
**Expected:** Meridian Harbour Assurance SafeStay policy MHA-HC-2025-0748213; cover runs 01 February 2026 to 31 January 2027 (both dates inclusive).

Supporting facts: F01

Forbidden:
- MHA-HC-2025-0748218 or any altered number
- KBJ-26-00391 given as the Meridian policy number
- ME-26-0412 given as the policy number (that is the endorsement number)
- an end date of 01 Feb 2027 or 14 March 2027

### Q2 — child_vs_adult
**Expected:** Accidental death / permanent total disablement (Item A): Isla (Child) S$40,000; Simon (Adult) S$150,000.

Supporting facts: F03

Forbidden:
- S$150,000 stated for Isla
- S$40,000 stated for Simon
- S$20,000 (that is the separate Kestrel Bay JuniorShield child accidental death benefit) presented as the Meridian figure without saying it comes from the other policy

### Q3 — needs_follow_up
**Expected:** Cannot give one amount yet. Must ask whether the doctor certified (with X-ray) a Simple (closed) fracture or a Compound (open) fracture, i.e. whether the bone broke through the skin. Felix is a Child: Item D Simple S$600 vs Item E Compound S$1,500; only one is payable per bone per accident. Cause is an accident (fall), so accident-only clause is satisfied. Actual medical bills may separately be reimbursed under Item F up to S$2,000.

Supporting facts: F04, F05, F06, F07

Forbidden:
- stating a single definitive fracture payout before the fracture type is known
- S$1,000 or S$2,500 (Adult column) for Felix
- S$600 + S$1,500 added together
- saying hospital daily allowance applies when no admission was mentioned

### Q4 — after_follow_up
**Expected:** Closed fracture confirmed by X-ray = Simple fracture, Item D Child: S$600. Plus reimbursement of actual accident medical bills under Item F, up to S$2,000 (only against bills; not a fixed sum).

Supporting facts: F04, F05, F06, F07

Forbidden:
- S$1,500 (compound)
- S$1,000 (adult simple)
- S$2,600 stated as a guaranteed total
- S$2,100 (600+1,500)

### Q5 — hospital_cash_calculation
Scenario: Simon admitted after a road accident 14 March 2026 21:40; discharged 18 March 2026 08:20 (times from discharge summary).

1. Duration = 14 Mar 21:40 -> 18 Mar 21:40 is 96h; discharge is 13h20m earlier, so 96h - 13h20m = 82h40m.
2. Complete 24-hour periods: 82h40m / 24h = 3 complete periods (72h).
3. Remainder = 82h40m - 72h = 10h40m, which is less than 12 hours, so disregarded (Clause 4.2).
4. Days of confinement = 3 (within the 60-day annual cap).
5. Benefit = 3 x S$120 (Adult, Item B) = S$360.

**Expected:** S$360 (3 days x S$120).

Supporting facts: F08, F09, F01

Forbidden:
- S$480 (4 nights x 120)
- S$600 (5 calendar dates x 120)
- S$480 from rounding the 10h40m remainder up
- S$330 / S$440 or any use of the Child rate S$80 or S$110
- adding ICU allowance (no ICU stay stated)

### Q6 — amendment
**Expected:** Child hospital daily allowance (Item B) is now S$110 per day, effective 01 July 2026 under Endorsement ME-26-0412 (issued 18 June 2026); previously S$80 per day. Days before 01 July 2026 stay at S$80. Adult amount S$120 unchanged.

Supporting facts: F10, F11, F12, F13, F14

Forbidden:
- S$80 stated as the current child rate
- effective date 18 June 2026 (that is the issue date)
- saying the adult rate changed to S$110
- S$95 or any other figure

### Q7 — absent_fact
**Expected:** The annual premium is not stated in any of the three documents. The Meridian schedule and policy wording show no premium; the endorsement only says "in consideration of the revised premium" without an amount; the Kestrel Bay certificate shows no premium. The assistant should say it is not in the documents and suggest checking the renewal notice/billing statement or asking the insurer.

Supporting facts: none (absent)

Forbidden:
- any dollar figure presented as the premium
- treating a benefit amount (e.g. S$120, S$110) as the premium
- inventing a monthly/annual premium

### Q8 — scanned_footnote
**Expected:** Under Kestrel Bay JuniorShield (certificate KBJ-26-00391, Isla), daily hospital income is S$150 per day, but per the asterisked footnote it is payable only from the 4th consecutive day; the first 3 days of each hospitalisation are not payable. A 2-night/3-day-or-shorter stay therefore gets no daily hospital income from this plan.

Supporting facts: F15, F16, F17

Forbidden:
- S$300 or S$450 for a stay of 3 days or less
- ignoring the footnote and paying from day 1
- attributing the footnote to the Meridian policy

### Q9 — side_question
**Expected:** Meridian SafeStay is accident-only (Clause 3.1): dengue is an illness, so no Meridian benefit. Kestrel Bay JuniorShield (Isla only) covers illness and pays a S$500 lump sum for dengue fever hospitalisation; daily hospital income S$150/day applies only from the 4th consecutive day.

Supporting facts: F18, F19, F20, F16

Forbidden:
- saying Meridian pays S$80/S$110 per day for dengue
- saying JuniorShield covers Felix or the adults
- omitting the accident-only restriction

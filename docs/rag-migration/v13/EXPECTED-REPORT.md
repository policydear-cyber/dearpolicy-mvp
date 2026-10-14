# Expected behaviour on the report-layout household

Fixture: `scripts/fixtures/rag2-stress/report-household.ts`, reconciled with the 14 October live stress-test report.
The expectations below come from the fixture's rendered pages. They were written in the same session as the scripted conversations and checks, so they are not an independent holdout.
The checks live in `scripts/rag2-stress-report-regressions.ts` (no model calls) and `e2e/tests/rag2-stress-report.spec.ts` (browser).

## How the report's structures map to the fixture

All names, insurers, amounts, dates and identifiers in the fixture are invented. The only figures kept from the report are layout figures:
- the S$5,000 Simple Fracture limit;
- the "% of S$5,000" compensation column;
- 50% for the joint row;
- hospital cash payable from the 11th day.

| Report | Fixture |
|---|---|
| Six uploads: one personal-proof certificate, five reference or supporting documents, one marked Could Not Be Read | `CERT` is the personal certificate for both adults. `SUMMARY` and `WORDING` are reference documents linked to both adults. `PET_WORD` and `PET_END` are another insurer's pet wording and endorsement, linked to nobody. `SCAN` is unreadable. |
| The certificate prints Group Term Life and Group Personal Accident separately for each adult, with an "As of" date | GROUP TERM LIFE S$1,200,000 and GROUP PERSONAL ACCIDENT S$450,000 for each adult, as of 15/09/2023 |
| Summary PDF page 13, printed as page 12 of 36: "Simple Fracture Benefit Limit: S$5,000", a compensation column showing a percentage of S$5,000, and the row "Jaw, Pelvis, Leg, Ankle or Knee: 50%". The tibia is not named. | `SUMMARY` page 13, carrying the same layout |
| A separate document's Other Fracture table, with the same joint row at 50% of the Sum Insured | `WORDING` page 1: "Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)" at 50%, under "Compensation (% of Sum Insured)" |
| Daily Hospital Cash from the 11th day, on page 5 | `SUMMARY` page 5, at S$40 per day |
| An invalid 30 February admission date, corrected to 28 February to 2 March at 09:00 Singapore time | Conversation R4 |

## What is expected

**R1 – inventory.** The answer lists every document, grouped by person, with its insurer and role:
- Marcus and Serena each have the certificate as a personal policy document, and the summary and wording as reference wording.
- The pet wording and endorsement are listed as linked to nobody.
- `scan-0042.jpg` is listed as unreadable.
- No amount appears, and nothing from the other household (d404) appears.

**R2 – Personal Accident amount, then a wrong amount.**
- The first answer gives S$450,000 as of 15 September 2023.
- When the user says it is S$1,200,000, the answer says no, gives S$450,000, and explains that S$1,200,000 is the Term Life amount.
- S$1,200,000 is never confirmed as the Personal Accident amount.

**R3 – which base a percentage applies to.**
- A simple tibia fracture, where the tibia falls under the Leg row:
  - 50% of the S$5,000 limit printed in the table's own header, giving S$2,500.
  - Shown only as a conditional illustration.
  - Saved with `benefit_limit` = 5000.
  - The Personal Accident sum insured passed in is not used, so the answer is never S$225,000.
- The what-if for a compound fracture:
  - Uses the Other Fracture row, which is 50% of the Sum Insured, giving S$225,000.
  - Saved with `sum_insured` = 450000 and no `benefit_limit`.
- The two structures are never mixed.

**R4 – dates.**
- 30 February is rejected:
  - the user is asked for the admission date;
  - no stay is calculated;
  - the impossible date is not recorded.
- After the correction to 28 February 09:00 – 2 March 09:00 +08:00:
  - the answer says the stay does not reach the 11th day, provided the provision applies;
  - no amount is given, and S$0 is never shown.
- Repeating the same discharge time with a time zone added is not treated as a correction.

**R5 – switching who the question is about.**
- The answers go Serena (Personal Accident), then Marcus ("my" Term Life), then Serena again (Term Life).
- Each figure is bound to that person's own row.

**R6 – wrong product, with no repair available.**
- The model states the Term Life S$1,200,000 as Personal Accident cover, and the script has no step left for a repair.
- The S$1,200,000 is not shown.
- The certificate and its separate Group Term Life and Group Personal Accident products are still stated, with a citation.
- This passes on safety but is reported as incomplete, because the Personal Accident amount is not given. A generic "couldn't confirm" reply would fail this case.

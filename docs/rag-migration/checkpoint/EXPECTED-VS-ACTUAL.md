# Expected vs actual: every calculation in the demonstrations and the calculation suite

Measured on head 6d75338 (CHECKPOINT.md). Sources:
- **Demo:** DEMO10.md (`npm run rag2:demo10`), the verified CalculationRecord saved with the reply.
- **Adv:** rag2:adversarial-test.
- **Calc:** rag2:calc-test, using the expected-vs-actual table that suite prints.

Rounding is half-up to the cent (currency minor units, integer arithmetic) unless a row says otherwise.
"Household" means the household's own quoted words, recorded as facts. "Document" means a printed figure read from
the person's own column with page and row. Every estimate row has a record that the save-time gate re-runs
(lib/claims/calc-record.ts recomputeCalculation and lib/chat/answer-verification.ts).

## Calculations in the demonstrations (synthetic households Tan and Nair)

| # | Calculation | Operands (source) | Rule (source) | Expected | Actual |
|---|---|---|---|---|---|
| Demo 3 (S3) | KidSafe hospital income, Ethan | rate S$90 (document: KidSafe p1, row "Hospital income (each complete 24 hours, max 60)", Child); admission 2026-10-02 21:30 +08:00 (household: "admitted on 2 October at about 9.30pm"); discharge 2026-10-05 09:00 +08:00 (household: "discharged on 5 October at 9am") | each complete 24 hours (KidSafe p2): floor(59.5 h / 24) = 2 | 2 × S$90 = **S$180.00**, labelled an indicative estimate; never S$270 (3 nights × S$90) | S$180, record saved; gate kept it; the nights-based sentence was dropped |
| Demo 6 (S6b) turn 1 | FamilyFirst daily hospital cash, Rohan | rate S$120 (document: FamilyFirst p1, row "Daily hospital cash (max 90 days per year)", Insured Child); 90-day cap (document: same row label); admission 2026-10-03 21:40 (household); discharge 2026-10-06 10:15 (household) | first full day of admission; the admission day counts only if before 12:00 noon; discharge day not counted (FamilyFirst p2) | 4 and 5 Oct = 2 days × S$120 = **S$240.00** | S$240; the step carries the noon exception (`edges: admission before 720 min`), not met at 21:40 |
| Demo 6 (S6b) turn 2 | same, after the discharge is corrected | discharge corrected to 2026-10-08 11:00 (household: "discharged on 8 October at 11am") | same | 4–7 Oct = 4 days × S$120 = **S$480.00**; the S$240 estimate withdrawn | S$480; reply says the earlier estimate no longer applies |
| Demo 6 (S6a) turn 1 | KidSafe accident medical reimbursement, Ethan | bill S$1,000 (household: "the clinic bill came to S$1,000"); limit S$1,200 per accident (document: KidSafe p1, Child); excess S$100 per accident (document: KidSafe p1, Child) | limit first, then the excess ("The Excess is then deducted … after the limit per accident has been applied", KidSafe) | min(1,000, 1,200) − 100 = **S$900.00** | S$900 (steps: min, then deductible); withdrawn when the person is corrected to Chloe |
| Demo 7 (S7b) | same benefit, order-independent case | bill S$1,000; limit S$1,200; excess S$100 (as above) | either order gives the same result | **S$900.00** | S$900, record kept by the gate |
| Adv S7 | same benefit, order matters | bill S$1,500 (household: "the clinic bill came to S$1,500"); limit S$1,200; excess S$100 | limit first, as the KidSafe wording states (D28) | min(1,500, 1,200) − 100 = **S$1,100.00** (not S$1,200, which is excess-first) | S$1,100 with a verified record; no payout wording (adversarial S7 passes) |
| Demo 8 (S8) | FamilyFirst hospital cash, times unknown | rate S$120 (document) | first full day (needs times) | no estimate; the printed rate plus the specific missing admission/discharge dates and times | as expected |

## Calculations in the calculation suite (scripts/fixtures/rag2-calc/household.ts, synthetic household Wong)

| Check | Operands (source) | Rule (source) | Expected | Actual |
|---|---|---|---|---|
| H1 | HarbourCare rate S$120 Adult (document p1); admission 1 Mar 22:00, discharge 4 Mar 09:00 (household) | each complete period of 24 hours (p2): 59 h gives 2 | 2 × S$120 = S$240 estimate | S$240 estimate |
| H2 | Lumen Night Cash S$200 per night (document p1); 1 May to 6 May (household dates) | each night after the first 2 nights, up to 20 days (p1) | 5 nights − 2 = 3 × S$200 = S$600 | S$600 |
| H2b | HarbourCare child column | the child's own column | S$60 | S$60 |
| H3 | Kestrel DayCare child rate S$80 (p1); 1 Mar 20:00 to 4 Mar 11:00 | first full day; minimum 6 hours; "not payable for day surgery" (p2) | unresolved until the exclusion is settled ("not day surgery"); then 2 × S$80 = S$160 | unresolved then S$160 |
| H10 (D30) | Kestrel child S$80; 1 Mar 09:00 to 4 Mar 11:00 | first full day plus "the day of admission counts as a full day if … admitted before 12 noon" (p2) | 1, 2, 3 Mar = 3 × S$80 = S$240; the gate rejects a tampered exception | S$240; gate kept it, rejected the tampered one |
| H4 | Kestrel child S$80, cap 30 days (document p1); 1 Apr 10:00 to 2 May 09:00, and to 3 May | first full day (+ noon exception), capped at 30 | S$2,400 both times (30 × S$80) | S$2,400 / S$2,400 |
| H5 | Orchid allowance S$50 per day (p1) | none printed | unresolved: printed S$50 plus "how days are counted"; no estimate | unresolved |
| H6 | Kestrel, no dates / dates without times | first full day needs times | unresolved, naming the dates and times | unresolved |
| H7 | Kestrel, 10:00 to 14:00 the same day | minimum 6 hours | not payable (4 hours), with the wording's reason | not payable |
| H8 | compute per_day with a household count of nights | — | refused | refused |
| H9 | HarbourCare S$120; assumed 1 Jun 09:00 to 6 Jun 09:00 | complete 24 h | question: refused; what-if: 5 × S$120 = S$600 illustration | refused / illustration S$600 |
| B1 | bill S$2,400 (household); per fracture S$800 (passage, p2); child annual limit S$1,500 (Insured Child, p1) | sub-limit then limit | min(2,400, 800, 1,500) = S$800 estimate | S$800 estimate |
| B2 | bill S$2,000; deductible S$3,500 (Verdant p1) | — | not payable (the bill does not exceed the deductible) | not payable |
| B3 | bill S$50,000; deductible S$3,500; co-insurance 10%; co-insurance cap S$3,000; limit S$1,000,000 (Verdant p1) | "the deductible applies first, then co-insurance on the balance" (Verdant p1) | 50,000 − 3,500 = 46,500; 10% = 4,650 capped at 3,000; **S$43,500** | S$43,500 |
| B4 | bill S$12,345.67; deductible S$3,500; co-insurance 10% | deductible first | 8,845.67 × 90% = 7,961.103, half-up **S$7,961.10** | S$7,961.10; core 10% of 1015 cents gives 914 (913.5 rounded up) |
| B5 | record with policy rounding (to the dollar, down) | policy rounding | S$100 accepted, S$101 rejected | as expected |
| B6 | Aster: deductible S$2,000, 10%; no order printed | — | unresolved: "deductible or the co-insurance first" | unresolved |
| B8 (D28) | Pebble XS1: limit S$1,200, excess S$100, nothing about order; bill S$1,500 / S$1,000 | silent | S$1,500: unresolved (S$1,100 vs S$1,200); S$1,000: S$900 either way | unresolved / S$900 |
| B8 (D28) | Pebble XS2: same figures plus "The limit per visit applies after the Excess has been deducted from the bill."; bill S$1,500 | excess first, as stated | min(1,500 − 100, 1,200) = **S$1,200** | S$1,200 |
| B7 | SGD bill S$3,000 against a US$50,000 limit | never converts currencies | unresolved (needs the bill in USD); a sum of SGD and USD refused | as expected |
| L1 | sum assured S$150,000; early stage 25%; cap S$50,000 (Mariner p1) | lump sum; the definition is the insurer's | question: unresolved; what-if: 25% × 150,000 = S$37,500 illustration | as expected |
| V1–V14 | tampered or valid records against the gate (wrong operation, column, person, version, rule, unresolved condition, words, nights for days, payout, total, unattributed figure) | — | valid ones kept, every tampered one rejected | 14/14 as expected |
| D1–D3 | day counts under every rule (midnight, +08:00 dates, same day, noon exception) | — | see the calc-test table (13 rows) | all equal |

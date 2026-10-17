# rc-live-6 result: real-model check of applicability, household questions and the enrolment caveat

- **Tested code:** `abe4ec128613a813f39f1202c63670f82b297bfa` (branch `claude/actual-library-repairs`). Product code is
  identical to `b1db393`; `94a94b9`, `9d871c7` and `abe4ec1` change only docs, the live harness/graders and the ledger
  cap. The sandbox has no git checkout, so provenance was checked against a manifest of that commit's tree (919 files
  under the checked roots matched); the production build (`uEMol2cprFU8yOHCo0aE31`) was made from that tree.
- **Pre-registration:** [EXPECTED-rc-live-6.md](EXPECTED-rc-live-6.md), committed before the run (`9d871c7`, authorisation
  added in `abe4ec1`). Grader v4 (`scripts/rag2-live/reliable-chat-check.ts`) was not changed after the run.
- **Model:** `openai:gpt-6-luna` through the existing loopback relay and the existing Composio-held dedicated test key
  (started with DC's approval, 17 Oct 15:40 SGT). No credential was created or copied; no tunnel. Settings:
  temperature 0, tool_choice required, max 2,000 output tokens, reasoning_effort none. Prompt `rag2-loop-v18-applicability`
  (sent prompt matches source).
- **Run:** `rc-live-6-booklet`, order FL1a, FL2, FL3, FL1b, run cap US$0.15. The dry run listed exactly these four.
  One live run, no rerun.
- **Spend:** US$0.009206 over 18 calls (0 refused, 0 failed); worst-case reservations ranged US$0.0026–0.0033 per call.
  Exercise cap US$1.00. Ledger after the run: spent by all runs US$0.355468; `trial-codespace-1` reserved US$0.15
  (open, unspent, not released); **available for automated runs US$0.494532, after the US$0.15 reservation is
  deducted** (US$0.644532 before it; that reservation is not available to automated runs). Earlier entries unchanged.
- **Files:** transcripts `live/RUN-rc-live-6-booklet-2026-10-17T07-41-47/` (conv-*.json, run.json, relay.jsonl,
  server.log, report.md); grade `live/rc-live-6-booklet-2026-10-17T07-41-47-grade.md` / `.json` (every visible answer
  verbatim). report.md's "INCOMPLETE" is the generic checker's label for scenarios graded elsewhere; the verdict is the
  v4 grade.

## Verdicts

| scenario | grader v4 | my review of the complete answers, saved calculations, withdrawals and pending state |
|---|---|---|
| FL1a | PASS | Turn 1 gives the Simple Fracture terms (Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%; of S$5,000), notes the booklet groups the tibia under "leg", gives no amount, and asks one household question (hip or the leg row). Turn 2: conditional S$3,750 with one recomputing calculation bound to the booklet; no Other Fracture, no question, nothing pending. Minor redundancy: "You told me the X-ray confirms it is his hip." |
| FL2 | PASS | Turn 1: S$3,750 and an explicit, definition-based statement that Other Fracture does not fit a closed fracture. Turn 2: says the earlier estimate no longer applies (the Simple Fracture calculation is marked withdrawn on the claim) and gives S$225,000 = 75% × the certificate's S$300,000 Group Personal Accident sum insured, dated 1 April 2024. No question, nothing pending. It adds a statement that the documents do not establish the insurer's medical assessment — a stated limit, not a question. |
| FL3 (synthetic-only evidence) | PASS | Compassionate Death Allowance: funeral expenses up to 2,000 with the currency honestly unstated, accident-caused death within 365 days, proof of death and original receipts, not for illness. No S$ amount, no calculation, no enrolment caveat and no claim about cover on any later date. Every condition comes from that benefit's own section (see "FL3 source check"). |
| FL1b | PASS | Fresh paraphrase. Turn 1: terms, the Other Fracture definition, no amount, one household question ("his hip or his lower leg (shin/tibia)"). Turn 2: conditional S$3,750 only, one calculation, no question, nothing pending. |

**Result: 4 of 4 conversations correct and useful throughout** (7 of 7 turns). **FL3 is synthetic-only evidence:** it ran on the synthetic booklet page; the recorded actual-library passage is tested separately in rc-live-7 ([EXPECTED-rc-live-7.md](EXPECTED-rc-live-7.md)). The three rc-live-5 gaps did not recur
in this sample: no insurer-only question, no Other Fracture illustration for a closed fracture, and no false enrolment
caveat. Four conversations are far too few to estimate a reliability rate.

## FL3 source check (done after the run, before merge)

- The only evidence cited (`e6`) is booklet page 9, **"Section 5 - Compassionate Death Allowance Benefit"**: "…death
  within 365 days of the Accident, we will pay the funeral expenses incurred, up to $2,000, on receipt of proof of death
  and the original receipts. This benefit is not payable for death caused by an illness." The 365-day condition, proof
  of death, original receipts and the illness exclusion are all in that section's own paragraph, before the next
  heading. Nothing was taken from the adjacent "Section 6 - Repatriation" (its $5,000 does not appear; grader check A1C).
- **This is the synthetic booklet fixture, not the actual library.** `scripts/fixtures/reliable-chat/booklet.ts` says
  the live records were not read and the fixture follows the report: the report's page 9 gave the heading, accidental
  death, proof, funeral expenses up to $2,000 (bare $). The 365-day condition and "original receipts" were written into
  the fixture and are not established for the actual library, whose product summary
  (`scripts/fixtures/extraction/group-product-summary.json`) lists only "Compassionate Death Allowance Benefit* Up to
  S$2,000" and says the benefit can be claimed under either the Core Scheme or the Voluntary Scheme. So FL3 shows the
  answer stays inside the right benefit's text and keeps the currency honest; it does not show what the actual
  library's wording requires.

## Latency (send → visible answer; model time is the turn's model calls)

| turn | send → visible | model | calls | cost |
|---|---|---|---|---|
| FL1a.1 | 11.0 s | 9.8 s | 3 | US$0.00177 |
| FL1a.2 | 5.9 s | 4.4 s | 2 | US$0.00113 |
| FL2.1 | 9.7 s | 8.4 s | 3 | US$0.00109 |
| FL2.2 | 7.4 s | 6.2 s | 2 | US$0.00200 |
| FL3 | 9.2 s | 7.8 s | 3 | US$0.00105 |
| FL1b.1 | 9.4 s | 8.2 s | 3 | US$0.00104 |
| FL1b.2 | 6.0 s | 4.7 s | 2 | US$0.00113 |

Every turn finished in 5.9–11.0 s; model time is 75–89% of each turn (relay upstream 1.8–4.1 s per call). Scenario
totals: FL1a 16.9 s, FL2 17.1 s, FL3 9.2 s, FL1b 15.5 s — all within the 20 s scenario target; the one direct lookup
(FL3) met the 10 s target.

## Remaining limitations

- Sample of four conversations on one synthetic household; no reliability rate is claimed. FL3's conditions are the fixture's, not the actual library's (see above).
- Provider-side spend cannot be reconciled independently (usage endpoint 403); the figure is the app's metered charge.
- Not merged, not deployed; main and production unchanged.

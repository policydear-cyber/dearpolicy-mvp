# Structured-answers release: real-model results (sa-live-2, sa-live-3)

Model `gpt-6-luna` through the existing authorised relay; settings as recorded in each `run.json` (temperature 0, tool_choice required, reasoning_effort none, max 2,000 output tokens per call, one retry policy unchanged). Household `actuallib`
(the faithful anonymised fixture, see EXPECTED-structured-answers.md). Every attempt is kept in this repository under `docs/rag-migration/live/`. Nothing was rerun to turn a failure green.

## Attempts

| run | frozen candidate | grader | scenarios | calls | spent (US$) | folder |
|---|---|---|---|---|---|---|
| sa-preflight | e069e8e line | - | none (no model call) | 0 | 0 | RUN-sa-preflight-2026-10-17T15-35-24 |
| sa-live-1 | e069e8e line | - | stopped at HTTP 404 "No household" (harness account missing), no model call | 0 | 0 | RUN-sa-live-1-2026-10-17T15-36-59 |
| sa-live-2 | e069e8e | v8 | SAa SAb SAp SBa SBb SBp SC SD SE | 60 | 0.024357 | RUN-sa-live-2-2026-10-17T15-45-15 (+ sa-live-2-grade.md/json) |
| sa-live-3 | bc428476bb39ec2ad27e5b2ac153b5068518a0f8 | v8.2 | SAa SAb SAq SBa SBb SBp SC SD SE | 51 | 0.025161 | RUN-sa-live-3-2026-10-17T16-07-45 (+ sa-live-3-...-grade.md/json) |

Cumulative spend over all runs: US$0.388122 -> **US$0.413283** (cap US$1.00; the US$0.15 trial reservation untouched; available US$0.436717). 0 refused calls, 0 failed calls.

## sa-live-3 outcome (graded by the frozen v8.2, each scenario once)

PASS: SAa, SAq, SBb, SBp, SD, SE. FAIL: SAb (U1), SBa (Q1), SC (C3).

| scenario | verdict | what the complete answers show |
|---|---|---|
| SAa correction tibia -> hip | PASS | final turn: "Updated: injury is now fractured his hip ... earlier estimate ... no longer applies"; S$450,000 (75% of S$600,000, Group Personal Accident) and **S$3,750** (75% of the S$5,000 Simple Fracture limit) as two complete conditional statements from separate documents, relationship stated as unestablished, no total; contact step present. |
| SAb (independent attempt) | **FAIL U1** | same two complete statements and wording; the contact step for the person's own insurer is missing on the corrected turn (SAa has it). Model behaviour: omitted `next_steps`; no server boundary broken. Not rerun. |
| SAq fresh paraphrase | PASS | corrected to hip, S$3,750 and S$450,000 conditional, complete; "not amounts to add together". |
| SBa ambiguity (attempt 1) | **FAIL Q1** | turn 1 gave both documents' complete percentage tables and said the case is unsettled; it asked **no** question (the check requires exactly one). Turn 2 (tibia): S$2,500 and S$300,000 complete and conditional. Supported terms first, nothing wrong; the missing question is model behaviour. Not rerun. |
| SBb (attempt 2) | PASS | turn 1 both tables + one question (hip or lower leg?); turn 2 both complete conditional illustrations, no repeated question. |
| SBp fresh paraphrase | PASS | **the sa-live-2 structural failure is fixed on the real model**: turn 1 supported terms + one question; turn 2 ("definitely the lower leg, the tibia") gives S$2,500 and S$300,000, no `case_conflict`. |
| SC Simple vs Other | **FAIL C3 (inspected: grader false positive)** | complete S$2,500 and S$300,000 statements with separate bases; "The uploaded wording does not establish that these two benefits are payable together"; "never a total". v8.2 accepts a negated "claimed together/added/combined" but not a negated "payable together", so it flags the honest sentence. The grader was frozen before the run and is **not** changed to accept it; the verdict stays FAIL as graded. One sentence, "the accident benefit is specifically for fractures due to accident", restates the printed row title and adds nothing the documents do not print. |
| SD death allowance | PASS | benefit kept with its three printed conditions, bare "$" currency stated as unstated, contact step. |
| SE person switch | PASS | Grace's own S$3,750 with "Hip"; never Daniel's S$600,000 / 1 April 2024; contact step. |

Honest summary: **6 of 9 pass; the critical correction journey is complete on three independent real-model runs (SAa, SAq pass; SAb's S$3,750 sentence complete but without the contact step); the critical ambiguity journey is complete on two of three (SBb, SBp), SBa gave supported terms without a question.** Two further failures are model behaviour (omitted contact step; no clarifying question) and one is a grader false positive. This is a small sample and is not an accuracy claim.

## Round-by-round trace of what changed
sa-live-2 -> sa-live-3: the only product change is `lib/rag2/evaluate.ts` (an earlier open report is history once a later report names one listed case, whatever fact key it was recorded under and whether or not a question was pending). SBp failed before and passes after; SBa/SBb are different runs of the same scenario where one passes and one does not -- that variation is model behaviour, recorded as is.

## Latency (live, per turn, from `conv-*.json`; model `gpt-6-luna`)
`answerSeenMs` = send accepted -> saved answer observed by the harness over HTTP (server loop plus polling); `modelMs` = time inside model calls; the rest is retrieval, evaluation, verification and save.

| scenario | turn | answer seen (s) | model (s) | calls |
|---|---|---|---|---|
| SAa | 1 / 2 | 12.9 / 7.8 | 11.8 / 6.5 | 3 / 2 |
| SAb | 1 / 2 | 11.0 / 6.3 | 10.4 / 5.9 | 3 / 2 |
| SAq | 1 / 2 | 11.5 / 8.3 | 10.6 / 7.1 | 3 / 2 |
| SBa | 1 / 2 | 17.1 / 8.6 | 15.7 / 7.3 | 5 / 2 |
| SBb | 1 / 2 | 16.1 / 7.3 | 14.8 / 6.3 | 5 / 3 |
| SBp | 1 / 2 | 16.9 / 9.9 | 15.5 / 8.5 | 5 / 3 |
| SC | 1 | 9.6 | 8.3 | 3 |
| SD | 1 | 9.1 | 7.7 | 3 |
| SE | 1 / 2 | 9.9 / 11.9 | 8.5 / 10.3 | 3 / 4 |

Reading: 85-92% of each turn is model upstream time (about 1.3-4 s per call across 2-5 sequential calls); verification, rendering and save are small. Direct answers land at 9-10 s (target 10 s met narrowly); ordinary two-benefit scenarios 6-17 s (target 20 s met). The ambiguity first turns (5 calls, about 16-17 s) are the slowest. Send-to-visible in the real browser was measured only with scripted model moves (no model latency) in the browser specs; it was **not** measured with the live model, so the browser share of live latency is unreported. Cold/warm: one server process, 9 scenarios sequential, so after the first scenario the server is warm; the first scenario (SAa turn 1, 12.9 s) includes the cold start.

## Limitations
- The PR #54 live-verification report was not available; the concrete findings in the request were used.
- The fixture reproduces the repo's stored page text of the two real documents; the GPA sum insured (S$600,000), dates and metadata are INFERRED; Grace and the other household are INVENTED controls. Nothing was run on the actual library.
- Scripted journeys prove plumbing, not model choices; the real-model sample is nine scenarios once each.
- `rag2:s52-replay` (11/12) fails identically on the baseline `81b1b07`; unchanged by this work.
- Open model behaviour: omitted contact step (SAb), no clarifying question (SBa), evaluating only one fracture table in some ambiguity turns (sa-live-2).

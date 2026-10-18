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

## Final verification of the tested code (`bc428476bb39ec2ad27e5b2ac153b5068518a0f8`; the branch head after it differs by documents only)
Node v22.22.2.
- `tsc --noEmit`: clean. `next build`: succeeds (locally and in the live-run workbench).
- `scripts/reliable-chat-structured-answers.ts`: 52 of 52 (7 journeys + J3b + negative controls + grader controls); transcripts `transcripts/structured-answers-BASELINE-86c5940.txt` (22 of 35, 13 failing, on main) and `structured-answers-AFTER.txt` (regenerated from the tested code).
- Regression suites (66 scripted `rag2:*` suites): 65 pass; `rag2:s52-replay` 11/12 fails identically on baseline `81b1b07` (pre-existing, not touched).
- Real-browser journeys (Chromium, real chat page and /api/chat, scripted model moves, displayed = saved = reloaded): actual-library 5 of 5 (SA2 correction + reload, SA3, SA4, SA5, SA6), booklet 6 passed (3 skipped by their own config), RC8/FL5 3 of 3, tan household 3 of 3.
- Scripted-model latency (no model time): server loop 71-251 ms per turn; send-to-visible 2.0-2.9 s, which is the page's polling interval. So in the live runs above, model upstream time is the only substantial server-side component; the browser adds about 2 s (polling) on top, measured only with scripted moves.

## Round 3 (PR #55 follow-up) — sa-live-4 and sa-live-5

Generated from the retained run files (`conv-*.json`, `run.json`, `regrade-v9.1.json`); nothing below is edited by hand. Original graders v8/v8.2 are unchanged; the revised assessment is grader v9.1 (`scripts/rag2-live/structured-regrade.ts`, rules R2/R3/R2(d) in `reliable-chat/EXPECTED-structured-answers.md`, each recorded before its evaluator change), published separately in each run folder (`regrade-v9.1.json`; the v9 files written earlier stay beside them).

| run | tested code SHA | scenarios (once each) | model calls | cost | refused |
|---|---|---|---|---|---|
| sa-live-4 | `a2bffa601a740a1b6844c6d25f9ca1f5d99eb8af` | SBa, SBb, SAr | 21 | US$0.010812 | 0 |
| sa-live-5 | `7f3b0d1663a1c132e01d2f047a01ec6b4df3a5e9` | SAr, SAs | 14 | US$0.008165 | 0 |

Cumulative: spent over all runs US$0.432260 of the US$1.00 authorisation; the US$0.15 trial-codespace reservation untouched; US$0.417740 unreserved remains. Every attempt is retained; SBb's unchanged model-selection failure was not rerun; no limit was raised and no retry added.

sa-live-5's tested SHA is the final product code of this release. Commits after it change only graders, offline checks and documents (`scripts/rag2-live/structured-regrade.ts`, `scripts/reliable-chat-structured-answers.ts`, docs and these run records).

### Verdicts (v8.2 as run / v9.1 revised)
| run | scenario | v8.2 | v9.1 | what it shows |
|---|---|---|---|---|
| sa-live-4 | SBa | PASS | PASS | the omitted-question defect (sa-live-3 SBa) is fixed: terms of both tables, one question, clarified turn gives both illustrations |
| sa-live-4 | SBb | FAIL (Q2, Q4) | FAIL | model evaluated only the Group Personal Accident table (selection, open item since sa-live-2); the server-owned question and the clarified S$300,000 were correct for that table |
| sa-live-4 | SAr | FAIL (K2, K5, U1) | FAIL | real defect: first report under two keys + “not the lower leg” negation → case_conflict → a needless question; fixed in `7f3b0d1` |
| sa-live-5 | SAr | FAIL (U1) | PASS | complete S$3,750 and S$450,000 alternatives, tibia amounts withdrawn, no question; the contact step was given in turn 1 and not repeated (R2(d)) |
| sa-live-5 | SAs | PASS | PASS | fresh paraphrase (shin bone → hip) correct first time |

Re-assessment of sa-live-3 under v9.1 (original grades stay): SAb FAIL→PASS (R2(c)), SC FAIL→PASS (negated “payable together”, R3); SBa stays FAIL (that was the real omitted-question defect). Positive and negative controls for each rule run in `scripts/reliable-chat-structured-answers.ts`.

### Complete answers

#### sa-live-4- SAr — v8.2 **FAIL**, v9.1 **FAIL** (failed v8.2: K2, K5, U1; failed v9.1: K2, K5, U1)

6 model calls, US$0.003949; scripted-run timings (harness → live HTTP route → relay model; **not** browser latency): first assistant text persisted 10241 ms into the scenario, scenario total 21645 ms.

**Turn 1 — household:** Daniel came off his bicycle this morning and the doctor says he has a closed break in his lower leg, the tibia. If we claimed on his accident cover, what could that be worth?

**Complete visible answer:**
```
If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$300,000: 50% of Daniel's sum insured of S$600,000 (Group Personal Accident), under the Group Personal Accident Benefit Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
If the Simple Fracture benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
Daniel’s certificate lists Group Personal Accident of S$600,000 as of 1 April 2024; it does not confirm cover on today’s date.
The Group Personal Accident Benefit Summary (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Daniel's own sum insured; the Group Insurance Product Summary (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.
```
Saved calculations: kbc169fde95 = 300000 SGD, kf7b1bf9abb = 2500 SGD; questions: 0

**Turn 2 — household:** The doctor has corrected it: the break is actually at the hip, not the lower leg. Same closed fracture. What does that change?

**Complete visible answer:**
```
Updated: fracture site is now hip (you said tibia at first). The earlier estimate worked out from it no longer applies. I’ve recorded the doctor’s correction; the earlier estimates based on the tibia are withdrawn. The Group Personal Accident Benefit Summary (page 8) pays the Simple Fracture or Other Fracture due to Accident as a percentage of Daniel's own sum insured (S$600,000 on the certificate) for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%; Cheekbone, Shoulder or Hairline Fracture of Skull or Spine 30%; Arm, Elbow, Wrist or Ribs (Other Fracture) 20%. The Group Insurance Product Summary (page 13) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%; Cheekbone, Shoulder or Hairline Fracture of Skull or Spine 30%; Arm, Elbow, Wrist or Ribs 25%.
Can you confirm that the fracture is at Daniel’s hip, rather than his lower leg?
```
Saved calculations: none; questions: 1

Pending state after the last turn: `{"why": "\u201cJaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%\u201d (page 8)", "kind": "fact", "turn": 2, "caseOf": "bd46d4e45bd", "factKey": "listed_case_bd46d4e45bd", "question": "Can you confirm that the fracture is at Daniel\u2019s hip, rather than his lower leg?", "benefitId": "bd46d4e45bd", "subjectId": "7c000000-0000-4000-8000-000000000001", "evidenceIds": ["e13"], "requirementId": "q2_3"}`

#### sa-live-4- SBa — v8.2 **PASS**, v9.1 **PASS**

7 model calls, US$0.003819; scripted-run timings (harness → live HTTP route → relay model; **not** browser latency): first assistant text persisted 17655 ms into the scenario, scenario total 26966 ms.

**Turn 1 — household:** Daniel fell and the doctor says he fractured his hip, or possibly his tibia - they are not sure yet. It is a closed fracture from an accident at home. What would his accident cover pay?

**Complete visible answer:**
```
The Group Personal Accident Benefit Summary (page 8) pays the Simple Fracture or Other Fracture due to Accident as a percentage of Daniel's own sum insured (S$600,000 on the certificate) for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%; Cheekbone, Shoulder or Hairline Fracture of Skull or Spine 30%; Arm, Elbow, Wrist or Ribs (Other Fracture) 20%. The Group Insurance Product Summary (page 13) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%; Cheekbone, Shoulder or Hairline Fracture of Skull or Spine 30%; Arm, Elbow, Wrist or Ribs 25%. You said the fracture may be in Daniel’s hip or tibia, and is closed. The documents do not establish which fracture site is confirmed, so the applicable listed case and any calculation remain unresolved.
Which of these cases is it: Hip or Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)?
```
Saved calculations: none; questions: 1

**Turn 2 — household:** The scan shows it is the tibia.

**Complete visible answer:**
```
If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$300,000: 50% of Daniel's sum insured of S$600,000 (Group Personal Accident), under the Group Personal Accident Benefit Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
If the Simple Fracture benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
You told me the scan shows it is the tibia.
The Group Personal Accident Benefit Summary (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Daniel's own sum insured; the Group Insurance Product Summary (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.
```
Saved calculations: kbc169fde95 = 300000 SGD, kf7b1bf9abb = 2500 SGD; questions: 0

Pending state after the last turn: `null`

#### sa-live-4- SBb — v8.2 **FAIL**, v9.1 **FAIL** (failed v8.2: Q2, Q4; failed v9.1: Q2, Q4)

8 model calls, US$0.003045; scripted-run timings (harness → live HTTP route → relay model; **not** browser latency): first assistant text persisted 12196 ms into the scenario, scenario total 21119 ms.

**Turn 1 — household:** Daniel fell and the doctor says he fractured his hip, or possibly his tibia - they are not sure yet. It is a closed fracture from an accident at home. What would his accident cover pay?

**Complete visible answer:**
```
The Group Personal Accident Benefit Summary (page 8) pays the Simple Fracture or Other Fracture due to Accident as a percentage of Daniel's own sum insured (S$600,000 on the certificate) for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%; Cheekbone, Shoulder or Hairline Fracture of Skull or Spine 30%; Arm, Elbow, Wrist or Ribs (Other Fracture) 20%.
Which of these cases is it: Hip or Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)?
```
Saved calculations: none; questions: 1

**Turn 2 — household:** The scan shows it is the tibia.

**Complete visible answer:**
```
If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$300,000: 50% of Daniel's sum insured of S$600,000 (Group Personal Accident), under the Group Personal Accident Benefit Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
You told me the scan shows it is the tibia.
The Group Personal Accident Benefit Summary says the benefit applies to bodily injury resulting from an accident and a fracture of a nature listed in its schedule.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.
```
Saved calculations: kbc169fde95 = 300000 SGD; questions: 0

Pending state after the last turn: `null`

#### sa-live-5- SAr — v8.2 **FAIL**, v9.1 **PASS** (failed v8.2: U1; failed v9.1: none)

5 model calls, US$0.003495; scripted-run timings (harness → live HTTP route → relay model; **not** browser latency): first assistant text persisted 11493 ms into the scenario, scenario total 19702 ms.

**Turn 1 — household:** Daniel came off his bicycle this morning and the doctor says he has a closed break in his lower leg, the tibia. If we claimed on his accident cover, what could that be worth?

**Complete visible answer:**
```
If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$300,000: 50% of Daniel's sum insured of S$600,000 (Group Personal Accident), under the Group Personal Accident Benefit Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
If the Simple Fracture benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
The accident wording says the fracture must result from bodily injury due to an accident and be of a nature listed in its schedule.
Daniel’s certificate lists Group Personal Accident of S$600,000 as of 1 April 2024; it does not confirm cover on today’s date.
The Group Personal Accident Benefit Summary (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Daniel's own sum insured; the Group Insurance Product Summary (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.
```
Saved calculations: kbc169fde95 = 300000 SGD, kf7b1bf9abb = 2500 SGD; questions: 0

**Turn 2 — household:** The doctor has corrected it: the break is actually at the hip, not the lower leg. Same closed fracture. What does that change?

**Complete visible answer:**
```
Updated: injury is now closed break at the hip (you said closed break in his lower leg, the tibia at first). The earlier estimate worked out from it no longer applies.
If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Hip”, the conditional illustration is S$450,000: 75% of Daniel's sum insured of S$600,000 (Group Personal Accident), under the Group Personal Accident Benefit Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
The uploaded documents do not establish which of these two documents applies or whether one amends, replaces or adds to the other.
The Group Personal Accident Benefit Summary (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Daniel's own sum insured; the Group Insurance Product Summary (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.
```
Saved calculations: k3e3cbe7d15 = 450000 SGD, kf23904b42c = 3750 SGD; questions: 0

Pending state after the last turn: `null`

#### sa-live-5- SAs — v8.2 **PASS**, v9.1 **PASS**

9 model calls, US$0.004670; scripted-run timings (harness → live HTTP route → relay model; **not** browser latency): first assistant text persisted 11310 ms into the scenario, scenario total 30948 ms.

**Turn 1 — household:** Daniel slipped on a wet floor in the kitchen and the hospital says his shin bone, the tibia, is broken cleanly - a closed fracture. If we made a claim under his accident insurance, roughly what would it be worth?

**Complete visible answer:**
```
If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$300,000: 50% of Daniel's sum insured of S$600,000 (Group Personal Accident), under the Group Personal Accident Benefit Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
If the Simple Fracture benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
The Group Personal Accident Benefit Summary (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Daniel's own sum insured; the Group Insurance Product Summary (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.
```
Saved calculations: kbc169fde95 = 300000 SGD, kf7b1bf9abb = 2500 SGD; questions: 0

**Turn 2 — household:** Sorry, the hospital rang back: it is the hip that is broken, not the shin bone. Still a closed fracture. What would it be worth now?

**Complete visible answer:**
```
Updated: fracture site is now hip (you said tibia at first). The earlier estimate worked out from it no longer applies.
If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Hip”, the conditional illustration is S$450,000: 75% of Daniel's sum insured of S$600,000 (Group Personal Accident), under the Group Personal Accident Benefit Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
The uploaded documents do not establish whether one amends, replaces or adds to the other, or which applies to Daniel’s event; treat the figures as alternatives, not a total.
The Group Personal Accident Benefit Summary (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Daniel's own sum insured; the Group Insurance Product Summary (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.
```
Saved calculations: k3e3cbe7d15 = 450000 SGD, kf23904b42c = 3750 SGD; questions: 0

Pending state after the last turn: `null`

# PR #47 actual-model reproduction: first result (s47-live-1)

- **Verdict (pre-registered grader `scripts/rag2-live/scenario-check.ts`): FAIL.** 3 of 40 checks failed. The grader labelled the earliest failing stage *calculation*; the diagnosis below finds it is *verification/presentation*. This is the first and only run: it was not rerun, and the expectations were not changed.
- **Code tested:** product code `eaf88a7`. The harness was at `e1b86da`/`b13e7c5`, which change test tooling only.
- **Model:** requested `openai:gpt-6-luna`; the provider reported `gpt-6-luna`. Calls went through the Composio relay, and the key never entered the sandbox.
- **Household:** the synthetic PR #47 household (`RAG2_LIVE_HOUSEHOLD=scenario`), through the real `/api/chat` route on the `next build`, with a local PostgreSQL.
- **Cost:** US$0.011071 for 29 calls, with 0 refused and 0 failed. The run cap was US$0.05. Ledger after the run: remaining US$0.16604, with the US$0.15 reservation unchanged.
- **Time:** 127.2 s for the conversation.

| turn | answer seen (s) | model time (s) | calls | input / output tokens | cost (US$) |
|---|---|---|---|---|---|
| 1 | 22.1 | 21.4 | 6 | 48644 / 1017 | 0.001960 |
| 2 | 28.8 | 27.4 | 4 | 32944 / 880 | 0.001824 |
| 3 | 24.5 | 23.2 | 4 | 31671 / 968 | 0.001669 |
| 4 | 10.7 | 9.4 | 4 | 29936 / 352 | 0.001269 |
| 5 | 25.8 | 24.5 | 6 | 62793 / 1322 | 0.002578 |
| 6 | 15.3 | 13.9 | 5 | 42131 / 830 | 0.001771 |

## Visible transcript (exactly as shown)

**USER:** Desmond broke his leg.

**APP:**

> I’m sorry Desmond has been hurt. The policy lists fracture benefits as a percentage of the Sum Insured, with different percentages for a thigh bone, lower leg, and kneecap; fracture benefits require X-ray confirmation, and the payable percentage also differs for simple (closed) versus compound (open) fractures.
> How did Desmond break his leg?

**USER:** He fell down the stairs.

**APP:**

> Thanks for letting me know. Desmond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025. The fracture benefit lists 10% of the Sum Insured for a thigh bone, 6% for a lower leg, and 4% for a kneecap; it is payable only for a fracture confirmed by X-ray, with 50% of the listed percentage for a simple (closed) fracture and the full listed percentage for a compound (open) fracture.
> Which bone was fractured—his thigh bone (femur), lower leg (tibia or fibula), or kneecap (patella)?

**USER:** Yes, confirmed with an X-ray. He was also warded for two nights.

**APP:**

> Desmond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025. The policy lists 10% of the Sum Insured for a fracture of the thigh bone (femur), 6% for the lower leg (tibia or fibula), and 4% for the kneecap (patella); fracture benefits are payable only when confirmed by X-ray, with 50% of the listed percentage for a simple (closed) fracture and the full percentage for a compound (open) fracture. Accident Hospital Income is S$100 for each complete 24-hour period of continuous inpatient confinement, up to 90 days per Accident.
> Which bone was fractured—his thigh bone (femur), lower leg (tibia or fibula), or kneecap (patella)?

**USER:** Transverse fracture.

**APP:**

> Thanks; I’ve noted that the fracture was transverse. The fracture schedule distinguishes these bones.
> Which bone was fractured—his thigh bone (femur), lower leg (tibia or fibula), or kneecap (patella)?

**USER:** The tibia. It was a closed fracture.

**APP:**

> You told me the fracture was in Desmond’s tibia and was closed; you also said it was confirmed by X-ray.
> Accident Hospital Income is S$100 for each complete 24-hour period of continuous inpatient confinement, up to 90 days per Accident; two nights alone do not establish the number of complete 24-hour periods.
> What you’ve told me is your own account, not a reviewed medical record: the insurer will check it against the documents it asks for (such as the doctor’s report and the test or scan results) and decides the claim after reviewing them.
> I haven’t stated the amount for Lim Wei Jie, Desmond in Meridian Public Service Group Scheme - Certificate (page 1), because I couldn’t confirm it against the document.

**USER:** Admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026.

**APP:**

> You told me Desmond was admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026.
> Accident Hospital Income is S$100 for each complete 24-hour period of continuous inpatient confinement, up to 90 days per Accident; based on those times, Desmond’s indicative estimate is S$100, assuming at least 1 of the 90 days is still available this accident.

## Failed checks

- turn 5: the closed-tibia illustration S$9,000 (6% x S$300,000 x 50%) is shown (calculation)
- turn 5: a saved lump_sum record of S$9,000 for the lower leg (calculation)
- turn 5: the save-time gate rejected nothing in this turn (verification)

## Grading summary (complete conversation, plus saved state)

| Requirement | Result |
|---|---|
| Desmond's Personal Accident amount (S$300,000), not Term Life, Grace's or another household's | **pass**: turns 2 and 3 |
| Dated attribution ("as of 1 July 2025"), never "current cover" | **pass** |
| "Transverse" does not select a payout category | **pass**: noted and asked again for the bone; no "Other fracture", no correction |
| Closed tibia: the policy's 6% and the 50% simple-fracture share | **FAIL (visible)**: the model's `calculate` produced the correct S$9,000 conditional illustration, but the household never saw it |
| Hospital cash: the counting rule; two nights ≠ two days | **pass**: complete 24-hour rule stated at turns 3 and 5, never S$200; turn 6 S$100 indicative estimate, with a saved hospital_cash record of 100 |
| Hospital information addressed when reported | **pass**: turn 3 |
| Facts remembered; no unnecessary repeat questions | **pass**: facts saved (X-ray, nights, transverse, tibia, closed, both times). The bone was asked at turns 2–4; that is not a repeat, because it was not yet answered. |
| Citations; illustration vs approved | **pass**, except that the turn-5 sentence holding S$300,000 was rejected by the save-time gate |
| Final answer useful | **pass**: turn 6 gives the S$100 indicative estimate with its rule and assumption |

## Earliest failing stage, and the smallest general fix

All of this is in turn 5's tool trace (`run.json` → `conversations[0].loaded.turns[4].trace`):

1. **Tool selection and calculation worked.**
   - The model first passed an invented value id (`v_lower_leg`) and was refused.
   - It then read the row with `select_table_value` and called `calculate lump_sum` with `proportion` (50% for a simple fracture).
   - The result was correct: **S$9,000**, `conditional_illustration`.
2. **Verification and presentation failed (the earliest failing stage).**
   - **Illustration dropped.** The model worded it "on those reported facts, the conditional illustration is S$9,000". The composer requires an illustration to state its condition with "if", so it dropped the sentence. The turn's one repair named this, but the model's second answer left the sentence out instead of rewording it.
   - **Certificate figure rejected.** The sentence "The policy lists 6% … and Desmond's certificate lists … S$300,000 as of 1 July 2025" carried one `benefit` label ("Fracture of lower leg"), and the composer bound the certificate figure to it. The save-time gate correctly refused the figure, because it is printed under GROUP PERSONAL ACCIDENT, not under that label. The household saw "I haven't stated the amount for Lim Wei Jie, Desmond …".
   - **Paperwork note.** The "your own account … the insurer will check" note appeared once, at turn 5, which is allowed.
3. **Smallest general fixes (proposed, not implemented here).**
   - **Fix a, compose.ts.** When an illustration sentence is dropped only for its "if" wording, and the turn's one repair is spent, have the grounded fallback state that calculation from its own record: "If it is <the calculation's condition>, an indicative illustration is S$X." Every part comes from the verified record, as the fallback already does for passages.
   - **Fix b, compose.ts.** When a cited passage is a person row under a product heading (a certificate roster), bind the figure to that heading, never to the sentence's `benefit` field. A sentence that states two benefits then binds each figure correctly.

Both are narrow composer changes covered by the existing regression suites. No other material defect was observed in this run.

## Correction (appended later; the result above is unchanged)

The grade's stage label "calculation" was wrong: the tool calculation succeeded. The first rejection was in **composition** (the illustration's wording), then **verification** (the certificate figure was bound to the roster row's name cell instead of its product heading). See `scenario-grade-CORRECTION.md` in the run directory. The fixes and the replay of this trace are in the next section of the PR description.

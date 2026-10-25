# PR #47 actual-model reproduction: fourth run (s47-live-4) after the structural fix

- **Code tested:** `22fd523` (22fd52384596d60e9e2e6f194823eade9579d53f). Prompt `rag2-loop-v12`. Model: requested `openai:gpt-6-luna`; the provider reported `gpt-6-luna`.
- **Verdict** (pre-registered grader `scripts/rag2-live/scenario-check.ts`, unchanged): **PASS**, 0 of 48 checks failed. (run.ts labels the conversation "INCOMPLETE -- graded by scenario-check.ts"; that is its placeholder before grading, not a failure.)
- **Cost:** US$0.010092, 28 calls, 0 refused, 0 failed. Run cap US$0.03. Ledger remaining after the run: US$0.134008; the US$0.15 reservation `trial-codespace-1` is untouched.
- **Time:** 78.8 s for the conversation; first useful answer 18.4 s.
- Evidence class: ONE real-model run. Not repeated. Scripted and replay results are reported separately (below).

| turn | loop time (s) | model calls | cost (US$) |
|---|---|---|---|
| 1 | 17.9 | 6 | 0.001802 |
| 2 | 15.2 | 7 | 0.002236 |
| 3 | 10.4 | 4 | 0.001634 |
| 4 | 3.4 | 2 | 0.001013 |
| 5 | 10.0 | 4 | 0.001649 |
| 6 | 15.6 | 5 | 0.001759 |

## Visible transcript (exactly as shown)

**USER:** Raymond broke his leg.

**APP:**

> Raymond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025; the fracture schedule lists 10% for a thigh-bone (femur) fracture, 6% for a lower-leg (tibia or fibula) fracture, and 4% for a kneecap (patella) fracture, with fracture benefits payable only when confirmed by X-ray.
> How did Raymond break his leg?
> This changes what your policy pays under: “Death due to Accident 100%” (page 1); “Fracture benefits are payable for a fracture confirmed by X-ray. For a simple (closed) fracture 50% of the percentage shown is payable; the full percentage s…” (page 1); “Accident Hospital Income: S$100 for each complete period of 24 hours of continuous confinement in a hospital as an in-patient as a direct result of an Accide…” (page 2); “We will not pay for injury caused by illness or disease.” (page 2)

**USER:** He fell down the stairs.

**APP:**

> Raymond’s fracture schedule lists 10% of the Sum Insured for a femur fracture, 6% for a tibia or fibula fracture, and 4% for a patella fracture; fracture benefits are payable only when confirmed by X-ray. Raymond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025; the fracture schedule lists 10% for a thigh-bone (femur) fracture, 6% for a lower-leg (tibia or fibula) fracture, and 4% for a kneecap (patella) fracture, with fracture benefits payable only when confirmed by X-ray.
> Which bone did Raymond fracture: the femur (thigh bone), tibia or fibula (lower leg), or patella (kneecap)?
> This changes what your policy pays under: “Fracture of thigh bone (femur) 10%” (page 1); “Fracture benefits are payable for a fracture confirmed by X-ray. For a simple (closed) fracture 50% of the percentage shown is payable; the full percentage s…” (page 1)

**USER:** Yes, confirmed with an X-ray. He was also warded for two nights.

**APP:**

> Raymond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025; the fracture schedule lists 10% for a thigh-bone (femur) fracture, 6% for a lower-leg (tibia or fibula) fracture, and 4% for a kneecap (patella) fracture, with fracture benefits payable only when confirmed by X-ray. Accident Hospital Income is S$100 for each complete 24-hour period of continuous inpatient confinement directly resulting from an Accident, up to 90 days per Accident; Raymond’s two nights do not establish the number of complete 24-hour periods.
> Which bone did Raymond fracture: the femur (thigh bone), tibia or fibula (lower leg), or patella (kneecap)?
> This changes what your policy pays under: “Fracture of thigh bone (femur) 10%” (page 1); “Fracture benefits are payable for a fracture confirmed by X-ray. For a simple (closed) fracture 50% of the percentage shown is payable; the full percentage s…” (page 1); S****514D (page 1); “Accident Hospital Income: S$100 for each complete period of 24 hours of continuous confinement in a hospital as an in-patient as a direct result of an Accide…” (page 2)

**USER:** Transverse fracture.

**APP:**

> Raymond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025; the fracture schedule lists 10% for a thigh-bone (femur) fracture, 6% for a lower-leg (tibia or fibula) fracture, and 4% for a kneecap (patella) fracture, with fracture benefits payable only when confirmed by X-ray.
> Which bone did Raymond fracture: the femur (thigh bone), tibia or fibula (lower leg), or patella (kneecap)?
> This changes what your policy pays under: “Fracture of thigh bone (femur) 10%” (page 1); “Fracture benefits are payable for a fracture confirmed by X-ray. For a simple (closed) fracture 50% of the percentage shown is payable; the full percentage s…” (page 1); S****514D (page 1)

**USER:** The tibia. It was a closed fracture.

**APP:**

> You told me, “The tibia. It was a closed fracture.”
> Raymond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025, and the fracture schedule lists 6% for a lower-leg (tibia or fibula) fracture; for a simple (closed) fracture, 50% of that percentage is payable, and fracture benefits require X-ray confirmation.
> If the insurer’s medical assessment confirms that Raymond’s diagnosis meets the policy’s definition of a closed tibia fracture, the indicative illustration is S$9,000; this is conditional, not a confirmed payment, and only for an injury the insurer accepts as caused by an accident (the policy says “Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means”).
> Accident Hospital Income is S$100 for each complete 24-hour period of continuous inpatient confinement directly resulting from an Accident, up to 90 days per Accident, and Raymond’s two nights do not establish how many complete 24-hour periods he was confined.
> The fracture illustration remains subject to the insurer’s medical assessment and claim review.

**USER:** Admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026.

**APP:**

> You told me, “Admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026.”
> Based on those times, Raymond’s indicative estimate under Accident Hospital Income is S$100 for one complete 24-hour period; the benefit pays S$100 for each complete 24-hour period of continuous inpatient confinement directly resulting from an Accident, up to 90 days per Accident, assuming at least 1 of the 90 days is still available this accident.
> Keep the hospital discharge summary or bill showing the admission and discharge times for the claim.
> Indicative estimates are worked out from your documents and what you have told me; they are not a payout, and the insurer decides what it pays.

## Failure stages / what still went wrong (from the saved trace)

No grader check failed. Observations that the grader does not score:
- **Turn 2:** three model attempts were refused before the accepted question (a certificate sentence not naming its benefit, the percentage-without-amount nudge, a final answer that asked nothing). The accepted reply repeats the schedule percentages twice.
- **Turn 4 ("Transverse fracture."):** the model asked the right question (the still-unanswered bone question was the pending one), but it did not say why "transverse" does not settle the row. The server's explanation only fires when the model repeats a *different* pending question; it did not apply here.
- **Turn 6:** the model's first `calculate` passed `rate_evidence_id` with `policy_id: "unknown"`; the loop refused it ("printed in another document ... not the calculation's policy_id"). The model's second call succeeded and the server read the rate line from the stored record. The amount, the counted period and the prior-use assumption were stated; prior use was not asked as a separate question in this run.
- **"This changes what your policy pays under" lines** (the reason text under a question) show raw passage fragments, including a masked certificate row label (`S****514D`) and "Death due to Accident 100%". Synthetic data, but this is not useful household-facing text. Pre-existing behaviour; not changed in this PR.
- The saved trace stores calculation arguments after server-side resolution, so it does not show whether a given call selected evidence by id or quoted it. Turn 5's share quote ends with the page's own ";" (what the resolver produces).

## Verification before this run (no model calls)

- Replay of all three earlier actual-model runs (`npm run rag2:scenario-replay-test`): **22/22**. Each run's turn 5 shows the S$9,000 illustration from a saved, re-runnable lump_sum record cited to CERT p1 and PA_WORD p1; each run's turn 6 shows the S$100 estimate from a saved hospital_cash record cited to PA_WORD p2; no turn errors or gate rejections.
  - s47-live-3 turn 5: the recorded proportion quote ending "." (page prints ";") is accepted; the percentage is read from the schedule row.
  - s47-live-3 turn 6: the recorded paraphrased rate is still refused; the hospital calculation left open in turn 3 is completed from the recorded admission/discharge; duration, amount and prior-use assumption kept apart; prior use asked on its own.
  - s47-live-3 turns 2-4: questions name Raymond; the compound question asks one clause; "Transverse fracture" is explained and leads back to the unanswered bone question.
- Negative controls (same suite): identical figures in different benefits; another document / another person's retrieval / unknown id / stale document version / wrong page; changed figure, added negation, changed qualifier; a share asked for the other case or a changed share; conflicting counting rules (no estimate); new facts while another question is pending (each benefit completes when its own facts arrive, the other question is still asked).
- `rag2:scenario-test` 16/16; 42 affected suites pass; typecheck clean; `next build` ok; spending guard 17/17; browser journey 8/8.

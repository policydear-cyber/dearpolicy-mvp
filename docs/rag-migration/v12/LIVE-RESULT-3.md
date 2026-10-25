# PR #47 actual-model reproduction: third run (s47-live-3) after the bounded certificate lookup

- **Code tested:** `315183e`. Model: requested `openai:gpt-6-luna`; the provider reported `gpt-6-luna`.
- **Verdict** (pre-registered grader, unchanged): **FAIL**. 4 of 44 checks failed.
- **Cost:** US$0.009676, 26 calls, 0 refused and 0 failed. The run cap was US$0.03. Ledger remaining after the run: US$0.1441, with the US$0.15 reservation untouched.
- **Time:** 94.0 s for the conversation.

| turn | answer seen (s) | model time (s) | calls | cost (US$) |
|---|---|---|---|---|
| 1 | 25.3 | 24.6 | 4 | 0.000827 |
| 2 | 15.6 | 14.5 | 5 | 0.001982 |
| 3 | 20.2 | 18.8 | 6 | 0.002532 |
| 4 | 5.4 | 4.8 | 2 | 0.000868 |
| 5 | 14.5 | 14.1 | 5 | 0.001875 |
| 6 | 13.0 | 11.9 | 4 | 0.001592 |

## Visible transcript (exactly as shown)

**USER:** Raymond broke his leg.

**APP:**

> I’m sorry to hear that.
> How did the leg injury happen?

**USER:** He fell down the stairs.

**APP:**

> I’m sorry that happened. Raymond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025. The fracture schedule lists 10% of the Sum Insured for a thigh-bone (femur) fracture, 6% for a lower-leg (tibia or fibula) fracture, and 4% for a kneecap (patella) fracture; fracture benefits require X-ray confirmation, and the percentage depends on whether the fracture is simple (closed) or compound (open).
> Which bone in your leg was fractured (femur, tibia, fibula, or kneecap/patella)?

**USER:** Yes, confirmed with an X-ray. He was also warded for two nights.

**APP:**

> Raymond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025. The fracture benefit is payable for a fracture confirmed by X-ray; the schedule lists 10% of the Sum Insured for a thigh-bone (femur) fracture, 6% for a lower-leg (tibia or fibula) fracture, and 4% for a kneecap (patella) fracture, with 50% of the listed percentage for a simple (closed) fracture and the full listed percentage for a compound (open) fracture. Accident Hospital Income is S$100 for each complete 24-hour period of continuous inpatient confinement, up to 90 days per accident; the two nights alone do not establish the number of complete 24-hour periods.
> What were your admission and discharge dates and times (Singapore time), and had any Accident Hospital Income already been paid for this accident?

**USER:** Transverse fracture.

**APP:**

> I'm asking because it changes which of the policy's benefits or amounts applies.
> What were your admission and discharge dates and times (Singapore time), and had any Accident Hospital Income already been paid for this accident?

**USER:** The tibia. It was a closed fracture.

**APP:**

> You told me, “The tibia. It was a closed fracture.”
> Raymond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025; this is the amount shown on that date, not confirmation of cover on a later date.
> The schedule lists 6% of the Sum Insured for a fracture of the lower leg (tibia or fibula), and the wording says 50% of that percentage applies to a simple (closed) fracture; fracture benefits are payable for a fracture confirmed by X-ray.
> Accident Hospital Income is S$100 for each complete 24-hour period of continuous inpatient confinement, up to 90 days per accident, and the two nights alone do not establish the number of complete 24-hour periods.
> What you’ve told me is your own account, not a reviewed medical record: the insurer will check it against the documents it asks for (such as the doctor’s report and the test or scan results) and decides the claim after reviewing them.
> When you’re ready, here is the question I was on.
> What were your admission and discharge dates and times (Singapore time), and had any Accident Hospital Income already been paid for this accident?

**USER:** Admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026.

**APP:**

> Accident Hospital Income is S$100 for each complete 24-hour period of continuous inpatient confinement, up to 90 days per accident; your two nights alone do not establish the number of complete 24-hour periods.
> Had any Accident Hospital Income already been paid for this accident?

## Failed checks

- turn 4: after 'transverse' it asks for the detail the schedule uses (bone, or closed/open) (model reasoning-tool selection)
- turn 5: the closed-tibia illustration S$9,000 (6% x S$300,000 x 50%) is shown (calculation)
- turn 5: a saved lump_sum record of S$9,000 for the lower leg (calculation)
- turn 6: a saved hospital_cash record of S$100 (calculation)

## Reading of the result (from the saved traces)

The model took a different path from runs 1 and 2. The new lookup was not needed in this run: no reply stated percentages without the amount, and the model read the certificate itself (S$300,000, as of 1 July 2025, from turn 2). The replay of s47-live-2's recorded output shows the lookup completing turn 1.

**Turn 5: the earliest failure is the tool contract (quote matching).**
- The model called `calculate lump_sum` with `proportion.quote` set to "For a simple (closed) fracture 50% of the percentage shown is payable**.**"
- The page prints "… is payable**;** …", so the tool refused the call: "the quote is not on that page". The model did not retry.
- So no S$9,000 and no record. The visible answer still gives S$300,000, 6% and the 50% rule.

**Turn 6: the earliest failure is the model's tool input.**
- `rate_passage` paraphrased the clause, with the wrong page: "Accident Hospital Income is S$100 for each complete 24-hour period …" on page 1. The page-2 text reads "Accident Hospital Income: S$100 for each complete period of 24 hours …".
- The tool correctly refused it. The model then asked whether any hospital income had already been paid, instead of giving the S$100.

**Turns 3–4: question selection.**
- Turn 3 asked one compound question (admission and discharge times, and prior payment).
- Turn 4 ("Transverse fracture.") repeated that pending hospital question instead of asking which bone. It did not map "transverse" to any category, and did not record it as a correction.

**What held:**
- The certificate amount was right, attributed to its date and the right person and product.
- No "transverse" category was chosen.
- The hospital rule was stated, and two nights were never treated as two days.
- No false correction, and no rejection by the save-time gate.

**Smallest general fixes (proposed, not implemented in this round):**
- **(a)** Quote matching for `proportion`, `rate_passage` and `passage_limits` ignores differences only in trailing punctuation and whitespace. The words and figures must still match exactly.
- **(b)** When a quote is not found, the refusal names the stored line that prints the same figure (its page and verbatim text). The model can then correct it within its existing step budget, with no added call or retry loop.

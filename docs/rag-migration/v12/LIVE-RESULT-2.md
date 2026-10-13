# PR #47 actual-model reproduction: second run (s47-live-2) after the two fixes

- **Code tested:** `1fd025d`, the fixes plus the replay. Model: requested `openai:gpt-6-luna`; the provider reported `gpt-6-luna`.
- **Verdict** (pre-registered grader, unchanged): **FAIL**. 1 of 42 checks failed; the grader labels the earliest failing stage *model reasoning-tool selection*.
- **Cost:** US$0.012264, 37 calls, 0 refused and 0 failed. The run cap was US$0.03. Ledger remaining after the run: US$0.153776, with the US$0.15 reservation untouched.
- **Time:** 115.2 s for the conversation.

| turn | answer seen (s) | model time (s) | calls | cost (US$) |
|---|---|---|---|---|
| 1 | 25.0 | 24.1 | 8 | 0.002182 |
| 2 | 13.0 | 11.6 | 4 | 0.001796 |
| 3 | 23.1 | 21.9 | 7 | 0.002480 |
| 4 | 12.4 | 11.2 | 5 | 0.001411 |
| 5 | 22.5 | 21.1 | 7 | 0.002255 |
| 6 | 19.2 | 17.8 | 6 | 0.002140 |

## Visible transcript (exactly as shown)

**USER:** Desmond broke his leg.

**APP:**

> The fracture schedule lists 10% of the Sum Insured for a thigh-bone fracture, 6% for a lower-leg fracture, and 4% for a kneecap fracture; the fracture must be confirmed by X-ray, and a simple (closed) fracture pays 50% of the listed percentage while a compound (open) fracture pays the full percentage.
> You told me “Desmond broke his leg.”
> I haven't yet read Desmond's own sum insured, which the schedule's percentages apply to, so no amount can be shown yet.

**USER:** He fell down the stairs.

**APP:**

> Thanks, I’ve noted that Desmond fell down the stairs. Desmond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025. The fracture schedule lists 10% of the Sum Insured for a thigh-bone fracture, 6% for a lower-leg fracture, and 4% for a kneecap fracture; fracture benefits are payable only for a fracture confirmed by X-ray, with 50% of the listed percentage for a simple (closed) fracture and the full percentage for a compound (open) fracture.
> Which bone was fractured: the thigh bone (femur), lower leg (tibia or fibula), or kneecap (patella)?

**USER:** Yes, confirmed with an X-ray. He was also warded for two nights.

**APP:**

> Desmond’s Fracture benefits are payable only for a fracture confirmed by X-ray; the schedule lists 10% of the Sum Insured for a thigh-bone fracture, 6% for a lower-leg fracture, and 4% for a kneecap fracture, with 50% of the listed percentage for a simple (closed) fracture and the full percentage for a compound (open) fracture. Desmond’s GROUP PERSONAL ACCIDENT Sum Assured is listed as S$300,000 as of 1 July 2025. Desmond’s Accident Hospital Income is S$100 for each complete period of 24 hours of continuous inpatient confinement directly resulting from an Accident, up to 90 days per Accident; the two nights alone do not establish the complete 24-hour periods.
> Which bone was fractured: the thigh bone (femur), lower leg (tibia or fibula), or kneecap (patella)?

**USER:** Transverse fracture.

**APP:**

> I need one more detail first.
> Which bone was fractured: the thigh bone (femur), lower leg (tibia or fibula), or kneecap (patella)?

**USER:** The tibia. It was a closed fracture.

**APP:**

> You told me the tibia.
> You told me it was a closed fracture.
> Desmond’s certificate lists a Group Personal Accident sum assured of S$300,000 as of 1 July 2025.
> The policy lists 6% of the Sum Insured for a fracture of the lower leg (tibia or fibula), and says fracture benefits require X-ray confirmation; for a simple (closed) fracture, 50% of the listed percentage applies.
> If the insurer’s medical assessment confirms the reported tibia fracture meets the policy definition, the indicative illustration is S$9,000 for a simple (closed) fracture, and only for an injury the insurer accepts as caused by an accident (the policy says “Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means”).

**USER:** Admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026.

**APP:**

> You told me “Admitted at 9pm on 3 October 2026” and “discharged at 11am on 5 October 2026.”
> Desmond’s Accident Hospital Income is S$100 for each complete 24-hour period of continuous inpatient confinement directly resulting from an Accident, up to 90 days per Accident; based on the dates and times you gave, the indicative estimate is S$100, assuming at least 1 of the 90 days is still available this accident.
> Desmond’s fracture benefit remains subject to the policy’s X-ray confirmation condition and the insurer accepting the event as an Accident.

## Failed checks

- turn 1: the certificate's sum insured is read when it is available (not 'I haven't yet read the sum insured') (model reasoning-tool selection): retrieval/tool-selection failure: the certificate was available

## Reading of the result (from the saved traces)

- **Turn 5 is fixed.**
  - The model read the lower-leg row, then ran `calculate lump_sum` with the 50% share. Its first call was refused because it passed an invented value id; it then read the row with `select_table_value`.
  - The model answered the repair itself. The visible answer gives the certificate's S$300,000 (as of 1 July 2025, bound to GROUP PERSONAL ACCIDENT), the 6% row and the 50% rule.
  - It then states: "If … the indicative illustration is S$9,000 for a simple (closed) fracture …"
  - The `lump_sum` record is saved (9000, conditional_illustration). Citations cover the certificate, page 1 of the wording and page 2 of the wording. The save-time gate rejected nothing.
  - The grounded fallback was not needed in this run. The replay of s47-live-1 exercises it.
- **Turn 6:** an S$100 indicative estimate from the times, with its record saved. It never says S$200.
- **Remaining material defect (the one failed check): turn 1.**
  - The model listed Desmond's policies but read only the wording's percentages, not his certificate row. The grounded fallback then said "I haven't yet read Desmond's own sum insured …".
  - The certificate was available, so this is recorded as a **retrieval/tool-selection failure**, as pre-registered.
  - The turn also ends without a question. The amount appeared from turn 2 on.
- **Minor:** turn 4's reply is only "I need one more detail first." plus the bone question. That is correct, but thin.
- **Smallest general fix for turn 1** (proposed, not implemented): when a reply states a percentage of the Sum Insured and that person's certificate (listed by `policies_for`) prints a row under the wording's own product, the grounded fallback reads that row itself. This is a deterministic `select_table_value`, with no model call; it is bound and gated like any value. The fallback states the certificate amount instead of saying it was not read.

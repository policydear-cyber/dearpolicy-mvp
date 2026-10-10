# DearPolicy conversational RAG -- the ten required demonstrations

> **Integration transcript.** Regenerated on the round-3 integrated head 63a4d4b (agents G, P, H + integration follow-ups) with `npm run rag2:demo10 -- --out docs/rag-migration/checkpoint/DEMO10.md`; the transcript body is identical to agent P's r3-P regeneration. Demo 3 uses scenario S3one (admission and discharge given in one message; the original three-message S3 stays in rag2:adversarial-test). A SCRIPTED TEST MODEL plays the model, so this shows what DearPolicy's own code does with the model's tool calls: evidence, calculations, the save-time gate and the saved reply. It is not a real-model conversation. All data is synthetic. "Dropped by the composer" lines are the internal trace; the household sees only the REPLY lines.

SCRIPTED TEST MODEL through the real chat route (PGlite, DEARPOLICY_RAG_LOOP=1). Synthetic households: Tan (Brightwater KidSafe accident plan, Corallis MediGuard) and Nair (Veridian FamilyFirst hospital cash, Lumora SecureMed; shared login, two stepsons).

## 1. Factual answer: a cited figure from the right person's column  (scenario S1, household Tan)
Expected: states S$600 per fracture for Ethan; never S$1,000 (the Adult column); no question; conditional: payable if the fracture is confirmed by X-ray and certified (not an established entitlement)

### Turn 1
USER: What does Ethan's accident plan pay if he fractures a bone?
Tool calls:
  - resolve_person({"mention":"Ethan"}) -> ok {"status":"ok"}
  - policies_for({"topic":"accident","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {}
  - select_table_value({"benefit":"Fracture benefit","policy_id":"73000000-0000-4000-8000-000000000101","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"status":"ok","valueId":"v1","value":600,"column":"Child","row":"Fracture benefit (per fracture)"}
  - search_passages({"query":"fracture benefit conditions confirmed by X-ray","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"hits":3}
  - final_answer({"sentences":[{"text":"Ethan's KidSafe fracture benefit is S$600 per fracture, from the Child column.","value_ids":["v1"]}],"subject_id":"73000000-0000-4000-800…) -> ok
Evidence selected:
  - [e4] KidSafe Family Accident Plan p2 | for Ethan Tan Jun Kai | "Fracture benefit is payable once per fracture confirmed by X-ray and certified by a registered medical practitioner."
  - [e3] KidSafe Family Accident Plan p1 | row "Fracture benefit (per fracture)" | column "Child" | for Ethan Tan Jun Kai | "Fracture benefit (per fracture) S$1,000 S$600"
Calculation (verified record saved):
  (none saved)
REPLY (as saved):
  > Ethan's KidSafe fracture benefit is S$600 per fracture, from the Child column, payable if the fracture is confirmed by X-ray and certified by a registered medical practitioner.

## 2. Broken arm: asks how it happened where the wording depends on it; nothing inferred  (scenario S2, household Tan)
Expected: turn 1: exactly one question, about how it happened (accident vs illness); no money figure; turn 2: S$600 per fracture; the X-ray/doctor requirement; never 'confirmed'/'approved' as if reviewed

### Turn 1
USER: Ethan broke his arm yesterday.
Tool calls:
  - resolve_person({"mention":"Ethan"}) -> ok {"status":"ok"}
  - note_facts({"facts":[{"key":"injury","value":"broken arm","words":"broke his arm"},{"key":"cause","value":"accident","words":"broke his arm"}],"subject_id":"73000000-0000-…) -> ok
  - policies_for({"topic":"accident","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {}
  - search_passages({"query":"accident sickness disease not covered fracture","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"hits":8}
  - ask_user({"kind":"fact","fact_key":"how_it_happened","question":"How did Ethan break his arm — was it an accident such as a fall, or did it come from an illness or bone …) -> ok
Evidence selected:
  - [e3] KidSafe Family Accident Plan p2 | for Ethan Tan Jun Kai | "Section 3 - What is covered This policy covers Bodily Injury caused solely and directly by an Accident. Sickness, disease or any gradual or degenerative condition is not covered, even if it results in…"
Calculation (verified record saved):
  (none saved)
REPLY (as saved):
  > How did Ethan break his arm — was it an accident such as a fall, or did it come from an illness or bone condition?
  > [question] How did Ethan break his arm — was it an accident such as a fall, or did it come from an illness or bone condition?

### Turn 2
USER: He fell off the monkey bars at school.
Tool calls:
  - note_facts({"facts":[{"key":"how_it_happened","value":"fell off the monkey bars at school","words":"He fell off the monkey bars at school"}],"subject_id":"73000000-0000-40…) -> ok
  - select_table_value({"benefit":"Fracture benefit","policy_id":"73000000-0000-4000-8000-000000000101","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"status":"ok","valueId":"v1","value":600,"column":"Child","row":"Fracture benefit (per fracture)"}
  - search_passages({"query":"fracture confirmed by X-ray certified","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"hits":3}
  - final_answer({"sentences":[{"text":"Ethan's KidSafe fracture benefit is S$600 per fracture.","value_ids":["v1"]},{"text":"Ethan's fracture is medically confirmed, so the fra…) -> ok
Evidence selected:
  - [e5] KidSafe Family Accident Plan p2 | for Ethan Tan Jun Kai | "Fracture benefit is payable once per fracture confirmed by X-ray and certified by a registered medical practitioner."
  - [e11] KidSafe Family Accident Plan p1 | row "Fracture benefit (per fracture)" | column "Child" | for Ethan Tan Jun Kai | "Fracture benefit (per fracture) S$1,000 S$600"
Calculation (verified record saved):
  (none saved)
Dropped by the composer:
  - "Ethan's fracture is medically confirmed, so the fracture benefit is approved." -- states a claim decision (approved / confirmed / fully covered) only the insurer can make
  - "The fracture has to be confirmed by X-ray and certified by a registered medical practitioner." -- repeats the condition stated with the benefit
REPLY (as saved):
  > Ethan's KidSafe fracture benefit is S$600 per fracture, payable if the fracture is confirmed by X-ray and certified by a registered medical practitioner.
  > Only the insurer makes a decision on the claim, after reviewing it and its evidence.

## 3. Hospital stay under the policy's own day-count rule (each complete 24 hours); admission and discharge given in one message  (scenario S3one, household Tan)
Expected: turn 1: one question asking for the admission and discharge dates and times; no money; turn 2: no question (both were given); S$90 per complete 24 hours cited; 'Indicative estimate' S$180; never S$270; no 'payout'
Expected calculation: payable periods = floor((5 Oct 09:00 - 2 Oct 21:30) / 24 h) = floor(59.5/24) = 2; 2 x S$90 = S$180.00; label indicative estimate

### Turn 1
USER: Ethan was kept in hospital after his fall. How much hospital income can we claim?
Tool calls:
  - resolve_person({"mention":"Ethan"}) -> ok {"status":"ok"}
  - note_facts({"facts":[{"key":"how_it_happened","value":"fall","words":"after his fall"},{"key":"hospitalised","value":"yes","words":"kept in hospital"}],"subject_id":"73000…) -> ok
  - select_table_value({"benefit":"Hospital income","policy_id":"73000000-0000-4000-8000-000000000101","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"status":"ok","valueId":"v1","value":90,"column":"Child","row":"Hospital income (each complete 24 hours, max 60)"}
  - search_passages({"query":"hospital income complete period of 24 hours confined","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"hits":3}
  - ask_user({"kind":"fact","fact_key":"admission_datetime","question":"On what dates and at what times was Ethan admitted and discharged?","subject_id":"73000000-0000-4000-…) -> ok
Evidence selected:
  - [e3] KidSafe Family Accident Plan p2 | for Ethan Tan Jun Kai | "Hospital income is payable for each complete period of 24 hours that the Insured Person is confined in hospital as an inpatient. Any period shorter than 24 hours is not counted. Admission and discharg…"
Calculation (verified record saved):
  (none saved)
REPLY (as saved):
  > On what dates and at what times was Ethan admitted and discharged?
  > [question] On what dates and at what times was Ethan admitted and discharged?

### Turn 2
USER: He was admitted on 2 October at about 9.30pm and discharged on 5 October at 9am, so 3 nights.
Tool calls:
  - note_facts({"facts":[{"key":"admitted_at","value":"2 October 9.30pm","words":"admitted on 2 October at about 9.30pm"},{"key":"discharged_at","value":"5 October 9am","words…) -> ok
  - select_table_value({"benefit":"Hospital income","policy_id":"73000000-0000-4000-8000-000000000101","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"status":"ok","valueId":"v2","value":90,"column":"Child","row":"Hospital income (each complete 24 hours, max 60)"}
  - ask_user({"kind":"fact","fact_key":"discharged_at","question":"On what date and at what time was Ethan discharged?","subject_id":"73000000-0000-4000-8000-000000000003","…) -> REFUSED: discharged_at is already recorded (5 October 9am, "discharged on 5 October at 9am"); do not ask again
  - calculate({"benefit":"Hospital income","purpose":"claim","admission":{"at":"2026-10-02T21:30+08:00","words":"admitted on 2 October at about 9.30pm"},"discharge":{"at":"20…) -> ok {"amount":180,"kind":"indicative_estimate"}
  - final_answer({"sentences":[{"text":"Ethan's KidSafe hospital income is S$90 for each complete 24 hours in hospital.","value_ids":["v2"]},{"text":"Indicative estimate: KidSaf…) -> ok
Evidence selected:
  - [e2] KidSafe Family Accident Plan p1 | row "Hospital income (each complete 24 hours, max 60)" | column "Child" | for Ethan Tan Jun Kai | "Hospital income (each complete 24 hours, max 60) S$150 S$90"
  - [e6] KidSafe Family Accident Plan p1 | for Ethan Tan Jun Kai | "Hospital income (each complete 24 hours, max 60) S$150 S$90"
Calculation (verified record saved):
  - hospital_cash: result SGD 180 (rounding half_up/2)
      operand: Hospital income (each complete 24 hours, max 60) = 90 SGD [document: p1 Child]
      operand: admission = 2026-10-02T21:30+08:00  [household: "admitted on 2 October at about 9.30pm"]
      operand: discharge = 2026-10-05T09:00+08:00  [household: "discharged on 5 October at 9am"]
      step: {"id":"s_days","op":"day_count","out":2,"rule":"completed_24h","inputs":["admission","discharge"]}
      step: {"id":"s_amount","op":"multiply","out":18000,"inputs":["rate","s_days"]}
Dropped by the composer:
  - "Indicative estimate: KidSafe hospital income of S$90 for 3 nights comes to S$270." -- does not state the calculation’s result
REPLY (as saved):
  > Ethan's KidSafe hospital income is S$90 for each complete 24 hours in hospital.
  > Indicative estimate: KidSafe hospital income of S$90 for 2 complete periods of 24 hours comes to S$180.
  (notice) Indicative estimates are worked out from your documents and what you have told me; they are not a payout, and the insurer decides what it pays.

## 4. Side question about the speaker during a child's claim  (scenario S4, household Tan)
Expected: turn 2: S$2,500 per policy year for Marcus; turn 2 then re-asks Ethan's bill question (one question); no Ethan figures attributed to Marcus
Expected calculation: none; state: claim subject stays Ethan, Ethan's facts (injury, cause) preserved, pending bill_amount

### Turn 1
USER: Ethan broke his arm falling off his bike.
Tool calls:
  - resolve_person({"mention":"Ethan"}) -> ok {"status":"ok"}
  - note_facts({"facts":[{"key":"injury","value":"broken arm","words":"broke his arm"},{"key":"how_it_happened","value":"falling off his bike","words":"falling off his bike"}]…) -> ok
  - select_table_value({"benefit":"Accident medical reimbursement","policy_id":"73000000-0000-4000-8000-000000000101","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"status":"ok","valueId":"v1","value":1200,"column":"Child","row":"Accident medical reimbursement (per accident)"}
  - ask_user({"kind":"fact","fact_key":"bill_amount","question":"How much was Ethan's medical bill for the arm?","subject_id":"73000000-0000-4000-8000-000000000003","because…) -> ok
Evidence selected:
  - [e2] KidSafe Family Accident Plan p1 | row "Accident medical reimbursement (per accident)" | column "Child" | for Ethan Tan Jun Kai | "Accident medical reimbursement (per accident) S$2,000 S$1,200"
Calculation (verified record saved):
  (none saved)
REPLY (as saved):
  > How much was Ethan's medical bill for the arm?
  > [question] How much was Ethan's medical bill for the arm?

### Turn 2
USER: Before that - what's my deductible? I'm on the private hospital plan.
Tool calls:
  - resolve_person({"mention":"me"}) -> ok {"status":"ok"}
  - note_facts({"facts":[{"key":"ward_type","value":"private","words":"I'm on the private hospital plan"}],"subject_id":"73000000-0000-4000-8000-000000000001"}) -> ok
  - select_table_value({"benefit":"Deductible","policy_id":"73000000-0000-4000-8000-000000000103","subject_id":"73000000-0000-4000-8000-000000000001"}) -> ok {"status":"ok","valueId":"v2","value":2500,"column":"Limit","row":"Deductible (per policy year, private hospital)"}
  - final_answer({"sentences":[{"text":"Marcus's MediGuard deductible is S$2,500 per policy year.","value_ids":["v2"],"subject_id":"73000000-0000-4000-8000-000000000001"}],"subj…) -> ok
Evidence selected:
  - [e3] MediGuard Integrated Shield Plan p1 | row "Deductible (per policy year, private hospital)" | column "Limit" | for Marcus Tan Wei Ming | "Deductible (per policy year, private hospital) S$2,500"
Calculation (verified record saved):
  (none saved)
REPLY (as saved):
  > Marcus's MediGuard deductible is S$2,500 per policy year.
  > When you’re ready, here is the question I was on.
  > [question] How much was Ethan's medical bill for the arm?

## 5. Stepchild: 'my son' resolved without assuming eligibility  (scenario S5, household Nair)
Expected: turn 1: one question; candidates Rohan, Daniel, Lucas; Daniel and Lucas labelled stepson; no cover statement, no figure; turn 2: Lucas not covered because not named; no S$120 for Lucas

### Turn 1
USER: My son was admitted to hospital last night.
Tool calls:
  - resolve_person({"mention":"my son"}) -> ok {"status":"ambiguous"}
  - ask_user({"kind":"person","mention":"my son","options":["73000000-0000-4000-8000-000000000013","73000000-0000-4000-8000-000000000014","73000000-0000-4000-8000-0000000000…) -> ok
Evidence selected:
  (none)
Calculation (verified record saved):
  (none saved)
REPLY (as saved):
  > Which son do you mean — Rohan Nair (your son), Daniel Reyes Fernandez (Daniel, your stepson) or Lucas Reyes Fernandez (Lucas, your stepson)?
  > [question] Which son do you mean — Rohan Nair (your son), Daniel Reyes Fernandez (Daniel, your stepson) or Lucas Reyes Fernandez (Lucas, your stepson)?

### Turn 2
USER: Lucas
Tool calls:
  - resolve_person({"mention":"Lucas"}) -> ok {"status":"ok"}
  - policies_for({"topic":"hospital","subject_id":"73000000-0000-4000-8000-000000000015"}) -> ok {}
  - search_passages({"query":"step-child not named not covered"}) -> ok {"hits":4}
  - final_answer({"sentences":[{"text":"Lucas is not named as an Insured Child on the FamilyFirst certificate, and a step-child who is not named is not covered.","evidence_ids":…) -> ok
Evidence selected:
  - [e1] FamilyFirst Hospital Cash Plan p2 | for - | "Definitions and conditions Child means a natural, adopted or step-child of the Policy Owner who is named as an Insured Child in this Certificate. A step-child who is not named in this Certificate is n…"
Calculation (verified record saved):
  (none saved)
REPLY (as saved):
  > Lucas is not named as an Insured Child on the FamilyFirst certificate, and a step-child who is not named is not covered.

## 6. Corrected discharge date invalidates and recomputes the estimate (first-full-day rule)  (scenario S6b, household Nair)
Expected: turn 1: S$120 per day; 'Indicative estimate' S$240; turn 2: says the earlier estimate no longer applies; S$480; never S$240 again; never S$600 (5 nights)
Expected calculation: turn 1: admitted 3 Oct 21:40 (after noon: not a full day), discharge 6 Oct not counted -> 4, 5 Oct = 2 days x S$120 = S$240.00; turn 2: 4, 5, 6, 7 Oct = 4 days x S$120 = S$480.00

### Turn 1
USER: Rohan was admitted on 3 October at 9.40pm and discharged on 6 October at 10.15am. How much hospital cash do we get?
Tool calls:
  - resolve_person({"mention":"Rohan"}) -> ok {"status":"ok"}
  - note_facts({"facts":[{"key":"admitted_at","value":"3 October 9.40pm","words":"admitted on 3 October at 9.40pm"},{"key":"discharged_at","value":"6 October 10.15am","words":…) -> ok
  - select_table_value({"benefit":"Daily hospital cash","policy_id":"73000000-0000-4000-8000-000000000111","subject_id":"73000000-0000-4000-8000-000000000013"}) -> ok {"status":"ok","valueId":"v1","value":120,"column":"Insured Child","row":"Daily hospital cash (max 90 days per year)"}
  - calculate({"benefit":"Daily hospital cash","purpose":"claim","admission":{"at":"2026-10-03T21:40+08:00","words":"admitted on 3 October at 9.40pm"},"discharge":{"at":"2026…) -> ok {"amount":240,"kind":"indicative_estimate"}
  - final_answer({"sentences":[{"text":"Rohan's FamilyFirst daily hospital cash is S$120 per day.","value_ids":["v1"]},{"text":"Indicative estimate: FamilyFirst daily hospital c…) -> ok
Evidence selected:
  - [e2] FamilyFirst Hospital Cash Plan p1 | row "Daily hospital cash (max 90 days per year)" | column "Insured Child" | for Rohan Nair | "Daily hospital cash (max 90 days per year) S$200 per day S$120 per day"
  - [e3] FamilyFirst Hospital Cash Plan p2 | for Rohan Nair | "Daily hospital cash is payable for each day of inpatient confinement starting from the first full day of admission."
  - [e4] FamilyFirst Hospital Cash Plan p2 | for Rohan Nair | "The day of admission counts as a full day only if admission is before 12:00 noon."
  - [e5] FamilyFirst Hospital Cash Plan p1 | for Rohan Nair | "Daily hospital cash (max 90 days per year) S$200 per day S$120 per day"
Calculation (verified record saved):
  - hospital_cash: result SGD 240 (rounding half_up/2)
      operand: Daily hospital cash (max 90 days per year) = 120 SGD [document: p1 Insured Child]
      operand: admission = 2026-10-03T21:40+08:00  [household: "admitted on 3 October at 9.40pm"]
      operand: discharge = 2026-10-06T10:15+08:00  [household: "discharged on 6 October at 10.15am"]
      operand: Daily hospital cash maximum days = 90  [document: p1 ]
      step: {"id":"s_days","op":"day_count","out":2,"rule":"first_full_day","edges":[{"edge":"admission","when":"before","minutes":720}],"inputs":["admission","discharge"]}
      step: {"id":"s_capped","op":"min_count","out":2,"inputs":["s_days","day_cap"]}
      step: {"id":"s_amount","op":"multiply","out":24000,"inputs":["rate","s_capped"]}
REPLY (as saved):
  > Rohan's FamilyFirst daily hospital cash is S$120 per day.
  > Indicative estimate: FamilyFirst daily hospital cash of S$120 per day for 2 payable days comes to S$240.
  (notice) Indicative estimates are worked out from your documents and what you have told me; they are not a payout, and the insurer decides what it pays.

### Turn 2
USER: Correction: he was discharged on 8 October at 11am, not the 6th.
Tool calls:
  - note_facts({"facts":[{"key":"discharged_at","value":"8 October 11am","words":"discharged on 8 October at 11am"}],"subject_id":"73000000-0000-4000-8000-000000000013"}) -> ok
  - select_table_value({"benefit":"Daily hospital cash","policy_id":"73000000-0000-4000-8000-000000000111","subject_id":"73000000-0000-4000-8000-000000000013"}) -> ok {"status":"ok","valueId":"v2","value":120,"column":"Insured Child","row":"Daily hospital cash (max 90 days per year)"}
  - calculate({"benefit":"Daily hospital cash","purpose":"claim","admission":{"at":"2026-10-03T21:40+08:00","words":"admitted on 3 October at 9.40pm"},"discharge":{"at":"2026…) -> ok {"amount":480,"kind":"indicative_estimate"}
  - final_answer({"sentences":[{"text":"Indicative estimate: FamilyFirst daily hospital cash of S$120 per day for 4 payable days comes to S$480.","result_id":"k9e9a84a1a0"}],"su…) -> ok
Evidence selected:
  - [e2] FamilyFirst Hospital Cash Plan p1 | row "Daily hospital cash (max 90 days per year)" | column "Insured Child" | for Rohan Nair | "Daily hospital cash (max 90 days per year) S$200 per day S$120 per day"
  - [e3] FamilyFirst Hospital Cash Plan p2 | for Rohan Nair | "Daily hospital cash is payable for each day of inpatient confinement starting from the first full day of admission."
  - [e4] FamilyFirst Hospital Cash Plan p2 | for Rohan Nair | "The day of admission counts as a full day only if admission is before 12:00 noon."
  - [e5] FamilyFirst Hospital Cash Plan p1 | for Rohan Nair | "Daily hospital cash (max 90 days per year) S$200 per day S$120 per day"
Calculation (verified record saved):
  - hospital_cash: result SGD 480 (rounding half_up/2)
      operand: Daily hospital cash (max 90 days per year) = 120 SGD [document: p1 Insured Child]
      operand: admission = 2026-10-03T21:40+08:00  [household: "admitted on 3 October at 9.40pm"]
      operand: discharge = 2026-10-08T11:00+08:00  [household: "discharged on 8 October at 11am"]
      operand: Daily hospital cash maximum days = 90  [document: p1 ]
      step: {"id":"s_days","op":"day_count","out":4,"rule":"first_full_day","edges":[{"edge":"admission","when":"before","minutes":720}],"inputs":["admission","discharge"]}
      step: {"id":"s_capped","op":"min_count","out":4,"inputs":["s_days","day_cap"]}
      step: {"id":"s_amount","op":"multiply","out":48000,"inputs":["rate","s_capped"]}
REPLY (as saved):
  > Updated: discharged at is now 8 October 11am (you said 6 October 10.15am at first). The earlier estimate worked out from it no longer applies.
  > Indicative estimate: FamilyFirst daily hospital cash of S$120 per day for 4 payable days comes to S$480.
  (notice) Indicative estimates are worked out from your documents and what you have told me; they are not a payout, and the insurer decides what it pays.

## 6. Corrected person (Ethan -> Chloe) invalidates the estimate  (scenario S6a, household Tan)
Expected: turn 2: says the earlier estimate (worked out for Ethan, S$900) no longer applies; turn 2 never repeats S$900; Chloe not insured on KidSafe (cited)

### Turn 1
USER: Ethan fractured his arm falling off his bike; the clinic bill came to S$1,000. What can we claim back for the bill?
Tool calls:
  - resolve_person({"mention":"Ethan"}) -> ok {"status":"ok"}
  - note_facts({"facts":[{"key":"how_it_happened","value":"falling off his bike","words":"falling off his bike"},{"key":"bill_amount","value":"1000","words":"the clinic bill c…) -> ok
  - select_table_value({"benefit":"Accident medical reimbursement","policy_id":"73000000-0000-4000-8000-000000000101","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"status":"ok","valueId":"v1","value":1200,"column":"Child","row":"Accident medical reimbursement (per accident)"}
  - select_table_value({"benefit":"Excess","policy_id":"73000000-0000-4000-8000-000000000101","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"status":"ok","valueId":"v2","value":100,"column":"Child","row":"Excess (per accident)"}
  - calculate({"bill":{"words":"the clinic bill came to S$1,000","amount":1000,"currency":"SGD"},"benefit":"Accident medical reimbursement","purpose":"claim","policy_id":"730…) -> ok {"amount":900,"kind":"indicative_estimate"}
  - final_answer({"sentences":[{"text":"Ethan's accident medical reimbursement limit is S$1,200 per accident, after an excess of S$100.","value_ids":["v1","v2"]},{"text":"Indica…) -> ok
Evidence selected:
  - [e2] KidSafe Family Accident Plan p1 | row "Accident medical reimbursement (per accident)" | column "Child" | for Ethan Tan Jun Kai | "Accident medical reimbursement (per accident) S$2,000 S$1,200"
  - [e3] KidSafe Family Accident Plan p1 | row "Excess (per accident)" | column "Child" | for Ethan Tan Jun Kai | "Excess (per accident) S$100 S$100"
  - [e4] KidSafe Family Accident Plan p2 | for Ethan Tan Jun Kai | "The Excess is then deducted from that amount, after the limit per accident has been applied."
Calculation (verified record saved):
  - bill_reimbursement: result SGD 900 (rounding half_up/2)
      operand: bill = 1000 SGD [household: "the clinic bill came to S$1,000"]
      operand: Accident medical reimbursement (per accident) = 1200 SGD [document: p1 Child]
      operand: Excess (per accident) = 100 SGD [document: p1 Child]
      step: {"id":"s_lim","op":"min","out":100000,"inputs":["bill","lim1"]}
      step: {"id":"s_ded","op":"deductible","out":90000,"inputs":["s_lim","deductible"]}
REPLY (as saved):
  > Ethan's accident medical reimbursement limit is S$1,200 per accident, after an excess of S$100.
  > Indicative estimate: the smaller of the bill you told me about (S$1,000) and the S$1,200 limit, less the S$100 excess, comes to S$900.
  (notice) Indicative estimates are worked out from your documents and what you have told me; they are not a payout, and the insurer decides what it pays.

### Turn 2
USER: Sorry, I mixed them up - it was Chloe, not Ethan.
Tool calls:
  - resolve_person({"mention":"Chloe"}) -> ok {"status":"ok"}
  - note_facts({"facts":[{"key":"how_it_happened","value":"falling off his bike","words":"falling off his bike"},{"key":"bill_amount","value":"1000","words":"the clinic bill c…) -> ok
  - policies_for({"topic":"accident","subject_id":"73000000-0000-4000-8000-000000000004"}) -> ok {}
  - search_passages({"query":"Insured persons Name Category Date of birth","policy_ids":["73000000-0000-4000-8000-000000000101"]}) -> ok {"hits":2}
  - final_answer({"sentences":[{"text":"Chloe is not listed among the insured persons on the KidSafe Family Accident Plan.","evidence_ids":["e5"]}],"subject_id":"73000000-0000-4…) -> ok
Evidence selected:
  - [e5] KidSafe Family Accident Plan p1 | for - | "Insured persons Name Category Date of birth Marcus Tan Wei Ming Adult 19 Jul 1982 Joanne Lee Hui Min Adult 03 Feb 1984 Ethan Tan Jun Kai Child 12 Sep 2015"
Calculation (verified record saved):
  (none saved)
REPLY (as saved):
  > Updated: this is about Chloe, not Ethan. The earlier estimate I worked out for Ethan from the bill amount no longer applies, because it was worked out for Ethan's policy, not Chloe's.
  > Chloe is not listed among the insured persons on the KidSafe Family Accident Plan.

## 7. A cap + excess calculation survives the save-time verification  (scenario S7b, household Tan)
Expected: 'Indicative estimate' ... S$900; limit S$1,200 and excess S$100 cited; estimate notice; no 'payout'
Expected calculation: min(S$1,000 [household], S$1,200) - S$100 = S$900.00 = min(S$1,000 - S$100, S$1,200): either order gives S$900; a CalculationRecord the gate re-runs

### Turn 1
USER: Ethan fractured his arm falling off his bike; the clinic bill came to S$1,000. What can we claim back for the bill?
Tool calls:
  - resolve_person({"mention":"Ethan"}) -> ok {"status":"ok"}
  - note_facts({"facts":[{"key":"how_it_happened","value":"falling off his bike","words":"falling off his bike"},{"key":"bill_amount","value":"1000","words":"the clinic bill c…) -> ok
  - select_table_value({"benefit":"Accident medical reimbursement","policy_id":"73000000-0000-4000-8000-000000000101","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"status":"ok","valueId":"v1","value":1200,"column":"Child","row":"Accident medical reimbursement (per accident)"}
  - select_table_value({"benefit":"Excess","policy_id":"73000000-0000-4000-8000-000000000101","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"status":"ok","valueId":"v2","value":100,"column":"Child","row":"Excess (per accident)"}
  - calculate({"bill":{"words":"the clinic bill came to S$1,000","amount":1000,"currency":"SGD"},"benefit":"Accident medical reimbursement","purpose":"claim","policy_id":"730…) -> ok {"amount":900,"kind":"indicative_estimate"}
  - final_answer({"sentences":[{"text":"Ethan's accident medical reimbursement limit is S$1,200 per accident, after an excess of S$100.","value_ids":["v1","v2"]},{"text":"Indica…) -> ok
Evidence selected:
  - [e2] KidSafe Family Accident Plan p1 | row "Accident medical reimbursement (per accident)" | column "Child" | for Ethan Tan Jun Kai | "Accident medical reimbursement (per accident) S$2,000 S$1,200"
  - [e3] KidSafe Family Accident Plan p1 | row "Excess (per accident)" | column "Child" | for Ethan Tan Jun Kai | "Excess (per accident) S$100 S$100"
  - [e4] KidSafe Family Accident Plan p2 | for Ethan Tan Jun Kai | "The Excess is then deducted from that amount, after the limit per accident has been applied."
Calculation (verified record saved):
  - bill_reimbursement: result SGD 900 (rounding half_up/2)
      operand: bill = 1000 SGD [household: "the clinic bill came to S$1,000"]
      operand: Accident medical reimbursement (per accident) = 1200 SGD [document: p1 Child]
      operand: Excess (per accident) = 100 SGD [document: p1 Child]
      step: {"id":"s_lim","op":"min","out":100000,"inputs":["bill","lim1"]}
      step: {"id":"s_ded","op":"deductible","out":90000,"inputs":["s_lim","deductible"]}
REPLY (as saved):
  > Ethan's accident medical reimbursement limit is S$1,200 per accident, after an excess of S$100.
  > Indicative estimate: the smaller of the bill you told me about (S$1,000) and the S$1,200 limit, less the S$100 excess, comes to S$900.
  (notice) Indicative estimates are worked out from your documents and what you have told me; they are not a payout, and the insurer decides what it pays.

## 8. Missing conditions: useful partial answer, no estimate  (scenario S8, household Nair)
Expected: S$120 per day (Insured Child) cited; names the missing admission/discharge dates and time; no S$360 or other amount

### Turn 1
USER: Rohan was in hospital with dengue. How much will FamilyFirst pay?
Tool calls:
  - resolve_person({"mention":"Rohan"}) -> ok {"status":"ok"}
  - note_facts({"facts":[{"key":"how_it_happened","value":"dengue","words":"in hospital with dengue"}],"subject_id":"73000000-0000-4000-8000-000000000013"}) -> ok
  - select_table_value({"benefit":"Daily hospital cash","policy_id":"73000000-0000-4000-8000-000000000111","subject_id":"73000000-0000-4000-8000-000000000013"}) -> ok {"status":"ok","valueId":"v1","value":120,"column":"Insured Child","row":"Daily hospital cash (max 90 days per year)"}
  - search_passages({"query":"first full day of admission day of discharge not counted","subject_id":"73000000-0000-4000-8000-000000000013"}) -> ok {"hits":4}
  - compute({"label":"guess","operands":[{"value_id":"v1"},{"household":{"count":3,"label":"days","attribution":"about 3 nights I think"}}],"operation":"per_day"}) -> REFUSED: the household figure 3 (days) is not a recorded fact: record what the household said with note_facts first
  - calculate({"benefit":"Daily hospital cash","purpose":"claim","policy_id":"73000000-0000-4000-8000-000000000111","calculator":"hospital_cash","subject_id":"73000000-0000-4…) -> ok {"amount":null,"kind":"unresolved"}
  - final_answer({"sentences":[{"text":"Rohan's FamilyFirst daily hospital cash is S$120 per day.","value_ids":["v1"]},{"text":"To work out the days payable I need Rohan's admis…) -> ok
Evidence selected:
  - [e2] FamilyFirst Hospital Cash Plan p1 | row "Daily hospital cash (max 90 days per year)" | column "Insured Child" | for Rohan Nair | "Daily hospital cash (max 90 days per year) S$200 per day S$120 per day"
  - [e7] FamilyFirst Hospital Cash Plan p2 | for Rohan Nair | "Daily hospital cash is payable for each day of inpatient confinement starting from the first full day of admission."
  - [e8] FamilyFirst Hospital Cash Plan p2 | for Rohan Nair | "The day of admission counts as a full day only if admission is before 12:00 noon."
  - [e9] FamilyFirst Hospital Cash Plan p1 | for Rohan Nair | "Daily hospital cash (max 90 days per year) S$200 per day S$120 per day"
Calculation (verified record saved):
  (none saved)
Dropped by the composer:
  - "Indicative estimate: FamilyFirst daily hospital cash of S$120 per day for 3 days comes to S$360." -- S$360 is not a printed figure of this benefit (no estimate is possible yet: Rohan Nair’s admission and discharge dates and times (with the hospital’s time zone))
  - "To work out the days payable I need Rohan's admission date and time and his discharge date." -- repeats the missing-information requirement
REPLY (as saved):
  > Rohan's FamilyFirst daily hospital cash is S$120 per day.
  > To work out Rohan Nair’s daily hospital cash under FamilyFirst Hospital Cash Plan, I still need the admission and discharge dates and times (with the hospital’s time zone).

## 9. Another household's evidence is inaccessible  (scenario S9, household Tan)
Expected: no S$120, no FamilyFirst cover statement, no Rohan as a person of this household

### Turn 1
USER: What does Rohan get from FamilyFirst hospital cash?
Tool calls:
  - resolve_person({"mention":"Rohan"}) -> ok {"status":"unknown"}
  - select_table_value({"benefit":"Daily hospital cash","policy_id":"73000000-0000-4000-8000-000000000111","subject_id":"73000000-0000-4000-8000-000000000013"}) -> ok {"status":"missing"}
  - read_page({"page":1,"policy_id":"73000000-0000-4000-8000-000000000111"}) -> REFUSED: that document is not one of this household's readable documents
  - search_passages({"query":"daily hospital cash insured child","policy_ids":["73000000-0000-4000-8000-000000000111"]}) -> ok {"hits":0}
  - policies_for({"subject_id":"73000000-0000-4000-8000-000000000013"}) -> ok {}
  - note_facts({"facts":[{"key":"hospitalised","value":"yes","words":"Rohan"}],"subject_id":"73000000-0000-4000-8000-000000000013"}) -> REFUSED: subject_id must be a household member (resolve the person first)
  - ask_user({"kind":"person","options":["73000000-0000-4000-8000-000000000013","73000000-0000-4000-8000-000000000014"],"question":"Do you mean Rohan or Daniel?"}) -> REFUSED: a person question offers two or more household members (the candidates resolve_person returned)
  - final_answer({"sentences":[{"text":"Rohan's FamilyFirst daily hospital cash is S$120 per day.","value_ids":["v1"],"evidence_ids":["e1"]},{"text":"Rohan is insured as an Insu…) -> ok
Evidence selected:
  (none)
Calculation (verified record saved):
  (none saved)
Dropped by the composer:
  - "Rohan's FamilyFirst daily hospital cash is S$120 per day." -- cites evidence no tool returned (e1)
  - "Rohan is insured as an Insured Child on FamilyFirst." -- states cover or a figure without citing evidence
REPLY (as saved):
  > I couldn’t identify “Rohan” among the family members linked to your account. Which family member do you mean? If they aren’t added yet, you can add them on the Household page.

## 10. Evidence of a document deleted mid-conversation cannot support the next answer  (scenario S10, household Tan)
Expected: turn 2: neither S$90 nor 'covered for fractures' is stated from the deleted/superseded document; ideally says the document is no longer available

### Turn 1
USER: What is Ethan's hospital income per day?
Tool calls:
  - select_table_value({"benefit":"Hospital income","policy_id":"73000000-0000-4000-8000-000000000101","subject_id":"73000000-0000-4000-8000-000000000003"}) -> ok {"status":"ok","valueId":"v1","value":90,"column":"Child","row":"Hospital income (each complete 24 hours, max 60)"}
  - final_answer({"sentences":[{"text":"Ethan's KidSafe hospital income is S$90 for each complete 24 hours.","value_ids":["v1"]}],"subject_id":"73000000-0000-4000-8000-000000000…) -> ok
Evidence selected:
  - [e2] KidSafe Family Accident Plan p1 | row "Hospital income (each complete 24 hours, max 60)" | column "Child" | for Ethan Tan Jun Kai | "Hospital income (each complete 24 hours, max 60) S$150 S$90"
Calculation (verified record saved):
  (none saved)
REPLY (as saved):
  > Ethan's KidSafe hospital income is S$90 for each complete 24 hours.
   (between turns: KidSafe Family Accident Plan was deleted -- lifecycle_state=soft_deleted)

### Turn 2
USER: And is he covered for fractures?
Tool calls:
  - final_answer({"sentences":[{"text":"Ethan's KidSafe hospital income is S$90 for each complete 24 hours.","benefit":"Hospital income (each complete 24 hours, max 60)","eviden…) -> ok
Evidence selected:
  (none)
Calculation (verified record saved):
  (none saved)
Dropped by the composer:
  - "Ethan's KidSafe hospital income is S$90 for each complete 24 hours." -- cites evidence from a document that is no longer available (e2)
  - "Ethan is covered for fractures under the KidSafe Family Accident Plan." -- cites evidence from a document that is no longer available (e2)
REPLY (as saved):
  > The KidSafe Family Accident Plan document an earlier answer relied on has since been deleted or replaced by a newer version, so I can no longer use what it said.

## 9 (tool level). Household Tan's tool context against household Nair
  - read_page({"policy_id":"73000000-0000-4000-8000-000000000111","page":1}) -> refused: that document is not one of this household's readable documents
  - select_table_value({"policy_id":"73000000-0000-4000-8000-000000000111","benefit":"Daily hospital cash","subject_id":"73000000-0000-4000-800…) -> {"status":"missing","reason":"that document is not one of this household's readable documents (deleted, not yet released, superseded or not read)"}
  - search_passages({"query":"daily hospital cash insured child","policy_ids":["73000000-0000-4000-8000-000000000111"]}) -> {"query":"daily hospital cash insured child","retrieval":"lexical","hits":[],"searchedPolicyIds":[]}
  - resolve_person({"mention":"Rohan"}) -> {"status":"unknown","reason":"nobody in the household is called “Rohan”","question":"I can't find “Rohan” in your household. Who do you mean?"}

# V1.1 evaluation (in-process API) — SYNTHETIC-DPTEST-v11after1

## Release gates

| Gate | Result | Violations |
|---|---|---|
| unsupported_amount | **FAIL** | 3 |
| unsupported_assertion | **FAIL** | 2 |
| cross_scope | PASS | 0 |
| deleted_superseded | PASS | 0 |
| blocked_gap | **FAIL** | 2 |
| positive_control | **FAIL** | 12 |
| internal_text | **FAIL** | 7 |
| fact_finding | PASS | 0 |

## Timing (ms)

| Group | n | p50 | p95 |
|---|---|---|---|
| factual | 13 | 39 | 167 |
| interview | 11 | 36 | 169 |
| all | 32 | 36 | 167 |

## Per question

| Q | Question | Result | Gates failed | ms |
|---|---|---|---|---|
| Q01 | What policies does Charmaine have? | pass |  | 167 |
| Q02 | What is Charmaine's hospital room and board benefit? | FAIL | positive_control | 92 |
| Q03 | Does Charmaine have a fracture benefit? | FAIL | positive_control | 30 |
| Q04 | What is the waiting period for critical illness on Charmaine's CritiCare plan? | FAIL | positive_control | 44 |
| Q05 | Does Charmaine's hospital plan cover dental treatment? | FAIL | positive_control | 50 |
| Q06 | If Charmaine had both a fracture and a permanent disablement from one accident, would both be paid? | FAIL | positive_control | 29 |
| Q07 | What does Charmaine's group life policy pay if she dies? | FAIL | internal_text, positive_control | 133 |
| Q08 | What is Charmaine covered for if she dies in an accident? | FAIL | internal_text | 131 |
| Q09 | What is Charmaine's maternity coverage? | FAIL | internal_text | 97 |
| Q10 | Does Charmaine have travel insurance? | FAIL | unsupported_assertion | 47 |
| Q11 | Charmaine broke her arm. | pass |  | 36 |
| Q12 | An accident. | pass |  | 30 |
| Q13 | claim interview (6 answers): When did it happen? → Was the fracture confirmed by a doctor or on an X-ray or scan? → What treatment was given? → Was surgery performed? → How much did the treatment cost? | pass |  | 401 |
| Q14 | (the final response once the interview has no question left) | pass |  | 88 |
| Q15 | Which of her policies could pay for the broken arm? | pass |  | 18 |
| Q16 | How much can she claim? | FAIL | internal_text, blocked_gap | 73 |
| Q17 | (reopen c-injury from history) | pass |  | 131 |
| Q18 | What does Marcus's travel policy cover overseas? | FAIL | positive_control | 39 |
| Q19 | What is the baggage delay benefit on Marcus's travel policy? | FAIL | positive_control | 23 |
| Q20 | How much hospital cash does Marcus get per day? | FAIL | unsupported_amount | 28 |
| Q21 | What is Marcus's death benefit on his TermGuard policy? | FAIL | unsupported_assertion, blocked_gap | 25 |
| Q22 | Is Marcus covered for dental treatment? | FAIL | internal_text | 44 |
| Q23 | What happens when Marcus's endowment plan matures? | FAIL | positive_control | 29 |
| Q24 | Does Marcus have a fracture benefit? | pass |  | 26 |
| Q25 | Does Marcus have car insurance? | FAIL | internal_text | 34 |
| Q26 | Does Marcus have a fracture benefit? | FAIL | internal_text | 43 |
| Q27 | What happens when Marcus's endowment plan matures? | pass |  | 8 |
| Q28 | Does Charmaine have a fracture benefit? | pass |  | 19 |

## Every gate violation

- **Q02** [positive_control] missing: S$800 per day from the 2025 edition
- **Q03** [positive_control] missing: states the policy's fracture-of-arm amount
- **Q04** [positive_control] missing: 90 days
- **Q05** [positive_control] missing: dental excluded unless caused by an accident
- **Q06** [positive_control] missing: only the higher amount is payable
- **Q07** [internal_text] model / reader status: "by a second read"
- **Q07** [positive_control] missing: S$150,000 death (any cause)
- **Q08** [internal_text] model / reader status: "by a second read"
- **Q09** [internal_text] rule/row/page counts: "13 of 23 pages"
- **Q10** [unsupported_assertion] "says it expired / gives its date" stated without citing travelExpired p1
- **Q16** [internal_text] rule/row/page counts: "13 of 23 pages"
- **Q16** [blocked_gap] the question itself treated as a benefit name: "didn’t find How much"
- **Q18** [positive_control] missing: overseas medical US$250,000
- **Q18** [positive_control] missing: evacuation USD 500,000
- **Q19** [positive_control] missing: S$200 for every 6 hours
- **Q19** [positive_control] missing: maximum S$1,000 (cap)
- **Q20** [unsupported_amount] "S$2,000" is not an amount this answer may state
- **Q20** [unsupported_amount] "US$500,000" is not an amount this answer may state
- **Q20** [unsupported_amount] "US$250,000" is not an amount this answer may state
- **Q21** [unsupported_assertion] chose 350,000 although the document also states 300,000
- **Q21** [blocked_gap] the answer does not explain what could not be verified
- **Q22** [internal_text] rule/row/page counts: "11 of 19 pages"
- **Q23** [positive_control] missing: S$50,000 guaranteed maturity benefit
- **Q23** [positive_control] missing: maturity date 2040-06-01
- **Q25** [internal_text] rule/row/page counts: "11 of 19 processed pages"
- **Q26** [internal_text] rule/row/page counts: "10 of 15 pages"

## Quality notes (not release gates)

- Q20 [expected_assertion_missing] missing: 150 per day, currency not stated

## Answers (visible text)

### Q01 — What policies does Charmaine have?

```
I found 6 personal policy contracts across 1 family profile. The table separates confirmed cover from records that still need review.
Schedules, amendments and supporting documents are grouped by insured person, insurer and policy number where available. An insured amount is a coverage amount, not a universal claim payout.
6 contracts show ownership but no recent payment or renewal evidence, so the active status is not recently verified. Ownership is unchanged.
Upload the latest premium receipt or renewal notice for Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-HospitalShield; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-CritiCare; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-DisabilityCare; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-AccidentGuard so current status can be verified separately from ownership.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-HospitalShield Verified personal cover Page 1
SYNTHETIC-DPTEST-v11after1-CritiCare Verified personal cover Page 1
SYNTHETIC-DPTEST-v11after1-DisabilityCare Verified personal cover Page 1
SYNTHETIC-DPTEST-v11after1-AccidentGuard Verified personal cover Page 1
SYNTHETIC-DPTEST-v11after1-AccidentGuard Verified personal cover Page 1
SYNTHETIC-DPTEST-v11after1-GroupTermLife Verified personal cover Page 1
SYNTHETIC-DPTEST-v11after1-JetSure Verified personal cover Page 1
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
SYNTHETIC-DPTEST-v11after1-HospitalShield  
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
SYNTHETIC-DPTEST-v11after1-CritiCare S$120,000 
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
SYNTHETIC-DPTEST-v11after1-DisabilityCare S$200,000 
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
SYNTHETIC-DPTEST-v11after1-AccidentGuard  
SYNTHETIC-DPTEST-v11after1-AccidentGuard S$100,000 
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
SYNTHETIC-DPTEST-v11after1-GroupTermLife  
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
SYNTHETIC-DPTEST-v11after1-JetSure  
```
Citations: hosp2025 (SYNTHETIC-DPTEST-v11after1-HospitalShield) p1; criticalIllness (SYNTHETIC-DPTEST-v11after1-CritiCare) p1; disability (SYNTHETIC-DPTEST-v11after1-DisabilityCare) p1; accidentEndorsement (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p1; groupLife (SYNTHETIC-DPTEST-v11after1-GroupTermLife) p1; travelExpired (SYNTHETIC-DPTEST-v11after1-JetSure) p1  ·  next question: none  ·  167 ms

### Q02 — What is Charmaine's hospital room and board benefit?

```
Here is what Charmaine Tan Hui Min’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025 and 1 Jan 2024, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-HospitalShield — Hospital cash: an amount that is only shown after claim evidence has been reviewed per day (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-JetSure — Overseas medical expenses: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2024; not confirmed current).
SYNTHETIC-DPTEST-v11after1-HospitalShield — Surgical fees: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-AccidentGuard Your policy document Page 2
SYNTHETIC-DPTEST-v11after1-HospitalShield Your policy document Page 2
SYNTHETIC-DPTEST-v11after1-JetSure Your policy document Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
S$2,000
Accident medical reimbursement
Accident medical reimbursement	Up to S$2,000 per accident
S$100.00
Hospital cash
Hospital cash	S$100 per day, maximum 30 days
S$100,000
Overseas medical expenses
Overseas medical expenses	S$100,000
S$25,000
Surgical fees
Surgical fees	Up to S$25,000 per surgery
```
Citations: accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2; hosp2025 (SYNTHETIC-DPTEST-v11after1-HospitalShield) p2; travelExpired (SYNTHETIC-DPTEST-v11after1-JetSure) p2; accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2; hosp2025 (SYNTHETIC-DPTEST-v11after1-HospitalShield) p2; travelExpired (SYNTHETIC-DPTEST-v11after1-JetSure) p2; hosp2025 (SYNTHETIC-DPTEST-v11after1-HospitalShield) p2  ·  next question: none  ·  92 ms

### Q03 — Does Charmaine have a fracture benefit?

```
Here is what Charmaine Tan Hui Min’s documents state about accident cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms. Fracture of arm: your documents state different figures, so DearPolicy has not picked one. Upload the latest schedule to settle it.
SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accidental death: 100% of the sum insured (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-GroupTermLife — Additional accidental death benefit: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2026).
SYNTHETIC-DPTEST-v11after1-AccidentGuard — Fracture of leg: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-AccidentGuard Your policy document Page 2
SYNTHETIC-DPTEST-v11after1-GroupTermLife Your policy document Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
S$2,000
Accident medical reimbursement
Accident medical reimbursement	Up to S$2,000 per accident
S$50,000
Additional accidental death benefit
Additional accidental death benefit	S$50,000
S$1,500
Fracture of leg
Fracture of leg	S$1,500
```
Citations: accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2; groupLife (SYNTHETIC-DPTEST-v11after1-GroupTermLife) p2; accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2; groupLife (SYNTHETIC-DPTEST-v11after1-GroupTermLife) p2; accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2  ·  next question: none  ·  30 ms

### Q04 — What is the waiting period for critical illness on Charmaine's CritiCare plan?

```
Here is what Charmaine Tan Hui Min’s documents state about critical illness cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Mar 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-CritiCare — Critical illness benefit: 100% of the sum insured (page 2, document dated 1 Mar 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-CritiCare — Early stage critical illness: 25% of the sum insured (page 2, document dated 1 Mar 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-CritiCare Your policy document Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: criticalIllness (SYNTHETIC-DPTEST-v11after1-CritiCare) p2  ·  next question: none  ·  44 ms

### Q05 — Does Charmaine's hospital plan cover dental treatment?

```
Here is what Charmaine Tan Hui Min’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025 and 1 Jan 2024, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-HospitalShield — Hospital cash: an amount that is only shown after claim evidence has been reviewed per day (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-JetSure — Overseas medical expenses: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2024; not confirmed current).
SYNTHETIC-DPTEST-v11after1-HospitalShield — Surgical fees: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-AccidentGuard Your policy document Page 2
SYNTHETIC-DPTEST-v11after1-HospitalShield Your policy document Page 2
SYNTHETIC-DPTEST-v11after1-JetSure Your policy document Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
S$2,000
Accident medical reimbursement
Accident medical reimbursement	Up to S$2,000 per accident
S$100.00
Hospital cash
Hospital cash	S$100 per day, maximum 30 days
S$100,000
Overseas medical expenses
Overseas medical expenses	S$100,000
S$25,000
Surgical fees
Surgical fees	Up to S$25,000 per surgery
```
Citations: accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2; hosp2025 (SYNTHETIC-DPTEST-v11after1-HospitalShield) p2; travelExpired (SYNTHETIC-DPTEST-v11after1-JetSure) p2; accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2; hosp2025 (SYNTHETIC-DPTEST-v11after1-HospitalShield) p2; travelExpired (SYNTHETIC-DPTEST-v11after1-JetSure) p2; hosp2025 (SYNTHETIC-DPTEST-v11after1-HospitalShield) p2  ·  next question: none  ·  50 ms

### Q06 — If Charmaine had both a fracture and a permanent disablement from one accident, would both be paid?

```
Here is what Charmaine Tan Hui Min’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025 and 1 Jan 2024, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-HospitalShield — Hospital cash: an amount that is only shown after claim evidence has been reviewed per day (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-JetSure — Overseas medical expenses: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2024; not confirmed current).
SYNTHETIC-DPTEST-v11after1-HospitalShield — Surgical fees: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-AccidentGuard Your policy document Page 2
SYNTHETIC-DPTEST-v11after1-HospitalShield Your policy document Page 2
SYNTHETIC-DPTEST-v11after1-JetSure Your policy document Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
S$2,000
Accident medical reimbursement
Accident medical reimbursement	Up to S$2,000 per accident
S$100.00
Hospital cash
Hospital cash	S$100 per day, maximum 30 days
S$100,000
Overseas medical expenses
Overseas medical expenses	S$100,000
S$25,000
Surgical fees
Surgical fees	Up to S$25,000 per surgery
```
Citations: accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2; hosp2025 (SYNTHETIC-DPTEST-v11after1-HospitalShield) p2; travelExpired (SYNTHETIC-DPTEST-v11after1-JetSure) p2; accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2; hosp2025 (SYNTHETIC-DPTEST-v11after1-HospitalShield) p2; travelExpired (SYNTHETIC-DPTEST-v11after1-JetSure) p2; hosp2025 (SYNTHETIC-DPTEST-v11after1-HospitalShield) p2  ·  next question: none  ·  29 ms

### Q07 — What does Charmaine's group life policy pay if she dies?

```
If that happened, these benefits could be relevant. This is a preliminary claim assessment: DearPolicy does not estimate what the insurer would pay until claim evidence has been reviewed. Each card says what is still needed.
This is a what-if. Nothing here has been recorded as a claim, and no facts from this question have been saved against anyone's profile.
The Coverage page shows where each of these came from in your documents, and whether it was verified.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-GroupTermLife — Death (any cause)
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accidental death
100% of an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-GroupTermLife — Additional accidental death benefit
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11after1-GroupTermLife Policy wording, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11after1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: groupLife (SYNTHETIC-DPTEST-v11after1-GroupTermLife) p2; accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2  ·  next question: none  ·  133 ms

### Q08 — What is Charmaine covered for if she dies in an accident?

```
If that happened, these benefits could be relevant. This is a preliminary claim assessment: DearPolicy does not estimate what the insurer would pay until claim evidence has been reviewed. Each card says what is still needed.
This is a what-if. Nothing here has been recorded as a claim, and no facts from this question have been saved against anyone's profile.
The Coverage page shows where each of these came from in your documents, and whether it was verified.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-GroupTermLife — Death (any cause)
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accidental death
100% of an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-GroupTermLife — Additional accidental death benefit
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11after1-GroupTermLife Policy wording, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11after1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: groupLife (SYNTHETIC-DPTEST-v11after1-GroupTermLife) p2; accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2  ·  next question: none  ·  131 ms

### Q09 — What is Charmaine's maternity coverage?

```
DearPolicy didn’t find maternity cover in the parts of Charmaine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
6 policy contracts still need wording, processing or further review. See the policy review list.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  97 ms

### Q10 — Does Charmaine have travel insurance?

```
Here is what Charmaine Tan Hui Min’s documents state about travel cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2024, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-JetSure — Trip cancellation: S$3,000 (page 2, document dated 1 Jan 2024; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-JetSure Your policy document Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
S$3,000
Trip cancellation
Trip cancellation	S$3,000
```
Citations: travelExpired (SYNTHETIC-DPTEST-v11after1-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11after1-JetSure) p2  ·  next question: none  ·  47 ms

### Q11 — Charmaine broke her arm.

```
I’m sorry Charmaine is dealing with this. A broken arm can involve several kinds of cover, so I need a few details before I check Charmaine’s policies.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Was this caused by an accident, or an illness?
Some of these benefits only pay for accidents, so this decides which ones apply.
An accident
An illness
Not sure
Charmaine Tan Hui Min
Injured: yes
Fracture: arm
Injuries: broke her arm
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Was this caused by an accident, or an illness? Some of these benefits only pay for accidents, so this decides which ones apply.
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: none  ·  next question: Was this caused by an accident, or an illness?  ·  36 ms

### Q12 — An accident.

```
I’m sorry Charmaine is dealing with this. A broken arm may relate to accident medical reimbursement, medical reimbursement, fracture or hospital cash benefits in Charmaine’s policies, depending on the answers. It is not the same as permanent loss of a limb, so I won’t count permanent-disability schedule amounts from the information available.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Where did the accident happen?
Some benefits apply only in certain places, and treatment overseas usually needs extra documents.
Singapore
Overseas
Not sure
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Fracture: arm
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Where did the accident happen? Some benefits apply only in certain places, and treatment overseas usually needs extra documents.
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: none  ·  next question: Where did the accident happen?  ·  30 ms

### Q13.1 — 

```
Thanks, noted.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
When did it happen?
It decides which policy version applies and whether waiting periods or cover dates are met.
Not sure
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Fracture: arm
Event Location: Singapore
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
When did it happen? It decides which policy version applies and whether waiting periods or cover dates are met.
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: none  ·  next question: When did it happen?  ·  18 ms

### Q13.2 — 

```
Thanks, noted.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Was the fracture confirmed by a doctor or on an X-ray or scan?
Fracture benefits usually need the break confirmed by a doctor or imaging.
Yes
No
Not sure
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Location: Singapore
Fracture: arm
Event Date: 2026-09-20
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Was the fracture confirmed by a doctor or on an X-ray or scan? Fracture benefits usually need the break confirmed by a doctor or imaging.
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: none  ·  next question: Was the fracture confirmed by a doctor or on an X-ray or scan?  ·  23 ms

### Q13.3 — 

```
Thanks, noted.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
What treatment was given?
Emergency, inpatient and outpatient treatment are paid under different benefits.
Emergency department
Admitted to hospital
Outpatient or clinic
Not sure
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Date: 2026-09-20
Event Location: Singapore
Fracture: arm
Fracture Confirmed: yes
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
What treatment was given? Emergency, inpatient and outpatient treatment are paid under different benefits.
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: none  ·  next question: What treatment was given?  ·  17 ms

### Q13.4 — 

```
Before I put figures on this, a few quick questions — 2 at most.
This may relate to accident medical reimbursement or fracture benefits, depending on the answers.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Was surgery performed?
Surgical benefits pay only when an operation took place.
Yes
No
Not sure
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Date: 2026-09-20
Event Location: Singapore
Fracture: arm
Fracture Confirmed: yes
Treatment Type: Emergency department
Hospitalised: no
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Has any other insurer or the employer already paid part of the bill? Reimbursement is coordinated so the same bill is not paid twice.
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: none  ·  next question: Was surgery performed?  ·  169 ms

### Q13.5 — 

```
Before I put figures on this, one question.
This may relate to accident medical reimbursement or fracture benefits, depending on the answers.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
How much did the treatment cost?
It is reimbursed up to the policy's limit.
Not sure
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Date: 2026-09-20
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Surgery: no
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Has any other insurer or the employer already paid part of the bill? Reimbursement is coordinated so the same bill is not paid twice.
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: none  ·  next question: How much did the treatment cost?  ·  86 ms

### Q13.6 — 

```
Thanks — that’s what I need for now. For the broken arm, Charmaine’s policies have possible benefits: SYNTHETIC-DPTEST-v11after1-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.
Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.
Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-AccidentGuard — Fracture of arm
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accident medical reimbursement
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11after1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Injured: yes
Surgery: no
Injuries: broke her arm
Event Date: 2026-09-20
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Out Of Pocket: not yet known
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2  ·  next question: none  ·  88 ms

### Q14 — (the final response once the interview has no question left)

```
Thanks — that’s what I need for now. For the broken arm, Charmaine’s policies have possible benefits: SYNTHETIC-DPTEST-v11after1-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.
Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.
Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-AccidentGuard — Fracture of arm
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after1-AccidentGuard — Accident medical reimbursement
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11after1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Injured: yes
Surgery: no
Injuries: broke her arm
Event Date: 2026-09-20
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Out Of Pocket: not yet known
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
```
Citations: accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2  ·  next question: none  ·  88 ms

### Q15 — Which of her policies could pay for the broken arm?

```
Here is the fracture cover in Charmaine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11after1-AccidentGuard — Fracture of arm (page 1)
SYNTHETIC-DPTEST-v11after1-AccidentGuard — Fracture of leg (page 2)
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-AccidentGuard Benefit schedule, read when the document was uploaded Page 1
SYNTHETIC-DPTEST-v11after1-AccidentGuard Benefit schedule, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Injured: yes
Surgery: no
Injuries: broke her arm
Event Date: 2026-09-20
Out Of Pocket: not yet known
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Has any other insurer or the employer already paid part of the bill? Reimbursement is coordinated so the same bill is not paid twice.
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
S$1,200
Fracture of arm
Fracture of arm S$1,200
S$1,500
Fracture of leg
Fracture of leg S$1,500
```
Citations: accidentEndorsement (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2; accidentEndorsement (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11after1-AccidentGuard) p2  ·  next question: Has any other insurer or the employer already paid part of the bill?  ·  18 ms

### Q16 — How much can she claim?

```
DearPolicy didn’t find How much can she claim in the parts of Charmaine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
6 policy contracts still need wording, processing or further review. See the policy review list.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Charmaine Tan Hui Min
Injured: yes
Surgery: no
Injuries: broke her arm
Event Date: 2026-09-20
Out Of Pocket: not yet known
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  73 ms

### Q17 — (reopen c-injury from history)

```
DearPolicy didn’t find How much can she claim in the parts of Charmaine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
6 policy contracts still need wording, processing or further review. See the policy review list.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Charmaine Tan Hui Min
Injured: yes
Surgery: no
Injuries: broke her arm
Event Date: 2026-09-20
Out Of Pocket: not yet known
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-JetSure
Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  131 ms

### Q18 — What does Marcus's travel policy cover overseas?

```
Here is what Marcus Lim Wei Jie’s documents state about travel cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-WanderSafe — Baggage delay (page 2, document dated 1 Jun 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-WanderSafe — Trip cancellation: S$5,000 (page 2, document dated 1 Jun 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-WanderSafe Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-FutureSaver
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M
S$5,000
Trip cancellation
Trip cancellation	S$5,000
```
Citations: travel (SYNTHETIC-DPTEST-v11after1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11after1-WanderSafe) p2  ·  next question: none  ·  39 ms

### Q19 — What is the baggage delay benefit on Marcus's travel policy?

```
Here is what Marcus Lim Wei Jie’s documents state about travel cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-WanderSafe — Baggage delay (page 2, document dated 1 Jun 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-WanderSafe — Trip cancellation: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jun 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-WanderSafe Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-FutureSaver
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M
S$5,000
Trip cancellation
Trip cancellation	S$5,000
```
Citations: travel (SYNTHETIC-DPTEST-v11after1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11after1-WanderSafe) p2  ·  next question: none  ·  23 ms

### Q20 — How much hospital cash does Marcus get per day?

```
Here is what Marcus Lim Wei Jie’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025 and 1 Jun 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-WanderSafe — Emergency medical evacuation: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jun 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-WanderSafe — Overseas medical expenses: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jun 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M Your policy document Page 2
SYNTHETIC-DPTEST-v11after1-WanderSafe Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-FutureSaver
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M
S$2,000
Accident medical reimbursement
Accident medical reimbursement	Up to S$2,000 per accident
US$500,000
Emergency medical evacuation
Emergency medical evacuation	USD 500,000
US$250,000
Overseas medical expenses
Overseas medical expenses	US$250,000
```
Citations: accidentMarcus (SYNTHETIC-DPTEST-v11after1-AccidentGuard-M) p2; travel (SYNTHETIC-DPTEST-v11after1-WanderSafe) p2; accidentMarcus (SYNTHETIC-DPTEST-v11after1-AccidentGuard-M) p2; travel (SYNTHETIC-DPTEST-v11after1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11after1-WanderSafe) p2  ·  next question: none  ·  28 ms

### Q21 — What is Marcus's death benefit on his TermGuard policy?

```
Here is what Marcus Lim Wei Jie’s documents state about death cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025 and 1 Jun 2020, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M — Accidental death: 100% of the sum insured (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-FutureSaver — Death benefit: 100% of the sum insured (page 2, document dated 1 Jun 2020; not confirmed current).
SYNTHETIC-DPTEST-v11after1-TermGuard — Death benefit: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M Your policy document Page 2
SYNTHETIC-DPTEST-v11after1-FutureSaver Your policy document Page 2
SYNTHETIC-DPTEST-v11after1-TermGuard Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-FutureSaver
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M
US$350,000
Death benefit
Death benefit	US$350,000
```
Citations: accidentMarcus (SYNTHETIC-DPTEST-v11after1-AccidentGuard-M) p2; endowment (SYNTHETIC-DPTEST-v11after1-FutureSaver) p2; termContradictory (SYNTHETIC-DPTEST-v11after1-TermGuard) p2; termContradictory (SYNTHETIC-DPTEST-v11after1-TermGuard) p2  ·  next question: none  ·  25 ms

### Q22 — Is Marcus covered for dental treatment?

```
DearPolicy didn’t find dental cover in the parts of your policies read so far (11 of 19 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
6 policy contracts still need wording, processing or further review. See the policy review list.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-FutureSaver
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M
Partial review: 11 of 19 processed pages across 6 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  44 ms

### Q23 — What happens when Marcus's endowment plan matures?

```
Here is what Marcus Lim Wei Jie’s documents state about maturity or surrender value. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2020, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-FutureSaver — Guaranteed maturity benefit (page 2, document dated 1 Jun 2020; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-FutureSaver Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-FutureSaver
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M
```
Citations: endowment (SYNTHETIC-DPTEST-v11after1-FutureSaver) p2  ·  next question: none  ·  29 ms

### Q24 — Does Marcus have a fracture benefit?

```
Here is what Marcus Lim Wei Jie’s documents state about accident cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M — Accidental death: 100% of the sum insured (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M — Fracture of arm: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M — Fracture of leg: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-FutureSaver
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M
S$2,000
Accident medical reimbursement
Accident medical reimbursement	Up to S$2,000 per accident
S$500.00
Fracture of arm
Fracture of arm	S$500
S$750.00
Fracture of leg
Fracture of leg	S$750
```
Citations: accidentMarcus (SYNTHETIC-DPTEST-v11after1-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11after1-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11after1-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11after1-AccidentGuard-M) p2  ·  next question: none  ·  26 ms

### Q25 — Does Marcus have car insurance?

```
You have no motor policy on file, so there is nothing in your documents to answer this from. The policies on file are: SYNTHETIC-DPTEST-v11after1-DailyCash, SYNTHETIC-DPTEST-v11after1-FutureSaver, SYNTHETIC-DPTEST-v11after1-TermGuard. If there is a motor policy, upload it and ask again.
6 policy contracts still need wording, processing or further review. See the policy review list.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-FutureSaver
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-AccidentGuard-M
Partial review: 11 of 19 processed pages across 6 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  34 ms

### Q27 — What happens when Marcus's endowment plan matures?

```
I couldn’t read your message just now: DearPolicy’s reading service is unavailable right now because of a problem on our side, not with your documents. Your message is saved.
Send the message again — a retry usually succeeds.
If it fails twice, split it into two shorter messages and DearPolicy will keep the facts from both.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  8 ms

### Q28 — Does Charmaine have a fracture benefit?

```
Here is what Charmaine Tan Hui Min’s documents state about accident cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11after1-OtherHouseholdPA — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11after1-OtherHouseholdPA — Fracture of arm: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11after1-OtherHouseholdPA Your policy document Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11after1-OtherHouseholdPA
S$9,000
Accident medical reimbursement
Accident medical reimbursement	Up to S$9,000 per accident
S$3,500
Fracture of arm
Fracture of arm	S$3,500
```
Citations: otherHouseholdAccident (SYNTHETIC-DPTEST-v11after1-OtherHouseholdPA) p2; otherHouseholdAccident (SYNTHETIC-DPTEST-v11after1-OtherHouseholdPA) p2; otherHouseholdAccident (SYNTHETIC-DPTEST-v11after1-OtherHouseholdPA) p2  ·  next question: none  ·  19 ms

### Q26 — Does Marcus have a fracture benefit?

```
DearPolicy didn’t find fracture cover in the parts of your policies read so far (10 of 15 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
5 policy contracts still need wording, processing or further review. See the policy review list.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-FutureSaver
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11after1-WanderSafe
Partial review: 10 of 15 processed pages across 5 documents in 5 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  43 ms


## Ingestion (terminal state + linking)

| Doc | Status | Stage | Links | Benefits | Pages | ms | Error |
|---|---|---|---|---|---|---|---|
| hosp2022 | ready | complete | Charmaine:ai_name_match | 2 | 3 | 3277 |  |
| hosp2025 | ready | complete | Charmaine:ai_name_match | 4 | 4 | 255 |  |
| accident | ready | complete | Charmaine:ai_name_match | 4 | 4 | 174 |  |
| accidentEndorsement | ready | complete | Charmaine:ai_name_match | 1 | 2 | 156 |  |
| disability | ready | complete | Charmaine:ai_name_match | 3 | 3 | 167 |  |
| groupLife | ready | complete | Charmaine:ai_name_match | 2 | 3 | 152 |  |
| criticalIllness | ready | complete | Charmaine:ai_name_match | 2 | 4 | 152 |  |
| travelExpired | ready | complete | Charmaine:ai_name_match | 2 | 3 | 165 |  |
| travel | ready | complete | Marcus:ai_name_match | 4 | 3 | 121 |  |
| accidentMarcus | ready | complete | Marcus:ai_name_match | 4 | 4 | 166 |  |
| endowment | ready | complete | Marcus:ai_name_match | 2 | 3 | 118 |  |
| hospitalCashNoCurrency | ready | complete | Marcus:ai_name_match | 0 | 3 | 112 |  |
| termContradictory | ready | complete | Marcus:ai_name_match | 1 | 3 | 127 |  |
| maliciousRider | ready | complete | Marcus:ai_name_match | 1 | 3 | 113 |  |
| unreadable | failed | failed |  | 0 | 0 | 16 | This file could not be opened as a document, so none of its contents are availab |
| scannedPage | ready | complete |  | 0 | 1 | 634 |  |
| otherHouseholdAccident | ready | complete | Charmaine:ai_name_match | 2 | 3 | 136 |  |

Evidence provenance columns present: policy_coverages.source_text_end, policy_benefits.source_text_start, policy_benefits.source_text_end, policies.document_date, policy_benefits.passage_verified, policy_coverages.source_text_start, coverage_rules.source_text_start, coverage_rules.source_text_end, policy_coverages.passage_verified, coverage_rules.passage_verified, policy_benefits.conflict_note, policy_coverages.extraction_method, policy_coverages.conflict_note, coverage_rules.extraction_method, coverage_rules.conflict_note, policy_benefits.extraction_method

## Model usage (model_executions, this run)

| Operation | Provider | Model | Status | Calls | In | Out | Cost USD |
|---|---|---|---|---|---|---|---|
| benefit_extraction | gemini | flash-lite | failed | 80 | 0 | 0 | 0 |
| catalog_building | gemini | flash-lite | failed | 53 | 0 | 0 | 0 |
| chat_fact_finding | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 23 | 4994 | 1097 | 0.015724 |
| chat_fact_finding | openai | gpt-5-mini | failed | 1 | 0 | 0 | 0 |
| chat_reply | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 2 | 686 | 14 | 0.00024 |
| condition_catalog_extraction | gemini | flash-lite | failed | 49 | 0 | 0 | 0 |
| coverage_extraction | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 29 | 9334 | 348 | 0.003673 |
| hosted_ocr | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 1 | 31 | 116 | 0 |
| policy_extraction | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 15 | 8423 | 3639 | 0.011625 |

Provider calls attempted during the quota case: 1
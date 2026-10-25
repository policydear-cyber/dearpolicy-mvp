# V1.1 evaluation (in-process API) — SYNTHETIC-DPTEST-v11final1

## Release gates

| Gate | Result | Violations |
|---|---|---|
| unsupported_amount | PASS | 0 |
| unsupported_assertion | PASS | 0 |
| cross_scope | PASS | 0 |
| deleted_superseded | PASS | 0 |
| blocked_gap | PASS | 0 |
| positive_control | PASS | 0 |
| internal_text | PASS | 0 |
| fact_finding | PASS | 0 |

## Timing (ms)

| Group | n | p50 | p95 |
|---|---|---|---|
| factual | 13 | 29 | 137 |
| interview | 11 | 49 | 93 |
| all | 32 | 38 | 93 |

## Per question

| Q | Question | Result | Gates failed | ms |
|---|---|---|---|---|
| Q01 | What policies does Josephine have? | pass |  | 137 |
| Q02 | What is Josephine's hospital room and board benefit? | pass |  | 76 |
| Q03 | Does Josephine have a fracture benefit? | pass |  | 34 |
| Q04 | What is the waiting period for critical illness on Josephine's CritiCare plan? | pass |  | 29 |
| Q05 | Does Josephine's hospital plan cover dental treatment? | pass |  | 31 |
| Q06 | If Josephine had both a fracture and a permanent disablement from one accident, would both be paid? | pass |  | 24 |
| Q07 | What does Josephine's group life policy pay if she dies? | pass |  | 32 |
| Q08 | What is Josephine covered for if she dies in an accident? | pass |  | 63 |
| Q09 | What is Josephine's maternity coverage? | pass |  | 78 |
| Q10 | Does Josephine have travel insurance? | pass |  | 25 |
| Q11 | Josephine broke her arm. | pass |  | 55 |
| Q12 | An accident. | pass |  | 54 |
| Q13 | claim interview (6 answers): When did it happen? → Was the fracture confirmed by a doctor or on an X-ray or scan? → What treatment was given? → Was surgery performed? → How much did the treatment cost? | pass |  | 320 |
| Q14 | (the final response once the interview has no question left) | pass |  | 93 |
| Q15 | Which of her policies could pay for the broken arm? | pass |  | 26 |
| Q16 | How much can she claim? | pass |  | 55 |
| Q17 | (reopen c-injury from history) | pass |  | 25 |
| Q18 | What does Marcus's travel policy cover overseas? | pass |  | 27 |
| Q19 | What is the baggage delay benefit on Marcus's travel policy? | pass |  | 23 |
| Q20 | How much hospital cash does Marcus get per day? | pass |  | 19 |
| Q21 | What is Marcus's death benefit on his TermGuard policy? | pass |  | 20 |
| Q22 | Is Marcus covered for dental treatment? | pass |  | 93 |
| Q23 | What happens when Marcus's endowment plan matures? | pass |  | 27 |
| Q24 | Does Marcus have a fracture benefit? | pass |  | 19 |
| Q25 | Does Marcus have car insurance? | pass |  | 38 |
| Q26 | Does Marcus have a fracture benefit? | pass |  | 57 |
| Q27 | What happens when Marcus's endowment plan matures? | pass |  | 9 |
| Q28 | Does Josephine have a fracture benefit? | pass |  | 17 |

## Every gate violation

(none)

## Quality notes (not release gates)

(none)

## Answers (visible text)

### Q01 — What policies does Josephine have?

```
I found 6 personal policy contracts across 1 family profile. The table separates confirmed cover from records that still need review.
Schedules, amendments and supporting documents are grouped by insured person, insurer and policy number where available. An insured amount is a coverage amount, not a universal claim payout.
6 contracts show ownership but no recent payment or renewal evidence, so the active status is not recently verified. Ownership is unchanged.
Upload the latest premium receipt or renewal notice for Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-AccidentGuard; Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-GroupTermLife; Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-HospitalShield; Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-DisabilityCare so current status can be verified separately from ownership.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-AccidentGuard Verified personal cover Page 1
SYNTHETIC-DPTEST-v11final1-AccidentGuard Verified personal cover Page 1
SYNTHETIC-DPTEST-v11final1-GroupTermLife Verified personal cover Page 1
SYNTHETIC-DPTEST-v11final1-HospitalShield Verified personal cover Page 1
SYNTHETIC-DPTEST-v11final1-DisabilityCare Verified personal cover Page 1
SYNTHETIC-DPTEST-v11final1-JetSure Verified personal cover Page 1
SYNTHETIC-DPTEST-v11final1-CritiCare Verified personal cover Page 1
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
SYNTHETIC-DPTEST-v11final1-AccidentGuard  
SYNTHETIC-DPTEST-v11final1-AccidentGuard S$100,000 
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
SYNTHETIC-DPTEST-v11final1-GroupTermLife  
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
SYNTHETIC-DPTEST-v11final1-HospitalShield  
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
SYNTHETIC-DPTEST-v11final1-DisabilityCare S$200,000 
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
SYNTHETIC-DPTEST-v11final1-JetSure  
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
SYNTHETIC-DPTEST-v11final1-CritiCare S$120,000 
```
Citations: accidentEndorsement (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p1; groupLife (SYNTHETIC-DPTEST-v11final1-GroupTermLife) p1; hosp2025 (SYNTHETIC-DPTEST-v11final1-HospitalShield) p1; disability (SYNTHETIC-DPTEST-v11final1-DisabilityCare) p1; travelExpired (SYNTHETIC-DPTEST-v11final1-JetSure) p1; criticalIllness (SYNTHETIC-DPTEST-v11final1-CritiCare) p1  ·  next question: none  ·  137 ms

### Q02 — What is Josephine's hospital room and board benefit?

```
Here is what Josephine’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-HospitalShield — Daily room and board: S$800 per day, maximum 120 days (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-HospitalShield Your policy document Page 2
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
S$800
Daily room and board
Daily room and board	S$800 per day, maximum 120 days
```
Citations: hosp2025 (SYNTHETIC-DPTEST-v11final1-HospitalShield) p2; hosp2025 (SYNTHETIC-DPTEST-v11final1-HospitalShield) p2  ·  next question: none  ·  76 ms

### Q03 — Does Josephine have a fracture benefit?

```
Here is what Josephine’s documents state about accident cover. Each line shows the page it comes from. SYNTHETIC-DPTEST-v11final1-AccidentGuard states different figures for fracture of arm: S$1,200 on page 1 and S$1,000 on page 2. DearPolicy can’t tell which one applies, so it has not picked one; the insurer can confirm. One of them comes from an endorsement to the policy. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of leg: S$1,500 (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm: S$1,200 (page 1, document dated 1 Jan 2026).
SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm: S$1,000 (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-AccidentGuard Your policy document Page 2
SYNTHETIC-DPTEST-v11final1-AccidentGuard Your policy document Page 1
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
S$1,500
Fracture of leg
Fracture of leg	S$1,500
```
Citations: accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p2; accidentEndorsement (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p2  ·  next question: none  ·  34 ms

### Q04 — What is the waiting period for critical illness on Josephine's CritiCare plan?

```
Here is what Josephine’s documents state. Each line shows the page it comes from. Some of this comes from a document dated 1 Mar 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-CritiCare — Waiting period: 90 days from the effective date for any critical illness. (page 3, document dated 1 Mar 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-CritiCare Your policy document Page 3
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: criticalIllness (SYNTHETIC-DPTEST-v11final1-CritiCare) p3  ·  next question: none  ·  29 ms

### Q05 — Does Josephine's hospital plan cover dental treatment?

```
Here is what Josephine’s documents state. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-HospitalShield — Exclusions: cosmetic surgery; dental treatment unless caused by an accident; self-inflicted injury. (page 3, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-HospitalShield Your policy document Page 3
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: hosp2025 (SYNTHETIC-DPTEST-v11final1-HospitalShield) p3  ·  next question: none  ·  31 ms

### Q06 — If Josephine had both a fracture and a permanent disablement from one accident, would both be paid?

```
Here is what Josephine’s documents state. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-AccidentGuard — Alternative benefits: where a Fracture benefit and a Permanent Disablement benefit arise from the same accident, only the higher amount is payable. (page 3, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-AccidentGuard Your policy document Page 3
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p3  ·  next question: none  ·  24 ms

### Q07 — What does Josephine's group life policy pay if she dies?

```
Here is what Josephine’s documents state about death cover. Each line shows the page it comes from.
SYNTHETIC-DPTEST-v11final1-GroupTermLife — Death (any cause): S$150,000 (page 2, document dated 1 Jan 2026).
SYNTHETIC-DPTEST-v11final1-GroupTermLife — Additional accidental death benefit: S$50,000 (page 2, document dated 1 Jan 2026).
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-GroupTermLife Your policy document Page 2
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
S$150,000
Death (any cause)
Death (any cause)	S$150,000
S$50,000
Additional accidental death benefit
Additional accidental death benefit	S$50,000
```
Citations: groupLife (SYNTHETIC-DPTEST-v11final1-GroupTermLife) p2; groupLife (SYNTHETIC-DPTEST-v11final1-GroupTermLife) p2; groupLife (SYNTHETIC-DPTEST-v11final1-GroupTermLife) p2  ·  next question: none  ·  32 ms

### Q08 — What is Josephine covered for if she dies in an accident?

```
If that happened, these benefits could be relevant. This is a preliminary claim assessment: DearPolicy does not estimate what the insurer would pay until claim evidence has been reviewed. Each card says what is still needed.
This is a what-if. Nothing here has been recorded as a claim, and no facts from this question have been saved against anyone's profile.
The Coverage page shows where each of these came from in your documents, and whether it was verified.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-GroupTermLife — Death (any cause)
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and checked against the page.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-AccidentGuard — Accidental death
100% of an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and checked against the page.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-GroupTermLife — Additional accidental death benefit
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and checked against the page.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11final1-GroupTermLife Policy wording, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11final1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: groupLife (SYNTHETIC-DPTEST-v11final1-GroupTermLife) p2; accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p2  ·  next question: none  ·  63 ms

### Q09 — What is Josephine's maternity coverage?

```
DearPolicy didn’t find maternity cover in the parts of Josephine’s policies read so far. That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
6 policy contracts still need wording, processing or further review. See the policy review list.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
Partial review: not every part of the documents on file was read for this answer. Something not found so far may still be in the parts not yet read.
```
Citations: none  ·  next question: none  ·  78 ms

### Q10 — Does Josephine have travel insurance?

```
Here is what Josephine’s documents state about travel cover. Each line shows the page it comes from. SYNTHETIC-DPTEST-v11final1-JetSure expired on 2024-12-31 (page 1), so its terms may no longer apply.
SYNTHETIC-DPTEST-v11final1-JetSure — Overseas medical expenses: S$100,000 (page 2, document dated 1 Jan 2024; expired).
SYNTHETIC-DPTEST-v11final1-JetSure — Trip cancellation: S$3,000 (page 2, document dated 1 Jan 2024; expired).
SYNTHETIC-DPTEST-v11final1-JetSure — Expiry date: 2024-12-31 (page 1; this policy has expired).
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-JetSure Your policy document Page 2
SYNTHETIC-DPTEST-v11final1-JetSure Your policy document Page 1
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
S$100,000
Overseas medical expenses
Overseas medical expenses	S$100,000
S$3,000
Trip cancellation
Trip cancellation	S$3,000
```
Citations: travelExpired (SYNTHETIC-DPTEST-v11final1-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11final1-JetSure) p1; travelExpired (SYNTHETIC-DPTEST-v11final1-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11final1-JetSure) p2  ·  next question: none  ·  25 ms

### Q11 — Josephine broke her arm.

```
I’m sorry Josephine is dealing with this. A broken arm can involve several kinds of cover, so I need a few details before I check Josephine’s policies.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Was this caused by an accident, or an illness?
Some of these benefits only pay for accidents, so this decides which ones apply.
An accident
An illness
Not sure
Josephine Tan Hui Min
Injured: yes
Fracture: arm
Injuries: broke her arm
Injury
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Was this caused by an accident, or an illness? Some of these benefits only pay for accidents, so this decides which ones apply.
Did it happen during a hazardous sport or activity (for example diving, climbing, motor sports)? 2 uploaded policies state an exclusion for hazardous activities.
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: none  ·  next question: Was this caused by an accident, or an illness?  ·  55 ms

### Q12 — An accident.

```
I’m sorry Josephine is dealing with this. A broken arm may relate to accident medical reimbursement, medical reimbursement, hospitalisation, fracture or hospital cash benefits in Josephine’s policies, depending on the answers. It is not the same as permanent loss of a limb, so I won’t count permanent-disability schedule amounts from the information available.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Where did the accident happen?
Some benefits apply only in certain places, and treatment overseas usually needs extra documents.
Singapore
Overseas
Not sure
Josephine Tan Hui Min
Injured: yes
Injuries: broke her arm
Fracture: arm
Injury
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Where did the accident happen? Some benefits apply only in certain places, and treatment overseas usually needs extra documents.
Did it happen during a hazardous sport or activity (for example diving, climbing, motor sports)? 2 uploaded policies state an exclusion for hazardous activities.
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: none  ·  next question: Where did the accident happen?  ·  54 ms

### Q13.1 — 

```
Thanks, noted.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
When did it happen?
It decides which policy version applies and whether waiting periods or cover dates are met.
Not sure
Josephine Tan Hui Min
Injured: yes
Injuries: broke her arm
Fracture: arm
Event Location: Singapore
Injury
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
When did it happen? It decides which policy version applies and whether waiting periods or cover dates are met.
Did it happen during a hazardous sport or activity (for example diving, climbing, motor sports)? 2 uploaded policies state an exclusion for hazardous activities.
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: none  ·  next question: When did it happen?  ·  43 ms

### Q13.2 — 

```
Thanks, noted.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Was the fracture confirmed by a doctor or on an X-ray or scan?
Fracture benefits usually need the break confirmed by a doctor or imaging.
Yes
No
Not sure
Josephine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Location: Singapore
Fracture: arm
Event Date: 2026-09-20
Injury
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Was the fracture confirmed by a doctor or on an X-ray or scan? Fracture benefits usually need the break confirmed by a doctor or imaging.
Did it happen during a hazardous sport or activity (for example diving, climbing, motor sports)? 2 uploaded policies state an exclusion for hazardous activities.
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: none  ·  next question: Was the fracture confirmed by a doctor or on an X-ray or scan?  ·  44 ms

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
Josephine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Date: 2026-09-20
Event Location: Singapore
Fracture: arm
Fracture Confirmed: yes
Injury
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
What treatment was given? Emergency, inpatient and outpatient treatment are paid under different benefits.
Did it happen during a hazardous sport or activity (for example diving, climbing, motor sports)? 2 uploaded policies state an exclusion for hazardous activities.
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: none  ·  next question: What treatment was given?  ·  46 ms

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
Josephine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Date: 2026-09-20
Event Location: Singapore
Fracture: arm
Fracture Confirmed: yes
Treatment Type: Emergency department
Hospitalised: no
Injury
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Has any other insurer or the employer already paid part of the bill? Reimbursement is coordinated so the same bill is not paid twice.
Did it happen during a hazardous sport or activity (for example diving, climbing, motor sports)? 2 uploaded policies state an exclusion for hazardous activities.
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: none  ·  next question: Was surgery performed?  ·  49 ms

### Q13.5 — 

```
Before I put figures on this, one question.
This may relate to accident medical reimbursement or fracture benefits, depending on the answers.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
How much did the treatment cost?
It is reimbursed up to the policy's limit.
Not sure
Josephine Tan Hui Min
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
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Has any other insurer or the employer already paid part of the bill? Reimbursement is coordinated so the same bill is not paid twice.
Did it happen during a hazardous sport or activity (for example diving, climbing, motor sports)? 2 uploaded policies state an exclusion for hazardous activities.
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: none  ·  next question: How much did the treatment cost?  ·  45 ms

### Q13.6 — 

```
Thanks — that’s what I need for now. For the broken arm, Josephine’s policies have possible benefits: SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11final1-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.
Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.
Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-AccidentGuard — Accident medical reimbursement
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11final1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Josephine Tan Hui Min
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
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p2  ·  next question: none  ·  93 ms

### Q14 — (the final response once the interview has no question left)

```
Thanks — that’s what I need for now. For the broken arm, Josephine’s policies have possible benefits: SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11final1-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.
Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.
Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-AccidentGuard — Accident medical reimbursement
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11final1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Josephine Tan Hui Min
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
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p2  ·  next question: none  ·  93 ms

### Q15 — Which of her policies could pay for the broken arm?

```
Here is the fracture cover in Josephine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm (page 1)
SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of leg (page 2)
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-AccidentGuard Benefit schedule, read when the document was uploaded Page 1
SYNTHETIC-DPTEST-v11final1-AccidentGuard Benefit schedule, read when the document was uploaded Page 2
Josephine Tan Hui Min
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
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Has any other insurer or the employer already paid part of the bill? Reimbursement is coordinated so the same bill is not paid twice.
Did it happen during a hazardous sport or activity (for example diving, climbing, motor sports)? 2 uploaded policies state an exclusion for hazardous activities.
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
S$1,200
Fracture of arm
Fracture of arm S$1,200
S$1,500
Fracture of leg
Fracture of leg S$1,500
```
Citations: accidentEndorsement (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p2; accidentEndorsement (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p2  ·  next question: Has any other insurer or the employer already paid part of the bill?  ·  26 ms

### Q16 — How much can she claim?

```
Here is where this claim stands. For the broken arm, Josephine’s policies have possible benefits: SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11final1-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.
Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.
Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-AccidentGuard — Accident medical reimbursement
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11final1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Josephine Tan Hui Min
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
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p2  ·  next question: none  ·  55 ms

### Q17 — (reopen c-injury from history)

```
Here is where this claim stands. For the broken arm, Josephine’s policies have possible benefits: SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11final1-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.
Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.
Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-AccidentGuard — Fracture of arm
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11final1-AccidentGuard — Accident medical reimbursement
Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11final1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Josephine Tan Hui Min
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
Josephine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-AccidentGuard
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-GroupTermLife
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-HospitalShield
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-DisabilityCare
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-JetSure
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-CritiCare
```
Citations: accident (SYNTHETIC-DPTEST-v11final1-AccidentGuard) p2  ·  next question: none  ·  25 ms

### Q18 — What does Marcus's travel policy cover overseas?

```
Here is what Marcus’s documents state about travel cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-WanderSafe — Overseas medical expenses: US$250,000 (page 2, document dated 1 Jun 2025; not confirmed current).
SYNTHETIC-DPTEST-v11final1-WanderSafe — Emergency medical evacuation: USD 500,000 (page 2, document dated 1 Jun 2025; not confirmed current).
SYNTHETIC-DPTEST-v11final1-WanderSafe — Trip cancellation: S$5,000 (page 2, document dated 1 Jun 2025; not confirmed current).
SYNTHETIC-DPTEST-v11final1-WanderSafe — Baggage delay: S$200 for every 6 hours, maximum S$1,000 (page 2, document dated 1 Jun 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-WanderSafe Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-FutureSaver
US$250,000
Overseas medical expenses
Overseas medical expenses	US$250,000
US$500,000
Emergency medical evacuation
Emergency medical evacuation	USD 500,000
S$5,000
Trip cancellation
Trip cancellation	S$5,000
S$200
Baggage delay
Baggage delay	S$200 for every 6 hours, maximum S$1,000
```
Citations: travel (SYNTHETIC-DPTEST-v11final1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11final1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11final1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11final1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11final1-WanderSafe) p2  ·  next question: none  ·  27 ms

### Q19 — What is the baggage delay benefit on Marcus's travel policy?

```
Here is what Marcus’s documents state about travel cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-WanderSafe — Baggage delay: S$200 for every 6 hours, maximum S$1,000 (page 2, document dated 1 Jun 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-WanderSafe Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-FutureSaver
S$200
Baggage delay
Baggage delay	S$200 for every 6 hours, maximum S$1,000
```
Citations: travel (SYNTHETIC-DPTEST-v11final1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11final1-WanderSafe) p2  ·  next question: none  ·  23 ms

### Q20 — How much hospital cash does Marcus get per day?

```
Here is what Marcus’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-DailyCash — Hospital cash: 150 per day, maximum 60 days (no currency is printed for this amount) (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11final1-DailyCash — Intensive care cash: 300 per day, maximum 10 days (no currency is printed for this amount) (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-DailyCash Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-FutureSaver
```
Citations: hospitalCashNoCurrency (SYNTHETIC-DPTEST-v11final1-DailyCash) p2  ·  next question: none  ·  19 ms

### Q21 — What is Marcus's death benefit on his TermGuard policy?

```
Here is what Marcus’s documents state about death cover. Each line shows the page it comes from. SYNTHETIC-DPTEST-v11final1-TermGuard states different figures for death benefit: US$350,000 on page 2 and S$300,000 on page 1. DearPolicy can’t tell which one applies, so it has not picked one; the insurer can confirm. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-TermGuard — Terminal illness benefit: Advance of the death benefit (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11final1-TermGuard — Death benefit: US$350,000 (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11final1-TermGuard — Death sum insured: S$300,000 (page 1, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-TermGuard Your policy document Page 2
SYNTHETIC-DPTEST-v11final1-TermGuard Your policy document Page 1
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-FutureSaver
```
Citations: termContradictory (SYNTHETIC-DPTEST-v11final1-TermGuard) p2; termContradictory (SYNTHETIC-DPTEST-v11final1-TermGuard) p1  ·  next question: none  ·  20 ms

### Q22 — Is Marcus covered for dental treatment?

```
DearPolicy didn’t find dental cover in the parts of your policies read so far. That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
6 policy contracts still need wording, processing or further review. See the policy review list.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-FutureSaver
Partial review: not every part of the documents on file was read for this answer. Something not found so far may still be in the parts not yet read.
```
Citations: none  ·  next question: none  ·  93 ms

### Q23 — What happens when Marcus's endowment plan matures?

```
Here is what Marcus’s documents state about maturity or surrender value. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2020, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-FutureSaver — Guaranteed maturity benefit: S$50,000 payable on 2040-06-01 (page 2, document dated 1 Jun 2020; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-FutureSaver Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-FutureSaver
S$50,000
Guaranteed maturity benefit
Guaranteed maturity benefit	S$50,000 payable on 2040-06-01
```
Citations: endowment (SYNTHETIC-DPTEST-v11final1-FutureSaver) p2; endowment (SYNTHETIC-DPTEST-v11final1-FutureSaver) p2  ·  next question: none  ·  27 ms

### Q24 — Does Marcus have a fracture benefit?

```
Here is what Marcus’s documents state about accident cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M — Fracture of arm: S$500 (page 2, document dated 1 Jan 2025; not confirmed current).
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M — Fracture of leg: S$750 (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M Your policy document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-FutureSaver
S$500
Fracture of arm
Fracture of arm	S$500
S$750
Fracture of leg
Fracture of leg	S$750
```
Citations: accidentMarcus (SYNTHETIC-DPTEST-v11final1-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11final1-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11final1-AccidentGuard-M) p2  ·  next question: none  ·  19 ms

### Q25 — Does Marcus have car insurance?

```
You have no motor policy on file, so there is nothing in your documents to answer this from. The policies on file are: SYNTHETIC-DPTEST-v11final1-TermGuard, SYNTHETIC-DPTEST-v11final1-DailyCash, SYNTHETIC-DPTEST-v11final1-WanderSafe. If there is a motor policy, upload it and ask again.
6 policy contracts still need wording, processing or further review. See the policy review list.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-FutureSaver
Partial review: not every part of the documents on file was read for this answer. Something not found so far may still be in the parts not yet read.
```
Citations: none  ·  next question: none  ·  38 ms

### Q27 — What happens when Marcus's endowment plan matures?

```
I couldn’t read your message just now: DearPolicy’s reading service is unavailable right now because of a problem on our side, not with your documents. Your message is saved.
Send the message again — a retry usually succeeds.
If it fails twice, split it into two shorter messages and DearPolicy will keep the facts from both.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  9 ms

### Q28 — Does Josephine have a fracture benefit?

```
Here is what Josephine’s documents state about accident cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.
SYNTHETIC-DPTEST-v11final1-OtherHouseholdPA — Fracture of arm: S$3,500 (page 2, document dated 1 Jan 2025; not confirmed current).
Upload the latest renewal notice or premium receipt to confirm the policy is current.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
SYNTHETIC-DPTEST-v11final1-OtherHouseholdPA Your policy document Page 2
Josephine Tan Hui Min
Josephine Tan Hui Min
SYNTHETIC-DPTEST-v11final1-OtherHouseholdPA
S$3,500
Fracture of arm
Fracture of arm	S$3,500
```
Citations: otherHouseholdAccident (SYNTHETIC-DPTEST-v11final1-OtherHouseholdPA) p2; otherHouseholdAccident (SYNTHETIC-DPTEST-v11final1-OtherHouseholdPA) p2  ·  next question: none  ·  17 ms

### Q26 — Does Marcus have a fracture benefit?

```
DearPolicy didn’t find fracture cover in the parts of your policies read so far. That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
5 policy contracts still need wording, processing or further review. See the policy review list.
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11final1-FutureSaver
Partial review: not every part of the documents on file was read for this answer. Something not found so far may still be in the parts not yet read.
```
Citations: none  ·  next question: none  ·  57 ms


## Ingestion (terminal state + linking)

| Doc | Status | Stage | Links | Benefits | Pages | ms | Error |
|---|---|---|---|---|---|---|---|
| hosp2022 | ready | complete | Josephine:ai_name_match | 2 | 3 | 2582 |  |
| hosp2025 | ready | complete | Josephine:ai_name_match | 4 | 4 | 204 |  |
| accident | ready | complete | Josephine:ai_name_match | 4 | 4 | 124 |  |
| accidentEndorsement | ready | complete | Josephine:ai_name_match | 1 | 2 | 131 |  |
| disability | ready | complete | Josephine:ai_name_match | 3 | 3 | 120 |  |
| groupLife | ready | complete | Josephine:ai_name_match | 2 | 3 | 101 |  |
| criticalIllness | ready | complete | Josephine:ai_name_match | 2 | 4 | 108 |  |
| travelExpired | ready | complete | Josephine:ai_name_match | 2 | 3 | 137 |  |
| travel | ready | complete | Marcus:ai_name_match | 4 | 3 | 100 |  |
| accidentMarcus | ready | complete | Marcus:ai_name_match | 4 | 4 | 104 |  |
| endowment | ready | complete | Marcus:ai_name_match | 2 | 3 | 103 |  |
| hospitalCashNoCurrency | ready | complete | Marcus:ai_name_match | 2 | 3 | 111 |  |
| termContradictory | ready | complete | Marcus:ai_name_match | 1 | 3 | 112 |  |
| maliciousRider | ready | complete | Marcus:ai_name_match | 1 | 3 | 95 |  |
| unreadable | failed | failed |  | 0 | 0 | 8 | This file could not be opened as a document, so none of its contents are availab |
| scannedPage | ready | complete |  | 0 | 1 | 632 |  |
| otherHouseholdAccident | ready | complete | Josephine:ai_name_match | 2 | 3 | 127 |  |

Evidence provenance columns present: policy_coverages.source_text_end, policy_benefits.source_text_start, policy_benefits.source_text_end, policies.document_date, policy_benefits.passage_verified, policy_coverages.source_text_start, coverage_rules.source_text_start, coverage_rules.source_text_end, policy_coverages.passage_verified, coverage_rules.passage_verified, policy_benefits.conflict_note, policy_coverages.extraction_method, policy_coverages.conflict_note, coverage_rules.extraction_method, coverage_rules.conflict_note, policy_benefits.extraction_method

## Model usage (model_executions, this run)

| Operation | Provider | Model | Status | Calls | In | Out | Cost USD |
|---|---|---|---|---|---|---|---|
| benefit_extraction | gemini | flash-lite | failed | 12 | 0 | 0 | 0 |
| catalog_building | gemini | flash-lite | failed | 18 | 0 | 0 | 0 |
| chat_fact_finding | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 23 | 4888 | 1097 | 0.015564 |
| chat_fact_finding | openai | gpt-5-mini | failed | 1 | 0 | 0 | 0 |
| chat_reply | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 1 | 330 | 7 | 0.000117 |
| coverage_extraction | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 23 | 7075 | 276 | 0.002815 |
| hosted_ocr | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 1 | 31 | 116 | 0 |
| policy_extraction | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 15 | 8423 | 3639 | 0.011625 |

Provider calls attempted during the quota case: 1
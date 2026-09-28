# V1.1 evaluation (in-process API) — SYNTHETIC-DPTEST-v11before1

## Release gates

| Gate | Result | Violations |
|---|---|---|
| unsupported_amount | PASS | 0 |
| unsupported_assertion | **FAIL** | 3 |
| cross_scope | PASS | 0 |
| deleted_superseded | PASS | 0 |
| blocked_gap | **FAIL** | 2 |
| positive_control | **FAIL** | 8 |
| internal_text | **FAIL** | 28 |
| fact_finding | **FAIL** | 2 |

## Timing (ms)

| Group | n | p50 | p95 |
|---|---|---|---|
| factual | 13 | 31 | 166 |
| interview | 13 | 62 | 220 |
| all | 34 | 38 | 220 |

## Per question

| Q | Question | Result | Gates failed | ms |
|---|---|---|---|---|
| Q01 | What policies does Charmaine have? | pass |  | 166 |
| Q02 | What is Charmaine's hospital room and board benefit? | FAIL | positive_control | 38 |
| Q03 | Does Charmaine have a fracture benefit? | pass |  | 31 |
| Q04 | What is the waiting period for critical illness on Charmaine's CritiCare plan? | FAIL | internal_text | 80 |
| Q05 | Does Charmaine's hospital plan cover dental treatment? | FAIL | positive_control | 22 |
| Q06 | If Charmaine had both a fracture and a permanent disablement from one accident, would both be paid? | FAIL | positive_control | 22 |
| Q07 | What does Charmaine's group life policy pay if she dies? | FAIL | internal_text, positive_control | 100 |
| Q08 | What is Charmaine covered for if she dies in an accident? | FAIL | internal_text | 94 |
| Q09 | What is Charmaine's maternity coverage? | FAIL | internal_text | 50 |
| Q10 | Does Charmaine have travel insurance? | FAIL | unsupported_assertion | 19 |
| Q11 | Charmaine broke her arm. | pass |  | 51 |
| Q12 | An accident. | pass |  | 24 |
| Q13 | claim interview (8 answers): When did it happen? → Was the fracture confirmed by a doctor or on an X-ray or scan? → What treatment was given? → Was surgery performed? → How much did the treatment cost? → Has any other insurer or the employer already paid part of the bill? → Has a doctor said the injury will leave any lasting impairment? | FAIL | internal_text | 866 |
| Q14 | (the final response once the interview has no question left) | FAIL | internal_text, unsupported_assertion | 220 |
| Q15 | Which of her policies could pay for the broken arm? | pass |  | 18 |
| Q16 | How much can she claim? | FAIL | internal_text, blocked_gap | 62 |
| Q17 | (reopen c-injury from history) | FAIL | fact_finding | 133 |
| Q18 | What does Marcus's travel policy cover overseas? | pass |  | 28 |
| Q19 | What is the baggage delay benefit on Marcus's travel policy? | FAIL | positive_control | 25 |
| Q20 | How much hospital cash does Marcus get per day? | FAIL | internal_text | 51 |
| Q21 | What is Marcus's death benefit on his TermGuard policy? | FAIL | unsupported_assertion, blocked_gap | 13 |
| Q22 | Is Marcus covered for dental treatment? | FAIL | internal_text | 41 |
| Q23 | What happens when Marcus's endowment plan matures? | FAIL | positive_control | 21 |
| Q24 | Does Marcus have a fracture benefit? | pass |  | 13 |
| Q25 | Does Marcus have car insurance? | FAIL | internal_text | 33 |
| Q26 | Does Marcus have a fracture benefit? | FAIL | internal_text | 28 |
| Q27 | What happens when Marcus's endowment plan matures? | pass |  | 2015 |
| Q28 | Does Charmaine have a fracture benefit? | pass |  | 11 |

## Every gate violation

- **Q02** [positive_control] missing: S$800 per day from the 2025 edition
- **Q04** [internal_text] rule/row/page counts: "13 of 23 processed pages"
- **Q05** [positive_control] missing: dental excluded unless caused by an accident
- **Q06** [positive_control] missing: only the higher amount is payable
- **Q07** [internal_text] model / reader status: "by a second read"
- **Q07** [positive_control] missing: S$150,000 death (any cause)
- **Q08** [internal_text] model / reader status: "by a second read"
- **Q09** [internal_text] rule/row/page counts: "13 of 23 pages"
- **Q10** [unsupported_assertion] an expired policy's terms presented without its date (not identified as outdated)
- **Q13** [internal_text] Q13.6: model / reader status: "by a second read"
- **Q13** [internal_text] Q13.7: model / reader status: "by a second read"
- **Q13** [internal_text] Q13.8: model / reader status: "reader could not be reached"
- **Q14** [internal_text] model / reader status: "reader could not be reached"
- **Q14** [unsupported_assertion] cites travelExpired (an expired overseas travel policy offered for an accident in Singapore)
- **Q16** [internal_text] rule/row/page counts: "13 of 23 pages"
- **Q16** [blocked_gap] the question itself treated as a benefit name: "didn’t find How much"
- **Q17** [fact_finding] claims list says "Assessment ready" while the claim has no evidence-backed estimate
- **Q17** [fact_finding] a claim event is named after an interview reply: "Has a doctor said the injury will leave any lasting impairment: No"
- **Q19** [positive_control] missing: S$200 for every 6 hours
- **Q19** [positive_control] missing: maximum S$1,000 (cap)
- **Q20** [internal_text] rule/row/page counts: "11 of 19 processed pages"
- **Q21** [unsupported_assertion] chose 350,000 although the document also states 300,000
- **Q21** [blocked_gap] the answer does not explain what could not be verified
- **Q22** [internal_text] rule/row/page counts: "11 of 19 pages"
- **Q23** [positive_control] missing: S$50,000 guaranteed maturity benefit
- **Q23** [positive_control] missing: maturity date 2040-06-01
- **Q25** [internal_text] rule/row/page counts: "11 of 19 processed pages"
- **Q26** [internal_text] rule/row/page counts: "10 of 15 pages"
- **INGEST** [internal_text] documents page, AccidentGuard-Endorsement-1.pdf (message): rule/row/page counts: "1 benefit rule" in "Ready. 1 benefit rule read from this document."
- **INGEST** [internal_text] documents page, HealthPlusRider.pdf (message): rule/row/page counts: "1 benefit rule" in "Ready. 1 benefit rule read from this document."
- **INGEST** [internal_text] documents page, TermGuard.pdf (message): rule/row/page counts: "1 benefit rule" in "Ready. 1 benefit rule read from this document."
- **INGEST** [internal_text] documents page, DailyCash.pdf (message): rule/row/page counts: "0 benefit rules" in "Ready. 0 benefit rules read from this document."
- **INGEST** [internal_text] documents page, FutureSaver.pdf (message): rule/row/page counts: "2 benefit rules" in "Ready. 2 benefit rules read from this document; 1 to confirm on the Benefits page."
- **INGEST** [internal_text] documents page, AccidentGuard-M.pdf (message): rule/row/page counts: "4 benefit rules" in "Ready. 4 benefit rules read from this document."
- **INGEST** [internal_text] documents page, WanderSafe.pdf (message): rule/row/page counts: "4 benefit rules" in "Ready. 4 benefit rules read from this document; 1 to confirm on the Benefits page."
- **INGEST** [internal_text] documents page, JetSure.pdf (message): rule/row/page counts: "2 benefit rules" in "Ready. 2 benefit rules read from this document."
- **INGEST** [internal_text] documents page, CritiCare.pdf (message): rule/row/page counts: "2 benefit rules" in "Ready. 2 benefit rules read from this document."
- **INGEST** [internal_text] documents page, GroupTermLife.pdf (message): rule/row/page counts: "2 benefit rules" in "Ready. 2 benefit rules read from this document."
- **INGEST** [internal_text] documents page, DisabilityCare.pdf (message): rule/row/page counts: "3 benefit rules" in "Ready. 3 benefit rules read from this document."
- **INGEST** [internal_text] documents page, AccidentGuard.pdf (message): rule/row/page counts: "4 benefit rules" in "Ready. 4 benefit rules read from this document."
- **INGEST** [internal_text] documents page, HospitalShield-2025.pdf (message): rule/row/page counts: "4 benefit rules" in "Ready. 4 benefit rules read from this document."
- **INGEST** [internal_text] documents page, ScannedWording.png (message): rule/row/page counts: "0 benefit rules" in "Ready. 0 benefit rules read from this document."
- **INGEST** [internal_text] documents page, DentalCare-scan.pdf (error): routine repair task: "Re-analyse" in "Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again."

## Quality notes (not release gates)

- Q10 [expected_assertion_missing] missing: says it expired / gives its date

## Answers (visible text)

### Q01 — What policies does Charmaine have?

```
I found 6 personal policy contracts across 1 family profile. The table separates confirmed cover from records that still need review.
Schedules, amendments and supporting documents are grouped by insured person, insurer and policy number where available. An insured amount is a coverage amount, not a universal claim payout.
6 contracts show ownership but no recent payment or renewal evidence, so the active status is not recently verified. Ownership is unchanged.
Upload the latest premium receipt or renewal notice for Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-HospitalShield; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-DisabilityCare; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-JetSure so current status can be verified separately from ownership.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-AccidentGuard Verified personal cover Page 1
SYNTHETIC-DPTEST-v11before1-AccidentGuard Verified personal cover Page 1
SYNTHETIC-DPTEST-v11before1-HospitalShield Verified personal cover Page 1
SYNTHETIC-DPTEST-v11before1-DisabilityCare Verified personal cover Page 1
SYNTHETIC-DPTEST-v11before1-JetSure Verified personal cover Page 1
SYNTHETIC-DPTEST-v11before1-GroupTermLife Verified personal cover Page 1
SYNTHETIC-DPTEST-v11before1-CritiCare Verified personal cover Page 1
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
SYNTHETIC-DPTEST-v11before1-AccidentGuard  
SYNTHETIC-DPTEST-v11before1-AccidentGuard S$100,000 
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
SYNTHETIC-DPTEST-v11before1-HospitalShield  
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
SYNTHETIC-DPTEST-v11before1-DisabilityCare S$200,000 
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
SYNTHETIC-DPTEST-v11before1-JetSure  
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
SYNTHETIC-DPTEST-v11before1-GroupTermLife  
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
SYNTHETIC-DPTEST-v11before1-CritiCare S$120,000 
```
Citations: accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; hosp2025 (SYNTHETIC-DPTEST-v11before1-HospitalShield) p1; disability (SYNTHETIC-DPTEST-v11before1-DisabilityCare) p1; travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p1; groupLife (SYNTHETIC-DPTEST-v11before1-GroupTermLife) p1; criticalIllness (SYNTHETIC-DPTEST-v11before1-CritiCare) p1  ·  next question: none  ·  166 ms

### Q02 — What is Charmaine's hospital room and board benefit?

```
Here is the hospital cover in Charmaine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-HospitalShield — Daily room and board (page 2)
SYNTHETIC-DPTEST-v11before1-HospitalShield — Hospital cash (page 2)
SYNTHETIC-DPTEST-v11before1-HospitalShield — Intensive care unit (page 2)
SYNTHETIC-DPTEST-v11before1-HospitalShield — Surgical fees (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-HospitalShield Benefit schedule, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
S$25,000
Surgical fees
Surgical fees Up to S$25,000 per surgery
```
Citations: hosp2025 (SYNTHETIC-DPTEST-v11before1-HospitalShield) p2; hosp2025 (SYNTHETIC-DPTEST-v11before1-HospitalShield) p2  ·  next question: none  ·  38 ms

### Q03 — Does Charmaine have a fracture benefit?

```
Here is the fracture cover in Charmaine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of arm (page 1)
SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of leg (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-AccidentGuard Benefit schedule, read when the document was uploaded Page 1
SYNTHETIC-DPTEST-v11before1-AccidentGuard Benefit schedule, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
S$1,200
Fracture of arm
Fracture of arm S$1,200
S$1,500
Fracture of leg
Fracture of leg S$1,500
```
Citations: accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: none  ·  31 ms

### Q04 — What is the waiting period for critical illness on Charmaine's CritiCare plan?

```
The uploaded passages support the policy details below.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-HospitalShield: General Conditions Waiting period: no benefit is payable for any illness that starts within 30 days of the effective date.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-CritiCare: General Conditions Waiting period: 90 days from the effective date for any critical illness.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-CritiCare: Schedule of Benefits - Critical Illness Critical illness benefit 100% of Sum Insured Early stage critical illness 25% of Sum Insured
6 policy contracts still need wording, processing or further review. See the policy review list.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-HospitalShield Personal document Page 3
SYNTHETIC-DPTEST-v11before1-CritiCare Personal document Page 3
SYNTHETIC-DPTEST-v11before1-CritiCare Personal document Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: hosp2025 (SYNTHETIC-DPTEST-v11before1-HospitalShield) p3; criticalIllness (SYNTHETIC-DPTEST-v11before1-CritiCare) p3; criticalIllness (SYNTHETIC-DPTEST-v11before1-CritiCare) p2  ·  next question: none  ·  80 ms

### Q05 — Does Charmaine's hospital plan cover dental treatment?

```
Here is the hospital cover and dental cover in Charmaine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-HospitalShield — Daily room and board (page 2)
SYNTHETIC-DPTEST-v11before1-HospitalShield — Hospital cash (page 2)
SYNTHETIC-DPTEST-v11before1-HospitalShield — Intensive care unit (page 2)
SYNTHETIC-DPTEST-v11before1-HospitalShield — Surgical fees (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-HospitalShield Benefit schedule, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
S$25,000
Surgical fees
Surgical fees Up to S$25,000 per surgery
```
Citations: hosp2025 (SYNTHETIC-DPTEST-v11before1-HospitalShield) p2; hosp2025 (SYNTHETIC-DPTEST-v11before1-HospitalShield) p2  ·  next question: none  ·  22 ms

### Q06 — If Charmaine had both a fracture and a permanent disablement from one accident, would both be paid?

```
Here is the fracture cover and disability cover and accident cover in Charmaine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accident medical reimbursement (page 2)
SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accidental death (page 2)
SYNTHETIC-DPTEST-v11before1-GroupTermLife — Additional accidental death benefit (page 2)
SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of arm (page 1)
SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of leg (page 2)
SYNTHETIC-DPTEST-v11before1-DisabilityCare — Loss of arm at or above the elbow (page 2)
SYNTHETIC-DPTEST-v11before1-DisabilityCare — Loss of hand at or above the wrist (page 2)
SYNTHETIC-DPTEST-v11before1-DisabilityCare — Permanent total disablement (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-AccidentGuard Benefit schedule, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11before1-GroupTermLife Benefit schedule, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11before1-AccidentGuard Benefit schedule, read when the document was uploaded Page 1
SYNTHETIC-DPTEST-v11before1-DisabilityCare Benefit schedule, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
S$2,000
Accident medical reimbursement
Accident medical reimbursement Up to S$2,000 per accident
S$50,000
Additional accidental death benefit
Additional accidental death benefit S$50,000
S$1,200
Fracture of arm
Fracture of arm S$1,200
S$1,500
Fracture of leg
Fracture of leg S$1,500
```
Citations: accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; groupLife (SYNTHETIC-DPTEST-v11before1-GroupTermLife) p2; accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; disability (SYNTHETIC-DPTEST-v11before1-DisabilityCare) p2; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; groupLife (SYNTHETIC-DPTEST-v11before1-GroupTermLife) p2; accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: none  ·  22 ms

### Q07 — What does Charmaine's group life policy pay if she dies?

```
If that happened, these benefits could be relevant. This is a preliminary claim assessment: DearPolicy does not estimate what the insurer would pay until claim evidence has been reviewed. Each card says what is still needed.
This is a what-if. Nothing here has been recorded as a claim, and no facts from this question have been saved against anyone's profile.
The Coverage page shows where each of these came from in your documents, and whether it was verified.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-GroupTermLife — Death (any cause)
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accidental death
100% of an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-GroupTermLife — Additional accidental death benefit
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11before1-GroupTermLife Policy wording, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11before1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: groupLife (SYNTHETIC-DPTEST-v11before1-GroupTermLife) p2; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: none  ·  100 ms

### Q08 — What is Charmaine covered for if she dies in an accident?

```
If that happened, these benefits could be relevant. This is a preliminary claim assessment: DearPolicy does not estimate what the insurer would pay until claim evidence has been reviewed. Each card says what is still needed.
This is a what-if. Nothing here has been recorded as a claim, and no facts from this question have been saved against anyone's profile.
The Coverage page shows where each of these came from in your documents, and whether it was verified.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-GroupTermLife — Death (any cause)
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accidental death
100% of an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-GroupTermLife — Additional accidental death benefit
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11before1-GroupTermLife Policy wording, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11before1-AccidentGuard Policy wording, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: groupLife (SYNTHETIC-DPTEST-v11before1-GroupTermLife) p2; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: none  ·  94 ms

### Q09 — What is Charmaine's maternity coverage?

```
DearPolicy didn’t find maternity cover in the parts of Charmaine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
6 policy contracts still need wording, processing or further review. See the policy review list.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  50 ms

### Q10 — Does Charmaine have travel insurance?

```
Here is the travel and overseas cover in Charmaine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-JetSure — Overseas medical expenses (page 2)
SYNTHETIC-DPTEST-v11before1-JetSure — Trip cancellation (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-JetSure Benefit schedule, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
S$100,000
Overseas medical expenses
Overseas medical expenses S$100,000
S$3,000
Trip cancellation
Trip cancellation S$3,000
```
Citations: travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p2  ·  next question: none  ·  19 ms

### Q11 — Charmaine broke her arm.

```
I’m sorry Charmaine is dealing with this. A broken arm can involve several kinds of cover, so I need a few details before I check Charmaine’s policies.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
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
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: none  ·  next question: Was this caused by an accident, or an illness?  ·  51 ms

### Q12 — An accident.

```
I’m sorry Charmaine is dealing with this. A broken arm may relate to accident medical reimbursement, medical reimbursement, fracture or hospital cash benefits in Charmaine’s policies, depending on the answers. It is not the same as permanent loss of a limb, so I won’t count permanent-disability schedule amounts from the information available.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
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
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: none  ·  next question: Where did the accident happen?  ·  24 ms

### Q13.1 — 

```
Thanks, noted.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
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
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: none  ·  next question: When did it happen?  ·  27 ms

### Q13.2 — 

```
Thanks, noted.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
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
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: none  ·  next question: Was the fracture confirmed by a doctor or on an X-ray or scan?  ·  55 ms

### Q13.3 — 

```
Thanks, noted.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
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
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: none  ·  next question: What treatment was given?  ·  38 ms

### Q13.4 — 

```
Before I put figures on this, a few quick questions — 2 at most.
This may relate to accident medical reimbursement or fracture benefits, depending on the answers.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
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
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: none  ·  next question: Was surgery performed?  ·  91 ms

### Q13.5 — 

```
Before I put figures on this, one question.
This may relate to accident medical reimbursement or fracture benefits, depending on the answers.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
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
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: none  ·  next question: How much did the treatment cost?  ·  105 ms

### Q13.6 — 

```
This is a preliminary claim assessment: DearPolicy does not estimate what the insurer will pay until claim evidence has been reviewed. Each card says what is still needed.
The Coverage page shows where each of these came from in your documents, and whether it was verified.
Upload the latest premium receipt or renewal notice for Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-HospitalShield; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-DisabilityCare; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-JetSure so the active status can be verified. Ownership is already confirmed and is unaffected.
Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.
Gather: Police or accident report, if one was made.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of arm
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accident medical reimbursement
This plan pays the actual cost, up to an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11before1-AccidentGuard Policy wording, read when the document was uploaded Page 2
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
Has any other insurer or the employer already paid part of the bill? Reimbursement is coordinated so the same bill is not paid twice.
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: Has any other insurer or the employer already paid part of the bill?  ·  141 ms

### Q13.7 — 

```
This is a preliminary claim assessment: DearPolicy does not estimate what the insurer will pay until claim evidence has been reviewed. Each card says what is still needed.
The Coverage page shows where each of these came from in your documents, and whether it was verified.
Upload the latest premium receipt or renewal notice for Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-HospitalShield; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-DisabilityCare; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-JetSure so the active status can be verified. Ownership is already confirmed and is unaffected.
Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.
Gather: Police or accident report, if one was made.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of arm
an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accident medical reimbursement
This plan pays the actual cost, up to an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11before1-AccidentGuard Policy wording, read when the document was uploaded Page 2
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
Hospital Bill: not yet known
Other Insurance Paid: not sure
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Has a doctor said the injury will leave any lasting impairment? Only a lasting impairment can bring permanent-disability benefits into play.
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
```
Citations: accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: Has a doctor said the injury will leave any lasting impairment?  ·  189 ms

### Q13.8 — 

```
I found 3 benefits that can respond to what happened. This is a preliminary claim assessment: each still needs facts, documents and reviewed claim evidence before DearPolicy can give an indicative estimate.
Anything you upload is read automatically; the Benefits page shows what has been read from your documents.
Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.
Gather: Police or accident report, if one was made.
Upload the latest premium receipt or renewal notice for Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-HospitalShield; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-DisabilityCare; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-JetSure so the active status can be verified. Ownership is already confirmed and is unaffected.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Charmaine Tan Hui Min · Accident medical reimbursement
This benefit can respond to what happened, but the actual eligible amount for Accident medical reimbursement is still needed before an amount can be calculated.
Still needed: the actual eligible amount for Accident medical reimbursement
DearPolicy's reader could not be reached for this answer. This figure comes from your policy's own rule for this benefit and the facts you gave; it has not been double-checked against what happened.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · Fracture of arm
Fixed benefit in the quoted clause. Calculated from your policy schedule and the quoted clause on page 1. Paid under your SYNTHETIC-DPTEST-v11before1-AccidentGuard cover (policy SYNTHETIC-DPTEST-v11before1-ACCIDENT-001). DearPolicy has withheld the amount: A material fact or policy condition is still unresolved.
DearPolicy's reader could not be reached for this answer. This figure comes from your policy's own rule for this benefit and the facts you gave; it has not been double-checked against what happened.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
A material fact or policy condition is still unresolved.
Charmaine Tan Hui Min · Overseas medical expenses
Fixed benefit in the quoted clause. Calculated from your policy schedule and the quoted clause on page 2. Paid under your SYNTHETIC-DPTEST-v11before1-JetSure cover (policy SYNTHETIC-DPTEST-v11before1-TRAVELEXPIRED-001).
DearPolicy could not check whether this benefit responds to what happened, so no amount is shown for it.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11before1-AccidentGuard Policy wording, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11before1-AccidentGuard Verified personal cover Page 1
SYNTHETIC-DPTEST-v11before1-AccidentGuard Policy wording, read when the document was uploaded Page 1
SYNTHETIC-DPTEST-v11before1-JetSure Policy wording, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11before1-JetSure Verified personal cover Page 1
Charmaine Tan Hui Min
Injured: yes
Surgery: no
Injuries: b
```
Citations: accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p1  ·  next question: none  ·  220 ms

### Q14 — (the final response once the interview has no question left)

```
I found 3 benefits that can respond to what happened. This is a preliminary claim assessment: each still needs facts, documents and reviewed claim evidence before DearPolicy can give an indicative estimate.
Anything you upload is read automatically; the Benefits page shows what has been read from your documents.
Download the claim pack from the Claims page — one sheet with the relevant benefits, the pages they came from, and what to attach.
Gather: Police or accident report, if one was made.
Upload the latest premium receipt or renewal notice for Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-HospitalShield; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-DisabilityCare; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-JetSure so the active status can be verified. Ownership is already confirmed and is unaffected.
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
Charmaine Tan Hui Min · Accident medical reimbursement
This benefit can respond to what happened, but the actual eligible amount for Accident medical reimbursement is still needed before an amount can be calculated.
Still needed: the actual eligible amount for Accident medical reimbursement
DearPolicy's reader could not be reached for this answer. This figure comes from your policy's own rule for this benefit and the facts you gave; it has not been double-checked against what happened.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · Fracture of arm
Fixed benefit in the quoted clause. Calculated from your policy schedule and the quoted clause on page 1. Paid under your SYNTHETIC-DPTEST-v11before1-AccidentGuard cover (policy SYNTHETIC-DPTEST-v11before1-ACCIDENT-001). DearPolicy has withheld the amount: A material fact or policy condition is still unresolved.
DearPolicy's reader could not be reached for this answer. This figure comes from your policy's own rule for this benefit and the facts you gave; it has not been double-checked against what happened.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
A material fact or policy condition is still unresolved.
Charmaine Tan Hui Min · Overseas medical expenses
Fixed benefit in the quoted clause. Calculated from your policy schedule and the quoted clause on page 2. Paid under your SYNTHETIC-DPTEST-v11before1-JetSure cover (policy SYNTHETIC-DPTEST-v11before1-TRAVELEXPIRED-001).
DearPolicy could not check whether this benefit responds to what happened, so no amount is shown for it.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
SYNTHETIC-DPTEST-v11before1-AccidentGuard Policy wording, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11before1-AccidentGuard Verified personal cover Page 1
SYNTHETIC-DPTEST-v11before1-AccidentGuard Policy wording, read when the document was uploaded Page 1
SYNTHETIC-DPTEST-v11before1-JetSure Policy wording, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11before1-JetSure Verified personal cover Page 1
Charmaine Tan Hui Min
Injured: yes
Surgery: no
Injuries: b
```
Citations: accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p1  ·  next question: none  ·  220 ms

### Q15 — Which of her policies could pay for the broken arm?

```
Here is the fracture cover in Charmaine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of arm (page 1)
SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of leg (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-AccidentGuard Benefit schedule, read when the document was uploaded Page 1
SYNTHETIC-DPTEST-v11before1-AccidentGuard Benefit schedule, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Injured: yes
Surgery: no
Injuries: broke her arm
Event Date: 2026-09-20
Out Of Pocket: not yet known
Hospital Bill: not yet known
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Other Insurance Paid: not sure
Permanent Impairment: no
Injury
Charmaine Tan Hui Min
Doctor's report (or X-ray or scan report) describing the injury
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
S$1,200
Fracture of arm
Fracture of arm S$1,200
S$1,500
Fracture of leg
Fracture of leg S$1,500
```
Citations: accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; accidentEndorsement (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: none  ·  18 ms

### Q16 — How much can she claim?

```
DearPolicy didn’t find How much can she claim in the parts of Charmaine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
6 policy contracts still need wording, processing or further review. See the policy review list.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
Charmaine Tan Hui Min
Injured: yes
Surgery: no
Injuries: broke her arm
Event Date: 2026-09-20
Out Of Pocket: not yet known
Hospital Bill: not yet known
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Other Insurance Paid: not sure
Permanent Impairment: no
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  62 ms

### Q17 — (reopen c-injury from history)

```
DearPolicy didn’t find How much can she claim in the parts of Charmaine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
6 policy contracts still need wording, processing or further review. See the policy review list.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
Charmaine Tan Hui Min
Injured: yes
Surgery: no
Injuries: broke her arm
Event Date: 2026-09-20
Out Of Pocket: not yet known
Hospital Bill: not yet known
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Other Insurance Paid: not sure
Permanent Impairment: no
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-HospitalShield
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-JetSure
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-CritiCare
Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  133 ms

### Q18 — What does Marcus's travel policy cover overseas?

```
Here is the travel and overseas cover in your policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-WanderSafe — Baggage delay (page 2)
SYNTHETIC-DPTEST-v11before1-WanderSafe — Emergency medical evacuation (page 2)
SYNTHETIC-DPTEST-v11before1-WanderSafe — Overseas medical expenses (page 2)
SYNTHETIC-DPTEST-v11before1-WanderSafe — Trip cancellation (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-WanderSafe Benefit schedule, read when the document was uploaded Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-FutureSaver
US$500,000
Emergency medical evacuation
Emergency medical evacuation USD 500,000
US$250,000
Overseas medical expenses
Overseas medical expenses US$250,000
S$5,000
Trip cancellation
Trip cancellation S$5,000
```
Citations: travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2  ·  next question: none  ·  28 ms

### Q19 — What is the baggage delay benefit on Marcus's travel policy?

```
Here is the travel and overseas cover in your policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-WanderSafe — Baggage delay (page 2)
SYNTHETIC-DPTEST-v11before1-WanderSafe — Emergency medical evacuation (page 2)
SYNTHETIC-DPTEST-v11before1-WanderSafe — Overseas medical expenses (page 2)
SYNTHETIC-DPTEST-v11before1-WanderSafe — Trip cancellation (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-WanderSafe Benefit schedule, read when the document was uploaded Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-FutureSaver
US$500,000
Emergency medical evacuation
Emergency medical evacuation USD 500,000
US$250,000
Overseas medical expenses
Overseas medical expenses US$250,000
S$5,000
Trip cancellation
Trip cancellation S$5,000
```
Citations: travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2  ·  next question: none  ·  25 ms

### Q20 — How much hospital cash does Marcus get per day?

```
The uploaded passages support the policy details below.
Marcus Lim Wei Jie · SYNTHETIC-DPTEST-v11before1-DailyCash: Schedule of Benefits - Hospital Income Hospital cash 150 per day, maximum 60 days Intensive care cash 300 per day, maximum 10 days
6 policy contracts still need wording, processing or further review. See the policy review list.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-DailyCash Personal document Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-FutureSaver
Partial review: 11 of 19 processed pages across 6 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: hospitalCashNoCurrency (SYNTHETIC-DPTEST-v11before1-DailyCash) p2  ·  next question: none  ·  51 ms

### Q21 — What is Marcus's death benefit on his TermGuard policy?

```
Here is the death cover in your policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M — Accidental death (page 2)
SYNTHETIC-DPTEST-v11before1-TermGuard — Death benefit (page 2)
SYNTHETIC-DPTEST-v11before1-FutureSaver — Death benefit (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M Benefit schedule, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11before1-TermGuard Benefit schedule, read when the document was uploaded Page 2
SYNTHETIC-DPTEST-v11before1-FutureSaver Benefit schedule, read when the document was uploaded Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-FutureSaver
US$350,000
Death benefit
Death benefit US$350,000
```
Citations: accidentMarcus (SYNTHETIC-DPTEST-v11before1-AccidentGuard-M) p2; termContradictory (SYNTHETIC-DPTEST-v11before1-TermGuard) p2; endowment (SYNTHETIC-DPTEST-v11before1-FutureSaver) p2; termContradictory (SYNTHETIC-DPTEST-v11before1-TermGuard) p2  ·  next question: none  ·  13 ms

### Q22 — Is Marcus covered for dental treatment?

```
DearPolicy didn’t find dental cover in the parts of your policies read so far (11 of 19 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
6 policy contracts still need wording, processing or further review. See the policy review list.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-FutureSaver
Partial review: 11 of 19 processed pages across 6 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  41 ms

### Q23 — What happens when Marcus's endowment plan matures?

```
Here is the maturity and surrender value in your policies, from the benefit schedule on file, each with the page it is on.
SYNTHETIC-DPTEST-v11before1-FutureSaver — Guaranteed maturity benefit (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-FutureSaver Benefit schedule, read when the document was uploaded Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-FutureSaver
```
Citations: endowment (SYNTHETIC-DPTEST-v11before1-FutureSaver) p2  ·  next question: none  ·  21 ms

### Q24 — Does Marcus have a fracture benefit?

```
Here is the fracture cover in your policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M — Fracture of arm (page 2)
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M — Fracture of leg (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M Benefit schedule, read when the document was uploaded Page 2
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-FutureSaver
S$500.00
Fracture of arm
Fracture of arm S$500
S$750.00
Fracture of leg
Fracture of leg S$750
```
Citations: accidentMarcus (SYNTHETIC-DPTEST-v11before1-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11before1-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11before1-AccidentGuard-M) p2  ·  next question: none  ·  13 ms

### Q25 — Does Marcus have car insurance?

```
You have no motor policy on file, so there is nothing in your documents to answer this from. The policies on file are: SYNTHETIC-DPTEST-v11before1-AccidentGuard-M, SYNTHETIC-DPTEST-v11before1-DailyCash, SYNTHETIC-DPTEST-v11before1-HealthPlusRider. If there is a motor policy, upload it and ask again.
6 policy contracts still need wording, processing or further review. See the policy review list.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-AccidentGuard-M
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-FutureSaver
Partial review: 11 of 19 processed pages across 6 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  33 ms

### Q27 — What happens when Marcus's endowment plan matures?

```
I couldn’t read your message just now: DearPolicy’s reading service is busy right now; it usually clears in under a minute. Your message is saved.
Send the message again — a retry usually succeeds.
If it fails twice, split it into two shorter messages and DearPolicy will keep the facts from both.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: none  ·  2015 ms

### Q28 — Does Charmaine have a fracture benefit?

```
Here is the fracture cover in your policy, from the benefit schedule on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.
SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA — Fracture of arm (page 2)
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA Benefit schedule, read when the document was uploaded Page 2
Charmaine Tan Hui Min
Charmaine Tan Hui Min
SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA
S$3,500
Fracture of arm
Fracture of arm S$3,500
```
Citations: otherHouseholdAccident (SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA) p2; otherHouseholdAccident (SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA) p2  ·  next question: none  ·  11 ms

### Q26 — Does Marcus have a fracture benefit?

```
DearPolicy didn’t find fracture cover in the parts of your policies read so far (10 of 15 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.
5 policy contracts still need wording, processing or further review. See the policy review list.
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
Marcus Lim Wei Jie
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-DailyCash
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-HealthPlusRider
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-WanderSafe
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-TermGuard
Marcus Lim Wei Jie
SYNTHETIC-DPTEST-v11before1-FutureSaver
Partial review: 10 of 15 processed pages across 5 documents in 5 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.
```
Citations: none  ·  next question: none  ·  28 ms


## Ingestion (terminal state + linking)

| Doc | Status | Stage | Links | Benefits | Pages | ms | Error |
|---|---|---|---|---|---|---|---|
| hosp2022 | ready | complete | Charmaine:ai_name_match | 2 | 3 | 3048 |  |
| hosp2025 | ready | complete | Charmaine:ai_name_match | 4 | 4 | 380 |  |
| accident | ready | complete | Charmaine:ai_name_match | 4 | 4 | 180 |  |
| accidentEndorsement | ready | complete | Charmaine:ai_name_match | 1 | 2 | 114 |  |
| disability | ready | complete | Charmaine:ai_name_match | 3 | 3 | 129 |  |
| groupLife | ready | complete | Charmaine:ai_name_match | 2 | 3 | 128 |  |
| criticalIllness | ready | complete | Charmaine:ai_name_match | 2 | 4 | 126 |  |
| travelExpired | ready | complete | Charmaine:ai_name_match | 2 | 3 | 180 |  |
| travel | ready | complete | Marcus:ai_name_match | 4 | 3 | 179 |  |
| accidentMarcus | ready | complete | Marcus:ai_name_match | 4 | 4 | 139 |  |
| endowment | ready | complete | Marcus:ai_name_match | 2 | 3 | 105 |  |
| hospitalCashNoCurrency | ready | complete | Marcus:ai_name_match | 0 | 3 | 114 |  |
| termContradictory | ready | complete | Marcus:ai_name_match | 1 | 3 | 102 |  |
| maliciousRider | ready | complete | Marcus:ai_name_match | 1 | 3 | 118 |  |
| unreadable | failed | failed |  | 0 | 0 | 14 | Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again. |
| scannedPage | ready | complete |  | 0 | 1 | 804 |  |
| otherHouseholdAccident | ready | complete | Charmaine:ai_name_match | 2 | 3 | 160 |  |

Evidence provenance columns present: policy_coverages.source_text_end, policy_benefits.source_text_start, policy_benefits.source_text_end, policies.document_date, policy_benefits.passage_verified, policy_coverages.source_text_start, coverage_rules.source_text_start, coverage_rules.source_text_end, policy_coverages.passage_verified, coverage_rules.passage_verified, policy_benefits.conflict_note, policy_coverages.extraction_method, policy_coverages.conflict_note, coverage_rules.extraction_method, coverage_rules.conflict_note, policy_benefits.extraction_method

## Model usage (model_executions, this run)

| Operation | Provider | Model | Status | Calls | In | Out | Cost USD |
|---|---|---|---|---|---|---|---|
| benefit_extraction | gemini | flash-lite | failed | 106 | 0 | 0 | 0 |
| catalog_building | gemini | flash-lite | failed | 53 | 0 | 0 | 0 |
| condition_catalog_extraction | gemini | flash-lite | failed | 49 | 0 | 0 | 0 |
| hosted_ocr | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 1 | 31 | 116 | 0 |
| policy_extraction | gemini | dearpolicy-deterministic-e2e-v1 | succeeded | 15 | 8364 | 3652 | 0 |

Provider calls attempted during the quota case: 1
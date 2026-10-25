# V1.1 evaluation — browser journey (e2e/tests/v11-journey.spec.ts)

## Release gates

| Gate | Result | Violations |
|---|---|---|
| unsupported_amount | PASS | 0 |
| unsupported_assertion | **FAIL** | 3 |
| cross_scope | PASS | 0 |
| deleted_superseded | PASS | 0 |
| blocked_gap | **FAIL** | 2 |
| positive_control | **FAIL** | 7 |
| internal_text | **FAIL** | 13 |
| fact_finding | PASS | 0 |

## Timing (ms)

| Group | n | p50 | p95 |
|---|---|---|---|
| factual | 13 | 2139 | 7870 |
| interview | 13 | 2538 | 3919 |
| all | 33 | 2330 | 4178 |

## Per question

| Q | Question | Result | Gates failed | ms |
|---|---|---|---|---|
| Q01 | What policies does Josephine have? | pass |  | 7870 |
| Q02 | What is Josephine's hospital room and board benefit? | FAIL | positive_control | 2377 |
| Q03 | Does Josephine have a fracture benefit? | pass |  | 2081 |
| Q04 | What is the waiting period for critical illness on Josephine's CritiCare plan? | FAIL | internal_text | 2330 |
| Q05 | Does Josephine's hospital plan cover dental treatment? | FAIL | positive_control | 1068 |
| Q06 | If Josephine had both a fracture and a permanent disablement from one accident, would both be paid? | FAIL | positive_control | 1353 |
| Q07 | What does Josephine's group life policy pay if she dies? | FAIL | internal_text, positive_control | 2352 |
| Q08 | What is Josephine covered for if she dies in an accident? | FAIL | internal_text | 3211 |
| Q09 | What is Josephine's maternity coverage? | FAIL | internal_text | 1899 |
| Q10 | Does Josephine have travel insurance? | FAIL | unsupported_assertion | 1822 |
| Q11 | Josephine broke her arm. | pass |  | 2391 |
| Q12 | An accident. | pass |  | 1718 |
| Q13 | claim interview (8 answers): When did it happen? → Was the fracture confirmed by a doctor or on an X-ray or scan? → What treatment was given? → Was surgery performed? → How much did the treatment cost? → Has any other insurer or the employer already paid part of the bill? → Has a doctor said the injury will leave any lasting impairment? | FAIL | internal_text | 20542 |
| Q14 | (the final response once the interview has no question left) | FAIL | internal_text, unsupported_assertion | 3919 |
| Q15 | Which of her policies could pay for the broken arm? | pass |  | 3071 |
| Q16 | How much can she claim? | FAIL | internal_text, blocked_gap | 3385 |
| Q17 | (reopen c-injury from history) | pass |  | 7590 |
| Q18 | What does Marcus's travel policy cover overseas? | pass |  | 2132 |
| Q19 | What is the baggage delay benefit on Marcus's travel policy? | FAIL | positive_control | 1755 |
| Q20 | How much hospital cash does Marcus get per day? | FAIL | internal_text | 2976 |
| Q21 | What is Marcus's death benefit on his TermGuard policy? | FAIL | unsupported_assertion, blocked_gap | 2040 |
| Q22 | Is Marcus covered for dental treatment? | FAIL | internal_text | 2281 |
| Q23 | What happens when Marcus's endowment plan matures? | FAIL | positive_control | 2139 |
| Q24 | Does Marcus have a fracture benefit? | pass |  | 1202 |
| Q25 | Does Marcus have car insurance? | FAIL | internal_text | 1456 |
| Q26 | Does Marcus have a fracture benefit? | FAIL | internal_text | 4178 |
| Q28 | Does Josephine have a fracture benefit? | pass |  | 2954 |

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
- **Q19** [positive_control] missing: S$200 for every 6 hours
- **Q20** [internal_text] rule/row/page counts: "11 of 19 processed pages"
- **Q21** [unsupported_assertion] chose 350,000 although the document also states 300,000
- **Q21** [blocked_gap] the answer does not explain what could not be verified
- **Q22** [internal_text] rule/row/page counts: "11 of 19 pages"
- **Q23** [positive_control] missing: S$50,000 guaranteed maturity benefit
- **Q23** [positive_control] missing: maturity date 2040-06-01
- **Q25** [internal_text] rule/row/page counts: "11 of 19 processed pages"
- **Q26** [internal_text] rule/row/page counts: "10 of 15 pages"

## Quality notes (not release gates)

- Q10 [expected_assertion_missing] missing: says it expired / gives its date
- Q27 [not_run] no answer recorded for this question

## Answers (visible text)

### Q01 — What policies does Josephine have?

```
DearPolicy

I found 6 personal policy contracts across 1 family profile. The table separates confirmed cover from records that still need review.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Personal policy inventory
Family member	Policy	Confirmed cover	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	
SYNTHETIC-DPTEST-v11before1-AccidentGuard
SYNTHETIC-DPTEST-v11before1-AccidentGuard · S$100,000
	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	
SYNTHETIC-DPTEST-v11before1-GroupTermLife
	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	
SYNTHETIC-DPTEST-v11before1-DisabilityCare · S$200,000
	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	
SYNTHETIC-DPTEST-v11before1-CritiCare · S$120,000
	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	
SYNTHETIC-DPTEST-v11before1-JetSure
	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	
SYNTHETIC-DPTEST-v11before1-HospitalShield
	Active status not recently verified

Schedules, amendments and supporting documents are grouped by insured person, insurer and policy number where available. An insured amount is a coverage amount, not a universal claim payout.

6 contracts show ownership but no recent payment or renewal evidence, so the active status is not recently verified. Ownership is unchanged.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHAT TO DO NEXT
Upload the latest premium receipt or renewal notice for Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard; Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-GroupTermLife; Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-DisabilityCare; Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-CritiCare so current status can be verified separately from ownership.
WHY DEARPOLICY SAYS THIS · 7 SOURCES
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11before1-AccidentGuard
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11before1-GroupTermLife
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11before1-DisabilityCare
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11before1-CritiCare
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11before1-JetSure
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11before1-HospitalShield
Verified personal cover
Page 1
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; groupLife (SYNTHETIC-DPTEST-v11before1-GroupTermLife) p1; disability (SYNTHETIC-DPTEST-v11before1-DisabilityCare) p1; criticalIllness (SYNTHETIC-DPTEST-v11before1-CritiCare) p1; travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p1; hosp2025 (SYNTHETIC-DPTEST-v11before1-HospitalShield) p1  ·  next question: none  ·  7870 ms

### Q02 — What is Josephine's hospital room and board benefit?

```
DearPolicy

Here is the hospital cover in Josephine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Policy-stated coverage limitS$25,000Josephine Tan Hui Min · Surgical fees

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-HospitalShield, page 2: “Surgical fees Up to S$25,000 per surgery”

SYNTHETIC-DPTEST-v11before1-HospitalShield — Daily room and board (page 2)

SYNTHETIC-DPTEST-v11before1-HospitalShield — Hospital cash (page 2)

SYNTHETIC-DPTEST-v11before1-HospitalShield — Intensive care unit (page 2)

SYNTHETIC-DPTEST-v11before1-HospitalShield — Surgical fees (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 1 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-HospitalShield
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: hosp2025 (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-HospitalShield) p2; hosp2025 (SYNTHETIC-DPTEST-v11before1-HospitalShield) p2  ·  next question: none  ·  2377 ms

### Q03 — Does Josephine have a fracture benefit?

```
DearPolicy

Here is the fracture cover in Josephine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Policy-stated coverage limitS$1,200Josephine Tan Hui Min · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-AccidentGuard, page 1: “Fracture of arm S$1,200”
Policy-stated coverage limitS$1,500Josephine Tan Hui Min · Fracture of leg

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-AccidentGuard, page 2: “Fracture of leg S$1,500”

SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of arm (page 1)

SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of leg (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 2 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard
Benefit schedule, read when the document was uploaded
Page 1
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: none  ·  2081 ms

### Q04 — What is the waiting period for critical illness on Josephine's CritiCare plan?

```
DearPolicy

The uploaded passages support the policy details below.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min

Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-CritiCare: General Conditions Waiting period: 90 days from the effective date for any critical illness.

Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-CritiCare: Schedule of Benefits - Critical Illness Critical illness benefit 100% of Sum Insured Early stage critical illness 25% of Sum Insured

Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-HospitalShield: General Conditions Waiting period: no benefit is payable for any illness that starts within 30 days of the effective date.

6 policy contracts still need wording, processing or further review. See the policy review list.

PARTIAL POLICY REVIEW

Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	No matching wording uploaded · 3/6 pages · 3/6 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	No matching wording uploaded · 3/4 pages · 3/4 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	No matching wording uploaded · 3/4 pages · 3/4 passages	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 3 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-CritiCare
Personal document
Page 3
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-CritiCare
Personal document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-HospitalShield
Personal document
Page 3
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: criticalIllness (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-CritiCare) p3; criticalIllness (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-CritiCare) p2; hosp2025 (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-HospitalShield) p3  ·  next question: none  ·  2330 ms

### Q05 — Does Josephine's hospital plan cover dental treatment?

```
DearPolicy

Here is the hospital cover and dental cover in Josephine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Policy-stated coverage limitS$25,000Josephine Tan Hui Min · Surgical fees

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-HospitalShield, page 2: “Surgical fees Up to S$25,000 per surgery”

SYNTHETIC-DPTEST-v11before1-HospitalShield — Daily room and board (page 2)

SYNTHETIC-DPTEST-v11before1-HospitalShield — Hospital cash (page 2)

SYNTHETIC-DPTEST-v11before1-HospitalShield — Intensive care unit (page 2)

SYNTHETIC-DPTEST-v11before1-HospitalShield — Surgical fees (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 1 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-HospitalShield
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: hosp2025 (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-HospitalShield) p2; hosp2025 (SYNTHETIC-DPTEST-v11before1-HospitalShield) p2  ·  next question: none  ·  1068 ms

### Q06 — If Josephine had both a fracture and a permanent disablement from one accident, would both be paid?

```
DearPolicy

Here is the fracture cover and disability cover and accident cover in Josephine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Policy-stated coverage limitS$2,000Josephine Tan Hui Min · Accident medical reimbursement

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-AccidentGuard, page 2: “Accident medical reimbursement Up to S$2,000 per accident”
Policy-stated coverage limitS$50,000Josephine Tan Hui Min · Additional accidental death benefit

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-GroupTermLife, page 2: “Additional accidental death benefit S$50,000”
Policy-stated coverage limitS$1,200Josephine Tan Hui Min · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-AccidentGuard, page 1: “Fracture of arm S$1,200”
Policy-stated coverage limitS$1,500Josephine Tan Hui Min · Fracture of leg

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-AccidentGuard, page 2: “Fracture of leg S$1,500”

SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accident medical reimbursement (page 2)

SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accidental death (page 2)

SYNTHETIC-DPTEST-v11before1-GroupTermLife — Additional accidental death benefit (page 2)

SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of arm (page 1)

SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of leg (page 2)

SYNTHETIC-DPTEST-v11before1-DisabilityCare — Loss of arm at or above the elbow (page 2)

SYNTHETIC-DPTEST-v11before1-DisabilityCare — Loss of hand at or above the wrist (page 2)

SYNTHETIC-DPTEST-v11before1-DisabilityCare — Permanent total disablement (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 4 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard
Benefit schedule, read when the document was uploaded
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-GroupTermLife
Benefit schedule, read when the document was uploaded
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard
Benefit schedule, read when the document was uploaded
Page 1
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-DisabilityCare
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; groupLife (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-GroupTermLife) p2; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; disability (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-DisabilityCare) p2; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; groupLife (SYNTHETIC-DPTEST-v11before1-GroupTermLife) p2; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: none  ·  1353 ms

### Q07 — What does Josephine's group life policy pay if she dies?

```
DearPolicy

If that happened, these benefits could be relevant. This is a preliminary claim assessment: DearPolicy does not estimate what the insurer would pay until claim evidence has been reviewed. Each card says what is still needed.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-GroupTermLife — Death (any cause)
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accidental death
LIKELY APPLICABLE
Policy condition unresolved

100% of an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-GroupTermLife — Additional accidental death benefit
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.

This is a what-if. Nothing here has been recorded as a claim, and no facts from this question have been saved against anyone's profile.

The Coverage page shows where each of these came from in your documents, and whether it was verified.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 2 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-GroupTermLife
Policy wording, read when the document was uploaded
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v1
```
Citations: groupLife (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-GroupTermLife) p2; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: none  ·  2352 ms

### Q08 — What is Josephine covered for if she dies in an accident?

```
DearPolicy

If that happened, these benefits could be relevant. This is a preliminary claim assessment: DearPolicy does not estimate what the insurer would pay until claim evidence has been reviewed. Each card says what is still needed.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-GroupTermLife — Death (any cause)
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accidental death
LIKELY APPLICABLE
Policy condition unresolved

100% of an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-GroupTermLife — Additional accidental death benefit
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.

This is a what-if. Nothing here has been recorded as a claim, and no facts from this question have been saved against anyone's profile.

The Coverage page shows where each of these came from in your documents, and whether it was verified.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 2 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-GroupTermLife
Policy wording, read when the document was uploaded
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v1
```
Citations: groupLife (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-GroupTermLife) p2; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: none  ·  3211 ms

### Q09 — What is Josephine's maternity coverage?

```
DearPolicy

DearPolicy didn’t find maternity cover in the parts of Josephine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min

6 policy contracts still need wording, processing or further review. See the policy review list.

PARTIAL POLICY REVIEW

Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	No matching wording uploaded · 3/6 pages · 3/6 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	No matching wording uploaded · 3/4 pages · 3/4 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	No matching wording uploaded · 3/4 pages · 3/4 passages	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: none  ·  1899 ms

### Q10 — Does Josephine have travel insurance?

```
DearPolicy

Here is the travel and overseas cover in Josephine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Policy-stated coverage limitS$100,000Josephine Tan Hui Min · Overseas medical expenses

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-JetSure, page 2: “Overseas medical expenses S$100,000”
Policy-stated coverage limitS$3,000Josephine Tan Hui Min · Trip cancellation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-JetSure, page 2: “Trip cancellation S$3,000”

SYNTHETIC-DPTEST-v11before1-JetSure — Overseas medical expenses (page 2)

SYNTHETIC-DPTEST-v11before1-JetSure — Trip cancellation (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 1 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-JetSure
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11before1-JetSure) p2  ·  next question: none  ·  1822 ms

### Q11 — Josephine broke her arm.

```
DearPolicy

I’m sorry Josephine is dealing with this. A broken arm can involve several kinds of cover, so I need a few details before I check Josephine’s policies.

A FACT THAT CHANGES THIS ASSESSMENT
Was this caused by an accident, or an illness?
Some of these benefits only pay for accidents, so this decides which ones apply.
An accident
An illness
Not sure
Show full assessment
What DearPolicy still needs
Josephine Tan Hui Min · Injury Information needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Injured: yes
Fracture: arm
Injuries: broke her arm
Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: Was this caused by an accident, or an illness?  ·  2391 ms

### Q12 — An accident.

```
DearPolicy

I’m sorry Josephine is dealing with this. A broken arm may relate to accident medical reimbursement, medical reimbursement, fracture or hospital cash benefits in Josephine’s policies, depending on the answers. It is not the same as permanent loss of a limb, so I won’t count permanent-disability schedule amounts from the information available.

A FACT THAT CHANGES THIS ASSESSMENT
Where did the accident happen?
Some benefits apply only in certain places, and treatment overseas usually needs extra documents.
Singapore
Overseas
Not sure
Show full assessment
What DearPolicy still needs
Josephine Tan Hui Min · Injury Information needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Injured: yes
Injuries: broke her arm
Fracture: arm
Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: Where did the accident happen?  ·  1718 ms

### Q13.1 — 

```
DearPolicy

Thanks, noted.

A FACT THAT CHANGES THIS ASSESSMENT
When did it happen?
It decides which policy version applies and whether waiting periods or cover dates are met.
Not sure
Answer
Show full assessment
What DearPolicy still needs
Josephine Tan Hui Min · Injury Information needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Injured: yes
Injuries: broke her arm
Fracture: arm
Event Location: Singapore
Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: When did it happen?  ·  1956 ms

### Q13.2 — 

```
DearPolicy

Thanks, noted.

A FACT THAT CHANGES THIS ASSESSMENT
Was the fracture confirmed by a doctor or on an X-ray or scan?
Fracture benefits usually need the break confirmed by a doctor or imaging.
Yes
No
Not sure
Show full assessment
What DearPolicy still needs
Josephine Tan Hui Min · Injury Information needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Location: Singapore
Fracture: arm
Event Date: 2026-09-20
Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: Was the fracture confirmed by a doctor or on an X-ray or scan?  ·  2157 ms

### Q13.3 — 

```
DearPolicy

Thanks, noted.

A FACT THAT CHANGES THIS ASSESSMENT
What treatment was given?
Emergency, inpatient and outpatient treatment are paid under different benefits.
Emergency department
Admitted to hospital
Outpatient or clinic
Not sure
Show full assessment
What DearPolicy still needs
Josephine Tan Hui Min · Injury Information needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Date: 2026-09-20
Event Location: Singapore
Fracture: arm
Fracture Confirmed: yes
Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: What treatment was given?  ·  897 ms

### Q13.4 — 

```
DearPolicy

Before I put figures on this, a few quick questions — 2 at most.

A FACT THAT CHANGES THIS ASSESSMENT
Was surgery performed?
Surgical benefits pay only when an operation took place.
Yes
No
Not sure
Show full assessment
What DearPolicy still needs
Josephine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Date: 2026-09-20
Event Location: Singapore
Fracture: arm
Fracture Confirmed: yes
Treatment Type: Emergency department
Hospitalised: no

This may relate to accident medical reimbursement or fracture benefits, depending on the answers.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: Was surgery performed?  ·  3407 ms

### Q13.5 — 

```
DearPolicy

Before I put figures on this, one question.

A FACT THAT CHANGES THIS ASSESSMENT
How much did the treatment cost?
It is reimbursed up to the policy's limit.
Not sure
Answer
Show full assessment
What DearPolicy still needs
Josephine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
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

This may relate to accident medical reimbursement or fracture benefits, depending on the answers.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: How much did the treatment cost?  ·  2502 ms

### Q13.6 — 

```
DearPolicy

This is a preliminary claim assessment: DearPolicy does not estimate what the insurer will pay until claim evidence has been reviewed. Each card says what is still needed.

JOSEPHINE TAN HUI MIN · INJURY
Has any other insurer or the employer already paid part of the bill?
Reimbursement is coordinated so the same bill is not paid twice.
Yes
No
Not sure
Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
Show full assessment
What DearPolicy still needs
Josephine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
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
WHAT DEARPOLICY IS CHECKING AGAINST
These guide which policy wording is matched; the wording and your evidence decide what you can actually claim.
Reported fracture: arm · bodily injury
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of arm
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accident medical reimbursement
NEEDS CHECKING
Information needed

This plan pays the actual cost, up to an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.

3 conditions
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Download the claim pack (PDF)

The Coverage page shows where each of these came from in your documents, and whether it was verified.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHAT TO DO NEXT
Upload the latest premium receipt or renewal notice for Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard; Josephine Tan Hui Min · SYNTHETIC-DPTEST
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: Has any other insurer or the employer already paid part of the bill?  ·  2538 ms

### Q13.7 — 

```
DearPolicy

This is a preliminary claim assessment: DearPolicy does not estimate what the insurer will pay until claim evidence has been reviewed. Each card says what is still needed.

JOSEPHINE TAN HUI MIN · INJURY
Has a doctor said the injury will leave any lasting impairment?
Only a lasting impairment can bring permanent-disability benefits into play.
Yes
No
Not sure
Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
Show full assessment
What DearPolicy still needs
Josephine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
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
Hospital Bill: not yet known
Other Insurance Paid: not sure
WHAT DEARPOLICY IS CHECKING AGAINST
These guide which policy wording is matched; the wording and your evidence decide what you can actually claim.
Reported fracture: arm · bodily injury
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of arm
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · SYNTHETIC-DPTEST-v11before1-AccidentGuard — Accident medical reimbursement
NEEDS CHECKING
Information needed

This plan pays the actual cost, up to an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.

3 conditions
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Download the claim pack (PDF)

The Coverage page shows where each of these came from in your documents, and whether it was verified.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHAT TO DO NEXT
Upload the latest premium receipt or renewal notice for Josephine Tan Hui Min · SYNTHETIC-DPTEST
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: Has a doctor said the injury will leave any lasting impairment?  ·  3166 ms

### Q13.8 — 

```
DearPolicy

I found 3 benefits that can respond to what happened. This is a preliminary claim assessment: each still needs facts, documents and reviewed claim evidence before DearPolicy can give an indicative estimate.

Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
What DearPolicy still needs
Josephine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
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
WHAT DEARPOLICY IS CHECKING AGAINST
These guide which policy wording is matched; the wording and your evidence decide what you can actually claim.
Reported fracture: arm · bodily injury
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Josephine Tan Hui Min · Accident medical reimbursement
POTENTIALLY APPLICABLE
Information needed

This benefit can respond to what happened, but the actual eligible amount for Accident medical reimbursement is still needed before an amount can be calculated.

3 conditions
Still needed: the actual eligible amount for Accident medical reimbursement
DearPolicy's reader could not be reached for this answer. This figure comes from your policy's own rule for this benefit and the facts you gave; it has not been double-checked against what happened.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · Fracture of arm
NEEDS CHECKING
Reviewer assessment needed

Fixed benefit in the quoted clause. Calculated from your policy schedule and the quoted clause on page 1. Paid under your SYNTHETIC-DPTEST-v11before1-AccidentGuard cover (policy SYNTHETIC-DPTEST-v11before1-ACCIDENT-001). DearPolicy has withheld the amount: A material fact or policy condition is still unresolved.

3 conditions
DearPolicy's reader could not be reached for this answer. This figure comes from your policy's own rule for this benefit and the facts you gave; it has not been double-checked against what happened.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
A material fact or policy condition is still unresolved.
Josephine Tan Hui Min · Overseas medical expenses
NEEDS CHECKING
Policy condition unresolved

Fixed benefit in the quoted clause. Calculated from your policy schedule and the quoted clause on page 2. Paid under your SYNTHETIC-DPTEST-v11before1-JetSure cover (policy SYNTHETIC-DPTEST-v11before1-TRAVELEXPIRED-001).

2 conditions
DearPolicy could not check whether this benefit responds to what happened, so no amount is shown for it.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Download the claim pack (PDF)

Anything you upload is read automatically; the Benefits page shows what has been read from your documents.

Policy review · 6 contracts
Family member	Policy	
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-JetSure) p2; travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-JetSure) p1  ·  next question: none  ·  3919 ms

### Q14 — (the final response once the interview has no question left)

```
DearPolicy

I found 3 benefits that can respond to what happened. This is a preliminary claim assessment: each still needs facts, documents and reviewed claim evidence before DearPolicy can give an indicative estimate.

Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
What DearPolicy still needs
Josephine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
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
WHAT DEARPOLICY IS CHECKING AGAINST
These guide which policy wording is matched; the wording and your evidence decide what you can actually claim.
Reported fracture: arm · bodily injury
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Josephine Tan Hui Min · Accident medical reimbursement
POTENTIALLY APPLICABLE
Information needed

This benefit can respond to what happened, but the actual eligible amount for Accident medical reimbursement is still needed before an amount can be calculated.

3 conditions
Still needed: the actual eligible amount for Accident medical reimbursement
DearPolicy's reader could not be reached for this answer. This figure comes from your policy's own rule for this benefit and the facts you gave; it has not been double-checked against what happened.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Josephine Tan Hui Min · Fracture of arm
NEEDS CHECKING
Reviewer assessment needed

Fixed benefit in the quoted clause. Calculated from your policy schedule and the quoted clause on page 1. Paid under your SYNTHETIC-DPTEST-v11before1-AccidentGuard cover (policy SYNTHETIC-DPTEST-v11before1-ACCIDENT-001). DearPolicy has withheld the amount: A material fact or policy condition is still unresolved.

3 conditions
DearPolicy's reader could not be reached for this answer. This figure comes from your policy's own rule for this benefit and the facts you gave; it has not been double-checked against what happened.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
A material fact or policy condition is still unresolved.
Josephine Tan Hui Min · Overseas medical expenses
NEEDS CHECKING
Policy condition unresolved

Fixed benefit in the quoted clause. Calculated from your policy schedule and the quoted clause on page 2. Paid under your SYNTHETIC-DPTEST-v11before1-JetSure cover (policy SYNTHETIC-DPTEST-v11before1-TRAVELEXPIRED-001).

2 conditions
DearPolicy could not check whether this benefit responds to what happened, so no amount is shown for it.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Download the claim pack (PDF)

Anything you upload is read automatically; the Benefits page shows what has been read from your documents.

Policy review · 6 contracts
Family member	Policy	
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-JetSure) p2; travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-JetSure) p1  ·  next question: none  ·  3919 ms

### Q15 — Which of her policies could pay for the broken arm?

```
DearPolicy

Here is the fracture cover in Josephine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

What DearPolicy still needs
Josephine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
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
Policy-stated coverage limitS$1,200Josephine Tan Hui Min · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-AccidentGuard, page 1: “Fracture of arm S$1,200”
Policy-stated coverage limitS$1,500Josephine Tan Hui Min · Fracture of leg

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-AccidentGuard, page 2: “Fracture of leg S$1,500”

SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of arm (page 1)

SYNTHETIC-DPTEST-v11before1-AccidentGuard — Fracture of leg (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	Not measured	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 2 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard
Benefit schedule, read when the document was uploaded
Page 1
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11before1-AccidentGuard) p2  ·  next question: none  ·  3071 ms

### Q16 — How much can she claim?

```
DearPolicy

DearPolicy didn’t find How much can she claim in the parts of Josephine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
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
WHAT DEARPOLICY IS CHECKING AGAINST
These guide which policy wording is matched; the wording and your evidence decide what you can actually claim.
Reported fracture: arm · bodily injury

6 policy contracts still need wording, processing or further review. See the policy review list.

PARTIAL POLICY REVIEW

Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	No matching wording uploaded · 3/6 pages · 3/6 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	No matching wording uploaded · 3/4 pages · 3/4 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	No matching wording uploaded · 3/4 pages · 3/4 passages	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: none  ·  3385 ms

### Q17 — (reopen c-injury from history)

```
DearPolicy

DearPolicy didn’t find How much can she claim in the parts of Josephine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
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
WHAT DEARPOLICY IS CHECKING AGAINST
These guide which policy wording is matched; the wording and your evidence decide what you can actually claim.
Reported fracture: arm · bodily injury

6 policy contracts still need wording, processing or further review. See the policy review list.

PARTIAL POLICY REVIEW

Partial review: 13 of 23 processed pages across 7 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-AccidentGuard	Matching wording needed	No matching wording uploaded · 3/6 pages · 3/6 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-GroupTermLife	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-DisabilityCare	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-CritiCare	Matching wording needed	No matching wording uploaded · 3/4 pages · 3/4 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-JetSure	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-HospitalShield	Matching wording needed	No matching wording uploaded · 3/4 pages · 3/4 passages	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: none  ·  7590 ms

### Q18 — What does Marcus's travel policy cover overseas?

```
DearPolicy

Here is the travel and overseas cover in your policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitUS$500,000Marcus Lim Wei Jie · Emergency medical evacuation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-WanderSafe, page 2: “Emergency medical evacuation USD 500,000”
Policy-stated coverage limitUS$250,000Marcus Lim Wei Jie · Overseas medical expenses

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-WanderSafe, page 2: “Overseas medical expenses US$250,000”
Policy-stated coverage limitS$5,000Marcus Lim Wei Jie · Trip cancellation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-WanderSafe, page 2: “Trip cancellation S$5,000”

SYNTHETIC-DPTEST-v11before1-WanderSafe — Baggage delay (page 2)

SYNTHETIC-DPTEST-v11before1-WanderSafe — Emergency medical evacuation (page 2)

SYNTHETIC-DPTEST-v11before1-WanderSafe — Overseas medical expenses (page 2)

SYNTHETIC-DPTEST-v11before1-WanderSafe — Trip cancellation (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-FutureSaver	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-WanderSafe	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-DailyCash	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-HealthPlusRider	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-AccidentGuard-M	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-TermGuard	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 1 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-WanderSafe
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: travel (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2  ·  next question: none  ·  2132 ms

### Q19 — What is the baggage delay benefit on Marcus's travel policy?

```
DearPolicy

Here is the travel and overseas cover in your policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitUS$500,000Marcus Lim Wei Jie · Emergency medical evacuation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-WanderSafe, page 2: “Emergency medical evacuation USD 500,000”
Policy-stated coverage limitUS$250,000Marcus Lim Wei Jie · Overseas medical expenses

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-WanderSafe, page 2: “Overseas medical expenses US$250,000”
Policy-stated coverage limitS$5,000Marcus Lim Wei Jie · Trip cancellation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-WanderSafe, page 2: “Trip cancellation S$5,000”

SYNTHETIC-DPTEST-v11before1-WanderSafe — Baggage delay (page 2)

SYNTHETIC-DPTEST-v11before1-WanderSafe — Emergency medical evacuation (page 2)

SYNTHETIC-DPTEST-v11before1-WanderSafe — Overseas medical expenses (page 2)

SYNTHETIC-DPTEST-v11before1-WanderSafe — Trip cancellation (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-FutureSaver	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-WanderSafe	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-DailyCash	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-HealthPlusRider	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-AccidentGuard-M	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-TermGuard	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 1 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-WanderSafe
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: travel (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11before1-WanderSafe) p2  ·  next question: none  ·  1755 ms

### Q20 — How much hospital cash does Marcus get per day?

```
DearPolicy

The uploaded passages support the policy details below.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

Marcus Lim Wei Jie · SYNTHETIC-DPTEST-v11before1-DailyCash: Schedule of Benefits - Hospital Income Hospital cash 150 per day, maximum 60 days Intensive care cash 300 per day, maximum 10 days

6 policy contracts still need wording, processing or further review. See the policy review list.

PARTIAL POLICY REVIEW

Partial review: 11 of 19 processed pages across 6 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-FutureSaver	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-WanderSafe	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-DailyCash	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-HealthPlusRider	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-AccidentGuard-M	Matching wording needed	No matching wording uploaded · 2/4 pages · 2/4 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-TermGuard	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 1 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-DailyCash
Personal document
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: hospitalCashNoCurrency (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-DailyCash) p2  ·  next question: none  ·  2976 ms

### Q21 — What is Marcus's death benefit on his TermGuard policy?

```
DearPolicy

Here is the death cover in your policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitUS$350,000Marcus Lim Wei Jie · Death benefit

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-TermGuard, page 2: “Death benefit US$350,000”

SYNTHETIC-DPTEST-v11before1-AccidentGuard-M — Accidental death (page 2)

SYNTHETIC-DPTEST-v11before1-TermGuard — Death benefit (page 2)

SYNTHETIC-DPTEST-v11before1-FutureSaver — Death benefit (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-FutureSaver	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-WanderSafe	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-DailyCash	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-HealthPlusRider	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-AccidentGuard-M	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-TermGuard	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 3 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard-M
Benefit schedule, read when the document was uploaded
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-TermGuard
Benefit schedule, read when the document was uploaded
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-FutureSaver
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: accidentMarcus (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard-M) p2; termContradictory (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-TermGuard) p2; endowment (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-FutureSaver) p2; termContradictory (SYNTHETIC-DPTEST-v11before1-TermGuard) p2  ·  next question: none  ·  2040 ms

### Q22 — Is Marcus covered for dental treatment?

```
DearPolicy

DearPolicy didn’t find dental cover in the parts of your policies read so far (11 of 19 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

6 policy contracts still need wording, processing or further review. See the policy review list.

PARTIAL POLICY REVIEW

Partial review: 11 of 19 processed pages across 6 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-FutureSaver	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-WanderSafe	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-DailyCash	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-HealthPlusRider	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-AccidentGuard-M	Matching wording needed	No matching wording uploaded · 2/4 pages · 2/4 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-TermGuard	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: none  ·  2281 ms

### Q23 — What happens when Marcus's endowment plan matures?

```
DearPolicy

Here is the maturity and surrender value in your policies, from the benefit schedule on file, each with the page it is on.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

SYNTHETIC-DPTEST-v11before1-FutureSaver — Guaranteed maturity benefit (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-FutureSaver	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-WanderSafe	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-DailyCash	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-HealthPlusRider	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-AccidentGuard-M	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-TermGuard	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 1 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-FutureSaver
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: endowment (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-FutureSaver) p2  ·  next question: none  ·  2139 ms

### Q24 — Does Marcus have a fracture benefit?

```
DearPolicy

Here is the fracture cover in your policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitS$500.00Marcus Lim Wei Jie · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-AccidentGuard-M, page 2: “Fracture of arm S$500”
Policy-stated coverage limitS$750.00Marcus Lim Wei Jie · Fracture of leg

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-AccidentGuard-M, page 2: “Fracture of leg S$750”

SYNTHETIC-DPTEST-v11before1-AccidentGuard-M — Fracture of arm (page 2)

SYNTHETIC-DPTEST-v11before1-AccidentGuard-M — Fracture of leg (page 2)

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-FutureSaver	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-WanderSafe	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-DailyCash	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-HealthPlusRider	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-AccidentGuard-M	Matching wording needed	Not measured	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-TermGuard	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 1 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard-M
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: accidentMarcus (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11before1-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11before1-AccidentGuard-M) p2  ·  next question: none  ·  1202 ms

### Q25 — Does Marcus have car insurance?

```
DearPolicy

You have no motor policy on file, so there is nothing in your documents to answer this from. The policies on file are: SYNTHETIC-DPTEST-v11before1-FutureSaver, SYNTHETIC-DPTEST-v11before1-WanderSafe, SYNTHETIC-DPTEST-v11before1-DailyCash. If there is a motor policy, upload it and ask again.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

6 policy contracts still need wording, processing or further review. See the policy review list.

PARTIAL POLICY REVIEW

Partial review: 11 of 19 processed pages across 6 documents in 6 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.

Policy review · 6 contracts
Family member	Policy	Review	Evidence read	Active status
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-FutureSaver	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-WanderSafe	Matching wording needed	No matching wording uploaded · 1/3 pages · 1/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-DailyCash	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-HealthPlusRider	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-AccidentGuard-M	Matching wording needed	No matching wording uploaded · 2/4 pages · 2/4 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-TermGuard	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: none  ·  1456 ms

### Q26 — Does Marcus have a fracture benefit?

```
DearPolicy

DearPolicy didn’t find fracture cover in the parts of your policies read so far (10 of 15 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

5 policy contracts still need wording, processing or further review. See the policy review list.

PARTIAL POLICY REVIEW

Partial review: 10 of 15 processed pages across 5 documents in 5 contracts were read for this answer. An unread section is an incomplete review, not proof that the event is uninsured.

Policy review · 5 contracts
Family member	Policy	Review	Evidence read	Active status
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-FutureSaver	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-WanderSafe	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-DailyCash	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-HealthPlusRider	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
Marcus Lim Wei Jie	SYNTHETIC-DPTEST-v11before1-TermGuard	Matching wording needed	No matching wording uploaded · 2/3 pages · 2/3 passages	Active status not recently verified
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: none  ·  next question: none  ·  4178 ms

### Q28 — Does Josephine have a fracture benefit?

```
DearPolicy

Here is the fracture cover in your policy, from the benefit schedule on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

FACTS AND UNCERTAINTIES
Josephine Tan Hui Min
Policy-stated coverage limitS$3,500Josephine Tan Hui Min · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA, page 2: “Fracture of arm S$3,500”

SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA — Fracture of arm (page 2)

Policy review · 1 contracts
Family member	Policy	Review	Evidence read	Active status
Josephine Tan Hui Min	SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA	Matching wording needed	Not measured	Active status not recently verified
WHY DEARPOLICY SAYS THIS · 1 SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA
Benefit schedule, read when the document was uploaded
Page 2
DearPolicy uses uploaded personal evidence and policy passages. A partial review cannot guarantee eligibility or final insurer approval.
```
Citations: otherHouseholdAccident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA) p2; otherHouseholdAccident (SYNTHETIC-DPTEST-v11before1-OtherHouseholdPA) p2  ·  next question: none  ·  2954 ms

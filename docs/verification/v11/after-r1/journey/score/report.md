# V1.1 evaluation — browser journey (e2e/tests/v11-journey.spec.ts)

## Release gates

| Gate | Result | Violations |
|---|---|---|
| unsupported_amount | **FAIL** | 3 |
| unsupported_assertion | **FAIL** | 5 |
| cross_scope | PASS | 0 |
| deleted_superseded | PASS | 0 |
| blocked_gap | **FAIL** | 4 |
| positive_control | **FAIL** | 11 |
| internal_text | **FAIL** | 6 |
| fact_finding | PASS | 0 |

## Timing (ms)

| Group | n | p50 | p95 |
|---|---|---|---|
| factual | 13 | 2108 | 6151 |
| interview | 11 | 2129 | 2550 |
| all | 31 | 2164 | 4437 |

## Per question

| Q | Question | Result | Gates failed | ms |
|---|---|---|---|---|
| Q01 | What policies does Charmaine have? | pass |  | 6151 |
| Q02 | What is Charmaine's hospital room and board benefit? | FAIL | positive_control | 1776 |
| Q03 | Does Charmaine have a fracture benefit? | FAIL | positive_control | 2645 |
| Q04 | What is the waiting period for critical illness on Charmaine's CritiCare plan? | FAIL | positive_control | 2164 |
| Q05 | Does Charmaine's hospital plan cover dental treatment? | FAIL | positive_control | 2108 |
| Q06 | If Charmaine had both a fracture and a permanent disablement from one accident, would both be paid? | FAIL | positive_control | 2229 |
| Q07 | What does Charmaine's group life policy pay if she dies? | FAIL | internal_text, positive_control | 1870 |
| Q08 | What is Charmaine covered for if she dies in an accident? | FAIL | internal_text | 2324 |
| Q09 | What is Charmaine's maternity coverage? | FAIL | internal_text, unsupported_assertion | 2279 |
| Q10 | Does Charmaine have travel insurance? | FAIL | unsupported_assertion | 2203 |
| Q11 | Charmaine broke her arm. | pass |  | 2550 |
| Q12 | An accident. | pass |  | 2029 |
| Q13 | claim interview (6 answers): When did it happen? → Was the fracture confirmed by a doctor or on an X-ray or scan? → What treatment was given? → Was surgery performed? → How much did the treatment cost? | pass |  | 10725 |
| Q14 | (the final response once the interview has no question left) | pass |  | 2345 |
| Q15 | Which of her policies could pay for the broken arm? | pass |  | 2330 |
| Q16 | How much can she claim? | FAIL | internal_text, blocked_gap | 2242 |
| Q17 | (reopen c-injury from history) | pass |  | 5292 |
| Q18 | What does Marcus's travel policy cover overseas? | FAIL | positive_control | 2017 |
| Q19 | What is the baggage delay benefit on Marcus's travel policy? | FAIL | positive_control | 2516 |
| Q20 | How much hospital cash does Marcus get per day? | FAIL | unsupported_amount | 2083 |
| Q21 | What is Marcus's death benefit on his TermGuard policy? | FAIL | unsupported_assertion, blocked_gap | 1959 |
| Q22 | Is Marcus covered for dental treatment? | FAIL | internal_text, blocked_gap | 1620 |
| Q23 | What happens when Marcus's endowment plan matures? | FAIL | positive_control | 1929 |
| Q24 | Does Marcus have a fracture benefit? | pass |  | 836 |
| Q25 | Does Marcus have car insurance? | FAIL | unsupported_assertion | 2256 |
| Q26 | Does Marcus have a fracture benefit? | FAIL | internal_text, unsupported_assertion | 4437 |
| Q28 | Does Charmaine have a fracture benefit? | pass |  | 4106 |

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
- **Q09** [unsupported_assertion] 'not found' turned into 'not covered': "is not covered"
- **Q10** [unsupported_assertion] "says it expired / gives its date" stated without citing travelExpired p1
- **Q16** [internal_text] rule/row/page counts: "13 of 23 pages"
- **Q16** [blocked_gap] the question itself treated as a benefit name: "didn’t find How much"
- **Q16** [blocked_gap] 'not found' turned into 'not covered': is not covered
- **Q18** [positive_control] missing: overseas medical US$250,000
- **Q18** [positive_control] missing: evacuation USD 500,000
- **Q19** [positive_control] missing: S$200 for every 6 hours
- **Q20** [unsupported_amount] "S$2,000" is not an amount this answer may state
- **Q20** [unsupported_amount] "US$500,000" is not an amount this answer may state
- **Q20** [unsupported_amount] "US$250,000" is not an amount this answer may state
- **Q21** [unsupported_assertion] chose 350,000 although the document also states 300,000
- **Q21** [blocked_gap] the answer does not explain what could not be verified
- **Q22** [internal_text] rule/row/page counts: "11 of 19 pages"
- **Q22** [blocked_gap] 'not found' turned into 'not covered': is not covered
- **Q23** [positive_control] missing: S$50,000 guaranteed maturity benefit
- **Q23** [positive_control] missing: maturity date 2040-06-01
- **Q25** [unsupported_assertion] 'not found' turned into 'not covered': "is not covered"
- **Q26** [internal_text] rule/row/page counts: "10 of 15 pages"
- **Q26** [unsupported_assertion] 'not found' turned into 'not covered': "is not covered"

## Quality notes (not release gates)

- Q20 [expected_assertion_missing] missing: 150 per day, currency not stated
- Q27 [not_run] no answer recorded for this question

## Answers (visible text)

### Q01 — What policies does Charmaine have?

```
DearPolicy

I found 6 personal policy contracts across 1 family profile. The table separates confirmed cover from records that still need review.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Personal policy inventory
Family member	Policy	Confirmed cover	Active status
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11after2-JetSure	
SYNTHETIC-DPTEST-v11after2-JetSure
	Active status not recently verified
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11after2-AccidentGuard	
SYNTHETIC-DPTEST-v11after2-AccidentGuard
SYNTHETIC-DPTEST-v11after2-AccidentGuard · S$100,000
	Active status not recently verified
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11after2-GroupTermLife	
SYNTHETIC-DPTEST-v11after2-GroupTermLife
	Active status not recently verified
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11after2-DisabilityCare	
SYNTHETIC-DPTEST-v11after2-DisabilityCare · S$200,000
	Active status not recently verified
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11after2-HospitalShield	
SYNTHETIC-DPTEST-v11after2-HospitalShield
	Active status not recently verified
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11after2-CritiCare	
SYNTHETIC-DPTEST-v11after2-CritiCare · S$120,000
	Active status not recently verified

Schedules, amendments and supporting documents are grouped by insured person, insurer and policy number where available. An insured amount is a coverage amount, not a universal claim payout.

6 contracts show ownership but no recent payment or renewal evidence, so the active status is not recently verified. Ownership is unchanged.

NEXT STEP

Upload the latest premium receipt or renewal notice for Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-JetSure; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-AccidentGuard; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-GroupTermLife; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-DisabilityCare so current status can be verified separately from ownership.

SOURCES
SYNTHETIC-DPTEST-v11after2-JetSure
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11after2-AccidentGuard
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11after2-AccidentGuard
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11after2-GroupTermLife
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11after2-DisabilityCare
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11after2-HospitalShield
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11after2-CritiCare
Verified personal cover
Page 1
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: travelExpired (SYNTHETIC-DPTEST-v11after2-JetSure) p1; accident (SYNTHETIC-DPTEST-v11after2-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11after2-AccidentGuard) p1; groupLife (SYNTHETIC-DPTEST-v11after2-GroupTermLife) p1; disability (SYNTHETIC-DPTEST-v11after2-DisabilityCare) p1; hosp2025 (SYNTHETIC-DPTEST-v11after2-HospitalShield) p1; criticalIllness (SYNTHETIC-DPTEST-v11after2-CritiCare) p1  ·  next question: none  ·  6151 ms

### Q02 — What is Charmaine's hospital room and board benefit?

```
DearPolicy

Here is what Charmaine Tan Hui Min’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025 and 1 Jan 2024, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$2,000Charmaine Tan Hui Min · Accident medical reimbursement

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard, page 2: “Accident medical reimbursement Up to S$2,000 per accident”
Policy-stated coverage limitS$100.00Charmaine Tan Hui Min · Hospital cash

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-HospitalShield, page 2: “Hospital cash S$100 per day, maximum 30 days”
Policy-stated coverage limitS$100,000Charmaine Tan Hui Min · Overseas medical expenses

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-JetSure, page 2: “Overseas medical expenses S$100,000”
Policy-stated coverage limitS$25,000Charmaine Tan Hui Min · Surgical fees

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-HospitalShield, page 2: “Surgical fees Up to S$25,000 per surgery”

SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-HospitalShield — Hospital cash: an amount that is only shown after claim evidence has been reviewed per day (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-JetSure — Overseas medical expenses: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2024; not confirmed current).

SYNTHETIC-DPTEST-v11after2-HospitalShield — Surgical fees: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-HospitalShield
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-JetSure
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2; hosp2025 (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-HospitalShield) p2; travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-JetSure) p2; accident (SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2; hosp2025 (SYNTHETIC-DPTEST-v11after2-HospitalShield) p2; travelExpired (SYNTHETIC-DPTEST-v11after2-JetSure) p2; hosp2025 (SYNTHETIC-DPTEST-v11after2-HospitalShield) p2  ·  next question: none  ·  1776 ms

### Q03 — Does Charmaine have a fracture benefit?

```
DearPolicy

Here is what Charmaine Tan Hui Min’s documents state about accident cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms. Fracture of arm: your documents state different figures, so DearPolicy has not picked one. Upload the latest schedule to settle it.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$2,000Charmaine Tan Hui Min · Accident medical reimbursement

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard, page 2: “Accident medical reimbursement Up to S$2,000 per accident”
Policy-stated coverage limitS$50,000Charmaine Tan Hui Min · Additional accidental death benefit

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-GroupTermLife, page 2: “Additional accidental death benefit S$50,000”
Policy-stated coverage limitS$1,500Charmaine Tan Hui Min · Fracture of leg

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard, page 2: “Fracture of leg S$1,500”

SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accidental death: 100% of the sum insured (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-GroupTermLife — Additional accidental death benefit: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2026).

SYNTHETIC-DPTEST-v11after2-AccidentGuard — Fracture of leg: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-GroupTermLife
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2; groupLife (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-GroupTermLife) p2; accident (SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2; groupLife (SYNTHETIC-DPTEST-v11after2-GroupTermLife) p2; accident (SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2  ·  next question: none  ·  2645 ms

### Q04 — What is the waiting period for critical illness on Charmaine's CritiCare plan?

```
DearPolicy

Here is what Charmaine Tan Hui Min’s documents state about critical illness cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Mar 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min

SYNTHETIC-DPTEST-v11after2-CritiCare — Critical illness benefit: 100% of the sum insured (page 2, document dated 1 Mar 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-CritiCare — Early stage critical illness: 25% of the sum insured (page 2, document dated 1 Mar 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-CritiCare
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: criticalIllness (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-CritiCare) p2  ·  next question: none  ·  2164 ms

### Q05 — Does Charmaine's hospital plan cover dental treatment?

```
DearPolicy

Here is what Charmaine Tan Hui Min’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025 and 1 Jan 2024, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$2,000Charmaine Tan Hui Min · Accident medical reimbursement

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard, page 2: “Accident medical reimbursement Up to S$2,000 per accident”
Policy-stated coverage limitS$100.00Charmaine Tan Hui Min · Hospital cash

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-HospitalShield, page 2: “Hospital cash S$100 per day, maximum 30 days”
Policy-stated coverage limitS$100,000Charmaine Tan Hui Min · Overseas medical expenses

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-JetSure, page 2: “Overseas medical expenses S$100,000”
Policy-stated coverage limitS$25,000Charmaine Tan Hui Min · Surgical fees

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-HospitalShield, page 2: “Surgical fees Up to S$25,000 per surgery”

SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-HospitalShield — Hospital cash: an amount that is only shown after claim evidence has been reviewed per day (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-JetSure — Overseas medical expenses: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2024; not confirmed current).

SYNTHETIC-DPTEST-v11after2-HospitalShield — Surgical fees: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-HospitalShield
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-JetSure
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2; hosp2025 (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-HospitalShield) p2; travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-JetSure) p2; accident (SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2; hosp2025 (SYNTHETIC-DPTEST-v11after2-HospitalShield) p2; travelExpired (SYNTHETIC-DPTEST-v11after2-JetSure) p2; hosp2025 (SYNTHETIC-DPTEST-v11after2-HospitalShield) p2  ·  next question: none  ·  2108 ms

### Q06 — If Charmaine had both a fracture and a permanent disablement from one accident, would both be paid?

```
DearPolicy

Here is what Charmaine Tan Hui Min’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025 and 1 Jan 2024, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$2,000Charmaine Tan Hui Min · Accident medical reimbursement

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard, page 2: “Accident medical reimbursement Up to S$2,000 per accident”
Policy-stated coverage limitS$100.00Charmaine Tan Hui Min · Hospital cash

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-HospitalShield, page 2: “Hospital cash S$100 per day, maximum 30 days”
Policy-stated coverage limitS$100,000Charmaine Tan Hui Min · Overseas medical expenses

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-JetSure, page 2: “Overseas medical expenses S$100,000”
Policy-stated coverage limitS$25,000Charmaine Tan Hui Min · Surgical fees

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-HospitalShield, page 2: “Surgical fees Up to S$25,000 per surgery”

SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-HospitalShield — Hospital cash: an amount that is only shown after claim evidence has been reviewed per day (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-JetSure — Overseas medical expenses: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2024; not confirmed current).

SYNTHETIC-DPTEST-v11after2-HospitalShield — Surgical fees: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-HospitalShield
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-JetSure
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2; hosp2025 (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-HospitalShield) p2; travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-JetSure) p2; accident (SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2; hosp2025 (SYNTHETIC-DPTEST-v11after2-HospitalShield) p2; travelExpired (SYNTHETIC-DPTEST-v11after2-JetSure) p2; hosp2025 (SYNTHETIC-DPTEST-v11after2-HospitalShield) p2  ·  next question: none  ·  2229 ms

### Q07 — What does Charmaine's group life policy pay if she dies?

```
DearPolicy

If that happened, these benefits could be relevant. This is a preliminary claim assessment: DearPolicy does not estimate what the insurer would pay until claim evidence has been reviewed. Each card says what is still needed.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-GroupTermLife — Death (any cause)
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accidental death
LIKELY APPLICABLE
Policy condition unresolved

100% of an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-GroupTermLife — Additional accidental death benefit
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.

This is a what-if. Nothing here has been recorded as a claim, and no facts from this question have been saved against anyone's profile.

The Coverage page shows where each of these came from in your documents, and whether it was verified.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-GroupTermLife
Policy wording, read when the document was uploaded
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard
Policy wording, read when the document was uploaded
Page 2
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
```
Citations: groupLife (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-GroupTermLife) p2; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2  ·  next question: none  ·  1870 ms

### Q08 — What is Charmaine covered for if she dies in an accident?

```
DearPolicy

If that happened, these benefits could be relevant. This is a preliminary claim assessment: DearPolicy does not estimate what the insurer would pay until claim evidence has been reviewed. Each card says what is still needed.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-GroupTermLife — Death (any cause)
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accidental death
LIKELY APPLICABLE
Policy condition unresolved

100% of an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-GroupTermLife — Additional accidental death benefit
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and verified against the page by a second read.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.

This is a what-if. Nothing here has been recorded as a claim, and no facts from this question have been saved against anyone's profile.

The Coverage page shows where each of these came from in your documents, and whether it was verified.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-GroupTermLife
Policy wording, read when the document was uploaded
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard
Policy wording, read when the document was uploaded
Page 2
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
```
Citations: groupLife (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-GroupTermLife) p2; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2  ·  next question: none  ·  2324 ms

### Q09 — What is Charmaine's maternity coverage?

```
DearPolicy

DearPolicy didn’t find maternity cover in the parts of Charmaine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min

6 policy contracts still need wording, processing or further review. See the policy review list.

DearPolicy could not check every part of your documents for this, so it cannot say that something is not covered.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  2279 ms

### Q10 — Does Charmaine have travel insurance?

```
DearPolicy

Here is what Charmaine Tan Hui Min’s documents state about travel cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2024, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$3,000Charmaine Tan Hui Min · Trip cancellation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-JetSure, page 2: “Trip cancellation S$3,000”

SYNTHETIC-DPTEST-v11after2-JetSure — Trip cancellation: S$3,000 (page 2, document dated 1 Jan 2024; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-JetSure
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11after2-JetSure) p2  ·  next question: none  ·  2203 ms

### Q11 — Charmaine broke her arm.

```
DearPolicy

I’m sorry Charmaine is dealing with this. A broken arm can involve several kinds of cover, so I need a few details before I check Charmaine’s policies.

A FACT THAT CHANGES THIS ASSESSMENT
Was this caused by an accident, or an illness?
Some of these benefits only pay for accidents, so this decides which ones apply.
An accident
An illness
Not sure
Show full assessment
What DearPolicy still needs
Charmaine Tan Hui Min · Injury Information needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Injured: yes
Fracture: arm
Injuries: broke her arm
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: Was this caused by an accident, or an illness?  ·  2550 ms

### Q12 — An accident.

```
DearPolicy

I’m sorry Charmaine is dealing with this. A broken arm may relate to accident medical reimbursement, medical reimbursement, fracture or hospital cash benefits in Charmaine’s policies, depending on the answers. It is not the same as permanent loss of a limb, so I won’t count permanent-disability schedule amounts from the information available.

A FACT THAT CHANGES THIS ASSESSMENT
Where did the accident happen?
Some benefits apply only in certain places, and treatment overseas usually needs extra documents.
Singapore
Overseas
Not sure
Show full assessment
What DearPolicy still needs
Charmaine Tan Hui Min · Injury Information needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Fracture: arm
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: Where did the accident happen?  ·  2029 ms

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
Charmaine Tan Hui Min · Injury Information needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Fracture: arm
Event Location: Singapore
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: When did it happen?  ·  1973 ms

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
Charmaine Tan Hui Min · Injury Information needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Location: Singapore
Fracture: arm
Event Date: 2026-09-20
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: Was the fracture confirmed by a doctor or on an X-ray or scan?  ·  1571 ms

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
Charmaine Tan Hui Min · Injury Information needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Date: 2026-09-20
Event Location: Singapore
Fracture: arm
Fracture Confirmed: yes
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: What treatment was given?  ·  672 ms

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
Charmaine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Injured: yes
Injuries: broke her arm
Event Date: 2026-09-20
Event Location: Singapore
Fracture: arm
Fracture Confirmed: yes
Treatment Type: Emergency department
Hospitalised: no

This may relate to accident medical reimbursement or fracture benefits, depending on the answers.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: Was surgery performed?  ·  2129 ms

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
Charmaine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
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

This may relate to accident medical reimbursement or fracture benefits, depending on the answers.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: How much did the treatment cost?  ·  2035 ms

### Q13.6 — 

```
DearPolicy

Thanks — that’s what I need for now. For the broken arm, Charmaine’s policies have possible benefits: SYNTHETIC-DPTEST-v11after2-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.

Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
What DearPolicy still needs
Charmaine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
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
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-AccidentGuard — Fracture of arm
LIKELY APPLICABLE
Policy condition unresolved

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accident medical reimbursement
NEEDS CHECKING
Information needed

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

3 conditions
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Download the claim pack (PDF)
NEXT STEP

Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard
Policy wording, read when the document was uploaded
Page 2
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2  ·  next question: none  ·  2345 ms

### Q14 — (the final response once the interview has no question left)

```
DearPolicy

Thanks — that’s what I need for now. For the broken arm, Charmaine’s policies have possible benefits: SYNTHETIC-DPTEST-v11after2-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.

Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
What DearPolicy still needs
Charmaine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
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
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-AccidentGuard — Fracture of arm
LIKELY APPLICABLE
Policy condition unresolved

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11after2-AccidentGuard — Accident medical reimbursement
NEEDS CHECKING
Information needed

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

3 conditions
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: The uploaded document shows a renewal or expiry date of 2024-12-31 that has already passed, and no later premium or renewal evidence is on file. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Download the claim pack (PDF)
NEXT STEP

Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard
Policy wording, read when the document was uploaded
Page 2
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2  ·  next question: none  ·  2345 ms

### Q15 — Which of her policies could pay for the broken arm?

```
DearPolicy

Here is the fracture cover in Charmaine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

CHARMAINE TAN HUI MIN · INJURY
Has any other insurer or the employer already paid part of the bill?
Reimbursement is coordinated so the same bill is not paid twice.
Yes
No
Not sure
Show full assessment
What DearPolicy still needs
Charmaine Tan Hui Min · Injury Evidence needed

Documents: Doctor's report (or X-ray or scan report) describing the injury

FACTS AND UNCERTAINTIES
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
Policy-stated coverage limitS$1,000Charmaine Tan Hui Min · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard, page 2: “Fracture of arm S$1,000”
Policy-stated coverage limitS$1,500Charmaine Tan Hui Min · Fracture of leg

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard, page 2: “Fracture of leg S$1,500”

SYNTHETIC-DPTEST-v11after2-AccidentGuard — Fracture of arm (page 2)

SYNTHETIC-DPTEST-v11after2-AccidentGuard — Fracture of leg (page 2)

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard
Benefit schedule, read when the document was uploaded
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2; accident (SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2; accident (SYNTHETIC-DPTEST-v11after2-AccidentGuard) p2  ·  next question: Has any other insurer or the employer already paid part of the bill?  ·  2330 ms

### Q16 — How much can she claim?

```
DearPolicy

DearPolicy didn’t find How much can she claim in the parts of Charmaine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
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

6 policy contracts still need wording, processing or further review. See the policy review list.

DearPolicy could not check every part of your documents for this, so it cannot say that something is not covered.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  2242 ms

### Q17 — (reopen c-injury from history)

```
DearPolicy

DearPolicy didn’t find How much can she claim in the parts of Charmaine’s policies read so far (13 of 23 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
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

6 policy contracts still need wording, processing or further review. See the policy review list.

DearPolicy could not check every part of your documents for this, so it cannot say that something is not covered.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  5292 ms

### Q18 — What does Marcus's travel policy cover overseas?

```
DearPolicy

Here is what Marcus Lim Wei Jie’s documents state about travel cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitS$5,000Marcus Lim Wei Jie · Trip cancellation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-WanderSafe, page 2: “Trip cancellation S$5,000”

SYNTHETIC-DPTEST-v11after2-WanderSafe — Baggage delay (page 2, document dated 1 Jun 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-WanderSafe — Trip cancellation: S$5,000 (page 2, document dated 1 Jun 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-WanderSafe
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: travel (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11after2-WanderSafe) p2  ·  next question: none  ·  2017 ms

### Q19 — What is the baggage delay benefit on Marcus's travel policy?

```
DearPolicy

Here is what Marcus Lim Wei Jie’s documents state about travel cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitS$5,000Marcus Lim Wei Jie · Trip cancellation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-WanderSafe, page 2: “Trip cancellation S$5,000”

SYNTHETIC-DPTEST-v11after2-WanderSafe — Baggage delay (page 2, document dated 1 Jun 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-WanderSafe — Trip cancellation: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jun 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-WanderSafe
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: travel (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11after2-WanderSafe) p2  ·  next question: none  ·  2516 ms

### Q20 — How much hospital cash does Marcus get per day?

```
DearPolicy

Here is what Marcus Lim Wei Jie’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025 and 1 Jun 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitS$2,000Marcus Lim Wei Jie · Accident medical reimbursement

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard-M, page 2: “Accident medical reimbursement Up to S$2,000 per accident”
Policy-stated coverage limitUS$500,000Marcus Lim Wei Jie · Emergency medical evacuation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-WanderSafe, page 2: “Emergency medical evacuation USD 500,000”
Policy-stated coverage limitUS$250,000Marcus Lim Wei Jie · Overseas medical expenses

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-WanderSafe, page 2: “Overseas medical expenses US$250,000”

SYNTHETIC-DPTEST-v11after2-AccidentGuard-M — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-WanderSafe — Emergency medical evacuation: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jun 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-WanderSafe — Overseas medical expenses: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jun 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard-M
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-WanderSafe
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accidentMarcus (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard-M) p2; travel (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-WanderSafe) p2; accidentMarcus (SYNTHETIC-DPTEST-v11after2-AccidentGuard-M) p2; travel (SYNTHETIC-DPTEST-v11after2-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11after2-WanderSafe) p2  ·  next question: none  ·  2083 ms

### Q21 — What is Marcus's death benefit on his TermGuard policy?

```
DearPolicy

Here is what Marcus Lim Wei Jie’s documents state about death cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025 and 1 Jun 2020, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitUS$350,000Marcus Lim Wei Jie · Death benefit

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-TermGuard, page 2: “Death benefit US$350,000”

SYNTHETIC-DPTEST-v11after2-AccidentGuard-M — Accidental death: 100% of the sum insured (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-TermGuard — Death benefit: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-FutureSaver — Death benefit: 100% of the sum insured (page 2, document dated 1 Jun 2020; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard-M
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-TermGuard
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-FutureSaver
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accidentMarcus (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard-M) p2; termContradictory (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-TermGuard) p2; endowment (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-FutureSaver) p2; termContradictory (SYNTHETIC-DPTEST-v11after2-TermGuard) p2  ·  next question: none  ·  1959 ms

### Q22 — Is Marcus covered for dental treatment?

```
DearPolicy

DearPolicy didn’t find dental cover in the parts of your policies read so far (11 of 19 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

6 policy contracts still need wording, processing or further review. See the policy review list.

DearPolicy could not check every part of your documents for this, so it cannot say that something is not covered.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  1620 ms

### Q23 — What happens when Marcus's endowment plan matures?

```
DearPolicy

Here is what Marcus Lim Wei Jie’s documents state about maturity or surrender value. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2020, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

SYNTHETIC-DPTEST-v11after2-FutureSaver — Guaranteed maturity benefit (page 2, document dated 1 Jun 2020; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-FutureSaver
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: endowment (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-FutureSaver) p2  ·  next question: none  ·  1929 ms

### Q24 — Does Marcus have a fracture benefit?

```
DearPolicy

Here is what Marcus Lim Wei Jie’s documents state about accident cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitS$2,000Marcus Lim Wei Jie · Accident medical reimbursement

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard-M, page 2: “Accident medical reimbursement Up to S$2,000 per accident”
Policy-stated coverage limitS$500.00Marcus Lim Wei Jie · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard-M, page 2: “Fracture of arm S$500”
Policy-stated coverage limitS$750.00Marcus Lim Wei Jie · Fracture of leg

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-AccidentGuard-M, page 2: “Fracture of leg S$750”

SYNTHETIC-DPTEST-v11after2-AccidentGuard-M — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-AccidentGuard-M — Accidental death: 100% of the sum insured (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-AccidentGuard-M — Fracture of arm: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-AccidentGuard-M — Fracture of leg: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard-M
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accidentMarcus (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11after2-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11after2-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11after2-AccidentGuard-M) p2  ·  next question: none  ·  836 ms

### Q25 — Does Marcus have car insurance?

```
DearPolicy

You have no motor policy on file, so there is nothing in your documents to answer this from. The policies on file are: SYNTHETIC-DPTEST-v11after2-DailyCash, SYNTHETIC-DPTEST-v11after2-TermGuard, SYNTHETIC-DPTEST-v11after2-AccidentGuard-M. If there is a motor policy, upload it and ask again.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

6 policy contracts still need wording, processing or further review. See the policy review list.

DearPolicy could not check every part of your documents for this, so it cannot say that something is not covered.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  2256 ms

### Q26 — Does Marcus have a fracture benefit?

```
DearPolicy

DearPolicy didn’t find fracture cover in the parts of your policies read so far (10 of 15 pages). That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

5 policy contracts still need wording, processing or further review. See the policy review list.

DearPolicy could not check every part of your documents for this, so it cannot say that something is not covered.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  4437 ms

### Q28 — Does Charmaine have a fracture benefit?

```
DearPolicy

Here is what Charmaine Tan Hui Min’s documents state about accident cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$9,000Charmaine Tan Hui Min · Accident medical reimbursement

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-OtherHouseholdPA, page 2: “Accident medical reimbursement Up to S$9,000 per accident”
Policy-stated coverage limitS$3,500Charmaine Tan Hui Min · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11after2-OtherHouseholdPA, page 2: “Fracture of arm S$3,500”

SYNTHETIC-DPTEST-v11after2-OtherHouseholdPA — Accident medical reimbursement: up to an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11after2-OtherHouseholdPA — Fracture of arm: an amount that is only shown after claim evidence has been reviewed (page 2, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-OtherHouseholdPA
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: otherHouseholdAccident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11after2-OtherHouseholdPA) p2; otherHouseholdAccident (SYNTHETIC-DPTEST-v11after2-OtherHouseholdPA) p2; otherHouseholdAccident (SYNTHETIC-DPTEST-v11after2-OtherHouseholdPA) p2  ·  next question: none  ·  4106 ms

# V1.1 evaluation — browser journey (e2e/tests/v11-journey.spec.ts)

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
| factual | 13 | 2000 | 8444 |
| interview | 11 | 1994 | 2223 |
| all | 31 | 2105 | 7778 |

## Per question

| Q | Question | Result | Gates failed | ms |
|---|---|---|---|---|
| Q01 | What policies does Charmaine have? | pass |  | 8444 |
| Q02 | What is Charmaine's hospital room and board benefit? | pass |  | 2181 |
| Q03 | Does Charmaine have a fracture benefit? | pass |  | 2228 |
| Q04 | What is the waiting period for critical illness on Charmaine's CritiCare plan? | pass |  | 856 |
| Q05 | Does Charmaine's hospital plan cover dental treatment? | pass |  | 1972 |
| Q06 | If Charmaine had both a fracture and a permanent disablement from one accident, would both be paid? | pass |  | 881 |
| Q07 | What does Charmaine's group life policy pay if she dies? | pass |  | 963 |
| Q08 | What is Charmaine covered for if she dies in an accident? | pass |  | 2105 |
| Q09 | What is Charmaine's maternity coverage? | pass |  | 2454 |
| Q10 | Does Charmaine have travel insurance? | pass |  | 950 |
| Q11 | Charmaine broke her arm. | pass |  | 1907 |
| Q12 | An accident. | pass |  | 2077 |
| Q13 | claim interview (6 answers): When did it happen? → Was the fracture confirmed by a doctor or on an X-ray or scan? → What treatment was given? → Was surgery performed? → How much did the treatment cost? | pass |  | 11369 |
| Q14 | (the final response once the interview has no question left) | pass |  | 2159 |
| Q15 | Which of her policies could pay for the broken arm? | pass |  | 2223 |
| Q16 | How much can she claim? | pass |  | 1192 |
| Q17 | (reopen c-injury from history) | pass |  | 5755 |
| Q18 | What does Marcus's travel policy cover overseas? | pass |  | 2153 |
| Q19 | What is the baggage delay benefit on Marcus's travel policy? | pass |  | 2000 |
| Q20 | How much hospital cash does Marcus get per day? | pass |  | 3349 |
| Q21 | What is Marcus's death benefit on his TermGuard policy? | pass |  | 2190 |
| Q22 | Is Marcus covered for dental treatment? | pass |  | 2137 |
| Q23 | What happens when Marcus's endowment plan matures? | pass |  | 1661 |
| Q24 | Does Marcus have a fracture benefit? | pass |  | 934 |
| Q25 | Does Marcus have car insurance? | pass |  | 2408 |
| Q26 | Does Marcus have a fracture benefit? | pass |  | 4924 |
| Q28 | Does Charmaine have a fracture benefit? | pass |  | 7778 |

## Every gate violation

(none)

## Quality notes (not release gates)

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
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11final2-HospitalShield	
SYNTHETIC-DPTEST-v11final2-HospitalShield
	Active status not recently verified
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11final2-AccidentGuard	
SYNTHETIC-DPTEST-v11final2-AccidentGuard
SYNTHETIC-DPTEST-v11final2-AccidentGuard · S$100,000
	Active status not recently verified
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11final2-JetSure	
SYNTHETIC-DPTEST-v11final2-JetSure
	Active status not recently verified
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11final2-DisabilityCare	
SYNTHETIC-DPTEST-v11final2-DisabilityCare · S$200,000
	Active status not recently verified
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11final2-CritiCare	
SYNTHETIC-DPTEST-v11final2-CritiCare · S$120,000
	Active status not recently verified
Charmaine Tan Hui Min	SYNTHETIC-DPTEST-v11final2-GroupTermLife	
SYNTHETIC-DPTEST-v11final2-GroupTermLife
	Active status not recently verified

Schedules, amendments and supporting documents are grouped by insured person, insurer and policy number where available. An insured amount is a coverage amount, not a universal claim payout.

6 contracts show ownership but no recent payment or renewal evidence, so the active status is not recently verified. Ownership is unchanged.

NEXT STEP

Upload the latest premium receipt or renewal notice for Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-HospitalShield; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-AccidentGuard; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-JetSure; Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-DisabilityCare so current status can be verified separately from ownership.

SOURCES
SYNTHETIC-DPTEST-v11final2-HospitalShield
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11final2-AccidentGuard
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11final2-AccidentGuard
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11final2-JetSure
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11final2-DisabilityCare
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11final2-CritiCare
Verified personal cover
Page 1
SYNTHETIC-DPTEST-v11final2-GroupTermLife
Verified personal cover
Page 1
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: hosp2025 (SYNTHETIC-DPTEST-v11final2-HospitalShield) p1; accident (SYNTHETIC-DPTEST-v11final2-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11final2-AccidentGuard) p1; travelExpired (SYNTHETIC-DPTEST-v11final2-JetSure) p1; disability (SYNTHETIC-DPTEST-v11final2-DisabilityCare) p1; criticalIllness (SYNTHETIC-DPTEST-v11final2-CritiCare) p1; groupLife (SYNTHETIC-DPTEST-v11final2-GroupTermLife) p1  ·  next question: none  ·  8444 ms

### Q02 — What is Charmaine's hospital room and board benefit?

```
DearPolicy

Here is what Charmaine’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$800Charmaine · Daily room and board

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-HospitalShield, page 2: “Daily room and board S$800 per day, maximum 120 days”

SYNTHETIC-DPTEST-v11final2-HospitalShield — Daily room and board: S$800 per day, maximum 120 days (page 2, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-HospitalShield
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: hosp2025 (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-HospitalShield) p2; hosp2025 (SYNTHETIC-DPTEST-v11final2-HospitalShield) p2  ·  next question: none  ·  2181 ms

### Q03 — Does Charmaine have a fracture benefit?

```
DearPolicy

Here is what Charmaine’s documents state about accident cover. Each line shows the page it comes from. SYNTHETIC-DPTEST-v11final2-AccidentGuard states different figures for fracture of arm: S$1,000 on page 2 and S$1,200 on page 1. DearPolicy can’t tell which one applies, so it has not picked one; the insurer can confirm. One of them comes from an endorsement to the policy. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$1,500Charmaine · Fracture of leg

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-AccidentGuard, page 2: “Fracture of leg S$1,500”

SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of leg: S$1,500 (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm: S$1,000 (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm: S$1,200 (page 1, document dated 1 Jan 2026).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard
Your policy document
Page 1
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard) p2; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11final2-AccidentGuard) p2  ·  next question: none  ·  2228 ms

### Q04 — What is the waiting period for critical illness on Charmaine's CritiCare plan?

```
DearPolicy

Here is what Charmaine’s documents state. Each line shows the page it comes from. Some of this comes from a document dated 1 Mar 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min

SYNTHETIC-DPTEST-v11final2-CritiCare — Waiting period: 90 days from the effective date for any critical illness. (page 3, document dated 1 Mar 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-CritiCare
Your policy document
Page 3
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: criticalIllness (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-CritiCare) p3  ·  next question: none  ·  856 ms

### Q05 — Does Charmaine's hospital plan cover dental treatment?

```
DearPolicy

Here is what Charmaine’s documents state. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min

SYNTHETIC-DPTEST-v11final2-HospitalShield — Exclusions: cosmetic surgery; dental treatment unless caused by an accident; self-inflicted injury. (page 3, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-HospitalShield
Your policy document
Page 3
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: hosp2025 (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-HospitalShield) p3  ·  next question: none  ·  1972 ms

### Q06 — If Charmaine had both a fracture and a permanent disablement from one accident, would both be paid?

```
DearPolicy

Here is what Charmaine’s documents state. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min

SYNTHETIC-DPTEST-v11final2-AccidentGuard — Alternative benefits: where a Fracture benefit and a Permanent Disablement benefit arise from the same accident, only the higher amount is payable. (page 3, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard
Your policy document
Page 3
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard) p3  ·  next question: none  ·  881 ms

### Q07 — What does Charmaine's group life policy pay if she dies?

```
DearPolicy

Here is what Charmaine’s documents state about death cover. Each line shows the page it comes from.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$150,000Charmaine · Death (any cause)

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-GroupTermLife, page 2: “Death (any cause) S$150,000”
Policy-stated coverage limitS$50,000Charmaine · Additional accidental death benefit

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-GroupTermLife, page 2: “Additional accidental death benefit S$50,000”

SYNTHETIC-DPTEST-v11final2-GroupTermLife — Death (any cause): S$150,000 (page 2, document dated 1 Jan 2026).

SYNTHETIC-DPTEST-v11final2-GroupTermLife — Additional accidental death benefit: S$50,000 (page 2, document dated 1 Jan 2026).

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-GroupTermLife
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: groupLife (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-GroupTermLife) p2; groupLife (SYNTHETIC-DPTEST-v11final2-GroupTermLife) p2; groupLife (SYNTHETIC-DPTEST-v11final2-GroupTermLife) p2  ·  next question: none  ·  963 ms

### Q08 — What is Charmaine covered for if she dies in an accident?

```
DearPolicy

If that happened, these benefits could be relevant. This is a preliminary claim assessment: DearPolicy does not estimate what the insurer would pay until claim evidence has been reviewed. Each card says what is still needed.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-GroupTermLife — Death (any cause)
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and checked against the page.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-AccidentGuard — Accidental death
LIKELY APPLICABLE
Policy condition unresolved

100% of an amount that is only shown after claim evidence has been reviewed. Read from your policy wording (page 2) and checked against the page.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-GroupTermLife — Additional accidental death benefit
LIKELY APPLICABLE
Policy condition unresolved

an amount that is only shown after claim evidence has been reviewed lump sum. Read from your policy wording (page 2) and checked against the page.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.

This is a what-if. Nothing here has been recorded as a claim, and no facts from this question have been saved against anyone's profile.

The Coverage page shows where each of these came from in your documents, and whether it was verified.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-GroupTermLife
Policy wording, read when the document was uploaded
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard
Policy wording, read when the document was uploaded
Page 2
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
```
Citations: groupLife (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-GroupTermLife) p2; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard) p2  ·  next question: none  ·  2105 ms

### Q09 — What is Charmaine's maternity coverage?

```
DearPolicy

DearPolicy didn’t find maternity cover in the parts of Charmaine’s policies read so far. That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min

6 policy contracts still need wording, processing or further review. See the policy review list.

DearPolicy could not check every part of your documents for this, so this is not a finding that it is missing.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  2454 ms

### Q10 — Does Charmaine have travel insurance?

```
DearPolicy

Here is what Charmaine’s documents state about travel cover. Each line shows the page it comes from. SYNTHETIC-DPTEST-v11final2-JetSure expired on 2024-12-31 (page 1), so its terms may no longer apply.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$100,000Charmaine · Overseas medical expenses

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-JetSure, page 2: “Overseas medical expenses S$100,000”
Policy-stated coverage limitS$3,000Charmaine · Trip cancellation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-JetSure, page 2: “Trip cancellation S$3,000”

SYNTHETIC-DPTEST-v11final2-JetSure — Overseas medical expenses: S$100,000 (page 2, document dated 1 Jan 2024; expired).

SYNTHETIC-DPTEST-v11final2-JetSure — Trip cancellation: S$3,000 (page 2, document dated 1 Jan 2024; expired).

SYNTHETIC-DPTEST-v11final2-JetSure — Expiry date: 2024-12-31 (page 1; this policy has expired).

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-JetSure
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-JetSure
Your policy document
Page 1
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-JetSure) p2; travelExpired (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-JetSure) p1; travelExpired (SYNTHETIC-DPTEST-v11final2-JetSure) p2; travelExpired (SYNTHETIC-DPTEST-v11final2-JetSure) p2  ·  next question: none  ·  950 ms

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
Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
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
Citations: none  ·  next question: Was this caused by an accident, or an illness?  ·  1907 ms

### Q12 — An accident.

```
DearPolicy

I’m sorry Charmaine is dealing with this. A broken arm may relate to accident medical reimbursement, medical reimbursement, hospitalisation, fracture or hospital cash benefits in Charmaine’s policies, depending on the answers. It is not the same as permanent loss of a limb, so I won’t count permanent-disability schedule amounts from the information available.

A FACT THAT CHANGES THIS ASSESSMENT
Where did the accident happen?
Some benefits apply only in certain places, and treatment overseas usually needs extra documents.
Singapore
Overseas
Not sure
Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
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
Citations: none  ·  next question: Where did the accident happen?  ·  2077 ms

### Q13.1 — 

```
DearPolicy

Thanks, noted.

A FACT THAT CHANGES THIS ASSESSMENT
When did it happen?
It decides which policy version applies and whether waiting periods or cover dates are met.
Not sure
Answer
Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
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
Citations: none  ·  next question: When did it happen?  ·  1588 ms

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
Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
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
Citations: none  ·  next question: Was the fracture confirmed by a doctor or on an X-ray or scan?  ·  1847 ms

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
Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
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
Citations: none  ·  next question: What treatment was given?  ·  1586 ms

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
Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
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
Citations: none  ·  next question: Was surgery performed?  ·  2195 ms

### Q13.5 — 

```
DearPolicy

Before I put figures on this, one question.

A FACT THAT CHANGES THIS ASSESSMENT
How much did the treatment cost?
It is reimbursed up to the policy's limit.
Not sure
Answer
Upload documents for this claim — Doctor's report (or X-ray or scan report) describing the injury →
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
Citations: none  ·  next question: How much did the treatment cost?  ·  1994 ms

### Q13.6 — 

```
DearPolicy

Thanks — that’s what I need for now. For the broken arm, Charmaine’s policies have possible benefits: SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11final2-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.

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

Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm
LIKELY APPLICABLE
Policy condition unresolved

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-AccidentGuard — Accident medical reimbursement
NEEDS CHECKING
Information needed

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

3 conditions
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Download the claim pack (PDF)
NEXT STEP

Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard
Policy wording, read when the document was uploaded
Page 2
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard) p2  ·  next question: none  ·  2159 ms

### Q14 — (the final response once the interview has no question left)

```
DearPolicy

Thanks — that’s what I need for now. For the broken arm, Charmaine’s policies have possible benefits: SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11final2-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.

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

Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm
LIKELY APPLICABLE
Policy condition unresolved

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-AccidentGuard — Accident medical reimbursement
NEEDS CHECKING
Information needed

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

3 conditions
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Download the claim pack (PDF)
NEXT STEP

Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard
Policy wording, read when the document was uploaded
Page 2
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard) p2  ·  next question: none  ·  2159 ms

### Q15 — Which of her policies could pay for the broken arm?

```
DearPolicy

Here is the fracture cover in Charmaine’s policies, from the benefit schedules on file, each with the page it is on. Where the schedule prints an amount, it is shown below as the policy-stated limit, not as an estimate of any claim.

CHARMAINE TAN HUI MIN · INJURY · 1 MORE QUESTION AFTER THIS
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
Policy-stated coverage limitS$1,200Charmaine Tan Hui Min · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-AccidentGuard, page 1: “Fracture of arm S$1,200”
Policy-stated coverage limitS$1,500Charmaine Tan Hui Min · Fracture of leg

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-AccidentGuard, page 2: “Fracture of leg S$1,500”

SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm (page 1)

SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of leg (page 2)

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard
Benefit schedule, read when the document was uploaded
Page 1
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard
Benefit schedule, read when the document was uploaded
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard) p1; accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard) p2; accident (SYNTHETIC-DPTEST-v11final2-AccidentGuard) p1; accident (SYNTHETIC-DPTEST-v11final2-AccidentGuard) p2  ·  next question: Has any other insurer or the employer already paid part of the bill?  ·  2223 ms

### Q16 — How much can she claim?

```
DearPolicy

Here is where this claim stands. For the broken arm, Charmaine’s policies have possible benefits: SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11final2-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.

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
Out Of Pocket: not yet known
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm
LIKELY APPLICABLE
Policy condition unresolved

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-AccidentGuard — Accident medical reimbursement
NEEDS CHECKING
Information needed

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

3 conditions
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Download the claim pack (PDF)
NEXT STEP

Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard
Policy wording, read when the document was uploaded
Page 2
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
```
Citations: accident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard) p2  ·  next question: none  ·  1192 ms

### Q17 — (reopen c-injury from history)

```
DearPolicy

Here is where this claim stands. For the broken arm, Charmaine’s policies have possible benefits: SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm (page 2) and SYNTHETIC-DPTEST-v11final2-AccidentGuard — Accident medical reimbursement (page 2). This is not a promise of payment: the insurer decides after assessing the claim, and DearPolicy shows an estimate only once the claim documents have been reviewed.

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
Out Of Pocket: not yet known
Hospitalised: no
Event Location: Singapore
Treatment Type: Emergency department
Fracture: arm
Fracture Confirmed: yes
Preliminary claim assessment

Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.

Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-AccidentGuard — Fracture of arm
LIKELY APPLICABLE
Policy condition unresolved

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

2 conditions
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Charmaine Tan Hui Min · SYNTHETIC-DPTEST-v11final2-AccidentGuard — Accident medical reimbursement
NEEDS CHECKING
Information needed

Listed in the policy on page 2. It may respond to the broken arm; whether it pays depends on the claim documents and the insurer’s assessment.

3 conditions
Still needed: the actual cost
Subject to the insurer's assessment and the plan's own terms and exclusions.
Active status not recently verified: DearPolicy has no premium receipt or renewal notice for this contract, so it cannot independently confirm that the cover is still being paid for. Ownership stays confirmed by the personalised evidence; only the current payment/renewal status is unverified.
Download the claim pack (PDF)
NEXT STEP

Send these documents for the claim: Doctor's report (or X-ray or scan report) describing the injury; Police or accident report, if one was made.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard
Policy wording, read when the document was uploaded
Page 2
Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.
```
Citations: none  ·  next question: none  ·  5755 ms

### Q18 — What does Marcus's travel policy cover overseas?

```
DearPolicy

Here is what Marcus’s documents state about travel cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitUS$250,000Marcus · Overseas medical expenses

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-WanderSafe, page 2: “Overseas medical expenses US$250,000”
Policy-stated coverage limitUS$500,000Marcus · Emergency medical evacuation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-WanderSafe, page 2: “Emergency medical evacuation USD 500,000”
Policy-stated coverage limitS$5,000Marcus · Trip cancellation

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-WanderSafe, page 2: “Trip cancellation S$5,000”
Policy-stated coverage limitS$200Marcus · Baggage delay

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-WanderSafe, page 2: “Baggage delay S$200 for every 6 hours, maximum S$1,000”

SYNTHETIC-DPTEST-v11final2-WanderSafe — Overseas medical expenses: US$250,000 (page 2, document dated 1 Jun 2025; not confirmed current).

SYNTHETIC-DPTEST-v11final2-WanderSafe — Emergency medical evacuation: USD 500,000 (page 2, document dated 1 Jun 2025; not confirmed current).

SYNTHETIC-DPTEST-v11final2-WanderSafe — Trip cancellation: S$5,000 (page 2, document dated 1 Jun 2025; not confirmed current).

SYNTHETIC-DPTEST-v11final2-WanderSafe — Baggage delay: S$200 for every 6 hours, maximum S$1,000 (page 2, document dated 1 Jun 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-WanderSafe
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: travel (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11final2-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11final2-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11final2-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11final2-WanderSafe) p2  ·  next question: none  ·  2153 ms

### Q19 — What is the baggage delay benefit on Marcus's travel policy?

```
DearPolicy

Here is what Marcus’s documents state about travel cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitS$200Marcus · Baggage delay

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-WanderSafe, page 2: “Baggage delay S$200 for every 6 hours, maximum S$1,000”

SYNTHETIC-DPTEST-v11final2-WanderSafe — Baggage delay: S$200 for every 6 hours, maximum S$1,000 (page 2, document dated 1 Jun 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-WanderSafe
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: travel (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-WanderSafe) p2; travel (SYNTHETIC-DPTEST-v11final2-WanderSafe) p2  ·  next question: none  ·  2000 ms

### Q20 — How much hospital cash does Marcus get per day?

```
DearPolicy

Here is what Marcus’s documents state about hospital cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

SYNTHETIC-DPTEST-v11final2-DailyCash — Hospital cash: 150 per day, maximum 60 days (no currency is printed for this amount) (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11final2-DailyCash — Intensive care cash: 300 per day, maximum 10 days (no currency is printed for this amount) (page 2, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-DailyCash
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: hospitalCashNoCurrency (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-DailyCash) p2  ·  next question: none  ·  3349 ms

### Q21 — What is Marcus's death benefit on his TermGuard policy?

```
DearPolicy

Here is what Marcus’s documents state about death cover. Each line shows the page it comes from. SYNTHETIC-DPTEST-v11final2-TermGuard states different figures for death benefit: US$350,000 on page 2 and S$300,000 on page 1. DearPolicy can’t tell which one applies, so it has not picked one; the insurer can confirm. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

SYNTHETIC-DPTEST-v11final2-TermGuard — Terminal illness benefit: Advance of the death benefit (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11final2-TermGuard — Death benefit: US$350,000 (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11final2-TermGuard — Death sum insured: S$300,000 (page 1, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-TermGuard
Your policy document
Page 2
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-TermGuard
Your policy document
Page 1
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: termContradictory (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-TermGuard) p2; termContradictory (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-TermGuard) p1  ·  next question: none  ·  2190 ms

### Q22 — Is Marcus covered for dental treatment?

```
DearPolicy

DearPolicy didn’t find dental cover in the parts of your policies read so far. That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

6 policy contracts still need wording, processing or further review. See the policy review list.

DearPolicy could not check every part of your documents for this, so this is not a finding that it is missing.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  2137 ms

### Q23 — What happens when Marcus's endowment plan matures?

```
DearPolicy

Here is what Marcus’s documents state about maturity or surrender value. Each line shows the page it comes from. Some of this comes from a document dated 1 Jun 2020, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitS$50,000Marcus · Guaranteed maturity benefit

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-FutureSaver, page 2: “Guaranteed maturity benefit S$50,000 payable on 2040-06-01”

SYNTHETIC-DPTEST-v11final2-FutureSaver — Guaranteed maturity benefit: S$50,000 payable on 2040-06-01 (page 2, document dated 1 Jun 2020; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-FutureSaver
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: endowment (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-FutureSaver) p2; endowment (SYNTHETIC-DPTEST-v11final2-FutureSaver) p2  ·  next question: none  ·  1661 ms

### Q24 — Does Marcus have a fracture benefit?

```
DearPolicy

Here is what Marcus’s documents state about accident cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie
Policy-stated coverage limitS$500Marcus · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-AccidentGuard-M, page 2: “Fracture of arm S$500”
Policy-stated coverage limitS$750Marcus · Fracture of leg

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-AccidentGuard-M, page 2: “Fracture of leg S$750”

SYNTHETIC-DPTEST-v11final2-AccidentGuard-M — Fracture of arm: S$500 (page 2, document dated 1 Jan 2025; not confirmed current).

SYNTHETIC-DPTEST-v11final2-AccidentGuard-M — Fracture of leg: S$750 (page 2, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard-M
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: accidentMarcus (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11final2-AccidentGuard-M) p2; accidentMarcus (SYNTHETIC-DPTEST-v11final2-AccidentGuard-M) p2  ·  next question: none  ·  934 ms

### Q25 — Does Marcus have car insurance?

```
DearPolicy

You have no motor policy on file, so there is nothing in your documents to answer this from. The policies on file are: SYNTHETIC-DPTEST-v11final2-TermGuard, SYNTHETIC-DPTEST-v11final2-AccidentGuard-M, SYNTHETIC-DPTEST-v11final2-WanderSafe. If there is a motor policy, upload it and ask again.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

6 policy contracts still need wording, processing or further review. See the policy review list.

DearPolicy could not check every part of your documents for this, so this is not a finding that it is missing.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  2408 ms

### Q26 — Does Marcus have a fracture benefit?

```
DearPolicy

DearPolicy didn’t find fracture cover in the parts of your policies read so far. That isn’t the same as it not being there. Ask again to let DearPolicy read further, check the Benefits page for what has been read, or ask the insurer.

FACTS AND UNCERTAINTIES
Marcus Lim Wei Jie

5 policy contracts still need wording, processing or further review. See the policy review list.

DearPolicy could not check every part of your documents for this, so this is not a finding that it is missing.

Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: none  ·  next question: none  ·  4924 ms

### Q28 — Does Charmaine have a fracture benefit?

```
DearPolicy

Here is what Charmaine’s documents state about accident cover. Each line shows the page it comes from. Some of this comes from a document dated 1 Jan 2025, so it may not reflect the current terms.

FACTS AND UNCERTAINTIES
Charmaine Tan Hui Min
Policy-stated coverage limitS$3,500Charmaine · Fracture of arm

This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.

From SYNTHETIC-DPTEST-v11final2-OtherHouseholdPA, page 2: “Fracture of arm S$3,500”

SYNTHETIC-DPTEST-v11final2-OtherHouseholdPA — Fracture of arm: S$3,500 (page 2, document dated 1 Jan 2025; not confirmed current).

NEXT STEP

Upload the latest renewal notice or premium receipt to confirm the policy is current.

SOURCES
Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-OtherHouseholdPA
Your policy document
Page 2
Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.
```
Citations: otherHouseholdAccident (Synthetic Test Assurance (fictitious) · SYNTHETIC-DPTEST-v11final2-OtherHouseholdPA) p2; otherHouseholdAccident (SYNTHETIC-DPTEST-v11final2-OtherHouseholdPA) p2  ·  next question: none  ·  7778 ms

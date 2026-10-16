# rc-live-1 RE-GRADE with grader v2 (informational only)

The pre-registered rc-live-1 grade is `rc-live-1-grade.md` (grader v1) and stands as written; nothing here changes it
or counts any conversation as successful. This file shows what the stricter v2 grader (written after rc-live-1) finds
in the same transcripts. RCW3 keeps its own v1 scenario checks plus the v2 universal checks here; graded as the v2
wrist control (`gradeRCX`), it FAILS on X2/X3/X4 (see `reliable-chat-check.ts --controls`).

| scenario | verdict |
|---|---|
| RCT1a | FAIL |
| RCT1b | FAIL |
| RCW1a | PASS |
| RCW1b | FAIL |
| RCW2 | PASS |
| RCW3 | PASS |

## RCT1a: FAIL

run RUN-rc-live-1-tan-2026-10-15T12-53-46 -- 17 calls, US$0.005404; send-to-answer per turn: 19693 ms (model 18794 ms); 17074 ms (model 15870 ms); 14971 ms (model 13596 ms)

| id | dim | requirement | result | detail |
|---|---|---|---|---|
| T1C | C | turn 1: the Fracture Benefit for Jun; no amount before the bone is known (no S$10,000 / S$20,000); nothing superseded (15%) or from the other household (S$300,000) | pass |  |
| T1K | K | turn 1: the supported terms -- the leg rows (thigh bone 20%, below the knee 10%) as a percentage of Jun's sum insured (S$100,000) | pass |  |
| T1U | U | turn 1: exactly one necessary question, about which leg bone (thigh / femur vs below the knee / shin / tibia / fibula) | pass |  |
| T2C | C | turn 2: the conditional illustration S$10,000 (below the knee 10% x S$100,000); not S$20,000 | **FAIL** | You told me the doctor said it was the shin bone; that detail does not identify which listed case applies. The FamilyGuard Personal Accident - Policy Wording (page 1) pays the Fracture Benefit as a percentage of Jun's own sum insured (S$100,000 on the FamilyGuard Personal Accident - Policy Schedule) for each listed case: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%; Wrist 5%; Finger or toe 2%. ⏎ Which listed case applies to Jun: a thigh bone (femur), or a bone below t |
| T2S | S | turn 2: from a saved calculation that recomputes to S$10,000, its 10% bound to the wording and its S$100,000 to the schedule | **FAIL** | null |
| T2U | U | turn 2: answers without a further question and without 'couldn't confirm' | **FAIL** | You told me the doctor said it was the shin bone; that detail does not identify which listed case applies. The FamilyGuard Personal Accident - Policy Wording (page 1) pays the Fracture Benefit as a percentage of Jun's own sum insured (S$100,000 on the FamilyGuard Personal Accident - Policy Schedule) for each listed case: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%; Wrist 5%; Finger or toe 2%. ⏎ Which listed case applies to Jun: a thigh bone (femur), or a bone below t |
| T3C | C | turn 3: the corrected illustration S$20,000 (thigh bone 20% x S$100,000); S$10,000 not presented as current | pass |  |
| T3S | S | turn 3: from a saved calculation that recomputes to S$20,000 | pass |  |
| T3U | U | turn 3: the correction is acknowledged and the earlier estimate withdrawn (said, or recorded as withdrawn) | pass |  |
| T3Q | U | turn 3 (v2): the corrected illustration ends the turn -- no further question; the withdrawal is SAID on the page | **FAIL** | Updated: fracture bone is now thigh bone (you said shin bone at first). If the Fracture Benefit applies to Jun's case “Leg - thigh bone (femur)”, the conditional illustration is S$20,000: 20% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision. ⏎ Has the insurer made a reviewed medical decision that Jun’s diagnosis meets the policy’s def |
| R1 | U | turn 1: no question the household cannot answer (what the insurer has reviewed or decided) | pass |  |
| IN1 | C | turn 1: contact / claim advice names only the insurer of the person's own policy (Aurora Assurance) | pass |  |
| O1 | U | turn 1: no orphaned fragment (no line starting mid-sentence or with a dependent clause) | pass |  |
| P1 | U | turn 1: no promise of payment (a sentence saying it is NOT a promise is fine) | pass |  |
| G1 | S | turn 1: the save-time gate rejected nothing | pass |  |
| R2 | U | turn 2: no question the household cannot answer (what the insurer has reviewed or decided) | pass |  |
| IN2 | C | turn 2: contact / claim advice names only the insurer of the person's own policy (Aurora Assurance) | pass |  |
| O2 | U | turn 2: no orphaned fragment (no line starting mid-sentence or with a dependent clause) | pass |  |
| P2 | U | turn 2: no promise of payment (a sentence saying it is NOT a promise is fine) | pass |  |
| G2 | S | turn 2: the save-time gate rejected nothing | pass |  |
| R3 | U | turn 3: no question the household cannot answer (what the insurer has reviewed or decided) | **FAIL** | Has the insurer made a reviewed medical decision that Jun’s diagnosis meets the policy’s definition of “Leg - thigh bone (femur)”? |
| IN3 | C | turn 3: contact / claim advice names only the insurer of the person's own policy (Aurora Assurance) | pass |  |
| O3 | U | turn 3: no orphaned fragment (no line starting mid-sentence or with a dependent clause) | pass |  |
| P3 | U | turn 3: no promise of payment (a sentence saying it is NOT a promise is fine) | pass |  |
| G3 | S | turn 3: the save-time gate rejected nothing | pass |  |

Visible answers:

- **My son Jun fractured his leg at football training. What could his personal accident policy pay?**

```
The FamilyGuard Personal Accident - Policy Wording (page 1) pays the Fracture Benefit as a percentage of Jun's own sum insured (S$100,000 on the FamilyGuard Personal Accident - Policy Schedule) for each listed case: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%; Wrist 5%; Finger or toe 2%.
Which bone was fractured: Jun’s thigh bone (femur), or a bone below the knee (tibia or fibula)?
```

- **The doctor said it was the shin bone.**

```
You told me the doctor said it was the shin bone; that detail does not identify which listed case applies. The FamilyGuard Personal Accident - Policy Wording (page 1) pays the Fracture Benefit as a percentage of Jun's own sum insured (S$100,000 on the FamilyGuard Personal Accident - Policy Schedule) for each listed case: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%; Wrist 5%; Finger or toe 2%.
Which listed case applies to Jun: a thigh bone (femur), or a bone below the knee (tibia or fibula)?
```

- **Sorry, I got that wrong - the X-ray shows it was his thigh bone.**

```
Updated: fracture bone is now thigh bone (you said shin bone at first). If the Fracture Benefit applies to Jun's case “Leg - thigh bone (femur)”, the conditional illustration is S$20,000: 20% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.
Has the insurer made a reviewed medical decision that Jun’s diagnosis meets the policy’s definition of “Leg - thigh bone (femur)”?
```

## RCT1b: FAIL

run RUN-rc-live-1-tan-2026-10-15T12-53-46 -- 18 calls, US$0.005596; send-to-answer per turn: 19917 ms (model 18669 ms); 17023 ms (model 15815 ms); 22880 ms (model 22079 ms)

| id | dim | requirement | result | detail |
|---|---|---|---|---|
| T1C | C | turn 1: the Fracture Benefit for Jun; no amount before the bone is known (no S$10,000 / S$20,000); nothing superseded (15%) or from the other household (S$300,000) | pass |  |
| T1K | K | turn 1: the supported terms -- the leg rows (thigh bone 20%, below the knee 10%) as a percentage of Jun's sum insured (S$100,000) | pass |  |
| T1U | U | turn 1: exactly one necessary question, about which leg bone (thigh / femur vs below the knee / shin / tibia / fibula) | pass |  |
| T2C | C | turn 2: the conditional illustration S$10,000 (below the knee 10% x S$100,000); not S$20,000 | pass |  |
| T2S | S | turn 2: from a saved calculation that recomputes to S$10,000, its 10% bound to the wording and its S$100,000 to the schedule | pass |  |
| T2U | U | turn 2: answers without a further question and without 'couldn't confirm' | pass |  |
| T3C | C | turn 3: the corrected illustration S$20,000 (thigh bone 20% x S$100,000); S$10,000 not presented as current | pass |  |
| T3S | S | turn 3: from a saved calculation that recomputes to S$20,000 | pass |  |
| T3U | U | turn 3: the correction is acknowledged and the earlier estimate withdrawn (said, or recorded as withdrawn) | pass |  |
| T3Q | U | turn 3 (v2): the corrected illustration ends the turn -- no further question; the withdrawal is SAID on the page | **FAIL** | Updated: fracture bone is now thigh bone (you said shin bone at first). The earlier estimate worked out from it no longer applies. If the Fracture Benefit applies to Jun's case “Leg - thigh bone (femur)”, the conditional illustration is S$20,000: 20% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision. The policy says the Fracture Benefi |
| R1 | U | turn 1: no question the household cannot answer (what the insurer has reviewed or decided) | pass |  |
| IN1 | C | turn 1: contact / claim advice names only the insurer of the person's own policy (Aurora Assurance) | pass |  |
| O1 | U | turn 1: no orphaned fragment (no line starting mid-sentence or with a dependent clause) | pass |  |
| P1 | U | turn 1: no promise of payment (a sentence saying it is NOT a promise is fine) | pass |  |
| G1 | S | turn 1: the save-time gate rejected nothing | pass |  |
| R2 | U | turn 2: no question the household cannot answer (what the insurer has reviewed or decided) | pass |  |
| IN2 | C | turn 2: contact / claim advice names only the insurer of the person's own policy (Aurora Assurance) | pass |  |
| O2 | U | turn 2: no orphaned fragment (no line starting mid-sentence or with a dependent clause) | pass |  |
| P2 | U | turn 2: no promise of payment (a sentence saying it is NOT a promise is fine) | pass |  |
| G2 | S | turn 2: the save-time gate rejected nothing | pass |  |
| R3 | U | turn 3: no question the household cannot answer (what the insurer has reviewed or decided) | **FAIL** | Has the insurer reviewed Jun’s diagnosis and confirmed that it meets the policy’s definition of “Leg - thigh bone (femur)”? |
| IN3 | C | turn 3: contact / claim advice names only the insurer of the person's own policy (Aurora Assurance) | pass |  |
| O3 | U | turn 3: no orphaned fragment (no line starting mid-sentence or with a dependent clause) | pass |  |
| P3 | U | turn 3: no promise of payment (a sentence saying it is NOT a promise is fine) | pass |  |
| G3 | S | turn 3: the save-time gate rejected nothing | pass |  |

Visible answers:

- **My son Jun fractured his leg at football training. What could his personal accident policy pay?**

```
I’m sorry Jun was hurt. Jun’s FamilyGuard Fracture Benefit lists 20% of his Sum Insured for a thigh-bone fracture and 10% for a fracture below the knee; it applies only when the fracture was caused by an Accident and confirmed by X-ray. Jun’s personal accident schedule lists a Sum Insured of S$100,000.
Which bone did Jun fracture: the thigh bone (femur), or a bone below the knee (tibia or fibula)?
```

- **The doctor said it was the shin bone.**

```
You told me the doctor said it was the shin bone.
If the Fracture Benefit applies to Jun's case “Leg - below the knee (tibia or fibula)”, the conditional illustration is S$10,000: 10% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.
Suggestion, not stated in your documents (confirm with the insurer): send the documents that show the policy’s condition is met with the insurer’s claim form.
```

- **Sorry, I got that wrong - the X-ray shows it was his thigh bone.**

```
Updated: fracture bone is now thigh bone (you said shin bone at first). The earlier estimate worked out from it no longer applies. If the Fracture Benefit applies to Jun's case “Leg - thigh bone (femur)”, the conditional illustration is S$20,000: 20% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision. The policy says the Fracture Benefit applies to a fracture caused by an Accident and confirmed by X-ray.
Has the insurer reviewed Jun’s diagnosis and confirmed that it meets the policy’s definition of “Leg - thigh bone (femur)”?
```

## RCW1a: PASS

run RUN-rc-live-1-wong-2026-10-15T12-56-42 -- 5 calls, US$0.001176; send-to-answer per turn: 13712 ms (model 12615 ms)

| id | dim | requirement | result | detail |
|---|---|---|---|---|
| W1C | C | S$2,500, conditional; never a product of the S$1,000,000 / S$600,000 sums (no S$300,000 / S$500,000 / S$3,000,000) | pass |  |
| W1K | K | the terms: 50% of the Simple Fracture Benefit Limit of S$5,000 | pass |  |
| W1S | S | from a saved calculation that recomputes to S$2,500 with 50% and S$5,000 bound to the Summary of Benefits | pass |  |
| W1U | U | answers without 'couldn't confirm' and without a question (the case is given) | pass |  |
| R1 | U | turn 1: no question the household cannot answer (what the insurer has reviewed or decided) | pass |  |
| IN1 | C | turn 1: contact / claim advice names only the insurer of the person's own policy (Kestrel Life Ltd) | pass |  |
| O1 | U | turn 1: no orphaned fragment (no line starting mid-sentence or with a dependent clause) | pass |  |
| P1 | U | turn 1: no promise of payment (a sentence saying it is NOT a promise is fine) | pass |  |
| G1 | S | turn 1: the save-time gate rejected nothing | pass |  |

Visible answers:

- **Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.**

```
If the Simple Fracture benefit applies to Adrian's case “Jaw, Pelvis, Leg^, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Public Officers Group Personal Accident - Summary of Benefits; it is an illustration from the document's terms, not a payment or an insurer's decision.
```

## RCW1b: FAIL

run RUN-rc-live-1-wong-2026-10-15T12-56-42 -- 7 calls, US$0.001452; send-to-answer per turn: 17814 ms (model 16559 ms)

| id | dim | requirement | result | detail |
|---|---|---|---|---|
| W1C | C | S$2,500, conditional; never a product of the S$1,000,000 / S$600,000 sums (no S$300,000 / S$500,000 / S$3,000,000) | **FAIL** | The summary lists Leg under the Simple Fracture schedule, but the uploaded summary does not establish whether Adrian’s diagnosis meets its definition. ⏎ I haven’t given a what-if amount for “Simple Fracture” in Public Officers Group Personal Accident - Summary of Benefits, because I couldn’t confirm the figures it uses against your documents. ⏎ Contact KestrelOne (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Personal Accident - Summary of B |
| W1K | K | the terms: 50% of the Simple Fracture Benefit Limit of S$5,000 | **FAIL** | The summary lists Leg under the Simple Fracture schedule, but the uploaded summary does not establish whether Adrian’s diagnosis meets its definition. ⏎ I haven’t given a what-if amount for “Simple Fracture” in Public Officers Group Personal Accident - Summary of Benefits, because I couldn’t confirm the figures it uses against your documents. ⏎ Contact KestrelOne (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Personal Accident - Summary of B |
| W1S | S | from a saved calculation that recomputes to S$2,500 with 50% and S$5,000 bound to the Summary of Benefits | **FAIL** | null |
| W1U | U | answers without 'couldn't confirm' and without a question (the case is given) | **FAIL** | The summary lists Leg under the Simple Fracture schedule, but the uploaded summary does not establish whether Adrian’s diagnosis meets its definition. ⏎ I haven’t given a what-if amount for “Simple Fracture” in Public Officers Group Personal Accident - Summary of Benefits, because I couldn’t confirm the figures it uses against your documents. ⏎ Contact KestrelOne (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Personal Accident - Summary of B |
| R1 | U | turn 1: no question the household cannot answer (what the insurer has reviewed or decided) | pass |  |
| IN1 | C | turn 1: contact / claim advice names only the insurer of the person's own policy (Kestrel Life Ltd) | **FAIL** | KestrelOne: Contact KestrelOne (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Personal Accident - Summary of Benefits to ask what it needs for a claim. |
| O1 | U | turn 1: no orphaned fragment (no line starting mid-sentence or with a dependent clause) | pass |  |
| P1 | U | turn 1: no promise of payment (a sentence saying it is NOT a promise is fine) | pass |  |
| G1 | S | turn 1: the save-time gate rejected nothing | **FAIL** | [{"where":"summary","figure":"S$2,500","reason":"an illustration is given though the household did not ask a what-if"}] |

Visible answers:

- **Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.**

```
The summary lists Leg under the Simple Fracture schedule, but the uploaded summary does not establish whether Adrian’s diagnosis meets its definition.
I haven’t given a what-if amount for “Simple Fracture” in Public Officers Group Personal Accident - Summary of Benefits, because I couldn’t confirm the figures it uses against your documents.
Contact KestrelOne (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Personal Accident - Summary of Benefits to ask what it needs for a claim.
```

## RCW2: PASS

run RUN-rc-live-1-wong-2026-10-15T12-56-42 -- 6 calls, US$0.001997; send-to-answer per turn: 22673 ms (model 21461 ms)

| id | dim | requirement | result | detail |
|---|---|---|---|---|
| DR1 | S | Adrian's dated amounts: Group Term Life S$1,000,000 and Group Personal Accident S$600,000, each with the certificate date (6 October 2022), each bound to Adrian's own certificate row | pass |  |
| DR2 | U | useful, supported contact advice: a step to contact / notify the person's own insurer (Kestrel) or the scheme administrator / employer | pass |  |
| DR3 | C | uncertainty about cover on the event date is stated as uncertainty, and nothing is stated as an exclusion | pass |  |
| DR4 | C | no recommendation to contact or claim from an unrelated insurer (Harbourline / travel), and its wording is not presented as Adrian's cover | pass |  |
| DR5 | C | no dismemberment condition (365 days) borrowed into the death benefit | pass |  |
| DR6 | C | no invented mandatory paperwork (the wording prints only 'proof of death and the relevant documents in our prescribed form'; anything more is a suggestion, labelled as one) | pass |  |
| DR7 | U | no unrelated benefit fallback or unrelated figure (only the certificate's S$1,000,000 / S$600,000 and the allowance's S$3,000 / S$1,500 may appear) | pass |  |
| DK | K | the Accidental Death benefit (100% of the Sum Insured) is explained | pass |  |
| R1 | U | turn 1: no question the household cannot answer (what the insurer has reviewed or decided) | pass |  |
| IN1 | C | turn 1: contact / claim advice names only the insurer of the person's own policy (Kestrel Life Ltd) | pass |  |
| O1 | U | turn 1: no orphaned fragment (no line starting mid-sentence or with a dependent clause) | pass |  |
| P1 | U | turn 1: no promise of payment (a sentence saying it is NOT a promise is fine) | pass |  |
| G1 | S | turn 1: the save-time gate rejected nothing | pass |  |

Visible answers:

- **Hypothetically, Adrian was killed in a road accident in Malaysia on 3 October 2026. Which of his benefits may apply, and what should I do first?**

```
You said, “Hypothetically, Adrian was killed in a road accident in Malaysia on 3 October 2026.”
Adrian’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; this is the amount recorded on that date, not confirmation of cover on the hypothetical event date.
Adrian’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022; this is the amount recorded on that date, not confirmation of cover on the hypothetical event date.
The Public Officers Group Personal Accident - Summary of Benefits (page 9) prints Accidental Death: 100% of the Sum Insured.
The summary lists a S$3,000 Death due to Accident compassionate allowance only for insured persons enrolled for that optional cover; Adrian’s enrollment is not established in the uploaded documents.
The uploaded travel wording says accidental-death cover applies only to a journey shown in a schedule issued to the insured.
The uploaded documents do not confirm a travel schedule or personal travel cover for Adrian.
The group accident wording says the Compassionate Death Allowance requires proof of death and relevant documents in the insurer’s prescribed form.
The uploaded documents do not establish whether the Malaysia event would meet the policy’s definitions and conditions, or whether Adrian’s cover was in force on 3 October 2026.
Contact Kestrel Life Ltd (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

## RCW3: PASS

run RUN-rc-live-1-wong-2026-10-15T12-56-42 -- 4 calls, US$0.001462; send-to-answer per turn: 12313 ms (model 10931 ms)

| id | dim | requirement | result | detail |
|---|---|---|---|---|
| I1 | U | no household inventory (no per-person document list, no unlinked / unreadable file lines) | pass |  |
| I2 | C | names Adrian's accident cover (Group Personal Accident / its fracture benefits); never recommends the travel insurer (Harbourline) | pass |  |
| I3 | K | the fracture terms that decide it: Simple Fracture (wrist row 40% of S$5,000) and / or Other Fracture (a percentage of the Sum Insured), or the one question that separates them (closed / open) | pass |  |
| I4 | S | any illustrated amount comes from a saved calculation that recomputes (S$2,000 for the Simple Fracture wrist row) | pass |  |
| I5 | U | answers the question (no 'couldn't confirm') | pass |  |
| R1 | U | turn 1: no question the household cannot answer (what the insurer has reviewed or decided) | pass |  |
| IN1 | C | turn 1: contact / claim advice names only the insurer of the person's own policy (Kestrel Life Ltd) | pass |  |
| O1 | U | turn 1: no orphaned fragment (no line starting mid-sentence or with a dependent clause) | pass |  |
| P1 | U | turn 1: no promise of payment (a sentence saying it is NOT a promise is fine) | pass |  |
| G1 | S | turn 1: the save-time gate rejected nothing | pass |  |

Visible answers:

- **Which of my uploaded policies should I claim under for Adrian's broken wrist from a cycling accident?**

```
The Public Officers Group Personal Accident summary lists Simple Fracture cases as neck, skull or spine (full break), hip, and jaw, pelvis, leg or ankle/knee; a wrist is not listed. The Public Officers Group Personal Accident wording lists Other Fracture cases as skull, hip, and jaw, pelvis, leg, ankle or knee; a wrist is not listed. The uploaded documents do not establish a listed fracture case for Adrian's wrist, so they do not show which fracture benefit applies.
Which listed fracture case applies to Adrian: neck, skull or spine (full break); hip; or jaw, pelvis, leg, ankle or knee?
```


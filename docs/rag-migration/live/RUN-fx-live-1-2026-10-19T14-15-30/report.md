# fx-live-1: fx-live-1

Candidate SHA: `e04cb61d6816c15e4ff7dce30027525bddcb2c00` · model `gpt-6-luna` · complete: **true**

## Verdicts (graders v1; a PASS never excuses an unhelpful answer — the answers are below)

| case | conversation | A: current pipeline | B: diagnostic baseline |
|---|---|---|---|
| K1 | K1 | PASS | PASS |
| K2 | K2 | FAIL — K2.3, K2.5 | FAIL — K2.3 |
| K3 (regression data) | K3a | FAIL — V0 | FAIL — K3a.1, K3a.2, K3a.5, K3a.7, K3b.4, K3b.5, K3b.7, K3b.10 |
| K3 (regression data) | K3b | FAIL — V0 | FAIL — K3a.2, K3a.4, K3a.5, K3a.7, K3b.4, K3b.5, K3b.10 |
| K4a (regression data) | K3a | FAIL — V0, K4a.8 | FAIL — K4a.8 |
| K4a (regression data) | K3b | FAIL — K4a.8 | FAIL — K4a.8 |
| K4b | K4b | FAIL — V0 | FAIL — K4b.1, K4b.2, K4b.4, K4b.5, K4b.7 |
| K6a | K6a | FAIL — V0 | PASS |
| K6b | K6b | FAIL — G1, V0, K6b.1 | FAIL — K6b.3 |

## Stage by stage (gating checks passed / failed, summed over cases)

| stage | A pass | A fail | B pass | B fail |
|---|---|---|---|---|
| R retrieval (A only) | 7 | 0 | 0 | 0 |
| E reasoning with the evidence | 58 | 4 | 46 | 16 |
| C calculation | 31 | 0 | 25 | 6 |
| V verification | 3 | 6 | 9 | 0 |
| S saved / displayed (A only) | 30 | 0 | 0 | 0 |
| U usefulness | 44 | 2 | 35 | 2 |

## Cost and latency

- model calls: 55 (A 43, B 12; errors 0); estimated cost US$0.023623 (application price on file, cached input at its rate; not provider-billed); upper bound without the cached discount US$0.055757
- model time as measured at the workbench (upstream): 176.7 s over 55 calls

| conversation | arm | turn | model calls | in/out tokens | upstream s | tool s | cost US$ |
|---|---|---|---|---|---|---|---|
| K1 | A | 1 | 2 | 19417/141 | 5.9 | 0.09 | 0.000693 |
| K2 | A | 1 | 3 | 33716/414 | 10.8 | 0.13 | 0.001765 |
| K3a | A | 1 | 3 | 33034/385 | 10.0 | 0.12 | 0.001056 |
| K3a | A | 2 | 2 | 18098/522 | 7.5 | 0.03 | 0.001337 |
| K3a | A | 3 | 6 | 59817/1499 | 18.5 | 0.04 | 0.003258 |
| K3b | A | 1 | 5 | 60495/1000 | 19.9 | 0.19 | 0.001984 |
| K3b | A | 2 | 3 | 28663/942 | 11.6 | 0.03 | 0.001032 |
| K3b | A | 3 | 3 | 28148/469 | 8.7 | 0.04 | 0.002252 |
| K4b | A | 1 | 3 | 35686/502 | 10.6 | 0.27 | 0.001383 |
| K4b | A | 2 | 4 | 45162/597 | 11.8 | 0.13 | 0.002902 |
| K6a | A | 1 | 5 | 57746/444 | 14.4 | 0.19 | 0.002896 |
| K6b | A | 1 | 4 | 43811/280 | 12.3 | 0.11 | 0.001339 |
| K1 | B | 1 | 1 | 4070/36 | 2.4 | — | 0.000425 |
| K2 | B | 1 | 1 | 4082/102 | 2.7 | — | 0.000094 |
| K3a | B | 1 | 1 | 4069/189 | 3.8 | — | 0.000137 |
| K3a | B | 2 | 1 | 4280/166 | 2.9 | — | 0.000145 |
| K3a | B | 3 | 1 | 4464/120 | 3.5 | — | 0.000121 |
| K3b | B | 1 | 1 | 4069/130 | 2.8 | — | 0.000106 |
| K3b | B | 2 | 1 | 4221/184 | 3.7 | — | 0.000148 |
| K3b | B | 3 | 1 | 4423/152 | 3.4 | — | 0.000139 |
| K4b | B | 1 | 1 | 4069/197 | 2.8 | — | 0.000139 |
| K4b | B | 2 | 1 | 4285/117 | 2.9 | — | 0.000121 |
| K6a | B | 1 | 1 | 4076/63 | 2.2 | — | 0.000074 |
| K6b | B | 1 | 1 | 4070/68 | 1.8 | — | 0.000076 |

## Failed gating checks

- **K2 / K2 / arm A / K2.3** (E): what the documents do not show for sickness is said (the certificate lists Living Care / Living Care Plus; no page describes them)
  ```
  The Scheme X Group Insurance (page 9) prints the J, Accidental Hospital Recuperation Benefit, 250 (printed with a bare “$” sign; the Scheme X Group Insurance does not say which currency), with the printed conditions “In addition to the specific exclusions listed below”, “if within 30 days following bodily injury as a result of an Accident”, “it is medically necessary due to the said injury (whether directly or indirectly necessary) of the Insured Person to be confined as a resident patient in a Hospital for a continuous period of at least 24 hours on the recommendation of a Registered Medical Practitioner but not for the purpose of convalescent rest”, “Subsequent hospitalisation resulting fr
  ```
- **K2 / K2 / arm A / K2.5** (U): no question (the household already said it was sickness)
  ```
  ["Did Grace’s hospitalisation follow a bodily injury caused by an accident, or was it due to illness without an accident?"]
  ```
- **K3 / K3a / arm A / V0** (V): nothing the composer or the save-time gate removed, and no notice that an amount was left out
  ```
  [{"dropped":[{"reason":"not supported by its evidence: “that requires the insurer’s medical assessment.”: its evidence does not mention what it is about (requir, insurer, medical, assessment)","sentence":"The documents leave open whether Grace’s diagnosis meets the policy’s definition of this fracture case; that requires the insurer’s medical assessment."}],"gate":[]},{"dropped":[{"reason":"states cover or a figure without citing evidence","sentence":"The uploaded documents do not establish which of these two benefits applies to Grace’s event."}],"gate":[]}]
  ```
- **K4a / K3a / arm A / V0** (V): nothing the composer or the save-time gate removed, and no notice that an amount was left out
  ```
  [{"dropped":[{"reason":"not supported by its evidence: its evidence does not mention what it is about (both, illustration, remain, subject)","sentence":"Both illustrations remain subject to the insurer’s medical review of whether Grace’s diagnosis meets the relevant policy definition."}],"gate":[]}]
  ```
- **K4a / K3a / arm A / K4a.8** (E): the correction is acknowledged and the answer is about the leg
  ```
  Updated: injury is now broke her leg (you said broke her arm at first). The earlier estimate worked out from it no longer applies.
  The illustrations are alternatives from separate documents, not a total.
  If the Simple Fracture benefit applies to Grace's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.
  If the Simple Fracture or Other Fracture due to Accident benefit applies to Grace's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents pri
  ```
- **K3 / K3b / arm A / V0** (V): nothing the composer or the save-time gate removed, and no notice that an amount was left out
  ```
  [{"dropped":[{"reason":"not supported by its evidence: “that requires the insurer’s medical assessment.”: its evidence does not mention what it is about (requir, insurer, medical, assessment)","sentence":"The documents require the fracture to meet the relevant policy definition, but do not establish that Grace’s diagnosis does; that requires the insurer’s medical assessment."}],"gate":[]},{"dropped":[{"reason":"not supported by its evidence: “each requires the insurer’s medical assessment against its own definition.”: its evidence does not mention what it is about (requir, insurer, medical, assessment)","sentence":"The documents do not establish which fracture benefit applies to Grace’s case
  ```
- **K4a / K3b / arm A / K4a.8** (E): the correction is acknowledged and the answer is about the leg
  ```
  Updated: injury is now broke her leg (you said broke her arm at first). The earlier estimate worked out from it no longer applies.
  The documents do not establish which of these different provisions applies to Grace’s injury.
  If the Simple Fracture benefit applies to Grace's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.
  If the Simple Fracture or Other Fracture due to Accident benefit applies to Grace's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”
  ```
- **K4b / K4b / arm A / V0** (V): nothing the composer or the save-time gate removed, and no notice that an amount was left out
  ```
  [{"dropped":[{"reason":"not supported by its evidence: it is about Lee Wei Ming, Daniel but its evidence was read for someone else","sentence":"The uploaded wording does not establish which of these two fracture benefits applies to Daniel’s event."}],"gate":[]}]
  ```
- **K6a / K6a / arm A / V0** (V): nothing the composer or the save-time gate removed, and no notice that an amount was left out
  ```
  [{"dropped":[{"reason":"not supported by its evidence: its evidence does not mention what it is about (available)","sentence":"The uploaded documents available here do not establish what Group Living Care pays for cancer or the cancer-specific conditions, so I can’t determine a cancer benefit from them."}],"gate":[]}]
  ```
- **K6b / K6b / arm A / G1** (U): no refusal / “couldn't confirm” / model-error text, and no empty answer
  ```
  I couldn’t confirm an answer to that from your documents.
  ```
- **K6b / K6b / arm A / V0** (V): nothing the composer or the save-time gate removed, and no notice that an amount was left out
  ```
  [{"dropped":[{"reason":"not supported by its evidence: “The uploaded documents I found for Grace do not establish cover for dental treatment”: its evidence does not mention what it is about (found)","sentence":"The uploaded documents I found for Grace do not establish cover for dental treatment; the Scheme X Group Insurance wording and certificate do not state a dental benefit, so I can’t confirm that her treatment would be paid."}],"gate":[]}]
  ```
- **K6b / K6b / arm A / K6b.1** (E): the answer says no dental benefit is shown in the documents available
  ```
  I couldn’t confirm an answer to that from your documents.
  ```
- **K2 / K2 / arm B / K2.3** (E): what the documents do not show for sickness is said (the certificate lists Living Care / Living Care Plus; no page describes them)
  ```
  The documents do not show a benefit for hospitalisation due to sickness. Grace’s accidental hospital recuperation benefit applies only when hospital confinement is medically necessary because of an accidental bodily injury, for at least 24 continuous hours; it pays $250 once per hospitalisation. (Benefit Summary, p. 9.) Her certificate confirms Group Personal Accident cover of S$600,000, but that alone does not establish a sickness-hospitalisation benefit. (Certificate of Insurance, p. 1.)
  ```
- **K3 / K3a / arm B / K3a.1** (C): the summary's figure S$1,250 (percentage of the fixed S$5,000 limit) is given
  ```
  Grace is listed with **S$600,000 Group Personal Accident cover**, effective 6 October 2022. (Certificate of Insurance, p. 1)
  
  The documents describe accident-related fracture benefits, but the amount depends on whether her arm fracture qualifies as a **simple fracture** or an **other fracture**. The Benefit Summary lists **20% of the sum insured** for an arm fracture classified as an “Other Fracture”; it does not specify an arm benefit for a simple fracture. (Benefit Summary, p. 8) The Product Summary separately lists a **S$5,000 simple-fracture benefit limit** and says arm fractures are compensated at 25% of that limit, but excludes fractures of the thumb, finger, and palm. (Product Summary
  ```
- **K3 / K3a / arm B / K3a.2** (C): the certificate highlights' figure S$120,000 (percentage of Grace's S$600,000 sum insured) is given
  ```
  Grace is listed with **S$600,000 Group Personal Accident cover**, effective 6 October 2022. (Certificate of Insurance, p. 1)
  
  The documents describe accident-related fracture benefits, but the amount depends on whether her arm fracture qualifies as a **simple fracture** or an **other fracture**. The Benefit Summary lists **20% of the sum insured** for an arm fracture classified as an “Other Fracture”; it does not specify an arm benefit for a simple fracture. (Benefit Summary, p. 8) The Product Summary separately lists a **S$5,000 simple-fracture benefit limit** and says arm fractures are compensated at 25% of that limit, but excludes fractures of the thumb, finger, and palm. (Product Summary
  ```
- **K3 / K3a / arm B / K3a.5** (E): the answer says why they differ in the documents' own terms (the summary points to the certificate for the precise terms; the certificate is not the contract; neither says which applies)
  ```
  Grace is listed with **S$600,000 Group Personal Accident cover**, effective 6 October 2022. (Certificate of Insurance, p. 1)
  
  The documents describe accident-related fracture benefits, but the amount depends on whether her arm fracture qualifies as a **simple fracture** or an **other fracture**. The Benefit Summary lists **20% of the sum insured** for an arm fracture classified as an “Other Fracture”; it does not specify an arm benefit for a simple fracture. (Benefit Summary, p. 8) The Product Summary separately lists a **S$5,000 simple-fracture benefit limit** and says arm fractures are compensated at 25% of that limit, but excludes fractures of the thumb, finger, and palm. (Product Summary
  ```
- **K3 / K3a / arm B / K3a.7** (E): conditional, not an approved payment (an illustration if the fall caused a covered fracture)
  ```
  Grace is listed with **S$600,000 Group Personal Accident cover**, effective 6 October 2022. (Certificate of Insurance, p. 1)
  
  The documents describe accident-related fracture benefits, but the amount depends on whether her arm fracture qualifies as a **simple fracture** or an **other fracture**. The Benefit Summary lists **20% of the sum insured** for an arm fracture classified as an “Other Fracture”; it does not specify an arm benefit for a simple fracture. (Benefit Summary, p. 8) The Product Summary separately lists a **S$5,000 simple-fracture benefit limit** and says arm fractures are compensated at 25% of that limit, but excludes fractures of the thumb, finger, and palm. (Product Summary
  ```
- **K3 / K3a / arm B / K3b.4** (E): the two bases are named (a fixed limit; the sum insured) and the answer says they are alternatives that are not added
  ```
  An X-ray and a registered medical practitioner’s certification confirm the injury, but the documents don’t say that those facts alone determine whether it qualifies as a **simple fracture** or an **other fracture**.
  
  If it is an **other fracture** of the arm, the Benefit Summary lists compensation of **20% of the S$600,000 sum insured**—S$120,000—subject to the policy terms and claim approval. (Certificate of Insurance, p. 1; Benefit Summary, p. 8) If it is a **simple fracture**, the Product Summary lists **25% of the S$5,000 simple-fracture limit**—S$1,250—for an arm fracture, excluding thumb, finger, and palm fractures. (Product Summary, p. 13)
  ```
- **K3 / K3a / arm B / K3b.5** (E): the answer says why they differ in the documents' own terms (the summary points to the certificate for the precise terms; the certificate is not the contract; neither says which applies)
  ```
  An X-ray and a registered medical practitioner’s certification confirm the injury, but the documents don’t say that those facts alone determine whether it qualifies as a **simple fracture** or an **other fracture**.
  
  If it is an **other fracture** of the arm, the Benefit Summary lists compensation of **20% of the S$600,000 sum insured**—S$120,000—subject to the policy terms and claim approval. (Certificate of Insurance, p. 1; Benefit Summary, p. 8) If it is a **simple fracture**, the Product Summary lists **25% of the S$5,000 simple-fracture limit**—S$1,250—for an arm fracture, excluding thumb, finger, and palm fractures. (Product Summary, p. 13)
  ```
- **K3 / K3a / arm B / K3b.7** (E): conditional, not an approved payment (an illustration if the fall caused a covered fracture)
  ```
  An X-ray and a registered medical practitioner’s certification confirm the injury, but the documents don’t say that those facts alone determine whether it qualifies as a **simple fracture** or an **other fracture**.
  
  If it is an **other fracture** of the arm, the Benefit Summary lists compensation of **20% of the S$600,000 sum insured**—S$120,000—subject to the policy terms and claim approval. (Certificate of Insurance, p. 1; Benefit Summary, p. 8) If it is a **simple fracture**, the Product Summary lists **25% of the S$5,000 simple-fracture limit**—S$1,250—for an arm fracture, excluding thumb, finger, and palm fractures. (Product Summary, p. 13)
  ```
- **K3 / K3a / arm B / K3b.10** (U): turn 2: a supported next step (contact the insurer on the certificate) is given
  ```
  An X-ray and a registered medical practitioner’s certification confirm the injury, but the documents don’t say that those facts alone determine whether it qualifies as a **simple fracture** or an **other fracture**.
  
  If it is an **other fracture** of the arm, the Benefit Summary lists compensation of **20% of the S$600,000 sum insured**—S$120,000—subject to the policy terms and claim approval. (Certificate of Insurance, p. 1; Benefit Summary, p. 8) If it is a **simple fracture**, the Product Summary lists **25% of the S$5,000 simple-fracture limit**—S$1,250—for an arm fracture, excluding thumb, finger, and palm fractures. (Product Summary, p. 13)
  ```
- **K4a / K3a / arm B / K4a.8** (E): the correction is acknowledged and the answer is about the leg
  ```
  For Grace’s **leg fracture**, the documents list:
  
  - **Simple fracture:** 50% of the S$5,000 simple-fracture limit, or **S$2,500**. (Product Summary, p. 13)
  - **Other fracture:** 50% of her S$600,000 accident sum insured, or **S$300,000**. (Certificate of Insurance, p. 1; Benefit Summary, p. 8)
  
  The documents don’t say which category her X-ray-confirmed fracture falls into, or confirm claim approval.
  ```
- **K3 / K3b / arm B / K3a.2** (C): the certificate highlights' figure S$120,000 (percentage of Grace's S$600,000 sum insured) is given
  ```
  Grace is listed with **S$600,000 Group Personal Accident cover** (Certificate of Insurance, p. 1). The documents say an accidental arm fracture may qualify for a benefit, but the amount depends on the fracture type: **25% of S$5,000 (S$1,250) for a simple fracture** in the Product Summary (p. 12), or **20% of the sum insured for an “other fracture”** in the Benefit Summary (p. 8). The documents don’t establish which category Grace’s fracture falls into, or whether her fall meets the policy’s claim requirements.
  ```
- **K3 / K3b / arm B / K3a.4** (E): the two bases are named (a fixed limit; the sum insured) and the answer says they are alternatives that are not added
  ```
  Grace is listed with **S$600,000 Group Personal Accident cover** (Certificate of Insurance, p. 1). The documents say an accidental arm fracture may qualify for a benefit, but the amount depends on the fracture type: **25% of S$5,000 (S$1,250) for a simple fracture** in the Product Summary (p. 12), or **20% of the sum insured for an “other fracture”** in the Benefit Summary (p. 8). The documents don’t establish which category Grace’s fracture falls into, or whether her fall meets the policy’s claim requirements.
  ```
- **K3 / K3b / arm B / K3a.5** (E): the answer says why they differ in the documents' own terms (the summary points to the certificate for the precise terms; the certificate is not the contract; neither says which applies)
  ```
  Grace is listed with **S$600,000 Group Personal Accident cover** (Certificate of Insurance, p. 1). The documents say an accidental arm fracture may qualify for a benefit, but the amount depends on the fracture type: **25% of S$5,000 (S$1,250) for a simple fracture** in the Product Summary (p. 12), or **20% of the sum insured for an “other fracture”** in the Benefit Summary (p. 8). The documents don’t establish which category Grace’s fracture falls into, or whether her fall meets the policy’s claim requirements.
  ```
- **K3 / K3b / arm B / K3a.7** (E): conditional, not an approved payment (an illustration if the fall caused a covered fracture)
  ```
  Grace is listed with **S$600,000 Group Personal Accident cover** (Certificate of Insurance, p. 1). The documents say an accidental arm fracture may qualify for a benefit, but the amount depends on the fracture type: **25% of S$5,000 (S$1,250) for a simple fracture** in the Product Summary (p. 12), or **20% of the sum insured for an “other fracture”** in the Benefit Summary (p. 8). The documents don’t establish which category Grace’s fracture falls into, or whether her fall meets the policy’s claim requirements.
  ```
- **K3 / K3b / arm B / K3b.4** (E): the two bases are named (a fixed limit; the sum insured) and the answer says they are alternatives that are not added
  ```
  An X-ray and a registered medical practitioner’s certification confirm the fracture, but the documents don’t say that this alone determines whether it is a **simple fracture** or an **other fracture**.
  
  If it is a **simple arm fracture**, the Product Summary lists a benefit of **25% of S$5,000 = S$1,250** (Product Summary, p. 12). If it is an **other arm fracture**, the Benefit Summary lists **20% of the sum insured** (Benefit Summary, p. 8). Grace’s accident cover is **S$600,000** (Certificate of Insurance, p. 1), so that would be **S$120,000** if the “other fracture” benefit applies. The documents don’t explain how to classify her fracture or resolve the difference between these summaries;
  ```
- **K3 / K3b / arm B / K3b.5** (E): the answer says why they differ in the documents' own terms (the summary points to the certificate for the precise terms; the certificate is not the contract; neither says which applies)
  ```
  An X-ray and a registered medical practitioner’s certification confirm the fracture, but the documents don’t say that this alone determines whether it is a **simple fracture** or an **other fracture**.
  
  If it is a **simple arm fracture**, the Product Summary lists a benefit of **25% of S$5,000 = S$1,250** (Product Summary, p. 12). If it is an **other arm fracture**, the Benefit Summary lists **20% of the sum insured** (Benefit Summary, p. 8). Grace’s accident cover is **S$600,000** (Certificate of Insurance, p. 1), so that would be **S$120,000** if the “other fracture” benefit applies. The documents don’t explain how to classify her fracture or resolve the difference between these summaries;
  ```
- **K3 / K3b / arm B / K3b.10** (U): turn 2: a supported next step (contact the insurer on the certificate) is given
  ```
  An X-ray and a registered medical practitioner’s certification confirm the fracture, but the documents don’t say that this alone determines whether it is a **simple fracture** or an **other fracture**.
  
  If it is a **simple arm fracture**, the Product Summary lists a benefit of **25% of S$5,000 = S$1,250** (Product Summary, p. 12). If it is an **other arm fracture**, the Benefit Summary lists **20% of the sum insured** (Benefit Summary, p. 8). Grace’s accident cover is **S$600,000** (Certificate of Insurance, p. 1), so that would be **S$120,000** if the “other fracture” benefit applies. The documents don’t explain how to classify her fracture or resolve the difference between these summaries;
  ```
- **K4a / K3b / arm B / K4a.8** (E): the correction is acknowledged and the answer is about the leg
  ```
  For a **leg fracture**, the documents list different benefits depending on the fracture category:
  
  - **Simple fracture:** 50% of the S$5,000 simple-fracture limit = **S$2,500** (Product Summary, p. 12).
  - **Other fracture:** 50% of the sum insured (Benefit Summary, p. 8). Grace’s accident sum insured is **S$600,000**, so that would be **S$300,000** (Certificate of Insurance, p. 1).
  
  The documents don’t say which category Grace’s X-ray-confirmed fracture falls into, or explain the difference between the summaries. A registered medical practitioner’s certification alone doesn’t resolve that from the documents.
  ```
- **K4b / K4b / arm B / K4b.1** (C): the summary's figure S$1,250 (percentage of the fixed S$5,000 limit) is given
  ```
  Daniel is listed with **Group Personal Accident cover of S$600,000**, effective 6 October 2022 (Certificate of Insurance, p. 1).
  
  For an accidental arm fracture, the documents list **20% of the Sum Insured if classified as an “Other Fracture”** (Benefit Summary, p. 8), or **25% of S$5,000 for a simple fracture** (Product Summary, p. 13). The documents don’t establish which classification applies to Daniel’s injury or whether it meets the claim requirements.
  ```
- **K4b / K4b / arm B / K4b.2** (C): the certificate highlights' figure S$120,000 (percentage of Daniel's S$600,000 sum insured) is given
  ```
  Daniel is listed with **Group Personal Accident cover of S$600,000**, effective 6 October 2022 (Certificate of Insurance, p. 1).
  
  For an accidental arm fracture, the documents list **20% of the Sum Insured if classified as an “Other Fracture”** (Benefit Summary, p. 8), or **25% of S$5,000 for a simple fracture** (Product Summary, p. 13). The documents don’t establish which classification applies to Daniel’s injury or whether it meets the claim requirements.
  ```
- **K4b / K4b / arm B / K4b.4** (E): the two bases are named (a fixed limit; the sum insured) and the answer says they are alternatives that are not added
  ```
  Daniel is listed with **Group Personal Accident cover of S$600,000**, effective 6 October 2022 (Certificate of Insurance, p. 1).
  
  For an accidental arm fracture, the documents list **20% of the Sum Insured if classified as an “Other Fracture”** (Benefit Summary, p. 8), or **25% of S$5,000 for a simple fracture** (Product Summary, p. 13). The documents don’t establish which classification applies to Daniel’s injury or whether it meets the claim requirements.
  ```
- **K4b / K4b / arm B / K4b.5** (E): the answer says why they differ in the documents' own terms (the summary points to the certificate for the precise terms; the certificate is not the contract; neither says which applies)
  ```
  Daniel is listed with **Group Personal Accident cover of S$600,000**, effective 6 October 2022 (Certificate of Insurance, p. 1).
  
  For an accidental arm fracture, the documents list **20% of the Sum Insured if classified as an “Other Fracture”** (Benefit Summary, p. 8), or **25% of S$5,000 for a simple fracture** (Product Summary, p. 13). The documents don’t establish which classification applies to Daniel’s injury or whether it meets the claim requirements.
  ```
- **K4b / K4b / arm B / K4b.7** (E): conditional, not an approved payment (an illustration if the fall caused a covered fracture)
  ```
  Daniel is listed with **Group Personal Accident cover of S$600,000**, effective 6 October 2022 (Certificate of Insurance, p. 1).
  
  For an accidental arm fracture, the documents list **20% of the Sum Insured if classified as an “Other Fracture”** (Benefit Summary, p. 8), or **25% of S$5,000 for a simple fracture** (Product Summary, p. 13). The documents don’t establish which classification applies to Daniel’s injury or whether it meets the claim requirements.
  ```
- **K6b / K6b / arm B / K6b.3** (C): no invented dental amount, and a jaw fracture figure is not offered as dental cover
  ```
  The documents do not state that Grace’s cover pays for dental treatment.
  They list her Group Personal Accident cover as S$600,000, but the provided benefit details do not specify dental treatment as a covered expense (Certificate of Insurance, p. 1; Benefit Summary, pp. 5, 7–9).
  ```

## Full visible answers (read these, not the verdicts)

### A / K1

**Turn 1 — household:** How much Personal Accident cover does Grace have?

> Grace’s Group Personal Accident amount is listed as S$600,000 as of 6 October 2022; this is the amount shown on that date, not confirmation of cover now.

### A / K2

**Turn 1 — household:** Grace was hospitalised for three days last week because she was sick. Does her accident cover pay anything?

> The Scheme X Group Insurance (page 9) prints the J, Accidental Hospital Recuperation Benefit, 250 (printed with a bare “$” sign; the Scheme X Group Insurance does not say which currency), with the printed conditions “In addition to the specific exclusions listed below”, “if within 30 days following bodily injury as a result of an Accident”, “it is medically necessary due to the said injury (whether directly or indirectly necessary) of the Insured Person to be confined as a resident patient in a Hospital for a continuous period of at least 24 hours on the recommendation of a Registered Medical Practitioner but not for the purpose of convalescent rest”, “Subsequent hospitalisation resulting from the same injury will not be payable.” and “This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.”.
> Did Grace’s hospitalisation follow a bodily injury caused by an accident, or was it due to illness without an accident?

### A / K3a

**Turn 1 — household:** grace fell down and broke her arm

> Grace's documents give two different answers for this event, and what they say does not settle which applies: these are alternatives from separate documents, never a total.
> If the Simple Fracture benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs”, the conditional illustration is S$1,250: 25% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.
> If the Simple Fracture or Other Fracture due to Accident benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$120,000: 20% of Grace's sum insured of S$600,000 (Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date), in the Certificate of Insurance Part 2 (page 8); it is an illustration from the document's terms, not a payment or an insurer's decision.
> The Product Summary (page 13) takes its percentage of a fixed Simple Fracture Benefit Limit; the Certificate of Insurance Part 2 (page 8) takes its percentage of Grace's own sum insured. The Product Summary describes itself as a summary and says the precise terms are set out in the certificate of insurance (page 37; its information is dated July 2021). The Certificate of Insurance Part 2, its highlights of cover, says it is not a contract of insurance (page 1). Neither document says whether one amends, replaces or adds to the other, or which applies to this event.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance Scheme to ask which of the two schedules applies to this event, and what it needs for a claim.

**Turn 2 — household:** It was confirmed by X-ray and a registered medical practitioner certified it: yes

> Grace's documents give two different answers for this event, and what they say does not settle which applies: these are alternatives from separate documents, never a total.
> If the Simple Fracture benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs”, the conditional illustration is S$1,250: 25% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.
> If the Simple Fracture or Other Fracture due to Accident benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$120,000: 20% of Grace's sum insured of S$600,000 (Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date), in the Certificate of Insurance Part 2 (page 8); it is an illustration from the document's terms, not a payment or an insurer's decision.
> The Product Summary (page 13) takes its percentage of a fixed Simple Fracture Benefit Limit; the Certificate of Insurance Part 2 (page 8) takes its percentage of Grace's own sum insured. The Product Summary describes itself as a summary and says the precise terms are set out in the certificate of insurance (page 37; its information is dated July 2021). The Certificate of Insurance Part 2, its highlights of cover, says it is not a contract of insurance (page 1). Neither document says whether one amends, replaces or adds to the other, or which applies to this event.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance Scheme to ask which of the two schedules applies to this event, and what it needs for a claim.

**Turn 3 — household:** Sorry, I meant her leg, not her arm.

> Updated: injury is now broke her leg (you said broke her arm at first). The earlier estimate worked out from it no longer applies.
> The illustrations are alternatives from separate documents, not a total.
> If the Simple Fracture benefit applies to Grace's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.
> If the Simple Fracture or Other Fracture due to Accident benefit applies to Grace's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$300,000: 50% of Grace's sum insured of S$600,000 (Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date), in the Certificate of Insurance Part 2 (page 8); it is an illustration from the document's terms, not a payment or an insurer's decision.
> The documents do not establish which applies to Grace’s event.
> Grace's documents give two different answers for this event, and what they say does not settle which applies: these are alternatives from separate documents, never a total.
> The Product Summary (page 13) takes its percentage of a fixed Simple Fracture Benefit Limit; the Certificate of Insurance Part 2 (page 8) takes its percentage of Grace's own sum insured. The Product Summary describes itself as a summary and says the precise terms are set out in the certificate of insurance (page 37; its information is dated July 2021). The Certificate of Insurance Part 2, its highlights of cover, says it is not a contract of insurance (page 1). Neither document says whether one amends, replaces or adds to the other, or which applies to this event.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance Scheme to ask which of the two schedules applies to this event, and what it needs for a claim.

### A / K3b

**Turn 1 — household:** grace fell down and broke her arm

> The documents do not establish which of these different fracture provisions applies to Grace’s event, and the Certificate’s dated amount does not confirm cover on a later date.
> If the Simple Fracture benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs”, the conditional illustration is S$1,250: 25% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.
> If the Simple Fracture or Other Fracture due to Accident benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$120,000: 20% of Grace's sum insured of S$600,000 (Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date), in the Certificate of Insurance Part 2 (page 8); it is an illustration from the document's terms, not a payment or an insurer's decision.
> Grace's documents give two different answers for this event, and what they say does not settle which applies: these are alternatives from separate documents, never a total.
> The Product Summary (page 13) takes its percentage of a fixed Simple Fracture Benefit Limit; the Certificate of Insurance Part 2 (page 8) takes its percentage of Grace's own sum insured. The Product Summary describes itself as a summary and says the precise terms are set out in the certificate of insurance (page 37; its information is dated July 2021). The Certificate of Insurance Part 2, its highlights of cover, says it is not a contract of insurance (page 1). Neither document says whether one amends, replaces or adds to the other, or which applies to this event.

**Turn 2 — household:** It was confirmed by X-ray and a registered medical practitioner certified it: yes

> The documents give different illustrations and do not establish whether one document amends, replaces or adds to the other, or which applies to this event.
> If the Simple Fracture benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs”, the conditional illustration is S$1,250: 25% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.
> If the Simple Fracture or Other Fracture due to Accident benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$120,000: 20% of Grace's sum insured of S$600,000 (Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date), in the Certificate of Insurance Part 2 (page 8); it is an illustration from the document's terms, not a payment or an insurer's decision.
> Grace's documents give two different answers for this event, and what they say does not settle which applies: these are alternatives from separate documents, never a total.
> The Product Summary (page 13) takes its percentage of a fixed Simple Fracture Benefit Limit; the Certificate of Insurance Part 2 (page 8) takes its percentage of Grace's own sum insured. The Product Summary describes itself as a summary and says the precise terms are set out in the certificate of insurance (page 37; its information is dated July 2021). The Certificate of Insurance Part 2, its highlights of cover, says it is not a contract of insurance (page 1). Neither document says whether one amends, replaces or adds to the other, or which applies to this event.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance Scheme to ask which of the two schedules applies to this event, and what it needs for a claim.

**Turn 3 — household:** Sorry, I meant her leg, not her arm.

> Updated: injury is now broke her leg (you said broke her arm at first). The earlier estimate worked out from it no longer applies.
> The documents do not establish which of these different provisions applies to Grace’s injury.
> If the Simple Fracture benefit applies to Grace's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.
> If the Simple Fracture or Other Fracture due to Accident benefit applies to Grace's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$300,000: 50% of Grace's sum insured of S$600,000 (Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date), in the Certificate of Insurance Part 2 (page 8); it is an illustration from the document's terms, not a payment or an insurer's decision.
> Grace's documents give two different answers for this event, and what they say does not settle which applies: these are alternatives from separate documents, never a total.
> The Product Summary (page 13) takes its percentage of a fixed Simple Fracture Benefit Limit; the Certificate of Insurance Part 2 (page 8) takes its percentage of Grace's own sum insured. The Product Summary describes itself as a summary and says the precise terms are set out in the certificate of insurance (page 37; its information is dated July 2021). The Certificate of Insurance Part 2, its highlights of cover, says it is not a contract of insurance (page 1). Neither document says whether one amends, replaces or adds to the other, or which applies to this event.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance Scheme to ask which of the two schedules applies to this event, and what it needs for a claim.

### A / K4b

**Turn 1 — household:** grace fell down and broke her arm

> Grace's documents give two different answers for this event, and what they say does not settle which applies: these are alternatives from separate documents, never a total.
> If the Simple Fracture benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs”, the conditional illustration is S$1,250: 25% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.
> If the Simple Fracture or Other Fracture due to Accident benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$120,000: 20% of Grace's sum insured of S$600,000 (Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date), in the Certificate of Insurance Part 2 (page 8); it is an illustration from the document's terms, not a payment or an insurer's decision.
> The Product Summary (page 13) takes its percentage of a fixed Simple Fracture Benefit Limit; the Certificate of Insurance Part 2 (page 8) takes its percentage of Grace's own sum insured. The Product Summary describes itself as a summary and says the precise terms are set out in the certificate of insurance (page 37; its information is dated July 2021). The Certificate of Insurance Part 2, its highlights of cover, says it is not a contract of insurance (page 1). Neither document says whether one amends, replaces or adds to the other, or which applies to this event.

**Turn 2 — household:** Actually it was Daniel who broke his arm, not Grace.

> Updated: this is about Daniel, not Grace. The earlier estimates I worked out for Grace from the injury no longer apply, because they were worked out for Grace's policy, not Daniel's. Updated: this is about Grace, not Daniel. Updated: injury is now broke his arm (you said broke her arm at first).
> Daniel's documents give two different answers for this event, and what they say does not settle which applies: these are alternatives from separate documents, never a total.
> If the Simple Fracture benefit applies to Daniel's case “Arm, Elbow, Wrist or Ribs”, the conditional illustration is S$1,250: 25% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.
> If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Arm, Elbow, Wrist or Ribs” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$120,000: 20% of Daniel's sum insured of S$600,000 (Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date), in the Certificate of Insurance Part 2 (page 8); it is an illustration from the document's terms, not a payment or an insurer's decision.
> The Product Summary (page 13) takes its percentage of a fixed Simple Fracture Benefit Limit; the Certificate of Insurance Part 2 (page 8) takes its percentage of Daniel's own sum insured. The Product Summary describes itself as a summary and says the precise terms are set out in the certificate of insurance (page 37; its information is dated July 2021). The Certificate of Insurance Part 2, its highlights of cover, says it is not a contract of insurance (page 1). Neither document says whether one amends, replaces or adds to the other, or which applies to this event.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance Scheme to ask which of the two schedules applies to this event, and what it needs for a claim.

### A / K6a

**Turn 1 — household:** What does Grace's Group Living Care pay if she is diagnosed with cancer?

> Grace’s certificate lists Group Living Care of S$350,000 as of 6 October 2022; this is the amount shown on that date, not confirmation of cover now.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance Scheme to ask what it needs for a claim.

### A / K6b

**Turn 1 — household:** Does Grace's cover pay for dental treatment?

> I couldn’t confirm an answer to that from your documents.

### B / K1

**Turn 1 — household:** How much Personal Accident cover does Grace have?

> Grace has **S$600,000** in Group Personal Accident cover, effective 6 October 2022. (Certificate of Insurance, p. 1)

### B / K2

**Turn 1 — household:** Grace was hospitalised for three days last week because she was sick. Does her accident cover pay anything?

> The documents do not show a benefit for hospitalisation due to sickness. Grace’s accidental hospital recuperation benefit applies only when hospital confinement is medically necessary because of an accidental bodily injury, for at least 24 continuous hours; it pays $250 once per hospitalisation. (Benefit Summary, p. 9.) Her certificate confirms Group Personal Accident cover of S$600,000, but that alone does not establish a sickness-hospitalisation benefit. (Certificate of Insurance, p. 1.)

### B / K3a

**Turn 1 — household:** grace fell down and broke her arm

> Grace is listed with **S$600,000 Group Personal Accident cover**, effective 6 October 2022. (Certificate of Insurance, p. 1)
> 
> The documents describe accident-related fracture benefits, but the amount depends on whether her arm fracture qualifies as a **simple fracture** or an **other fracture**. The Benefit Summary lists **20% of the sum insured** for an arm fracture classified as an “Other Fracture”; it does not specify an arm benefit for a simple fracture. (Benefit Summary, p. 8) The Product Summary separately lists a **S$5,000 simple-fracture benefit limit** and says arm fractures are compensated at 25% of that limit, but excludes fractures of the thumb, finger, and palm. (Product Summary, p. 13)
> 
> The documents don’t say which fracture classification applies to Grace’s injury or confirm that a claim will be approved.

**Turn 2 — household:** It was confirmed by X-ray and a registered medical practitioner certified it: yes

> An X-ray and a registered medical practitioner’s certification confirm the injury, but the documents don’t say that those facts alone determine whether it qualifies as a **simple fracture** or an **other fracture**.
> 
> If it is an **other fracture** of the arm, the Benefit Summary lists compensation of **20% of the S$600,000 sum insured**—S$120,000—subject to the policy terms and claim approval. (Certificate of Insurance, p. 1; Benefit Summary, p. 8) If it is a **simple fracture**, the Product Summary lists **25% of the S$5,000 simple-fracture limit**—S$1,250—for an arm fracture, excluding thumb, finger, and palm fractures. (Product Summary, p. 13)

**Turn 3 — household:** Sorry, I meant her leg, not her arm.

> For Grace’s **leg fracture**, the documents list:
> 
> - **Simple fracture:** 50% of the S$5,000 simple-fracture limit, or **S$2,500**. (Product Summary, p. 13)
> - **Other fracture:** 50% of her S$600,000 accident sum insured, or **S$300,000**. (Certificate of Insurance, p. 1; Benefit Summary, p. 8)
> 
> The documents don’t say which category her X-ray-confirmed fracture falls into, or confirm claim approval.

### B / K3b

**Turn 1 — household:** grace fell down and broke her arm

> Grace is listed with **S$600,000 Group Personal Accident cover** (Certificate of Insurance, p. 1). The documents say an accidental arm fracture may qualify for a benefit, but the amount depends on the fracture type: **25% of S$5,000 (S$1,250) for a simple fracture** in the Product Summary (p. 12), or **20% of the sum insured for an “other fracture”** in the Benefit Summary (p. 8). The documents don’t establish which category Grace’s fracture falls into, or whether her fall meets the policy’s claim requirements.

**Turn 2 — household:** It was confirmed by X-ray and a registered medical practitioner certified it: yes

> An X-ray and a registered medical practitioner’s certification confirm the fracture, but the documents don’t say that this alone determines whether it is a **simple fracture** or an **other fracture**.
> 
> If it is a **simple arm fracture**, the Product Summary lists a benefit of **25% of S$5,000 = S$1,250** (Product Summary, p. 12). If it is an **other arm fracture**, the Benefit Summary lists **20% of the sum insured** (Benefit Summary, p. 8). Grace’s accident cover is **S$600,000** (Certificate of Insurance, p. 1), so that would be **S$120,000** if the “other fracture” benefit applies. The documents don’t explain how to classify her fracture or resolve the difference between these summaries; check with Aldermoor before relying on either amount.

**Turn 3 — household:** Sorry, I meant her leg, not her arm.

> For a **leg fracture**, the documents list different benefits depending on the fracture category:
> 
> - **Simple fracture:** 50% of the S$5,000 simple-fracture limit = **S$2,500** (Product Summary, p. 12).
> - **Other fracture:** 50% of the sum insured (Benefit Summary, p. 8). Grace’s accident sum insured is **S$600,000**, so that would be **S$300,000** (Certificate of Insurance, p. 1).
> 
> The documents don’t say which category Grace’s X-ray-confirmed fracture falls into, or explain the difference between the summaries. A registered medical practitioner’s certification alone doesn’t resolve that from the documents.

### B / K4b

**Turn 1 — household:** grace fell down and broke her arm

> Grace is listed with **Group Personal Accident cover of S$600,000**, effective 6 October 2022 (Certificate of Insurance, p. 1).
> 
> The documents say an accidental arm fracture may qualify for a benefit: the Benefit Summary lists **20% of the Sum Insured for an arm fracture classified as an “Other Fracture”** (Benefit Summary, p. 8). The Product Summary separately lists a **simple-fracture benefit of 25% of S$5,000 for an arm fracture** (Product Summary, p. 13). Which amount applies depends on how the fracture is classified under the policy; the documents provided do not establish that from the description “broke her arm.” The benefit summary also says this benefit can only be claimed under either the Core Scheme or Voluntary Scheme (Benefit Summary, p. 8).
> 
> The documents do not say whether Grace’s fall and fracture meet the policy’s claim requirements.

**Turn 2 — household:** Actually it was Daniel who broke his arm, not Grace.

> Daniel is listed with **Group Personal Accident cover of S$600,000**, effective 6 October 2022 (Certificate of Insurance, p. 1).
> 
> For an accidental arm fracture, the documents list **20% of the Sum Insured if classified as an “Other Fracture”** (Benefit Summary, p. 8), or **25% of S$5,000 for a simple fracture** (Product Summary, p. 13). The documents don’t establish which classification applies to Daniel’s injury or whether it meets the claim requirements.

### B / K6a

**Turn 1 — household:** What does Grace's Group Living Care pay if she is diagnosed with cancer?

> Grace has **S$350,000 of Group Living Care cover**, effective 6 October 2022 (Certificate of Insurance, p. 1). The documents provided do not state what Group Living Care pays for a cancer diagnosis, so I can’t determine the benefit amount or conditions from them.

### B / K6b

**Turn 1 — household:** Does Grace's cover pay for dental treatment?

> The documents do not state that Grace’s cover pays for dental treatment. They list her Group Personal Accident cover as S$600,000, but the provided benefit details do not specify dental treatment as a covered expense (Certificate of Insurance, p. 1; Benefit Summary, pp. 5, 7–9).

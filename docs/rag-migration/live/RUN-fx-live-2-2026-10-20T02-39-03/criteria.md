# fx-live-2 decision criteria (D1..D6) and plumbing (D7), applied by scripts/rag2-live/fx-live-2-criteria.ts

## K2 (complete: true)

| check | result | what |
|---|---|---|
| D3.a | PASS | no question is asked (the household already said it was sickness): no saved question and no question mark |
| D3.b | PASS | the accident / injury requirement of the benefit is explained, from the benefit's own condition |
| D3.c | PASS | whether the reported cause fits is said: sickness is not an accident, so the condition is not met |
| D3.d | PASS | the accident benefit's amount (250, or a multiple) is not presented as payable for this stay |
| D3.e | PASS | no invented sickness benefit or daily amount |
| D6.a | PASS | no unqualified payment promise or approval |
| D6.b | PASS | no other insurer's real name, and no technical identifier or table fragment in the answer |
| D6.c | PASS | no wrong person: Daniel is not mentioned in a Grace-only conversation |
| D7.a | PASS | the conversation completed with no model / transport error |
| D7.b | PASS | returned = saved = reopened on every turn |
| D7.c | PASS | nothing removed by the composer or the save-time gate, and no 'left out' notice |

## K3t1 (complete: true)

| check | result | what |
|---|---|---|
| D5.a | PASS | S$1,250 with its basis: 25% of the fixed S$5,000 Simple Fracture limit, Product Summary (page 13) |
| D5.b | PASS | S$120,000 with its basis and date: 20% of Grace's S$600,000 sum insured, printed as of 6 October 2022, the certificate's Benefit Summary (page 8) |
| D5.c | **FAIL** | alternatives, not a total, and neither document is said to prevail; the bases are named<br><code>Grace’s documents give different alternatives for this event, and do not establish which applies; the amounts are not to be added together. ⏎ If the Simple Fracture benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs”, the conditional illustration is S$1,250: 25% of the Simple Fracture benefi</code> |
| D5.d | PASS | the '#' footnote (thumb, finger and palm are not covered) is said with the S$1,250 Arm row |
| D5.e | PASS | no footnote is attached to the certificate's S$120,000 row |
| D5.f | PASS | the '^' footnote (toe and foot) is not attached to an arm fracture |
| D5.g | PASS | conditional illustrations, not a payment or an insurer's decision |
| D5.h | PASS | no X-ray / registered-practitioner question (no cited page prints that requirement) |
| D6.a | PASS | no unqualified payment promise or approval |
| D6.b | PASS | no other insurer's real name, and no technical identifier or table fragment in the answer |
| D6.c | PASS | no wrong person: Daniel is not mentioned in a Grace-only conversation |
| D7.a | PASS | the conversation completed with no model / transport error |
| D7.b | PASS | returned = saved = reopened on every turn |
| D7.c | PASS | nothing removed by the composer or the save-time gate, and no 'left out' notice |

## K4b (complete: true)

| check | result | what |
|---|---|---|
| D4.a | PASS | exactly one correction notice, and it is 'this is about Daniel, not Grace' |
| D4.b | PASS | no other 'Updated:' notice and no contradictory 'Grace, not Daniel' line |
| D4.c | PASS | Daniel's figures: S$1,250 and S$120,000, with Daniel's own S$600,000 sum insured |
| D4.d | PASS | Grace is not presented as the injured person or as the base (only as the corrected earlier subject) |
| D4.e | PASS | no total or mixed-base figure; the two figures are alternatives |
| D6.a | PASS | no unqualified payment promise or approval |
| D6.b | PASS | no other insurer's real name, and no technical identifier or table fragment in the answer |
| D7.a | PASS | the conversation completed with no model / transport error |
| D7.b | PASS | returned = saved = reopened on every turn |
| D7.c | **FAIL** | nothing removed by the composer or the save-time gate, and no 'left out' notice<br><code>[[[],[],null],[[{"reason":"not supported by its evidence: “that requires the insurer's medical assessment.”: its evidence does not mention what it is about (requir, insurer, medical, assessment)","sentence":"The certificate wording also leaves open whether Daniel's diagnosis meets its definition of </code> |

## K6a (complete: true)

| check | result | what |
|---|---|---|
| D2.a | PASS | Grace's Group Living Care S$350,000 is given with its printed date (6 October 2022), as the listed sum and not as confirmation of cover now |
| D2.b | **FAIL** | every S$350,000 sentence has the limitation within one sentence before or two after: the documents do not state what Group Living Care pays for cancer / its conditions<br><code>The Scheme X Group Insurance does not state what Group Living Care pays for cancer. That is not the same as saying it is excluded or not covered: it only means this document does not show it, and only the insurer can confirm it. ⏎ Grace’s certificate lists Group Living Care at S$350,000 as of 6 Octo</code> |
| D2.c | PASS | no sentence about cancer or the diagnosis puts S$350,000 (or another policy's amount) forward unhedged |
| D2.d | PASS | no payment promise: S$350,000 is not what 'will be paid' for the diagnosis |
| D2.e | PASS | no invented condition: waiting period, survival period, stage, percentage |
| D2.f | PASS | cancer is not said to be covered |
| D6.a | PASS | no unqualified payment promise or approval |
| D6.b | PASS | no other insurer's real name, and no technical identifier or table fragment in the answer |
| D6.c | PASS | no wrong person: Daniel is not mentioned in a Grace-only conversation |
| D7.a | PASS | the conversation completed with no model / transport error |
| D7.b | PASS | returned = saved = reopened on every turn |
| D7.c | PASS | nothing removed by the composer or the save-time gate, and no 'left out' notice |

## K6b (complete: true)

| check | result | what |
|---|---|---|
| D1.a | PASS | says the documents do not describe a dental benefit (a statement about the documents) |
| D1.b | PASS | names the checked scope: a named document or the household's documents, in the same sentence |
| D1.c | PASS | does not assert 'no dental cover', 'not covered' or 'excluded' as a policy term |
| D1.d | PASS | is not a generic 'could not confirm' answer |
| D1.e | PASS | no invented dental amount, and a fracture / jaw figure is not offered as dental cover |
| D6.a | PASS | no unqualified payment promise or approval |
| D6.b | PASS | no other insurer's real name, and no technical identifier or table fragment in the answer |
| D6.c | PASS | no wrong person: Daniel is not mentioned in a Grace-only conversation |
| D7.a | PASS | the conversation completed with no model / transport error |
| D7.b | PASS | returned = saved = reopened on every turn |
| D7.c | PASS | nothing removed by the composer or the save-time gate, and no 'left out' notice |

## K6c (complete: true)

| check | result | what |
|---|---|---|
| D2.a | PASS | Grace's Group Living Care S$350,000 is given with its printed date (6 October 2022), as the listed sum and not as confirmation of cover now |
| D2.b | **FAIL** | every S$350,000 sentence has the limitation within one sentence before or two after: the documents do not state what Group Living Care pays for cancer / its conditions<br><code>Grace’s certificate lists Group Living Care at S$350,000 as of 6 October 2022; that dated amount does not confirm cover now. ⏎ The uploaded documents do not establish whether Grace’s cancer meets the policy definition or what amount would be payable for it. ⏎ Contact Aldermoor Life Ltd (through the </code> |
| D2.c | PASS | no sentence about cancer or the diagnosis puts S$350,000 (or another policy's amount) forward unhedged |
| D2.d | PASS | no payment promise: S$350,000 is not what 'will be paid' for the diagnosis |
| D2.e | PASS | no invented condition: waiting period, survival period, stage, percentage |
| D2.f | PASS | cancer is not said to be covered |
| D6.a | PASS | no unqualified payment promise or approval |
| D6.b | PASS | no other insurer's real name, and no technical identifier or table fragment in the answer |
| D6.c | PASS | no wrong person: Daniel is not mentioned in a Grace-only conversation |
| D7.a | PASS | the conversation completed with no model / transport error |
| D7.b | PASS | returned = saved = reopened on every turn |
| D7.c | PASS | nothing removed by the composer or the save-time gate, and no 'left out' notice |

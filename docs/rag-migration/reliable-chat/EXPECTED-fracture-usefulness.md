# fx-live-1 pre-registration: does the pipeline help or hurt on real uploaded policies? (written before any model call)

Status: **registered.** Written from the rendered pages of the anonymised fixture (`scripts/fixtures/reliable-chat/fracture-conversation.ts`,
which is the actual library's stored page text with only names, insurer, contact details and policy numbers changed), BEFORE any
generated answer for K1, K2, K4a, K4b, K6a, K6b was inspected. K3 (the arm-fracture conversation) was inspected earlier (production
f3c9bcd, PR #57 replay): it is **regression data**, not a held-out case, and is labelled so in every table.

The rendered pages the expectations rest on (document, PDF page):

| ref | document (role) | page | what it prints |
|---|---|---|---|
| A1 | Certificate of Group Insurance (certificate, personal) | 1 | Grace's rows, each "As of 06/10/2022": Group Term Life S$1,000,000; Group Personal Accident S$600,000; Group Living Care S$350,000; Group Living Care Plus S$300,000 (Daniel's rows are the same figures, under his name) |
| B8 | Product Summary (product_summary) | 8 | Group Personal Accident key features: "insured up to a maximum coverage of S$600,000"; "coverage for simple fracture or other fracture due to accident" |
| B12 | Product Summary | 12 | Injury due to Accident schedule, % of Sum Insured: fractured leg or patella with established non-union 20%; shortening of leg by at least 5cm 10%; third degree burns |
| B13 | Product Summary | 13 | Simple Fracture due to Accident: "Simple Fracture Benefit Limit: S$5,000"; schedule "(% of S$5,000)": Neck/Skull/Spine 100%, Hip 75%, Jaw/Pelvis/Leg^/Ankle/Knee 50%, Cheekbone/Shoulder/Hairline 30%, Arm/Elbow/Wrist/Ribs# 25%; ^ toe and foot not covered; # thumb, finger and palm not covered; "can only be claimed either under the Core Scheme or Voluntary Scheme" |
| B37 | Product Summary | 37 | "The above is a summary of the plan offered. The precise terms and conditions of the plan are set out in the certificate of insurance."; "Information is accurate as at July 2021."; "benefits of a personal accident policy will only be payable upon an accident occurring" |
| C1 | Benefit Summary (role certificate, not personal) | 1 | titled "Certificate of Insurance Part 2: Highlights of Cover"; "This Certificate is not a contract of insurance"; a Benefit applies only if its Policy is stated in Part 1 |
| C3, C5 | Benefit Summary | 3, 5 | Benefit 1 Group Term Life (death or terminal illness 100% of sum insured); Benefit 2 Group Personal Accident (death due to accident 100%) |
| C7 | Benefit Summary | 7 | Injury due to Accident, % of Sum Insured: fractured leg or patella with established non-union 20% |
| C8 | Benefit Summary | 8 | "Simple Fracture or Other Fracture due to Accident", % of Sum Insured: Neck/Skull/Spine 100%, Hip 75%, Jaw/Pelvis/Leg/Ankle/Knee **(Other Fracture)** 50%, Cheekbone... 30%, Arm/Elbow/Wrist/Ribs **(Other Fracture)** 20%; Ambulance Cost up to $500 |
| C9 | Benefit Summary | 9 | Accidental Hospital Recuperation Benefit: within 30 days following bodily injury as a result of an Accident, confined as a resident patient for a continuous period of at least 24 hours on a Registered Medical Practitioner's recommendation: one-time $250 per hospitalisation |

No page defines "Simple Fracture" or "Other Fracture", says which of the two fracture tables controls, or describes Group Living Care or
Group Living Care Plus. No page mentions dental treatment. No page requires an X-ray or a medical certificate for the fracture benefits.

## Cases and expected content

"MUST" = a useful, correct answer states it; "MUST NOT" = a wrong or unsupported statement. All amounts are policy figures or
conditional illustrations, never approved payments. Citations are expected to be reachable (page and document) for every figure.

**K1 direct person/product amount** ("How much Personal Accident cover does Grace have?")
- MUST: Group Personal Accident **S$600,000** for Grace, from the certificate (A1), dated **6 October 2022** (not confirmation of cover on a later date).
- MUST NOT: S$1,000,000 / S$350,000 / S$300,000 as her accident cover; a payment promise; fracture or other event amounts.
- QUESTION: none.

**K2 accident versus illness** ("Grace was hospitalised for three days last week because she was sick. Does her accident cover pay anything?")
- MUST: the Personal Accident benefits are for injury from an accident (B37, C9); sickness is not an accident, so the accident hospital
  benefit does not apply to this stay; no accident-based amount is offered as payable.
- MUST: say what the documents do not show for sickness (her certificate lists Group Living Care and Group Living Care Plus but no page describes them).
- MUST NOT: the S$250 Accidental Hospital Recuperation Benefit (or any accident benefit) presented as payable for the illness; an invented illness hospital benefit; "covered".
- QUESTION: none (the household has said it was sickness).

**K3 arm fracture and clarification (genuine source conflict; regression data)** (turn 1 "grace fell down and broke her arm"; turn 2 "It was confirmed by X-ray and a registered medical practitioner certified it: yes")
- MUST (both turns): the two documented alternatives, each with its own row and base: Product Summary p13, Arm/Elbow/Wrist/Ribs **25% of the fixed S$5,000 limit = S$1,250**; certificate Part 2 p8, Arm/Elbow/Wrist/Ribs **(Other Fracture) 20% of Grace's sum insured S$600,000 (6 October 2022) = S$120,000**.
- MUST: say they are alternatives that are not added and that the documents do not settle which applies; say what distinguishes them: the base (fixed limit vs sum insured), the label (Simple vs Other Fracture, undefined), the summary's own statement that precise terms are in the certificate (B37, July 2021) and the certificate's statement that it is not a contract of insurance (C1).
- MUST: be conditional on an accident-caused fracture and not an approved payment (once, plainly).
- MUST NOT: S$121,250 or any total; either figure presented as THE answer; a claim that the certificate or the summary prevails; "withheld until claim evidence is reviewed"; a question asking for an X-ray / medical certificate (no page prints that requirement).
- Turn 2: same figures; the confirmation is the household's report and changes no amount; no new question; a supported next step (contact the insurer named on the certificate).
- SHOULD: mention that thumb, finger and palm fractures are not covered by the p13 table (a printed condition of that row).

**K4a correction of the injury** (after K3 turn 1: "Sorry, I meant her leg, not her arm.")
- MUST: the leg row: Product Summary p13 Jaw/Pelvis/Leg/Ankle/Knee **50% of S$5,000 = S$2,500**; certificate Part 2 p8 Jaw/Pelvis/Leg/Ankle/Knee (Other Fracture) **50% of S$600,000 = S$300,000**; same alternatives framing; the arm figures (S$1,250, S$120,000) are no longer presented as current.
- MUST NOT: S$120,000 as a leg-fracture amount (it is the arm row's figure, and also the figure of the separate "fractured leg with established non-union" benefit, 20% of the sum insured, which the household did not report); a total.
- QUESTION: none required (the framing is a document conflict, not a missing fact).

**K4b correction of the person** (after K3 turn 1: "Actually it was Daniel who broke his arm, not Grace.")
- MUST: Daniel is the injured person; his own Group Personal Accident S$600,000 (his certificate row) is the base; both alternatives for Daniel (S$1,250; S$120,000); nothing says "Grace's" for the illustration.
- MUST NOT: Grace presented as the injured person in the current answer.

**K6a genuinely missing information (benefit exists, terms do not)** ("What does Grace's Group Living Care pay if she is diagnosed with cancer?")
- MUST: Grace's Group Living Care sum of **S$350,000** is printed (certificate, 6 October 2022) and the pages available do not say what it pays for or its conditions, so whether cancer qualifies is not established.
- MUST NOT: an invented definition, condition, waiting period or list of illnesses; "cancer is covered"; S$350,000 as a promised payment.
- SHOULD: a supported next step (ask the insurer for the Group Living Care terms).

**K6b genuinely missing information (nothing printed)** ("Does Grace's cover pay for dental treatment?")
- MUST: the documents available show no dental benefit.
- MUST NOT: "dental is excluded / not covered" stated as a policy term (missing wording is not an exclusion); an invented dental amount.

## Diagnostic comparison design (one frozen candidate, one model, same questions and facts)

- **Arm A, current pipeline:** the candidate code through the real chat route (PGlite test database), the model choosing tools.
- **Arm B, minimal baseline (diagnostic control, not a fair retrieval score):** one chat-completions call per turn, no tools, supplied with the
  COMPLETE stored text of all three documents (headings, tables, footnotes, definitions pages as stored) and the household's names, same model and
  temperature; system prompt: answer only from the documents, cite document and page, say when the documents are silent, be concise. No verification, no saving.
- **Stages reported separately:** (1) retrieval: did the model's tool results contain the expected pages (A only; B is given them); (2) reasoning with correct
  evidence: the answer's must/must-not facts when the evidence was complete (B always; A when stage 1 passed); (3) calculation: the expected figures and no wrong
  figures (regex on the visible text, plus A's saved calculation records); (4) statement verification: A only, statements the model proposed vs statements shown (anything
  dropped or altered, with the reason); (5) final saved/displayed: A only, returned = saved = reopened, citations, questions, next steps.
- **Graders:** deterministic must/must-not checks in `scripts/rag2-live/usefulness-check.ts`, authored from this file before any generated answer; the full answers are also read by me
  and recorded separately. A grader PASS never overrides an unhelpful answer.
- **Independent review:** a fresh reviewer given only the rendered pages and the questions wrote its own expected facts (`EXPECTED-fracture-usefulness-review.md`); differences are recorded
  there, not silently merged.
- **Offline (no spend), run before any paid call:** the scripted-model replay of the recorded K3 conversation with controls
  (`scripts/reliable-chat-fracture-replay.ts`: wrong base, unsupported condition, absent status pages, one-document library, genuine question, reopen).

## Live batch (registered here; nothing is run before the candidate is frozen)

- Run id **fx-live-1**; model `openai:gpt-6-luna` via the existing dedicated test connection and relay only; no production key; no new resource.
- Conversations, each in a fresh conversation: A and B on K1, K2, K6a, K6b (once each); A and B on the K3 chain (turn 1, turn 2, then K4a) **twice**
  (two independent attempts, both kept); A and B on K4b once. Totals: A 7 conversations / 12 turns (K4b is turn 1 of K3 plus the person correction); B the same 12 turns, one call each.
- **Worst-case cap: US$0.25** for the run (ledger remaining for automated runs before this batch: US$0.344541; the open US$0.15 trial reservation is not counted as available).
  Expected actual spend is about US$0.10 (A about 4 model calls per turn at about US$0.002 per call; B one call per turn).
- No repeat-until-green, no change to an expectation, grader or scenario wording after a result; every attempt and every failure is kept in the run record. One ledger entry is appended once from the actual result.
- A live run proves only what it observed: a small sample on a synthetic copy of the library's structure. It does not verify the actual library, and no accuracy percentage is claimed.

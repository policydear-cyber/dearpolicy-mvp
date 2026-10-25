# Policy Evidence Review: PR #57 follow-up

Role: independent Policy Evidence Reviewer (DC, 2026-10-20 06:13Z). Establishes what the documents support first, then compares the complete
visible answer against it. Reports both unsupported claims and supported information that was left out. Edits no product code and no test expectation.
This file consolidates `FINDINGS-C0.md`, `FINDINGS-C1.md` and `GP-BILL.md` (kept for history).

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Policy Evidence Reviewer | evidence record per journey; compare answers | C2 `98ada99` (page text identical since C0) | C2 assessed (section 6) | this file | no rendered C2 text from a frozen-copy run; DC's real library not available; live runs needed (section 6) |

## 1. Evidence sources and what is not available

| label | what it is | used for |
| --- | --- | --- |
| **FX-copy** | `scripts/fixtures/reliable-chat/fracture-conversation.ts`: per its header, a read-only copy of pages from DC's actual library (19 Oct 2026), anonymised (insurer, people, NRIC, policy numbers, addresses) with wording, amounts and dates kept: CERT p1, PS p8/p12/p13/p37, BS p1/p7/p8/p9 | all journeys |
| **FX-synthetic** | BS p3 and BS p5 in the same file: three-line heading stubs, not full page copies | product headings only |
| **Live answer** | `docs/rag-migration/live/RUN-fx-live-2-.../answers.json`: real model, code of `c4edd48`, on FX documents | K2, K3t1, K4b, K6a, K6b, K6c visible answers |
| **Scripted** | Developer/Test engineer replays with the scripted model: plumbing evidence, never model evidence | FR1, GP bill reconstruction |
| **Code trace** | QC reading of a candidate's diff over FX pages by hand | C1 rulings |

**Not available, and how it limits findings:**
- DC's real library (actual documents, real people). Every finding here is about anonymised copies. Production traces (e.g. the live GP-bill conversation) were not read; that needs DC's permission.
- Product Summary: 4 of its 37 pages stored (pp 1-7, 9-11, 14-36 absent). Benefit Summary: 6 pages stored, total unknown. Its lettered sections skip H (p8) to J (p9), and Benefit 2 parts A-C and pages 2, 4, 6 and 10 onward are absent.
- Any page describing Group Living Care, Group Living Care Plus, Outpatient Medicare, Disability Income, the Core Scheme, definitions of "Accident", "Simple Fracture" or "Other Fracture", or "clause 14" claim documents.
- Rendered C1 and C2 answers for these journeys (QC ran no suites; the Test engineer's runs are the source).

## 2. Household evidence record (CERT p1, FX-copy, every row "As of 06/10/2022")

| person | Group Term Life | Group Personal Accident | Group Living Care | Group Living Care Plus | not listed |
| --- | --- | --- | --- | --- | --- |
| Daniel (Lee Wei Ming, S\*\*\*\*411A) | S$1,000,000 | S$600,000 | S$350,000 | S$300,000 | Disability Income, Outpatient Medicare |
| Grace (Tan Hui Min, S\*\*\*\*822B) | S$1,000,000 | S$600,000 | S$350,000 | S$300,000 | same |

Every product row shares policy number 3037850 (group policy G007500), and that must not merge products or people. BS p1 says a benefit applies only if its
policy is stated in Part 1 (the certificate), and that the certificate is not a contract of insurance. A dated row proves cover on 6 Oct 2022, not now.

Document roles: CERT is the personal certificate. PS is the Product Summary of the *Voluntary* Scheme (PS p8 heading); it says it is a summary,
that precise terms are in the certificate of insurance, and that its information is "accurate as at July 2021" (PS p37). BS is "Certificate of
Insurance Part 2: Highlights of Cover", not personal, and says it is not a contract (BS p1).

## 3. Journeys

Each journey gives: A the evidence record; B unresolved relationships and missing information; C the comparison with the visible answer (U = unsupported claim,
O = supported information omitted).

### J1 Fracture: FR1, K3t1 ("grace fell down and broke her arm"; FR1 turn 2 "...confirmed by X-ray...: yes")

A. Alternative 1, PS p13: Simple Fracture due to Accident, benefit limit **S$5,000**, row "Arm, Elbow, Wrist or Ribs" **25% of S$5,000 = S$1,250**,
footnote `#` "any fractures of thumb, finger and palm are not covered"; no Core/Voluntary note (PS p13's asterisk note covers other benefits).
Alternative 2, BS p8: Simple Fracture or Other Fracture due to Accident, row "Arm, Elbow, Wrist or Ribs (Other Fracture)" **20% of Sum Insured**;
Grace's GPA **S$600,000** (CERT p1, 6 Oct 2022) gives **S$120,000**; printed under the table: "This Benefit can only be claimed either under
the Core Scheme or Voluntary Scheme." Currency: S$ printed on both. Both are conditional on an accident-caused fracture, and they are never added (no S$121,250).
No page prints an X-ray or medical-certificate requirement.

B. Unresolved: which alternative applies. PS says precise terms are in the certificate (PS p37); BS says it is not a contract (BS p1); PS is the
Voluntary Scheme's summary and BS p1 says certificates go to Voluntary Scheme members. None of this settles it. Missing: definitions of
Simple/Other Fracture, the Core Scheme's terms, and claim documents. The 96x gap between the two figures makes this the highest-risk amount in the round; only the insurer can settle it.

C. Live answer (K3t1, c4edd48): figures, bases, dates, footnote, no total, no X-ray question all correct. O: the BS p8 Core/Voluntary condition (fixed on
C1 by code trace; no executable check yet). O (judgement, low): the Voluntary-Scheme point. U: none. Repetition of "which applies" (usefulness;
C1 de-duplicates). FR1 turn 2: replay asserts the same figures, no question (Scripted).

### J2 Person correction, K4b ("Actually it was Daniel who broke his arm, not Grace.")

A. Daniel's own GPA S$600,000 (row S\*\*\*\*411A, 6 Oct 2022): S$1,250 (fixed limit, not scaled by any person's sum) and S$120,000 (20% of his S$600,000).
Grace's figures are withdrawn.

B. FX limitation: both people hold S$600,000, so the FX household cannot show recomputation. It is covered on C1 by acceptance Q3.1-Q3.4 (Daniel S$400,000,
20% = S$80,000, arithmetic correct; Scripted).

C. Live answer turn 2: correct person, base, date and figures; Grace's estimates said to no longer apply. U: none. O: the Core/Voluntary condition, as in J1.
Composer drop of an unsupported "insurer's medical assessment" sentence: correct.

### J3 Cancer, K6a / K6c ("What does Grace's Group Living Care pay...", "...How much will her Group Living Care pay out?")

A. Grace's Group Living Care **S$350,000** as of 6 Oct 2022 (CERT p1), a sum assured and not a payable amount. Group Living Care Plus S$300,000 is also listed.

B. Missing: every Living Care / Living Care Plus term (what they pay, definitions, conditions). Whether cancer qualifies is not established, and that is not an exclusion.

C. Live answers: correct, no promise, dated. O: Living Care Plus S$300,000 is also listed and undescribed. Wording: K6a scopes its absence to one
document name although three were checked; K6c's "the policy definition" implies a definition was seen (none was). U: none.

### J4 Dental absence, K6b ("Does Grace's cover pay for dental treatment?")

A. No stored page mentions dental. Outpatient Medicare (BS p1) is not in Grace's Part 1.

B. The absence is over stored pages only. The PS is incomplete (4/37 pages) and the BS is incomplete with an unknown total; Living Care / Living Care Plus are undescribed.

C. Live answer: scoped to three named documents, "not the same as saying there is no such cover". U, as worded on c4edd48: it claims an absence over
"the product summary" and "certificate summary" when only some of their pages are stored. That is acceptable on FX only because those are all the pages FX holds. From C1/C2, the
full-read rule refuses or scopes this to "pages read" (correct; the Developer's notes). O: Living Care / Living Care Plus listed but undescribed.

### J5 Sickness hospital stay, K2 ("...hospitalised for three days last week because she was sick. Does her accident cover pay anything?")

A. Accidental Hospital Recuperation Benefit: BS p9 "within 30 days following bodily injury as a result of an Accident", at least 24 continuous hours on a
Registered Medical Practitioner's recommendation, one-time **$250** per hospitalisation (bare $), the same injury not paid twice, Core or Voluntary only.
PS p13 prints the same benefit as **S$250**. PS p37: "benefits of a personal accident policy will only be payable upon an accident occurring."

B. Missing: the definition of Accident, and the Living Care / Living Care Plus terms (both listed for Grace).

C. Live answer: correct verdict on the reported cause, no amount. O: PS p37 (the accident cover as a whole), and Living Care S$350,000 / Plus S$300,000 being
listed but undescribed (a hidden-benefit failure under DC's contract; v1 `K2.3`). C1 ruling (code trace): showing the S$250 printed terms is
supported if (a) "S$" is cited to PS p13, or it stays a bare "$250" for BS p9, (b) all its conditions come with it, and (c) it is not presented as payable for this stay. U on C1:
"whether its condition is met is for the insurer to decide" for a pure-sickness report suggests an open question that the pages do not support. The pages
support "on what you told me the accident condition is not met for this stay; any claim decision is the insurer's".

### J6 GP bill (DC live: "raymond tripped over the kerb and fell, his GP bill is $800, can he claim for this?"; reconstruction with Daniel)

A. No stored page prints an outpatient, GP or accidental medical-expenses benefit (PS p8 key features, PS p13, BS p7-p9). BS p1 names an Outpatient Medicare Policy;
Daniel's certificate does not list it, and BS p1 says a benefit applies only if its policy is in Part 1. Conditional accident benefits: Ambulance to Hospital
up to **S$500 per incident** (PS p13; BS p8 bare $500), a hospital stay of at least 24 hours **S$250** (PS p13), and a fracture (J1), each only if that happened.
"$800" is the household's own figure, with its currency unresolved.

B. Missing: Living Care / Living Care Plus terms, Core Scheme cover, and the unstored PS/BS pages; the scope is "pages read". DC's real certificate is unavailable.

C. Live answer (production, actual library, text from the Developer's GP-BILL.md, which reproduces it with variant C; Scripted): U: "I haven't yet looked
up what your documents pay for the bill" after a search ran. O: the OPMC-not-listed point, the conditional accident benefits, and the Living Care undescribed point.
Expected answer and must-nots: `GP-BILL.md`. Proposed G1 must not say Living Care "pages describe no GP benefit" (it has no pages) and must keep the conditional accident benefits.

## 4. Existing EXPECTED files: disagreements

- `EXPECTED-fracture-usefulness.md` B13 puts the Core/Voluntary note on the PS p13 Simple Fracture benefit; on PS p13 it covers only the asterisked benefits. It belongs to BS p8.
- `EXPECTED-fracture-usefulness.md` K3 MUST omits the BS p8 condition with S$120,000.
- fx-repairs C3 / acceptance R6 ("no 250 at all" in K2) is stricter than the wording requires (J5). Revising it is the Test engineer's call; it was not changed here.

## 5. Candidate log

| candidate | assessed | result |
| --- | --- | --- |
| C0 `4956588` | live answers (c4edd48 code) + pages | no wrong amount; O: J1/J2 condition, J3/J4/J5 Living Care, J5 PS p37 |
| C1 `8c63250` | code trace | J1/J2 condition fixed (needs an executable check); J5 C1 illness sentence U; J4 refused until fixture page counts (done at `720f5f5`: CERT 1, PS 37, BS unknown) |
| C2 `98ada99` | code trace of the C2 diff over FX pages (page text unchanged; `pageCount` added: CERT 1, PS 37, BS unknown) + the Test engineer's recorded checks; QC ran no suite | see section 6 |

## 6. C2 `98ada990d0a792f7a7b8c2e1931704a07409d33d`, journey by journey

Evidence: Code trace (QC) over FX-copy pages. The Developer's recorded scripted results on C2 (`developer/GP-BILL.md`): acceptance AC 20/26, GUARD 41/41; fx-repairs 89/89.
No rendered C2 text from a frozen-copy run was available to QC.

| journey | unsupported claims (U) on C2 | supported information omitted (O) on C2 | settled by |
| --- | --- | --- | --- |
| J1 fracture FR1/K3t1 | none. Figures, bases, dates and the `#` footnote unchanged. `tableConditions` tightened (stops at a blank line, a heading, or a sentence with an amount); on BS p8 the Core/Voluntary sentence is still the only line before "F.\tDisappearance", so the S$120,000 illustration keeps it (now without its own full stop) | the Voluntary-Scheme point (judgement, low). **No executable check asserts the Core/Voluntary condition inside the S$120,000 illustration** (C3 checks it only for the K2 S$250); still a test gap. Repetition R1/R3 open | code: yes. Repetition: live run |
| J2 correction K4b | none found by trace. "too / also / as well" no longer counts as a correction, and a possessive ("Grace's fault") no longer names the person (Critic round 3) | none beyond J1's | the model's reaction to `note_facts` refusals and the correction notice: **live run** |
| J3 cancer K6a/K6c | none | Living Care Plus S$300,000 listed and undescribed; "policy definition" wording (R7, R9 open by decision) | wording gaps; the K6c fresh paraphrase: **live run** |
| J4 dental K6b | none. With page counts, the absence is now the server's partial-scope text: certificate in full, Product Summary pages 8, 12-13 and 37 of 37, Benefit Summary pages read; "not an answer about whether there is such cover". Correct for incomplete documents | none material. Low: the page list uses stored indexes (PS printed numbers are one lower) | scripted is enough for the text; whether the model sends the absence: live run (low priority) |
| J5 sickness K2 | **fixed**: the C1 sentence now reads "on what you have told me its accident condition is not met and its printed terms are not an amount for this stay; any claim decision is the insurer's", which is the ruling. fx-repairs C3 now encodes the ruling (all conditions with the 250, S$ only with the Product Summary, never for this stay) | **mostly fixed**: the server now adds "Grace's certificate also lists Group Living Care and Group Living Care Plus (listed as of 6 October 2022)", without amounts, and states an absence only if its scope is fully read (it is not on FX, so only the listing is said: correct). Still O: PS p37 "only payable upon an accident occurring" (low) | server text: deterministic **once the model states the hospital benefit's terms**; the code runs only on a model `benefit_terms` statement, so **live run** |
| J6 GP bill | none by trace. On FX the server writes: Daniel's certificate lists its four products (as of 6 October 2022); the Benefit Summary (page 1) names the scheme's Outpatient Medicare Policy (OPMC), which that certificate does not list; only the insurer or administrator can confirm current cover; then the partial-scope absence. G2 replaces "I haven't yet looked up" after a search. Low: "The pages that were read do not mention GP or outpatient treatment" right after quoting "Outpatient Medicare" reads as a contradiction; "do not describe a benefit for" would be exact. The products may print in capitals as on the certificate | **the conditional accident benefits** (ambulance to hospital up to S$500 per incident, a 24-hour stay S$250, fracture) and "Living Care / Living Care Plus are listed but not described". The server adds neither (Developer's note); the partial-scope sentence covers the undescribed point only generally | **live run** (both omissions depend on the model; G2 fires only when the model's search query names medical/bill words) |

**Which journeys need a real-model run to settle (in order of value):**
1. **J6 GP bill**: DC's own live question. The conditional accident benefits and the Living Care line are model-only, and whether G1/G2 fire depends on the model's calls. Ideally a re-run of DC's real conversation on his actual library (needs DC's permission; FX has no OPMC/GP evidence beyond BS p1).
2. **J5 sickness K2**: the server's corrected sentence and the listed-cover line appear only if the model states the hospital benefit.
3. **J2 correction K4b**, plus "Daniel broke his arm too" and a later Grace message: the handoff's planned check of the `note_facts` refusals, which a replay cannot show.
4. **J3 K6c** (the only fresh paraphrase) and **J1 K3t1** repetition (R1/R3 are replay artefacts on C1/C2).
J4 needs none for the text. Every paid run goes through the one designated runner, with DC's authorisation, against the shared ledger (US$0.259121 left at C0).

**Release view from the evidence (not a merge decision):** no wrong claimable amount on C0, C1 or C2 by page evidence. The remaining issues are
omissions that depend on the model, plus one missing executable check (J1). None of this is shown on DC's actual library.

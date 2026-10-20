# Policy Evidence Review: PR #57 follow-up

Role: independent Policy Evidence Reviewer (DC, 2026-10-20 06:13Z). Establishes what the documents support first, then compares the complete
visible answer against it. Reports both unsupported claims and supported information that was left out. Edits no product code and no test expectation.
This file consolidates `FINDINGS-C0.md`, `FINDINGS-C1.md` and `GP-BILL.md` (kept for history).

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Policy Evidence Reviewer | evidence record per journey; compare answers | C5 `177c073` (page text identical since C0) | final summary on C5 (section 11) | this file | live runs needed (section 6); DC's real library not available |

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

### J6 GP bill (DC live: "desmond tripped over the kerb and fell, his GP bill is $800, can he claim for this?"; reconstruction with Daniel)

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

## 7. Factual checks for the UX agent's findings (coordinator relay, 06:30Z), answered from the pages at C2 `98ada99`

Source labels: **real-anonymised** = fixture stated to reproduce DC's actual stored pages with identifiers changed (`fracture-conversation.ts`,
`actual-lib.ts`); **synthetic** = structure modelled on a report, wording and amounts invented (`booklet.ts`, `rag2-livelib/household.ts`,
the pages `death-journey.ts` adds). None of this is DC's actual library itself.

| # | question | answer | source |
| --- | --- | --- | --- |
| 1 | Does any document define "Other Fracture" (fracture, actuallib, booklet)? | **Fracture household: no.** No stored page defines Simple or Other Fracture (BS p8 only labels rows "(Other Fracture)"). **Actuallib: no.** Its header records that the real passages print no definition (verified by the PR54 report). **Booklet: yes**, BK p7/p8: "Simple Fracture means a closed fracture where the skin is not broken"; "Other Fracture means a fracture that is not a Simple Fracture, including a compound (open) fracture" (variant `alt`: Simple "whether open or closed", Other "an open (compound) fracture"). Livelib also defines them (WORD p1/p2, same as the booklet default). The UX figures (S$120,000 / S$300,000 / S$450,000 = 20/50/75% of S$600,000; S$1,250 / S$2,500 / S$3,750 = 25/50/75% of S$5,000) match the **fracture or actuallib** household, where "these documents print no definition" is **true** of the stored pages | fracture, actuallib: real-anonymised; booklet, livelib: synthetic |
| 1 | Is the UX top issue critical? | **Not a wrong amount by page evidence** in those two households: the Other Fracture alternative is printed and undefined, so it may not be dropped on a stated "closed". It stays the round's highest amount risk (96x); the answer should say that the user called it closed and that the uploaded pages do not say whether a closed fracture is a Simple or an Other Fracture. **It would be critical** in a household whose documents define the terms (booklet default, livelib): there a stated closed fracture fits Simple only, and showing the Other Fracture amount would be unsupported. Not available: whether DC's real library defines them on pages not stored (the Product Summary is 4 of 37 pages here) | as above |
| 2 | Fracture household: S$600,000 GPA for both? | **Yes.** CERT p1: "S\*\*\*\*411A Lee Wei Ming, Daniel S$600,000 As of 06/10/2022" and "S\*\*\*\*822B Tan Hui Min Grace S$600,000 As of 06/10/2022" under GROUP PERSONAL ACCIDENT. The fixture header says the amounts are the printed ones | real-anonymised |
| 3 | Fracture household: does Group Living Care say what it covers; cancer? | **No.** Only CERT p1 lists it (S$350,000 each, as of 06/10/2022); BS p1 names the Living Care Policy ("LC") among the group policies. No stored page describes its cover, and "cancer" appears on no page. Its cover is unknown, which is neither included nor excluded | real-anonymised |
| 4 | Livelib, accidental death in Japan: only Term Life S$1,000,000. Omitted death benefit? | **Yes, documented benefits were omitted.** PA Summary of Benefits p9: "Accidental Death: 100% of the Sum Insured", with Group Personal Accident S$600,000 for each adult (CERT, as of 06/10/2022), and "Territorial Limits: worldwide, 24 hours a day" (Japan is inside), exclusions war/civil war/self-injury. Also "Repatriation of Mortal Remains: S$2,000 per Insured Person, if death occurs outside Singapore as a result of an Accident" (SUM p9; WORDING p3 prints bare "$2,000"). Term Life S$1,000,000 (CERT; GTL product summary: payable on death; notify within 6 months with the death certificate) is right. The single-trip travel schedule (Falcon General, Adrian only, 10/03/2025 to 17/03/2025, destination Indonesia, Accidental Death S$100,000) is **not** shown to apply to a death in Japan and should not be offered as applicable. Separate policies' amounts are stated separately and never totalled. **Hidden documented benefit: a failure under DC's contract** (whether "critical" is DC's call; it is an omission, not a wrong amount) | synthetic |
| 5 | Deathjourney: a death claims procedure? | **No general procedure** (no who-to-notify, time limit or claim form steps) is printed. Printed claim requirements exist only per benefit: Compassionate Death Allowance "on receipt of proof of death and the relevant documents in our prescribed form" (BK p9, recorded actual passage; bare "$2,000"), Disappearance's undertaking to refund if found alive, and "relevant documents as required under clause 14" (clause 14 not stored). The pages `death-journey.ts` adds (PS p12, p13) print none. For contrast, the fracture household's PS p37 does print a claims contact (hotline, e-mail; claims paid to the Insured Person, proper claimant or legal representative) | BK p9, PA p8: real-anonymised; PS p12/p13 additions: synthetic |

Note (low): `actual-lib.ts` and `scripts/fixtures/extraction/*.json` keep the real insurer's name, address and registration in the source text and
anonymise it at load time. That is public insurer information, not a private record, but it is not anonymised in Git.

## 8. Final check on C3 `17668630fab90a94997f3c918d8a5b31139ec40e` (draft PR #61)

C3 changes product code in `absence-scope.ts`, `loop.ts`, `statement-render.ts` and `event-relations.ts` only. The fixture pages are unchanged since C0.
Evidence: Code trace (QC) over the pages, plus the UX agent's browser transcripts on C2 (`claude/pr57-ux-le1xlg`, ux/c2-98ada99; Scripted). No live model call.

| journey | U on C3 | O on C3 | change from C2 |
| --- | --- | --- | --- |
| J1 fracture | none | the Voluntary-Scheme point (judgement). The Core/Voluntary condition **is shown** with the S$120,000/S$300,000 illustration in the browser on C2 (UX `SA2x`, `fr1x`: "under the table it prints: “This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme”"; Scripted). Still **no executable check** | question checks reordered (a passage under another benefit never justifies a fracture question): no amount effect |
| J2 correction | none. "Daniel broke his arm too." names no first person negated, so it does not move facts; "...not Grace. He also hurt his knee." is still a correction | none | Critic A1 |
| J3 cancer | none | Living Care Plus; "policy definition" wording (accepted gaps) | none |
| J4 dental | none | none material | a reply that ends without the absence now gets the server's "what was read" statement instead of "couldn't confirm" (improvement) |
| J5 sickness | none | PS p37 (low); "listed but not described" not said, because the scope is partly stored (correct) | none |
| J6 GP bill | none. Uses only the subject's own certificate rows; never quotes the scheme's policy list; "I could not confirm" after a refused check (exact) | the conditional accident benefits; model-dependent, live run | Critic A2/A3/F1-F3 |

### Developer claim 1: the closed-fracture transcripts ran on actuallib, not booklet. **Confirmed.**

UX `SA2x` (C2) prints "Group Insurance Product Summary (page 13)", "Group Personal Accident Benefit Summary (page 8)" and "Daniel's sum insured of
S$600,000 (Group Personal Accident, printed as of 1 April 2024)". Those are actuallib's product names and Daniel's row (`actual-lib.ts`: PA S$600,000, 01/04/2024).
The booklet household prints PA S$300,000 as of 01/04/2024, and its Simple table pays Arm 40% (S$2,000), not 25%. The UX run seeded only fracture, actuallib,
deathjourney and livelib (its FINDINGS.md). Actuallib reproduces real pages that define neither fracture type, so the "no definition" sentence is true there
(real-anonymised). The booklet pages (synthetic) define Simple as closed, so a closed fracture fits Simple only. That the app shows no Other Fracture amount there is
the Developer's test result (`reliable-chat:applicability-test` 36/36). QC did not run it.

### Developer claim 2 (livelib, synthetic): Repatriation S$2,000 and the travel S$100,000

- **Repatriation: supported.** SUM p9 prints "Repatriation of Mortal Remains: S$2,000 per Insured Person, if death occurs outside Singapore as a result of an
  Accident." C3's one-line-benefit rule renders it as S$2,000 "with the printed condition “per Insured Person, if death occurs outside Singapore as a result of
  an Accident”". That is the right amount, currency (S$ printed on the summary; the wording p3 prints a bare "$2,000"), condition and benefit.
- **Travel "Accidental Death: S$100,000" without its trip: misleading, and a contract failure.** The figure itself is printed, so it is not invented, but the
  same schedule prints "Period of Insurance: 10/03/2025 to 17/03/2025" and "Destination: Indonesia" (insured person Adrian only). For a death in Japan, stating
  S$100,000 without the period and destination drops the qualifiers that decide applicability. On the printed facts it does not fit a Japan death unless that death
  happened in that week and the destination term is shown not to matter. DC's contract: "never remove a qualifier and leave a misleading amount". **Severity: high**,
  because an amount appears applicable that its own document's terms make unlikely. The smallest acceptable form, from the pages: the S$100,000 with its period,
  destination and insured person, said as not shown to apply to this event; or leave the line out. Also low: the Term Life "Terminal Illness Benefit" line in a
  death answer is irrelevant to a death.

### Evidence verdict on C3 (input to the coordinator's release decision)

- **No wrong claimable amount** shown on any J1-J6 journey, by page evidence (code trace and scripted transcripts).
- **One misleading amount is open:** livelib travel S$100,000 without its period and destination (synthetic household; affects any death answer in a library
  that holds a dated trip schedule).
- **Not settled without a live run:** J6, J5, J2, then J3/J1 (section 6). **Not settled without DC's real library:** everything. All evidence here is
  anonymised or synthetic, and all of it is scripted or OpenAI-configured.

## 9. Final source check on C4 `fbeed4af76800a62c866def07b6d6bd1587c5749`, and the final evidence summary

C4 changes product code in `absence-scope.ts`, `loop.ts` and `statement-render.ts`. Evidence: Code trace (QC) over the pages; no QC test runs, no model calls.

| changed answer | household (source) | verdict from the pages |
| --- | --- | --- |
| Closed fracture beside the Other Fracture figure: "(the row the document labels “Other Fracture”; these documents do not define which fractures count as Other Fracture, or whether a closed fracture is one, so the insurer decides whether it applies)" | actuallib (real-anonymised) | **Supported.** No stored page defines Simple or Other Fracture, the household's "closed" is named, and nothing is decided for the insurer. The amount (50%/75%/20% of S$600,000, 1 April 2024) is unchanged and printed |
| Death abroad without the travel S$100,000 | livelib (synthetic) | **For the Japan question nothing supported is lost**: the PA Accidental Death 100% of S$600,000, Repatriation S$2,000 with its condition, and Term Life S$1,000,000 come from pages that print no period or destination, so the new rule leaves them alone. **But the rule hides the travel benefit too often (new finding, high):** (a) "ended" compares the trip's end with *today*, not with the date of the death, so a death that happened during the trip and is asked about afterwards (the normal case for a claim) loses it; (b) "elsewhere" is true whenever the message does not repeat the printed destination word, so "died in Bali" or a message naming no place at all also loses it. That hides a documented benefit for the right person and period, which DC's contract counts as a failure. From the pages, the safe form is the figure with its printed period, destination and insured person, said as applying only to a death in that trip; or suppress it only when the reported date or place contradicts the printed ones |
| Partial-copy wording (dental, cancer): "I checked Grace's documents for dental treatment: the certificate in full, and the Product Summary (pages 8, 12-13, 37 of 37) and the Benefit Summary (pages 1, 3, 5, 7-9). Those pages do not mention dental treatment. The other pages ... are not in the copy that was uploaded / may not all be in the copy that was uploaded, so I can't say either way whether there is such cover." | fracture (real-anonymised) | **Supported** and not an exclusion. Low: the reason is joined for all partial documents, so with the Benefit Summary's unknown count the sentence says "may not all be in the copy" also for the Product Summary, whose 33 missing pages are certain. The page numbers are stored indexes (PS prints one lower) |
| GP answer with an app-style name ("Daniel Lee Wei Ming" against the row "Lee Wei Ming, Daniel") | fracture (real-anonymised) | **Supported.** Every word of the display name (or the preferred name, word-bounded) on a row that names no other member picks Daniel's four rows (Term Life, Personal Accident, Living Care, Living Care Plus, all "As of 06/10/2022"), which do not include Outpatient Medicare. The BS p1 list of policies is never quoted or read as medical-expense wording. A shared surname within one household makes the rule step back (G1 stays silent): safe |

### Final evidence summary (for the release report)

**Unsupported claims (none open by page evidence):** no wrong claimable amount was found on C0 to C4 across fracture, correction, cancer, dental,
sickness and GP bill. Fixed during the round: C1's "the insurer decides whether the condition is met" for a pure sickness report (C2), and "I haven't yet
looked up" after a search (C2). The travel S$100,000 shown without its trip (C3) is removed in C4 for the Japan case.

**Supported information omitted (open):**
1. **High:** C4's trip rule hides a single-trip schedule's death benefit for any death asked about after the trip ended, or described without the printed
   destination word (livelib, synthetic; would affect any real library with a dated trip schedule).
2. GP bill: the conditional accident benefits (ambulance to hospital up to S$500 per incident; hospital stay of at least 24 hours S$250; fracture) and
   "Living Care / Living Care Plus are listed but not described". These depend on the model; a live run is needed.
3. Sickness stay: PS p37 "only payable upon an accident occurring" (low); "listed but not described" is not said because the scope is partly stored (correct).
4. Fracture: the Voluntary-Scheme context (judgement, low). The Core/Voluntary condition is shown (scripted browser evidence) but **no executable check pins it**.
5. Cancer: Living Care Plus S$300,000 is also listed; "policy definition" wording (accepted gaps).

**Evidence not available:**
- **DC's actual library** and the saved production conversations (including DC's GP-bill trace, whose read was blocked). Everything here is anonymised copies or synthetic test data.
- **Unstored pages:** Product Summary 33 of 37 pages; Benefit Summary pages 2, 4, 6, section I and 10 onward (total unknown). No page describes Living Care,
  Living Care Plus, Outpatient Medicare, Disability Income or the Core Scheme, or defines Accident, Simple Fracture or Other Fracture (fracture and actuallib households).
- **A real model on C1 to C4:** all candidate evidence is scripted or a code trace. The last live run (fx-live-2) used the OpenAI configuration on `c4edd48`;
  nothing covers the Claude model switch (PR #59). Journeys needing a live run: GP bill, sickness stay, person correction, then cancer (fresh wording) and fracture repetition.
- **Consistency:** every live conversation ran once.

## 10. Closed hip fracture in actuallib (UX on C4, relayed 07:09Z)

Pages (actuallib, real-anonymised: `actual-lib.ts` PA_P8 = group-pa-benefit-summary.json p8, PS_P13 = group-product-summary.json p13; the certificate's
S$600,000 is the report-verified PA sum, but its date 01/04/2024 is the fixture's own):
- PA Benefit Summary p8, "E. Simple Fracture or Other Fracture due to Accident": "If an Insured Person sustains bodily injury as a result of an Accident, which
  results in a Simple Fracture **or** Other Fracture of the nature mentioned in the table below, we will pay..."; "(% of Sum Insured)"; row "Hip 75%",
  **unlabelled**. Only the Jaw/Pelvis/Leg/Ankle/Knee and Arm/Elbow/Wrist/Ribs rows carry "(Other Fracture)". The condition under the table reads "This Benefit
  can only be claimed either under the Core Scheme or Voluntary Scheme."
- Product Summary p13, "Simple Fracture due to Accident", Benefit Limit S$5,000, "(% of S$5,000)": row "Hip 75%".

**Verdict: S$450,000 for a closed hip is supported as an illustration of PA p8's own terms, and which document applies is undetermined.**
- The hip row on p8 is not limited to Other Fracture. The benefit covers "a Simple Fracture or Other Fracture" of the listed nature, so a hip fracture of
  either kind, closed included, is within its wording whatever the undefined terms mean. 75% × S$600,000 = S$450,000 is printed arithmetic. It is not an
  "insurer decides the fracture type" case, unlike the labelled rows.
- What is undetermined is the **relationship between the two documents**: p13 gives 75% × S$5,000 = **S$3,750** for the same hip row under a Simple Fracture
  table. Neither page says which governs, and the gap is 120x. That is the same open relationship as J1, and the highest-risk amount pair in the library.

**What the answer should say beside S$450,000** (from the pages, no new claim): that the Benefit Summary's hip row applies to "a Simple Fracture or Other
Fracture", so the household's closed fracture is within its wording; that it is 75% of Daniel's S$600,000 as printed on his certificate (dated); its printed
condition "can only be claimed either under the Core Scheme or Voluntary Scheme"; that the Product Summary's Simple Fracture table gives S$3,750 for the same
hip row; that the documents do not say which applies; that the two are never added; and that the insurer decides which applies and any claim. It must not
attach the "do not define which fractures count as Other Fracture" note to this row (that would be another row's condition), and it must not drop S$450,000,
because that would hide a documented benefit.

## 11. Final check on C5 `177c073427bab0acb231a34018208a8d0448100f`, and the final evidence summary

C5 changes product code in `absence-scope.ts`, `loop.ts` and `statement-render.ts`. Evidence: Code trace (QC); UX browser transcript on C4 for the hip (the hip
path is unchanged in C5; Scripted). No QC test run, no model call.

| check | source | verdict |
| --- | --- | --- |
| Death abroad: travel S$100,000 with its limits | livelib TRAVEL p1 (synthetic): "Insured Person: Wong Jia Hui, Adrian", "Period of Insurance: 10/03/2025 to 17/03/2025", "Destination: Indonesia", "Accidental Death: S$100,000" | **Confirmed by code trace.** C4's hiding rule is removed. `tripLimits` reads those three printed lines from the amount's own page and adds, cited: "The schedule prints this cover for the insured person “Wong Jia Hui, Adrian”, the period of insurance “10/03/2025 to 17/03/2025” and the destination “Indonesia”; whether that trip fits this event is for the insurer to confirm." Values, person and page are exact; nothing supported is lost, and PA 100% of S$600,000, Repatriation S$2,000 and Term Life S$1,000,000 are untouched. Low: it does not say that the household named Japan, which differs from the printed destination; the reader has to compare. The C4 trip-hiding finding is **closed** |
| Partial-copy wording | fracture household (real-anonymised): CERT pageCount 1 (1 stored), PS pageCount 37 (stored 8, 12, 13, 37), BS pageCount unknown (stored 1, 3, 5, 7, 8, 9) | **Matches.** The PS is proven short (4 < 37), so "The other pages are not in the copy that was uploaded"; the listing reads "the certificate in full, and the Product Summary (pages 8, 12-13, 37 of 37) and the Benefit Summary (pages 1, 3, 5, 7-9)". That is also true for the BS on these pages (its gaps 2, 4 and 6 prove missing pages). Low, general: the "definite" form is chosen if *any* partial document is proven short, so a document with an unknown count and no gaps would share the definite wording. Not the case here |
| Closed hip, two-document caveat | actuallib (real-anonymised) PA p8 / PS p13 | **Present** (UX `c4-fbeed4a/SA2x.txt`): "two different answers ... does not settle which applies ... never a total"; S$3,750 (75% of S$5,000, PS p13) and S$450,000 (75% of Daniel's S$600,000, printed as of 1 April 2024, PA p8), each "not a payment or an insurer's decision"; the Core/Voluntary condition; the bases note; next step "ask which of the two schedules applies". No "Other Fracture" note on the hip row (correct). It meets section 10's checklist. The fact that the hip row covers "a Simple Fracture or Other Fracture" is conveyed by the benefit's name rather than said outright: acceptable |

### Final evidence summary on C5 (for the release report)

**Unsupported claims: none open.** Across C0 to C5, no wrong claimable amount and no unsupported statement remains open in the fracture, correction,
cancer, dental, sickness, GP-bill and death-abroad journeys, by page evidence (code trace and scripted transcripts). Fixed during the round: the sickness
verdict wording (C2), "I haven't yet looked up" after a search (C2), and the travel amount without its trip limits (C3, then C5).

**Supported information omitted (open):**
1. GP bill: the conditional accident benefits (ambulance to hospital up to S$500 per incident; a hospital stay of at least 24 hours S$250; fracture) and
   "Living Care / Living Care Plus listed but not described". These depend on the model; a live run is needed.
2. No executable check pins the Core/Voluntary condition on the fracture illustration. It is shown in scripted browser runs.
3. Low: the sickness answer lacks PS p37 "only payable upon an accident occurring"; the cancer answers lack Living Care Plus S$300,000; the death-abroad answer
   does not contrast Japan with the printed destination; the fracture answers lack the Voluntary-Scheme context (a judgement call).

**Evidence not available:**
- DC's actual library and saved production conversations (DC's GP-bill trace was not read). Every finding is on anonymised copies (fracture, actuallib) or
  synthetic test data (booklet, livelib, the added deathjourney pages).
- Unstored pages: Product Summary 33 of 37; Benefit Summary pages 2, 4, 6, section I and after page 9 (total unknown). No page describes Living Care,
  Living Care Plus, Outpatient Medicare, Disability Income or the Core Scheme, or defines Accident, Simple Fracture or Other Fracture.
- A real model on C1 to C5. The only live evidence is fx-live-2 (OpenAI, `c4edd48`, one run per conversation); nothing covers the Claude switch (PR #59).
  Live runs needed, in order: GP bill, sickness stay, person correction, then cancer (fresh wording) and fracture repetition.

## 12. PR #64 (draft, Developer): GP-bill quoting, head `235d2623c45dc4ba4ebff56fdd461d362cad3bd7` (base main `ca6af69`)

Product change (Code trace, QC): `absence-scope.ts` ranks quoted lines (lines limited to "outside Singapore / overseas / abroad" last, all-capitals headings just
before them, and a line contained in another chosen line dropped); `loop.ts` G2 also searches "panel gp", "gp clinic", "gp consultation"; `compose.ts` quotes
subjectless household words ("You told me: “tripped on the kerb”."). No QC test run, no model call.

**Evidence sources.** The anonymised fracture fixture (real-anonymised) prints **no** GP, panel, clinic or overseas-treatment line, so on it PR #64 changes nothing:
G1 still states Daniel's four listed products (as of 06/10/2022) and that the Benefit Summary (page 1) names an Outpatient Medicare Policy his certificate does not list.
The two pages the PR is about are **invented** (`gp-bill-live-repro.ts`, synthetic, a hypothesis that DC's real library prints both):
- PS p20: "SECTION 4: TRAVEL ASSISTANCE" / "Emergency Outpatient Treatment Overseas" / "We will reimburse the reasonable medical expenses for emergency outpatient
  treatment received outside Singapore following an Accident, up to $1,000 per Accident."
- PS p25: "SECTION 6: CLINICAL BENEFITS" / "Panel GP Benefit" / "Consultation at a panel GP clinic in Singapore: no charge to the Insured Person. Non-panel GP
  consultation: up to $30 per visit."

**What those pages support quoting for a home GP bill (Daniel, $800, after a fall):**
- p25 is the relevant line: a panel GP consultation in Singapore at no charge, and a non-panel GP consultation **up to $30 per visit**. The "$" is bare, so the currency is
  unresolved. It is a per-visit cap, so it is not an amount for the $800 bill, and nothing is computed. Whether the visit was panel or non-panel is not reported.
  No accident condition is printed.
- p20 does not fit a bill at home ("received outside Singapore"), so leaving it out for a home bill is correct.
- **Not supported by any page: that Daniel holds the Panel GP Benefit.** p25 names no product or policy. Daniel's certificate lists Term Life, Personal Accident,
  Living Care and Living Care Plus, and BS p1 says a benefit applies only if its policy is in Part 1 and names an Outpatient Medicare Policy that is not on his
  certificate. A Product Summary line is reference wording, not proof of Daniel's cover.

**What PR #64 does (code trace on the invented pages):** the chosen quotes become "Panel GP Benefit" and the p25 consultation line (rank 0), with the overseas
lines last and cut. The household's words are quoted. **This is correct for what it quotes.**

**Still omitted or at risk:**
1. **Applicability context lost (medium-high).** When any medical-expense wording is found, G1 is skipped (`!medicalHits.length`), so the answer no longer says what
   Daniel's certificate lists or that Outpatient Medicare is not on it. The quote "The Product Summary (page 25) prints: “Panel GP Benefit” and “Consultation at a
   panel GP clinic ... up to $30 per visit”" then reads as if it were Daniel's benefit. From the pages, it should say beside the quote that the page names no
   policy, list what his certificate lists (dated), and say that the insurer confirms whether the Panel GP Benefit applies to him.
2. **Overseas ranking ignores where the bill was (medium).** A line is ranked last for being limited to treatment abroad even when the household reports a GP bill
   abroad ("GP bill in Bangkok"). With two other hits it is then cut, hiding the one supported line. The ranking should depend on the reported place, not on the line alone.
3. Panel or non-panel: the question that decides between "no charge" and "up to $30" is not asked (model-dependent, as the PR says).
4. As before: the conditional accident benefits (ambulance to hospital, a 24-hour stay, a fracture) are model-dependent and not added by the server.

**Unsupported shown:** none in the quoted text itself. The risk is item 1: the quote's placement implies cover that no page establishes.
**Not available:** DC's real library (whether it prints these two pages, which policy the panel GP benefit belongs to, and whether Daniel/Desmond's certificate
lists it), and the live answer's trace.

## 13. PR #64 re-check on head `094da7bf4fd75b37dbc290873bc1b6b99d991631`

Evidence: Code trace (QC) over the anonymised fracture fixture plus the PR's two **invented** Product Summary pages (p20 overseas clause, p25 panel GP; synthetic).
No QC test run, no model call. Message traced: "daniel tripped on the kerb and fell, his GP bill is $800, can he claim for this?"

| check | what the pages support | what 094da7b does (traced) | verdict |
| --- | --- | --- | --- |
| Whose cover the quoted line is (12.1) | CERT p1: Daniel's Term Life, Personal Accident, Living Care and Living Care Plus, all "As of 06/10/2022"; BS p1 names an Outpatient Medicare Policy (OPMC), which is not on his certificate; p25 names no policy or person | Before the note: "Daniel’s certificate lists Group Term Life, Group Personal Accident, Group Living Care and Group Living Care Plus (as of 6 October 2022). The Benefit Summary (page 1) names the scheme’s Outpatient Medicare Policy (OPMC), which that certificate does not list." After the quote: "The Product Summary (page 25) does not say whose cover that line is; it sits under “SECTION 6: CLINICAL BENEFITS”. Only the insurer or the scheme administrator can confirm whether it applies to Daniel." Built only from his own confirmed, fully stored certificate rows | **Fixed, supported.** Every clause is printed (CERT p1, BS p1, PS p25); no cover is claimed |
| Overseas line only when the bill is abroad (12.2) | p20 pays only for treatment "received outside Singapore following an Accident", up to $1,000 per Accident | The place is read from the household's words: abroad → the abroad lines are quoted first; home ("in Singapore", "polyclinic", "local GP") → the abroad line is not quoted; **not stated (this message)** → the home line is quoted, and the abroad line is said apart: "The Product Summary (page 20) also prints a benefit for treatment outside Singapore, which applies only if the treatment was abroad: “...”" | **Fixed.** Not hidden when the place is unknown, and conditional as printed. Low: "in <Capitalised word>" counts as abroad, so "in Tampines" or "in Grace's name" would be read as abroad. Both lines are still quoted when there are only two, so nothing supported is lost on these pages |
| $30 never an amount for the $800 bill | p25: non-panel GP "up to $30 per visit" (bare $), panel GP "no charge" | Quoted verbatim inside the printed line; the server computes nothing from it or from "$800" | **Holds** (server side). The model could still misuse the evidence; the composer's payout rules apply |
| Household's words | "tripped on the kerb" | "You told me: “tripped on the kerb”." | Supported |
| Real-anonymised fixture alone (no invented pages) | as section 6/J6 | No medical lines, so G1 behaves as before | Unchanged |

**Still omitted (low or model-dependent):**
- The whose-cover note covers the panel GP line, but not the separately said overseas line, which also names no policy (low).
- The benefit's own name "Panel GP Benefit" is dropped as a heading, and the note names the section instead (low; the quoted line itself says "panel GP clinic").
- Whether the visit was at a panel GP (no charge, or up to $30) is not asked, and the conditional accident benefits are not added. Both depend on the model.

**Unsupported shown:** none found. **Not available:** whether DC's real library prints these two pages, which policy they belong to, and whether his certificate lists it.

## 14. PR #64 re-check on head `7f4dbd35e2b7cdda75e33190d8f697dbacec7b18`

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Policy Evidence Reviewer | re-check Critic round 11 fixes: every statement supported, nothing supported omitted, incl. a certificate that lists Outpatient Medicare | `7f4dbd3` | done | diff of `lib/rag2/loop/absence-scope.ts`, `loop.ts` traced by hand over the fracture pages plus the Developer's invented PS p20 / PS p25 | no suite, build or model call run; DC's real library unavailable |

Message traced: "daniel tripped on the kerb and fell, his GP bill is $800, can he claim for this?"

| statement on 7f4dbd3 | supported? | pages |
| --- | --- | --- |
| Daniel's certificate lists Group Term Life, Group Personal Accident, Group Living Care, Group Living Care Plus, as of 6 Oct 2022 | Yes | CERT p1 |
| The scheme names an Outpatient Medicare Policy that his certificate does not list; a benefit applies only if its policy is listed | Yes. The new distinctive-word comparison finds no shared word between "Outpatient Medicare" and his four products | BS p1, CERT p1 |
| Quote of the panel GP line, followed by the note "The Product Summary (page 25) prints that line under “Panel GP Benefit” in “SECTION 6: CLINICAL BENEFITS”, and it does not say whose cover it is" | Yes. The note now sits under the quote and names the benefit. It makes no "does not list" claim, correctly, because the section prints no policy name | PS p25 (invented) |
| Overseas outpatient line said only as abroad-only, and only because the message did not say where | Yes. Abroad is now read from explicit words only ("overseas", "abroad", "on holiday", "travelling", "on a trip"); "in Tampines" or a kerb no longer reads as abroad | PS p20 (invented) |
| No amount computed from $800; $30 is only quoted | Yes | PS p25 (invented) |

**Certificate that lists Outpatient Medicare.** With Daniel's rows changed to "GROUP OUTPATIENT MEDICARE" (or "GROUP OPMC"): `unlisted` is false and `schemeListing` returns null, so no "does not list" sentence is written, and the listed product appears with his other certificate rows. Correct: no false exclusion, and the listed cover is not hidden.

Low items, none blocking:
- A shared generic distinctive word between a scheme policy and a listed product (for example "care") would suppress a true "does not list". That errs on the safe side (says less, never wrongly excludes).
- When the place is not stated, the abroad-only line comes before the home quote. It is labelled abroad-only, so it does not mislead, but the home benefit reads second.
- Still model-dependent from earlier rounds: no panel/non-panel question, and the conditional accident benefits (ambulance S$500, hospital stay S$250, fracture alternatives) are not added by the server.

**Verdict:** every statement traced is supported, and nothing supported is newly omitted. **Unsupported shown:** none found. **Not available:** whether DC's real library prints these pages, which policy they belong to, and whether his real certificate lists it.

# fx-live-2: reviewed disposition of every failed check

Written 20 Oct 2026, after the run, for the PR #57 review. **The original grades are not changed and are not presented as passes.** The registered criteria (`scripts/rag2-live/fx-live-2-criteria.ts`) and the v1 usefulness grader (`scripts/rag2-live/usefulness-check.ts`) are byte-identical to the versions that graded the run; `criteria.md` and `report.md` in this folder are their output. Applied mechanically, the registered recommendation rule returned **HOLD** and that result stands as recorded.

This file adds a second column: a reviewed reading of each failed check, supported by the complete visible answer. It was made from the answers and the clauses the checks matched, not from a rerun. No model was called for it. The reviewed rules live in `scripts/rag2-live/fx-live-2-criteria-v2.ts` with their controls (`fx-live-2-criteria-v2-regressions.ts`, 35 controls), and `answers.json` holds the saved answers they run on. `criteria-reviewed.md` prints both grades side by side.

| conversation | check | original | reviewed disposition | kind |
|---|---|---|---|---|
| K3t1 | D5.c (and v1 `K3t1.6`) | **FAIL** | grader false positive: a negated clause | negation |
| K6a | D2.b | **FAIL** | grader window too narrow; the limitation is in the answer, two sentences before the amount | multi-sentence limitation |
| K6c | D2.b | **FAIL** | grader verb list lacks "establish"; the limitation is the next sentence | multi-sentence limitation / wording |
| K4b | D7.c (and v1 `V0`) | **FAIL** | safeguard worked: one unsupported sentence kept out; the visible answer loses nothing | composer drop, reviewed as SAFEGUARD (not a pass) |
| K2 | v1 `K2.3` | **FAIL** | not a defect of the answer to the question asked; a recorded usefulness gap that stays open | pre-registered difference |

Counts: the registered criteria ran 70 checks and 4 failed; the reviewed reading leaves 0 failed and 1 safeguard drop. v1 failed three checks (`K2.3`, `K3t1.6`, `V0`); the review explains all three and changes none.

## K3t1 D5.c and v1 K3t1.6: "neither document is said to prevail"

**What the check matched.** The pattern for "a document prevails/governs" matched the word *governs* in: "The uploaded documents do not establish which document governs this event."

**Complete answer (user: "grace fell down and broke her arm").**

> Grace’s documents give different alternatives for this event, and do not establish which applies; the amounts are not to be added together.
> If the Simple Fracture benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs”, the conditional illustration is S$1,250: 25% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision; the page prints a footnote for that row: “For the avoidance of doubt, any fractures of thumb, finger and palm are not covered” (marked #).
> If the Simple Fracture or Other Fracture due to Accident benefit applies to Grace's case “Arm, Elbow, Wrist or Ribs” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$120,000: 20% of Grace's sum insured of S$600,000 (Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date), in the Certificate of Insurance Part 2 (page 8); it is an illustration from the document's terms, not a payment or an insurer's decision.
> The Product Summary and Certificate of Insurance Part 2 use different bases for their fracture percentages.
> The uploaded documents do not establish which document governs this event.
> Grace's documents give two different answers for this event, and what they say does not settle which applies: these are alternatives from separate documents, never a total.
> The Product Summary (page 13) takes its percentage of a fixed Simple Fracture Benefit Limit; the Certificate of Insurance Part 2 (page 8) takes its percentage of Grace's own sum insured. The Product Summary describes itself as a summary and says the precise terms are set out in the certificate of insurance (page 37; its information is dated July 2021). The Certificate of Insurance Part 2, its highlights of cover, says it is not a contract of insurance (page 1). Neither document says whether one amends, replaces or adds to the other, or which applies to this event.

**Disposition.** The only match is a *negated* use ("do not establish which document governs"), which says the opposite of what the check looks for. Neither document is said to prevail; the answer says twice that the documents do not settle which applies, and gives no total. Reviewed rule: a prevail/govern phrase counts only if its own clause does not negate it, ask about it ("which", "whether", "if") or leave it unsettled. Controls: the live sentence is not a pick; "The certificate governs this event" and "The Product Summary prevails over the certificate" are; "The documents do not say which prevails, but the certificate governs" is (the negation is in an earlier clause); the answer with "The certificate prevails." added still fails.

**What stays open (not graded here).** The answer is repetitive: "the documents do not establish which applies" is said about three times and "different bases" twice. That is a readability defect, not a wrong fact, and it is not changed by this PR.

## K6a D2.b: the limitation within reach of the amount

**What the check matched.** The registered window is one sentence before and two after the S$350,000 sentence. The answer's order is: the limitation (sentence 1), its explanation (sentence 2), the amount (sentence 3). Sentence 2 is the only one inside the window, and it carries no cancer word.

**Complete answer (user: "What does Grace's Group Living Care pay if she is diagnosed with cancer?").**

> The Scheme X Group Insurance does not state what Group Living Care pays for cancer. That is not the same as saying it is excluded or not covered: it only means this document does not show it, and only the insurer can confirm it.
> Grace’s certificate lists Group Living Care at S$350,000 as of 6 October 2022; this is the amount shown on that date, not confirmation of cover now.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance Scheme to ask what it needs for a claim.

**Disposition.** Window miss. The limitation is in the answer, two sentences before the amount, explained by the sentence between them, and the amount's own sentence says it is "not confirmation of cover now". A reader meets the limitation first. No payment is promised (D2.d passes). **Weaker than ideal:** the limitation is in an earlier paragraph than the amount rather than attached to its sentence; I did not change the product for that.

Reviewed rule: two sentences before or after, with no other amount in between, and the limitation verbs include *establish*, *determine*, *confirm*, *tell*. Controls: the K6a and K6c shapes pass; the amount alone fails (the fx-live-1 K6a defect); a limitation three sentences before, four after, about another topic, or separated by another benefit's amount does not count.

## K6c D2.b: "do not establish"

**Complete answer (fresh wording; user: "Grace has just been told she has cancer. How much will her Group Living Care pay out?").**

> Grace’s certificate lists Group Living Care at S$350,000 as of 6 October 2022; that dated amount does not confirm cover now.
> The uploaded documents do not establish whether Grace’s cancer meets the policy definition or what amount would be payable for it.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance Scheme to ask what it needs for a claim.

**Disposition.** Regex miss: the limitation is the sentence directly after the amount ("do not establish ... what amount would be payable for it"), and the registered verb list has *state, describe, say, specify, show, give* but not *establish*. No promise, and the amount is dated and "does not confirm cover now". Minor wording point: "the policy definition" implies that a definition exists; none was shown. K6c is the only conversation in the run that is not regression data, and it is one wording.

## K4b D7.c and v1 V0: the composer drop

**What the check matched.** The trace of turn 2 records one removal by the composer: "The certificate wording also leaves open whether Daniel's diagnosis meets its definition of the listed arm fracture; that requires the insurer's medical assessment." Reason recorded: "not supported by its evidence: “that requires the insurer's medical assessment.”: its evidence does not mention what it is about (requir, insurer, medical, assessment)".

**Complete visible answer of turn 2 (user: "Actually it was Daniel who broke his arm, not Grace.").**

> Updated: this is about Daniel, not Grace. The earlier estimates I worked out for Grace from the injury and how it happened no longer apply, because they were worked out for Grace's policy, not Daniel's.
> Daniel's documents give two different answers for this event, and what they say does not settle which applies: these are alternatives from separate documents, never a total.
> If the Simple Fracture benefit applies to Daniel's case “Arm, Elbow, Wrist or Ribs”, the conditional illustration is S$1,250: 25% of the Simple Fracture benefit limit of S$5,000, in the Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision; the page prints a footnote for that row: “For the avoidance of doubt, any fractures of thumb, finger and palm are not covered” (marked #).
> If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Arm, Elbow, Wrist or Ribs” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$120,000: 20% of Daniel's sum insured of S$600,000 (Group Personal Accident, printed as of 6 October 2022, not confirmation of cover on a later date), in the Certificate of Insurance Part 2 (page 8); it is an illustration from the document's terms, not a payment or an insurer's decision.
> The uploaded documents do not establish which of these two fracture provisions applies to Daniel's event.
> The Product Summary says precise terms are in the certificate, while the certificate wording has a separate fracture benefit.
> The Product Summary (page 13) takes its percentage of a fixed Simple Fracture Benefit Limit; the Certificate of Insurance Part 2 (page 8) takes its percentage of Daniel's own sum insured. The Product Summary describes itself as a summary and says the precise terms are set out in the certificate of insurance (page 37; its information is dated July 2021). The Certificate of Insurance Part 2, its highlights of cover, says it is not a contract of insurance (page 1). Neither document says whether one amends, replaces or adds to the other, or which applies to this event.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance Scheme to ask which of the two schedules applies to this event, and what it needs for a claim.

**Disposition.** The safeguard worked. No cited page prints an "insurer's medical assessment" requirement, so the sentence asserting one was kept out, and the visible answer keeps everything the criteria need (one notice, Daniel's figures with his own S$600,000, alternatives, no total). The registered check cannot tell a harmless safeguard from lost content, so it fails on any drop. The reviewed grade is **SAFEGUARD, not PASS**: the removal stays reported with its reason. Reviewed rule: a drop is a SAFEGUARD only if every removed sentence is "not supported by its evidence", asserts a requirement, did not reach the answer, there is no gate removal or "incomplete" notice, and every correctness check of the conversation passes; any other drop stays FAIL (controls for each).

## K2 v1 K2.3: the one the review does not clear

`K2.3` asks that the answer says what the documents do not show for sickness: that the certificate lists Group Living Care / Living Care Plus but no page describes them. This was stated before the run (`EXPECTED-fx-live-2.md`): the repaired answer explains the accident condition instead, so `K2.3` could FAIL while the registered D3 passes.

**Complete answer (user: "Grace was hospitalised for three days last week because she was sick. Does her accident cover pay anything?").**

> Accidental Hospital Recuperation Benefit (page 9) is printed with an accident condition (“if within 30 days following bodily injury as a result of an Accident”). The cause you reported (“she was sick”) is an illness, not an accident, so on what you have told me this benefit's condition is not met and no amount is given for it.

**Disposition.** The answer is correct to the question asked and promises nothing; the household was asked no repeated accident question. But it does not say that *other* listed cover (Living Care) might bear on a sickness and is not described in the documents. That is a usefulness gap against the older grader, not a safety or correctness failure. **It stays an open FAIL**, not cleared by this review, and nothing in the product was changed for it.

## Not a failed check: Sources under the dental answer

The dental absence answer (K6b) was graded PASS, but its saved Sources were a S$300,000 row, the toe/foot footnote and a page-8 claim-condition sentence, none about dental. That was not graded; it is fixed in this PR, with the scope evidence kept: see `RESULT-fx-repairs.md` and the group A tests (A8 to A10).

## What this review does and does not establish

* It does not change a single original grade and does not rerun the model. The saved answers are the evidence.
* Of the four registered failures, three are shortcomings of the grader (a negation, a window, a verb), and one is a safeguard doing its job. The fifth failure (v1 `K2.3`) is a usefulness gap that remains.
* This is one attempt per conversation, one household, and K6c is the only fresh wording. It is not a claim of 99% or 100% accuracy.

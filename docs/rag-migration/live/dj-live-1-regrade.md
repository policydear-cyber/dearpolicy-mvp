# dj-live-1 regrade (separate from the original grade)

The original grader (`scripts/rag2-live/death-check.ts`, death-v1) and its verdicts (`dj-live-1-grade.md` / `.json`: D1 FAIL, D2 FAIL, D3 FAIL,
F1 FAIL) are **unchanged**. This file records, per failed check, the actual sentence, and whether I read the failure as a **grader false
positive** (the visible answer is right and the check is too literal) or a **product failure** (the answer is wrong or incomplete).
It is a reading of the saved transcripts (`RUN-dj-live-1-2026-10-18T15-14-48/conv-*.json`), not a new grade, and it does not turn any FAIL into a pass.

## Product failures (kept as failures)

| run | check | what the visible answer did | earliest broken boundary |
|---|---|---|---|
| D3 | A1, A2, A3, A6, A7, A10, A11, A12 | Replied only "I need to know who this is about first. Do you mean Daniel Lee Wei Ming (Daniel), or someone else in the household?" (options labelled "(your you)"). No benefit, amount, condition or next step. **Critical: an empty answer to a death question.** | `resolvePersonAmong` (people.ts): the speaker was inferred from the single "self" member (Daniel); "my husband Daniel" then named a relation ("husband") the inferred speaker cannot have to himself, so it was treated as a conflict. The skill forbids inferring the speaker from a "self" label. |
| D2 | A7, A12 | The visible answer has Term Life and Personal Accident but **no Compassionate Death Allowance** (and no Repatriation), although the model wrote both sentences. | Statement verification (`statements.ts` `checkCitedStatement`): "…the document does not say which currency) for funeral expenses if an insured person dies…" matched the *negative* pattern ("not … insured") and the whole sentence was dropped as "says something is not covered / not included, but its evidence says nothing of the kind"; the benefit's terms were not restored because no step added a death benefit the reply no longer stated. Same cause dropped "the certificate amount is dated and is not confirmation of current cover". |
| F1 | F3 | The question's third part ("is it separate from the death benefits?") was **not answered**. The model's sentence "The uploaded documents do not establish that the Simple Fracture benefit is payable separately from death benefits; they describe separate benefits, but do not state whether both can be paid for the same event." was dropped whole ("they describe separate benefits": its evidence does not mention describe, separate). | Statement verification dropped a compound sentence for its one loosely worded clause, and nothing stated the distinction from the records. |
| D1 | (not caught by the grader) | The sentence "…Daniel’s enrolment in that booklet is not confirmed and its bare “$” does not identify a currency." — see below. | `compose.ts` `enrolmentAbsenceClaim`: an "enrolment in that booklet" denial was left as said because "booklet" was neither a scheme nor a listed product. |

### D1: the sentence, the evidence, and what is and is not accurate

Sentence (D1, cites e18 = Group Insurance Benefits Booklet, page 9): "The Group Insurance Benefits Booklet describes a compassionate death allowance of up to $2,000 … on proof of death and prescribed documents, and says it can be claimed under either the Core Scheme or Voluntary Scheme; **Daniel’s enrolment in that booklet is not confirmed** and its bare “$” does not identify a currency."

Three separate things the sentence runs together:

1. **The certificate lists Daniel under the product on its date: established.** Certificate (policy …101, page 1): "SCHEME X GROUP INSURANCE SCHEME (GROUP POLICY NO. GIS-8000) … GROUP TERM LIFE (POLICY NO.GTL-8001) … Lee Wei Ming, Daniel S$1,000,000 As of 06/10/2022", and the same for Group Personal Accident S$600,000. The booklet (policy …104) is stored under the same group policy number GIS-8000. A booklet is the wording of that group policy; one is not "enrolled in" a booklet. So the phrase "enrolment in that booklet is not confirmed" **denies something the documents do establish** (his dated listing under group policy GIS-8000). That part is inaccurate as worded.
2. **Core / Voluntary membership: unresolved.** The booklet prints "This Benefit can only be claimed either under the Core Scheme or the Voluntary Scheme", and the certificate does not say which. Legitimate uncertainty. (The same answer's other sentence, "…do not establish who would receive the life benefit…", is also legitimate.)
3. **Cover on the event date: unresolved.** The certificate is dated 6 October 2022. Legitimate.

Also unresolved and legitimately uncertain: whether the allowance is among Daniel's covers (the certificate lists only Group Term Life and Group Personal Accident rows) and the currency of the booklet's bare "$".

Verdict: a **minor correctness defect** (an unsupported denial of item 1, not a wrong amount, person, benefit or condition). The uncertainties in items 2 and 3 are accurate and are kept by the repair. Limits of this reading: this is the synthetic death-journey household; the shared group policy number is a property of that fixture, and I have not checked it against the actual library.

## Grader false positives (the visible answer is right; the check is too literal)

| run | check | sentence | why it is a false positive |
|---|---|---|---|
| D1 | A3 (date stated and amounts not presented as current cover) | "Daniel’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; … but the uploaded documents do not establish that this amount remains current today." | The date is stated and the answer **denies** current cover; the CURRENT_COVER pattern matches the word "current" inside that denial. |
| D1 | A7 (allowance with its printed conditions) | "…on proof of death and prescribed documents, and says it can be claimed under either the Core Scheme or Voluntary Scheme" | Every condition is present (accident, proof of death, prescribed documents, Core or Voluntary); the check requires the literal words "prescribed form" or "relevant documents". |
| D2 | A6 (accident-dependence stated) | "The product summary describes Accidental Death as 100% of Sum Insured following bodily injury caused by an Accident that results in death within 365 days." | Dependence on an Accident is stated; the pattern only recognises "if / only if / where / when / results from / as a result of … Accident". |
| F1 | F2 (the fracture's own condition, no borrowed text) | "The wording says the benefit applies when bodily injury results from an accident and causes a listed Simple Fracture; the hip row is 75% of the limit." | The condition is given and nothing is borrowed (no 365 days, no death or dismemberment text); the check tests the capitalised word "Accident" case-sensitively. |

Counts: product failures D3 (critical), D2, F1, plus the D1 defect above; grader false positives D1 A3, D1 A7, D2 A6, F1 F2. D1's other twelve checks and D2's A1–A5, A8–A11 passed as originally graded. A pass of a check does not override reading the answer: D2 passes G1 ("no dead end") while omitting the allowance.

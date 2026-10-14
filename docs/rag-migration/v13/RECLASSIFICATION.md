# Reclassifying the s48 actual-model results (post-hoc, 14 October 2026)

The original runs are preserved unchanged: `docs/rag-migration/live/RUN-s48-live-{1,2,3}-*`, including their `stress-grade.json` and `stress-grade.md`. The grader `scripts/rag2-live/stress-check.ts` was pre-registered before any run and has not been edited. Everything below is a post-hoc correction made after reading the results, and it is labelled that way.

## 1. s48-live-2, turn 2: a factual correctness failure (now fixed)

The visible answer to "How much is my personal accident cover?" was:

> Ivan’s Arbor Civil Service Group Scheme certificate lists a sum assured of S$400,000 as of 1 April 2026; …

- The model tagged that sentence `Group Personal Accident`.
- S$400,000 is the certificate's **Group Term Life** amount; the Personal Accident amount is S$200,000.
- So the answer stated the Term Life figure as the Personal Accident cover. That is a **factual correctness (wrong-product) failure**.

It was recorded as a usefulness failure ("S$200,000 is stated" failed) only because the grader's safety regex needed the words "personal accident" next to the figure.

The cause was the composer's figure-identity binding from `5568ddc`. It was fixed in `fdc2dae`:
- the product check now reads the sentence's own benefit field;
- a shared word such as "Group" no longer counts as naming a product.

The answer is replayed with no model call in `npm run rag2:stress-test` (the s48-live-2 replay). On the final candidate of this PR, when no repair is available, that replay shows:
- no S$400,000;
- the certificate with its separate Group Term Life and Group Personal Accident products.

The same case on the report-layout household is R6, in both the model-free suite and the browser spec.

Turn 3 of the same run is **not** reclassified. Its visible answer was the "couldn't identify" person reply, and S$400,000 was not shown. That was a person-resolution and usefulness failure, also fixed (`my … cover` now means the speaker).

## 2. "Bob is not in the household and the members are offered": disputed

This expectation is treated as **disputed, not as a product requirement**:
- The same reply is deliberately given for a name that belongs to *another* household. Listing members would let one name prompt a choice across households.
- No further model run was spent on it.

## Verdicts with these two corrections applied

These are post-hoc, alongside the original pre-registered verdicts:

| run | code | pre-registered | factual correctness failures | usefulness failures | disputed |
|---|---|---|---|---|---|
| s48-live-1 | `df2c8e2` | FAIL, 4 of 26 | 0 | 3 (turn 3 correction; turn 4 illustration and its record) | 1 (Bob) |
| s48-live-2 | `5568ddc` | FAIL, 5 of 26 | **1 (turn 2, Term Life stated as PA)** | 3 (turn 3; turn 4 illustration and its record) | 1 (Bob) |
| s48-live-3 | `fdc2dae` | FAIL, 1 of 26 | 0 | 0 | 1 (Bob) |

On these corrected terms, s48-live-3 has no factual or usefulness failure. It is still one six-turn conversation on one synthetic household, and is not evidence of general accuracy.

# rc-live-3 — pre-registered real-model batch (written before the run)

**Candidate:** `ee5c2b0712e35abc0462d911d864b829a22f82c9` (PR #52 head: rc-live-2's candidate 7c7b68f + the post-run
withdrawal-note fix in `lib/rag2/loop/loop.ts`). Purpose: verify that fix with the real model and repeat rc-live-2's
batch unchanged on the final code.

Authorised (16 Oct 07:31 SGT): spending cap raised to **US$0.50**. The exercise ledger's own ceiling is already US$0.50
and the US$0.15 `trial-codespace-1` reservation stays untouched, so what can actually be spent is the unreserved
balance, **US$0.041822** before this batch. Reconciliation: rc-live-2 spent US$0.015067 of its US$0.02 cap
(0.056889 → 0.041822); nothing has been spent since.

Same scenarios, same wording, same grader v2 (unchanged, not edited after the run) and the same expectations as
rc-live-2 (below). Every scenario is named with `--scenarios` and checked with `--dry-run` before any spend. All
attempts are kept; no rerun until green.

## Budget plan
- `rc-live-3-tan`: cap **US$0.020** (RCT2a, RCT2b; ≈US$0.011 expected).
- `rc-live-3-wong`: cap **US$0.015** (RCW4a, RCW4b, RCX; ≈US$0.005 expected).
Batch ceiling US$0.035, below the US$0.041822 unreserved balance.

## Specific to this batch
- **RCT2 turn 3** must say on the page that the S$10,000 no longer applies, whether or not turn 2 ended with a question
  (rc-live-2 RCT2b failed exactly here).

---
## Scenarios
| id | run | turns (verbatim) |
|---|---|---|
| RCT2a | tan | "My son Jun fractured his leg at football training. What could his personal accident policy pay?" → "The doctor said it was the shin bone." → "Sorry, I got that wrong - the X-ray shows it was his thigh bone." |
| RCT2b | tan | the same, attempt 2 |
| RCW4a | wong | "Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment." |
| RCW4b | wong | the same, attempt 2 |
| RCX | wong | "Adrian fractured his wrist falling off his bicycle. What can we claim for it from his accident cover, and who should I contact?" |

The fracture wording is rc-live-1's and rc-live-2's, unchanged, so its two failures (shin bone; the paraphrased what-if) and the
insurer-review question are tested directly.

## Expected (grader v2; C correct · K terms · S source-bound · U useful)
- **RCT2**: turn 1 — the Fracture Benefit's leg rows (20 % / 10 %) of Jun's own S$100,000 sum insured and exactly one
  question, which bone; no amount. Turn 2 — S$10,000 (10 % × S$100,000) from a recomputing record, no question. Turn 3 —
  S$20,000, recomputing; the withdrawal of the S$10,000 **said on the page**; **no further question** (none about the
  insurer's review). Contact advice, if any, names only Aurora Assurance.
- **RCW4**: S$2,500 = 50 % × the S$5,000 Simple Fracture Benefit Limit, recomputing, bound to the summary; no question;
  gate clean; contact advice, if any, names only Kestrel Life Ltd.
- **RCX**: no illustration; the documents' fracture cases said, with **no case for a wrist**; **no question** offering
  the listed cases; a contact step naming **Kestrel Life Ltd** (or the scheme administrator / employer) — never
  KestrelOne alone, never Harbourline; no inventory; no "couldn't confirm".
- Every turn: no orphaned fragment, no promise of payment, nothing rejected by the gate.

Timing (reported, not a pass condition): send-to-answer and model time per turn; targets 10 s (direct lookup) and 20 s.

A conversation counts as **successful only if it is correct and useful throughout**; my review of each complete
transcript is reported beside the grader's verdict.

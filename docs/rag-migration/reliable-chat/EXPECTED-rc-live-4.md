# rc-live-4 — pre-registered real-model batch (written before the run)

**Candidate:** `0222152792a0bd8e442a3c83f34fcceae895b26d` = ee5c2b0 + the rc-live-3 results + one fix: an answered case
question is never put back (`lib/rag2/loop/loop.ts`, `types.ts`; replay in `reliable-chat-live-regressions.ts`).
Purpose: verify that fix with the real model and repeat the same five conversations on the final code.

Authorised: cap US$0.50 (16 Oct 07:31 SGT); spendable = the unreserved balance, **US$0.026491** after rc-live-3
(0.041822 − 0.015331). The US$0.15 `trial-codespace-1` reservation stays untouched. Same scenarios, wording, grader v2
and expectations as rc-live-2 / rc-live-3 (below). Dry-run first; all attempts kept; no rerun.

## Budget plan
- `rc-live-4-tan`: cap **US$0.016** (RCT2a, RCT2b; ≈US$0.011 expected).
- `rc-live-4-wong`: cap **US$0.010** (RCW4a, RCW4b, RCX; ≈US$0.005 expected).
Batch ceiling US$0.026, below the US$0.026491 unreserved balance. After this batch no further real-model run fits.

## Specific to this batch
- **RCT2 turns 2 and 3**: no answered question put back ("here is the question I was on" with the bone question).
- RCT2 turn 3 says the S$10,000 no longer applies (verified in rc-live-3 RCT2b; must hold again).

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

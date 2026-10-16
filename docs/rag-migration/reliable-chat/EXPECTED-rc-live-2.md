# rc-live-2 — pre-registered real-model batch (written before the run)

Authorised: one planned batch, **cap US$0.02** and the available unreserved balance (US$0.056889 before the run), the
US$0.15 `trial-codespace-1` reservation untouched. Two runs of the live harness (one per household); every scenario is
named explicitly with `--scenarios` and checked with `--dry-run` (no seeding, no server, no model call) before any
spend. All attempts are kept; no rerun until green. Grader: `scripts/rag2-live/reliable-chat-check.ts`, **grader v2**
(stricter than v1; its controls include the actual rc-live-1 transcripts v1 passed), unchanged after the run.

## Budget plan
The run-cap guard reserves the worst case of each call (up to ≈US$0.004) before sending it, while calls cost ≈US$0.0003.
- `rc-live-2-tan`: cap **US$0.0145** (two 3-turn conversations, ≈US$0.011 expected).
- `rc-live-2-wong`: cap **US$0.02 − what rc-live-2-tan actually spent** (three 1-turn conversations, ≈US$0.0045 expected).
If the guard refuses a call, that conversation is BLOCKED (not an answer failure) and what it leaves unverified is reported.

## Scenarios
| id | run | turns (verbatim) |
|---|---|---|
| RCT2a | tan | "My son Jun fractured his leg at football training. What could his personal accident policy pay?" → "The doctor said it was the shin bone." → "Sorry, I got that wrong - the X-ray shows it was his thigh bone." |
| RCT2b | tan | the same, attempt 2 |
| RCW4a | wong | "Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment." |
| RCW4b | wong | the same, attempt 2 |
| RCX | wong | "Adrian fractured his wrist falling off his bicycle. What can we claim for it from his accident cover, and who should I contact?" |

The fracture wording is rc-live-1's, unchanged, so its two failures (shin bone; the paraphrased what-if) and the
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

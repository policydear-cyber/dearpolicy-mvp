# rc-live-1 — pre-registered real-model batch (written before the run)

**One planned batch**, two runs of the live harness (one per household, because the test server signs in as one
household), on the exact candidate commit recorded in each `run.json` (`testedCodeSha`). Nothing in this file, the
scenarios (`scripts/rag2-live/scenario-household.ts`, `RC_TAN` / `RC_WONG`) or the grader
(`scripts/rag2-live/reliable-chat-check.ts`) is changed after the run. All attempts are kept, including failures.

## Budget
- Batch cap: **US$0.03** (the brief's cap; the unreserved balance before the run is US$0.078753 — the US$0.15
  `trial-codespace-1` reservation is not touched and stays counted as reserved).
- `rc-live-1-tan`: run cap US$0.015. `rc-live-1-wong`: run cap US$0.015. The run-cap guard is not loosened; a refused
  call ends that run and is reported as BLOCKED, with what stays unverified.
- Model: the existing configured chat model through the existing dedicated test setup (relay + Composio-held test key).
  No new provider, credential or ledger reset. Each run is appended to `docs/rag-migration/live/LEDGER.json`.
- No rerun until green: if a scenario fails, it is reported as failed.

## Scenarios (fresh wording — not the scripted tests' sentences)
| id | household | turns | what it checks |
|---|---|---|---|
| RCT1a | Tan (`RAG2_LIVE_HOUSEHOLD=tan`) | 3 | The complete conversation: "My son Jun fractured his leg at football training. What could his personal accident policy pay?" → "The doctor said it was the shin bone." → "Sorry, I got that wrong - the X-ray shows it was his thigh bone." |
| RCT1b | Tan | 3 | The same conversation again (repeat of the key tool-mediated scenario). |
| RCW1a | Wong (`RAG2_LIVE_HOUSEHOLD=pr50`) | 1 | Fixed-limit fracture, fresh wording (recorded failures 1–2). |
| RCW1b | Wong | 1 | The same again (repeat). |
| RCW2 | Wong | 1 | Death after a road accident abroad: benefits that may apply and what to do first (recorded failure 3). |
| RCW3 | Wong | 1 | "Which of my uploaded policies should I claim under for Adrian's broken wrist from a cycling accident?" (recorded failure 4). |

## Expected (graded by `reliable-chat-check.ts`; C correct · K terms · S source-bound · U useful)
- **RCT1** turn 1: the Fracture Benefit for Jun with its leg rows (thigh 20 %, below the knee 10 %) as a percentage of
  **Jun's own sum insured S$100,000**; exactly **one** question — which leg bone; no amount yet; nothing superseded
  (15 %) or from the other household (S$300,000). Turn 2: the conditional illustration **S$10,000** from a saved
  calculation that recomputes, 10 % bound to the wording and S$100,000 to the schedule; no further question.
  Turn 3: **S$20,000**, recomputing; the earlier estimate withdrawn (said, or recorded as withdrawn).
- **RCW1**: **S$2,500** = 50 % × the **S$5,000 Simple Fracture Benefit Limit**, from a saved calculation that recomputes
  with both operands bound to the Summary of Benefits; never a product of S$1,000,000 / S$600,000.
- **RCW2**: the pr50a-live-2 requirements unchanged (dated S$1,000,000 / S$600,000 bound to Adrian's certificate;
  contact advice for his own insurer / scheme administrator; event-date uncertainty as uncertainty, no exclusion; no
  travel insurer; no borrowed 365-day condition; no invented mandatory paperwork; no unrelated figure) plus the
  Accidental Death benefit (100 % of the Sum Insured) explained.
- **RCW3**: no household inventory; Adrian's accident cover and the fracture terms that decide it (or the one question
  that separates Simple / Other Fracture); any amount from a recomputing record; no travel-insurer recommendation.
- Every turn: no orphaned fragment, no promise of payment, nothing rejected by the save-time gate.

## Timing (measured, reported, not a pass condition)
`answerSeenMs` (POST to the answer being available from the job API — the browser paints it within the poll interval)
and `modelMs` (sum of model call latencies) per turn. Targets from the brief: 10 s for a direct lookup, 20 s for an
ordinary scenario turn.

## Verdicts
PASS (every check) · FAIL · BLOCKED (the guard refused a model call: not an answer failure; what it leaves unverified is
listed) · INCOMPLETE (no saved answer). The batch result is reported per scenario and per attempt, with the complete
visible transcripts, the calculation records, timings and cost.

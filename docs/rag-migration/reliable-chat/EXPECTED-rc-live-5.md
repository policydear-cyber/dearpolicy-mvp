# rc-live-5 — pre-registered real-model batch (written before the run)

**Purpose:** a small real-model check of the actual-library repairs (server-owned clarification requirements; percentage
bases from product sections; a heading's benefit bound to its wrapped paragraph; bare-$ amounts kept with their currency
unknown; complete quoted clauses; fewer model steps). The candidate is frozen and its SHA recorded in the result before
any spend.

**Household:** the anonymised booklet household (`scripts/fixtures/reliable-chat/booklet.ts`, `RAG2_LIVE_HOUSEHOLD=booklet`):
a generic "Group Insurance Benefits Booklet" holding Group Term Life and Group Personal Accident, a certificate with
identical amounts for two people, a superseded 2022 certificate, and another household's certificate. Synthetic data
only. Model: the configured `openai:gpt-6-luna`, through the existing loopback relay and the dedicated test credential
path (no new credential, no production credential).

**Budget:** the ledger's unreserved balance, **US$0.010790** after rc-live-4 (reconciled from
`docs/rag-migration/live/LEDGER.json`; exercise ceiling US$0.50). The US$0.15 `trial-codespace-1` reservation stays
untouched. One run, `rc-live-5-booklet`, cap **US$0.0107**. The run-cap guard reserves each call's worst case before
sending it; a call it refuses makes that conversation BLOCKED (a budget limit, not an answer). Every scenario is named
with `--scenarios` and checked with `--dry-run` before any spend; an unknown id must be refused. All attempts are kept;
no rerun to obtain a pass.

## Scenarios (fresh wording, not the scripted tests')
| id | turns (verbatim) |
|---|---|
| BKL1a | "Daniel slipped in the bathroom and broke a bone. The doctor thinks it is his hip but it could be his tibia; they are still checking. It is a closed fracture. What could his accident cover pay?" → "Update: the X-ray confirms it is his hip." |
| BKL2 | "Daniel's hip fracture was an open (compound) fracture. What does the Other Fracture benefit work out to for him?" |
| BKL3 | "If Daniel died in an accident, is there an allowance for funeral expenses in our booklet, and what does it need?" |
| BKL1b | BKL1a again (second attempt; run last, only as far as the budget allows) |

## Expected (grader `scripts/rag2-live/reliable-chat-check.ts` **v3**, unchanged after the run)
- **BKL1** turn 1: exactly one question, about which bone / case (hip vs tibia / leg); the Simple Fracture terms (Hip 75%,
  the leg row 50%, of the S$5,000 limit); no amount, no calculation; never the generic model-use-limit text. Turn 2:
  S$3,750 (Hip 75% × S$5,000) from a saved calculation that recomputes, bound to the booklet; no further question; the
  case question cleared.
- **BKL2**: S$225,000 = 75% × Daniel's Group Personal Accident sum insured S$300,000, from a recomputing calculation with
  the S$300,000 bound to the certificate; never S$375,000 (Term Life), S$150,000 / S$200,000 (superseded); no
  "not established" beside the amount; no question.
- **BKL3**: the Compassionate Death Allowance Benefit named with funeral expenses, its accidental-death condition and
  proof of death; its amount never shown as S$2,000 (the booklet prints a bare $); nothing from Repatriation; no
  "couldn't confirm"; no cut quotation.
- Every turn: no orphaned fragment, no promise of payment, nothing rejected by the gate, contact advice naming only
  Aldermoor Life Ltd.

Timing (reported, not a pass condition): send → visible, model time and steps per turn; targets 10 s (direct lookup)
and 20 s (scenario). A conversation is reported as successful only if it is correct and useful throughout; my review of
each complete transcript is reported beside the grader's verdict. This sample cannot establish a reliability rate.

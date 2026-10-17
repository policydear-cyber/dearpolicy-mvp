# rc-live-6 pre-registration (written before any model call)

Status: **registered, not started.** The run needs budget authorisation (see "Budget").

## Frozen code

- Product code: `b1db393` (applicability, household/insurer split, enrolment caveat).
- Head before this commit: `94a94b9` — adds only `docs/rag-migration/reliable-chat/APPLICABILITY-RESULT.md` (compare `b1db393...94a94b9`: ahead by 1, one added doc).
- This commit changes only the live harness and graders:
  `scripts/rag2-live/scenario-household.ts`, `scripts/rag2-live/reliable-chat-check.ts`,
  `scripts/reliable-chat-applicability.ts` (offline replays also graded with the new graders), and this file.
- The live run records `RAG2_LIVE_TESTED_SHA=b1db393` and the tree manifest of this commit.

## Run

- Run id `rc-live-6-booklet`, `RAG2_LIVE_HOUSEHOLD=booklet`, Node 22.
- Order: FL1a, FL2, FL3, FL1b. One attempt each. **No rerun to obtain a pass.**
  A failed scenario is reported as failed; a run aborted by the guard is reported as aborted with what it spent.
- Current cost admission and meter limits unchanged (per call worst case = input chars/2.5 × US$0.10/M + 2,000 output × US$0.50/M; per turn 12 calls, 80k tokens, US$0.05).
- Every previous live result (rc-live-1 … rc-live-5) stays as recorded.

## Scenarios (verbatim turns)

**FL1a — uncertain hip/tibia, clarified to hip** (same wording as BKL1a)

**FL1b — fresh paraphrase of FL1**
1. "My husband Daniel tripped on the stairs at our flat last night. The hospital says it is a closed break - either his hip or his shin bone, the tibia; the scans are not back yet. What would his personal accident cover give him?"
2. "The specialist has just told us it is definitely the hip."

**FL2 — correction from closed to open**
1. "Daniel came off his bicycle and broke his hip. It was a closed fracture. What could his accident cover pay?"
2. "Sorry, I got that wrong - it was an open fracture; the bone came through the skin."

**FL3 — death allowance**
1. "If Daniel were killed in a road accident, would our booklet help with his funeral costs, and what would we need to send in?"

## Expected behaviour and grader v4 checks

Checks read the complete visible answer of every turn, the saved calculations on the claim, withdrawals and pending state — not only the figures.

FL1a / FL1b
- Turn 1: exactly one household question, hip vs tibia/shin/leg, no insurer-assessment wording (F1Q); no id-like options (F1O); no amount and no saved calculation (F1C); Simple Fracture terms 75% / 50% / S$5,000 stated (F1K).
- Turn 2: conditional S$3,750; never S$225,000 or S$150,000; no Other Fracture illustration (F2C); exactly one saved calculation, recomputing to 375,000 cents, bound to the booklet (F2S); no question (F2U); nothing pending after completion (F2P); no cut quotation (FQ1/FQ2).

FL2
- Turn 1: Simple Fracture conditional illustration allowed, nothing pending that needs the user (C1C/C1U).
- Turn 2: the Simple Fracture illustration withdrawn on the page and marked withdrawn on the claim (C2W); Other Fracture S$225,000 (C2C); exactly one live calculation, recomputing 22,500,000 cents from S$300,000 bound to the certificate (C2S); no question, nothing pending (C2U). Only what the policy's definitions support is evaluated.

FL3
- Compassionate Death Allowance, funeral, accident, proof named (A1K).
- Never "S$2,000"; any 2,000 carries the currency-unknown wording; no 5,000; no calculation (A1C).
- No "do not confirm … enrol" for Daniel; any listing statement is dated 01/04/2024 from the certificate (A1E).
- No "is / remains / currently covered / insured / enrolled"; a listing carries the later-date limit (A1L); usefulness (A1U).

Universal checks from v3 continue to apply. Grader controls: all v1–v4 controls pass offline; offline replay suite 36/36.

## Trial reservation evidence (17 Oct)

- Ledger `trial-codespace-1`: open, reserved_unsettled US$0.15, spent 0.
- Codespaces: none at repo or user level. The `dearpolicy-trial-check` Codespace from TRIAL.md no longer exists.
- Codespaces secrets: none at repo or user level, so no instance can hold the test key.
- trial-startup workflow runs 1–4 (10 Oct): preflight only, no secret.
- Provider-side spend cannot be confirmed (usage endpoint 403, missing `api.usage.read`).
- Conclusion: no instance can use the allocation. Per the ledger note, a new Codespace would need `trial-codespace-2`. The reservation is **not** released by this commit.

## Budget

Worst-case admission measured on the planned calls through the real route:

| Scenario | Calls | Σ worst case (US$) |
|---|---|---|
| FL1a | 5 | 0.013966 |
| FL1b | 5 | 0.013989 |
| FL2 | 5 | 0.013741 |
| FL3 | 3 | 0.008194 |
| **Total** | **18** | **0.049890** |

Max single call US$0.003127. Expected actual about US$0.008 (rc-live-5 averaged about US$0.00044 per call).

- Unreserved exercise budget now: US$0.003738 — **insufficient; do not start.**
- Minimum cap (every planned call admitted at full worst case): **US$0.050**.
- Recommended (one unplanned call per turn, 7 × 0.0032): **US$0.075**.
- Strict bound from the meter's per-turn ceilings: about US$0.143.

Start rule: the batch starts only if authorised unreserved budget ≥ the chosen cap and the guard admits each call; otherwise the result is "live check pending".

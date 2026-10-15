# rc-live-1 — real-model batch result (candidate a15d085)

**Tested code:** `a15d085c320c2076f4bb4c3f22ae1204ec9d1a8e` (provenance checked against GitHub's tree of that commit:
902 source files, production build newer than every source file). **Model:** `openai:gpt-6-luna` (the existing
configured chat model), through the existing loopback relay and the Composio-held test key. Prompt version
`rag2-loop-v15-benefits`. Pre-registration: [EXPECTED-rc-live-1.md](EXPECTED-rc-live-1.md); grader
`scripts/rag2-live/reliable-chat-check.ts` (written and calibrated before the run, unchanged after).
Full visible transcripts, per-check details and timings: [live/rc-live-1-grade.md](live/rc-live-1-grade.md); raw runs:
`live/RUN-rc-live-1-tan-…/` and `live/RUN-rc-live-1-wong-…/` (run.json, conv-*.json, relay.jsonl, server.log).

## Budget
| | US$ |
|---|---|
| Batch cap (brief) | 0.030000 |
| Unreserved balance before the batch | 0.078753 |
| rc-live-1-tan (35 calls, 0 refused, 0 failed) | 0.011001 |
| rc-live-1-wong (35 calls, 0 refused, 0 failed) | 0.010863 |
| **Batch total** | **0.021864** |
| Unreserved balance after (ledger) | 0.056889 |

The US$0.15 `trial-codespace-1` reservation was not touched (still open, still counted as reserved). No credential was
created and no ledger was reset; both runs are appended to `docs/rag-migration/live/LEDGER.json`.

**Deviation from the plan:** the Wong run was started without its `--scenarios` filter, so it also ran the three earlier
PR #50 prompts (P50C, P50D, P50A; US$0.004777 of the US$0.010863). They are reported below as unplanned extras, graded
by their own earlier pre-registered grader, and not counted in the matrix. The batch still stayed inside its cap.

## Result per scenario (grader verdict, then my review of the complete visible answer)
| scenario | grader | send→answer per turn (model time) | review |
|---|---|---|---|
| RCT1a (Tan, 3 turns) | **FAIL** | 19.7 s (18.8) · 17.1 s (15.9) · 15.0 s (13.6) | Turn 1 good (terms + the one bone question). **Turn 2 failed:** "the shin bone" matched no row of "Leg - below the knee (tibia or fibula)", so the bone was asked again. Turn 3: correct S$20,000, but it ended with a question about whether the insurer had reviewed the diagnosis — not something the household can answer. |
| RCT1b (Tan, 3 turns) | PASS | 19.9 s (18.7) · 17.0 s (15.8) · 22.9 s (22.1) | Correct and useful in turns 1–2 (S$10,000 = 10 % × S$100,000, conditional, withdrawn on correction). Turn 3: correct S$20,000 with the withdrawal said, but the same unanswerable insurer-review question at the end (the grader did not check for an extra question). |
| RCW1a (Wong) | PASS | 13.7 s (12.6) | Correct and useful: S$2,500 = 50 % × the S$5,000 Simple Fracture Benefit Limit, conditional, recomputing record. |
| RCW1b (Wong) | **FAIL** | 17.8 s (16.6) | The server evaluated correctly, but the model's paraphrase "closed fracture of his leg" became the illustration's stated assumption; the save-time gate refused it as not the household's own what-if, and the answer fell back to "I couldn't confirm the figures". |
| RCW2 (Wong, death) | PASS | 22.7 s (21.5) | Dated amounts bound to Adrian's certificate, Accidental Death 100 %, uncertainty stated as uncertainty, the Kestrel contact step. Noisy: it also describes the unlinked travel wording (framed as not confirming cover). |
| RCW3 (Wong, which policy) | PASS | 12.3 s (10.9) | No inventory (recorded failure 4 does not recur). The statement that neither stored fracture table lists a wrist is **correct for the stored documents** (my pre-registered expectation wrongly assumed a wrist row; the stored page stops at the leg row). Not useful at the end: it asked the household to choose among neck / hip / leg cases for a broken wrist. |
| *P50C (extra)* | pr50-check: pass | 6.2 s | Inventory: every readable upload and the unreadable file. |
| *P50D (extra)* | pr50-check: pass | 14.2 s | S$2,500 on the fixed limit. |
| *P50A (extra)* | pr50-check: **FAIL (A2)** | 27.2 s | A server-written contact step named the travel insurer: its wording is filed under Adrian but linked to nobody, and the contact check accepted the filing owner as a link. |

**Matrix: 4 of 6 planned conversations PASS on the grader. On my review of the complete answers, only RCW1a and
RCW2 are correct and useful throughout; RCT1b and RCW3 are correct but end with an unhelpful question; RCT1a and RCW1b
failed.** Timing: no turn met the brief's targets (10 s direct
lookup, 20 s ordinary turn) consistently — direct lookups took 12–18 s, multi-step turns 15–23 s; model time is
90–95 % of send-to-answer, so the server is not the bottleneck.

## Fixed after the run (not verified with the real model — the brief allows no rerun until green)
Each fix is pinned by a scripted regression that replays the model's **exact recorded tool calls** from this run
(`scripts/reliable-chat-live-regressions.ts`, `npm run reliable-chat:live-regressions-test`, in CI):
1. **Everyday bone names** — "shin" also carries "tibia", "thigh" "femur", "collarbone" "clavicle", etc. when a
   listed case is chosen (`lib/rag2/calc/pct-rows.ts`). Replay: RCT1a's `evaluate_benefit {case: "shin bone"}` → S$10,000.
2. **An illustration's assumption is always the household's own words** — the recorded words of the facts it rests on,
   else case words that quote them, else their message (`lib/rag2/loop/loop.ts`). Replay: RCW1b → S$2,500 shown, gate clean.
3. **No question about the insurer's own review or decision** — refused at `ask_user`. Replay: RCT1a turn 3 ends with
   the S$20,000 and no question.
4. **A case the household names that no listed case names is said, not asked** — the evaluation tells the model not to
   offer non-matching cases (`lib/rag2/evaluate.ts`; model-facing guidance, not enforcement).
5. **Contact steps only for documents linked to the person** (policy membership, as the library shows it), one step per
   insurer (`lib/rag2/loop/statement-render.ts`). Replay: P50A's travel step refused; one Kestrel step.

What stays unverified with the real model: whether gpt-6-luna now completes RCT1 and RCW1 on the first attempt in both
repeats, and whether it follows fix 4. These need one further small real-model batch on the new candidate.

# rc-live-5 result: real-model check of the actual-library repairs

- **Tested code:** `523efea21f107af9de99af283ed5d0596a2b370b` (branch `claude/actual-library-repairs`). The sandbox has no git
  checkout, so provenance was checked against a manifest of that commit's tree (916 files under the checked roots matched).
  The production build was made from that tree.
- **Pre-registration:** [EXPECTED-rc-live-5.md](EXPECTED-rc-live-5.md), committed before the run. The grader is v3
  (`scripts/rag2-live/reliable-chat-check.ts`) and was not changed after the run.
- **Model:** `openai:gpt-6-luna` through the loopback relay and the existing Composio-held test credential. No new
  credential was created and no production credential was used. Settings: temperature 0, tool_choice required,
  max 2,000 output tokens per call, reasoning_effort none.
- **Run:** `rc-live-5-booklet` with cap US$0.0107. The dry run listed the four scenarios, and the unknown id `BKL9` was
  refused before any spend. There was one live run and no rerun.
- **Spend:** US$0.007052 over 16 calls (0 refused, 0 failed). Ledger remaining after the run: **US$0.003738**. The US$0.15
  `trial-codespace-1` reservation is untouched.
- **Files:**
  - transcripts: `live/RUN-rc-live-5-booklet-2026-10-16T16-56-18/` (conv-*.json, relay.jsonl, server.log, report.md);
  - grade: `live/rc-live-5-booklet-2026-10-16T16-56-18-grade.md` / `.json`, which holds every visible answer verbatim.

## Verdicts

| scenario | grader v3 | my review |
|---|---|---|
| BKL1a | **FAIL** (B2U) | **Turn 1 is correct and useful.** It gives the Simple Fracture terms (Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%; of S$5,000) and asks one case question: "Which listed fracture case is Daniel's: Hip or Jaw, Pelvis, Leg, Ankle or Knee?". There is no amount and no limit text. It also prints the Other Fracture terms, which is unnecessary noise because the household said the fracture was closed.<br><br>**Turn 2 has the correct amount but fails on usefulness.** It gives the S$3,750 illustration (75% × S$5,000, a recomputing calculation bound to the booklet). It then asks an insurer-only question about Other Fracture ("…as determined by the insurer's medical assessment?") and leaves that question pending. |
| BKL2 | PASS | **Correct and useful.** S$225,000 = 75% × Daniel's Group Personal Accident S$300,000. The base is bound to the certificate, and the answer gives no Term Life or superseded amount, no contradiction and no question. |
| BKL3 | PASS | **The benefit is kept with its terms, conditions and an honest currency.** It also contains one misleading caveat, written by the model: "The uploaded documents do not confirm Daniel's enrolment in the group scheme". In fact the certificate lists him under the scheme. It also contains a filler line, "The booklet is reference wording." I count this answer as useful but imperfect. |
| BKL1b | **FAIL** (B2U) | Same shape as BKL1a. Turn 1 asks a good question ("hip or leg (including the tibia)"); turn 2 gives the correct S$3,750, then asks an insurer-only Other Fracture question that is left pending. |

**Result: 2 of 4 conversations correct and useful throughout.** The first actual-library finding is fixed: the case
question is now asked and the clarified amount is correct, in 4/4 turns. The whole BKL1 flow still fails because of a new
failure: the model evaluated a second benefit in turn 2. This sample is far too small to estimate a reliability rate.

## Why BKL1 turn 2 failed (diagnosed from the saved calls; not fixed in this PR)

1. In turn 2 the model evaluated both Simple Fracture (giving S$3,750) and Other Fracture with case "hip". The household
   had said the fracture was closed, so Other Fracture should not apply.
2. Server-owned case clarification is scoped to the benefit whose question was asked. Other Fracture therefore still saw
   the original report ("his hip, but it could be his tibia") and returned `case_conflict`. That created a new
   requirement, and the model asked it in words that only the insurer can answer.
3. Simply carrying "it is his hip" over to Other Fracture would make things worse. Other Fracture would then produce
   S$225,000 for a fracture the household called closed, because the server has no structured open/closed
   applicability check. The safe fix is a server-side applicability test: the booklet's own definitions say Simple
   Fracture means a closed fracture and Other Fracture means one that is not a Simple Fracture. That would let it
   withhold Other Fracture and its requirement. This is the recommended next repair.
   - The prompt's rule "what only the insurer can confirm is stated, never asked" is not enforced on the server. A
     requirement whose question the household cannot answer should never be asked.

## Latency (send → visible answer; model time is the sum of the turn's model calls)

| turn | send → visible | model | application + HTTP | model steps | tool calls | input / output tokens |
|---|---|---|---|---|---|---|
| BKL1a.1 | 13.2 s | 11.8 s | 1.4 s | 3 | 7 | 28,511 / 684 |
| BKL1a.2 | 7.5 s | 6.0 s | 1.4 s | 2 | 4 | 17,714 / 462 |
| BKL2 | 10.3 s | 9.6 s | 0.7 s | 3 | 6 | 27,939 / 483 |
| BKL3 | 9.2 s | 8.7 s | 0.5 s | 3 | 6 | 26,514 / 490 |
| BKL1b.1 | 11.3 s | 10.0 s | 1.3 s | 3 | 7 | 28,709 / 767 |
| BKL1b.2 | 6.9 s | 6.4 s | 0.4 s | 2 | 4 | 17,676 / 399 |

- **Turn times:** every turn finished in 6.9–13.2 s, against 12–38 s before. No call was refused or repaired.
- **Where the time goes:** model time is 85–95% of each turn, at roughly 3–4 s per model step.
- **Against the targets:** the 20 s scenario target was met. Of the two direct lookups, BKL3 (9.2 s) met the 10 s
  target and BKL2 (10.3 s) missed it by 0.3 s.

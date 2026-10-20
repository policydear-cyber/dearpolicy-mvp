# PR #57 follow-up: Test engineer check of C6, compared with C5 and C0

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | affected checks, then every suite and browser spec to confirm nothing else moved | C6 `f4937ef160a06420bf5e526df8d3ab979dc9f11b` | done | `c6/` | none from these runs |

The run used a clean worktree of exactly `f4937ef` (`c6/head.txt`). It holds the test files and the published expectation changes, so nothing was overlaid.
Node 22.22.0, one suite at a time, nothing edited (`git status` clean after). C6 changes product code in `absence-scope.ts` and `statement-render.ts` only.
**Evidence category:** scripted (ScriptedLoopModel; PGlite, or local PostgreSQL plus Chromium; network refused), plus a recorded replay of fx-live-2 in acceptance group R.
No model call, no spend, no ledger change. Nothing here is real-model evidence or evidence about DC's actual library.

## The three C5 findings

| check | C5 | C6 |
| --- | --- | --- |
| fx-repairs A12, partly stored copy: says what was read and that the rest "could not be checked" | FAIL | PASS |
| T1 (Critic R8-1): the annual Tan PA schedule is not called a trip | FAIL | PASS |
| F1 turn 2: the hip correction's Other Fracture figure says the documents do not define it | FAIL | PASS |
| browser FX-K6B dental (partial answer, no absence) | FAIL | PASS |

## Nothing else moved

- **Suites:** 57 of 58 exit 0. The one red is `v11:customer-screens-test`, the same failure as on main (C0). Against C5, only three suites changed, all now green:
  - fx-repairs: A12, finding 1.
  - s52-replay and fracture-replay: the expectation changes published after C5.
  - Every other suite has the same exit code and the same PASS/FAIL counts as C5.
- **Acceptance:** AC 34/40, GUARD 49/49. The six AC failures are the same open items as on C3 and C5: R1-R3 (replay limit), R7 and R9 (accepted wording gaps), N5b (in-place re-analysis, C1-3). The GP group passes in full.
- **C4 household checks:** AC 4/4, GUARD 5/5 (death abroad, annual schedule, closed fracture on both turns).
- **Browser specs:** 28 of 28, the same as main. tan 3/3, booklet 6/6, actuallib 8/8, fracture with fx-repairs 6/6, deathjourney 3/3, dj-live-3 2/2.
- Typecheck is clean. `rag2:live-ledger-test` gives 9/10, with the same L10 (fx-live-2 has no `run.json`) as on C0.

## Compared with main (C0)

- **Suites:** every suite green on C0 is green on C6. `security:env-contract-test` was red on C0 and is green on C6. `rag2:s52-replay` was red on C0 and is green on C6, with the published expectation change.
- **Acceptance:** 34 of 40 AC pass on C6; none passed on C0. Every guard passes on both.
- **Browser specs:** identical, 28 of 28 on both.
- No check found a wrong claimable amount.
- **Still open:** customer-screens (red on main too), R1-R3, R7, R9, N5b. No live run was made. The Claude model switch (PR #59) is not covered by this evidence.

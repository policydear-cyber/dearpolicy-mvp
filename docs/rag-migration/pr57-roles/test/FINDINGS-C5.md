# PR #57 follow-up: Test engineer release run on C5, compared with C0 (and C2, C3)

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | release run, name by name against C0 | C5 `177c073427bab0acb231a34018208a8d0448100f` | done | `c5/`, `browser/`, `new-checks/` | three C5 findings below |

C5 ran on a clean worktree of exactly `177c073` (`c5/head.txt`), with Node 22.22.0, the same `node_modules` as C0, one suite at a time, and nothing edited.
Checks written after the freeze (the C4 checks, the published expectation changes) ran on a disposable copy: the SHA plus the test files only.
**Evidence category:** scripted (ScriptedLoopModel; PGlite, or local PostgreSQL plus Chromium for the browser specs; network refused), and recorded replay of fx-live-2
in acceptance group R. There was no model call, no spend and no ledger change. Nothing here is real-model evidence or evidence about DC's actual library.

## Suites (58 runs)

| | C0 | C3 | C5 as frozen | C5 + published expectation changes |
| --- | --- | --- | --- | --- |
| green | 55 | 56 | 54 | 56 |
| red | customer-screens, s52, env-contract | customer-screens, s52 | customer-screens, s52, fx-repairs (A12), fracture-replay (A6) | customer-screens, fx-repairs (A12) |

- No suite that is green on C0 is red on C5 for a product reason, except fx-repairs A12 (finding 1).
- `v11:customer-screens-test`: the same failure as on main (C0), open since before PR #57.
- `rag2:s52-replay`: a stale expectation, the same on C0, C2, C3 and C5. It is now 12/12 with the published change (`EXPECTATION-CHANGES.md`): the policy wording prints a bare "$2,000", and the code no longer calls it S$2,000.
- `reliable-chat-fracture-replay` A6: a genuine expectation change. C4 reworded the missing-definition clause on purpose. It is 32/32 with the published change.
- Typecheck is clean. `rag2:live-ledger-test`: 9/10, the same L10 (fx-live-2 has no `run.json`) as C0.

## Acceptance checks and guards

| | C0 | C3 | C5 |
| --- | --- | --- | --- |
| script as committed in the tree | AC 0/14, GUARD 25/25 | AC 20/26, GUARD 41/41 | AC 31/37, GUARD 47/47 |
| with the C4 checks (`c5/acceptance-with-c4-checks.txt`) | | AC 33/42 | AC 36/42, GUARD 47/47 |

The six AC still failing on C5 are the known open items: R1-R3 (replay limit), R7 and R9 (accepted wording gaps), and N5b (in-place re-analysis, C1-3).
The GP group passes in full on C5, including Critic round 5, the UX checks and C4 items 1 and 2.

## C4 checks (C4 items 1 to 6, plus Critic R8-1)

| check | C3 | C5 |
| --- | --- | --- |
| 1 GP.R6-1a/b: app-order member name, G1 answers and names only his rows | FAIL | PASS |
| 2 GP.A3.4: label-style medical-expense benefit, no absence stated | FAIL | PASS |
| 3 D1: travel S$100,000 never without its person, period and destination (livelib) | FAIL | PASS |
| 4 F1: closed fracture, every Other Fracture figure says the documents do not define it (actuallib SA2) | turn 1 PASS, turn 2 FAIL | turn 1 PASS, **turn 2 FAIL** |
| 5 GP.F4: a bare "$" line is never restated as S$ | PASS | PASS (kept as GUARD) |
| 6 N8: the S$120,000 carries the Core-or-Voluntary condition | PASS | PASS (kept as GUARD) |
| R8-1 T1: the annual Tan PA schedule is not called a trip | PASS | **FAIL** |

## Browser specs (reliable-chat, six configs; `browser/`)

| spec | C0 | C2 | C3 | C5 |
| --- | --- | --- | --- | --- |
| reliable-chat (tan) | 3/3 | 3/3 | 3/3 | 3/3 |
| booklet | 6/6 | 6/6 | 6/6 | 6/6 |
| actuallib | 8/8 | 8/8 | 8/8 | 8/8 |
| fracture + fx-repairs | 6/6 | 3/6 | 3/6 | 3/6 (4/6 with page counts seeded) |
| deathjourney | 3/3 | 3/3 | 3/3 | 3/3 |
| dj-live-3 | 2/2 | 2/2 | 2/2 | 2/2 |

- The first actuallib pass used the wrong seed (`booklet`). Each `browser/*.tsv` also holds the corrected actuallib row.
- **fracture: FX-K6B, FX-K6A and FX-K2 fail on C2, C3 and C5, and pass on C0.** Two causes:
  - The browser seed wrote no `page_count`, so every document read as partial. This is a test gap, fixed in `e2e/support/seed-rag2-stress-report.ts`. With it, FX-K6A passes on C5.
  - FX-K2 still expects "no bare 250". Policy QC ruling 1 changed that in the scripted suite (fx-repairs C3), but the ruling was not carried into the browser spec.
  - FX-K6B still expects the absence over the partly stored copy. Under read-in-full (M5) the right answer is the partial one, but C5's partial wording is finding 1, so I have not changed this expectation.
- **Tan (R8-1):** no Tan suite or browser spec shows the new trip sentence. All of them are green on C5 and none prints the PA schedule's terms. A scripted Tan answer that does print them gets "whether that trip fits this event is for the insurer to confirm" beside an annual schedule (T1 fails on C5, passes on C3).

## C5 findings (product)

1. **Partial-copy reason is wrong (fx-repairs A12, not an expectation change).** C5 says "the other pages are not in the copy that was uploaded" whenever `page_count` exceeds the stored pages. In production `page_count` is the number of pages extracted from the uploaded PDF, so missing stored pages are a storage gap, not a shorter upload. "37 of 37" contradicts the claim. C2/C3's "not stored and could not be checked" was accurate.
2. **Annual schedules are called a trip (Critic R8-1).** The trip-limits sentence fires on any page printing "Period of Insurance", including an annual PA schedule (Tan, 01/03/2026 to 28/02/2027).
3. **Closed fracture after the correction (C4 item 4).** On actuallib SA2, after "it was his hip", the S$450,000 Other Fracture illustration has no "not defined" clause. Turn 1 has it.

C0 to C5: no check found a wrong claimable amount. The amounts on every scripted journey match the pages.

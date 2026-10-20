# PR #57 follow-up: Test engineer results on C1, as frozen

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | assess C1 exactly, compare with C0 name by name | C1 `8c63250cec7acb4e21fb41655a057f7ffc8ee65b` | done; fixture page counts follow as C1.1 (test-only) | `c1/suites.tsv`, `c1/acceptance.txt`, `c1/live-ledger-test.txt`, `c1/tools-test-F4.txt` | C1 product regressions below go to the Developer |

Run on a clean worktree of exactly `8c63250` (`git rev-parse HEAD`), same Node 22.22.0 and `node_modules` as C0, one suite at a time.
Evidence category: scripted, and recorded replay (group R). No model call, no spend, no ledger change.

## Suites, C1 against C0 (58 runs each)

C0: 55 exit 0, 3 red. C1: 52 exit 0, 6 red. Typecheck clean on both.

| suite | C0 | C1 | cause on C1 |
| --- | --- | --- | --- |
| `security:env-contract-test` | red (34 names) | **green** | the 34 names documented in `.env.example` |
| `rag2:tools-test` | 38/38 | **37/38** | F4: `lib/chat/stale-answers.ts` now imports `@/lib/rag2/store` and `@/lib/rag2/loop/absence-scope`. The suite's contract is that nothing outside `lib/rag2` imports it except the flagged hook in `lib/chat/workflow.ts`, so the existing chat path stays untouched when the loop is off. **Product regression** (Critic M4 repair) |
| `reliable-chat:structured-answers-test` | exit 0 (129 PASS lines) | **exit 1** (116 PASS, 5 FAIL lines) | J2, J3, J3b, J4, SBa turn 2: "every saved calculation is ONE complete conditional sentence ... the splitter does not divide". The new table condition ends the illustration with `under the table it prints: “This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.”.`; the quoted full stop splits the saved sentence. **Product regression** (QC Q1 repair). Not named in the Developer's C1 notes |
| `reliable-chat:absence-scope-test` | 30/30 | 21/30 (9 fail) | every fixture absence refused: the unit fixtures' documents store fewer pages than their `pageCount` (2). Fixture, see C1.1 |
| `reliable-chat:fx-repairs-test` | 86/86 | 78/86 (8 fail) | A2-A5, A9, B1: fixture absences refused (no `page_count`; the Product Summary and Benefit Summary are partial copies, so the three-document dental answer stays refused even with true counts). C2, C3 (K2): the S$250 terms now shown; expectation not changed, Policy QC is ruling |
| `v11:customer-screens-test`, `rag2:s52-replay` | red | red, same failures | unchanged |
| all other 50 | green | green, same counts | |

`rag2:live-ledger-test` (placeholder model env): 9/10 on both; L10 `unreadable: ['fx-live-2']` unchanged.

## Acceptance script on C1

`AC 7 passed, 7 failed | GUARD 22 passed, 3 failed | replay fidelity 1/7 turns identical to the live text (expected: C1 changes rendering).`

| check | C0 | C1 | reading |
| --- | --- | --- | --- |
| H1.1-H1.3 "too" with a cue | FAIL | **PASS** | repaired |
| H2.1 sick and fainted, hitting her head | FAIL | **PASS** | repaired |
| M2, M3.2, M4 absence scope | FAIL | **PASS** | repaired (M2/M3.2/M4 pass partly because every fixture absence is now refused; C1.1 re-runs them on fully stored documents) |
| R1, R2, R3 repetition | FAIL | FAIL | **evidence limit, not pass or fail**: the recorded calls cite evidence ids that the new table-condition passage shifts, so the replay cannot show the de-duplication. The two remaining "which applies" sentences are the model's recorded one and the server's frame |
| R5 K2.3, R7 K6a, R9 K6c | FAIL | FAIL | not repaired (Developer: deferred / accepted wording gaps) |
| N5b in-place hash change | FAIL | FAIL | not repaired (Developer: production never rewrites an active row's hash) |
| R8, R10, M0 (GUARD) | PASS | FAIL | the fixture has no `page_count`, so K6a/K6c/K6b and M0 absences are refused; K6a then ends in the model-error answer ("I couldn't finish: the assistant model returned an error") because the recorded calls have no repair step. C1.1 |

**New observation on C1 (K2 replay):** the sickness answer now opens "The Scheme X Group Insurance (page 9) prints the J, Accidental Hospital Recuperation Benefit, 250 (printed with a bare “$” sign ...)". "the J," is the page's section letter taken into the benefit's label. Same family as the Critic's next-heading finding.

## What C1.1 changes (test-only, separate commit)

- `FxDoc.pageCount`, written to `policies.page_count` by the rag2-loop harness.
- Fracture fixture: certificate 1 (prints "Page 1 of 1"); Product Summary 37 (stored page 37 prints "Page 36 of 36"; stored index = printed number + 1); Benefit Summary unknown. The Product Summary and Benefit Summary stay incomplete and stay refused.
- `reliable-chat-absence-scope-test.ts`: each unit document's `pageCount` equals the pages its test actually stores (no test changes which pages are stored).
- Acceptance script: M5 (no absence over the fixture's partial library), M0-M4 on fully stored documents, M2b (a page never stored), H1.6 ("Daniel broke his arm too, but it wasn't Grace's fault."), N7 (no next-benefit heading or amount inside the S$120,000 sentence), R10 reduced to "cites no passage" (whether an absence may be said is M5).
- Not changed: fx-repairs C2/C3 (QC ruling), any expectation of `structured-answers-test`, `tools-test`, or the replay's recorded calls.

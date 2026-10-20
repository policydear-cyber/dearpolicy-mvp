# PR #57 follow-up: acceptance checks (Test engineer)

Owner: Test engineer. Candidate the checks were written against: C0 = `4956588a4e2cae948809e34d78d3b728a99a96ed` (main head).
## Evidence category

Every check here is **scripted** (ScriptedLoopModel) except group R, which is **recorded replay** (fx-live-2's recorded tool calls). None is real-model evidence on a test household, and none is evidence about DC's actual library. Results are reported under those labels and never as each other.

Every check runs offline: scripted model or recorded tool calls, PGlite, network refused. No model call, no spend.

A repaired candidate (C1) is accepted by these checks when:

1. every **AC** check in `scripts/pr57-acceptance-test.ts` passes (each fails on C0, see `FINDINGS-C0.md`);
2. every **GUARD** check in it still passes (controls so a repair cannot over-correct);
3. the command-level checks below hold;
4. no suite that is green on C0 turns red (name-by-name comparison of `run-suites.sh` output on C0 and C1).

## The script

```
node --import tsx scripts/pr57-acceptance-test.ts            # all groups; exit 1 if any AC or GUARD fails
node --import tsx scripts/pr57-acceptance-test.ts --only=R    # one group; --show prints every answer
```

| group | source of the ask | AC (must flip FAIL to PASS) | GUARD (must stay PASS) |
| --- | --- | --- | --- |
| R | handoff open item 3 (usefulness gaps) | R1, R2 repetition of "which applies" (K3t1, K4b); R3 "different bases" said twice; R5 v1 K2.3 other listed cover; R7 K6a limitation in the amount's own sentence; R9 K6c "the policy definition" | R4 both alternatives, never a total; R6 no S$250 for sickness; R8 S$350,000 dated, never "will pay"; R10 dental cites no passage; R11 returned = saved = reopened |
| H1 | Critic H1 | H1.1 to H1.3: "Daniel broke his arm too." plus "It was not serious." / "I mean, ..." / "rather than" moves nothing from Grace | H1.4 plain "too" moves nothing; H1.5 a real correction is still made once |
| H2 | Critic H2 | H2.1 "felt sick and fainted, hitting her head": no "not met", the S$250 terms stay with the printed accident condition | H2.2 plain accident unchanged; H2.3 returned = saved = reopened |
| M1 | Critic M1 | M1.1 "broke her toe" mapped to the Leg^ row gets no S$2,500 beside "toe and foot are not covered" | M1.2 "broke her ankle" on that row still S$2,500 |
| M2 | Critic M2 | an empty stored page in a scoped document refuses the absence | M0 setup |
| M3 | Critic M3 | product name "Scheme X Dental Plan" does not stop "dental" being searched | M3.1 same page without the rename refuses |
| M4 | Critic M4 | a new document for Grace printing a dental benefit withdraws the saved absence on reopen | |
| N | project instructions (20 Oct) | (none) | N1 percentage base not swapped; N2 date, footnote and contact step survive verification and reopen; N3 wrong person; N4 wrong product (contact step for a document outside the library); N5 version (deleted or new file hash withdraws); N6 restored version whole. A correction followed by a new scenario is `reliable-chat:fx-repairs-test` G6/G6b |
| Q3 | Policy QC Q3 | (none: passes on C0, see findings) | Q3.1 to Q3.4 correction with Daniel at S$400,000 gives S$80,000, nothing carried |

**Limit of group R.** It replays fx-live-2's recorded model tool calls (`responses.jsonl`) through the tree under test. It shows what the code does with the model's recorded statements. If C1 repairs a gap through the prompt or a tool description, group R cannot show it: that needs a live run, which needs DC's authorisation and ledger room. If C1 changes a tool contract so the recorded calls no longer replay, the R checks fail for that reason; the INFO lines (R0) and `--show` say which.

## Command-level checks (red on C0)

| check | C0 result | accepted when |
| --- | --- | --- |
| `npm run security:env-contract-test` | exit 1: 34 names read by source, not in `.env.example` | exit 0, by documenting names in `.env.example` (not by deleting reads that real code needs) |
| `npm run v11:customer-screens-test` | exit 1: 10 pass, "chat: one direct answer, collapsed sources, plain uncertainty, one next step, no internals" fails | exit 0 and the changed assertion matches the deliberate 15 Oct page change (`df8577bd`), reviewed by the Critic |
| `npm run rag2:s52-replay` | exit 1: 11/12, `S52A#0 added` 3 statements, 2 expected | exit 0 with the expectation change explained (which added statement is a deliberate split), reviewed by the Critic and Policy QC |
| `CHAT_MODEL=openai:gpt-6-luna OPENAI_API_KEY=sk-fake-not-real npm run -s rag2:live-ledger-test` | exit 1: 9/10, L10 `unreadable: ['fx-live-2']` (the run folder has no `run.json`) | 10/10 without changing any ledger figure; the spend and reservation totals stay US$0.740879 booked, US$0.259121 left |

These four are not product code. Whoever owns each change, the test or expectation edit must say why the old expectation is wrong; no assertion is loosened to get green.

# PR #57 follow-up: Test engineer findings on C0

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | reproduce on C0; acceptance checks that fail on C0 | C0 `4956588a4e2cae948809e34d78d3b728a99a96ed` | done for C0; waits for C1 | `c0/suites.tsv`, `c0/acceptance.txt`, `c0/live-ledger-test.txt` | none |

`git fetch origin main && git rev-parse origin/main` gave `4956588a4e2cae948809e34d78d3b728a99a96ed` on 2026-10-20 05:21Z, equal to C0.
Environment: Node 22.22.0, `npm ci` from the committed lock file, PGlite, network refused. No model call, no spend, no ledger change.

**Evidence category of everything here:** scripted model, or recorded replay (group R of the acceptance script replays fx-live-2's recorded tool calls). Nothing here is real-model evidence or evidence about DC's actual library.

## 1. Suite baseline on C0 (58 runs, one at a time)

Runner: `docs/rag-migration/pr57-roles/test/run-suites.sh`: 54 npm suites (the handoff's 51 plus `v11:customer-screens-test`, `rag2:s52-replay`, `security:env-contract-test`), then the fracture replay and three grader-control scripts. Per suite: `c0/suites.tsv`.

| result | suites |
| --- | --- |
| exit 0 | 55 of 58: every suite in the handoff's list, fracture replay 32/32, reviewed criteria controls 35/35, registered criteria controls 55/55, v1 usefulness controls 42/42 |
| exit 1, also red in the handoff | `v11:customer-screens-test` (10 pass; "chat: one direct answer, collapsed sources, plain uncertainty, one next step, no internals" fails); `rag2:s52-replay` (11/12; `S52A#0 added` 3 statements, 2 expected); `security:env-contract-test` (34 names) |

`rag2:tools-test` failed F4 on the first run because of this thread's own new file (`scripts/pr57-acceptance-test.ts` imports `lib/rag2` from outside the allowed paths). The file was renamed to `scripts/reliable-chat-pr57-acceptance-test.ts` and the suite reran 38/38. Not a C0 defect.

`rag2:s52-replay` writes an untracked `REPLAY-local.json` into the s52 run folder; it is not committed.

## 2. One red check not in the handoff

`rag2:live-ledger-test` (not a CI step; run with a placeholder `CHAT_MODEL=openai:gpt-6-luna` and a fake key, no call made): **9/10**. L10 "reconcile on the repository" reports `unreadable: ['fx-live-2']`, because `docs/rag-migration/live/RUN-fx-live-2-2026-10-20T02-39-03/` has no `run.json`. The handoff's CI findings described L10 failing on `dj-live-3`; on C0 that entry reconciles and fx-live-2 is the cause. The ledger figures themselves are consistent: run spend US$0.590879 plus the US$0.15 `trial-codespace-1` reservation is US$0.740879 booked, US$0.259121 left.

Also in `LEDGER.json`: the `dj-live-3` note reads "The open US/home/user/append.sh.15 trial-codespace-1 reservation" (a shell expansion of `$0` when the entry was appended in `3bb34f6`). Audit text only; no figure is affected.

## 3. Acceptance checks on C0

`node --import tsx scripts/reliable-chat-pr57-acceptance-test.ts`: **AC 0 passed, 14 failed; GUARD 25 passed, 0 failed; replay fidelity 7/7 turns identical.** Full output: `c0/acceptance.txt`.

**Replay fidelity.** Replaying fx-live-2's 23 recorded tool calls through C0 gives exactly the live run's visible text on all seven turns (`answers.json`). So the gaps below are reproduced on C0 itself, not only on the live-tested `c4edd48`.

| check | what fails on C0 | source |
| --- | --- | --- |
| R1 | K3t1: four sentences say the documents leave open which applies (two the model's, two the server's) | handoff 3 |
| R2 | K4b correction turn: three such sentences | handoff 3 |
| R3 | K3t1: "different bases" said by the model and again in the server's bases sentence | handoff 3 |
| R5 | K2 sickness answer does not mention the listed, undescribed Living Care cover (v1 K2.3) | handoff 3, QC Q2 |
| R7 | K6a: the S$350,000 sentence has no cancer limitation; it is two sentences earlier | handoff 3 |
| R9 | K6c: "whether Grace's cancer meets the policy definition"; no definition was shown | handoff 3, QC Q4 |
| H1.1 to H1.3 | "Daniel broke his arm too." plus "It was not serious." / "I mean, he fell off his bike." / "he slipped rather than fell." is treated as a correction: "Updated: this is about Daniel, not Grace.", Grace's facts are emptied and her two illustrations withdrawn | Critic H1, **reproduced** |
| H2.1 | "felt sick and fainted, hitting her head": "is an illness, not an accident, so ... this benefit's condition is not met and no amount is given for it" | Critic H2, **reproduced** |
| M2 | with Benefit Summary page 1 empty, "do not describe a benefit for dental" is still said | Critic M2, **reproduced** |
| M3.2 | with product name "Scheme X Dental Plan", a page printing a Dental Benefit no longer stops the absence (terms `["dentist"]`); without the rename it does (M3.1) | Critic M3, **reproduced** |
| M4 | after a new document for Grace printing a dental benefit is added, the reopened answer still says her documents do not describe one | Critic M4, **reproduced** |
| N5b | after the Benefit Summary's stored file hash changes in place, the reopened fracture answer still shows its S$120,000; only absence answers compare file hashes (`lib/chat/stale-answers.ts`). Deletion does withdraw it (N5a). Whether a production re-upload changes a hash in place, rather than creating a new row and superseding the old one, is not verified here | new (negative control for version) |

**Not reproduced.** Critic M1 (toe mapped to the Leg^ row gets S$2,500 beside its toe/foot footnote): on C0 `evaluate_benefit` reads the reported "toe" and returns `unlisted_case` with the listed cases, even when the model names the Leg row. M1.1 is kept as a GUARD.

**Passes on C0 (QC Q3).** With Daniel's Personal Accident sum changed to S$400,000 in the test copy, the correction gives 20% of S$400,000 = S$80,000, carries nothing of Grace's S$600,000 / S$120,000, and withdraws Grace's illustrations (Q3.1 to Q3.4). Daniel's figures are recalculated, not copied. Kept as GUARDs.

## 4. Limits

- Group R replays recorded calls. A repair made through the prompt or a tool description cannot show there; it needs a live run (DC's authorisation, through the coordinator, against the ledger).
- One synthetic household. Nothing here is about DC's actual library.
- N5b and M4 simulate a new version and a new upload with direct database writes in the test copy, not through the upload pipeline.

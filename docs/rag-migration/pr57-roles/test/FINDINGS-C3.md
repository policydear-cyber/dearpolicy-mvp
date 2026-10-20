# PR #57 follow-up: Test engineer final assessment of C3, compared with C0 and C2

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | final assessment, name by name against C0 and C2 | C3 `17668630fab90a94997f3c918d8a5b31139ec40e` (C2 `98ada990d0a792f7a7b8c2e1931704a07409d33d`, C0 `4956588a4e2cae948809e34d78d3b728a99a96ed`) | scripted part done; browser specs next | `c3/`, `c2/`, `new-checks/` | none for the run |

Each candidate ran on a clean worktree of exactly its SHA (`git rev-parse HEAD`), Node 22.22.0, the same `node_modules`, one suite at a time, nothing edited.
New checks written after a freeze ran on disposable copies (the SHA plus the test files only). No model call, no spend, no ledger change.

**Evidence category:** scripted (ScriptedLoopModel, PGlite, network refused) and, for acceptance group R, recorded replay of fx-live-2. Nothing here is real-model
evidence on a test household or evidence about DC's actual library.

## Suites (58 runs each)

| | C0 | C2 | C3 |
| --- | --- | --- | --- |
| exit 0 | 55 | 56 | 56 |
| red | customer-screens, s52-replay, env-contract | customer-screens, s52-replay | customer-screens, s52-replay (same failures as C0) |

- `security:env-contract-test`: red on C0, green on C2 and C3.
- Counts that changed are added tests, all passing: absence-scope 30 to 32, fx-repairs 86 to 89, structured-answers 129 to 131 (C2 and C3 identical).
- No suite green on C0 is red on C2 or C3. C2 and C3 suite results are identical name by name.
- Typecheck clean on C2 and C3. `rag2:live-ledger-test` (placeholder model env): 9/10 on C0, C2 and C3, the same L10 (`fx-live-2` has no `run.json`).

**s52 replay.** The failure is identical on main (C0), C2 and C3: `S52A#0 added` 3 statements where the test expects 2. The extra statement is
"The policy wording says reasonable costs of returning the remains to Singapore are reimbursed up to 2,000 (printed with a “$” sign; the document does not say which currency)."
The livelib policy wording prints "up to $2,000" (bare `$`, `scripts/fixtures/rag2-livelib/household.ts:105`), and the live s52 answer had said "S$2,000" for it.
So the current code is right to split it off with the currency unresolved, and the test's expected count is stale. It is a test expectation, not a product
failure. It is not changed in C3; the correction (expected added count 3, with this pattern) is published separately with its reason.

## Acceptance script (as committed in each tree)

C2 and C3: **AC 20 passed, 6 failed; GUARD 41 passed, 0 failed**, the same checks. C0: AC 0/14 (on its own C0 script), GUARD 25/25.
Still failing on C3: R1, R2, R3 (replay limit: the recorded calls cannot show de-duplication), R7 and R9 (accepted wording gaps), N5b (in-place hash change; production
re-analysis rewrites pages in place, C1-3, listed open).

## New checks (Critic round 5, UX browser regressions), run on C0, C2, C3

`node --import tsx scripts/reliable-chat-pr57-acceptance-test.ts --only=H1,UX,GP` on each SHA plus the test files.

| | C0 | C2 | C3 |
| --- | --- | --- | --- |
| AC | 8 / 22 | 14 / 22 | **22 / 22** |
| GUARD | 23 / 23 | 22 / 23 (UX3) | **23 / 23** |

- Fail on C2, pass on C3: H1.7/H1.8 (A1 "...not Grace. He also hurt his knee." still a correction), GP.A2.1 (Grace-only row not named for Daniel), GP.A3.3
  ("reimburse ... charges"), GP.F1 (scheme policy-list line never quoted), UX1 (no question on FX-K4B turn 1), UX2 (dental: what was read, not a bare
  "couldn't confirm"), UX3 (the correction says the earlier estimates no longer apply), UX4 (no X-ray or certification question unless raised).
- GP.A2.2 (Grace's own certificate) and GP.F2 pass on C0, C2 and C3; kept as GUARDs. F2 is not reproduced on this fixture.
- UX3 is labelled GUARD in `new-checks/on-*.txt` (run before it was relabelled); it fails on C2 and passes on C0 and C3, so it is an AC.
- **Harness state (the UX agent's "later FX-K4B runs return the model-error reply").** Reproduced here on C0 and C3 when one scenario object was played
  twice: the scripted model consumes the turn objects it is given, so the second run has no steps left and ends in the model-error reply. With a fresh copy of
  the scenario each time (UX5) both runs give identical text on C0, C2 and C3. My scripted checks build a fresh script per conversation, so they are not affected.
  A browser test server that keeps one scenario object across runs would show exactly that error; restart it or re-select the scenario per run.

## Still to run

The six reliable-chat browser specs on C3, C2 and C0 (the first attempt stopped at `next build`, which refuses a symlinked `node_modules`; not a product fault).

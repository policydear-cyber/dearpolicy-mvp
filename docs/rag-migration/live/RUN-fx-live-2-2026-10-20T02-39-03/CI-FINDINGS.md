# CI findings for PR #57 (kept separate from the product change)

Written 20 Oct 2026 alongside the fx-live-2 record. Nothing here changes product code. The workflow repair is a separate draft PR (#58), not part of PR #57.

## 1. The CI YAML claim, substantiated

**Claim:** `.github/workflows/ci.yml` does not parse as YAML, on `main` and on this branch alike.

**Exact parser error** (line 214, column 113 of the file as it stands on both):

| parser | message |
|---|---|
| PyYAML | `ScannerError: mapping values are not allowed here` (line 214, column 113) |
| action-validator 0.6.0 | `mapping values are not allowed in this context at line 214 column 113` |

**Cause:** the step name on line 214 is an unquoted plain scalar that contains `: ` (after the word "decides"): `- name: Reliable chat death cause and applicability (each benefit's own printed accident condition decides: an accident-only benefit …`. YAML reads the `: ` as a mapping value inside a plain scalar. Only that one step name of the workflow's 171 steps fails; every other unquoted name parses, and the other 8 workflow files parse.

**main versus this branch:** `ci.yml` is the same blob on `main` (`f3c9bcd17b90789b9092d03793c153829dfc07e3`) and on PR #57's branch: blob `68fbf451`, 36,154 bytes. PR #57 does not touch the file, so the defect predates it and is not caused by it. The line was introduced at `605f677d` (2026-10-18 17:09Z, branch `codex/death-journey-checkpoint-3`).

**What GitHub shows:** from then on GitHub names the workflow by its file path (`.github/workflows/ci.yml`) with 0 jobs for every run (runs 1064 to 1083). That is the visible effect of the parse error.

**Repair (separate):** draft PR #58, branch `fix/ci-yaml-step-name`, commit `fff5617f8c72bd0893239ad5c355d8954afb411f`, parent `main`. One line changed (+1 / -1): the same step name wrapped in double quotes (the text has no double quote or backslash, so it is byte-identical once parsed). With it the file parses and passes the action-validator schema check, and GitHub names run 1084 "CI" and shows its `test` job. Not merged.

## 2. A second, independent blocker: GitHub has not executed any step since 13 Oct

Even with the file parsing, the job does not start. GitHub refuses it with "The job was not started because recent account payments have failed or your spending limit needs to be increased". Every run from 856 (2026-10-13 15:56Z) to 1084 is refused this way. Run 855 (2026-10-13 15:07Z) is the last that ran any step; runs 853 to 855 failed at the step then numbered 123, "Environment-contract regression suite …". GitHub CI has therefore not been a pass/fail signal for a week, independent of the YAML error. Only the account owner can fix Billing & plans.

A notice on every run also says `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19. Not addressed.

## 3. A local run of the workflow's own steps on the PR tip

Because GitHub cannot run them, all 168 `npm run` steps of `ci.yml` (steps 3 to 170 of the current file) were run in order on the live-tested tree (`c4edd48c`; product code identical to `51a355a`), with the job's environment and fake keys only, Node 22. This is a local equivalent, not GitHub's result.

| outcome | steps |
|---|---|
| green on first pass | 164 |
| red on first pass | 4 |
| of those, red for an environment reason only | 1 (step 169 `npm run build`) |
| red for their own reasons | 3 (steps 43, 112, 140) |

**Step 169 `npm run build`:** the first attempt failed after 6 seconds with `Symlink [project]/node_modules is invalid, it points out of the filesystem root` (Turbopack), because the scratch tree used a symlinked `node_modules`. With a real `node_modules` directory and the same environment it passes (exit 0, 60 s). The earlier `next build` of the frozen candidate was also a success. Both attempts are kept (`step-169.log`, `step-169-rerun.log` in the local run folder).

**The three steps that are red for their own reasons.** Each was then run on a tree equal to `main` (the 24 modified files at `main`'s exact blob hashes, the PR-only files removed, `LEDGER.json` at `main`'s blob):

| step | command | on this branch | on `main` | attribution |
|---|---|---|---|---|
| 43 | `npm run v11:customer-screens-test` | 10 passed, some failed; the one FAIL line is "chat: one direct answer, collapsed sources, plain uncertainty, one next step, no internals" | identical failure | Not from PR #57. The customer chat page was changed on purpose on 15 Oct ("show every saved next step", `df8577bd`); the page and the test have the same blob hashes as on `main`, so the test is stale relative to the page. |
| 112 | `npm run rag2:s52-replay` | 11 of 12 passed; fails "the differences from the live answers … are exactly the fixes above": `S52A#0 added` has 3 statements, 2 expected | identical failure (same three added statements) | Not from PR #57. I did not determine when it began failing. |
| 140 | `npm run security:env-contract-test` | fails: **38** environment variable names read by real source are not documented in `.env.example` | fails: **34** names | Red on `main` already. This branch adds **4**: `DEBUGB`, `DEBUGC`, `DEBUGD` and `ONLY`, all read by the new `scripts/reliable-chat-fx-repairs-test.ts` (debug switches for that test). It also adds references to two names that are already undocumented on `main` (`DEARPOLICY_CHAT_CONTRACT`, 3 more files; `SHOW`, 2 more files). |

The 34 names red on `main` are pre-existing: for example `HH`, `PART`, `RAG2_LIVE_RUN_ID`, `REPLAY_RUN`, `SHOW`, `SKIP_REPLAY`, `STRESS_DEBUG`.

**Update (PR review, 20 Oct): resolved on the branch.** The four reads (`DEBUGB`, `DEBUGC`, `DEBUGD`, `ONLY`) were removed from `scripts/reliable-chat-fx-repairs-test.ts`: the three debug switches are deleted and the group selector is now an argument (`--only=A,G`) instead of an environment variable. `npm run security:env-contract-test` on the branch now reports exactly the same 34 undocumented names as `main` (identical name lists; both runs fail, as before). The only difference is the reference counts of two names that were already undocumented on `main`: `DEARPOLICY_CHAT_CONTRACT` (referenced in 26 files on the branch, 22 on `main`) and `SHOW` (16 and 14), because the new test scripts read them like the existing ones. So the branch adds zero failures over `main`; the 34 remain `main`'s, to be documented separately. PR #58's YAML repair is untouched and still separate.

**Not waived.** Step 140 is the one finding this PR makes slightly worse. It is a documentation-contract check, it affects no product behaviour, and it was already red on `main` and on the last GitHub run that executed anything. It should be closed by documenting the names in `.env.example` (or removing the four debug reads) in a small separate change, before any release that relies on this suite. Steps 43 and 112 need their tests or expectations brought up to date by whoever owns those areas; nobody should edit them to make them green without that review.

## 4. The suites this PR adds

The new suites (`reliable-chat:absence-scope-test`, `reliable-chat:fx-repairs-test`, and the fracture replay and usefulness-checker scripts) are run directly with their scripts; they are not steps of `ci.yml`. Their results are recorded in `docs/rag-migration/reliable-chat/RESULT-fx-repairs.md` and the PR description, not here.

## 5. One more item noticed, outside CI

`npm run rag2:live-ledger-test` (not a CI step) passes 9 of 10 with a placeholder chat-model environment (without one, seven of its cases refuse before testing anything). The tenth, L10 "reconcile on the repository", fails on the existing entry `dj-live-3` (recorded spend disagrees with its run record). That entry is byte-identical on `main`, so it is pre-existing and not caused by this run. The new `fx-live-2` ledger entry changes neither the pass nor the fail set: the same 9 pass and the same one fails with the old ledger and with the new one, and the reconcile output is identical.

## 6. What this does not claim

GitHub's own result for any step. A fix for billing. That a step which passed locally is green on GitHub's runner image. Anything about production.

# Ledger reconciliation, 18 Oct 2026 (PR #55)

Authoritative ledger: `docs/rag-migration/live/LEDGER.json` (exercise cap US$1.00). Nothing else counts toward the cap; a cost written only in a results document does not.

## What was wrong

The `sa-live` runs (structured answers, 17 Oct, and the schedule-completeness batch on 18 Oct) were started from the workbench harness. That route did not go through `ledger.ts plan` / `append`, which only the CI workflows call, so none of them was in the ledger, and the run cap came from an environment variable rather than from the ledger. The US$1.00 cap was therefore enforced by hand, not by the harness.

## Entries added (once each, from each run's own `run.json` `budgetUsed`; the 42 earlier entries, including the open US$0.15 `trial-codespace-1` reservation, are byte-for-byte unchanged)

| run_id | tested SHA | kind | calls | spent | run cap |
|---|---|---|---|---|---|
| sa-preflight | 88df296 | preflight | 0 | US$0.000000 | 0.12 |
| sa-live-1 | 88df296 | live | 0 | US$0.000000 | 0.12 |
| sa-live-2 | e069e8e | live | 60 | US$0.024357 | 0.12 |
| sa-live-3 | bc42847 | live | 51 | US$0.025161 | 0.12 |
| sa-live-4 | a2bffa6 | live | 21 | US$0.010812 | 0.05 |
| sa-live-5 | 7f3b0d1 | live | 14 | US$0.008165 | 0.03 |
| sa-live-6-preflight | bbe9aa5 | preflight | 0 | US$0.000000 | 0.03 |
| sa-live-6 | bbe9aa5 | live | 10 | US$0.006232 | 0.03 |

`sa-live-1` made no model call (0 calls, US$0). The two preflights spent US$0 and are recorded because the CI workflows record theirs.

## Totals after reconciliation

- Spent: US$0.438492 (earlier entries US$0.363765 + sa-live US$0.074727).
- Reserved and unsettled: US$0.15 (the open trial-codespace allowance, untouched).
- Used against the cap: US$0.588492. Remaining for automated runs: US$0.411508.

## Cross-check of every retained run record

All 44 `RUN-*` folders in `docs/rag-migration/live` and `docs/rag-migration/ingest-live` were compared with the ledger (`ledger.ts reconcile`): every charged run has an entry whose spend and call count equal its `run.json`; none is missing or mismatched. Not charged by design: two plumbing runs (local fake endpoint, no model call: `2026-10-08T15-03-26` and `s47-plumbing`) and two pre-ledger preflights (`preflight-2`, `local-preflight`: US$0, 0 calls, reported as uncharged preflights, not as missing).

## What now enforces the cap at every entry point

`liveSafetyChecks` (`e2e/support/rag2-live-guard.ts`) is called by `scripts/rag2-live/run.ts`, `scripts/ingest-live/run.ts` and by both live test servers. It now needs `RAG2_LIVE_RUN_ID` and a readable, valid ledger (`RAG2_LIVE_LEDGER`, default `docs/rag-migration/live/LEDGER.json`), refuses a run_id already in the ledger, and caps the run at `min(request cap, US$1.00 - every spend - every unsettled reservation)`. The CLI `append` and `validateLedger` refuse a duplicate run_id. A preflight spends nothing, so it is admitted when the budget is used up, but never with an unreadable ledger or a used run_id. There is no bypass flag. Checks: `npm run rag2:live-ledger-test` (10/10) and `rag2:live-budget-test` (17/17); three mutations (cap ignores the ledger, no refusals, a run missing from the ledger) each make the new checks fail.

Dry-run of the real runner, no model call: `--run-id sa-live-5` refused (already used), `--run-id sa-live-6` refused (latest ledger entry), no run id refused, a fresh id admitted (then stopped by the provenance check, because the working tree had changed).

## What "INCOMPLETE" means in the sa-live-6 run record and report

It is a placeholder, not a finding. `scripts/rag2-live/run.ts` writes, for every conversation of a scenario household, the fixed verdict `INCOMPLETE` with the reason text "graded by scenario-check.ts" at the moment the conversation is saved, because grading happens afterwards in a separate step (`reliable-chat-check.ts` for these reliable-chat scenarios; the comment names the older `scenario-check.ts`). The label says "not yet graded", nothing about the run.

It is not a missing turn, a missing record or a failed execution. From the run's own record: SBc and SBd each saved 2 of 2 turns, each with a visible answer (turn 1 `ask_user`, turn 2 `final_answer`, neither stopped by a limit); no conversation is marked not-run and there is no stop-before-start; 10 of 10 provider calls succeeded with 0 refusals, 0 failures and 0 open reservations; the budget record settled at US$0.006232. A genuine INCOMPLETE from the graders means "no saved answer for a turn" or "a turn stopped by a limit", and none of that happened here. The actual grade is `sa-live-6-2026-10-18T09-21-21-grade.md`: SBc PASS, SBd PASS (v8.2 and v9.1 incl. K1-K3).

The placeholder is left in `run.ts`: changing it is a harness change outside this task, and the stale `scenario-check.ts` pointer is a known wording issue, not an accounting one.

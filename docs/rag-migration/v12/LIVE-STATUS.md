# PR #47 actual-model reproduction: status (2026-10-13 23:00 SGT) -- SUPERSEDED: the run was made at 23:03, see LIVE-RESULT.md

**Result: NOT RUN. Real-model behaviour is unverified.** No model call was made, and the ledger is unchanged.

## Prerequisites checked

- **Product code under test:** `eaf88a7`, the PR #47 head when this check started. The harness commit `e1b86da` changes only test tooling.
- **Spending ledger** (`docs/rag-migration/live/LEDGER.json`, reconciled with `ledger.ts`):
  - 14 runs.
  - Spent US$0.172889.
  - Reserved US$0.15 (the open `trial-codespace-1` allocation, left untouched).
  - Remaining US$0.177111 of the US$0.50 cap.
  - Run cap for this reproduction: min(US$0.05, US$0.177111) = **US$0.05**.
- **Credential:**
  - The Composio `openai` connection has no active account.
  - Account `openai_soke-sandra` (alias `dearpolicy-test`) is still `initiated`.
  - A non-billable `GET /v1/models` through `proxy_execute(…, "openai")` was refused with `ToolRouterV2_NoActiveConnection` (code 4302). This is *no connection*, not the earlier proxy restriction (4327).
- **Model:** `CHAT_MODEL=openai:gpt-6-luna`, the configured model in the live-smoke workflow and README. Its price on file is US$0.10 / M input and US$0.50 / M output.
- **Dates:** the stay, 9pm 3 Oct 2026 to 11am 5 Oct 2026, is 38 hours.
  - The certificate prints "As of 01/07/2025" (effective 2025-07-01).
  - The wording prints no end or expiry date, so no documented period excludes the stay, and the dates are kept as given.
  - The certificate still shows only the amount as of 1 July 2025.

## Prepared (ready to run)

- **Harness** (`RAG2_LIVE_HOUSEHOLD=scenario`): seeds the PR #47 synthetic household into the local PostgreSQL and signs the test server in as that household. The six turns are fixed in `scripts/rag2-live/scenario-household.ts`; the model chooses its own tools and words.
- **Pre-registered grader** (`scripts/rag2-live/scenario-check.ts`, committed in `e1b86da` *before* any model call). It reads the visible answers, saved facts, calculation records, citations and traces. It counts "I haven't yet read … sum insured" as a retrieval/tool-selection failure.
- **Plumbing check:** the harness ran end to end against the local fake endpoint (`RUN-s47-plumbing-…-PLUMBING`, not a model, not money).
  - 6 turns, 12 fake calls; all fake replies failed the grader, as they should.
  - This proves the seeding, chat route, persistence, tracing, the cost reconciliation path and the grader. It says nothing about the model.

## The one action needed

Complete the Composio `openai` credential form for the `dearpolicy-test` connection with the dedicated, spend-limited test key. Then the run is:

```
# workbench kernel
exec(open("/home/user/main/scripts/rag2-live/relay.py").read()); relay = start_relay(proxy_execute)
# shell
source live.env   # NODE_ENV=test, local DB, OPENAI_BASE_URL=127.0.0.1 relay, CHAT_MODEL=openai:gpt-6-luna,
                  # RAG2_LIVE_RUN_CAP_USD=0.05, DEARPOLICY_RAG_LOOP_RUN_MAX_USD=0.05, RAG2_LIVE_HOUSEHOLD=scenario
node --import tsx scripts/rag2-live/run.ts --live --run-id s47-live-1
node --import tsx scripts/rag2-live/scenario-check.ts docs/rag-migration/live/RUN-s47-live-1-*
node --import tsx scripts/rag2-live/ledger.ts append --ledger docs/rag-migration/live/LEDGER.json --run-id s47-live-1 ...
```

The first result is kept as it is: no rerun to get a pass, and no change to the expectations after seeing it.

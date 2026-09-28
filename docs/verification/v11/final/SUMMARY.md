# V1.1 evaluation: FINAL candidate e864e8b

- Commit: `e864e8b6256aa760082cf74aa49a91107ae81454` ("V1.1 integrated r4").
- Environment: Node 22, local synthetic stack only.
- The code ran from the `/home/user/v11-eval` worktree, checked out at exactly e864e8b with no edits. `git diff e864e8b -- e2e scripts` is empty.
- No assertion, gate, scorer or selector changes were needed or made for this run.
- The after-r1 selector edits (claim status from `/api/claims` `display`, the T0-4 badge, the critical-illness interview) are already part of e864e8b.

| Run | Run id | Output |
|---|---|---|
| (A) In-process API run | `v11final1` | `api/` |
| Task 0 in-process | `v11t0final` | `task0/` |
| (B) Browser journey | `v11final2` | `journey/` |

- The browser journey covers sign-up, upload, processing, linking, the factual questions, the claim interview, evidence review, the final answer, the reopened conversation, supersession and deletion, and household B. It ran for 7.1 min, and Playwright reported 1 passed.
- Screenshots: `/home/user/v11logs/final-screenshots/` (outside the repo).
- Before/after, as the household saw it: `before-after-transcript.md`.

## Release gates

| Gate | API before (60b8ac8) | API FINAL | Journey before | Journey FINAL |
|---|---|---|---|---|
| unsupported_amount | PASS | PASS | PASS | PASS |
| unsupported_assertion | FAIL (3) | **PASS** | FAIL (3) | **PASS** |
| cross_scope | PASS | PASS | PASS | PASS |
| deleted_superseded | PASS | PASS | PASS | PASS |
| blocked_gap | FAIL (2) | **PASS** | FAIL (2) | **PASS** |
| positive_control | FAIL (8) | **PASS** | FAIL (7) | **PASS** |
| internal_text | FAIL (28) | **PASS** | FAIL (13) | **PASS** |
| fact_finding | FAIL (2) | **PASS** | PASS | PASS |
| ingestion terminal state and linking | PASS | PASS (INGEST clean) | PASS | PASS |
| Journey hard checks | – | – | – | **PASS** (0 failures) |

- Every gate shows 0 violations in both runs.
- The only quality note is that Q27 (provider quota) is `not_run` in the journey. It is an API-only case.
- In the API run, Q27 passes: 1 provider call, and the user sees a plain "service unavailable" message with no provider error text or organisation id.

### Observations (not gate failures)

In the final answer after evidence review, the journey check passes: the answer shows US$100,000 and S$200,000, kept per currency, citing Major Critical Illness wording p4. The same answer also has these problems:
- It still shows "Reviewer assessment needed" and "Evidence needed" cards.
- It includes the line "an amount whose currency the policy evidence does not state (not shown)".
- The "LIKELY APPLICABLE" card is repeated twice.

These are clarity issues, not correctness issues.

## Task 0

| Check | Result |
|---|---|
| T0-1 | PASS |
| T0-2 | PASS |
| T0-3 | PASS (quota case: 1 call, no raw error) |
| T0-4 | PASS, in-process and on the page: the list shows "Documents needed", matching the detail page's "No estimate yet" |
| T0-5 | PASS, in-process and on the page |
| T0-6 | PASS (no repair instructions on Benefits, Coverage or Documents) |
| T0-7 | PASS, in-process and on the page: 16 executions = 16 model_usage rows = 16 calls in `/api/usage`; no hard stop shown; Usage is not in the household nav |
| T0-8 | PASS (one-click sign-in, 676 ms) |

## Timings

**API run (in-process):**
- factual: p50 29 ms, p95 137 ms
- interview: p50 49 ms, p95 93 ms

**Browser journey:**

| Turn type | n | p50 | p95 | max |
|---|---|---|---|---|
| factual | 20 | 2.14 s | 7.78 s | 8.44 s |
| interview | 10 | 1.91 s | 2.22 s | 2.22 s |
| all chat | 34 | 2.11 s | 7.78 s | 8.44 s |
| upload to terminal | 17 | 2.99 s | 11.40 s | 11.40 s |

Slowest turns:

| Turn | Time |
|---|---|
| Q01 policy list | 8.44 s |
| Q28 fracture, after restart | 7.78 s |
| Q17 reopen | 5.76 s |
| Q26 after deletion | 4.92 s |
| Q20 | 3.35 s |
| Final answer after evidence review | 2.30 s |
| Slowest upload (hosp2022, the first after start) | 11.5 s |

## Model calls and cost (model_executions)

**Journey** (both journey households, since 2026-09-28T19:49:24Z): 106 calls, $0.033276.

| Operation | Model | Status | Calls | Cost USD |
|---|---|---|---|---|
| benefit_extraction | flash-lite | failed | 22 | 0 |
| catalog_building | flash-lite | failed | 18 | 0 |
| chat_fact_finding | deterministic-e2e | succeeded | 25 | 0.018719 |
| chat_reply | deterministic-e2e | succeeded | 1 | 0.000117 |
| coverage_extraction | deterministic-e2e | succeeded | 23 | 0.002815 |
| hosted_ocr | deterministic-e2e | succeeded | 1 | 0 |
| policy_extraction | deterministic-e2e | succeeded | 15 | 0.011625 |
| relevance_judging | flash | failed | 1 | 0 |

**API run:** 94 calls, $0.030121.

| Operation | Model | Status | Calls | Cost USD |
|---|---|---|---|---|
| benefit_extraction | flash-lite | failed | 12 | 0 |
| catalog_building | flash-lite | failed | 18 | 0 |
| chat_fact_finding | deterministic-e2e | succeeded | 23 | 0.015564 |
| chat_fact_finding (Q27 quota case) | gpt-5-mini | failed | 1 | 0 |
| chat_reply | deterministic-e2e | succeeded | 1 | 0.000117 |
| coverage_extraction | deterministic-e2e | succeeded | 23 | 0.002815 |
| hosted_ocr | deterministic-e2e | succeeded | 1 | 0 |
| policy_extraction | deterministic-e2e | succeeded | 15 | 0.011625 |

Notes:
- The "failed" flash and flash-lite rows are `DeterministicModelUnavailableError`: the offline stand-in does not serve those operations.
- Failures fell from 247 calls in after-r1 to 41 in the journey.
- Real providers would bill these operations.

## Cleanup

- Journey teardown: all residue counts are 0 and 3 auth users were deleted. The API and Task 0 runs removed their households.
- 0 SYNTHETIC accounts remain.
- `journey/cleanup-proof.txt`: 41 pass, 4 fail.
  - `claim_reviewer_audit_log`: 13 orphan rows and 5 synthetic-marker rows. This log is append-only by design; 3 orphan rows and 1 marker row are new from this run.
  - `model_usage.account_id` orphans: 575. This is the same count as after-r1, and this run's households have 0 model_usage rows left. The new household-deletion cleanup works; the 575 are leftovers from earlier runs and need a one-off purge.
- The stack is stopped: no next-server, worker, fake-auth, fake-services or playwright processes.

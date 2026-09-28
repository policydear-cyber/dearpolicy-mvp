# V1.1 evaluation: FINAL candidate 585ad58

- Commit: `585ad58da31019dc5ef8a2db989aa79d39dd34eb` ("V1.1 integrated r5 (final candidate)").
- Node 22, local synthetic stack only.
- The code ran from the `/home/user/v11-eval` worktree, checked out at exactly 585ad58. `git diff 585ad58 -- e2e scripts` is empty.
- No assertion, scorer or selector changes were made.

| Run | Run id | Output |
|---|---|---|
| (A) In-process API run | `v11f5api` | `api/` |
| Task 0 in-process | `v11f5t0` | `task0/` |
| (B) Browser journey | `v11f5j` | `journey/` |

- The browser journey ran for 7.2 min, and Playwright reported 1 passed with 0 hard-check failures.
- Screenshots: `/home/user/v11logs/final-585ad58-screenshots/`.
- Before/after as the household saw it: `before-after-transcript.md`.

## Release gates

| Gate | API before (60b8ac8) | API 585ad58 | Journey before | Journey 585ad58 |
|---|---|---|---|---|
| unsupported_amount | PASS | PASS | PASS | PASS |
| unsupported_assertion | FAIL (3) | PASS | FAIL (3) | PASS |
| cross_scope | PASS | PASS | PASS | PASS |
| deleted_superseded | PASS | PASS | PASS | PASS |
| blocked_gap | FAIL (2) | PASS | FAIL (2) | PASS |
| positive_control | FAIL (8) | PASS | FAIL (7) | PASS |
| internal_text | FAIL (28) | PASS | FAIL (13) | PASS |
| fact_finding | FAIL (2) | PASS | PASS | PASS |
| ingestion terminal state and linking | PASS | PASS | PASS | PASS |
| Journey hard checks | – | – | – | PASS (0 failures) |

- There are 0 violations in either run.
- The only quality note is that Q27 is `not_run` in the journey, because it is an API-only case. In the API run it passes: 1 provider call, with no provider text or organisation id shown.

## The final answer after evidence review (turn 32)

The answer now reads coherently:
- It gives the indicative estimate as US$100,000 and S$200,000, kept per currency and cited to page 4 of the Major Critical Illness wording.
- It gives one line per reviewed policy: "a reviewer matched the reviewed medical evidence to this policy's definition".
- It has one plain unstated-currency line: "The policy doesn't state the currency for Major Critical Illness (Living Care) under policy LC-NOCCY, so no amount is shown for it."
- It has one "no amount yet" line for the unmatched Living Care cover.
- It has a single next step: open the claim on the Claims page.

The stale "Reviewer assessment needed" and "Evidence needed" cards, and the duplicated "LIKELY APPLICABLE" card seen on e864e8b, are gone. The turn took 2.2 s.

Two minor style points, neither a gate:
- The facts list uses a machine-style label, "Survived Survival Period: not sure".
- Sources lists "Living Care · Page 4" twice. These are the two documents, SGD and USD.

## Task 0

| Check | Result |
|---|---|
| T0-1 | PASS |
| T0-2 | PASS (in-process p95 53 ms) |
| T0-3 | PASS (1 provider call, no raw error) |
| T0-4 | PASS, in-process and on the page: the list shows "Documents needed", matching "No estimate yet" |
| T0-5 | PASS, in-process and on the page |
| T0-6 | PASS |
| T0-7 | PASS, in-process and on the page: 16 executions = 16 model_usage rows = 16 calls in `/api/usage`; no hard stop; not in the household nav |
| T0-8 | PASS (one-click sign-in, 842 ms) |

## Timings

**API run (in-process):**
- factual: p50 34 ms, p95 204 ms
- interview: p50 43 ms, p95 93 ms

**Browser journey:**

| Turn type | n | p50 | p95 | max |
|---|---|---|---|---|
| factual | 20 | 2.00 s | 4.63 s | 7.95 s |
| interview | 10 | 1.97 s | 2.30 s | 2.30 s |
| all chat | 34 | 2.02 s | 4.63 s | 7.95 s |
| upload to terminal | 17 | 3.15 s | 9.37 s | 9.37 s |

Slowest turns:

| Turn | Time |
|---|---|
| Q01 policy list | 7.95 s |
| Q17 reopen | 4.76 s |
| Q28 after restart | 4.63 s |
| Q26 after deletion | 4.50 s |
| Q20 | 2.40 s |
| Q02 | 2.39 s |
| Final answer after evidence review | 2.23 s |

## Model calls and cost (model_executions)

**Journey** (both households, since 2026-09-28T20:30:12Z): 106 calls, $0.033084.

| Operation | Model | Status | Calls | Cost USD |
|---|---|---|---|---|
| benefit_extraction | flash-lite | failed | 22 | 0 |
| catalog_building | flash-lite | failed | 18 | 0 |
| relevance_judging | flash | failed | 1 | 0 |
| chat_fact_finding | deterministic-e2e | succeeded | 25 | 0.018683 |
| chat_reply | deterministic-e2e | succeeded | 1 | 0.000116 |
| coverage_extraction | deterministic-e2e | succeeded | 23 | 0.002783 |
| hosted_ocr | deterministic-e2e | succeeded | 1 | 0 |
| policy_extraction | deterministic-e2e | succeeded | 15 | 0.011502 |

**API run:** 94 calls, $0.030069.

| Operation | Model | Status | Calls | Cost USD |
|---|---|---|---|---|
| benefit_extraction | flash-lite | failed | 12 | 0 |
| catalog_building | flash-lite | failed | 18 | 0 |
| chat_fact_finding | deterministic-e2e | succeeded | 23 | 0.015564 |
| chat_fact_finding (Q27 quota case) | gpt-5-mini | failed | 1 | 0 |
| chat_reply | deterministic-e2e | succeeded | 1 | 0.000116 |
| coverage_extraction | deterministic-e2e | succeeded | 23 | 0.002802 |
| hosted_ocr | deterministic-e2e | succeeded | 1 | 0 |
| policy_extraction | deterministic-e2e | succeeded | 15 | 0.011587 |

The "failed" flash and flash-lite rows are `DeterministicModelUnavailableError`: the offline stand-in does not serve those operations, so they cost $0 here. A real provider would bill for them.

## Cleanup

- Journey teardown: all residue counts are 0 and 3 auth users were deleted. The API and Task 0 runs removed their households.
- 0 SYNTHETIC accounts remain.
- `journey/cleanup-proof.txt`: 41 pass, 3 fail. All three failures come from the append-only `claim_reviewer_audit_log`, which is by design:
  - 16 orphan rows (3 new from this run);
  - 6 synthetic-marker rows (1 new from this run);
  - the overall synthetic-markers scan, which counts the same 6 rows.
- `model_usage.account_id` orphans now PASS (0), after the legacy purge and the cleanup on household deletion.
- The stack is stopped: no next-server, worker, fake-auth, fake-services or playwright processes.

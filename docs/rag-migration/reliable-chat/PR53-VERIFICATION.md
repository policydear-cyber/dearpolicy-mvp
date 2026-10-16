# PR53 application and browser verification

Tested code: **2964e2a88878e968e081a7f5c578f69729ce8199**, based on PR52 head 6857dcac767dc77defca76036f169d1fde17bce1.
Main and production are unchanged. No merge, deployment, production-data modification, model call or ledger change.

## User-visible outcome

Conflicting or negative-only anatomical descriptions cannot validate an arbitrary compensation row. A clear correction resolves the case, produces the verified illustration, and clears the question.

The original PR52 selector selected the thigh for “not the thigh, the shin” and “tibia or femur”, and selected wrist for “wrist and shin”. In the real chat-route regression, restoring that selector actually saves a calculation despite conflicting reports (the assertion reports 1 calculation instead of 0).

The fix preserves affirmative anatomy when a different part is explicitly negated; keeps disjoint cases unresolved; refuses a caller's option when reports conflict; and does not silently ignore an unlisted part. No policy amount, percentage or calculation rule is changed.

A second defect emerged in the route test: case_conflict was not tracked as an open case requirement. After clarification, the S$10,000 result appeared beside the old question. The shared pending-question logic now tracks case_conflict along with missing/ambiguous cases, and clears the question when that benefit's case resolves.

## Executed checks

All on Node **22.23.3**.

| Check | Actual result |
|---|---|
| Source provenance | 963 downloaded/new source and configuration files match Git blob hashes at 2964e2a; zero mismatches |
| Focused case selector | 34/34 controls, including reversed table order, affirmative corrections, negative-only reports, conflicting parts and valid selections |
| New real-route regression | 6/6 turns across 3 synthetic conversations; unresolved reports save no calculation, clarification saves the S$10,000 shin calculation, calculation recomputes, no repeated question |
| Full project typecheck | exit 0, including after the build |
| reliable-chat:active-route-test | exit 0; now includes the new conflict suite, both households' existing slice/stage3/case/live-replay suites and grader controls |
| rag2:calc-test | exit 0 |
| rag2:facts-test | exit 0 |
| security:import-boundary-test | exit 0 |
| security:ci-workflow-coverage-test | exit 0 |
| Production build | exit 0 |
| Chromium reliable-chat journeys | **3/3**: RC1 question → S$10,000 → correction to S$20,000 → reopen; RC2 unlisted case; RC3 conflict → clarification → S$10,000, no repeated question |
| Removed-selector control | route regression exits 1: conflicting facts save a calculation |
| Removed-pending-fix control | route regression exits 1: resolved question reappears |

Both temporary reversions were restored in finally blocks. Source hashes were checked against 2964e2a afterward.

Commands:
- npm run typecheck
- npm run reliable-chat:active-route-test
- npm run rag2:calc-test
- npm run rag2:facts-test
- npm run security:import-boundary-test
- npm run security:ci-workflow-coverage-test
- npm run build
- npm run e2e:reliable-chat

The new tests are wired into package scripts and ci.yml. No assertion was removed to obtain a pass.

## Browser environment and unsuccessful setup attempts

Browser tests use the existing real chat page, chat API, asynchronous job queue/drain, stored answers, scripted-model hook and synthetic household. They compare saved statements/amounts with rendered output. They are not real-model evidence.

No native PostgreSQL service was installed in this workspace, and package setup encountered restricted-user errors. The browser database was an ephemeral local PGlite 0.5.10 database with pgvector, exposed to the unchanged pg client through @electric-sql/pglite-socket 0.2.13, with all 19 repository schema files applied. The unit/route harness uses the repository's own PGlite 0.3.15. No project dependency or runtime database configuration was changed for this adapter.

The first browser attempt stalled at the job drain. A diagnostic attempt isolated PostgreSQL error 26000: “unnamed prepared statement does not exist”, caused by the test socket bridge multiplexing clients. Both attempts were stopped and are not counted as passes. Serializing that temporary bridge and setting DATABASE_POOL_MAX=1 in the test process resolved it. The final full run passed 3/3, with no retries or skipped tests. The ephemeral browser/app/database processes were shut down.

Earlier new-fixture mistakes (reusing an already answered fact key, and failing to record the supplied fall) triggered existing safeguards; the fixture was corrected before the actual pending-question defect was isolated. The safeguards were not weakened.

Native Postgres 17 browser execution and hosted CI were not run here. A green local build is not described as hosted CI.

## Remaining evidence limits

No fresh real-model run and no actual-household trial were performed on this patch. The model prompt and tool definitions are unchanged; the repaired server decisions are proven by route/browser tests, not by new model-choice evidence. Unusual language, unrecognised anatomy and unhandled document layouts remain possible failure sources.

These are targeted regression results, not a representative accuracy measurement or a 99% reliability claim. Ready for review as a stacked fix to PR52; keep main unchanged until release is separately authorised.

Detailed output excerpts: [PR53-VERIFICATION-LOG.txt](PR53-VERIFICATION-LOG.txt).

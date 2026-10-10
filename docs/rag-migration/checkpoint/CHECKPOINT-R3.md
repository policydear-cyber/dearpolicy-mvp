# Checkpoint — integration round 3 (agents G, P, H + follow-ups)

**Code verified: `63a4d4b3986223ac117cc19683c301b826ba06fd`** (tree `65a3a081`). The next commit, `cabe531`, changes only
`docs/rag-migration/checkpoint/DEMO10.md`; the build and browser run below are on `cabe531`, whose code is identical.
Everything ran in the sandbox: Node 22.20.0, `NODE_OPTIONS=--max-old-space-size=2048`, each step under
`flock /home/user/.heavy.lock`. The suites use PGlite or a local PostgreSQL 17.11 with pgvector. Data is synthetic
and the model is the scripted test model; no real keys, no production data.

## Commits since cfd4d40 (remote 2d0bc03)
| sha | content |
|---|---|
| 602be87, cb743cc | agent G: applicability classes (G1); claimed amount, corrections, invalidation (G2) |
| 1e349ec, fc9ae16 | agent P: presentation (no internal commentary, dedupe, names, unknown person, supplied facts, conditional benefits); S3one |
| d451907, 3355c01, 319b68c | agent H: run-cap reservation, live guard, live household / scenarios / harness |
| 571fa4c | npm scripts (gaps, presentation, live*), CI and the required-suite list, .env.example, live checker C9 mechanics |
| b3c5596 | ask_user refuses a fact the message gives (a time is not answered by a date alone); user-facing wording at the source; hook invalidation sentence + claim-record sync; N1; prompt rag2-loop-v4 |
| 63a4d4b | **fix found in this checkpoint:** r6:chat-quality-test regressed at 602be87 (G1). "What is the family maximum for trip cancellation?" lost S$20,000 because the "Family maximum" column counted as an unrecognised class of person. A whole-family aggregate column is now treated as one family limit; "Family members" is still unrecognised. Gaps A2 is extended. Bisect: cfd4d40 0 hits, 602be87 1 hit, 63a4d4b 0 hits |
| cabe531 | DEMO10.md regenerated (body unchanged) |

## Type check
`npx tsc --noEmit` exits with code 0.

## Fresh-database setup (new empty PostgreSQL 17 database `dearpolicy_r3`, `log_statement=ddl` on that database)
```
createdb dearpolicy_r3        # empty: 0 tables, only plpgsql
DATABASE_URL=postgres://postgres:postgres@localhost:5432/dearpolicy_r3 npm run db:setup   # run 1, exit 0
DATABASE_URL=postgres://postgres:postgres@localhost:5432/dearpolicy_r3 npm run db:setup   # run 2 (repeat), exit 0
```
Both runs printed "DearPolicy database schema is ready (including household membership + RLS)." The server log has
no ERROR or FATAL lines. Reading the server's statement log, each file was matched to its logged statement:
- In both runs all 19 files appear in exactly the order `scripts/setup-db.ts` declares.
- The four added files, with log timestamps:

| file | position | run 1 | run 2 | object it creates (present after setup) |
|---|---|---|---|---|
| sql/background-jobs.sql | 11/19 | 15:19:29.865 | 15:19:30.551 | table `background_jobs` (+ `background_job_audit_log`) |
| sql/rate-limit.sql | 12/19 | 15:19:29.871 | 15:19:30.553 | table `rate_limit_buckets` |
| sql/model-provenance.sql | 15/19 | 15:19:29.904 | 15:19:30.559 | table `model_executions` |
| sql/v11-ingestion-evidence.sql | 18/19 | 15:19:29.919 | 15:19:30.564 | column `policy_members.benefit_tier` (+ `policy_benefits.source_text_start`) |

After setup the database has 47 public tables. household-rls.sql runs last, at position 19.

## Suites (on 63a4d4b; `npm run -s <suite>`)
| suite | result |
|---|---|
| rag2:gaps-test | 18/18 |
| rag2:presentation-test | 31/31 |
| rag2:calc-test | 38/38 |
| rag2:fix-test | 35/35 |
| rag2:adversarial-test | 47/47 |
| rag2:conv-test | 22/22 |
| rag2:loop-test | 22/22 |
| rag2:tools-test | 37/37 |
| verify:gate-test | 26/26 |
| verify:assertions-test | 27/27 |
| rag2:live-checker-test | 10/10 |
| rag2:live-budget-test | 10/10 (local database: `NODE_ENV=test DATABASE_URL=…localhost… npm run rag2:live-seed && npm run rag2:live-budget-test`) |
| rag2:demo10 | exit 0; `-- --out docs/rag-migration/checkpoint/DEMO10.md` regenerated (body identical to agent P's r3-P run) |
| v1:chat-contract-test | 29/29 |
| v1:retrieval-test | 29/29 |
| r6:chat-quality-test | 254 turns, 0 hits (1 hit before 63a4d4b, see above) |
| r7:answers-test | 324 messages / 164 conversations, 0 hits |
| claims:test | pass |
| system:test | 80 checks pass |
| security:live-chat-monetary-boundary-test | 30 cases pass |
| security:lifecycle-query-guard-test, security:env-contract-test, security:ci-workflow-coverage-test | pass |

No 3b results are reused: the 63a4d4b fix touches the save-time gate, so the whole list was re-run on 63a4d4b.

Not run:
- r7:claims/robustness, r8–r11, ingestion and the other e2e suites. This round changes no ingestion, claim-pack,
  rendering or job code.
- r6 and r7 do cover the chat answer paths through the gate.

## Build
`rm -rf .next && NEXT_TELEMETRY_DISABLED=1 npm run -s build` on cabe531 exits 0 in 127 s: compiled in 57 s,
59/59 pages, BUILD_ID `x_bBMVqM2aegwnega73zL`. wt-H's `.next` is a symlink to this build.

## Browser
`e2e/tests/rag2-conversation.spec.ts` on this build: **8/8**, each test alone and then all together (47.3 s).
Details are in BROWSER.md.

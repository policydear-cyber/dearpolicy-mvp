# V1.1 executed checks -- tested source `5f5314f`

Workspace: Composio cloud sandbox, 985 MB RAM, a per-user memory cgroup of 862 MB of which ~375 MB is held by the sandbox's own Jupyter services, Node 20.20. Every suite ran **alone, sequentially**; no dev server, build, browser or test database ran alongside a suite.

## Memory diagnosis

The earlier exit-137 failures were the kernel OOM killer (`oom_memcg=/user`). No suite accumulates databases: the heavy suites open one PGlite (with pgvector) and close it at the end. Their peak need is simply larger than the ~490 MB the sandbox leaves free (r5:answer peaked at ~830 MB above idle). Remedy: a 3 GB swap file in the sandbox (no test change; every case, assertion and failure report preserved; one process per suite, parent exit code = suite exit code). typecheck additionally needs `NODE_OPTIONS=--max-old-space-size=3072` (V8 heap ceiling, not system memory).

Heaviest suites (peak RAM+swap above idle, MB):

| suite | secs | peak RSS | RAM+swap above idle |
|---|---|---|---|
| launch:check | 169 | 667 | 1823 |
| r7:chat-robustness-test | 230 | 815 | 1222 |
| r11:blind-test | 42 | 803 | 1120 |
| r9:ingest-chaos-test | 395 | 815 | 828 |
| security:processing-failure-migration-procedure-test | 11 | 815 | 804 |
| r7:claims-test | 40 | 789 | 786 |
| r8:chaos-test | 209 | 831 | 784 |
| r10:perf-test | 46 | 795 | 781 |
| r9:redteam-test | 87 | 812 | 742 |
| r7:answers-test | 35 | 787 | 740 |
| r10:messy-docs-test | 29 | 775 | 680 |
| r6:chat-quality-test | 27 | 802 | 661 |

## Results

- **Full CI suite list (144 `npm run` steps from ci.yml, excluding build/typecheck/e2e):** run on `a2524ef` → 140/144 exit 0. One regression found (`rag2:release-holdout` H4: a library-wide negative was dropped) → fixed in `5f5314f`.
- **On `5f5314f`:** the 39 suites that exercise the chat loop, gate or acceptance sets rerun → 39/39 exit 0; `rag2:v11-test` 11/11 (10 conversations + false-negative control); sealed set 7/7 (6 + control). Only `compose.ts` changed between `a2524ef` and `5f5314f`.
- **typecheck** (`tsc --noEmit`, alone): exit 0, 39 s.
- **`next build`** (alone): exit 0.
- **Browser journey** `e2e:rag2-conversation` (alone, real Chromium 140 via Playwright, local PostgreSQL 17 + pgvector in the sandbox, synthetic households only, server on the `next build` output): **8/8 passed** (40 s).

## Failures that are not regressions

Each fails identically on the baseline `09acbbe` (PR #45) in this workspace:

| suite | failure | baseline 09acbbe |
|---|---|---|
| claims:evidence-download-test | signed-URL route returns 500 instead of 307 | same |
| r10:messy-docs-test | scanned CI PDF: OCR figure lost, document role null, answers ignore the question | identical failure lines |
| r7:chat-robustness-test | H1-tan scores below floor (facts 182<189, behaviour 213<219, full 158<167), trap items S088/S089 | identical |

Timing-sensitive suites that failed only while another process competed for memory and passed when rerun alone: claims:test (performance assertion), r8:chaos-test (one 8.5 s turn), rag2:conv-test F8 (timeout test).

Suites that failed on the first run only because the `docs/` fixtures had not been fetched into the fresh sandbox (conv5/6/7, deletion-semantics, calc-ingested, ingested-gate, ingest:scanned-detect, live-attribution) pass with them present.

## Not executed

- **Real-model sample:** blocked. The dedicated `OPENAI_TEST_API_KEY` exists only as a GitHub Actions secret; Actions jobs are not started ("recent account payments have failed") -- runs for `31bf0d4`, `a2524ef` executed zero steps. No Codespace exists and no Codespaces secret exists (checked via the API); none was created. No secret value was read or copied.
- GitHub-hosted CI: same block; zero executed steps is not a result.

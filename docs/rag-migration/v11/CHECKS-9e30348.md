# V1.1 executed checks -- tested code `9e30348`

All runs: Composio cloud sandbox (985 MB RAM plus a 3 GB swap file), **Node 22.20.0** -- the version CI uses and that
`@supabase/*` 2.116 requires (`package.json` now declares `"engines": {"node": "22.x"}`). One suite at a time.

| Check | Result |
|---|---|
| Full CI suite list (every `npm run` step in ci.yml except build / typecheck / e2e), Node 22 | **144/144 exit 0** |
| typecheck (`tsc --noEmit`) | pass |
| Browser journey `e2e:rag2-conversation` (real Chromium, local PostgreSQL 17 + pgvector, `next build` output) | **8/8** |
| `rag2:v11-test` / sealed set (used) | 11/11 / 7/7 (scripted: plumbing evidence) |
| `rag2:live-budget-test` (spend guard, local DB) | 17/17 |
| Live harness, relay **plumbing** run (fake upstream, no credential, US$0) | end to end OK (L2) |
| Live ingestion harness **preflight** (`QUESTIONS-v11.json`: fresh uploads incl. the scanned PDF, every model call refused, US$0) | end to end OK |

## The three "baseline failures" -- diagnosis

All three are the same root cause: **the workspace ran Node 20**, an unsupported runtime. Each passes on Node 22
without any test or code change, and fails identically on PR #45's code under Node 20.

| Suite | Node 20 failure | Mechanism found | Node 22 |
|---|---|---|---|
| claims:evidence-download-test | 500 instead of 307 | `@supabase/supabase-js` 2.116 builds a realtime client in `createClient`, which throws without Node 22's built-in WebSocket; the signed-URL route catches it as a 500. In production this would break **every evidence download** on Node 20. | 6/6 |
| r10:messy-docs-test | scanned CI schedule "read in part", OCR figure lost, answers ignore the question | the policy-reading step for the rotated scan did not produce the expected page text under Node 20 (the deterministic stand-in then has no reading for it, so ingestion falls back to "read in part"); the exact Node 20 rendering difference was not isolated further | pass |
| r7:chat-robustness-test | H1-tan scores below floor | runtime-dependent; not isolated further once it passed unchanged on Node 22 | pass |

Product risk and fix: the app declared no Node version, so a deployment on Node 20 would fail downloads (demonstrated)
and could degrade scanned-document reading. `engines.node = 22.x` makes the supported runtime explicit (Vercel and npm
honour it). No assertion was changed.

## Real-model sample -- prepared, not run

Method (existing, documented in `docs/rag-migration/live/README.md`): the loopback relay in the workbench kernel
forwards to OpenAI through the Composio `openai` connection, which holds the dedicated test key **server-side**; the key
never enters the sandbox, the chat or the repository. That connection no longer exists; a new one must be completed
by the owner on Composio's own form. Until it is, no model call can be made and none was.

Prepared sample (copied unchanged from the existing sealed sets; nothing newly authored):
- `scripts/ingest-live/fixture/QUESTIONS-v11.json` + `sealed/EXPECTED-v11.json`: fresh upload of 3 PDFs incl. the
  **scanned** JuniorShield schedule -> OCR/extraction -> retrieval; C2P person-column comparison (adult vs child),
  C3 scenario with follow-up, C5 endorsement, C7 scanned-schedule question.
- `scripts/rag2-live/run.ts --live --scenarios L2`: a person correction ("Sorry, I meant Grace, not Kai").
Ledger: US$0.172889 spent + US$0.15 reserved (trial-codespace-1) of the US$0.50 cap -> about US$0.177 available.

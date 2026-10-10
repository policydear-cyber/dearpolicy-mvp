# Live-model smoke (conversational RAG loop, real model)

Six synthetic conversations run against the **actual configured chat model** through the **real application path**,
graded by a deterministic checker. Nothing is scripted on the model side: the user turns are fixed, the model chooses
its own tools and writes its own answers.

```
scripts/rag2-live/run.ts ──HTTP──▶ e2e/support/rag2-loop-server.ts  (E2E_RAG2_LIVE=1)
                                   production `next build` served in-process · real /api/chat + chat job runner ·
                                   lib/rag2/loop (tools, usage meter, ledger, save-time gate) · local PostgreSQL 17
                                   └─ lib/rag2/loop/hosted-model.ts  POST {OPENAI_BASE_URL}/chat/completions
                                      (tools + tool_choice "required", NOT streaming)
                                      └─▶ relay 127.0.0.1:8787 (scripts/rag2-live/relay.py, a thread in the workbench kernel)
                                          └─▶ proxy_execute(…, "openai")  ── Composio injects the test key server-side ──▶ OpenAI
```

| File | What it is |
|---|---|
| `scripts/rag2-live/scenarios.ts` | the six conversations + source-grounded expected behaviour (passages, figures, calculation, forbidden outputs) |
| `docs/rag-migration/live/EXPECTED.md` | the same, readable (generated: `node --import tsx scripts/rag2-live/expected.ts`) |
| `scripts/fixtures/rag2-live/household.ts` | synthetic household **Lim** and its 4 documents (accident plan, hospital cash, Shield plan + endorsement) |
| `e2e/support/seed-rag2-live.ts` | seeds / cleans the household in the local database (the harness reseeds at start) |
| `e2e/support/rag2-live-guard.ts` | the live safety checks + the run-cap guard around the real hosted model |
| `e2e/support/rag2-loop-server.ts` | the existing test server; `E2E_RAG2_LIVE=1` = live mode |
| `scripts/rag2-live/relay.py` | loopback relay (runs inside the workbench kernel) |
| `scripts/rag2-live/plumbing_fake.py` | **PLUMBING TEST only**: a local fake OpenAI-compatible endpoint + proxy stand-in |
| `scripts/rag2-live/run.ts` | the harness; `check.ts` the deterministic checker; `report.ts` the markdown report |
| `scripts/rag2-live/budget-regressions.ts`, `check-regressions.ts` | tests of the budget logic and of the checker |

## How the app calls OpenAI (verified in code)
`HostedLoopModel` (lib/rag2/loop/hosted-model.ts) sends one **non-streaming** `POST {OPENAI_BASE_URL}/chat/completions`
per loop step with `Authorization: Bearer $OPENAI_API_KEY`, body `{model, temperature: 0, max_completion_tokens,
tool_choice: "required", parallel_tool_calls: true, messages, tools}`, and reads `choices[0].message.tool_calls`,
`usage.prompt_tokens/completion_tokens` and `model`. The model is `modelFor("chat")` (lib/ai/providers.ts): `CHAT_MODEL`
wins (`MODEL_PRESET=openai` alone would give `openai:gpt-5-mini` for chat), so the live run sets
`CHAT_MODEL=openai:gpt-6-luna` and checks it with `RAG2_LIVE_EXPECT_MODEL`. Price on file (lib/ai/providers.ts
PRICES): **gpt-6-luna US$0.10 / M input, US$0.50 / M output**. No streaming, so the relay needs no conversion. If the
model rejects an optional setting with a 400 naming it (e.g. `temperature` on a reasoning-class model), the hosted
model now sends the request once more without it and remembers that for the model (a 400 is not billed; `tool_choice`
and the tools are never dropped); the relay log shows the settings actually sent.

## Credential mechanism
The real key never enters the sandbox. The user connects a separate, spend-limited OpenAI **test** key as a Composio
`openai` connection (on Composio's own form). Inside the workbench kernel, `proxy_execute(method, endpoint, "openai",
body=…)` calls OpenAI with that key injected server-side. `relay.py` exposes that as an OpenAI-compatible endpoint on
127.0.0.1:8787; the app is pointed at it with `OPENAI_BASE_URL=http://127.0.0.1:8787/v1` and a dummy
`OPENAI_API_KEY` (the relay drops all incoming headers).

**Blocker found (2026-10-08):** in workbench session `trs_md3PUIGf2K7H`, `proxy_execute(…, "openai")` is refused before
any connection lookup: *"Proxy execution is disabled for toolkit 'openai' because it has a tool enable or disable list"*
(code 4327, `ToolRouterV2_ProxyExecutionDisabled`). Besides the connection, the session must allow proxy execution for
the `openai` toolkit (no tool allow/deny list on it). The relay turns this into a clean `403 proxy_execution_disabled`
and a missing connection into `401 no_openai_connection`; the app then answers honestly ("the assistant model returned
an error…"), does not retry a 401/403, and the harness stops the run.

## CI mode (hosted runner; `.github/workflows/rag2-live-smoke.yml`)
Because the workbench session cannot proxy `openai` (see the blocker above), the smoke runs on a GitHub-hosted runner
in **direct mode**: no relay; the app server calls `https://api.openai.com/v1` itself with a repository secret.

**One-step secret setup** (repository owner, once): GitHub → the repository → Settings → Secrets and variables →
Actions → **New repository secret** → Name `OPENAI_TEST_API_KEY`, Secret = the spend-limited OpenAI **test** key → Add
secret. (Environment secrets and required reviewers are not available for private repositories on GitHub Free, so it is
a repository secret.) Without it every run is forced to preflight and its report says "OPENAI_TEST_API_KEY not set".

**Requesting a run:** push the code first; then, as **policydear-cyber**, push ONE commit to
`claude/conversational-rag-v1-1` that changes **only** `scripts/rag2-live/run-request.json`:
```json
{ "run_id": "live-L1", "scenarios": ["L1"], "run_cap_usd": 0.50, "preflight": false }
```
The workflow refuses any other actor, a request commit that touches anything else, a merge, or a push that carries more
than the request commit. The **tested code** is the request commit's parent; both SHAs are recorded in the ledger, at
the top of `report.md` and in `run.json`. `run_id`: 1–40 of `A-Z a-z 0-9 . _ -`, new per run; `scenarios`: L1–L6;
`run_cap_usd`: > 0 and ≤ 0.50; `preflight: true` = everything up to the first model call, which is refused (US$0).

Why not a "Run workflow" button: GitHub's docs for `workflow_dispatch` say *"This event will only trigger a workflow
run if the workflow file exists on the default branch."* and *"On the GitHub UI, the "Run workflow" button will be
present if the workflow file exists on the default branch."*
(docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch). `main`
stays unchanged, so the push trigger is used; there is no pull_request, schedule or dispatch trigger.

**Model (mirrors production):** `CHAT_MODEL`, `JUDGEMENT_MODEL`, `NARRATION_MODEL` and `READING_MODEL` are all
`openai:gpt-6-luna` (production's plain variables); the guard refuses a run where any of them resolves to anything else.
Price on file from the official model page (developers.openai.com/api/docs/models/gpt-6-luna): input US$0.10, cached
input US$0.01, output US$0.50 per 1M tokens. The same page says *"Chat Completions supports function calling only with
`reasoning_effort` set to `none`."* — recorded as a provider-capability next to the price table
(lib/ai/providers.ts `capabilityFor`) and applied by `openAiRequest`, so the loop's tool calls are sent with
`reasoning_effort: "none"`. If the model rejects another optional setting (e.g. `temperature`) with a 400 naming it,
the request is sent once more without it; every attempt, retried or failed, is reserved and recorded by the fetch guard.
`report.md` / `run.json` open with the requested and provider-reported model ids and the settings actually sent.

**What the job does:** gate (actor, request-only commit, SHAs) → `npm ci` → plan against the ledger (below) →
`next build` → Postgres 17 + pgvector service, extensions, `npm run db:setup`, `npm run rag2:live-seed` → **Model test**,
the ONLY step that receives the secret: checks it is present (never printed); for a live run makes the free
availability check `GET https://api.openai.com/v1/models/gpt-6-luna` (only the HTTP status and the returned id are
kept; not 200 = stop, US$0); runs `run.ts --live` (or `--preflight`) with `set +e`, keeping its exit code (run.ts starts
the app server, and **the server process makes every model call**; the key is passed to it on that command only and
deleted from run.ts's own environment); then `grep -rF` for the key value over `docs/rag-migration/live` (run folder and
`server.log` included); writes its outputs and exits 0. Then, unless the key was found: the run's entry is appended to
LEDGER.json and the run folder + ledger are committed back as github-actions[bot] (rebase-and-retry the push up to 3
times; a `GITHUB_TOKEN` push does not retrigger workflows) **even when conversations failed**, and uploaded as an
artifact (30 days). If the push fails, the job fails loudly and the uploaded report and the job summary say
**"LEDGER NOT PERSISTED"**. Finally the job fails if the harness exit code was not 0 or the key was found. Never
`set -x`; the environment is never printed.

**Every model call counts, process-wide.** The live server installs a guard on `globalThis.fetch` before Next.js starts
(e2e/support/rag2-live-fetch-guard.ts): a request to OpenAI is sent only after its worst case — (body characters / 2.5 +
its `max_completion_tokens`/`max_tokens`) × the price on file — is reserved; a request without a bounded max output, to
an unpriced model, or to any other model-provider host (Google, Anthropic, Groq, …) is refused and recorded. Each call
is settled from its response usage (cached input at the cached price); a failed call or one without usage keeps its
whole reservation as spent. The fetch guard, the loop's usage meter and the loop-model guard share ONE run ledger
(usage-meter.ts `installSharedRunLedger`): the meter refuses a loop call that no longer fits it, without reserving twice.

**Budget across runs — US$0.50 for the WHOLE six-conversation exercise.** `docs/rag-migration/live/LEDGER.json`
(`exercise_cap_usd: 0.50`, one entry per run: run_id, tested_code_sha, request_sha, spent_usd,
reserved_unsettled_usd, calls, refused, failed). Before building, the workflow computes
`remaining = 0.50 − Σ(spent_usd + reserved_unsettled_usd)` and uses `min(remaining, run_cap_usd)` as the run's cap; it
refuses to start when remaining ≤ 0 or when the run_id is the latest entry's (or any earlier entry's). A run that left
no run.json is entered at its whole cap (spend unknown, never 0); a preflight at US$0. Earlier preflight runs
(preflight-1, preflight-2) made no model call and spent US$0.

**Direct-mode guard** (e2e/support/rag2-live-guard.ts): allowed only with `GITHUB_ACTIONS=true`, `CI=true`,
`RAG2_LIVE_MODE=direct`, `OPENAI_BASE_URL` unset or exactly `https://api.openai.com/v1`, and a non-empty
`OPENAI_API_KEY` (the placeholder `preflight-no-key-set` only with preflight). Every other refusal stays; relay mode is
unchanged. Request headers and the key are never recorded.

## Safety checks (the server and the harness both refuse to start otherwise)
`NODE_ENV=test`; `DATABASE_URL` on localhost/127.0.0.1; `VERCEL`/`VERCEL_ENV` unset; `OPENAI_BASE_URL` host is
127.0.0.1; `OPENAI_API_KEY` set to a dummy (anything starting `sk-` or longer than 64 chars is refused);
`ANTHROPIC/GEMINI/GROQ_API_KEY` and `DEARPOLICY_DETERMINISTIC_MODEL` unset; `RAG2_LIVE_RUN_CAP_USD` and
`DEARPOLICY_RAG_LOOP_RUN_MAX_USD` both set and ≤ 0.50; `DEARPOLICY_RAG_LOOP_REQUIRE_PRICE=1`; the chat model resolves to
`openai:*` and has a price on file. The harness additionally needs `--live` or `--plumbing` matching the relay's mode
(a `--plumbing` run refuses a live relay, so a plumbing run can never spend), and `.next/BUILD_ID` present. The relay
listens on 127.0.0.1 only, forwards only `POST /v1/chat/completions` and `GET /v1/models`, only for the allowed model
(`gpt-6-luna`), refuses `stream: true`, and has a hard 300-request ceiling. Synthetic data only; the live household's
account name carries the `SYNTHETIC-DPTEST` prefix; nothing touches production.

## Budget logic (US$0.50 run cap, enforced in code)
Before **every** model call — loop steps, retries, any verification call — the call's worst case is **reserved**:
`(input tokens estimated high (characters / 2.5) + the call's max output tokens) × the model's price on file`.
* The usage meter (lib/rag2/loop/usage-meter.ts) refuses the call (`run_budget`, no request sent) if spent + reserved +
  this reservation would pass `DEARPOLICY_RAG_LOOP_RUN_MAX_USD`; with `DEARPOLICY_RAG_LOOP_REQUIRE_PRICE=1` an unpriced
  model is refused outright (fail closed). After the call it settles at the priced provider usage; a failed call, or
  one reporting no usage, keeps its **whole reservation** as spent (never 0). Every attempt is still recorded in
  `model_usage` and `model_executions`.
* The live server's guard (e2e/support/rag2-live-guard.ts, `RunCostLedger`) does the same independently around the real
  hosted model with `RAG2_LIVE_RUN_CAP_USD`, so the cap holds even when the served `next build` predates the meter
  change. The guard refuses by throwing a non-retryable "spend cap" error before any request.
* Conversations run one at a time; the harness stops when the guard's remaining budget is below one call, when a call
  is refused, or when the relay reports 401/403.
* Size: the first call of a turn carries ~20 k characters of prompt + tool schema (≈ 8.2 k reserved input tokens):
  reservation ≈ 8.2 k × 0.10/M + 2 000 × 0.50/M ≈ **US$0.0018 per call** (later steps of a turn ≈ US$0.0022). Per turn: at most 12 calls, US$0.05.
  The six conversations (9 turns, typically 2–6 calls each) should cost roughly US$0.01–0.05 actual; the cap leaves
  headroom for ~250 worst-case calls.

## Commands
Once, in the sandbox (local Postgres 17 is installed):
```
pg_ctlcluster 17 main start
PGPASSWORD=postgres psql -h localhost -U postgres -c 'CREATE DATABASE dearpolicy_live'
PGPASSWORD=postgres psql -h localhost -U postgres -d dearpolicy_live -c 'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;'
DATABASE_URL=postgres://postgres:postgres@localhost:5432/dearpolicy_live npm run db:setup
# the server serves a production build: .next/ of the commit under test (here: a symlink to a build)
```
Start the relay **in a workbench kernel cell** (live):
```python
exec(open("/home/user/wt-H/scripts/rag2-live/relay.py").read())
relay = start_relay(proxy_execute)                 # 127.0.0.1:8787, mode "live", log /home/user/rag2-live-relay.jsonl
r, e = proxy_execute("GET", "https://api.openai.com/v1/models", "openai"); print(e or "connection OK")  # free check
```
Environment for the harness (it starts the server itself, on port 3310):
```
export NODE_ENV=test NODE_OPTIONS=--max-old-space-size=2048 NEXT_TELEMETRY_DISABLED=1 \
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/dearpolicy_live \
  OPENAI_BASE_URL=http://127.0.0.1:8787/v1 OPENAI_API_KEY=dummy-relay-key \
  CHAT_MODEL=openai:gpt-6-luna RAG2_LIVE_EXPECT_MODEL=openai:gpt-6-luna \
  RAG2_LIVE_RUN_CAP_USD=0.50 DEARPOLICY_RAG_LOOP_RUN_MAX_USD=0.50 DEARPOLICY_RAG_LOOP_REQUIRE_PRICE=1
unset ANTHROPIC_API_KEY GEMINI_API_KEY GROQ_API_KEY DEARPOLICY_DETERMINISTIC_MODEL VERCEL VERCEL_ENV
flock /home/user/.heavy.lock node --import tsx scripts/rag2-live/run.ts --live            # all six
flock /home/user/.heavy.lock node --import tsx scripts/rag2-live/run.ts --live --scenarios L1   # one first
```
Re-grade / re-write from the database: `node --import tsx scripts/rag2-live/check.ts docs/rag-migration/live/RUN-<ts>`,
`node --import tsx scripts/rag2-live/report.ts docs/rag-migration/live/RUN-<ts>`.
Tests: `node --import tsx scripts/rag2-live/budget-regressions.ts` (needs the seeded local DB),
`node --import tsx scripts/rag2-live/check-regressions.ts`.

Plumbing test (no credential, no model — results are **never** model results):
```python
exec(open("/home/user/wt-H/scripts/rag2-live/relay.py").read()); exec(open("/home/user/wt-H/scripts/rag2-live/plumbing_fake.py").read())
fake = start_fake_upstream(fail_first=1); relay = start_relay(fake_proxy, mode="PLUMBING TEST", log_path="/home/user/rag2-live-relay-plumbing.jsonl")
```
then the same environment and `node --import tsx scripts/rag2-live/run.ts --plumbing`; its output directory ends in
`-PLUMBING` and its report opens with a PLUMBING TEST banner.

## Output (per run: `docs/rag-migration/live/RUN-<timestamp>[-PLUMBING]/`)
`run.json` (everything below), `conv-<id>.json`, `relay.jsonl` (the relay's per-request log for the run),
`server.log`, `report.md`. Per conversation: user turns and visible answers; tool calls with their evidence ids and
the evidence entries; who the conversation is about, facts, pending question; saved citations, figure bindings and
calculation records; per turn: POST accepted (first response bytes), first assistant message persisted, answer seen,
model time and relay-measured upstream time; per call: reserved and charged US$, tokens, latency, requested and
provider-reported model; the `model_executions` rows; the checker verdict with its failure stage. Run level: commit and
tree, served BUILD_ID, model id requested and reported, request settings actually sent, prompt version with sha256 of
the system prompt and of the tool schema (and whether what the relay saw matches the source), budget used.

The checker is deterministic (no AI judge). Verdict PASS / FAIL / INCOMPLETE (a turn stopped by a limit or model
error); a FAIL names the earliest failing stage: document extraction → retrieval → person-version resolution → model
reasoning-tool selection → calculation → verification → presentation.

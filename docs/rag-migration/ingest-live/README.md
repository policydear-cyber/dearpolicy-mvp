# Live ingestion test (upload → extraction/OCR → stored library → retrieval → real-model conversation)

One fresh synthetic account, the **real app** (`next build`, served in-process by `e2e/support/ingest-live-server.ts`:
`STORAGE_DRIVER=local`, prototype malware mode, development identity, conversational loop on, jobs advanced by the
request drain that status polling triggers), a **real browser** (`e2e/ingest-live/ingest-live.spec.ts`), and every model
call behind the rag2 live guard (one run ledger, reservation before every request, cap ≤ US$0.50, the shared
`docs/rag-migration/live/LEDGER.json`). In CI every role is `openai:gpt-6-luna`, as in production.

| File | What it is |
|---|---|
| `scripts/ingest-live/run.ts` | the harness: safety checks → fresh account (sign-up path) → server → browser journey → read-only DB dumps → EXPECTED copied in → grade → `run.json`, `report.md` |
| `e2e/ingest-live/ingest-live.spec.ts` | the journey: family page → upload each source (no profile hint) → processing → library → questions (answers the chat's own follow-ups from the fixture) → reopen from history + follow-up → delete one source → ask again |
| `scripts/ingest-live/dump.ts` | READ ONLY transaction: page text per document, documents, person links, detected names, coverage/benefit/condition rows, jobs, `model_executions`, usage, chat messages |
| `scripts/ingest-live/check.ts` | deterministic grader (no AI judge); `check-regressions.ts` tests it |
| `scripts/ingest-live/fixture/` | `HOUSEHOLD.json`, `QUESTIONS.json` (agent T's eight conversations C1–C8, plus E1's reopen R1, delete `hx-endorsement.pdf`, re-ask D1), `source/*.pdf` (T's) |
| `scripts/ingest-live/sealed/` | `EXPECTED.json` (machine checks E1 translated from T's facts/answers; R1 and D1 are E1's) and T's own `EXPECTED.source.json/.md`. CI moves the folder out of the checkout before the app starts; the harness copies it into the run folder only after the conversations. A placeholder (`"placeholder": true`) is never graded PASS |
| `.github/workflows/ingest-live.yml` | the CI run (same gate, secret handling, leak scan, ledger and commit-back as `rag2-live-smoke.yml`) |

## Requesting a run
Push the code first; then, as **policydear-cyber**, push ONE commit to `claude/conversational-rag-v1-1` that changes
**only** `scripts/ingest-live/run-request.json`:
```json
{ "run_id": "ingest-1", "run_cap_usd": 0.10, "preflight": false }
```
Cap = min(`run_cap_usd`, 0.50 − everything already in LEDGER.json). `preflight: true` (or no `OPENAI_TEST_API_KEY`)
runs everything with every model request refused (US$0). Output: `docs/rag-migration/ingest-live/RUN-<run_id>-<time>/`
— `report.md`, `run.json` (tested SHA, models requested/reported, every provider request with its reservation, charge,
tokens and provider request id, provenance rows joined to them), `transcript.json`, `uploads.json` (states and timings),
`linking.json`, `extracted/*.txt`, `dump-processing/`, `dump-final/`, `screenshots/*.png`, `verdict.json`,
`server.log`, `browser.log`. Results and LEDGER.json are committed back even when the run fails.

Local preflight (no key):
```
export NODE_ENV=test DATABASE_URL=postgres://postgres:postgres@localhost:5432/dearpolicy_ingest \
  OPENAI_BASE_URL=http://127.0.0.1:8787/v1 OPENAI_API_KEY=dummy-relay-key READING_MODEL=openai:gpt-6-luna \
  CHAT_MODEL=openai:gpt-6-luna JUDGEMENT_MODEL=openai:gpt-6-luna NARRATION_MODEL=openai:gpt-6-luna \
  RAG2_LIVE_EXPECT_MODEL=openai:gpt-6-luna RAG2_LIVE_RUN_CAP_USD=0.05 DEARPOLICY_RAG_LOOP_RUN_MAX_USD=0.05 DEARPOLICY_RAG_LOOP_REQUIRE_PRICE=1
npm run db:setup && npx next build
flock /home/user/.heavy.lock npm run ingest:live -- --preflight --run-id local-preflight --expected scripts/ingest-live/sealed/EXPECTED.json
```

## Fixture formats
`QUESTIONS.json`: `{ "upload_order": [files], "conversations": [{ "id": "C3", "turns": [{ "q": "Q3", "user": "..." }] }] (each a New chat; a later turn answers the chat's pending question), or "conversation": [{ "id", "text", "answers": [{ "when": "<regex on the chat's
question>", "reply": "..." }] }], "reopen": [{ "conversation": "C5", "id", "text" }], "delete_source": "<file>", "after_delete": [...] }`.
`EXPECTED.json`: `{ "documents": [{ "file", "linked_people": [names], "pages": [{ "page", "must_contain": [..] }] }],
"turns": { "<id>": { "must_include", "must_include_any", "must_not_include", "person", "version": "<file that must be
cited>", "citations": [{ "file", "page" }], "must_not_cite", "ask_follow_up" } } }`.

## Every billable call an upload makes (production path, `lib/rag/ingest.ts`)
| # | Call | Where | Output bound |
|---|---|---|---|
| 1 | scanned-page OCR (reading model; PDF file part) | ingest.ts:458 → documents/ocr.ts → ocr-hosted.ts:68 → providers.ts `hostedDocumentToText` / `openAiDocumentText` | max(2048, 1200 × pages); one retry for dropped pages; up to 3 upright re-reads for turned pages |
| 2 | policy extraction (+ one smaller fallback on a transient error) | ingest.ts:555 → ai/extract-policy.ts:269/289 | 6 000 (was **unbounded**) |
| 3 | benefit catalogue: row categorisation + one call per benefit page | ingest.ts:836 → policies/catalog-builder.ts:196/342 | 900 / 700 |
| 4 | conditions catalogue, per page | ingest.ts:856 → policies/condition-catalog.ts:192 | 900 |
| 5 | ledger read + verify | ingest.ts:933 → ledger/extract.ts:157/197 | 4 000 / 1 500 |
| 6 | bundle parts (a file holding several policies): calls 1–5 again per part | ingest.ts:497 | as above |
| 7 | Pinecone embeddings/index (production only, `PINECONE_API_KEY`) | ingest.ts:765/788 → rag/pinecone.ts:64/134 | not a model call; refused by the guard; off in the test |
| — | person linking, member tiers, same-schedule settling, reference-document linking | ingest.ts:647/887/947/746 | no model call (code only) |
Chat time: the conversation loop (rag2/loop/hosted-model.ts, `max_completion_tokens` per call) and the judgement calls
(ai/judge.ts 80, policies/relevance-judge.ts 1 200). Every structured call goes through `lib/ai/llm.ts`
`structuredCompletion` (default bound 8 192 when a caller names none) → `providers.ts` `fetch`, so the live server's
process-wide fetch guard sees, reserves and settles each one; any other provider host, an unbounded or unpriced request,
and Pinecone / VirusTotal are refused.

## Production defect found (fixed in this branch)
With `READING_MODEL=openai:gpt-6-luna`, `lib/documents/ocr.ts` returned scanned pages **unchanged and unmarked**
(`supportsHostedDocumentReading("openai")` was false), so a scanned page was never read — even with a Gemini key
configured, the fallback inside `hostedDocumentToText` was unreachable. Reproduced on the base commit: 0 provider
requests, page text "" stored as `native`. Now the configured OpenAI vision model reads it (PDF file content part), and a
page nothing can read is stored `unreadable` and named in the document's notes.

# Browser check — conversational RAG loop (reviewer spec)

> **SCRIPTED TEST MODEL.** The model is the adversarial suite's scripted test model (scripts/fixtures/rag2-adv),
> chosen per test through the test server. This checks what DearPolicy renders and saves through the real chat page
> and `/api/chat`; it says nothing about how a real model behaves. Synthetic households only; no real keys, no
> production URLs or credentials. Screenshots stayed in the sandbox.

## What was tested
- Code: `40d31d3` (tree `c95e93a0`) = remote head 7886e3d + the db:setup commit `715156d` + the browser-spec
  mechanics commit `40d31d3`. The app code is identical to 6d75338: the commits after it change only docs,
  `scripts/setup-db.ts` and the two e2e files.
- Build: `next build` output from 6d75338 (CHECKPOINT.md run, BUILD_ID `us0dKjrUwzUwttZZyE59s`), served in-process in
  production mode (`next({ dev: false })`, the equivalent of `next start`). next dev was not used.
- Spec: `e2e/tests/rag2-conversation.spec.ts` with `e2e/support/playwright.rag2.config.ts`; the real `/chat` page;
  the conversation and messages are persisted in PostgreSQL and read back by the test (`/__rag2adv/last`).

## Environment
Sandbox (985 MB RAM + 2 GB swap), Node 22.20.0, Playwright 1.55.0, Chromium 154.0.8037.92 (Debian apt),
PostgreSQL 17.11 (apt) with pgvector and pgcrypto. Peak during the run: ~460 MB used, ~500 MB swap; no memory
failure.

## Commands
```
# database (local only)
pg_ctlcluster 17 main start
psql: CREATE DATABASE dearpolicy_e2e; CREATE EXTENSION vector; CREATE EXTENSION pgcrypto;
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/dearpolicy_e2e
npm run db:setup                      # full schema (now includes the four files it used to miss); run twice, idempotent
# environment for server and tests
export NODE_OPTIONS=--max-old-space-size=2048 DEARPOLICY_RAG_LOOP=1 PORT=3300 NODE_ENV=test \
       E2E_RAG2_NEXT=start NEXT_TELEMETRY_DISABLED=1 E2E_CHROMIUM_PATH=/usr/bin/chromium
unset OPENAI_API_KEY ANTHROPIC_API_KEY
node --import tsx e2e/support/seed-rag2-conversation.ts
node --import tsx e2e/support/rag2-loop-server.ts &          # "rag2 loop test server on http://localhost:3300"
# one test at a time, then the whole file once
npx playwright test -c e2e/support/playwright.rag2.config.ts -g "<test name prefix>"
npx playwright test -c e2e/support/playwright.rag2.config.ts
```

## Results — 7/7 pass (each test alone, then all 7 in one serial run: 7 passed, 41.6 s)
| Test | Result | Key assertions / visible text |
|---|---|---|
| S1 factual | PASS | "Ethan's KidSafe fracture benefit is S$600 per fracture, from the Child column."; no S$1,000; no internal ids; saved figure binding 600 / Child; gate empty |
| S2 broken arm | PASS | turn 1 asks how it happened, no S$ figure, at most 2 "?" (the one question and its card); `cause` not recorded as "accident" (saved facts: injury "broken arm", how_it_happened "fell off the monkey bars at school"); turn 2 "S$600 per fracture", no "medically confirmed"/"approved" |
| S3 hospital income | PASS | asks admission time, then discharge time (no S$ before); turn 3 "Indicative estimate: KidSafe hospital income of S$90 for 2 complete periods of 24 hours comes to S$180."; never S$270 (3 nights); "payout" appears only in the notice "… they are not a payout …" |
| S4 side question | PASS | "Marcus's MediGuard deductible is S$2,500 per policy year."; Ethan's pending question re-asked ("How much was Ethan's medical bill for the arm?"); saved claim subject Ethan (…0003), injury "broken arm" kept |
| S7 bill estimate | PASS (after mechanics fix) | "Indicative estimate: the smaller of the bill you told me about (S$1,500) and the S$1,200 limit, less the S$100 excess, comes to S$1,100."; notice "… not a payout …"; saved CalculationRecord indicative_estimate, steps s_lim (min → 120000 cents) then s_ded (→ 110000), result 1100 |
| S9 other household | PASS | no S$120 / FamilyFirst / Insured Child; visible: "Part of what I was going to say couldn't be tied to a passage of your documents, so I left it out."; 0 messages written to the other household; no claim |
| X1 prompt injection | PASS | "Claims must be notified within 30 days of the Accident."; no "pre-approved" / "50,000" / "will receive" |

## Failure before the mechanics fix (verbatim, S7)
```
✘ e2e/tests/rag2-conversation.spec.ts:100:5 › S7 min(bill, limit) - excess survives the save-time gate and is shown as an indicative estimate
  Error: expect(received).toBeTruthy()
  Received: false
  > 107 |   expect(s.message?.answer_json?.computations?.some((c: any) => c.result.value === 1100)).toBeTruthy();
```
The visible assertions had already passed. The record exists, but in `answer_json.calculations`: the bill estimate
now comes from the `calculate` tool (CalculationRecord), not from `compute` (ComputationRecord in `computations`).
The spec now looks in both lists and still requires a saved record whose result is S$1,100 — the assertion is not
weaker (commit 40d31d3).

## Mechanics changes (commit 40d31d3, no assertion weakened)
1. `e2e/support/rag2-loop-server.ts`: `E2E_RAG2_NEXT=start` serves the existing `next build` output in-process
   (`dev: false`) instead of next dev, keeping the two test routes. It still refuses NODE_ENV=production, Vercel,
   a missing loop flag and a non-local database.
2. `e2e/tests/rag2-conversation.spec.ts` S7: record location, as above.
Earlier (6d75338): S3 ignores the rendered "not a payout" notice when checking that the estimate is never called a
payout.

## Not covered
- The real model; the other e2e suites; multi-turn visible text is summarised from the test's assertions and the
  saved rows (only the last assistant message of each test is read back).

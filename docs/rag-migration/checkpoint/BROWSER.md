# Browser check — conversational RAG loop (reviewer spec)

> **SCRIPTED TEST MODEL.** The model is the adversarial suite's scripted test model (scripts/fixtures/rag2-adv),
> chosen per test through the test server. This checks what DearPolicy renders and saves through the real chat page
> and `/api/chat`; it says nothing about how a real model behaves. Synthetic households only; no real keys, no
> production URLs or credentials. Screenshots stayed in the sandbox.

## Round 3 run (current)
- Code tested: `cabe531` (tree `92a8fd4b`). Its code is identical to `63a4d4b`; see CHECKPOINT-R3.md.
- Build: a fresh `next build` of that tree (`rm -rf .next`; BUILD_ID `x_bBMVqM2aegwnega73zL`, 59/59 pages). It was
  served in-process in production mode (`E2E_RAG2_NEXT=start`, `NODE_ENV=test`), not with next dev.
- Database: local PostgreSQL 17.11 database `dearpolicy_e2e`. Its schema came from `npm run db:setup`, and sql/ is
  unchanged since. It was re-seeded with `e2e/support/seed-rag2-conversation.ts`.
- Environment: Node 22.20.0, Playwright 1.55.0, Chromium 154.0.8037.92 (apt). About 345 MB RAM and 650 MB swap in
  use after the run; memory blocked no test.
- Commands. Each test ran alone first (`-g "<name prefix>"`), then the whole file:
```
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/dearpolicy_e2e NODE_OPTIONS=--max-old-space-size=2048 \
       DEARPOLICY_RAG_LOOP=1 PORT=3300 NODE_ENV=test E2E_RAG2_NEXT=start NEXT_TELEMETRY_DISABLED=1 E2E_CHROMIUM_PATH=/usr/bin/chromium
unset OPENAI_API_KEY ANTHROPIC_API_KEY
rm -rf .next && NEXT_TELEMETRY_DISABLED=1 npm run -s build
node --import tsx e2e/support/seed-rag2-conversation.ts
node --import tsx e2e/support/rag2-loop-server.ts &        # "rag2 loop test server on http://localhost:3300"
flock /home/user/.heavy.lock npx playwright test -c e2e/support/playwright.rag2.config.ts -g "<test name prefix>"
flock /home/user/.heavy.lock npx playwright test -c e2e/support/playwright.rag2.config.ts
```

| Test | Alone | All together | Key assertions / visible text (from the saved reply) |
|---|---|---|---|
| S1 factual | PASS | PASS | "Ethan's KidSafe fracture benefit is S$600 per fracture, from the Child column, payable if the fracture is confirmed by X-ray and certified by a registered medical practitioner."; no S$1,000; no internal ids; binding 600 / Child; gate empty |
| S2 broken arm | PASS | PASS | turn 1 asks how it happened, no S$; cause never "accident"; turn 2 "S$600 per fracture", no "medically confirmed" / "approved" |
| S3 hospital income | PASS | PASS | admission time, then discharge time, asked one at a time; "Indicative estimate: KidSafe hospital income of S$90 for 2 complete periods of 24 hours comes to S$180."; never S$270 |
| S3one (new, agent P) | PASS | PASS | admission and discharge in one message are both used and never asked again: no "?" in turn 2; the same S$180 estimate; no internal commentary; `discharged_at` saved |
| S4 side question | PASS | PASS | "Marcus's MediGuard deductible is S$2,500 per policy year."; Ethan's bill question re-asked; claim subject Ethan, injury "broken arm" kept |
| S7 bill estimate | PASS | PASS | "Indicative estimate: the smaller of the bill you told me about (S$1,500) and the S$1,200 limit, less the S$100 excess, comes to S$1,100."; "not a payout"; saved record result 1100 |
| S9 other household | PASS | PASS | "I couldn't identify "Rohan" among the family members linked to your account. Which family member do you mean? …"; no S$120 / FamilyFirst / Insured Child; 0 rows written to the other household; no claim |
| X1 prompt injection | PASS | PASS | "Claims must be notified within 30 days of the Accident."; no "pre-approved" / "50,000" / "will receive" |

All together: **8 passed (47.3 s)**. No failures and no spec changes in round 3.

## Round 2 run (40d31d3, superseded)
On the round-2 build from 6d75338, the spec had 7 tests and all 7 passed, alone and together. S7 passed after the
mechanics fix below.

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

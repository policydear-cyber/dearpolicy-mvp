# Live-model smoke: six synthetic conversations (diagnostic, not a reliability measure)

Model: the configured production chat model `openai:gpt-6-luna` (Vercel Production `CHAT_MODEL`, also JUDGEMENT/NARRATION/READING).
Provider-reported model on every call: `gpt-6-luna`. Official model page (developers.openai.com/api/docs/models/gpt-6-luna):
US$0.10 / 1M input, US$0.01 cached input, US$0.50 output; Chat Completions function calling only with
`reasoning_effort: "none"` -- which the loop now sends. Settings sent: temperature 0, max_completion_tokens 2000,
tool_choice required, parallel_tool_calls true, reasoning_effort none. Prompt `rag2-loop-v4` (system sha256 b28f7900…, tools e19e62af…).
Runner: GitHub Actions, app built with `next build`, local pgvector Postgres with the synthetic Lim household (extracted text seeded,
so PDF/OCR extraction is NOT tested), real `/api/chat` route, job runner, tool loop, persistence and save-time verification.

| Run | Tested code | Request commit | Results commit | Scenarios |
|---|---|---|---|---|
| live-L1-r2 | af8a6b4 | 80b0e38 | 7095559 | L1 |
| live-L2-L6 | 7095559 (same code as af8a6b4; results files only) | 3bb5534 | fdd0a46 | L2-L6 |
Raw: RUN-live-L1-r2-*/ and RUN-live-L2-L6-*/ (conversations, tool calls, evidence, timings, per-call usage), LEDGER.json.

## Results: 3 pass, 3 fail
| # | Scenario | Verdict | Earliest faulty stage | What happened |
|---|---|---|---|---|
| L1 | Direct factual | PASS | -- | Grace -> CareDay Insured Adult column S$200 (not the child's S$120); "in addition to hospital cash" quoted from p2. |
| L2 | Adult/child table + person correction | PASS | -- | Kai S$400 (child), corrected to Grace S$800 (adult), condition cited. |
| L3 | Broken arm, side question, return | FAIL | model reasoning / tool selection | Asked how it happened (correct); side question answered for the speaker (S$3,500) and the pending question resumed (correct). After the cause was given, asked whether the fracture was X-ray confirmed instead of stating the S$750 fracture benefit as conditional on that. Also visible: the question text appears twice (message + question card). |
| L4 | Hospital cash, all dates/times in one message | FAIL | calculation (table-value parsing) | Times were used without re-asking. `calculate` refused: "the rate is printed per year, not per day" -- the row label "Hospital cash (each complete 24 hours, max 90 per year)" was parsed as a per-year rate; the "per year" belongs to the 90-period cap. The model then wrote S$120 itself; the composer correctly dropped it (no calculation record). Also visible: internal evidence ids "[e9, e6]" leaked into the answer text. |
| L5 | Endorsement changes a limit | FAIL | verification | The model found Endorsement No. 1 and answered S$1,500,000 "as amended effective 1 July 2026" -- correct. The save-time gate rejected it: "the row prints one column per person or tier, and the figure is not bound to a column"; the endorsement's Before/After columns are versions, not person tiers. The user saw only "I couldn't confirm one of the figures…". |
| L6 | Not in the documents | PASS | -- | Said it could not find an evacuation benefit in the uploaded SunHaven documents (not that the policy excludes it), listing what the schedule does cover; no invented figure. |

No fix was made and nothing was re-run. The three faults are general (a period parser, a gate rule, prompt/question policy) and
must be fixed without reference to these questions, then checked with these cases plus new paraphrases.

## Usage and cost (cumulative exercise cap US$0.50, LEDGER.json)
- 41 model calls, all HTTP 200, no retries or refused calls; 0 reasoning tokens.
- Charged by the run guard from provider usage at the official prices (cache-aware): US$0.00111 (L1) + US$0.00733 (L2-L6) = **US$0.00844**.
- Largest per-call reservation US$0.0027 (estimated input + 2000 output tokens); remaining exercise allowance US$0.49156.
- Uncertainty: (1) openai.com/api/pricing does not list GPT-6 Luna (it lists "GPT-5.6 Luna" at US$0.20/US$1.20); the model page's
  US$0.10/US$0.50 was used -- at the higher rates the spend would still be below US$0.02. (2) The app's own usage table
  (model_executions) records cached_tokens = 0 and so over-states cost (L1: US$0.00246 vs US$0.00111) -- an accounting defect.
  (3) The OpenAI organisation's billed amount was not visible from here.
- Latency: first useful response 8-16 s per turn; model time 6-15 s per turn over 3-7 calls of 1-9 s each.

## GitHub Actions history (evidence per run)
- 159 runs with zero jobs, named by file path (23 Sep - 8 Oct): ci.yml at 158 of those commits fails YAML parsing (checked by
  parsing the file at each commit); 1 (1d24f20, 23 Sep) parses -- cause not established.
- 83 failed runs whose jobs never started: annotation "The job was not started because recent account payments have failed or
  your spending limit needs to be increased" (26-30 Sep; main and other branches). Billing has not blocked runs since.
- Actual test failures on this branch after the YAML fix: CI stops at "Round 7 chat robustness" (61 steps passed, 68 later steps
  not run): (a) a fixture-name check flags "Jun Hao" in a comment at lib/rag2/tables.ts:437 (introduced on this branch);
  (b) H3-C14#7 "list my docs" answered as a claim on the existing chat path -- whether it predates this branch is unknown, because
  main has had no CI run that parsed since 23 Sep.
- Earlier "all suites pass" results were from the development sandbox, not GitHub.

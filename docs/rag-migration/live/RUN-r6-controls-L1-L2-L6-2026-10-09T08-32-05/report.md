# Live model run r6-controls-L1-L2-L6 — 2026-10-09T08:32:05.878Z

- Tested code: `8bb117e16c747d9b65e0a6c6c88cc458c5f3324b`; run request commit: `5fbff862cff5da96955218162244c9eb00ae5737`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`openai:gpt-6-luna`, NARRATION_MODEL=`openai:gpt-6-luna`, READING_MODEL=`openai:gpt-6-luna`; provider-reported: `gpt-6-luna`
- Request settings actually sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Model availability check (GET /v1/models/<model>, free): 200 id `gpt-6-luna`

| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |
|---|---|---|---|---|---|---|---|
| 1 | L1 t1 | gpt-6-luna → gpt-6-luna | 200 | 4583 / 17 (4440, 0) | US$0.00198 | US$0.00007 | 1.2 s |
| 2 | L1 t1 | gpt-6-luna → gpt-6-luna | 200 | 4697 / 41 (4457, 0) | US$0.00201 | US$0.00009 | 1.5 s |
| 3 | L1 t1 | gpt-6-luna → gpt-6-luna | 200 | 5679 / 157 (4571, 0) | US$0.00215 | US$0.00024 | 2.1 s |
| 4 | L1 t1 | gpt-6-luna → gpt-6-luna | 200 | 7602 / 101 (5553, 0) | US$0.00243 | US$0.00031 | 2.8 s |
| 5 | L2 t1 | gpt-6-luna → gpt-6-luna | 200 | 4585 / 17 (4440, 0) | US$0.00199 | US$0.00007 | 1.0 s |
| 6 | L2 t1 | gpt-6-luna → gpt-6-luna | 200 | 4696 / 42 (4459, 0) | US$0.00201 | US$0.00009 | 1.5 s |
| 7 | L2 t1 | gpt-6-luna → gpt-6-luna | 200 | 5674 / 159 (4570, 0) | US$0.00215 | US$0.00024 | 2.2 s |
| 8 | L2 t1 | gpt-6-luna → gpt-6-luna | 200 | 8039 / 138 (5548, 0) | US$0.00251 | US$0.00037 | 2.2 s |
| 9 | L2 t2 | gpt-6-luna → gpt-6-luna | 200 | 4645 / 17 (0, 0) | US$0.00199 | US$0.00047 | 0.8 s |
| 10 | L2 t2 | gpt-6-luna → gpt-6-luna | 200 | 4759 / 107 (4519, 0) | US$0.00202 | US$0.00012 | 1.7 s |
| 11 | L2 t2 | gpt-6-luna → gpt-6-luna | 200 | 8257 / 76 (4633, 0) | US$0.00251 | US$0.00045 | 1.5 s |
| 12 | L2 t2 | gpt-6-luna → gpt-6-luna | 200 | 8608 / 105 (8131, 0) | US$0.00257 | US$0.00018 | 1.8 s |
| 13 | L6 t1 | gpt-6-luna → gpt-6-luna | 200 | 4594 / 19 (4440, 0) | US$0.00199 | US$0.00007 | 1.0 s |
| 14 | L6 t1 | gpt-6-luna → gpt-6-luna | 200 | 4674 / 108 (4468, 0) | US$0.00201 | US$0.00012 | 1.5 s |

- Mode: direct (GitHub Actions; OpenAI called directly with the repository secret, never logged)
- Code: `5fbff86` (tree `967c382c`); served build `nqdVZ6IwdQ-jARiK36zI7`
- Model requested: `openai:gpt-6-luna`; provider-reported: `gpt-6-luna`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Prompt `rag2-loop-v5`: system sha256 `00678fb15151`, tool schema sha256 `d85a1e5e943e` (10 tools); what was sent matches the source
- Budget: run cap US$0.48231; spent US$0.00288 over 14 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| L1 Direct factual question | PASS |  | 1 | 8.1 s | 8.3 s | 4 | 22561/316 | US$0.00070 |
| L2 Adult / Child table, then a person correction | FAIL | model reasoning-tool selection | 2 | 8.1 s | 15.5 s | 8 | 49263/661 | US$0.00199 |
| L6 A question the documents do not answer | FAIL | model reasoning-tool selection | 1 | 3.5 s | 3.6 s | 2 | 9268/127 | US$0.00019 |

## L1 — Direct factual question: PASS
- **Turn 1** — “How much ICU cash does the CareDay plan pay for Grace?”
  - Answer: “Grace’s CareDay plan lists ICU cash of S$200 for each complete 24 hours in intensive care, up to 30 days per year; it is in addition to hospital cash.”
  - Tools: resolve_person → policies_for → search_passages → select_table_value → final_answer; outcome final_answer; evidence e5, e9
  - Time: accepted 0.4 s, answer saved 8.1 s, seen 8.2 s; model 7.5 s (upstream 7.5 s); 4 calls, 22561/316 tokens, US$0.00070
- All 13 checks passed.

## L2 — Adult / Child table, then a person correction: FAIL (model reasoning-tool selection)
- **Turn 1** — “What does our SunHaven plan pay for accidental dental treatment for Kai?”
  - Answer: “Only the insurer makes a decision on the claim, after reviewing it and its evidence.”
  - Tools: resolve_person → policies_for → search_passages → select_table_value → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 8.1 s, seen 8.3 s; model 7.0 s (upstream 7.0 s); 4 calls, 22994/356 tokens, US$0.00077
- **Turn 2** — “Sorry, I meant Grace, not Kai.”
  - Answer: “For Grace, SunHaven’s “Accidental dental treatment (per accident)” benefit is up to S$800 per accident, for treatment to sound natural teeth damaged by an Accident.”
  - Tools: resolve_person → policies_for → search_passages → select_table_value → final_answer; outcome final_answer; evidence e6, e17
  - Time: accepted 0.0 s, answer saved 7.0 s, seen 7.3 s; model 5.9 s (upstream 5.9 s); 4 calls, 26269/305 tokens, US$0.00122
- Failed checks:
  - t1 [verification] shows S$400: missing; visible figures: none (dropped by the composer / gate)
  - t1 [model reasoning-tool selection] figure bound to kai / SUNHAVEN / Child: bindings: none
  - t1 [model reasoning-tool selection] cites SUNHAVEN p1 "Accidental dental treatment (per acciden": retrieved but not cited

## L6 — A question the documents do not answer: FAIL (model reasoning-tool selection)
- **Turn 1** — “If one of us is injured overseas, does SunHaven pay for emergency medical evacuation, and up to how much?”
  - Answer: “I need to know who this is about first. Which household member do you mean?”
  - Tools: resolve_person → ask_user; outcome ask_user; evidence none
  - Time: accepted 0.0 s, answer saved 3.5 s, seen 3.6 s; model 2.5 s (upstream 2.5 s); 2 calls, 9268/127 tokens, US$0.00019
- Failed checks:
  - t1 [model reasoning-tool selection] asks no question: Which household member do you mean?
  - t1 [model reasoning-tool selection] says the documents do not say: I need to know who this is about first. Which household member do you mean? The answer depends on who this is about.

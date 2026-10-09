# Live model run live-L1-r2 — 2026-10-09T05:09:33.270Z

- Tested code: `af8a6b4dd9901d1d5cfebee479266824c3a8278e`; run request commit: `80b0e3820921c71cad55fbc9732eef65be171a96`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`openai:gpt-6-luna`, NARRATION_MODEL=`openai:gpt-6-luna`, READING_MODEL=`openai:gpt-6-luna`; provider-reported: `gpt-6-luna`
- Request settings actually sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Model availability check (GET /v1/models/<model>, free): 200 id `gpt-6-luna`

| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |
|---|---|---|---|---|---|---|---|
| 1 | L1 t1 | gpt-6-luna → gpt-6-luna | 200 | 3998 / 17 (0, 0) | US$0.00186 | US$0.00041 | 2.3 s |
| 2 | L1 t1 | gpt-6-luna → gpt-6-luna | 200 | 4112 / 106 (3872, 0) | US$0.00188 | US$0.00012 | 3.0 s |
| 3 | L1 t1 | gpt-6-luna → gpt-6-luna | 200 | 7205 / 86 (3986, 0) | US$0.00232 | US$0.00040 | 2.1 s |
| 4 | L1 t1 | gpt-6-luna → gpt-6-luna | 200 | 7628 / 114 (7079, 0) | US$0.00239 | US$0.00018 | 2.7 s |

- Mode: direct (GitHub Actions; OpenAI called directly with the repository secret, never logged)
- Code: `80b0e38` (tree `f36e1614`); served build `vMNHJ1b_pz6ePrkVKh8dn`
- Model requested: `openai:gpt-6-luna`; provider-reported: `gpt-6-luna`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Prompt `rag2-loop-v4`: system sha256 `b28f79008c52`, tool schema sha256 `e19e62af861c` (10 tools); what was sent matches the source
- Budget: run cap US$0.50000; spent US$0.00111 over 4 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| L1 Direct factual question | PASS |  | 1 | 10.7 s | 10.9 s | 4 | 22943/323 | US$0.00111 |

## L1 — Direct factual question: PASS
- **Turn 1** — “How much ICU cash does the CareDay plan pay for Grace?”
  - Answer: “Grace’s CareDay Hospital Cash Plan pays S$200 for each complete 24 hours spent in ICU, up to 30 days per year; ICU cash is in addition to hospital cash.”
  - Tools: resolve_person → policies_for → search_passages → select_table_value → final_answer; outcome final_answer; evidence e7, e11
  - Time: accepted 0.3 s, answer saved 10.7 s, seen 10.9 s; model 10.1 s (upstream 10.1 s); 4 calls, 22943/323 tokens, US$0.00111
- All 10 checks passed.

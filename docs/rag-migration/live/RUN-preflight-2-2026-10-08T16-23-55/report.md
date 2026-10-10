# PREFLIGHT preflight-2 — 2026-10-08T16:23:55.217Z

> **PREFLIGHT — no model call made; US$0.00 spent.** Build, seed, server and the /api/chat path ran; the run-cap guard refused the first model call. **OPENAI_TEST_API_KEY not set** (the run was forced to preflight).

- Stopped at: preflight: no model call made: stopped at the first model call -- scenario L1 turn 1: POST /api/chat 202 accepted in 278 ms, chat job complete, the conversation loop's first model call refused by the run-cap guard before any request was sent
- Mode: direct (GitHub Actions; OpenAI called directly with the repository secret, never logged)
- Code: `48c52e2` (tree `25d88865`); served build `Wtuil31qbRVhhPbSI4uQS`
- Model requested: `openai:gpt-6-luna`; provider-reported: none; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true}` (expected)
- Prompt `rag2-loop-v4`: system sha256 `b28f79008c52`, tool schema sha256 `e19e62af861c` (10 tools); what was sent -- nothing (no model call made)
- Budget: run cap US$0.50000; spent US$0.00000 over 0 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| L1 Direct factual question | INCOMPLETE | turn 1 stopped: model_error preflight: no model call made (no spend) | 1 | 0.4 s | 0.6 s | 1 | 0/0 | US$0.00000 |

## L1 — Direct factual question: INCOMPLETE
- **Turn 1** — “How much ICU cash does the CareDay plan pay for Grace?”
  - Answer: “I couldn’t finish: the assistant model returned an error, so I stopped before answering rather than guess. Nothing was saved from this attempt; please try again in a moment.”
  - Tools: model✗; outcome error (limit model_error); evidence none
  - Time: accepted 0.3 s, answer saved 0.4 s, seen 0.6 s; model 0.0 s (upstream 0.0 s); 1 calls, 0/0 tokens, US$0.00000
- Failed checks:
  - t1 [retrieval] shows S$200: missing; visible figures: none
  - t1 [model reasoning-tool selection] about grace: subject after the turn: none
  - t1 [model reasoning-tool selection] figure bound to grace / CAREDAY / Insured Adult: bindings: none
  - t1 [retrieval] cites CAREDAY p1 "ICU cash (each complete 24 hours, max 30": never retrieved

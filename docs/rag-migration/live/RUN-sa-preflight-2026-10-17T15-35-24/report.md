# PREFLIGHT sa-preflight — 2026-10-17T15:35:24.106Z

> **PREFLIGHT — no model call made; US$0.00 spent.** Build, seed, server and the /api/chat path ran; the run-cap guard refused the first model call.

- Stopped at: before the first model call (no conversation reached the model)
- Tested code: `88df296ca09bd8c648ea38e73c7ce74168e23db1`; run request commit: `-`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`openai:gpt-6-luna`, NARRATION_MODEL=`openai:gpt-6-luna`, READING_MODEL=`openai:gpt-6-luna`; provider-reported: none
- Request settings actually sent: none (no model request was sent)
- Model calls: none sent

- Mode: relay (loopback relay)
- Code: `undefined` (tree `undefined`); served build `dEJp6UU9dM0WIpF-3bOo-`
- Model requested: `openai:gpt-6-luna`; provider-reported: none; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}` (expected)
- Prompt `rag2-loop-v18-applicability`: system sha256 `10d8a4d144da`, tool schema sha256 `98a759ed14a3` (13 tools); what was sent -- nothing (no model call made)
- Budget: run cap US$0.12000; spent US$0.00000 over 0 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| SAa structured: closed tibia -> corrected to hip (attempt 1) | NO ANSWER |  | 1 | - | 0.4 s | 0 | 0/0 | US$0.00000 |

## SAa — structured: closed tibia -> corrected to hip (attempt 1): NO ANSWER
- **Turn 1** — “Daniel fell off a ladder at home and fractured his tibia. It's a closed fracture. What would his accident cover pay?”
  - Answer: POST /api/chat 404: No household
  - Time: accepted -, answer saved -, seen -; model - (upstream - via the relay); 0 calls, 0/0 tokens, -

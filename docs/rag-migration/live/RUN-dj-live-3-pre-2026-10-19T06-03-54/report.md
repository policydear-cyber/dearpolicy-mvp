# PREFLIGHT dj-live-3-pre — 2026-10-19T06:03:54.245Z

> **PREFLIGHT — no model call made; US$0.00 spent.** Build, seed, server and the /api/chat path ran; the run-cap guard refused the first model call.

- Stopped at: preflight: no model call made: stopped at the first model call -- scenario DI turn 1: POST /api/chat 202 accepted in 479 ms, chat job complete, the conversation loop's first model call refused by the run-cap guard before any request was sent
- Tested code: `f2fe6a630243bd19ac4ccaec95df965aa8504dc5`; run request commit: `-`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`(unset)`, NARRATION_MODEL=`(unset)`, READING_MODEL=`(unset)`; provider-reported: none
- Request settings actually sent: none (no model request was sent)
- Model calls: none sent

- Mode: relay (loopback relay)
- Code: `undefined` (tree `undefined`); served build `xyP9-mFJ84InNC_i0NDkD`
- Model requested: `openai:gpt-6-luna`; provider-reported: none; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}` (expected)
- Prompt `rag2-loop-v18-applicability`: system sha256 `10d8a4d144da`, tool schema sha256 `98a759ed14a3` (13 tools); what was sent -- nothing (no model call made)
- Budget: run cap US$0.01000; spent US$0.00000 over 0 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| DI death journey: death by illness (applicability control) | INCOMPLETE | graded by scenario-check.ts | 1 | 0.7 s | 0.8 s | 0 | 0/0 | US$0.00000 |

## DI — death journey: death by illness (applicability control): INCOMPLETE
- **Turn 1** — “Daniel passed away last week after a long illness - it was not an accident. What would the family receive from his insurance, and what should we do?”
  - Answer: “I couldn’t finish: the assistant model returned an error, so I stopped before answering rather than guess. Nothing was saved from this attempt; please try again in a moment.”
  - Tools: model✗; outcome error (limit model_error); evidence none
  - Time: accepted 0.5 s, answer saved 0.7 s, seen 0.8 s; model 0.0 s (upstream 0.0 s via the relay); 1 calls, 0/0 tokens, US$0.00000
- All 0 checks passed.

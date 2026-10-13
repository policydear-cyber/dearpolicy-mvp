# PLUMBING TEST s47-plumbing — 2026-10-13T14:56:13.716Z

- Tested code: `?`; run request commit: `-`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`(unset)`, NARRATION_MODEL=`(unset)`, READING_MODEL=`(unset)`; provider-reported: `plumbing-fake-not-a-model`
- Request settings actually sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`

| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |
|---|---|---|---|---|---|---|---|
| 1 | S47 t1 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 8240 / 40 (0, -) | US$0.00229 | US$0.00084 | 0.0 s |
| 2 | S47 t1 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 8949 / 40 (0, -) | US$0.00240 | US$0.00091 | 0.0 s |
| 3 | S47 t2 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 8283 / 40 (0, -) | US$0.00230 | US$0.00085 | 0.0 s |
| 4 | S47 t2 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 8425 / 40 (0, -) | US$0.00232 | US$0.00086 | 0.0 s |
| 5 | S47 t3 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 8336 / 40 (0, -) | US$0.00230 | US$0.00085 | 0.0 s |
| 6 | S47 t3 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 8677 / 40 (0, -) | US$0.00236 | US$0.00089 | 0.0 s |
| 7 | S47 t4 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 8378 / 40 (0, -) | US$0.00231 | US$0.00086 | 0.0 s |
| 8 | S47 t4 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 9293 / 40 (0, -) | US$0.00246 | US$0.00095 | 0.0 s |
| 9 | S47 t5 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 8424 / 40 (0, -) | US$0.00232 | US$0.00086 | 0.0 s |
| 10 | S47 t5 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 9353 / 40 (0, -) | US$0.00247 | US$0.00096 | 0.0 s |
| 11 | S47 t6 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 8480 / 40 (0, -) | US$0.00233 | US$0.00087 | 0.0 s |
| 12 | S47 t6 | gpt-6-luna → plumbing-fake-not-a-model | 200 | 8647 / 40 (0, -) | US$0.00235 | US$0.00088 | 0.0 s |

- Mode: relay (loopback relay)
> **PLUMBING TEST — NOT MODEL RESULTS.** The "model" was a local fake OpenAI-compatible endpoint (scripts/rag2-live/plumbing_fake.py) behind the real relay and app path. Verdicts below only show that the harness, relay, accounting and checker work end to end.

- Code: `undefined` (tree `undefined`); served build `7Nnt7FvVcRzOYiuDKM253`
- Model requested: `openai:gpt-6-luna`; provider-reported: `plumbing-fake-not-a-model`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Prompt `rag2-loop-v11`: system sha256 `e25007e0906d`, tool schema sha256 `3569df4ae9a8` (10 tools); what was sent matches the source
- Budget: run cap US$0.05000; spent US$0.01059 over 12 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| S47 PR #47 reported broken-leg conversation, extended to the bone, the fracture type and the stay times | INCOMPLETE | graded by scenario-check.ts | 6 | 0.5 s | 5.7 s | 12 | 103485/480 | US$0.01059 |

## S47 — PR #47 reported broken-leg conversation, extended to the bone, the fracture type and the stay times: INCOMPLETE
- **Turn 1** — “Desmond broke his leg.”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.3 s, answer saved 0.5 s, seen 0.7 s; model 0.1 s (upstream 0.0 s via the relay); 2 calls, 17189/80 tokens, US$0.00176
- **Turn 2** — “He fell down the stairs.”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.9 s, seen 1.1 s; model 0.1 s (upstream 0.0 s via the relay); 2 calls, 16708/80 tokens, US$0.00171
- **Turn 3** — “Yes, confirmed with an X-ray. He was also warded for two nights.”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.9 s, seen 1.1 s; model 0.0 s (upstream 0.0 s via the relay); 2 calls, 17013/80 tokens, US$0.00174
- **Turn 4** — “Transverse fracture.”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.9 s, seen 1.1 s; model 0.0 s (upstream 0.0 s via the relay); 2 calls, 17671/80 tokens, US$0.00181
- **Turn 5** — “The tibia. It was a closed fracture.”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.9 s, seen 1.1 s; model 0.1 s (upstream 0.0 s via the relay); 2 calls, 17777/80 tokens, US$0.00182
- **Turn 6** — “Admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026.”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.6 s, seen 0.8 s; model 0.1 s (upstream 0.0 s via the relay); 2 calls, 17127/80 tokens, US$0.00175
- All 0 checks passed.

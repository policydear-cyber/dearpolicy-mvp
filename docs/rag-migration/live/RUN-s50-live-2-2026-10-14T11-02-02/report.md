# Live model run s50-live-2 — 2026-10-14T11:02:02.706Z

- Tested code: `a13c755bd9ffedcf5f1b96a3fb65308f7050b514`; run request commit: `a13c755bd9ffedcf5f1b96a3fb65308f7050b514`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`(unset)`, NARRATION_MODEL=`(unset)`, READING_MODEL=`(unset)`; provider-reported: `gpt-6-luna`
- Request settings actually sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`

| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |
|---|---|---|---|---|---|---|---|
| 1 | S50 t1 | gpt-6-luna → gpt-6-luna | 200 | 7150 / 18 (0, 0) | US$0.00250 | US$0.00072 | 3.0 s |
| 2 | S50 t1 | gpt-6-luna → gpt-6-luna | 200 | 7265 / 81 (7024, 0) | US$0.00252 | US$0.00013 | 2.1 s |
| 3 | S50 t1 | gpt-6-luna → gpt-6-luna | 200 | 7450 / 37 (7139, 0) | US$0.00255 | US$0.00012 | 1.8 s |
| 4 | S50 t1 | gpt-6-luna → gpt-6-luna | 200 | 8947 / 119 (7324, 0) | US$0.00279 | US$0.00030 | 2.8 s |
| 5 | S50 t1 | gpt-6-luna → gpt-6-luna | 200 | 11828 / 79 (8821, 0) | US$0.00317 | US$0.00043 | 1.8 s |
| 6 | S50 t1 | gpt-6-luna → gpt-6-luna | 200 | 12015 / 459 (11702, 0) | US$0.00321 | US$0.00038 | 5.6 s |
| 7 | S50 t2 | gpt-6-luna → gpt-6-luna | 200 | 7768 / 94 (0, 0) | US$0.00260 | US$0.00082 | 1.8 s |
| 8 | S50 t2 | gpt-6-luna → gpt-6-luna | 200 | 8047 / 62 (7642, 0) | US$0.00265 | US$0.00015 | 1.6 s |
| 9 | S50 t2 | gpt-6-luna → gpt-6-luna | 200 | 9200 / 306 (7921, 0) | US$0.00282 | US$0.00036 | 3.5 s |
| 10 | S50 t2 | gpt-6-luna → gpt-6-luna | 200 | 9629 / 52 (9074, 0) | US$0.00290 | US$0.00017 | 2.0 s |
| 11 | S50 t2 | gpt-6-luna → gpt-6-luna | 200 | 11215 / 79 (9503, 0) | US$0.00315 | US$0.00031 | 2.0 s |
| 12 | S50 t2 | gpt-6-luna → gpt-6-luna | 200 | 11402 / 410 (11089, 0) | US$0.00318 | US$0.00035 | 3.6 s |

- Mode: relay (loopback relay)
- Code: `undefined` (tree `undefined`); served build `XA2f4V4ZoE-KnLnfxILVL`
- Model requested: `openai:gpt-6-luna`; provider-reported: `gpt-6-luna`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Prompt `rag2-loop-v14`: system sha256 `756f3a563ade`, tool schema sha256 `cd7e78dd3864` (12 tools); what was sent matches the source
- Budget: run cap US$0.01000; spent US$0.00424 over 12 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| S50 V1.4 cell-per-line certificate: a member's death after a car accident abroad, then both dates | INCOMPLETE | graded by scenario-check.ts | 2 | 18.1 s | 34.2 s | 12 | 111916/1796 | US$0.00424 |

## S50 — V1.4 cell-per-line certificate: a member's death after a car accident abroad, then both dates: INCOMPLETE
- **Turn 1** — “Darren died in a car accident in Japan, what can I do?”
  - Answer: “I’m so sorry for your loss, Michelle; Darren’s uploaded certificate lists Group Term Life of S$1,000,000 as of 6 October 2022, and the linked wording says the Death Benefit is the Sum Assured shown in the Certificate of Group Insurance. The same certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, while the linked summary says Accidental Death is 100% of the Sum Insured if death results from an Accident within 365 days; it also says territorial limits are worldwide, 24 ho”
  - Tools: resolve_person → note_facts → person_benefits → policies_for → search_passages → select_table_value → final_answer; outcome ask_user; evidence e5, e1, e14, e2, e15
  - Time: accepted 0.4 s, answer saved 18.1 s, seen 18.2 s; model 17.2 s (upstream 17.0 s via the relay); 6 calls, 54655/793 tokens, US$0.00208
- **Turn 2** — “The accident happened on 3 October 2026 and he died on 5 October 2026.”
  - Answer: “You told me the accident happened on 3 October 2026 and Darren died on 5 October 2026. The linked Personal Accident summary says Accidental Death is 100% of the Sum Insured if death results from an Accident within 365 days, and that territorial limits are worldwide, 24 hours a day; the dates you gave fall within that stated period, but the documents do not confirm whether the event meets the policy definition of Accident. The Term Life summary says the Death Benefit is the Sum Assured shown in t”
  - Tools: note_facts → search_passages → final_answer✗ → policies_for → select_table_value → final_answer; outcome final_answer; evidence e14, e15, e17, e2
  - Time: accepted 0.0 s, answer saved 15.9 s, seen 16.0 s; model 14.6 s (upstream 14.4 s via the relay); 6 calls, 57261/1003 tokens, US$0.00216
- All 0 checks passed.

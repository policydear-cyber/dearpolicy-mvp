# Live model run pr50-live-1 — 2026-10-15T07:31:03.590Z

- Tested code: `371ba7d3ec2f298735ec8234a04fa64a70c62ab6`; run request commit: `371ba7d3ec2f298735ec8234a04fa64a70c62ab6`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`openai:gpt-6-luna`, NARRATION_MODEL=`openai:gpt-6-luna`, READING_MODEL=`openai:gpt-6-luna`; provider-reported: `gpt-6-luna`
- Request settings actually sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`

| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |
|---|---|---|---|---|---|---|---|
| 1 | P50C t1 | gpt-6-luna → gpt-6-luna | 200 | 7280 / 14 (0, 0) | US$0.00252 | US$0.00073 | 3.7 s |
| 2 | P50C t1 | gpt-6-luna → gpt-6-luna | 200 | 8478 / 233 (7154, 0) | US$0.00270 | US$0.00032 | 5.0 s |
| 3 | P50D t1 | gpt-6-luna → gpt-6-luna | 200 | 7315 / 18 (7119, 0) | US$0.00252 | US$0.00010 | 11.0 s |
| 4 | P50D t1 | gpt-6-luna → gpt-6-luna | 200 | 7430 / 52 (7189, 0) | US$0.00255 | US$0.00012 | 6.2 s |
| 5 | P50D t1 | gpt-6-luna → gpt-6-luna | 200 | 8885 / 91 (7304, 0) | US$0.00277 | US$0.00028 | 8.7 s |
| 6 | P50D t1 | gpt-6-luna → gpt-6-luna | 200 | 9603 / 39 (8759, 0) | US$0.00288 | US$0.00019 | 5.4 s |
| 7 | P50D t1 | gpt-6-luna → gpt-6-luna | 200 | 9853 / 130 (9477, 0) | US$0.00292 | US$0.00020 | 12.0 s |
| 8 | P50D t1 | gpt-6-luna → gpt-6-luna | 200 | 10442 / 168 (9727, 0) | US$0.00302 | US$0.00025 | 7.1 s |
| 9 | P50A t1 | gpt-6-luna → gpt-6-luna | 200 | 7303 / 118 (7119, 0) | US$0.00252 | US$0.00015 | 5.4 s |
| 10 | P50A t1 | gpt-6-luna → gpt-6-luna | 200 | 7581 / 122 (7177, 0) | US$0.00257 | US$0.00017 | 6.2 s |
| 11 | P50A t1 | gpt-6-luna → gpt-6-luna | 200 | 10979 / 169 (7455, 0) | US$0.00304 | US$0.00051 | 6.9 s |

- Mode: relay (loopback relay)
- Code: `undefined` (tree `undefined`); served build `-GqmFKGh4u06esGcA0ela`
- Model requested: `openai:gpt-6-luna`; provider-reported: `gpt-6-luna`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Prompt `rag2-loop-v14`: system sha256 `756f3a563ade`, tool schema sha256 `0d242cfa9a14` (12 tools); what was sent matches the source
- Budget: run cap US$0.00600; spent US$0.00303 over 11 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| P50C PR #50 report C: full document inventory by person, insurer and product, including unreadable files | INCOMPLETE | graded by scenario-check.ts | 1 | 9.8 s | 10.2 s | 2 | 15758/247 | US$0.00106 |
| P50D PR #50 report D: fixed-limit Simple Fracture illustration (50% x S$5,000) | INCOMPLETE | graded by scenario-check.ts | 1 | 51.7 s | 52.0 s | 6 | 53528/498 | US$0.00114 |
| P50A PR #50 report A: hypothetical death with both dates -- which death benefits may apply and the next steps | INCOMPLETE | graded by scenario-check.ts | 1 | 19.2 s | 19.3 s | 3 | 25863/409 | US$0.00083 |

## P50C — PR #50 report C: full document inventory by person, insurer and product, including unreadable files: INCOMPLETE
- **Turn 1** — “What policies does my family have? List my uploaded documents by person, insurer and product. Distinguish personal certificates from reference wording and unreadable files.”
  - Answer: “Unlinked to a person: Harbourline General Insurance Pte. Ltd.’s Travel Insurance Policy Wording and Benefit Summary are readable reference documents, not linked to anyone in the household. Adrian: Public Officers Group Insurance Scheme - Certificate (Kestrel Life Ltd, a personal policy document); Public Officers Group Personal Accident - Summary of Benefits (KestrelOne, reference wording for the scheme, not a personal policy document); Public Officers Group Personal Accident - Policy Wording (Ke”
  - Tools: household_documents → final_answer; outcome final_answer; evidence e3, e4, e1, e2
  - Time: accepted 0.7 s, answer saved 9.8 s, seen 10.1 s; model 8.7 s (upstream 8.7 s via the relay); 2 calls, 15758/247 tokens, US$0.00106
- All 0 checks passed.

## P50D — PR #50 report D: fixed-limit Simple Fracture illustration (50% x S$5,000): INCOMPLETE
- **Turn 1** — “Hypothetical document-arithmetic test for Adrian: in the uploaded Summary of Benefits, Simple Fracture has a S$5,000 limit and a Leg row of 50%. If that provision applies, what is the illustration? Distinguish this from the separate Other Fracture provision and do not promise a payment.”
  - Answer: “If the Simple Fracture provision applies to Adrian’s Leg row, the conditional illustration is S$2,500 (50% of the S$5,000 Simple Fracture Benefit Limit), not a promised payment. This is distinct from the separate Other Fracture provision; the uploaded Summary of Benefits page reviewed here prints the Simple Fracture schedule, not an Other Fracture amount.”
  - Tools: resolve_person → person_benefits → search_passages → read_page → calculate → final_answer; outcome final_answer; evidence e10, e4, e9, e13
  - Time: accepted 0.0 s, answer saved 51.7 s, seen 52.0 s; model 50.5 s (upstream 50.4 s via the relay); 6 calls, 53528/498 tokens, US$0.00114
- All 0 checks passed.

## P50A — PR #50 report A: hypothetical death with both dates -- which death benefits may apply and the next steps: INCOMPLETE
- **Turn 1** — “Hypothetical test: Adrian died in a car accident in Japan. The accident happened on 3 October 2026 and he died on 5 October 2026. Based on my uploaded documents, explain which death benefits may apply and what I should do next.”
  - Answer: “I couldn’t look that up: the model-use budget set for this test run is used up, so no model was called.”
  - Tools: note_facts → policies_for → person_benefits → search_passages → search_passages → search_passages; outcome limit_reached (limit run_budget); evidence none
  - Time: accepted 0.0 s, answer saved 19.2 s, seen 19.3 s; model 18.5 s (upstream 18.5 s via the relay); 3 calls, 25863/409 tokens, US$0.00083
- All 0 checks passed.

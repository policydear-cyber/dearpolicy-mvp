# Live model run rc-live-4-wong — 2026-10-16T00:16:11.541Z

- Tested code: `0222152792a0bd8e442a3c83f34fcceae895b26d`; run request commit: `-`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`(unset)`, NARRATION_MODEL=`(unset)`, READING_MODEL=`(unset)`; provider-reported: `gpt-6-luna`
- Request settings actually sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`

| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |
|---|---|---|---|---|---|---|---|
| 1 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 7326 / 18 (0, 0) | US$0.00253 | US$0.00074 | 1.5 s |
| 2 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 7441 / 112 (7200, 0) | US$0.00255 | US$0.00015 | 2.5 s |
| 3 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 7724 / 104 (7315, 0) | US$0.00260 | US$0.00017 | 2.2 s |
| 4 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 11835 / 83 (7598, 0) | US$0.00316 | US$0.00054 | 2.0 s |
| 5 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 12532 / 77 (11709, 0) | US$0.00327 | US$0.00024 | 2.4 s |
| 6 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 13043 / 198 (12406, 0) | US$0.00336 | US$0.00029 | 3.0 s |
| 7 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 7326 / 18 (7200, 0) | US$0.00253 | US$0.00009 | 1.4 s |
| 8 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 7441 / 111 (7315, 0) | US$0.00255 | US$0.00014 | 2.1 s |
| 9 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 7722 / 102 (7315, 0) | US$0.00260 | US$0.00016 | 6.6 s |
| 10 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 11831 / 59 (7596, 0) | US$0.00316 | US$0.00053 | 2.5 s |
| 11 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 13670 / 74 (11705, 0) | US$0.00343 | US$0.00035 | 1.7 s |
| 12 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 14178 / 242 (13544, 0) | US$0.00353 | US$0.00032 | 3.1 s |
| 13 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 7313 / 18 (7156, 0) | US$0.00252 | US$0.00010 | 1.4 s |
| 14 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 7428 / 84 (7187, 0) | US$0.00255 | US$0.00014 | 2.2 s |
| 15 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 7620 / 99 (7302, 0) | US$0.00258 | US$0.00015 | 2.0 s |
| 16 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 11726 / 209 (7494, 0) | US$0.00314 | US$0.00060 | 3.1 s |
| 17 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 14383 / 328 (11600, 0) | US$0.00351 | US$0.00056 | 4.3 s |

- Mode: relay (loopback relay)
- Code: `undefined` (tree `undefined`); served build `-uKC7iVAfHvNvkDcb3Uvj`
- Model requested: `openai:gpt-6-luna`; provider-reported: `gpt-6-luna`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Prompt `rag2-loop-v16-cases`: system sha256 `f35d38b707ae`, tool schema sha256 `be30f3cecacc` (13 tools); what was sent matches the source
- Budget: run cap US$0.01000; spent US$0.00527 over 17 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| RCW4a rc-live-2: fixed-limit Simple Fracture, attempt 1 | INCOMPLETE | graded by scenario-check.ts | 1 | 15.0 s | 15.1 s | 6 | 59901/592 | US$0.00213 |
| RCW4b rc-live-2: fixed-limit Simple Fracture, attempt 2 | INCOMPLETE | graded by scenario-check.ts | 1 | 18.7 s | 18.9 s | 6 | 62168/606 | US$0.00160 |
| RCX rc-live-2 control: an unlisted case (a wrist) and who to contact | INCOMPLETE | graded by scenario-check.ts | 1 | 13.6 s | 13.7 s | 5 | 48470/738 | US$0.00155 |

## RCW4a — rc-live-2: fixed-limit Simple Fracture, attempt 1: INCOMPLETE
- **Turn 1** — “Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.”
  - Answer: “If the Simple Fracture benefit applies to Adrian's case “Jaw, Pelvis, Leg^, Ankle or Knee” (as you described: “Adrian broke his leg”), the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Public Officers Group Personal Accident - Summary of Benefits; it is an illustration from the document's terms, not a payment or an insurer's decision.”
  - Tools: resolve_person → note_facts → policies_for → person_benefits → search_passages → evaluate_benefit → final_answer; outcome final_answer; evidence e6, e11
  - Time: accepted 0.6 s, answer saved 15.0 s, seen 15.0 s; model 13.8 s (upstream 13.6 s via the relay); 6 calls, 59901/592 tokens, US$0.00213
- All 0 checks passed.

## RCW4b — rc-live-2: fixed-limit Simple Fracture, attempt 2: INCOMPLETE
- **Turn 1** — “Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.”
  - Answer: “If the Simple Fracture benefit applies to Adrian's case “Jaw, Pelvis, Leg^, Ankle or Knee” (as you described: “Adrian broke his leg”), the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Public Officers Group Personal Accident - Summary of Benefits; it is an illustration from the document's terms, not a payment or an insurer's decision. The policy wording defines a Simple Fracture as a closed fracture where the skin is not broken.”
  - Tools: resolve_person → note_facts → policies_for → person_benefits → search_passages → evaluate_benefit → final_answer; outcome final_answer; evidence e6, e11, e14
  - Time: accepted 0.0 s, answer saved 18.7 s, seen 18.9 s; model 17.6 s (upstream 17.4 s via the relay); 6 calls, 62168/606 tokens, US$0.00160
- All 0 checks passed.

## RCX — rc-live-2 control: an unlisted case (a wrist) and who to contact: INCOMPLETE
- **Turn 1** — “Adrian fractured his wrist falling off his bicycle. What can we claim for it from his accident cover, and who should I contact?”
  - Answer: “Adrian’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022; this is the amount printed on that date, not confirmation of cover now. The Public Officers Group Personal Accident - Summary of Benefits (page 13) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg^, Ankle or Knee 50%. It lists no case for a wrist.”
  - Tools: resolve_person → note_facts → policies_for → person_benefits → evaluate_benefit → evaluate_benefit → search_passages → select_table_value → final_answer; outcome final_answer; evidence e4, e12, e6
  - Time: accepted 0.0 s, answer saved 13.6 s, seen 13.7 s; model 13.1 s (upstream 13.0 s via the relay); 5 calls, 48470/738 tokens, US$0.00155
- All 0 checks passed.

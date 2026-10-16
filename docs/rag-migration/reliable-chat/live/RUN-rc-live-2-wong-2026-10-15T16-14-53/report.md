# Live model run rc-live-2-wong — 2026-10-15T16:14:53.420Z

- Tested code: `7c7b68f9a08ecfdfdb6367fa85aa61354fe4d202`; run request commit: `7c7b68f9a08ecfdfdb6367fa85aa61354fe4d202`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`(unset)`, NARRATION_MODEL=`(unset)`, READING_MODEL=`(unset)`; provider-reported: `gpt-6-luna`
- Request settings actually sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`

| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |
|---|---|---|---|---|---|---|---|
| 1 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 7326 / 18 (0, 0) | US$0.00253 | US$0.00074 | 1.9 s |
| 2 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 7441 / 111 (7200, 0) | US$0.00255 | US$0.00015 | 2.3 s |
| 3 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 7722 / 58 (7315, 0) | US$0.00260 | US$0.00014 | 2.1 s |
| 4 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 9818 / 85 (7596, 0) | US$0.00291 | US$0.00034 | 1.9 s |
| 5 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 10162 / 68 (9692, 0) | US$0.00297 | US$0.00018 | 2.4 s |
| 6 | RCW4a t1 | gpt-6-luna → gpt-6-luna | 200 | 10664 / 173 (10036, 0) | US$0.00306 | US$0.00025 | 3.6 s |
| 7 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 7326 / 18 (7200, 0) | US$0.00253 | US$0.00009 | 1.4 s |
| 8 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 7441 / 111 (7315, 0) | US$0.00255 | US$0.00014 | 2.3 s |
| 9 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 7722 / 99 (7596, 0) | US$0.00260 | US$0.00014 | 2.4 s |
| 10 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 11828 / 81 (7596, 0) | US$0.00316 | US$0.00054 | 2.0 s |
| 11 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 12521 / 74 (11702, 0) | US$0.00326 | US$0.00024 | 2.1 s |
| 12 | RCW4b t1 | gpt-6-luna → gpt-6-luna | 200 | 13029 / 205 (12395, 0) | US$0.00336 | US$0.00029 | 3.0 s |
| 13 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 7313 / 18 (7156, 0) | US$0.00252 | US$0.00010 | 1.3 s |
| 14 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 7428 / 83 (7187, 0) | US$0.00255 | US$0.00014 | 1.9 s |
| 15 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 7618 / 99 (7302, 0) | US$0.00258 | US$0.00015 | 2.0 s |
| 16 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 11724 / 65 (7492, 0) | US$0.00314 | US$0.00053 | 1.7 s |
| 17 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 11994 / 97 (11598, 0) | US$0.00319 | US$0.00020 | 1.9 s |
| 18 | RCX t1 | gpt-6-luna → gpt-6-luna | 200 | 13692 / 298 (11868, 0) | US$0.00344 | US$0.00045 | 3.8 s |

- Mode: relay (loopback relay)
- Code: `undefined` (tree `undefined`); served build `K8Ofz-JhS7pzrVG1yn_mb`
- Model requested: `openai:gpt-6-luna`; provider-reported: `gpt-6-luna`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Prompt `rag2-loop-v16-cases`: system sha256 `f35d38b707ae`, tool schema sha256 `be30f3cecacc` (13 tools); what was sent matches the source
- Budget: run cap US$0.00975; spent US$0.00482 over 18 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| RCW4a rc-live-2: fixed-limit Simple Fracture, attempt 1 | INCOMPLETE | graded by scenario-check.ts | 1 | 15.4 s | 15.6 s | 6 | 53133/513 | US$0.00180 |
| RCW4b rc-live-2: fixed-limit Simple Fracture, attempt 2 | INCOMPLETE | graded by scenario-check.ts | 1 | 14.6 s | 14.7 s | 6 | 59867/588 | US$0.00144 |
| RCX rc-live-2 control: an unlisted case (a wrist) and who to contact | INCOMPLETE | graded by scenario-check.ts | 1 | 13.6 s | 13.8 s | 6 | 59769/660 | US$0.00157 |

## RCW4a — rc-live-2: fixed-limit Simple Fracture, attempt 1: INCOMPLETE
- **Turn 1** — “Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.”
  - Answer: “If the Simple Fracture benefit applies to Adrian's case “Jaw, Pelvis, Leg^, Ankle or Knee” (as you described: “Adrian broke his leg”), the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Public Officers Group Personal Accident - Summary of Benefits; it is an illustration from the document's terms, not a payment or an insurer's decision.”
  - Tools: resolve_person → note_facts → person_benefits → search_passages → evaluate_benefit → final_answer; outcome final_answer; evidence e4, e9
  - Time: accepted 0.5 s, answer saved 15.4 s, seen 15.6 s; model 14.4 s (upstream 14.2 s via the relay); 6 calls, 53133/513 tokens, US$0.00180
- All 0 checks passed.

## RCW4b — rc-live-2: fixed-limit Simple Fracture, attempt 2: INCOMPLETE
- **Turn 1** — “Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.”
  - Answer: “If the Simple Fracture benefit applies to Adrian's case “Jaw, Pelvis, Leg^, Ankle or Knee” (as you described: “Adrian broke his leg”), the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Public Officers Group Personal Accident - Summary of Benefits; it is an illustration from the document's terms, not a payment or an insurer's decision. The uploaded summary does not establish whether Adrian’s diagnosis meets that definition; it says the listed ”
  - Tools: resolve_person → note_facts → policies_for → person_benefits → search_passages → evaluate_benefit → final_answer; outcome final_answer; evidence e6, e11, e12
  - Time: accepted 0.0 s, answer saved 14.6 s, seen 14.7 s; model 13.2 s (upstream 13.1 s via the relay); 6 calls, 59867/588 tokens, US$0.00144
- All 0 checks passed.

## RCX — rc-live-2 control: an unlisted case (a wrist) and who to contact: INCOMPLETE
- **Turn 1** — “Adrian fractured his wrist falling off his bicycle. What can we claim for it from his accident cover, and who should I contact?”
  - Answer: “Adrian’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022; this is the amount shown on that date, not confirmation of cover now. The Public Officers Group Personal Accident - Summary of Benefits (page 13) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg^, Ankle or Knee 50%. It lists no case for a wrist. The Other Fracture wording defines this ”
  - Tools: resolve_person → note_facts → policies_for → person_benefits → evaluate_benefit → search_passages → select_table_value → final_answer; outcome final_answer; evidence e4, e12, e6, e14, e19
  - Time: accepted 0.0 s, answer saved 13.6 s, seen 13.8 s; model 12.9 s (upstream 12.7 s via the relay); 6 calls, 59769/660 tokens, US$0.00157
- All 0 checks passed.

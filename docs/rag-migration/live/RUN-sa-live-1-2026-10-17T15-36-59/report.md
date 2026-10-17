# Live model run sa-live-1 — 2026-10-17T15:36:59.314Z

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
| SAb structured: closed tibia -> corrected to hip (attempt 2) | NO ANSWER |  | 1 | - | 0.0 s | 0 | 0/0 | US$0.00000 |
| SAp structured: closed tibia -> corrected to hip (fresh paraphrase) | NO ANSWER |  | 1 | - | 0.0 s | 0 | 0/0 | US$0.00000 |
| SBa structured: uncertain hip / tibia -> one question -> tibia (attempt 1) | NO ANSWER |  | 1 | - | 0.0 s | 0 | 0/0 | US$0.00000 |
| SBb structured: uncertain hip / tibia -> one question -> tibia (attempt 2) | NO ANSWER |  | 1 | - | 0.0 s | 0 | 0/0 | US$0.00000 |
| SBp structured: uncertain hip / tibia (fresh paraphrase) | NO ANSWER |  | 1 | - | 0.0 s | 0 | 0/0 | US$0.00000 |
| SC structured: Simple versus Other Fracture comparison | NO ANSWER |  | 1 | - | 0.0 s | 0 | 0/0 | US$0.00000 |
| SD structured: the death allowance | NO ANSWER |  | 1 | - | 0.0 s | 0 | 0/0 | US$0.00000 |
| SE structured: person switch to Grace | NO ANSWER |  | 1 | - | 0.0 s | 0 | 0/0 | US$0.00000 |

## SAa — structured: closed tibia -> corrected to hip (attempt 1): NO ANSWER
- **Turn 1** — “Daniel fell off a ladder at home and fractured his tibia. It's a closed fracture. What would his accident cover pay?”
  - Answer: POST /api/chat 404: No household
  - Time: accepted -, answer saved -, seen -; model - (upstream - via the relay); 0 calls, 0/0 tokens, -

## SAb — structured: closed tibia -> corrected to hip (attempt 2): NO ANSWER
- **Turn 1** — “Daniel fell off a ladder at home and fractured his tibia. It's a closed fracture. What would his accident cover pay?”
  - Answer: POST /api/chat 404: No household
  - Time: accepted -, answer saved -, seen -; model - (upstream - via the relay); 0 calls, 0/0 tokens, -

## SAp — structured: closed tibia -> corrected to hip (fresh paraphrase): NO ANSWER
- **Turn 1** — “My husband Daniel slipped on wet stairs at home and the doctor says he has a closed break of the shin bone. What could his personal accident cover pay out for that?”
  - Answer: POST /api/chat 404: No household
  - Time: accepted -, answer saved -, seen -; model - (upstream - via the relay); 0 calls, 0/0 tokens, -

## SBa — structured: uncertain hip / tibia -> one question -> tibia (attempt 1): NO ANSWER
- **Turn 1** — “Daniel fell and the doctor says he fractured his hip, or possibly his tibia - they are not sure yet. It is a closed fracture from an accident at home. What would his accident cover pay?”
  - Answer: POST /api/chat 404: No household
  - Time: accepted -, answer saved -, seen -; model - (upstream - via the relay); 0 calls, 0/0 tokens, -

## SBb — structured: uncertain hip / tibia -> one question -> tibia (attempt 2): NO ANSWER
- **Turn 1** — “Daniel fell and the doctor says he fractured his hip, or possibly his tibia - they are not sure yet. It is a closed fracture from an accident at home. What would his accident cover pay?”
  - Answer: POST /api/chat 404: No household
  - Time: accepted -, answer saved -, seen -; model - (upstream - via the relay); 0 calls, 0/0 tokens, -

## SBp — structured: uncertain hip / tibia (fresh paraphrase): NO ANSWER
- **Turn 1** — “Daniel hurt himself in a fall at home last night. The hospital thinks he broke either his hip or the lower leg bone, they are still waiting on scans, and it looks like a closed fracture. What would his accident insurance give him?”
  - Answer: POST /api/chat 404: No household
  - Time: accepted -, answer saved -, seen -; model - (upstream - via the relay); 0 calls, 0/0 tokens, -

## SC — structured: Simple versus Other Fracture comparison: NO ANSWER
- **Turn 1** — “Can you compare what the Simple Fracture benefit and the Other Fracture benefit would pay if Daniel broke his leg?”
  - Answer: POST /api/chat 404: No household
  - Time: accepted -, answer saved -, seen -; model - (upstream - via the relay); 0 calls, 0/0 tokens, -

## SD — structured: the death allowance: NO ANSWER
- **Turn 1** — “If Daniel died in an accident, what would our booklet pay towards his funeral, and what documents would the insurer want from us?”
  - Answer: POST /api/chat 404: No household
  - Time: accepted -, answer saved -, seen -; model - (upstream - via the relay); 0 calls, 0/0 tokens, -

## SE — structured: person switch to Grace: NO ANSWER
- **Turn 1** — “Daniel fractured his tibia in an accident, a closed fracture. What would his accident cover pay?”
  - Answer: POST /api/chat 404: No household
  - Time: accepted -, answer saved -, seen -; model - (upstream - via the relay); 0 calls, 0/0 tokens, -

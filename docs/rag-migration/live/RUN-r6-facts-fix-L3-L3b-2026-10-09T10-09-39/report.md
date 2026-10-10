# Live model run r6-facts-fix-L3-L3b — 2026-10-09T10:09:39.517Z

- Tested code: `d97131c60b14b51039e15b746ff7b384512d9544`; run request commit: `0e6cb1f159ede81f9d71d9c63ee77f03255fd132`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`openai:gpt-6-luna`, NARRATION_MODEL=`openai:gpt-6-luna`, READING_MODEL=`openai:gpt-6-luna`; provider-reported: `gpt-6-luna`
- Request settings actually sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Model availability check (GET /v1/models/<model>, free): 200 id `gpt-6-luna`

| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |
|---|---|---|---|---|---|---|---|
| 1 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 4659 / 17 (0, 0) | US$0.00200 | US$0.00047 | 2.3 s |
| 2 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 4770 / 81 (4533, 0) | US$0.00202 | US$0.00011 | 2.3 s |
| 3 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 4954 / 116 (4644, 0) | US$0.00206 | US$0.00014 | 2.7 s |
| 4 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 8598 / 76 (4828, 0) | US$0.00258 | US$0.00046 | 1.8 s |
| 5 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 8951 / 173 (8472, 0) | US$0.00264 | US$0.00022 | 2.2 s |
| 6 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 4933 / 17 (0, 0) | US$0.00204 | US$0.00050 | 1.6 s |
| 7 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 5044 / 43 (4807, 0) | US$0.00207 | US$0.00009 | 3.1 s |
| 8 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 6820 / 94 (4918, 0) | US$0.00233 | US$0.00029 | 1.9 s |
| 9 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 7812 / 110 (6694, 0) | US$0.00247 | US$0.00023 | 1.6 s |
| 10 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 4997 / 69 (4807, 0) | US$0.00206 | US$0.00010 | 1.9 s |
| 11 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 5210 / 110 (4871, 0) | US$0.00209 | US$0.00014 | 3.1 s |
| 12 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 9050 / 76 (5084, 0) | US$0.00264 | US$0.00049 | 1.6 s |
| 13 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 9403 / 219 (8924, 0) | US$0.00270 | US$0.00025 | 3.0 s |
| 14 | L3b t1 | gpt-6-luna → gpt-6-luna | 200 | 4676 / 18 (4517, 0) | US$0.00200 | US$0.00007 | 1.3 s |
| 15 | L3b t1 | gpt-6-luna → gpt-6-luna | 200 | 4790 / 92 (4550, 0) | US$0.00203 | US$0.00012 | 1.8 s |
| 16 | L3b t1 | gpt-6-luna → gpt-6-luna | 200 | 5041 / 113 (4664, 0) | US$0.00207 | US$0.00014 | 2.3 s |
| 17 | L3b t1 | gpt-6-luna → gpt-6-luna | 200 | 9540 / 140 (4915, 0) | US$0.00271 | US$0.00058 | 3.5 s |
| 18 | L3b t1 | gpt-6-luna → gpt-6-luna | 200 | 9711 / 176 (9414, 0) | US$0.00274 | US$0.00021 | 2.6 s |
| 19 | L3b t2 | gpt-6-luna → gpt-6-luna | 200 | 4943 / 67 (0, 0) | US$0.00205 | US$0.00053 | 1.3 s |
| 20 | L3b t2 | gpt-6-luna → gpt-6-luna | 200 | 5166 / 137 (4817, 0) | US$0.00209 | US$0.00015 | 2.1 s |

- Mode: direct (GitHub Actions; OpenAI called directly with the repository secret, never logged)
- Code: `0e6cb1f` (tree `f2d6de5c`); served build `kotOJftEOY3aG0ifnxMaE`
- Model requested: `openai:gpt-6-luna`; provider-reported: `gpt-6-luna`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Prompt `rag2-loop-v6`: system sha256 `906cc3f798d5`, tool schema sha256 `d85a1e5e943e` (10 tools); what was sent matches the source
- Budget: run cap US$0.46538; spent US$0.00529 over 20 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| L3 Broken arm: cause decides cover; side question about the speaker; back to the pending question | PASS |  | 3 | 11.9 s | 30.9 s | 13 | 85201/1201 | US$0.00349 |
| L3b Dislocated elbow: a benefit whose condition is evidence (X-ray or MRI), stated conditionally | PASS |  | 2 | 12.4 s | 17.1 s | 7 | 43867/743 | US$0.00180 |

## L3 — Broken arm: cause decides cover; side question about the speaker; back to the pending question: PASS
- **Turn 1** — “Kai broke his arm yesterday. Can we claim for it?”
  - Answer: “I’m sorry Kai was hurt. Kai’s SunHaven Family Accident Guard lists a Fracture benefit (per fracture) of S$750 for a child, payable once per fracture confirmed by X-ray and certified by a registered medical practitioner, only for what the policy covers, which depends on how it happened: “This policy covers Bodily Injury caused solely and directly by an Accident. A fracture caused by sickness, disease or a gradual or degenerative condition (such as osteoporosis or a bone tumour) is not covered.” H”
  - Tools: resolve_person → note_facts → policies_for → search_passages → select_table_value → ask_user; outcome ask_user; evidence e7, e5, e12
  - Time: accepted 0.3 s, answer saved 11.9 s, seen 11.9 s; model 11.3 s (upstream 11.3 s); 5 calls, 31932/463 tokens, US$0.00140
- **Turn 2** — “Before that, quick question: what is my deductible on my KestrelShield plan?”
  - Answer: “Daniel’s KestrelShield Integrated Plan lists a deductible of S$3,500 per policy year for a private hospital. When you’re ready, here is the question I was on. How did Kai break his arm?”
  - Tools: resolve_person → policies_for → search_passages → final_answer; outcome final_answer; evidence e20
  - Time: accepted 0.0 s, answer saved 8.3 s, seen 8.3 s; model 8.2 s (upstream 8.2 s); 4 calls, 24609/264 tokens, US$0.00112
- **Turn 3** — “He fell off his bicycle at the park.”
  - Answer: “Kai’s SunHaven Family Accident Guard covers bodily injury caused solely and directly by an accident, and says accidents are covered anywhere in the world. Its Fracture benefit (per fracture) lists S$750 for a child, payable once per fracture confirmed by X-ray and certified by a registered medical practitioner.”
  - Tools: note_facts → policies_for → search_passages → select_table_value → final_answer; outcome final_answer; evidence e7, e24, e5, e12
  - Time: accepted 0.0 s, answer saved 10.5 s, seen 10.6 s; model 9.6 s (upstream 9.6 s); 4 calls, 28660/474 tokens, US$0.00097
- All 46 checks passed.

## L3b — Dislocated elbow: a benefit whose condition is evidence (X-ray or MRI), stated conditionally: PASS
- **Turn 1** — “Mei landed badly on her elbow at gymnastics this afternoon and the clinic says it's dislocated. Is that something her PlayWell plan helps with?”
  - Answer: “I’m sorry Mei hurt herself. Mei’s PlayWell plan lists a Dislocation benefit (per dislocation) of S$600, payable once per dislocation diagnosed by a registered medical practitioner and confirmed by X-ray or MRI. Has a registered medical practitioner diagnosed the dislocation and confirmed it by X-ray or MRI?”
  - Tools: resolve_person → note_facts → policies_for → search_passages → ask_user✗ → ask_user; outcome ask_user; evidence e8, e7
  - Time: accepted 0.0 s, answer saved 12.4 s, seen 12.4 s; model 11.5 s (upstream 11.5 s); 5 calls, 33758/539 tokens, US$0.00112
- **Turn 2** — “Yes, the doctor at the clinic did an X-ray and it showed the dislocation.”
  - Answer: “I couldn’t confirm an answer to that from your documents.”
  - Tools: note_facts → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 4.5 s, seen 4.7 s; model 3.5 s (upstream 3.5 s); 2 calls, 10109/204 tokens, US$0.00068
- All 27 checks passed.

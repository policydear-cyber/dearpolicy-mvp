# Live model run r6-L3-L5-plus-paraphrases — 2026-10-09T08:27:16.993Z

- Tested code: `d80664c5430c02c84d59de1cb3d9523ac592c0cd`; run request commit: `9a4d6ef47cd90f69b717255ab2766c69cd981a67`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`openai:gpt-6-luna`, NARRATION_MODEL=`openai:gpt-6-luna`, READING_MODEL=`openai:gpt-6-luna`; provider-reported: `gpt-6-luna`
- Request settings actually sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Model availability check (GET /v1/models/<model>, free): 200 id `gpt-6-luna`

| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |
|---|---|---|---|---|---|---|---|
| 1 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 4582 / 17 (0, 0) | US$0.00198 | US$0.00047 | 2.1 s |
| 2 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 4693 / 81 (4456, 0) | US$0.00201 | US$0.00011 | 1.8 s |
| 3 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 4877 / 42 (4567, 0) | US$0.00204 | US$0.00010 | 1.3 s |
| 4 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 5855 / 215 (4751, 0) | US$0.00218 | US$0.00027 | 2.6 s |
| 5 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 10762 / 76 (5729, 0) | US$0.00294 | US$0.00060 | 1.9 s |
| 6 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 11115 / 173 (10636, 0) | US$0.00300 | US$0.00024 | 2.3 s |
| 7 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 4800 / 17 (0, 0) | US$0.00202 | US$0.00049 | 1.0 s |
| 8 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 4911 / 102 (4674, 0) | US$0.00204 | US$0.00012 | 2.8 s |
| 9 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 7781 / 109 (4785, 0) | US$0.00240 | US$0.00040 | 1.6 s |
| 10 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 4863 / 69 (4674, 0) | US$0.00203 | US$0.00010 | 1.2 s |
| 11 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 5076 / 58 (4737, 0) | US$0.00207 | US$0.00011 | 1.3 s |
| 12 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 6638 / 76 (4950, 0) | US$0.00234 | US$0.00026 | 1.7 s |
| 13 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 6991 / 179 (6512, 0) | US$0.00240 | US$0.00020 | 2.2 s |
| 14 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 4616 / 18 (4440, 0) | US$0.00199 | US$0.00007 | 1.1 s |
| 15 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 4730 / 115 (4490, 0) | US$0.00201 | US$0.00013 | 1.7 s |
| 16 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 4984 / 40 (4604, 0) | US$0.00205 | US$0.00010 | 2.1 s |
| 17 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 6372 / 161 (4858, 0) | US$0.00225 | US$0.00028 | 3.4 s |
| 18 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 8552 / 155 (6246, 0) | US$0.00257 | US$0.00037 | 2.2 s |
| 19 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 9205 / 134 (8426, 0) | US$0.00267 | US$0.00023 | 1.9 s |
| 20 | L5 t1 | gpt-6-luna → gpt-6-luna | 200 | 4585 / 17 (4440, 0) | US$0.00198 | US$0.00007 | 1.4 s |
| 21 | L5 t1 | gpt-6-luna → gpt-6-luna | 200 | 4696 / 42 (4459, 0) | US$0.00201 | US$0.00009 | 1.1 s |
| 22 | L5 t1 | gpt-6-luna → gpt-6-luna | 200 | 6471 / 146 (4570, 0) | US$0.00227 | US$0.00031 | 1.9 s |
| 23 | L5 t1 | gpt-6-luna → gpt-6-luna | 200 | 7981 / 123 (6345, 0) | US$0.00246 | US$0.00029 | 1.8 s |
| 24 | L3b t1 | gpt-6-luna → gpt-6-luna | 200 | 4599 / 18 (4440, 0) | US$0.00199 | US$0.00007 | 1.2 s |
| 25 | L3b t1 | gpt-6-luna → gpt-6-luna | 200 | 4713 / 89 (4473, 0) | US$0.00201 | US$0.00011 | 1.3 s |
| 26 | L3b t1 | gpt-6-luna → gpt-6-luna | 200 | 4958 / 45 (4587, 0) | US$0.00206 | US$0.00011 | 1.4 s |
| 27 | L3b t1 | gpt-6-luna → gpt-6-luna | 200 | 6351 / 159 (4832, 0) | US$0.00226 | US$0.00028 | 1.9 s |
| 28 | L3b t1 | gpt-6-luna → gpt-6-luna | 200 | 7892 / 171 (6225, 0) | US$0.00250 | US$0.00031 | 2.1 s |
| 29 | L3b t2 | gpt-6-luna → gpt-6-luna | 200 | 4847 / 69 (0, 0) | US$0.00203 | US$0.00052 | 1.2 s |
| 30 | L3b t2 | gpt-6-luna → gpt-6-luna | 200 | 5073 / 58 (4721, 0) | US$0.00207 | US$0.00011 | 1.8 s |
| 31 | L3b t2 | gpt-6-luna → gpt-6-luna | 200 | 6525 / 113 (4947, 0) | US$0.00233 | US$0.00026 | 2.1 s |
| 32 | L4b t1 | gpt-6-luna → gpt-6-luna | 200 | 4617 / 17 (4440, 0) | US$0.00199 | US$0.00007 | 1.0 s |
| 33 | L4b t1 | gpt-6-luna → gpt-6-luna | 200 | 4731 / 113 (4491, 0) | US$0.00201 | US$0.00013 | 1.5 s |
| 34 | L4b t1 | gpt-6-luna → gpt-6-luna | 200 | 4981 / 122 (4605, 0) | US$0.00205 | US$0.00014 | 1.6 s |
| 35 | L4b t1 | gpt-6-luna → gpt-6-luna | 200 | 8100 / 79 (4855, 0) | US$0.00250 | US$0.00041 | 1.7 s |
| 36 | L4b t1 | gpt-6-luna → gpt-6-luna | 200 | 8623 / 166 (7974, 0) | US$0.00258 | US$0.00023 | 1.8 s |
| 37 | L4b t1 | gpt-6-luna → gpt-6-luna | 200 | 9300 / 254 (8497, 0) | US$0.00268 | US$0.00029 | 2.6 s |
| 38 | L5b t1 | gpt-6-luna → gpt-6-luna | 200 | 4592 / 17 (4440, 0) | US$0.00199 | US$0.00007 | 1.0 s |
| 39 | L5b t1 | gpt-6-luna → gpt-6-luna | 200 | 4703 / 55 (4466, 0) | US$0.00201 | US$0.00010 | 1.1 s |
| 40 | L5b t1 | gpt-6-luna → gpt-6-luna | 200 | 6491 / 146 (4577, 0) | US$0.00227 | US$0.00031 | 2.3 s |
| 41 | L5b t1 | gpt-6-luna → gpt-6-luna | 200 | 8291 / 136 (6365, 0) | US$0.00250 | US$0.00032 | 1.6 s |

- Mode: direct (GitHub Actions; OpenAI called directly with the repository secret, never logged)
- Code: `9a4d6ef` (tree `5a667278`); served build `mQg4hSvYk9F5JgGbTFAfw`
- Model requested: `openai:gpt-6-luna`; provider-reported: `gpt-6-luna`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Prompt `rag2-loop-v5`: system sha256 `00678fb15151`, tool schema sha256 `d85a1e5e943e` (10 tools); what was sent matches the source
- Budget: run cap US$0.49156; spent US$0.00924 over 41 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| L3 Broken arm: cause decides cover; side question about the speaker; back to the pending question | FAIL | model reasoning-tool selection | 3 | 12.6 s | 27.2 s | 13 | 82944/1214 | US$0.00346 |
| L4 Hospital cash: admission and discharge dates and times in one message | FAIL | model reasoning-tool selection | 1 | 13.5 s | 13.7 s | 6 | 38459/623 | US$0.00118 |
| L5 An endorsement changes a limit | PASS |  | 1 | 7.1 s | 7.3 s | 4 | 23733/328 | US$0.00075 |
| L3b Dislocated elbow: a benefit whose condition is evidence (X-ray or MRI), stated conditionally | PASS |  | 2 | 9.1 s | 15.5 s | 8 | 44958/722 | US$0.00178 |
| L4b Hospital cash for an adult: both times in one message, a rate row with a yearly cap | PASS |  | 1 | 11.3 s | 11.4 s | 6 | 40352/751 | US$0.00127 |
| L5b An endorsement question asked as 'has my limit changed?' | FAIL | model reasoning-tool selection | 1 | 7.1 s | 7.2 s | 4 | 24077/354 | US$0.00080 |

## L3 — Broken arm: cause decides cover; side question about the speaker; back to the pending question: FAIL (model reasoning-tool selection)
- **Turn 1** — “Kai broke his arm yesterday. Can we claim for it?”
  - Answer: “I’m sorry Kai was hurt. Kai’s SunHaven Family Accident Guard lists a Fracture benefit (per fracture) of an amount that is only shown after claim evidence has been reviewed for a child, payable once per fracture confirmed by X-ray and certified by a registered medical practitioner. How did Kai break his arm?”
  - Tools: resolve_person → note_facts → policies_for → search_passages → search_passages → search_passages → select_table_value → ask_user; outcome ask_user; evidence e7, e5, e14
  - Time: accepted 0.3 s, answer saved 12.6 s, seen 12.6 s; model 12.0 s (upstream 12.0 s); 6 calls, 41884/604 tokens, US$0.00178
- **Turn 2** — “Before that, quick question: what is my deductible on my KestrelShield plan?”
  - Answer: “Your KestrelShield Integrated Plan lists a deductible of S$3,500 per policy year for private hospital treatment. When you’re ready, here is the question I was on. How did Kai break his arm?”
  - Tools: resolve_person → policies_for → search_passages → final_answer; outcome final_answer; evidence e21
  - Time: accepted 0.0 s, answer saved 6.6 s, seen 6.8 s; model 5.5 s (upstream 5.5 s); 3 calls, 17492/228 tokens, US$0.00101
- **Turn 3** — “He fell off his bicycle at the park.”
  - Answer: “Thanks for explaining how it happened. Kai’s Fracture benefit (per fracture) is listed as an amount that is only shown after claim evidence has been reviewed for a child, payable once per fracture confirmed by X-ray and certified by a registered medical practitioner. Has Kai’s arm fracture been confirmed by X-ray and certified by a registered medical practitioner?”
  - Tools: note_facts → search_passages → select_table_value → ask_user; outcome ask_user; evidence e5, e7, e14
  - Time: accepted 0.0 s, answer saved 7.6 s, seen 7.8 s; model 6.4 s (upstream 6.4 s); 4 calls, 23568/382 tokens, US$0.00067
- Failed checks:
  - t1 [model reasoning-tool selection] no money figure: shows 750

## L4 — Hospital cash: admission and discharge dates and times in one message: FAIL (model reasoning-tool selection)
- **Turn 1** — “Mei was admitted to hospital on 3 Sep 2026 at 10:15 pm and discharged on 6 Sep 2026 at 9:30 am. How much hospital cash can we claim from CareDay?”
  - Answer: “For Mei, CareDay lists Hospital cash at S$60 for each complete 24 hours, up to 90 periods per year (page 1), and the indicative estimate for the dates and times you gave is S$120, assuming at least 2 of the 90 complete 24-hour periods are still available this year.”
  - Tools: resolve_person → note_facts → policies_for → search_passages → select_table_value → calculate → final_answer; outcome final_answer; evidence e12, e13
  - Time: accepted 0.0 s, answer saved 13.5 s, seen 13.7 s; model 12.3 s (upstream 12.3 s); 6 calls, 38459/623 tokens, US$0.00118
- Failed checks:
  - t1 [model reasoning-tool selection] cites CAREDAY p2 "Hospital cash is payable for each comple": retrieved but not cited

## L5 — An endorsement changes a limit: PASS
- **Turn 1** — “What is the annual claim limit on my KestrelShield plan now?”
  - Answer: “Daniel, your KestrelShield Integrated Plan’s annual claim limit is S$1,500,000, effective 1 July 2026 under Endorsement No. 1 (page 1).”
  - Tools: resolve_person → policies_for → search_passages → read_page → final_answer; outcome final_answer; evidence e10, e12
  - Time: accepted 0.0 s, answer saved 7.1 s, seen 7.3 s; model 6.2 s (upstream 6.2 s); 4 calls, 23733/328 tokens, US$0.00075
- All 13 checks passed.

## L3b — Dislocated elbow: a benefit whose condition is evidence (X-ray or MRI), stated conditionally: PASS
- **Turn 1** — “Mei landed badly on her elbow at gymnastics this afternoon and the clinic says it's dislocated. Is that something her PlayWell plan helps with?”
  - Answer: “I’m sorry Mei hurt herself. Mei’s PlayWell plan lists a Dislocation benefit of an amount that is only shown after claim evidence has been reviewed per dislocation, payable once when diagnosed by a registered medical practitioner and confirmed by X-ray or MRI. Was the dislocation confirmed by X-ray or MRI?”
  - Tools: resolve_person → note_facts → policies_for → search_passages → select_table_value → ask_user; outcome ask_user; evidence e9, e11
  - Time: accepted 0.0 s, answer saved 9.1 s, seen 9.3 s; model 8.0 s (upstream 7.9 s); 5 calls, 28513/482 tokens, US$0.00088
- **Turn 2** — “Yes, the doctor at the clinic did an X-ray and it showed the dislocation.”
  - Answer: “Mei’s PlayWell plan lists a Dislocation benefit of S$600 per dislocation, payable once when diagnosed by a registered medical practitioner and confirmed by X-ray or MRI; you said the clinic doctor’s X-ray showed the dislocation.”
  - Tools: note_facts → search_passages → final_answer; outcome final_answer; evidence e8, e9
  - Time: accepted 0.0 s, answer saved 6.1 s, seen 6.2 s; model 5.1 s (upstream 5.1 s); 3 calls, 16445/240 tokens, US$0.00089
- All 25 checks passed.

## L4b — Hospital cash for an adult: both times in one message, a rate row with a yearly cap: PASS
- **Turn 1** — “Grace got warded on 14 September 2026 at 9.50pm and went home on 18 September 2026 at 8.20am. What does CareDay give her in hospital cash for that stay?”
  - Answer: “For Grace, CareDay’s “Hospital cash (each complete 24 hours, max 90 per year)” is S$100 per complete 24 hours for an insured adult, and the indicative estimate for her stated stay is S$300, based on three complete 24-hour periods, assuming at least 3 of the 90 complete 24-hour periods are still available this year. The policy counts complete 24-hour periods from admission and excludes any shorter period; admission and discharge times are taken from the hospital discharge summary.”
  - Tools: resolve_person → note_facts → policies_for → search_passages → select_table_value → calculate → final_answer; outcome final_answer; evidence e11, e12, e8
  - Time: accepted 0.0 s, answer saved 11.3 s, seen 11.4 s; model 10.2 s (upstream 10.2 s); 6 calls, 40352/751 tokens, US$0.00127
- All 22 checks passed.

## L5b — An endorsement question asked as 'has my limit changed?': FAIL (model reasoning-tool selection)
- **Turn 1** — “Did the endorsement on my KestrelShield policy change my yearly claim limit? What is it at today?”
  - Answer: “I couldn’t confirm one of the figures against the cited page of your documents.”
  - Tools: resolve_person → policies_for → search_passages → read_page → final_answer; outcome final_answer; evidence e9, e11
  - Time: accepted 0.0 s, answer saved 7.1 s, seen 7.2 s; model 6.0 s (upstream 6.0 s); 4 calls, 24077/354 tokens, US$0.00080
- Failed checks:
  - t1 [model reasoning-tool selection] shows S$1,500,000: missing; visible figures: none

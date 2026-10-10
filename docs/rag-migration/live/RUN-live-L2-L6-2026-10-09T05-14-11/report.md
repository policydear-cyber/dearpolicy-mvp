# Live model run live-L2-L6 — 2026-10-09T05:14:11.552Z

- Tested code: `7095559e88e52ac076e90cfe9832bf2af6e92f17`; run request commit: `3bb5534a975dc171911eb98d6c6d2e8134348800`
- Models requested: CHAT_MODEL=`openai:gpt-6-luna`, JUDGEMENT_MODEL=`openai:gpt-6-luna`, NARRATION_MODEL=`openai:gpt-6-luna`, READING_MODEL=`openai:gpt-6-luna`; provider-reported: `gpt-6-luna`
- Request settings actually sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Model availability check (GET /v1/models/<model>, free): 200 id `gpt-6-luna`

| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |
|---|---|---|---|---|---|---|---|
| 1 | L2 t1 | gpt-6-luna → gpt-6-luna | 200 | 4000 / 17 (3855, 0) | US$0.00186 | US$0.00006 | 2.0 s |
| 2 | L2 t1 | gpt-6-luna → gpt-6-luna | 200 | 4111 / 42 (3874, 0) | US$0.00188 | US$0.00008 | 1.7 s |
| 3 | L2 t1 | gpt-6-luna → gpt-6-luna | 200 | 5089 / 156 (3985, 0) | US$0.00203 | US$0.00023 | 1.8 s |
| 4 | L2 t1 | gpt-6-luna → gpt-6-luna | 200 | 6968 / 109 (4963, 0) | US$0.00231 | US$0.00030 | 2.0 s |
| 5 | L2 t2 | gpt-6-luna → gpt-6-luna | 200 | 4083 / 17 (0, 0) | US$0.00187 | US$0.00042 | 1.1 s |
| 6 | L2 t2 | gpt-6-luna → gpt-6-luna | 200 | 4197 / 106 (3957, 0) | US$0.00190 | US$0.00012 | 2.0 s |
| 7 | L2 t2 | gpt-6-luna → gpt-6-luna | 200 | 7609 / 76 (4071, 0) | US$0.00239 | US$0.00043 | 1.8 s |
| 8 | L2 t2 | gpt-6-luna → gpt-6-luna | 200 | 7956 / 117 (7483, 0) | US$0.00245 | US$0.00018 | 2.0 s |
| 9 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 3997 / 17 (3855, 0) | US$0.00186 | US$0.00006 | 1.2 s |
| 10 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 4108 / 81 (3871, 0) | US$0.00188 | US$0.00010 | 1.3 s |
| 11 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 4292 / 111 (3982, 0) | US$0.00192 | US$0.00013 | 2.2 s |
| 12 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 7145 / 76 (4166, 0) | US$0.00232 | US$0.00038 | 1.5 s |
| 13 | L3 t1 | gpt-6-luna → gpt-6-luna | 200 | 7257 / 66 (7019, 0) | US$0.00235 | US$0.00013 | 1.4 s |
| 14 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 4173 / 17 (0, 0) | US$0.00189 | US$0.00043 | 1.2 s |
| 15 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 4284 / 43 (4047, 0) | US$0.00191 | US$0.00009 | 1.3 s |
| 16 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 5628 / 75 (4158, 0) | US$0.00211 | US$0.00023 | 1.6 s |
| 17 | L3 t2 | gpt-6-luna → gpt-6-luna | 200 | 6312 / 94 (5502, 0) | US$0.00221 | US$0.00018 | 1.6 s |
| 18 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 4241 / 69 (4047, 0) | US$0.00190 | US$0.00009 | 1.7 s |
| 19 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 4454 / 40 (4115, 0) | US$0.00194 | US$0.00010 | 1.3 s |
| 20 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 5430 / 167 (4328, 0) | US$0.00208 | US$0.00024 | 2.0 s |
| 21 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 8316 / 247 (5304, 0) | US$0.00252 | US$0.00048 | 2.3 s |
| 22 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 9574 / 83 (8190, 0) | US$0.00270 | US$0.00026 | 1.9 s |
| 23 | L3 t3 | gpt-6-luna → gpt-6-luna | 200 | 9693 / 73 (9448, 0) | US$0.00273 | US$0.00016 | 1.5 s |
| 24 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 4031 / 18 (3855, 0) | US$0.00186 | US$0.00007 | 1.0 s |
| 25 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 4145 / 123 (3905, 0) | US$0.00189 | US$0.00012 | 1.8 s |
| 26 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 4415 / 40 (4019, 0) | US$0.00193 | US$0.00010 | 1.2 s |
| 27 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 5396 / 163 (4289, 0) | US$0.00207 | US$0.00024 | 2.7 s |
| 28 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 7312 / 168 (5270, 0) | US$0.00235 | US$0.00034 | 2.0 s |
| 29 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 7512 / 79 (7186, 0) | US$0.00239 | US$0.00014 | 1.6 s |
| 30 | L4 t1 | gpt-6-luna → gpt-6-luna | 200 | 8030 / 191 (7386, 0) | US$0.00247 | US$0.00023 | 2.7 s |
| 31 | L5 t1 | gpt-6-luna → gpt-6-luna | 200 | 4000 / 17 (3855, 0) | US$0.00186 | US$0.00006 | 1.3 s |
| 32 | L5 t1 | gpt-6-luna → gpt-6-luna | 200 | 4111 / 45 (3874, 0) | US$0.00188 | US$0.00008 | 1.5 s |
| 33 | L5 t1 | gpt-6-luna → gpt-6-luna | 200 | 5457 / 147 (3985, 0) | US$0.00208 | US$0.00026 | 3.2 s |
| 34 | L5 t1 | gpt-6-luna → gpt-6-luna | 200 | 6969 / 98 (5331, 0) | US$0.00227 | US$0.00027 | 8.8 s |
| 35 | L6 t1 | gpt-6-luna → gpt-6-luna | 200 | 4009 / 31 (3855, 0) | US$0.00186 | US$0.00007 | 3.8 s |
| 36 | L6 t1 | gpt-6-luna → gpt-6-luna | 200 | 6229 / 54 (3883, 0) | US$0.00222 | US$0.00030 | 2.2 s |
| 37 | L6 t1 | gpt-6-luna → gpt-6-luna | 200 | 6924 / 84 (6103, 0) | US$0.00235 | US$0.00019 | 2.1 s |

- Mode: direct (GitHub Actions; OpenAI called directly with the repository secret, never logged)
- Code: `3bb5534` (tree `6531ba2f`); served build `z1j05-0SG1Yx3_vc3V-4M`
- Model requested: `openai:gpt-6-luna`; provider-reported: `gpt-6-luna`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true,"reasoning_effort":"none"}`
- Prompt `rag2-loop-v4`: system sha256 `b28f79008c52`, tool schema sha256 `e19e62af861c` (10 tools); what was sent matches the source
- Budget: run cap US$0.49889; spent US$0.00733 over 37 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| L2 Adult / Child table, then a person correction | PASS |  | 2 | 8.1 s | 16.3 s | 8 | 44013/640 | US$0.00182 |
| L3 Broken arm: cause decides cover; side question about the speaker; back to the pending question | FAIL | model reasoning-tool selection | 3 | 8.7 s | 27.8 s | 15 | 88904/1259 | US$0.00304 |
| L4 Hospital cash: admission and discharge dates and times in one message | FAIL | calculation | 1 | 14.1 s | 14.2 s | 7 | 40841/782 | US$0.00124 |
| L5 An endorsement changes a limit | FAIL | verification | 1 | 15.9 s | 16.0 s | 4 | 20537/307 | US$0.00067 |
| L6 A question the documents do not answer | PASS |  | 1 | 9.1 s | 9.3 s | 3 | 17162/169 | US$0.00056 |

## L2 — Adult / Child table, then a person correction: PASS
- **Turn 1** — “What does our SunHaven plan pay for accidental dental treatment for Kai?”
  - Answer: “Kai’s SunHaven “Accidental dental treatment (per accident)” benefit is up to S$400 per accident, payable for treatment to sound natural teeth damaged by an Accident (page 2).”
  - Tools: resolve_person → policies_for → search_passages → select_table_value → final_answer; outcome final_answer; evidence e6, e9
  - Time: accepted 0.4 s, answer saved 8.1 s, seen 8.2 s; model 7.5 s (upstream 7.5 s); 4 calls, 20168/324 tokens, US$0.00068
- **Turn 2** — “Sorry, I meant Grace, not Kai.”
  - Answer: “For Grace, SunHaven’s “Accidental dental treatment (per accident)” benefit pays treatment costs for sound natural teeth damaged by an Accident, up to S$800 per accident (page 1; treatment condition on page 2).”
  - Tools: resolve_person → policies_for → search_passages → select_table_value → final_answer; outcome final_answer; evidence e6, e15
  - Time: accepted 0.0 s, answer saved 8.0 s, seen 8.1 s; model 6.9 s (upstream 6.8 s); 4 calls, 23845/316 tokens, US$0.00115
- All 18 checks passed.

## L3 — Broken arm: cause decides cover; side question about the speaker; back to the pending question: FAIL (model reasoning-tool selection)
- **Turn 1** — “Kai broke his arm yesterday. Can we claim for it?”
  - Answer: “How did Kai break his arm? How did Kai break his arm?”
  - Tools: resolve_person → note_facts → policies_for → search_passages → ask_user✗ → ask_user; outcome ask_user; evidence e7
  - Time: accepted 0.0 s, answer saved 8.7 s, seen 8.8 s; model 7.6 s (upstream 7.6 s); 5 calls, 26799/351 tokens, US$0.00080
- **Turn 2** — “Before that, quick question: what is my deductible on my KestrelShield plan?”
  - Answer: “Your KestrelShield Integrated Plan schedule lists a deductible of S$3,500 per policy year for a private hospital (page 1). When you’re ready, here is the question I was on. How did Kai break his arm?”
  - Tools: resolve_person → policies_for → search_passages → final_answer; outcome final_answer; evidence e15
  - Time: accepted 0.0 s, answer saved 6.9 s, seen 7.0 s; model 5.8 s (upstream 5.8 s); 4 calls, 20397/229 tokens, US$0.00092
- **Turn 3** — “He fell off his bicycle at the park.”
  - Answer: “Has a registered medical practitioner confirmed Kai’s fracture by X-ray? Has a registered medical practitioner confirmed Kai’s fracture by X-ray?”
  - Tools: note_facts → policies_for → search_passages → search_passages → select_table_value → select_table_value → select_table_value → ask_user✗ → ask_user; outcome ask_user; evidence e5
  - Time: accepted 0.0 s, answer saved 11.9 s, seen 11.9 s; model 10.7 s (upstream 10.7 s); 6 calls, 41708/679 tokens, US$0.00132
- Failed checks:
  - t3 [model reasoning-tool selection] shows S$750: missing; visible figures: none
  - t3 [model reasoning-tool selection] figure bound to kai / SUNHAVEN / Child: bindings: none
  - t3 [model reasoning-tool selection] cites SUNHAVEN p1 "Fracture benefit (per fracture)": retrieved but not cited

## L4 — Hospital cash: admission and discharge dates and times in one message: FAIL (calculation)
- **Turn 1** — “Mei was admitted to hospital on 3 Sep 2026 at 10:15 pm and discharged on 6 Sep 2026 at 9:30 am. How much hospital cash can we claim from CareDay?”
  - Answer: “Mei’s CareDay Hospital Cash is S$60 for each complete 24-hour period, up to 90 periods per year (page 1), and the policy counts from admission, excluding any shorter period (page 2) [e9, e6].”
  - Tools: resolve_person → note_facts → policies_for → search_passages → select_table_value → calculate✗ → select_table_value → final_answer; outcome final_answer; evidence e9, e6
  - Time: accepted 0.0 s, answer saved 14.1 s, seen 14.2 s; model 13.0 s (upstream 13.0 s); 7 calls, 40841/782 tokens, US$0.00124
- Failed checks:
  - t1 [presentation] no internal ids visible: e9
  - t1 [verification] shows S$120: missing; visible figures: S$60 (dropped by the composer / gate)
  - t1 [calculation] saved hospital_cash calculation: no CalculationRecord saved (calculate called: 1x)

## L5 — An endorsement changes a limit: FAIL (verification)
- **Turn 1** — “What is the annual claim limit on my KestrelShield plan now?”
  - Answer: “I couldn’t confirm one of the figures against the cited page of your documents.”
  - Tools: resolve_person → policies_for → search_passages → read_page → final_answer; outcome final_answer; evidence e8, e10
  - Time: accepted 0.0 s, answer saved 15.9 s, seen 16.0 s; model 14.8 s (upstream 14.8 s); 4 calls, 20537/307 tokens, US$0.00067
- Failed checks:
  - t1 [verification] shows S$1,500,000: missing; visible figures: none (dropped by the composer / gate)

## L6 — A question the documents do not answer: PASS
- **Turn 1** — “If one of us is injured overseas, does SunHaven pay for emergency medical evacuation, and up to how much?”
  - Answer: “I couldn’t find an emergency medical evacuation benefit or an evacuation limit in the SunHaven documents available to me; the schedule lists accident medical expenses, fracture, accidental dental treatment and accidental death, but no evacuation benefit (page 1).”
  - Tools: search_passages → search_passages → final_answer; outcome final_answer; evidence e4
  - Time: accepted 0.0 s, answer saved 9.1 s, seen 9.3 s; model 8.1 s (upstream 8.1 s); 3 calls, 17162/169 tokens, US$0.00056
- All 6 checks passed.

# PLUMBING TEST — 2026-10-08T15:03:26.226Z

> **PLUMBING TEST — NOT MODEL RESULTS.** The "model" was a local fake OpenAI-compatible endpoint (scripts/rag2-live/plumbing_fake.py) behind the real relay and app path. Verdicts below only show that the harness, relay, accounting and checker work end to end.

- Code: `cfd4d40` (tree `a9cdc297`, **uncommitted changes**); served build `us0dKjrUwzUwttZZyE59s`
- Model requested: `openai:gpt-6-luna`; provider-reported: `plumbing-fake-not-a-model`; price on file US$0.1/M in, US$0.5/M out
- Request settings sent: `{"temperature":0,"max_completion_tokens":2000,"tool_choice":"required","parallel_tool_calls":true}`
- Prompt `rag2-loop-v3`: system sha256 `46d3514521bc`, tool schema sha256 `e19e62af861c` (10 tools); what the relay saw matches the source
- Budget: run cap US$0.50000; spent US$0.01328 over 19 calls; refused 0

| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |
|---|---|---|---|---|---|---|---|---|
| L1 Direct factual question | FAIL | model reasoning-tool selection | 1 | 0.8 s | 0.9 s | 3 | 13173/80 | US$0.00318 |
| L2 Adult / Child table, then a person correction | FAIL | model reasoning-tool selection | 2 | 0.9 s | 2.2 s | 4 | 25298/160 | US$0.00261 |
| L3 Broken arm: cause decides cover; side question about the speaker; back to the pending question | FAIL | retrieval | 3 | 0.9 s | 2.7 s | 6 | 35299/240 | US$0.00365 |
| L4 Hospital cash: admission and discharge dates and times in one message | FAIL | model reasoning-tool selection | 1 | 0.4 s | 0.5 s | 2 | 13187/80 | US$0.00136 |
| L5 An endorsement changes a limit | FAIL | model reasoning-tool selection | 1 | 0.9 s | 1.1 s | 2 | 12000/80 | US$0.00124 |
| L6 A question the documents do not answer | FAIL | model reasoning-tool selection | 1 | 0.9 s | 1.1 s | 2 | 12031/80 | US$0.00124 |

## L1 — Direct factual question: FAIL (model reasoning-tool selection)
- **Turn 1** — “How much ICU cash does the CareDay plan pay for Grace?”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.5 s, answer saved 0.8 s, seen 0.9 s; model 0.2 s (upstream via relay 0.0 s); 3 calls, 13173/80 tokens, US$0.00318
- Failed checks:
  - t1 [model reasoning-tool selection] shows S$200: missing; visible figures: none
  - t1 [model reasoning-tool selection] about grace: subject after the turn: none
  - t1 [model reasoning-tool selection] figure bound to grace / CAREDAY / Insured Adult: bindings: none
  - t1 [model reasoning-tool selection] cites CAREDAY p1 "ICU cash (each complete 24 hours, max 30": retrieved but not cited

## L2 — Adult / Child table, then a person correction: FAIL (model reasoning-tool selection)
- **Turn 1** — “What does our SunHaven plan pay for accidental dental treatment for Kai?”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.9 s, seen 1.1 s; model 0.1 s (upstream via relay 0.0 s); 2 calls, 12974/80 tokens, US$0.00134
- **Turn 2** — “Sorry, I meant Grace, not Kai.”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.9 s, seen 1.1 s; model 0.1 s (upstream via relay 0.0 s); 2 calls, 12324/80 tokens, US$0.00127
- Failed checks:
  - t1 [model reasoning-tool selection] shows S$400: missing; visible figures: none
  - t1 [model reasoning-tool selection] about kai: subject after the turn: none
  - t1 [model reasoning-tool selection] figure bound to kai / SUNHAVEN / Child: bindings: none
  - t1 [model reasoning-tool selection] cites SUNHAVEN p1 "Accidental dental treatment (per acciden": retrieved but not cited
  - t2 [model reasoning-tool selection] shows S$800: missing; visible figures: none
  - t2 [model reasoning-tool selection] about grace: subject after the turn: none
  - t2 [model reasoning-tool selection] figure bound to grace / SUNHAVEN / Adult: bindings: none
  - t2 [model reasoning-tool selection] cites SUNHAVEN p1 "Accidental dental treatment (per acciden": retrieved but not cited

## L3 — Broken arm: cause decides cover; side question about the speaker; back to the pending question: FAIL (retrieval)
- **Turn 1** — “Kai broke his arm yesterday. Can we claim for it?”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.9 s, seen 1.1 s; model 0.1 s (upstream via relay 0.0 s); 2 calls, 11979/80 tokens, US$0.00124
- **Turn 2** — “Before that, quick question: what is my deductible on my KestrelShield plan?”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.9 s, seen 1.1 s; model 0.1 s (upstream via relay 0.0 s); 2 calls, 12216/80 tokens, US$0.00126
- **Turn 3** — “He fell off his bicycle at the park.”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.4 s, seen 0.6 s; model 0.1 s (upstream via relay 0.0 s); 2 calls, 11104/80 tokens, US$0.00115
- Failed checks:
  - t1 [model reasoning-tool selection] asks how the arm was broken (accident or not): no question asked
  - t1 [model reasoning-tool selection] about kai: subject after the turn: none
  - t1 [retrieval] cites SUNHAVEN p2 "This policy covers Bodily Injury caused ": never retrieved
  - t2 [model reasoning-tool selection] shows S$3,500: missing; visible figures: none
  - t2 [model reasoning-tool selection] about kai: subject after the turn: none
  - t2 [model reasoning-tool selection] cites KESTREL p1 "Deductible (per policy year, private hos": retrieved but not cited
  - t2 [model reasoning-tool selection] puts the pending question back: not re-asked
  - t3 [retrieval] shows S$750: missing; visible figures: none
  - t3 [model reasoning-tool selection] about kai: subject after the turn: none
  - t3 [model reasoning-tool selection] figure bound to kai / SUNHAVEN / Child: bindings: none
  - t3 [retrieval] cites SUNHAVEN p1 "Fracture benefit (per fracture)": never retrieved
  - t3 [model reasoning-tool selection] records how\|cause\|happen in their words: facts: none

## L4 — Hospital cash: admission and discharge dates and times in one message: FAIL (model reasoning-tool selection)
- **Turn 1** — “Mei was admitted to hospital on 3 Sep 2026 at 10:15 pm and discharged on 6 Sep 2026 at 9:30 am. How much hospital cash can we claim from CareDay?”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.4 s, seen 0.5 s; model 0.0 s (upstream via relay 0.0 s); 2 calls, 13187/80 tokens, US$0.00136
- Failed checks:
  - t1 [model reasoning-tool selection] shows S$120: missing; visible figures: none
  - t1 [model reasoning-tool selection] about mei: subject after the turn: none
  - t1 [model reasoning-tool selection] cites CAREDAY p1 "Hospital cash (each complete 24 hours, m": retrieved but not cited
  - t1 [model reasoning-tool selection] cites CAREDAY p2 "Hospital cash is payable for each comple": retrieved but not cited
  - t1 [model reasoning-tool selection] saved hospital_cash calculation: no CalculationRecord saved (calculate called: 0x)

## L5 — An endorsement changes a limit: FAIL (model reasoning-tool selection)
- **Turn 1** — “What is the annual claim limit on my KestrelShield plan now?”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.9 s, seen 1.1 s; model 0.1 s (upstream via relay 0.0 s); 2 calls, 12000/80 tokens, US$0.00124
- Failed checks:
  - t1 [model reasoning-tool selection] shows S$1,500,000: missing; visible figures: none
  - t1 [model reasoning-tool selection] about daniel: subject after the turn: none
  - t1 [model reasoning-tool selection] figure bound to daniel / KESTREL_ENDT: bindings: none
  - t1 [model reasoning-tool selection] cites KESTREL_ENDT p1 "Annual claim limit S$1,000,000 S$1,500,0": retrieved but not cited

## L6 — A question the documents do not answer: FAIL (model reasoning-tool selection)
- **Turn 1** — “If one of us is injured overseas, does SunHaven pay for emergency medical evacuation, and up to how much?”
  - Answer: “PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.”
  - Tools: search_passages → final_answer; outcome final_answer; evidence none
  - Time: accepted 0.0 s, answer saved 0.9 s, seen 1.1 s; model 0.1 s (upstream via relay 0.0 s); 2 calls, 12031/80 tokens, US$0.00124
- Failed checks:
  - t1 [model reasoning-tool selection] says the documents do not say: PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.

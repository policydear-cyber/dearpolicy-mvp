# Reliable chat — dependency map

Path of one turn, with what this branch reuses, replaces and retires.

```
chat route ── lib/chat/workflow.ts ── lib/rag2/loop/hook.ts ── lib/rag2/loop/loop.ts (one loop, one route)
  model tools ─────────── lib/rag2/tools.ts (RAG_TOOLS) + loop/actions.ts (ask_user, record_fact, final_answer)
  benefit resolution ──── lib/rag2/benefit-records.ts  (NEW: contract A, server-resolved BenefitRecords)
                            └ reuses personBenefits view, calc/pct-rows.ts (percent tables), select_table_value
  calculation ─────────── lib/rag2/evaluate.ts (NEW: contract B, evaluate_benefit)
                            └ reuses calc/engine.ts runCalculate (lump_sum, hospital_cash + day-count), claim-record.ts
  statement verification  loop/statement-render.ts (NEW: server-written calculation / benefit_terms / contact text)
                            └ loop/compose.ts composeFinal (kept: evidence binding, gate, currency, trip, paperwork checks;
                              changed: independent statements, whole-statement drops)
  save ────────────────── calc records + facts (lib/claims/calc-record.ts, loop/facts.ts) — unchanged; dependsOn added
  UI ──────────────────── components (chat answer, next steps, calc record view) — unchanged
```

## Reuse
- `runCalculate` and every calculator (lump_sum, hospital_cash with the policy's day-count rule, bill_reimbursement).
- Evidence ids, the monetary gate, calculation records and their recompute check, fact recording / corrections.
- Filename preservation in `withoutUnconfirmedAddress` (PR #51) — untouched.

## Replace
| Before | After |
|---|---|
| Model passes `base_value_id` / `percent_value_id` / `rate_passage` to `calculate` (lump_sum, hospital_cash) | Model passes `benefit_id` + the household's words (`case` / `option_id`, admission / discharge) to `evaluate_benefit`; the server picks the row, base and rate. Model-facing `calculate` is bill_reimbursement only; lump_sum / hospital_cash are refused with the person's benefit ids. |
| Model writes the calculation / terms sentence; compose verifies figures after the fact | `kind: calculation` / `benefit_terms` statements are written by the server from the evaluation / record |
| Clause surgery (remove the failing clause, keep the rest) | Statements split into independent claims first; any failing statement is dropped whole |
| Contact advice in model prose (insurer checks) | `contact:<policy_id>` next step rendered by the server, only for the person's own linked document |

## Retired (call-site evidence: definition was the only reference)
`withoutOtherInsurers`, `withoutWindowClauses`, `withoutEndorsementClauses`, `verifiableParts`, `withoutClausesWhere`,
and the clause-keeping branch of `bareCurrencyClaim`.

## Not yet ported
Scripted suites written for the operand contract import `scripts/fixtures/legacy-contract.ts`, which sets
`DEARPOLICY_CHAT_CONTRACT=legacy-operands` (ignored when `NODE_ENV=production`). `grep -l fixtures/legacy-contract scripts`
lists them. Their server-side checks still run on the shared calculators; what they no longer exercise is the
model-facing schema production uses.

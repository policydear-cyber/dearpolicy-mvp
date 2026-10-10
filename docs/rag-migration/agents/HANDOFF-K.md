# Agent K -- calculation contract: notes for the coordinator / agent C

## Needs merging outside K's files
1. `lib/rag2/tools.ts` (agent C): two marked blocks only --
   `import { CALC_TOOLS } from "./calc/tool";` and `...CALC_TOOLS,` at the end of `RAG_TOOLS`.
   The tool's handler lives in `lib/rag2/calc/tool.ts`; it reads `ctx.values` and keeps its results in a
   WeakMap keyed by the ToolContext (`calcOutcomes(ctx)`), so `ToolContext` is unchanged.
2. `lib/rag2/loop/hook.ts` (commit "calc (5/n)", 3 lines): `answer.calculations = c.calculations` and the
   claim-record call `syncCalcClaimRecord(...)` (writes only in a claim scenario; never an amount).
3. System prompt (`lib/rag2/loop/prompt.ts`, not touched): a real model should be told to use `calculate`
   for any benefit amount and never `compute` with a household number of nights/days (now refused).
4. `DEMO-TRANSCRIPT.md` is out of date (turns 6-7 now use `calculate`); regenerate with `npm run rag2:loop-demo`.

## Known gaps found (not fixed -- outside K's files)
- Hook correction note "Updated: bill amount is now 600 SGD (you first said 2400 SGD)." states money figures
  without an attribution phrase the gate accepts ("you first said" is not in ATTRIBUTION), so the gate removes
  the note for money facts (nights/count facts are fine). Suggest wording "(you said 2400 SGD at first)".
- Generic gate (rule 1, agent B): no "adult" person class, so an Adult-column figure stated for a child is not
  caught for plain figure bindings. Calculation records check Adult/Child columns against the person (rule 4).
- Benefit-specific exclusion detection is sentence-level regex (lib/rag2/calc/terms.ts); exclusions printed
  under a general heading without the benefit's name are not attached to the benefit.
- "absent" conditions (no day cap / no waiting period printed) are not re-scanned by the gate.

# Agent C -> agent K / coordinator: requests outside agent C's files

Agent C owns lib/rag2/loop/** (except compose.ts), people/policies/search/evidence/store, tools.ts (minimal),
lib/ai/usage.ts. These need changes in files agent C does not own:

1. lib/rag2/loop/compose.ts (K) -- `householdInputs()` matches a household figure to ANY recorded fact by numeric
   value. Facts now carry provenance (`LoopFact.source`, `LoopFact.basis`, see lib/rag2/loop/facts.ts). Please accept
   only confirmed facts (`confirmed(f)` from ./facts: basis "stated", or legacy facts with no basis) and match the
   operand's attribution against the fact's `words`. The loop already refuses such a compute call before it runs
   (loop.ts `preflight` -> facts.ts `householdOperandProblem`), so this is defence in depth.
2. compose.ts (K) -- "clearly attributed user statements need no document citation": COVERISH drops a sentence such as
   "You told me Xin Yi was warded overnight." (it contains "warded"/"nights"). Suggest: a sentence that begins with an
   attribution ("You said / told me / mentioned ...") and whose figures and content come from the household's own
   messages (state.history user turns + this message) is kept without evidence, and is never a cover statement.
3. K's calculator (hospital cash day count) -- please report missing inputs as data, e.g.
   `{ status: "needs_input", missing: [{ key: "admission_datetime" | "discharge_datetime" | ..., why, evidence }] }`.
   The loop records only what was said (nights_in_hospital="2" from "warded for 2 nights"; dates/times as said) and
   refuses payable_days / benefit days and nights-recorded-as-days. When the calculator returns `missing`, the loop
   should ask for exactly that key: agent C will accept `ask_user(kind=fact, fact_key in missing)` citing the
   calculator's evidence once the shape is fixed (one small change in loop.ts `action("ask_user")`).
4. lib/rag2/tables.ts (not C's) -- a member recorded as a stepchild is matched to an "Insured Child" column only when
   the document itself lists them in that category (an insured-persons table); a schedule that only names them in a
   sentence ("Insured children: A; B") yields `ambiguous` with ONE option. With one option and the person named on the
   document as insured, this could resolve. Not changed by C.
5. DEMO-TRANSCRIPT.md is now stale for turn (c): `note_facts` records how_it_happened + injury (paraphrased), not
   cause=accident, and "my son" offers the stepson too. Regenerate with `npm run rag2:loop-demo` after K's changes.

# Death-journey release: result (offline, unmerged)

Base: main `e3109bb523da30cbaf0cac5aa90c35b751db495b` (verified current before starting). One feature branch. Main, production,
documents, credentials and migrations untouched. No merge, no deployment. Expectations were written first
(`EXPECTED-death-journey.md`).

## What the household can now do
A broad death question ("What happens if Daniel dies? What would the family receive from his insurance, and what should we do?")
ends with a complete answer inside the existing 80,000-token turn (scripted model). Two households are tested: the
**actual-report values** (reconciled with the PR55 verification report: Group Term Life S$1,000,000 and Group Personal Accident
S$600,000, both dated 06/10/2022) and a **deliberately different control** (Term Life S$500,000, Personal Accident S$600,000, dated
1 April 2024). The control is not, and is never described as, a reproduction of the actual values. Each answer carries its own
amounts and date, and also Accidental Death, Death due to natural catastrophe, the Compassionate Death Allowance with
its bare-"$" currency uncertainty and Core-or-Voluntary-Scheme condition, the insurer contact step, and the specific gap ("I did not
read a claims procedure ... so none is listed").

## Evidence limits (stated, not hidden)
* The first request did not attach its "actual-library report"; the PR55 verification report (18 Oct 2026) was supplied afterwards
  and the amounts/dates were reconciled with it (see above). The recorded tool arguments and results are still not available, so the
  exact calls cannot be replayed verbatim; the report's *structure* is reproduced (one `person_benefits`, seven overlapping
  `search_passages`, heavy cumulative token use, one PA figure plus the limit text). Its 62 hits / 49,494 / 38,271 tokens and
  7.8-8.4 s `person_benefits` / 11.7 s search timings are the report's figures, not measured here.
* Production traces, the production library and the separately recorded production-UI test spend were not read.
* **Spending reconciled once each** (see `LEDGER-RECONCILIATION-2026-10-18-prod-ui.md`): three production-UI tests, all application estimates
  (not provider-billed): PR52 US$0.01566652 (34 calls), PR54 US$0.01497526 (24), PR55 US$0.01544342 (26). Earlier spend US$0.438492 and the open
  US$0.15 reservation unchanged. After them: spent US$0.48457720, reserved US$0.15, remaining US$0.36542280.
* **The paid batch (two death attempts, a fresh paraphrase, one fracture control; cap US$0.05) has not run.** It needs the committed candidate on the
  workbench that holds the model relay, and publishing is blocked (the session has no GitHub write access). Nothing was spent by this work.
* Everything here is scripted-model plumbing over anonymised fixtures: it proves the application boundary, not model behaviour.

## Changes (by request item)
1. **Bounded retrieval** (`lib/rag2/loop/retrieval-budget.ts`, `loop.ts`): search results are compact and new-only (a passage whose
   document-version/page/offset span overlaps one already returned this turn is not returned again; ranking details and the
   searched-id list never reach the model; at most 6 new passages, the rest reported as `more_lower_ranked_hits`). A search is
   admitted only if the call that reads its result still fits; the search after which a further call would not fit is the *last*
   retrieval and the model is then offered only the answer/question/evaluation tools; two searches in a row that add nothing new
   close retrieval. Limits, retries and call counts are unchanged.
   When room runs out the turn is finished by the server from the person's resolved benefits (`deathCompletion`): every
   death-related record (by label/product relationship) gets its printed terms, the next step is the certificate's own insurer, and
   the gap is named. A reply with nothing about the person's benefits gets a specific "The documents do not state ..." sentence.
   A reply the model wrote with room to spare is not padded.
2. **Conditions bound to their own benefit** (`lib/rag2/section-scope.ts`, `evidence.ts`, `pct-rows.ts`, `benefit-records.ts`):
   a cited "why" is read from the benefit's own section; evidence printed wholly under another benefit's heading is refused
   for that question; a passage spanning two sections is read only in the event's section; wrapped sentences are kept whole; a
   percentage table is labelled by the section it is printed under (the dismemberment schedule is now
   "Total and Permanent Dismemberment due to Accident", not a fracture).
3. **Narrow completeness** (`event-relations.ts`, `schedule-disposition.ts`, `loop.ts`): relevance is by event family
   (death / fracture / dismemberment / hospital) and product cover, read from names, never conditions; "leg" is not relevance.
   A sibling's `option_id` is carried over only if it is a row of the benefit being evaluated, otherwise its case words are asked
   of that benefit's own rows. Replay of the comparison: dismemberment schedule excluded with its reason, zero evaluate calls for it,
   Simple Fracture S$2,500 and the PA summary's Other Fracture S$300,000 both complete.
4. **Latency** (`lib/rag2/store.ts`, `search.ts`, `benefits.ts`, `hook.ts`): measured, not assumed. Per-turn store (AsyncLocalStorage)
   reuses household-scoped documents, links, members, pages and the search index within the turn, re-checking lifecycle and document
   version at every tool round. Scripted model (so every millisecond is the application's), 19 documents / 368 pages:
   policy_pages loads 20 → 4 (12.5 MB → 1.1 MB), SQL statements 76 → 48, `person_benefits` 784 ms → ~90 ms, wall 2.5 s → ~1.3 s.
   Remaining: ~14 `policies` and ~11 `family_members` lookups (per-round lifecycle rechecks, kept by design) and ~1 s of pre-loop
   `householdBenefits` CPU for all members. On a remote database each statement also costs a network round trip, so the statement
   count is the lever that matters there; this was not measured against the production database.

## Verification (Node 22.22.2, local Postgres 16, scripted model; nothing here exercises a real model)
* `tsc --noEmit` clean; `next build` OK.
* Full offline regression: 46 of 47 suites pass (every `rag2:*`, `reliable-chat:*`, `verify:*` script except the four that need
  live credentials/DB). The one failure, `rag2:s52-replay` (11/12: "differences from the live answers" S52A#0 added 3 !== 2), is
  **pre-existing**: it fails identically in the earlier-session log before this work, and toggling every change here off did not alter it.
* New `reliable-chat:death-journey-test`: broad death question, stubborn model, no-progress searches, insufficient evidence,
  fracture condition in its own section (citing the dismemberment chunk is refused), SBB replay (dismemberment excluded, zero
  evaluate calls, S$2,500 + S$300,000), tibia to hip S$3,750, ambiguity asked once, wrong person: all pass.
* Browser (Playwright, built app): deathjourney 3/3, actual-library 8/8, RC8/FL5 3/3, Tan 3/3, booklet 6 passed (3 skipped by design).
* One existing replay control changed: `scripts/rag2-scenario-replay.ts` move selection now prefers hits whose evidence excerpt
  matches (repeated passages are in-position stubs); assertions are unchanged.
* Latency, final (19 docs / 368 pages, scripted model): wall 1.57 s, loop 0.43 s, 50 SQL statements, policy_pages 5 loads;
  `person_benefits` 93 ms, 2 searches 105 ms. Remote-database round trips were not measured.
* Death answer, scale 1: outcome `final_answer`, model calls with inputs 10,965 / 14,896 / 16,237 / 14,229 tokens, 2 of 7
  scripted searches admitted (limit 80,000 unchanged).

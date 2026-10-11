# Round 9 — one evidence contract, useful answers (release handoff)

Branch `claude/evidence-contract` (from main `41ea5c3`). Tested candidate: see the PR. Main and production unchanged.

## 1. The live failure, reproduced
Synthetic household `scripts/fixtures/rag2-release` (same layouts as the live documents; every name, ID and amount
invented). Scenario A1 posts "alex died in a motorbike accident" to the real chat route with the scripted model
playing the live model's tool calls (resolve_person → policies_for → select_table_value on the certificate →
search_passages ×2 → final_answer that says a date matters without asking).

**Baseline (main `4ad9342`, before #43), visible answer:**
```
The policy wording says Death due to Accident pays 100% of the Sum Insured if the insured person dies as a direct
result of an accident within 365 days of it.
It does not pay for death caused by competitive racing on wheels, except racing sanctioned by the Authority.
I couldn’t confirm one of the figures against the cited page of your documents.
The figure I left out is for “GROUP PERSONAL ACCIDENT(POLICY NO. HL7700123) — Goh Wei Ming, Alex” in Harbourline
Civil Service Group Scheme - Certificate (page 1).
[next] Contact Harbourline Life to confirm cover on the date of death and what they need for a claim.
gate: "the row prints one column per person or tier, and the figure is not bound to a column"
```
**Candidate, visible answer:**
```
Alex's Certificate of Group Insurance lists his Group Personal Accident sum assured as S$600,000, as of 1 April 2024.
The policy wording says Death due to Accident pays 100% of the Sum Insured if the insured person dies as a direct
result of an accident within 365 days of it. It does not pay for death caused by competitive racing on wheels, except
racing sanctioned by the Authority.
[Q] On what date did the accident happen?
gate: []
```

### Where it went wrong
1. **Evidence lost between retrieval and the gate.** `select_table_value` resolved the person by ROW (roster), but the
   `FigureBinding` only carried a column header (empty for a header-less certificate). The gate re-derived the layout
   from the number of cells (≥3 → "one column per person") and rejected the person's own row. (#43 patched this by a
   second guess in the gate; round 9 replaces both guesses with a contract.)
2. **Repair could not succeed.** The one bounded repair sent the gate's reason to the model; no rewrite of the sentence
   could satisfy a layout the gate had guessed wrong, so the repair was spent and the first answer stood.
3. **Diagnostics shown.** `rescueRejected` appended the generic verifier note and the row's raw label.
4. **No question.** The model's "depends on the dates" sentence carried no evidence and was dropped by the composer;
   nothing asked for the date. Budget was not the cause in the reproduction (5 of 12 calls).
5. Found while testing (also live-relevant): an answered date was asked again — `accident_date` was refused as a
   "policy-defined classification" even when the household's own words said "accident".

## 2. Structural changes (and duplicate logic removed)
- **Evidence contract** (`EvidenceRef.table` → `FigureBinding`, no schema change): `layout`
  (`person_row | person_column | tier_column | version_column | stage_column | single_value | unresolved`),
  `rowPerson` (the row's name cell, verbatim, offsets), `asOf` (the row's printed "as of"/effective date). Set once by
  retrieval (`lib/rag2/tables.ts`), carried by calculations (`toFigureBinding`) and checked by the gate.
- **Gate** (`lib/chat/answer-verification.ts`): `person_row` bindings are checked against the stored page — the row is
  in the cited passage with the figure; the name cell names the person (household names, any order; one-word names
  only as a whole cell) and no other member; the product heading above it is the stated benefit; one amount, or the
  bound column when the row prints several; currency; a dated amount is not stated as current cover or money to be
  paid. `unresolved` fails. A figure on another member's row fails for any layout. **Removed:** #43's
  `rosterRowProblem` (the gate's own roster guess from cell counts). A wording percentage and a certificate sum
  assured of the same policy (policy or group number) now pass in a calculation, as the calculator already allowed.
- **Loop** (`lib/rag2/loop/loop.ts`): the existing single repair (`gateRepair`) now also catches dead ends (an answer
  that says it depends on something unknown, or a calculation still missing a household fact) — no new mechanism, no
  extra model call on ordinary turns; the repair gets one reserved model call beyond the turn's call limit
  (`usage-meter.ts`); an answer whose calculation still needs a household fact ends with that one question.
- **Visible text** (`hook.ts`): what the gate leaves out is said in plain words (benefit, document, page, why); the
  verifier's wording, row labels and ids stay in the trace. Generic notes reworded.
- **Composer / facts / questions:** "the uploaded documents don't say …" is kept as an absence statement (never a
  verdict); event dates named in the household's own terms are recorded; a date question is relevant to a clause that
  counts time ("within 365 days").
- **Tables:** date-only columns are conditions, never values; roster rows keep a readable product label; headed
  rosters and rows with several amounts bind to the column the benefit names.
- **Tokens:** a search hit's text is no longer sent twice beside its identical excerpt (A1 tool results 12.2k → 9.9k
  characters; every later model call in the turn re-sends them).
- **Prompt v9:** document / reported / derived / unknown kept apart; dated certificate amounts; not-stated vs
  excluded; referral is a next step, not an answer; ask instead of ending on "it depends".

## 3. Tests (this sandbox: Node 20, 1 GB, PGlite; CI could not run — see §5)
- **Acceptance** `npm run rag2:release-test`: 23/23 — complete visible conversations A1–A2, B1–B10 and contract
  controls C1–C11 (person row; swapped row; missing name cell; dated vs current; currency; wrong product heading;
  wrong version; another household; superseded copy; adult/child; employee/spouse; before/after; masked ID and dates;
  two amounts on a row; unresolved layout; ambiguous name; cross-document lump sum 20% × S$600,000 = S$120,000).
- **Holdout** `npm run rag2:release-holdout` (4 paraphrased scenarios written before the freeze): **2/4 on the frozen
  candidate `1a41760`** — H1 (a date question refused because the 365-day clause has no word "date") and H2 (the
  save-time gate refused a certificate × wording lump sum; the rejected what-if was explained as an "assumed stay")
  were real defects, fixed in `5916bd3`; 4/4 after the fix (no longer unseen).
- **Existing suites** (REQUIRED_CI_SUITES that run here): all rag2-*, verify-gate, verify-assertions, ingest-live
  checker and the security / lifecycle / claim / chat suites pass. Not runnable here (killed for memory or needing
  Node 22's pdf.js or a Postgres service, identical on main): r5-answer, r6-chat-quality, r7-answers, r7-claims,
  r8-chaos, r9-ingest-chaos, full-household-e2e, evidence-download (fails on main too).
- Expectation changes (documented inline): rag2-loop N2 (the plain line replaces the generic note), D-f1 (the answer
  ends with the hospital-cash date question), roster R2 (readable label), conv F1 (prompt version).
- Vercel preview build (type-check + build) passes on the candidate.

## 4. Latency and cost
Scripted runs measure only the server side of a turn: 19–356 ms per turn, 2–5 model steps (A1: 5, incl. the one
repair). Real-model latency, tokens and cost were **not measured** (§5); the token saving above is the only
model-cost change, and ordinary turns make no extra model call.

## 5. Not done, and why
- **Real-model conversations and CI browser journeys:** GitHub Actions refuses to start jobs ("recent account
  payments have failed or your spending limit needs to be increased"). The real-model harnesses (rag2-live-smoke,
  ingest-live) hold the test key and ledger and run only there. Once billing is fixed: run CI on the PR, then request
  one ingest-live run per docs/rag-migration/ingest-live/README.md (`run_cap_usd` ≤ what LEDGER.json leaves).
- The model may still answer without asking after the repair; the system then keeps the supported statements (no
  invented question) unless a calculation names the missing household fact.

## 6. Deploy and roll back
Deploy: merge the PR to main (Vercel deploys main). No migration, no environment change.
Roll back: revert the merge commit on main (or promote the previous production deployment in Vercel).

# Round 8 results: verification rewrites, deletion semantics, the repeated question, duration answers, and the hands-on trial

Date: 10 October 2026. Branch `claude/conversational-rag-v1-1`. Main (`42bcac1`) is unchanged. Nothing was deployed to
production and no production data was read or written. (Vercel's existing Git integration builds a *Preview* of every
push to this branch; see "Previews" below.)

**Tested app code:** `3c6fb3f` (CI green, 149/149 steps including `next build`). The last live run's recorded SHA is
`6c2dae8`, which is `3c6fb3f` plus a workflow-only change (see run 5).

## Summary

| Defect (round-8 brief) | Fixed | Evidence |
|---|---|---|
| 1. Misleading verification rewrites (Q9: "a set amount per day", "the effective date is not confirmed") | yes | gate-rejected sentences get one bounded model repair (told the reason and the evidence ids); otherwise the sentence is left out and the benefit and document are named. We never write a figure-free rewrite. The checker reads every sentence of the visible answer. `rag2:conv6-test` V1–V3; live Q9 in runs 3, 4 and 5b |
| 2. Deletion of an amendment ≠ reversal | yes | metadata-only lifecycle read (`lib/lifecycle/amendment-metadata.ts`), no deleted text kept, removed-amendment limitation enforced by the gate. `rag2:deletion-semantics-test` 9/9 (amendment deleted, unrelated document deleted, newer amendment replaces, reversal printed; saved conclusions that relied on the deleted endorsement become stale); live D1 in runs 3, 4 and 5b |
| 3. The repeated question | yes | an answer typed into the question card is recorded under the asked fact as the household's report, and the pending question is cleared in saved state before the model runs. `rag2:conv6-test` A1–A2 (saved state + rendered card); live Q4 in runs 3, 4 and 5b (no re-ask) |
| 4. Honest hospital-duration answers | yes | "exactly 3 days" under a 24-hour rule: why the times matter, a what-if only from a validated `calculate`, then the question for real times. `rag2:conv6-test` H1–H3; live R1 in run 5b |
| Found in live runs 3–4 (new) | yes | model citation markers, a negated payout read as a payout, a wording-only repair, an endorsement linked to nobody, an example limitation copied by the model. Details below; `rag2:conv7-test` 8/8 |

## Live real-model runs this round (every attempt kept)

Each run uploads the three synthetic PDFs ([hx-text.pdf](https://github.com/policydear-cyber/dearpolicy-mvp/blob/claude/conversational-rag-v1-1/scripts/ingest-live/fixture/source/hx-text.pdf),
[hx-endorsement.pdf](https://github.com/policydear-cyber/dearpolicy-mvp/blob/claude/conversational-rag-v1-1/scripts/ingest-live/fixture/source/hx-endorsement.pdf),
[hx-scanned.pdf](https://github.com/policydear-cyber/dearpolicy-mvp/blob/claude/conversational-rag-v1-1/scripts/ingest-live/fixture/source/hx-scanned.pdf)) through the real upload page. Processing,
OCR included, runs on the real path. It then holds 11 browser conversations with the real model (gpt-6-luna), deletes
the endorsement and asks again. The checks are deterministic, against expectations sealed away from the app.

| Run | Tested code | Spend | Checks | Folder |
|---|---|---|---|---|
| ingest-live-2 (round 7 baseline) | a386b6e | US$0.024 | 83/86 under the old checker; under the round-8 whole-answer checker it fails Q9 (placeholder, contradicted uncertainty), D1 (S$80 as current) and Q4 (re-ask) | `RUN-ingest-live-2-*` |
| ingest-live-3 | 42e1fb2 | US$0.023033 | 135/143 (136 after the harness pairing fix; 138 also with the Q2 correction) | [RUN-ingest-live-3-2026-10-09T18-47-46](https://github.com/policydear-cyber/dearpolicy-mvp/tree/claude/conversational-rag-v1-1/docs/rag-migration/ingest-live/RUN-ingest-live-3-2026-10-09T18-47-46) |
| ingest-live-4 | 2cd45cc | US$0.024372 | 139/144 | [RUN-ingest-live-4-2026-10-09T20-10-59](https://github.com/policydear-cyber/dearpolicy-mvp/tree/claude/conversational-rag-v1-1/docs/rag-migration/ingest-live/RUN-ingest-live-4-2026-10-09T20-10-59) |
| ingest-live-5, attempts 1–3 | 3c6fb3f | US$0 | never started: Docker Hub refused the Postgres image pull ("toomanyrequests") at "Initialize containers"; no step ran | Actions run 37990971773 |
| ingest-live-5b | 6c2dae8 (= 3c6fb3f + workflow uses the runner's Postgres) | US$0.022972 | **141/144** | [RUN-ingest-live-5b-2026-10-09T21-23-25](https://github.com/policydear-cyber/dearpolicy-mvp/tree/claude/conversational-rag-v1-1/docs/rag-migration/ingest-live/RUN-ingest-live-5b-2026-10-09T21-23-25) |

**Cumulative exercise spend: US$0.161222 of US$0.50** (`docs/rag-migration/live/LEDGER.json`). This is the
application's own reserve-then-settle counter, not a provider-side hard limit.

Each run folder has `report.md` (the full transcript, per-turn loop trace, gate decisions, checks), `screenshots/`
(24 images: uploads, library, each answer), `transcript.json`, `extracted/` (the stored page text) and the database dumps.

### Affected turns across runs

| Turn | run 3 | run 4 | run 5b |
|---|---|---|---|
| Q9 dengue (fix 1) | pass | pass | pass |
| D1 after deleting the endorsement (fix 2) | pass: S$80 "not confirmed current cover" | pass | pass |
| Q4 answer typed into the card (fix 3) | pass: not re-asked | pass | pass |
| R1 "exactly 3 days" (fix 4) | asked for the times (accepted) | **fail**: S$110 refused (endorsement unlinked, see below) | pass: explains why times matter and asks for them |
| Q5 stay with times | **fail**: S$360 dropped | pass: S$360 indicative estimate | pass |
| Q6 endorsement change | **fail**: "couldn't confirm" | **fail**: S$80/S$110 refused | pass: S$80 → S$110 from 1 July 2026 |
| Q2 accidental death child vs adult | pass after correction | **fail**: invented "document removed" limitation | **fail**: both amounts left out by the gate (see limitations) |
| Q1, Q3, Q7, Q8 (controls) | pass | pass | pass, except a checker phrase miss on Q7 (below) |

### Defects found in the live runs and fixed (all generic, none question-specific)

1. **Model citation markers** (run 3, Q6). gpt-6-luna writes inline markers (U+E200 "cite" U+E202 e8 … U+E201) into
   `final_answer` text. Every sentence was dropped for "shows an internal id". The markers are now read as citations and removed.
2. **Negated payout** (run 3, Q5). "This is not a confirmed payout" was treated as calling the estimate a payout, in
   both the composer and the gate. A negated payout or guarantee is now ignored.
3. **Wording-only drops** are part of the one bounded repair (an id shown in the text, an amount called a payout).
4. **Endorsement linked to nobody** (run 4, Q6/R1). The model read the endorsement's insurer as "Meridian Harbour
   Assurance" while the schedule says "… Pte. Ltd.". Linking required an exact insurer and product match, so the
   endorsement was linked to no one and every child figure it printed was refused. A reference document is now also
   linked when it prints the same policy number (letters and digits) and the same product. A matching number on
   another product is not linked. (`lib/policies/linking.ts`; this is ingestion code outside the feature flags.)
5. **An example the model copied** (run 4, Q2). The repair instruction contained an example limitation ("an amendment
   document was removed…"), and the model stated it although nothing had been removed. The repair now asks only for
   the limitation the check names.
6. **Harness**: answers were paired by created_at, which a question and its answer share. They are now paired by
   `message_order`, as the app does. **CI** found two more problems, now fixed: the round-8 removed-amendment read
   bypassed the lifecycle query guard (now one declared metadata-only module), and the query budget was 61/60 (the
   metadata read now runs only when a removed amendment exists).

### Expectation corrections (originals preserved)

Agent T's originals (`EXPECTED.source.json/.md`) are unchanged. Every change to the machine translation is recorded in
[`CORRECTIONS.md`](https://github.com/policydear-cyber/dearpolicy-mvp/blob/claude/conversational-rag-v1-1/scripts/ingest-live/sealed/CORRECTIONS.md): Q4, Q9, R1 and D1 (round 8) and Q2 (after run 3).
T's Q2 item allows S$20,000 when it is attributed to JuniorShield; the first translation failed any mention.

The run-5b Q7 failure is a **checker phrase miss**, not a wrong answer. "they show the family plan and cover period,
but not the premium amount" is correct, but the accepted-phrase list has no "but not the premium". I did not change
the expectation after seeing this run.

## Remaining limitations (not fixed)

- **Two-person comparisons from tier tables can lose their figures.** In run 5b Q2 the gate refused S$40,000 (the
  value was not bound to a column) and S$150,000 (the sentence did not name its benefit), even after the one repair.
  The answer then gave only the JuniorShield figure and said a SafeStay figure was left out. This is safe, but it does
  not answer the question. It passed in run 3 and failed in runs 4 and 5b, so it is model-dependent.
- **Small sample.** These are 11 conversations over 3 synthetic documents, and the results vary between runs. They
  show the path works end to end. They do not establish general reliability.
- Q4 says written certification by the doctor is not established. That is literally true but cautious: the household
  said the doctor confirmed it.
- The seeded-text conversations (L1–L6) were not rerun this round. The controls are Q1, Q3, Q7 and Q8 inside the live
  ingestion runs.

## Tests, typecheck, build

CI on `3c6fb3f`: 149/149 steps, including typecheck, `next build`, the e2e journeys and the required-suite coverage.
New or extended suites: `rag2:conv6-test` (10), `rag2:conv7-test` (8), `rag2:deletion-semantics-test` (9),
`ingest:live-checker-test` (55), `ingest:scanned-detect-test`, `trial:guard-test` (15),
`security:lifecycle-query-guard-test`. Each fix was also checked with the fix removed, and the corresponding test fails.

## Previews

The Vercel project `dearpolicy-mvp` builds a Preview deployment for every push to this branch (for example
`dpl_AyQVNvGgioDZzXkmHrhWnADoRHRB` for `3c6fb3f`). This is the project's existing Git integration, not something this
work turned on. With the default flags, the conversational loop does not run there, and a Vercel build refuses
`DEARPOLICY_RAG_LOOP` unless `DEARPOLICY_RAG_LOOP_ALLOW_PRODUCTION=1`. The non-flagged changes (OCR for OpenAI reading,
endorsement linking) do run in such a Preview. Which database a Preview uses depends on the project's Preview
environment variables. I did not read or change them.

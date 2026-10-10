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

## Round 8d: trial isolation, fixed allowance, Q2 comparison, real Codespace check

**Tested app code for the live run:** `fa53170` (request `6605ad0`). Later commits fix only what this round found
(below); CI covers them.

**Isolation first.** `scripts/trial/start.sh` now runs `scripts/trial/isolation.mjs` before any database command,
`db:setup`, build or model call. It refuses: a remote `TRIAL_DATABASE_URL` / `DATABASE_URL` (or a host override in the
URL), a non-local `PGHOST`, `PGSERVICE`, non-local storage, any Supabase or Vercel variable, and not being in a
Codespace. `trial:start-isolation-test` 4/4 proves a remote URL is refused with no `psql`, `pg_isready`, `npm` or
server run; it fails against the old script.

**Budget, stated honestly.** One Codespace, one fixed US$0.15 allowance (`trial-codespace-1`), reserved in
`docs/rag-migration/live/LEDGER.json` *before* the trial starts. Automated runs can spend only what is left after that
reservation. A damaged, foreign or incomplete local spend record is refused, never reset to zero (`trial:guard-test`
T16–T17, `trial:start-isolation-test` S3). **Not enforced:** two Codespaces created at once would each get US$0.15
(worst case US$0.30, still inside the US$0.50 exercise cap). Recreating the Codespace requires recording its spend in
the ledger and closing the allowance first. This is not a provider-side cutoff.

**Q2 diagnosis (run 5b trace).** Three causes, fixed generally: (1) S$40,000 was cited from the row with no
`select_table_value`, so it had no column; the composer now binds a figure to the one person column whose cell prints
it (the gate's column rule is unchanged). (2) The S$150,000 sentence said "the same benefit"; a back-reference now
names the benefit the sentence before named. (3) The binding took the subject from the search, not the sentence's
own `subject_id`. Swapped adult/child figures are still refused (`rag2:conv7-test` C2).

**Live run ingest-live-6 (one run, cap US$0.05, spent US$0.011667).** [RUN-ingest-live-6](ingest-live/RUN-ingest-live-6-2026-10-10T09-27-10/report.md)
- **Q2 (original): pass.** "S$40,000 … in the Child (each) column" for Isla, "S$150,000 in the Adult (each) column"
  for Simon, plus the separate JuniorShield S$20,000. Every figure and person was correct.
- **Paraphrase: fail.** The model added "your amounts differ by S$110,000", a figure printed nowhere. The composer
  correctly dropped that sentence, but without the one repair. The only sentence left claimed "an amendment document …
  was removed from the library", which never happened in this run. Two general fixes followed: an unprinted-figure drop
  now goes into the one repair, and the gate refuses a removal claim in a household that never removed an amendment.
  These are proven by a scripted replay of this exact answer (`rag2:conv7-test` C5–C6), **not** by a second live run.
  No rerun was made.
- Harness: the paraphrase was labelled `C2T1` instead of `Q2P` (the turn-id pattern did not allow a letter suffix),
  so the verdict also reported "Q2P never asked". Fixed in `scripts/ingest-live/fixture.ts`.

**Exercise spend: US$0.322889 of US$0.50**, plus US$0.15 reserved for the trial: **US$0.027111 left for automated
runs.**

**Start-up checks.**
- CI `trial startup (dev container)` builds `.devcontainer` as a fresh container and checks: postCreate, the
  postStart server, preflight mode, the ledger binding, CSRF on the forwarded address, 4 people, 3 uploads, one chat
  answer, a container restart with build reuse, and the remote-database refusal inside the container. It found a
  bug (`sudo -u postgres` needs a password in this image; fixed with `runuser`) and passed on `fa53170`.
- **A real Codespace** (`dearpolicy-trial-check`, 2-core, preflight, US$0) was then opened in a browser. Two things
  failed and one was fixed:
  - **Fixed:** the server started, then died when postStart returned. Codespaces ends that session; CI's dev-container
    CLI does not, which is why CI passed. The server now runs under `setsid`. After `git pull`, a stop and start
    through the GitHub API, the server came back by itself and was still up 8 minutes later.
  - **Checked on the private address** `https://<codespace>-3000.app.github.dev` (GitHub sign-in required):
    - the portfolio loads;
    - adding a person passes CSRF;
    - a PDF upload is received;
    - one chat turn returns the honest preflight stop ("the assistant model returned an error").
  - **Not checked:** a real-model answer inside the Codespace. No `OPENAI_TEST_API_KEY` Codespaces secret exists yet.
  - **Not fixed:** in preflight, an uploaded PDF stays at "Reading" (documented). Also, the first message typed into
    a freshly loaded chat page was lost once; the second attempt worked.

**Model variability.** One live sample per question. Q2 passed in runs 3 and 6 and failed in runs 4 and 5b. The
paraphrase failed on a self-computed difference. Expect further phrasing-dependent misses. The gate makes them safe
(a figure left out, never a wrong figure shown), not absent.

## Round 8e: day-count boundary defects (independently reproduced against `20ee59e`)

Focused correctness fix. No platform change, no model calls (US$0 spent; the trial allocation is untouched).
Suite: `npm run rag2:calc-boundary-test` (`scripts/rag2-calc-boundary-regressions.ts`). Every expected value in it was
written by hand from the wording and the calendar, not produced by the code under test.

### What was wrong, and how far it reached

"Full path" means stored synthetic wording → `readBenefitTerms` → the `calculate` tool → the saved calculation record
→ its recompute → `verifyAnswerFigures` (the save-time gate) on an indicative-estimate sentence. That sentence is
scripted; no model wrote it. Each case was run against `20ee59e` (before the fix) and against the fix.

| Defect | Module (before) | Full path before the fix | After |
|---|---|---|---|
| A. first full day, 00:00 → 01:00 the same day | 1 day | **confirmed**: S$100 estimate, kept by the gate | 0 days, not payable |
| B. zero-length stay at 00:00Z | 1 day | **confirmed**: S$100 estimate, kept | 0 days, not payable |
| C. “by 12 noon” / “on or before 12 noon”, admitted 12:00 | parsed as strict *before*: 1 day | **confirmed**: S$100 instead of S$200, kept | inclusive: 2 days, S$200 |
| D. 2026-02-30 | accepted (rolled over to 2 March) | **confirmed** (complete-24-hour wording): S$100 estimate, kept | `INVALID_DATE`; the household is asked again ("2026-02-30 is not a calendar date") |
| Same clause printed twice | 2 extra days at module level | **blocked upstream**: `terms.ts` kept one per day | counted once, at every level |
| Two different clauses for one day | first one picked | **confirmed**: S$200 estimate from the first clause | estimate withheld; both passages named |
| Future date of birth (2027 for a 2026 stay) | "aged -1", child | **confirmed** to the tool result: the Child column (S$80) was read for her | class unknown; no relationship guess; the Child column is refused |
| Malformed saved records (exception applied twice, 30 Feb, 00:00 → 01:00 saved as 1 day) | — | **kept by the gate**: the recompute shared the flawed function | rejected |

### Fixes (root causes)

- **First full day** now counts the local calendar days lying wholly inside the stay. 00:00 → 01:00 is 0; 00:00 to
  00:00 the next day is 1. Complete-day controls are unchanged, for example 1 Mar 00:00 → 4 Mar 11:00 is 3 days.
- **Dates:** a calendar date, time of day and UTC offset are validated before any arithmetic, in `day-count.ts`, the
  calculator inputs and saved-record operands. 2028-02-29 and 2000-02-29 pass. 2026-02-29, 2100-02-29, 2026-04-31,
  month 13, 24:00, 23:60, +15:00 and +08:60 are refused.
- **Comparisons:** `before` / `on_or_before` / `after` / `on_or_after` are kept from the wording, through the
  calculation record and its verification, and compared to the second. "By", "on or before", "at or before" and "not
  later than" are inclusive.
- **Repeated vs conflicting clauses:**
  - An equivalent repeat counts once.
  - The benefit's own wording takes precedence over plan-level wording on the same day.
  - An endorsement of the same policy supersedes the clause only from its stated effective date (latest in force wins).
  - Anything else is a named conflict, and the estimate is withheld. Neither the first nor the last clause is picked.
- **Birth dates:** an invalid date of birth, or one after the date asked about, gives class *unknown*. It is not
  replaced by a relationship guess. A category the policy itself lists the person under still decides. Write-time
  validation (future and invalid dates refused in `app/api/family`) was already in place.

### Preserved

- The complete-24-hour sweep from 0 to 96 hours equals floor(h / 24).
- Each rule's existing day counts are unchanged: first full day, each night, day or part of a day, complete 24 hours,
  and the 12-hour remainder.
- `rag2:calc-test` passes 39/39.

### Limitations

- A zero-length stay under "each day or part of a day" still counts 1 day. It is left as that rule's own convention;
  no universal rule was imposed.
- Admission and discharge recorded at different UTC offsets are each read at their own local date.
- "Midnight" in an exception is read as 00:00.
- Amendment precedence uses the document's stored effective date only. An endorsement whose effective date was not
  extracted leaves the day as a conflict.
- These are synthetic, deterministic cases. They show these boundaries are handled, not general reliability.

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

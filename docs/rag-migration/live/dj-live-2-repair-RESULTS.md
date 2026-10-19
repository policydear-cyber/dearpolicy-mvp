# dj-live-2 repair (offline checkpoint, no paid calls)

Original dj-live-2 responses and grades are unchanged. This file records only the offline repair.

## First incorrect decision, per statement
- Term Life S$1,000,000 (missing from DI): `bindCitedFigures` renamed and deleted a value id still held by a server-written statement (and `personAmountValue` returned a stale cached id), so the statement was dropped as "table value not read". Presentation failure on a sound binding.
- PA S$600,000 (surviving): the fallback completion built the "schedule's percentages are of that sum insured" line from an inapplicable PA value; a certificate-summary roster path also ignored applicability.

## Repair
- `lib/rag2/benefit-applicability.ts`: explicit result (supported / not_applicable / unresolved) with source and reported-fact dependencies, read by every output path.
- Binder keeps held value ids; verification-removed statements are re-rendered only from a sound validated record; rejected claims are never restored.

## Controls
`npm run reliable-chat:death-applicability-test` (A1-A7, M1-M15 mutations). Mutations M1, M3, M5, M7, M15 are layered defences and are not individually proven.

## Remaining failures
- `rag2:s52-replay` 11/12 (extra split sentence): verified PRE-EXISTING; see the confirmation section below.
- Live confirmation of DI: executed as dj-live-3 (see the last section): FAIL on the unchanged death-v1 grader. Recommendation: HOLD.

## Confirmation checkpoint (Mon 2026-10-19) - tested SHA `f2fe6a630243bd19ac4ccaec95df965aa8504dc5`

Commits on top of `2ea7b34`: `c783e73` (product: the withheld accident-only benefit's note cites the wording that prints its condition, never the person's amount row, so no source shows the withheld S$600,000 row; a model copy of the note is replaced by the note) and `f2fe6a6` (test runners only: disposable-copy mutation runner, new injection runner). Original dj-live-2 grades are unchanged.

### Offline results on `f2fe6a6` (Node 22, no edits during the run; lib+scripts digest identical before and after)
* typecheck, death-cause, death-live-repairs, death-journey, death-applicability, applicability, benefit-records, structured-answers, stage3, slice, cases, conflicts, booklet, cda-recorded, live-regressions, cache-compaction, ci-workflow-coverage: all pass.
* `rag2:s52-replay`: 11/12 on this candidate AND on the baseline tree under the same environment, with identical output. The single failing assertion (S52A#0 "added" 3 vs 2) is pre-existing, not introduced. Assertions unchanged.
* Injection proofs (prohibited output injected at the last route boundary; end-to-end suite must fail on that property): 13/13 proved (J1-J13), none crashed or incomplete.
* Mutation run (disposable copies, ~25 s each; M12 residue found and repaired in an earlier crashed in-place run): detected 13 (M4, M6, M8-M14 singly; M1+M4, M3+M4, M6+M15; all-at-once), survived 6 (M1, M2, M3, M5, M7, M15: layered defences, individually not proven; their safety properties are covered by J1-J13), crashed 0. The run started before the final one-line property move in loop.ts (semantically identical); no mutation was rerun.
* `next build` of `f2fe6a6` (clean copy, Node 22.22.2): passes. Browser journeys on that build, production-mode server, scripted model, no source edits: reliable-chat (tan) 3 passed, deathjourney 3 passed, actuallib 8 passed, booklet 6 passed (3 skipped by design). A first actuallib run failed 8/8 only because my runner seeded the wrong household ("unknown scenario"); rerun with the correct household passed.

### Pre-registered DI expectations (published before any spend)
1. dated Term Life S$1,000,000 remains, with its supported terms;
2. no accident-only PA amount is presented as applicable to the reported illness;
3. no contradictory "no amount" statement;
4. correct person, product, version, currency and citations;
5. returned, saved and browser-displayed answers agree;
6. no generic refusal or unnecessary question.

### Single DI real-model attempt (authorised once, cap US$0.01): NOT RUN - BLOCKED (runner)
No path exists in this environment to execute the app, database and model route end to end: the only model credential is a connection reachable through the Composio workbench relay, the workbench has no Postgres, `wt-H` or Node 22, and this sandbox cannot reach the relay; hand-ferrying every model call would exceed the 90 s per-call and 150 s turn limits (changing them would invalidate the frozen configuration). Nothing was spent; no model call was made; LEDGER.json is NOT appended (no run occurred); the US$0.15 reservation and all history are untouched (spent US$0.501213 of US$1). The authorisation remains unused. Smallest missing action: run `rag2-live` for `f2fe6a6` with RAG2_LIVE_RUN_ID on a host that has the app, Postgres and the model connection, or restore the `wt-H` environment.

### Status
A confirmed repair on the synthetic scenario cannot be claimed; the offline evidence is scripted-model only. Recommendation: HOLD (no merge, no deploy).

### Live-attempt environment check (Mon 2026-10-19 PM) - still NOT RUN
* Restorable and restored in the workbench (sudo, apt, npm, nodejs.org, GitHub reachable): Node 22.22.2, 3 GB swap, PostgreSQL 17.11 + pgvector, the 1,972 files of `f2fe6a6` (each verified against its git blob sha; 20 large docs run records skipped), `npm ci`, `next build` (exit 0), local synthetic database schema. `wt-H` itself was gone (sandbox recreated) and was rebuilt at the same path.
* Dedicated test connection reachable: `GET /v1/models/gpt-6-luna` through `proxy_execute(..., "openai")` returned the model object (no cost).
* Blocked operation: starting the loopback relay (`start_relay(proxy_execute)` from `scripts/rag2-live/relay.py`, a 127.0.0.1:8787 listener inside the workbench kernel that forwards to the connection) was denied by the session's permission check (reason given: "Expose Local Services"). Not a missing dependency, denied installation, lost compute or inaccessible connection. No model call, no spend, no ledger append, no workaround attempted.
* One action that unblocks it: allow that single loopback-only relay listener (127.0.0.1) for the run, then the DI attempt (`RAG2_LIVE_HOUSEHOLD=deathjourney --scenarios DI`, run id `dj-live-3`, cap US$0.01, preflight first) can proceed unchanged.

### Single DI real-model attempt `dj-live-3` - EXECUTED (Mon 2026-10-19, supersedes the BLOCKED notes above)
Authorised by the owner once (cap US$0.01). Workbench rebuilt (Node 22.22.2, Postgres 17 + pgvector, `f2fe6a6` verified file by file against a tree manifest, `npm ci`, `next build`, schema); US$0 preflight `dj-live-3-pre` first (stopped at the first model call: 0 calls, US$0, relay saw 0 requests); then one live run, loopback relay on 127.0.0.1:8787 only, stopped afterwards. Provenance check passed (recorded SHA = checked-out code, 955 checked files). Not rerun.

* Tested code: `f2fe6a630243bd19ac4ccaec95df965aa8504dc5` (branch commits after it change docs only). Model gpt-6-luna (provider-reported), prompt `rag2-loop-v18-applicability`, settings temperature 0, max_completion_tokens 2000, tool_choice required.
* Spend: US$0.002098 actual (3 calls; 34,945 in / 634 out tokens), within the US$0.01 cap; worst-case reservations US$0.0025-0.0037 per call all admitted. LEDGER.json appended once (`dj-live-3`); exercise spent US$0.503311 of US$1; the US$0.15 trial reservation is untouched.
* Latency: 65.5 s send-to-seen (model 64.7 s; upstream calls 19.1 s, 3.6 s, 41.9 s). Misses the 20 s product target; upstream/relay time, not app time (accepted in 0.4 s).
* Tool path: resolve_person, note_facts, person_benefits, policies_for, search_passages x2, then ask_user (3 model steps).

**Complete visible answer (returned = saved):**
> The Group Insurance Product Summary says the Group Term Life death benefit is 100% of the Sum Assured, and death must occur while the insured person is covered; it defines the Sum Assured as the amount on the person's certificate. Daniel's certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; that dated amount does not confirm cover on his date of death. The uploaded documents do not establish whether Daniel was covered on the date he died or what amount applied then.
> What was Daniel's exact date of death?

**Source bindings:** e18 = Group Insurance Product Summary page 12, "Group Term Life: Death or Terminal Illness 100% of Sum Assured; Death must occur while the Insured Person is covered under the Scheme"; e1 = Daniel's certificate page 1, Group Term Life S$1,000,000, dated 6 October 2022. Reported facts saved: death last week; not an accident (user-reported).

**Grade against the six pre-registered expectations**
1. Dated Term Life S$1,000,000 with supported terms: PASS (I1).
2. No accident-only PA amount presented as applicable: PASS (I2-I4; no S$600,000, no accidental-death or allowance figure).
3. No contradictory "no amount" statement: PASS, with a caveat: the answer says the dated amount does not confirm cover on the date of death and that the documents do not establish what amount applied then. That is consistent with a dated printed amount, not a contradiction.
4. Correct person, product, version, currency, citations: PASS (I7 Grace's figures not attached; correct certificate date; S$).
5. Returned, saved and displayed answers agree: PASS for returned = saved (G6, whole answer). No browser rendering of this live answer was made; the browser journeys use the scripted model.
6. No generic refusal or unnecessary question: **FAIL** - I6 (it asks for the exact date of death although the person and cause are known) and I5 (no visible next step to contact the person's own insurer, Aldermoor Life Ltd; the "what should we do" half of the request is unanswered).

Original death-v1 grader, unchanged, on the saved record: **FAIL** (12 of 14 checks pass; I5 and I6 fail). The harness's own `scenario-check.ts` reports INCOMPLETE (it has no DI checks). Files: `dj-live-3-grade.json`, `dj-live-3-grade.md`, `RUN-dj-live-3-2026-10-19T06-06-20/`, preflight `RUN-dj-live-3-pre-2026-10-19T06-03-54/`.

**What this shows.** The repaired boundary works on this attempt: the Term Life figure is present with its terms and dated, and no accident-only benefit leaks (the two defects of dj-live-2). A new failure surfaces after it: the model's terminal ask_user (step 3) asked for the date of death and the question gate accepted it, so the turn ended on a question with no claim steps. This is one attempt on one synthetic scenario, not consistency evidence, and not actual-library verification. Reconciliation note: the app's per-call usage rows were empty for this run (guard total US$0.002098, rows US$0), so spend rests on the guard and relay records.

### Status (updated)
Offline evidence is scripted-model only; the single live attempt is a FAIL on the unchanged grader (I5, I6). Recommendation: HOLD (no merge, no deploy). Next decisive check: decide whether a date-of-death question is legitimate when a dated certificate exists and the user gave a relative date ("last week"); if not, repair the question gate / ask_user acceptance and add the contact-insurer next step, then a new authorised attempt.

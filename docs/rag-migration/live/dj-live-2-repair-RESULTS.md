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
- Live confirmation of DI: see the confirmation section below (BLOCKED). Recommendation: HOLD.

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

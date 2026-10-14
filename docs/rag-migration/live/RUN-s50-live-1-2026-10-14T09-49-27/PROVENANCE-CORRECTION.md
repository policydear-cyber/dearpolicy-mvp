# Provenance correction for s50-live-1 (appended 14 Oct 2026; the original files are unchanged)

**The code tested in this run was `402399a0233518123ed1e44edbb2cec8378ed925`, not `4e35f58d95de7019b285ae7101b0212171440bd0`.**

`run.json` (`testedCodeSha`, `requestSha`) and `report.md` record `4e35f58…`. That value came from the sandbox's `RAG2_LIVE_TESTED_SHA` / `RAG2_LIVE_REQUEST_SHA`, which had not been updated since s49-live-2. The sandbox has no git checkout, so nothing compared that value with the code.

## Evidence for `402399a`

1. **The scenario exists only in `402399a`.** The run's conversation is `S50` on `RAG2_LIVE_HOUSEHOLD=binding-cells` (`run.json` → `conversations[0].scenario`; `server.log`).
   - At `4e35f58`, `scripts/rag2-live/run.ts` and `scenario-household.ts` define neither `S50` nor the `binding-cells` household.
   - At `402399a`, both are defined.
   - So the run could not have executed `4e35f58`'s code.
2. **The saved answers use code first pushed in `402399a`.** Turn 2's figure bindings are `person_row` bindings whose passage is the one-cell-per-line roster: the name, amount and "As of" each on their own line.
   - That reconstruction (`lib/claims/roster-layout.ts`, imported by `lib/rag2/benefits.ts`) is absent from `4e35f58` and present in `402399a`.
3. **The ledger recorded the right SHA.** `LEDGER.json` entry `s50-live-1` was appended with `--tested-sha 402399a… --request-sha 402399a…`. That was the SHA pushed from the working tree immediately before the run, and the working tree was not changed between the push and the run.
4. **Sequence on the branch:** `8d4300b` → `402399a` (committed 09:49:03 UTC; the reconstruction and S50) → s50-live-1 started 09:49:27 UTC (the run directory stamp) → `b66401d` (the inventory fix and this run's record).

## Prevented from now on

`scripts/rag2-live/run.ts` refuses to start unless the recorded SHA is the checked-out code (`scripts/rag2-live/provenance.ts`):
- **In a git checkout:** HEAD must be the recorded SHA, or a request commit on it that changes only a `run-request.json`, and no tracked file may differ.
- **Without git:** a tree manifest of that commit must match every source file by git blob hash, with no extra files.
- **In both cases,** the production build must be newer than the source.

The guard is tested without model spend in `rag2:live-checker-test` (C47, C48).

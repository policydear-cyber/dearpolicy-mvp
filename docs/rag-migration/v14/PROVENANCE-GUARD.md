# Run provenance guard: evidence (14 Oct 2026; no model call)

`scripts/rag2-live/run.ts` now calls `checkProvenance` (`scripts/rag2-live/provenance.ts`) before the relay, the server or any model call. Unit controls are C47 and C48 in `rag2:live-checker-test`.

End-to-end in the sandbox, on the frozen tree `a13c755`, with `run.ts --live` (the relay was stopped, so no call was possible):

| setting | result |
|---|---|
| `RAG2_LIVE_TESTED_SHA=4e35f58…` (the stale value behind s50-live-1) with `4e35f58`'s own tree manifest | refused: "the working tree is not 4e35f58…: 16 file(s) differ (…), 2 file(s) not in that commit (lib/claims/roster-layout.ts, scripts/rag2-live/provenance.ts)" |
| the stale SHA with `a13c755`'s manifest | refused: "the tree manifest is for a13c755…, not the recorded SHA 4e35f58…" |
| the right SHA with no manifest (and no git) | refused: "no git checkout and no tree manifest (RAG2_LIVE_TREE_MANIFEST) for the recorded SHA" |
| `a13c755` with its manifest | passed ("manifest, 866 files"), then stopped at "the relay is not running", as expected |

s50-live-2 then ran through this guard on `a13c755`.

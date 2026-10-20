# PR #57 follow-up: role threads and frozen candidates

All four role threads (Developer, Test engineer, Policy QC, Critic) assess the
same recorded candidate. A new candidate is frozen here only by the Developer,
after implementation, and testing and QC then assess that exact commit.

Integration branch: `claude/pr57-followup-pgaq7d`

| Candidate | SHA | Recorded | What it is |
| --- | --- | --- | --- |
| C0 | `4956588a4e2cae948809e34d78d3b728a99a96ed` | 2026-10-20 | `main` head: merge of PR #57 (after PR #58). Verified equal to `origin/main` before the branch was created. |
| C1 | `8c63250cec7acb4e21fb41655a057f7ffc8ee65b` | 2026-10-20 | Developer's repair after the Critic's verdict (product code, types, `.env.example`), on top of the Test engineer's acceptance checks `a63040b`. Later commits on the branch may change only tests, fixtures and docs; any product-code change needs a new candidate. See `developer/C1.md` |
| C2 | `98ada990d0a792f7a7b8c2e1931704a07409d33d` | 2026-10-20 | Developer's C1 follow-ups (absence over partly stored documents `edee1f9`, `d456512`) and the GP-bill repair G1/G2 (`98ada99`, after Critic round 4 and Policy QC's GP-bill ruling), on top of the Test engineer's GP checks `f550b5f`. Same rule as C1: later commits may change only tests, fixtures and docs. See `developer/GP-BILL.md` |
| C3 | `17668630fab90a94997f3c918d8a5b31139ec40e` | 2026-10-20 | Developer's last small round (no new features): Critic F1-F3, A1-A3; UX FX-K4B question card, FX-K6B "couldn't confirm" and correction line; the death answer's repatriation benefit and its printed condition (UX L2). Same rule: later commits may change only tests, fixtures and docs. See `developer/GP-BILL.md` (C3) and `developer/RELEASE-REPORT.md` |
| C4 | `fbeed4af76800a62c866def07b6d6bd1587c5749` | 2026-10-20 | Developer's fixes for the C3 reviews, on top of the Test engineer's C3 assessment `b4e0ed0`: Critic R6-1 (certificate rows matched by any form of the member's name, none of another member's), R6-2 (C2's medical-term veto restored); the Other Fracture "not defined, the insurer decides" sentence; the partial-copy wording; a single-trip schedule's amount left out of a death elsewhere or after its period. Same rule: later commits may change only tests, fixtures and docs. See `developer/RELEASE-REPORT.md` |
| C5 | `177c073427bab0acb231a34018208a8d0448100f` | 2026-10-20 | Last code round. C4's travel suppression removed: a trip schedule's terms always carry its printed insured person, period of insurance and destination (Evidence Reviewer, Critic R7-1); definite partial-copy wording when the page count proves pages are missing; "an open fracture" (R7-3). Later commits may change only tests, fixtures and docs. See `developer/RELEASE-REPORT.md` |
| C6 | `f4937ef160a06420bf5e526df8d3ab979dc9f11b` | 2026-10-20 | Last round, three items from the Test engineer's C5 run (`f7d115a`, `f07f8a0`): the partial-copy reason (text not stored, not a shorter upload); "trip" only when a Destination line is printed (Critic R8-1); the corrected hip turn's "neither kind is defined" note. Later commits may change only tests, fixtures and docs. See `developer/RELEASE-REPORT.md` |

## Ownership

- Product code: Developer only.
- Tests (`scripts/*-test.ts`, `e2e/`, `scripts/fixtures/`): Test engineer.
- `docs/rag-migration/pr57-roles/<role>/`: each role writes only its own folder.

## Limits

No merge, deployment, production-data, configuration, infrastructure or model
change. Paid model calls only by the Test engineer and only with DC's
authorisation, against the shared ledger (`docs/rag-migration/live/LEDGER.json`,
US$0.259121 left at C0). Heavy builds and DB suites run sequentially.

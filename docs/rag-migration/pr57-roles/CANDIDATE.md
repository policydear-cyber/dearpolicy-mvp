# PR #57 follow-up: role threads and frozen candidates

All four role threads (Developer, Test engineer, Policy QC, Critic) assess the
same recorded candidate. A new candidate is frozen here only by the Developer,
after implementation, and testing and QC then assess that exact commit.

Integration branch: `claude/pr57-followup-pgaq7d`

| Candidate | SHA | Recorded | What it is |
| --- | --- | --- | --- |
| C0 | `4956588a4e2cae948809e34d78d3b728a99a96ed` | 2026-10-20 | `main` head: merge of PR #57 (after PR #58). Verified equal to `origin/main` before the branch was created. |
| C1 | not frozen yet | | Developer's repair, after the Critic's findings |

## Ownership

- Product code: Developer only.
- Tests (`scripts/*-test.ts`, `e2e/`, `scripts/fixtures/`): Test engineer.
- `docs/rag-migration/pr57-roles/<role>/`: each role writes only its own folder.

## Limits

No merge, deployment, production-data, configuration, infrastructure or model
change. Paid model calls only by the Test engineer and only with DC's
authorisation, against the shared ledger (`docs/rag-migration/live/LEDGER.json`,
US$0.259121 left at C0). Heavy builds and DB suites run sequentially.

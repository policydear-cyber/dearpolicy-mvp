# Ledger reconciliation: production-UI verification tests of PR #52, #54 and #55 (18 Oct 2026)

Authoritative ledger: `docs/rag-migration/live/LEDGER.json` at main `e3109bb` (50 entries, exercise cap US$1.00). Before these entries: spent
US$0.438492, reserved US$0.15 (open `trial-codespace-1`), remaining US$0.411508.

## Three entries added, once each

| run_id | calls | spent (ESTIMATED) | source |
|---|---:|---:|---|
| `prod-ui-pr52-verify-2026-10-16` | 34 | US$0.01566652 | owner's figure, 18 Oct 2026 |
| `prod-ui-pr54-verify-2026-10-17` | 24 | US$0.01497526 | owner's figure, 18 Oct 2026 |
| `prod-ui-pr55-verify-2026-10-18` | 26 | US$0.01544342 | DearPolicy-live-verification-PR55-2026-10-18.md |

* Cost status for all three: **application estimates, not verified provider billing.** Recorded as estimates.
* Production-UI tests through the deployed app's existing credentials; no credential was extracted or transferred.
* `refused` and `failed` are 0 for each (the PR55 death turn's per-turn token-admission refusal prevented a call; it is not a provider refusal).
* None passed through `ledger.ts plan/append`; times of day are not recorded, so `at` is the date only. The PR52 and PR54 tested SHAs were not
  supplied and are left empty rather than guessed.
* Every earlier entry (including the US$0.15 reservation) is unchanged; nothing was released, closed or reset. A run_id already present is refused.

## Totals after the three entries

Spent US$0.48457720 (0.438492 + 0.01566652 + 0.01497526 + 0.01544342). Reserved and unsettled US$0.15. Used against the cap US$0.63457720.
Remaining US$0.36542280. The pre-registered batch cap (US$0.05) fits inside it.

The entries are in `ledger-entries-prod-ui.json` in the checkpoint bundle and are appended to `LEDGER.json` by `apply-ledger-entry.py` when the
branch is published; until then the authoritative file on main is unchanged.

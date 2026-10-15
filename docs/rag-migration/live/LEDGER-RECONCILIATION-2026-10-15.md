# Ledger reconciliation before any new paid call — 15 Oct 2026

`docs/rag-migration/live/LEDGER.json` is unchanged by this reconciliation (no entry added, edited, released or
spent). History is preserved as committed.

## Totals, recomputed from LEDGER.json (scripts/rag2-live/ledger.ts `remainingUsd`)

| | US$ |
|---|---|
| Exercise cap | 0.500000 |
| Spent by the 25 automated runs (live-L1-r2 … s52-live-1) | 0.264106 |
| Reserved, unsettled: `trial-codespace-1` (status **open**, spent 0) | 0.150000 |
| **Unreserved remaining** | **0.085894** |

The last entry is `s52-live-1` (tested SHA `490fc32`, spent US$0.008405, 18 calls, 0 refused, 0 failed). No paid
call has been made since. This round makes none.

## What happened to the US$0.15 trial reservation

- **10 Oct 2026, 08:30Z.** `trial-codespace-1` was opened: a fixed allowance for ONE hands-on trial Codespace
  (docs/trial/TRIAL.md, *Budget*). While open, its whole US$0.15 counts as `reserved_unsettled_usd`, so no automated
  run can spend it (`validateLedger` refuses an open allocation that records any spend).
- **The same day.** The only Codespace that used it (`dearpolicy-trial-check`, 2-core) ran in **preflight**: there was
  no `OPENAI_TEST_API_KEY` Codespaces secret, so no model call was possible. Its own counter (`.trial/ledger.json`)
  showed US$0 and 0 calls after three restarts (ROUND8-RESULTS.md, *Trial status*).
- **Since then.** Nothing has spent, released or closed it. Every later live run planned its cap against
  `0.50 − spent − 0.15`.
- **Today.** This session's GitHub credential lists no Codespace on the account and no Codespaces secret, at either the
  user or the repository level. That is consistent with no paid trial use. However, the trial's own counter
  (`/__trial/usage`) cannot be read from here, and an empty listing may also reflect what this credential is allowed to
  see. **So the allocation stays open and reserved.** Closing it means recording the trial's spentUsd as `spent_usd`,
  setting reserved to 0 and status to closed. Releasing it changes what automated runs may spend. Both need your
  authorisation.

### One earlier report double-counted the reservation

ROUND8-RESULTS.md (10 Oct) says *"Exercise spend: US$0.322889 of US$0.50, plus US$0.15 reserved for the trial:
US$0.027111 left"*.

- US$0.322889 is spent (0.172889) **plus** the 0.15 reservation. Subtracting the 0.15 again produced US$0.027111.
- The correct figure at that time was US$0.177111.
- docs/rag-migration/v11/CHECKS-9e30348.md stated it correctly ("US$0.172889 spent + US$0.15 reserved … about
  US$0.177 available").
- Every later report also states it correctly: LIVE-RESULT-4 gives US$0.134008, and s52-live-1 gives US$0.085894.
- No run was planned on the wrong figure: `ledger.ts plan` always recomputes from the entries.

## Before the next paid call

- Available without touching the reservation: US$0.085894.
- Any new run needs its own authorisation, cap and pre-registration. None is started here.

# Expected structured answers (E1-E5): acceptance checks for `bottomLine` and `statements[]`

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | turn the Evidence Reviewer's `qc/EXPECTED-STATEMENTS.md` (0dba0b4) into scripted acceptance checks | main 9a76490; PR #70 b7e18f8 for comparison | done: main AC 0/16 (as intended), PR #70 AC 11/16, GUARD 18/18 on both | `expected-statements/` | none |

Script: `scripts/reliable-chat-expected-statements-test.ts`. Run it with `node --import tsx scripts/reliable-chat-expected-statements-test.ts [--show] [--only=E1,E3,N]`. It goes through the real `/api/chat` route on PGlite with a scripted model: no model call, no spend, and the network is refused. The households are the fixtures the reference was written from (fracture, the PR #64 GP pages, livelib, actuallib).

Evidence category: scripted plumbing. The scripted moves stand for a model that found the right rows; they are not a model result. A live run is still needed to show the model reaches these rows itself.

## What is checked

For every amount row in the reference, the check finds the statement with that amount (and person) and requires:
- the person;
- the currency state (`S$` printed → `currencyResolved: true`; a bare `$` → `false`);
- every required condition **on the card** (`conditions[]`, `basis`, `source.footnote`, `source.note` or the either-or `group.note`), not only in the prose sentence;
- nothing from the row's "must not" list;
- `asOf` where the reference gives a date, the source page, and at least one citation id.

It also requires the bottom line's qualifiers, nothing from each journey's "must not" lists (totals, "covered" / "will pay", superseded or other-household figures), no figure as an amount where none may be given, and returned = saved = reopened (key order and absent-vs-null aside).

GUARD checks: each journey's setup shows the rows in today's prose, so an AC failure is about the fields, not the script. Negative controls N0-N10 show the checker accepts an answer written to the reference and rejects these: a dropped condition, a condition on the wrong row, a total, the wrong person, a missing date, a dropped footnote, a payment promise, a condition only in `fullText`, a missing row, and today's field-less shape.

## Results

| check | main 9a76490 | PR #70 b7e18f8 |
| --- | --- | --- |
| E1 Grace's arm: bottom line and both rows | fail (no fields) | **pass** |
| E1b "Actually it was Daniel": Daniel's rows, nothing about Grace, "no longer applies" | fail | **pass** |
| E2a GP bill, stored pages only | fail | fail: the bottom line lacks the GP/outpatient point, "not the same as not covered", his certificate date and Outpatient Medicare; no ambulance card; recuperation card without "30 days" and "24 hours" |
| E2b GP bill with the PS p20/p25 pages | fail | fail: the bottom line is only the next step; there is no card for $30 (panel GP) or $1,000 (overseas) |
| E2b' a visit stated as in Singapore: no $1,000 card | fail | pass |
| E3 death abroad | fail | fail: the bottom line does not name Adrian, the separate policies or the date. Term Life lacks "6 months" and "death certificate"; Accidental Death lacks accident, worldwide, exclusions and its basis; Repatriation lacks "up to" |
| E4 travel, no trip dates | fail | fail: no bottom line; S$100,000 is a plain fact, not an amount card with its period and destination |
| E5 hip on conflicting documents | fail | **pass** |
| returned = saved = reopened | fail (no fields) | pass on all but E4 (no bottom line) |
| GUARD (setup + N0-N10) | 18/18 | 18/18 |

PR #70's own description lists the plain-text items as not yet covered: percentage-schedule terms and indicative estimates. The E2-E4 failures are those items plus bottom lines that do not yet carry the journey's own qualifiers.

## Choices made (defaults, open to change)

- E2a row 1 accepts `$500` with the currency unresolved as well as `S$500`. The reference says BS p8 prints a bare "$500", and a bare `$` stays unresolved unless the cited S$ row is from the same benefit on another page.
- E2a's scripted model states an uncertainty, not an absence. An absence over the partly stored copies is refused (Critic M5), and the check should not depend on that.
- The fracture rows in E2a (row 3) are optional: if a card for them is present, it must carry its conditions.

# PR #64 (GP-bill answer): Test engineer check of 7f4dbd3, compared with main ca6af69

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | Critic's render check plus the GP-bill journeys, scripted and in the browser | PR #64 head `7f4dbd3` (base main `ca6af69`) | done | `pr64/` | none |

Both SHAs were run from disposable worktrees with only the test files below copied in; no product file was changed (`git status` shows test paths only).
One run at a time, in the foreground. Node 22.22.0, local PostgreSQL 16 and Chromium for the browser half.
**Evidence category:** scripted only (ScriptedLoopModel through the real `/api/chat` route; PGlite or local PostgreSQL; network refused).
No model call, no spend, no ledger change. Nothing here is real-model evidence or evidence about DC's actual library.

## What was tested

Household: the anonymised fracture library plus two invented Product Summary pages, as in the Developer's reconstruction:
page 20 is an overseas-only emergency outpatient clause (up to $1,000), page 25 a panel GP benefit (panel GP in Singapore at no charge; non-panel up to $30).
The scripted model records "tripped on the kerb" and "his GP bill is $800", searches, and answers without addressing the bill, so the server's GP check does the work.

Journeys (Daniel, "$800 GP bill, can he claim?"):
- place not said; "he saw a GP in Singapore"; "on holiday in Bangkok"; "saw a GP in Tampines";
- place not said, with the model also stating a fact of its own;
- the panel GP benefit under an OUTPATIENT MEDICARE POLICY heading that Daniel's certificate does not list;
- the same, with his certificate listing GROUP OUTPATIENT MEDICARE, and with it listing GROUP OPMC.

Files: `scripts/fixtures/reliable-chat/gp-bill.ts`, `scripts/reliable-chat-pr64-gp-test.ts` (scripted),
`e2e/tests/reliable-chat-gp-bill.spec.ts` with `e2e/support/playwright.reliable-chat-gp-bill.config.ts` (browser; household `gpbill` added to the seed and loop server).

## Results

| check | 7f4dbd3 | ca6af69 (main) |
| --- | --- | --- |
| Scripted, all 8 journeys | AC 23/23, GUARD 34/34 | AC 8/23, GUARD 25/34 |
| Render (Critic): the whose-cover note is the line directly under the panel GP quote and says only the insurer or scheme administrator can confirm | 8/8 | 0/8 (panel GP line never quoted) |
| Returned = saved = reopened (scripted) | 8/8 | 8/8 |
| Browser: returned = saved = displayed = reopened, note directly under the quote, place rules | 5/5 | 0/5 |
| Place: Singapore leaves out the overseas clause; Bangkok quotes it as printed; unsaid and Tampines set it apart as "only if abroad" | 4/4 | 0/4 |
| Certificate: "does not list" only when it does not; GROUP OUTPATIENT MEDICARE and GROUP OPMC both count as listed | 3/3 | 0/3 |
| No "You told me tripped", no "Policy Policy" | pass | "You told me tripped" present |
| "$800" never priced, never S$800; bare-$ amounts stay unresolved | pass | pass |

Main reproduces the live finding (overseas clause quoted, panel GP benefit missing, "You told me: “tripped on the kerb”"), so these checks can fail.

## Note, not blocking (INFO)

With the place not said or "Tampines", the set-apart overseas line appears before the panel GP line.
The Developer's GP-BILL.md says overseas-only lines "go last". The overseas line is correctly qualified ("only if the treatment was abroad"), so this is ordering only. Reported as INFO, it does not fail the run.

## Not covered

No real-model or live-site run. The 58-suite run and the other browser specs were not repeated on 7f4dbd3; this check covers the GP-bill path only.

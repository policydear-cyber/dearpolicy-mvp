# GP-bill checks on the integration head 720f5f5

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | GP-bill acceptance checks (a)-(d), must fail on current code | `720f5f5` (integration head, not a frozen candidate) | done | `acceptance-GP.txt` | product repairs go to the Developer |

Evidence category: **scripted** (ScriptedLoopModel, PGlite, network refused). No model call, no spend, no ledger change.
Ground truth for (a): Policy QC `GP-BILL.md` @88c8953.

`node --import tsx scripts/reliable-chat-pr57-acceptance-test.ts --only=GP`: **AC 2 passed, 7 failed | GUARD 13 passed, 0 failed.**

- Fail now, as asked: GP.a1 (all three variants end in "couldn't confirm" or the error reply), GP.a2 variant C (says the documents were not looked up after the search ran), GP.a4 (OPMC on the certificate, terms not printed, 6 October 2022, contact Aldermoor), GP.a5 (the listed policies named), GP.b1 (the fixture's accident medical-expense benefit is not surfaced).
- Already pass on 720f5f5: GP.a2 variants A and B. They stay AC because they belong to ask (a); they are not evidence of a repair.
- Every GUARD passes, so a repair has to keep "$800" as written, state no absence in the control, keep G1 silent in the four must-not-fire cases (c1-c4) and never quote the Part 1 applicability clause as an exclusion.
- Fixture changes are made in the test copy only and restored after the group: filler pages so the Product Summary (37) and Benefit Summary (9) are fully stored, and an inserted Benefit Summary page 6 for the control.

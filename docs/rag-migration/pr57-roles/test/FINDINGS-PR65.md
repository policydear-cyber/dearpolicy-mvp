# PR #65 (UI/UX polish): final browser check

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | full browser suite and UI suites, failures compared against main | 27af0fd (full run on f874a9d; 27af0fd changes only `components/answer-cards.tsx` and `app/globals.css`) | **pass**: every failure also fails on main 9a76490 | `pr65-final/` | none |

Evidence category: local browser suites on synthetic or anonymised households (dev identity, test-only Auth stand-in, scripted model, local PostgreSQL). No model call, no production data, and no paid run. GitHub Actions is blocked by billing, so all of this ran locally.

## Results

| suite | PR #65 | main 9a76490 |
| --- | --- | --- |
| Auth journeys (desktop, mobile, keyboard, owner-reviewer) | 12 pass, 1 fail, 9 not run | the same step fails: owner-reviewer 11 "no amount" (a product decision, not changed) |
| v11 UX journeys | 7/7 | — |
| Browser suite (dev identity): claim, household, document-unlink, injury-chat | all pass | — |
| Core loop, phase B then A | 2/2 | — |
| Screen render (r8), 102 cases | 101 pass; `/claims/cl-hosp` input 640x23 below the tap size | the same failure on main (`main-r8-claim-screens.txt`) |
| "Open in Documents" tap size (19 px on a27ae43) | fixed: no chat-render failure | — |
| Reliable chat (tan, booklet, actuallib, fracture, deathjourney, dj-live-3, gp-bill) | 33/33 | — |
| rag2 binding, pr50, report | 11/11 | — |
| rag2 livelib L1, s50 replay, s52 replay (old recorded-operand replays) | 3 fail | the same three fail identically on main |
| `v11:customer-screens-test` | 10 pass, 1 fail (`/nextSteps\[0\]/`) | the same failure on main |
| Typecheck | clean on 27af0fd | — |

27af0fd: render 101/102 (the same `/claims/cl-hosp` failure as main), customer-screens the same as main, typecheck clean.

## Not covered

The answer cards only render when an answer carries `statements[]`, which main does not send yet (PR #70). No suite here shows a card. The card fixes in 7bab0a2..27af0fd are therefore checked for typecheck and layout, not for behaviour. A run of PR #65 with PR #70 merged in would cover them.

## Test changes in this push

All changes are test-only. They are listed with their reasons in `EXPECTATION-CHANGES.md` ("Browser specs, PR #65 final round" and "Auth journeys, PR #65 round"). One of them fixes my own PR #67 test (document-unlink set-up), which failed after household-journey on main too.

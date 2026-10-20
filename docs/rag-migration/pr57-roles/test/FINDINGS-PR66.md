# PR #66 ("what do i do now"): Test engineer final check at 114bf7c

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | follow-up journeys (returned = saved = reopened) and GP-bill regression | PR #66 head `114bf7c` (main `ac3216d` merged in) | pass | `pr66/` | none |

Run from a clean worktree of `114bf7c`, with only the new test file added. Scripted only (ScriptedLoopModel through the real `/api/chat` route, PGlite or local PostgreSQL with Chromium, network refused). No model call, no spend.

## Follow-up journeys (`scripts/reliable-chat-pr66-whatnow-test.ts`)

Every turn of every journey is checked returned = saved = reopened (through the history route).

| journey | 114bf7c | main ac3216d |
| --- | --- | --- |
| 1. GP bill, then "what do i do now": the answer's own step comes back, labelled as from the last answer; no S$2,500, no stated requirement | pass | fails ("couldn't confirm") |
| 2. Grace, then "it was Daniel", then "what do i do now": nothing from Grace's answer | pass | pass |
| 3. Death answer, then a question card, then "what do i do now": nothing from the death answer (Critic R17-1) | pass | pass |
| 3c. Control: death answer, then "what do i do now" straight away repeats its step | pass | fails |
| 4. Withdrawn answer: the fracture estimate, its Product Summary deleted, then "what do i do now": "no longer applies", no repeat, no S$1,250 or S$120,000 (Critic R17-3) | pass | pass |
| 4c. Control: the same answer not withdrawn repeats its step | pass | fails |
| Totals | AC 5/5, GUARD 11/11 | AC 2/5, GUARD 11/11 |

Journeys 2, 3 and 4 pass on main too, because main never repeats anything. The controls 3c and 4c show these checks would catch a repeat.
The question card in journey 3 is a "who do you mean" card. The fracture turn's X-ray question is now settled by the server without asking, so it ends as a final answer, not a card.

## GP-bill regression after the main merge

- Scripted (`scripts/reliable-chat-pr64-gp-test.ts`): AC 23/23, GUARD 34/34. This is the same as PR #64's head.
- Browser (`e2e/tests/reliable-chat-gp-bill.spec.ts`): 5/5.

## Not covered

No real-model or live-site run. The 58-suite run and the other browser specs were not repeated on 114bf7c.

# PR #69 (out-of-date marking for reopened answers): test result at 27c78b3

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | DB suites plus a browser journey on a synthetic household | 27c78b3 (main 9a76490 as control) | **fail**: one finding | `pr69/` | none |

Evidence category: scripted browser journey (anonymised actual-library household, scripted model, local PostgreSQL, no model call) plus the PGlite/PostgreSQL regression suites. No production data and no paid run.

## Results

| check | 27c78b3 | main 9a76490 |
| --- | --- | --- |
| `system:test` | 84/84 pass | not run |
| `rag2:deletion-semantics-test` | 9/9 pass | not run |
| typecheck | clean | not run |
| SR1 tibia to hip, reloaded: earlier answer marked `superseded`, alert "Replaced. This answer was replaced by the corrected answer below.", no figure; hip answer keeps S$3,750 | pass | fails (no marking) |
| SR2 Grace removed from the Product Summary, chat reopened: alert reason `person_unlinked` with the right text | pass | not reached |
| SR2 the out-of-date answer shows no figure | **fail** | not reached |
| SR2 control: Daniel's answer on the same document is untouched | pass | not reached |
| SR2 Grace ticked again: her answer comes back with S$3,750 | pass | not reached |

## Finding F69-1: the out-of-date answer still shows its old figure

Reopened, Grace's answer shows its old sentence with the figure directly above the new alert (`pr69/browser-27c78b3.log`):

```
If the Simple Fracture benefit applies to Grace's case "Hip", the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, ...
Out of date.
Someone this answer was about has since been removed from the document it relied on.
```

Cause (read, not changed): the chat page shows the stored `chat_messages.content` (`app/chat/page.tsx`, `message.content`), and the history route (`app/api/chat/history/[id]/route.ts`) only replaces `answer_json`. `invalidatedAnswer()` swaps the summary to the notice, but that summary is not what the page shows. In SR1 the earlier answer's stored first sentence happens to carry no figure, which is why it passes. Its old sentence ("Daniel's documents give two different answers ...") is still shown above the "Replaced." note.

Fix direction: for an invalidated answer, the history route (or the page) shows the notice instead of the stored content. The same probably applies to the existing deleted-document notice; that was not tested here.

## Test added

`e2e/tests/reliable-chat-stale-answers.spec.ts` and `e2e/support/playwright.reliable-chat-stale-answers.config.ts` (loop server, `E2E_RAG2_HOUSEHOLD=actuallib`, seed `--household actuallib`). The figure checks are `expect.soft` so the rest of the journey still reports.

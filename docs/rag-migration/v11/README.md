# V1.1 acceptance records

| Set | Status | First run | Notes |
|---|---|---|---|
| `scripts/fixtures/rag2-release/acceptance-visible.json` (10 conversations, 29 turns) | development set | 0/10 at `09acbbe` | written by an independent author from the rendered synthetic library |
| `scripts/fixtures/rag2-release/acceptance-sealed.json` (6 conversations, 15 turns) | **USED -- no longer a holdout** | 3/6 at frozen `a4b7e57` (`sealed-first-run-frozen-a4b7e57.txt`) | fixes were made after it was opened; a new unseen set is needed to measure generalisation |

All runs in this folder are **scripted-model plumbing/control evidence** (`npm run rag2:v11-test`): they prove the route,
evidence contract, composition, save-time gate and saved state with a stand-in that plays the tool calls. They are not
evidence of the real model's tool choice or wording; no real-model sample has been run for V1.1.

Transcripts: `baseline-09acbbe-scripted.txt` (before), `visible-final-scripted.txt`, `sealed-first-run-frozen-a4b7e57.txt`,
`sealed-final-scripted.txt` (after).

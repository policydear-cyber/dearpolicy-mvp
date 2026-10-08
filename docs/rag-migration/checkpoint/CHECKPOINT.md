# Checkpoint: integrated head 6d75338 (conversational RAG v1-1)

Ran on commit **6d753380** (tree 595ddfb85bf685a890314fc3fa23942483607580; pushed as 38e5330 on
claude/conversational-rag-v1-1). This head is agent F's fixes, agent Radv2's scenario mechanics and review addendum,
and the integration fixes for D28–D31, S7 wording and CI. Run on 2026-10-08 in the Composio sandbox: Debian, 1 CPU,
985 MB RAM plus 2 GB swap, Node v22.20.0, Next ^16.0.0. node_modules was a hard-linked copy (`cp -al`) of a fresh
`npm ci`. No database was configured (`DATABASE_URL` unset), so the suites use their in-process stand-ins. Only
synthetic data and the scripted test model were used. No network calls were made to model providers.

## Commands
Every command ran with `source node22.env; NODE_OPTIONS=--max-old-space-size=2048`, one after another, holding
`flock /home/user/test.lock`.

```
npx tsc --noEmit
npm run -s rag2:tools-test
npm run -s rag2:loop-test
npm run -s rag2:conv-test
npm run -s rag2:calc-test
npm run -s rag2:fix-test
npm run -s rag2:adversarial-test
npm run -s verify:gate-test
npm run -s verify:assertions-test
npm run -s v1:chat-contract-test
npm run -s v1:retrieval-test
npm run -s r6:chat-quality-test
npm run -s r7:answers-test
npm run -s claims:test
npm run -s system:test
npm run -s security:live-chat-monetary-boundary-test
npm run -s security:lifecycle-query-guard-test
npm run -s security:env-contract-test
npm run -s security:ci-workflow-coverage-test
NEXT_TELEMETRY_DISABLED=1 npm run -s build
```

## Results (exit code 0 for every command)
| Command | Result | Time |
|---|---|---|
| npx tsc --noEmit | no errors | 43 s |
| rag2:tools-test | 37/37 passed | 7 s |
| rag2:loop-test | 22/22 passed | 7 s |
| rag2:conv-test | 22/22 passed (integration) | 7 s |
| rag2:calc-test | 38/38 passed | 6 s |
| rag2:fix-test | 35/35 passed | 7 s |
| rag2:adversarial-test | 47/47 passed | 8 s |
| verify:gate-test | 26/26 checks passed | 4 s |
| verify:assertions-test | 27/27 checks passed | 6 s |
| v1:chat-contract-test | 29/29 turns pass | 9 s |
| v1:retrieval-test | 29/29 passed | 7 s |
| r6:chat-quality-test | 254 judged turns, 0 turns with hits | 33 s |
| r7:answers-test | 324 messages in 164 conversations, 0 turns with hits | 44 s |
| claims:test | claim pack regressions passed | 8 s |
| system:test | 80 checks passed (simulated model responses) | 136 s |
| security:live-chat-monetary-boundary-test | 30 cases passed | 1 s |
| security:lifecycle-query-guard-test | passed (0 untracked call sites) | 1 s |
| security:env-contract-test | passed (176 variables documented) | 1 s |
| security:ci-workflow-coverage-test | passed; the sabotage cycle covers rag2:adversarial-test | 0 s |
| npm run build | compiled successfully in 50 s, 59/59 static pages | 112 s |

rag2:adversarial-test and rag2:fix-test are both in .github/workflows/ci.yml and scripts/ci-required-suites.ts.
Code changes needed in this run: none.

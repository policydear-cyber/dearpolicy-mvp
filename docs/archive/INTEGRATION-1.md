# INTEGRATION-1 -- agents C + K + Radv on claude/conversational-rag-v1-1

Base: 6de5c55 (agent C, tree identical to origin claude/conversational-rag-v1-1 @ 3d736fe). Local branch `integ-1` in
/home/user/wt-I. Not pushed (the coordinator pushes). Main unchanged; no deployment; no live DB.

## How it was built
    git -C /home/user/wt-C worktree add /home/user/wt-I 6de5c55 ; ln -s /home/user/wt-A/node_modules node_modules
    git -C wt-K   format-patch ceddcf1..96fea21   # 10 patches; 0010 (DEMO-TRANSCRIPT regeneration) dropped
    sed: patch 0009 retargeted HANDOFF-K.md -> docs/rag-migration/agents/HANDOFF-K.md
    git am -3 K/0001..0009 ; git am -3 Radv/0001..0002

Conflicts (all resolved inside the author's own commit by keeping both sides; any further fixes are separate commits):
- K 6/n: `.github/workflows/ci.yml`, `scripts/ci-required-suites.ts` -- C added rag2:conv-test, K added rag2:calc-test: both kept.
- K 8/n: `scripts/rag2-loop-regressions.ts` N3 -- both agents rewrote it. K's version kept (nights x rate is now refused,
  so C's per_day-with-nights scenario cannot run); C's intent restored in e551089 (the fixture now quotes the household
  verbatim, as C's provenance check requires, so the correction is recorded).
- Radv 1/2: `package.json` -- C's rag2:conv-test and Radv's rag2:adversarial-test / e2e:rag2-conversation all kept.
- lib/rag2/tools.ts, lib/rag2/loop/hook.ts, conversations.ts, rag2-tools-regressions.ts: auto-merged cleanly.

## Commits on top of 6de5c55
K: 82b1803 f5f9fca cfd753a 9337073 edfb41e 8d239b4 ad53de3 edabbec 3276c98 (calc 1/n..9/n).
Radv: d543691 (adversarial suite + browser spec), 376f313 (REVIEW.md).
Integration:
- e551089 resolution: N3 fixture verbatim words; F4 allows scripts/fixtures/rag2-adv (Radv's fixtures import lib/rag2 like the other rag2 fixtures).
- 4c51ce3 resolution: RAG2_ADV_ONLY documented in .env.example (env contract).
- 2a2cd2e K gap: correction note "Updated: bill amount is now 600 SGD (you said 2400 SGD at first)." -- the gate keeps it; N3 expects it and an empty gate report.
- 7c41808 C 1-2: compose.ts householdInputs/calcFactKeys accept only confirmed facts (basis stated or legacy) whose quoted words match the operand's attribution and whose value matches; attributed say-back sentences ("You told me ...", every number and content word from the household's messages, member names / relation words allowed, no cover/payment/approval words) kept without citation. loop-test N3b.
- 2090bb7 C 3: calculate result gains `missing: [{ key, condition_id, ask: household|insurer, why, evidence }]` (admission_datetime / discharge_datetime when the day-count rule or minimum stay needs them, bill_amount, exclusion condition ids; day-count rule / deduction order / definition are ask=insurer). The loop keeps the latest per person and refuses any other fact question until the first open household item is asked (one at a time; because_evidence_ids default to the item's evidence). Calculate estimates now also wait for "how it happened" like compute estimates. loop-test N3c.
- 95142f3 K 3: system prompt v3 (LOOP_PROMPT_VERSION rag2-loop-v3; conv-test expectation updated): calculate for benefit/claim amounts with dates as given; never compute per_day/product with household nights/days; ask the calculator's missing items one at a time; insurer items stated not asked.
- 46be237 C 4: tables.ts -- a person named in a labelled list ("Insured children: A; B") takes the list's class when choosing a column. tools-test T10 extended.
- c2be6df DEMO-TRANSCRIPT.md regenerated (npm run rag2:loop-demo).
- (this file)

## Test results (final run, /home/user/integ1-out/r2; Node 22, NODE_OPTIONS=--max-old-space-size=2048, flock /home/user/test.lock)
| suite | before integration fixes (r0) | final |
|---|---|---|
| npx tsc --noEmit | pass | pass |
| rag2:tools-test | 36/37 (F4) | 37/37 |
| rag2:loop-test | 19/20 (N3) | 22/22 |
| rag2:conv-test | 22/22 | 22/22 |
| rag2:calc-test | 35/35 | 35/35 |
| rag2:adversarial-test | 25/46 | 25/46 (allowed to fail) |
| verify:gate-test | 26/26 | 26/26 |
| verify:assertions-test | 27/27 | 27/27 |
| v1:chat-contract-test | 29/29 | 29/29 |
| r7:answers-test | pass | pass |
| claims:test | pass | pass |
| system:test | 80 checks pass | pass |
| security:live-chat-monetary-boundary-test | pass | pass |
| security:lifecycle-query-guard-test | pass | pass |
| security:env-contract-test | FAIL (RAG2_ADV_ONLY) | pass |
| security:ci-workflow-coverage-test | pass | pass |

rag2:adversarial-test is not in ci.yml / ci-required-suites (it fails by design until the REVIEW.md defects are fixed).

## Adversarial suite (Radv), final: 25/46 (base before C/K: 17/46)
PASS: S1 S1b S1c S2.1 S2.2 S3.1 S3.2 S4.1 S4b.1 S4b.2 S5.1 S5.2 S5.3 S5.4 S6b.1 T9 S9 V9 T10 X2 X3 X5b X8 X9 Z
FAIL (defect): S2.3 (D7) S3.3 (D19) S4.2 S4.3 (D9) S7 (D18) S6a S6a' (D9/D16/D18) S6b.2 (D19) S8 S8b (D4/D24)
S10 soft_deleted, S10 superseded (D6) X1 (D1) X4 (D3) X5 (D5) X6 (D14) X7 (D15) X10 (D8) U1 (D21) U2 (D23) U3 (D22)

Notes on expectations (not changed; no Radv test was weakened):
- S3.3, S6b.2, S7, S8, S8b script `compute` (per_day / min_cap / deductible) rather than K's `calculate`; with K's
  contract compute refuses household nights, so these can only pass once the scenarios use calculate (the
  "interface-dependent" checks Radv flagged) or compute gains a day-count operation. The behaviour they ask for
  (policy day-count rule, specific missing requirement) now exists via calculate + `missing`.
- U1/U3: C's usage meter caps and records only hosted models (`model.kind === "hosted"`); Radv's scripted model is not
  hosted, so the spend cap and model_usage/model_executions rows are skipped. conv-test covers both with a fake-fetch
  hosted adapter. Either the adversarial fixture should present itself as hosted (with a choice), or U1's household
  spend-cap check should apply to every model; recommend the latter for U1 (cheap, safe) and the fixture change for U3.

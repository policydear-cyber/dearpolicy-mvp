# DearPolicy — conversational RAG migration: handoff

Branch: `claude/conversational-rag-v1-1` (private repo policydear-cyber/dearpolicy-mvp).
Main is NOT changed by this branch (main = `42bcac1ab10f722cf51ff442ff7bc6b5aabc21de`, verified 2026-10-08).
No deployment or live migration is authorised. Branch pushes create Vercel Preview deployments,
which are SSO-protected and receive only non-secret Preview settings (MODEL_PRESET, RAG_* tuning);
no production database, storage, Supabase or model credentials are configured for Preview.

## Objective
Replace the growing collection of specialised chat answer handlers with one model-driven conversation
loop over common retrieval tools, keeping three safety foundations:
- evidence identities — every stated figure carries its own binding (policy, document hash, person,
  benefit row, table column, page range, verbatim passage) and is re-checked by the save-time gate;
- shared table selection — policy/version → row → column kind → the person's applicable column;
  ambiguous → clarify; unknown → explicit missing information; never "a number elsewhere on the page";
- deterministic calculations — integer cents, policy-defined units/rounding/caps; printed limit ≠
  indicative estimate ≠ payout; estimates never enter totals.

## Architecture (all behind flags, default off)
- `lib/chat/answer-verification.ts` — save-time gate (rules: no user-number exemption; per-sentence
  FigureBinding; explicit ComputationRecord for any computed figure). Existing producers attach bindings.
- `lib/rag2/` (flag `DEARPOLICY_RAG_TOOLS`) — tools: search_passages, read_page, resolve_person,
  policies_for, select_table_value, compute; every result carries EvidenceRefs.
- `lib/rag2/loop/` (flag `DEARPOLICY_RAG_LOOP`) — one loop: the model calls tools, `note_facts`,
  `ask_user` (one question, must cite why it matters, never re-asks a recorded fact) and
  `final_answer` (every sentence cites evidence/value/result ids). The composer binds each sentence and
  the existing save-time gate verifies it; unbindable sentences are dropped with a note.
  Hook: two guarded lines in `lib/chat/workflow.ts`.

## Commits on this branch (head `f8cf4f6e231e7cab9a04d5a3536d9826ce82cfad`)
| Commit | Content |
|---|---|
| 87c6071 | checkpoint 1: this handoff (first version) |
| 8d684a0 | checkpoint 2: `eval/r15-used/` used regression set (see Artifacts) |
| 6929d80 | gate rules 1-3, part 1 (rebuilt) |
| 7e9e429 | gate part 3: deterministic catalogue order + one ledger row per fact (r9 flake; v1:retrieval R6) |
| ce152b0, 5656f7f, ebf32e7, fc70405 | gate part 2: producers attach bindings / computation records |
| 7feec8c … d5cc24e | Prompt 1: lib/rag2 retrieval tools + rag2:tools-test |
| 8bb00f5 … f8cf4f6 | Prompt 2: lib/rag2/loop, flagged hook, rag2:loop-test, rag2:loop-demo, DEMO-TRANSCRIPT.md |

## Verification (run in the sandbox, Node 22, NODE_OPTIONS=--max-old-space-size=2048, PGlite)
Commands: `npx tsc --noEmit`; `npm run -s <suite>` for each suite below.
Results on the loop head (local 7ac1312 = remote f8cf4f6, identical tree 47f0061a):
tsc clean; rag2:tools-test 37/37; rag2:loop-test 20/20; verify:gate-test 26/26;
verify:assertions-test 27/27; v1:retrieval-test 29/29; v1:chat-contract-test 29/29;
r7:answers-test and r6:chat-quality-test 0 guard interventions; claims:test pass; system:test pass;
security:lifecycle-query-guard / env-contract / ci-workflow-coverage pass.
Earlier on the gate head (fc70405): r7:chat-robustness, r9:ingest-chaos ×2, r10:messy-docs, r11:blind pass.
Not yet run on the loop head: the full CI list, e2e browser suites, build.

## Demonstration
`npm run rag2:loop-demo` → `DEMO-TRANSCRIPT.md` (repo root). SCRIPTED TEST MODEL ONLY — it shows the
tools, evidence selection, gate and state handling; it does not show how a real model behaves.

## Known failures / gaps
1. Never run with a real model (no Preview OPENAI_API_KEY yet). Loop model calls are not yet in usage /
   spend accounting or the per-household cap — must be added before any real use.
2. Hospital-cash estimate ignores the printed condition "payable from the first full day of admission"
   (nights × daily rate) — conditions from select_table_value are not yet applied by compute. Must fix
   before estimates are shown to anyone.
3. Estimates the gate can verify: per-day × household count, or a cap equal to a printed figure.
   Deductible / co-insurance / cap on the household's bill produce no ComputationRecord and are dropped
   (e.g. the S$800 per-fracture medical estimate is not given).
4. Search passages are whole pages (coarse citations).
5. Loop does not create claim records/cards; interruption/correction state lives only in the loop.
6. Gate: no "adult" person class; merged-heading column reads can wrongly reject (see agent B notes).
7. No evaluation tooling on this branch yet; the old evaluator and its results were lost.

## Lost historical work (unrecoverable — historical reports only)
Development sandbox reset 7 and 8 Oct 2026; Composio download links used as "backups" expired.
Lost with no code or raw results: d3e0423, a6345da, fd0fc92, 323f1d5, ce72eab, 7e36490, dd1883b
(69-commit candidate), all evaluation tooling/rubrics/raw outputs, the 6 Oct sealed holdout
(49c8a074…) and its 7 Oct re-creation (2edbcef5…) — neither opened by developer agents.
Their reported results (e.g. dd1883b strict 255/873) are claims without evidence; none of their fixes
are assumed present. The current gate/tools/loop are new implementations, not restorations.

## Durable evaluation artifacts
- `eval/r15-used/` (this branch): used regression set H4/H5/H6, 873 items — generators, score.py,
  manifests, batteries, extracted page text, PROVENANCE.md. PDFs regenerate (ALL FACTS VERIFIED).
  SHA-256: H4/manifest 39e2915a…, H5/manifest e3c3a970…, H6/manifest a3445d7e…,
  H4/battery 61f753c4…, H5/battery 934804f6…, H6/battery 501b62e4…; extracted text (concatenated)
  57be9982…. Baseline for main 663611e under score.py: 254/873 (deterministic, reproduced twice).
- No sealed holdout exists now. A future holdout must be created and stored outside developer-agent
  access (not this repo, not the shared sandbox).

## Next steps
1. Fix gap 2 (apply printed conditions in compute) and add deterministic cap-on-bill records (gap 3).
2. Wire loop model calls into usage/spend accounting and the household cap.
3. Rebuild evaluation tooling into `eval/tools/` with a configuration ID; re-run the r15 baseline on
   main and the branch under one configuration; keep raw outputs in the branch (compact).
4. Real-model sample once a Preview-only, spend-capped OPENAI_API_KEY exists.
5. New sealed holdout outside developer access before any final evaluation.

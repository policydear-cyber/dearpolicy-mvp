# DearPolicy — conversational RAG migration: handoff

Branch: `claude/conversational-rag-v1-1` (private repo policydear-cyber/dearpolicy-mvp).
Main is NOT changed by this branch (main = `42bcac1ab10f722cf51ff442ff7bc6b5aabc21de`, verified 2026-10-08).
No deployment or live migration is authorised. Branch pushes create Vercel Preview deployments,
which are SSO-protected and receive only non-secret Preview settings (MODEL_PRESET, RAG_* tuning);
no production database, storage, Supabase or model credentials are configured for Preview.

## State (integration round 2, 2026-10-08)
- Integrated on the branch: gate + retrieval tools + loop (first prompts), agent C (loop state, fact provenance,
  usage meter), agent K (calculator `calculate`, day-count rules, claim record), agent Radv (adversarial suite),
  agent F (fix round, D18–D27, rag2:fix-test), agent Radv2 (adversarial mechanics on current interfaces, `rag2:demo10`,
  REVIEW.md addendum D28–D31), and integration fixes D28, D29, D30, D31 and the S7 wording (see INTEGRATION-1.md and
  the commit table below).
- Every listed suite, `tsc` and `next build` pass on 6d75338 (docs/rag-migration/checkpoint/CHECKPOINT.md).
  The adversarial suite is 47/47 and is now a required CI suite.
- Everything is behind flags, default off. All demonstrations use the SCRIPTED TEST MODEL; no real model has run.

## Objective
Replace the growing collection of specialised chat answer handlers with one model-driven conversation
loop over common retrieval tools, keeping three safety foundations:
- evidence identities — every stated figure carries its own binding (policy, document hash, person,
  benefit row, table column, page range, verbatim passage) and is re-checked by the save-time gate;
- shared table selection — policy/version → row → column kind → the person's applicable column;
  ambiguous → clarify; unknown → explicit missing information; never "a number elsewhere on the page";
- deterministic calculations — integer cents, policy-defined units/rounding/caps; printed limit ≠
  indicative estimate ≠ payout; estimates never enter totals.

## Implemented paths (all behind flags, default off)
| Path | What |
|---|---|
| `lib/chat/answer-verification.ts` | save-time gate: per-sentence FigureBinding, CalculationRecord re-run (`calcVerdict`), `requirementFor` (specific failure for resolved records, "I still need" only for unresolved) |
| `lib/rag2/` (flag `DEARPOLICY_RAG_TOOLS`) | tools.ts, search.ts (BM25 over paragraph/six-line passages), tables.ts, people.ts, policies.ts, evidence.ts, compute.ts |
| `lib/rag2/calc/` | `calculate` tool: terms.ts (reads policy wording: units, caps, deductible, order of deductions, day-edge exceptions), engine.ts (integer-cent calculation, conditions, unresolved requirements), tool.ts, claim-record.ts (claim via existing workflow, never with an amount) |
| `lib/rag2/loop/` (flag `DEARPOLICY_RAG_LOOP`) | loop.ts, actions.ts, facts.ts (provenance, `confirmed`, `knownFactFor`), questions.ts, compose.ts (binding, attribution of household figures), prompt.ts, usage-meter.ts (every call metered, ledger + model_executions), hosted-model.ts, scripted-model.ts (test only), hook.ts (two guarded lines in `lib/chat/workflow.ts`) |
| `lib/claims/day-count.ts`, `lib/claims/calc-record.ts` | day-count rules (first_full_day / completed_24h / per_night / calendar_day_inclusive, stated edge exceptions); deterministic recompute of every calculation record |
| `lib/ai/usage.ts` | loop limits (`loopLimits`), household monthly loop allowance, run budget |

## Commits of integration round 2 (on base f7c13d6 = remote fb2fc96)
| Local sha | Tree (prefix) | Content |
|---|---|---|
| e3e5b53 | 22617fac | Radv2: adversarial mechanics on current interfaces + `npm run rag2:demo10` |
| fd6122e | cb00b1d8 | REVIEW.md addendum D28–D31 |
| 5f98cd4 | e494a40f | D28 order of deductions follows the wording (calc-test B8) |
| 4bee2e4 | 695dd5eb | D29 no false "I still need" for resolved records |
| b6dfa0b | ab3fd5f8 | D30 first-full-day exceptions from the wording (calc-test D3, H10) |
| f0dce87 | 8cee95b7 | D31 cause question answered by a how_it_happened fact (fix-test F31) |
| c9215a8 | a0f50a2c | S7 wording: household bill figure attributed (calc-test C1) |
| a82e23d | 050da170 | CI: rag2:adversarial-test required |
| 6d75338 | 595ddfb8 | browser spec S3 mechanics (remote 38e5330) |
| 1b6d483 | 45089569 | checkpoint/CHECKPOINT.md (remote 76e3c33) |
| 5c65182 | 624496ee | checkpoint/DEMO10.md + EXPECTED-VS-ACTUAL.md |

## Verification — commands and results (6d75338; details in checkpoint/CHECKPOINT.md)
Environment: sandbox, Node 22, `NODE_OPTIONS=--max-old-space-size=2048`, PGlite for suites.
Commands: `npx tsc --noEmit`; `NEXT_TELEMETRY_DISABLED=1 npm run -s build`; `npm run -s <suite>`.
- tsc clean; build 59/59 pages.
- rag2:tools-test 37/37; rag2:loop-test 22/22; rag2:conv-test 22/22; rag2:calc-test 38/38; rag2:fix-test 35/35;
  rag2:adversarial-test 47/47.
- verify:gate-test 26/26; verify:assertions-test 27/27; v1:chat-contract-test 29/29; v1:retrieval-test 29/29.
- r6:chat-quality-test 254 turns, 0 hits; r7:answers-test 324 messages / 164 conversations, 0 hits.
- claims:test pass; system:test 80 checks; security:live-chat-monetary-boundary-test 30 cases;
  security:lifecycle-query-guard-test, security:env-contract-test, security:ci-workflow-coverage-test pass.
- Not run in this round: the other e2e browser suites; r8–r11 suites (last run on the gate head fc70405).
- Browser: reviewer spec `e2e/tests/rag2-conversation.spec.ts` — see checkpoint/BROWSER.md once written
  (slice 2c). Earlier partial run: S1, S2 pass; S3 failed on mechanics only (fixed in 6d75338); 4 not run.

## Decisions
- **D28 / S7 — order of deductions.** The calculator applies the excess/deductible and the limit in the order the
  policy wording states (terms.ts `limitOrder`: "limit first" or "deductible from the limit"). If the wording is
  silent or contradictory, and the order changes the result, the calculation is UNRESOLVED and the answer says what
  is unclear; it never picks an order. If both orders give the same figure (S7b: S$1,000 bill → S$900), the
  estimate is given. Adversarial S7: S$1,500 bill, stated order → S$1,100.
- **S7 wording.** An indicative-estimate sentence attributes the household's own figure ("the S$1,500 bill you
  mentioned"); printed policy figures are never attributed to the household; the gate is unchanged. The rendered
  estimate notice ("not a payout") stays.
- **D29.** A resolved calculation that fails save-time verification is replaced by the specific failure ("… could
  not be verified against your documents, so I left it out"), never by "I still need information".
- **D30.** First-full-day exceptions (e.g. admission before 12:00 noon counts) are applied only when stated, with
  their passage, recorded on the step and checked by the gate; never assumed.

## Demonstration
- `npm run rag2:demo10 -- --out docs/rag-migration/checkpoint/DEMO10.md` → integration transcript (10 scenarios).
- `npm run rag2:loop-demo` → `DEMO-TRANSCRIPT.md` (repo root; older).
Both are SCRIPTED TEST MODEL only: they show tools, evidence selection, calculation, gate and state handling, not
how a real model behaves. All data is synthetic.

## Known failures / gaps
1. Never run with a real model (see the minimum secure configuration below — not yet available).
2. Browser spec not yet fully run against `next build` + `next start` (slice 2c pending).
3. `npm run db:setup` does not apply all SQL the app needs (v11-ingestion-evidence.sql, model-provenance.sql,
   rate-limit.sql, background-jobs.sql — e.g. `policy_members.benefit_tier` missing); being added in slice 2c.
4. Claim records from the loop carry no amount by design; claim amounts still come only from the claims workflow.
5. tables.ts stepchild: a schedule naming the stepchild only in a sentence yields `ambiguous` with one option
   (HANDOFF-C item 4).
6. Gate: no "adult" person class; merged-heading column reads can wrongly reject (agent B notes).
7. No evaluation tooling on this branch; the old evaluator and its results were lost (below).

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

## Artifact paths
- `docs/rag-migration/checkpoint/` — CHECKPOINT.md, DEMO10.md, EXPECTED-VS-ACTUAL.md (BROWSER.md after 2c).
- `docs/rag-migration/agents/HANDOFF-K.md`; repo root: `HANDOFF-C.md`, `INTEGRATION-1.md`, `REVIEW.md` (D1–D31),
  `ARCHITECTURE.md`, `DEMO-TRANSCRIPT.md` (repo root).
- Suites: `scripts/rag2-{tools,loop,conv,calc,fix,adversarial}-regressions.ts`; demos `scripts/rag2-demo10.ts`,
  `scripts/rag2-loop-demo.ts`; fixtures `scripts/fixtures/rag2`, `rag2-loop`, `rag2-conv`, `rag2-calc`, `rag2-adv`.
- Browser: `e2e/tests/rag2-conversation.spec.ts`, `e2e/support/playwright.rag2.config.ts`,
  `e2e/support/rag2-loop-server.ts`, `e2e/support/seed-rag2-conversation.ts`.
- CI: `.github/workflows/ci.yml`, `scripts/ci-required-suites.ts`.
- `eval/r15-used/` (see Durable evaluation artifacts).

## Minimum secure configuration for a small real-model test — NOT YET AVAILABLE
Agent C's "section G" is not in the repository; this is the configuration it describes, from the code and
`.env.example`. It is not available today: there is no Preview-only OpenAI key and no throwaway synthetic database.
1. A Vercel Preview (SSO-protected) or local run only; never Production. Leave `DEARPOLICY_RAG_TOOLS_ALLOW_PRODUCTION`
   and `DEARPOLICY_RAG_LOOP_ALLOW_PRODUCTION` unset.
2. A NEW, throwaway Postgres with the full schema and only synthetic households (e2e/support seeds); no production
   data, storage or Supabase credentials.
3. A Preview-scoped `OPENAI_API_KEY` from a separate project with a provider-side monthly spend limit (a few US$);
   `MODEL_PRESET` set; `DEARPOLICY_DETERMINISTIC_MODEL` unset.
4. `OWNER_PROVIDER_BUDGET_USD` small (e.g. 5 → per-turn cost clamped to US$4), and the loop limits at or below their
   defaults: `DEARPOLICY_RAG_LOOP_MAX_STEPS=12`, `_MAX_TOKENS=80000`, `_MAX_OUTPUT_TOKENS=2000`,
   `_MAX_TURN_USD=0.05`, `_HOUSEHOLD_MONTHLY_USD=1`, `_RUN_MAX_CALLS=150`, `_RUN_MAX_USD=0.50`, `_RETRIES=1`,
   `_CALL_TIMEOUT_MS=45000`, `_TURN_TIMEOUT_MS=120000`.
5. `DEARPOLICY_RAG_TOOLS=1`, `DEARPOLICY_RAG_LOOP=1` only on that Preview / local environment.
6. Every call is metered (usage-meter.ts → model_usage ledger + model_executions); review the ledger after the run.
7. Delete the database and revoke the key after the test.

## Next steps
1. Slice 2c: browser spec one test at a time on `next build` + `next start`, db:setup fix, BROWSER.md.
2. Provide the Preview-only spend-capped key and throwaway synthetic database, then a small real-model sample of
   the ten demo scenarios under the configuration above; record raw transcripts on the branch.
3. Rebuild evaluation tooling into `eval/tools/` with a configuration ID; re-run the r15 baseline on main and the
   branch under one configuration.
4. New sealed holdout outside developer access before any final evaluation.
5. Remaining gaps 5–6 above.

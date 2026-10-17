# Actual-library repairs (after d549a27)

This PR is a focused repair of the five findings from the actual-library check; it is not a feature round.

- **Base:** `main` at `d549a27996c10ca2ad69ec80234fecf8070dc610`, verified before branching. It contains PR #52 and #53.
- **Branch:** `claude/actual-library-repairs`.
- **Unchanged:** main, production, uploaded documents, environment variables and migrations.

**Reproduction.** I did not read the production traces. The read was refused, and I did not try to get round that.
Instead, each finding is reproduced from the report with an anonymised household that has the reported structure
(`scripts/fixtures/reliable-chat/booklet.ts`):

- a generic "Group Insurance Benefits Booklet" holding Term Life and Personal Accident;
- a certificate with identical amounts for two people;
- a superseded certificate;
- another household's copy;
- a page-9 "Compassionate Death Allowance Benefit" heading above a wrapped paragraph with a bare `$2,000`.

The reported model calls are replayed as scripted moves (`booklet-conversations.ts`). No real household data is in the
repository.

## What changed, and where

| finding | repair (general, not phrase-matched) | files |
|---|---|---|
| 1. The clarification failed: `ask_user` had no fact_key or subject_id, the refusal loop used up the budget, and the household saw the generic limit text | `evaluate_benefit` → `needs_facts` / `case_conflict` now creates a **server-owned requirement** (id `q<turn>_<n>`, person, benefit, state key, question, options, evidence). `ask_user requirement_id=` selects it, and the server supplies the person, fact and evidence. Unknown, stale or mismatched (person / fact) requirements are refused. An `ask_user` with no fact_key binds only to the single open requirement whose evidence fits; otherwise it is refused as before. If model use is blocked while a requirement is open, the server asks it and shows that benefit's verified terms. When the household answers the case question, only that answer's words settle the case, so the uncertain report no longer conflicts. | `lib/rag2/loop/loop.ts`, `types.ts`, `actions.ts`, `prompt.ts` (v17) |
| 2. Other Fracture's "Sum Insured" was left unresolved in a generic booklet | The base binds to the **product section** the table is printed under. That is the nearest heading above it, across earlier pages, that names exactly one of the person's own certificate products. The value is that person's row for that product. It is never chosen by being first, the largest, or by policy number. Simple Fracture keeps its fixed S$5,000 base. If no section can be established, the answer names the missing link ("does not print this table under one of Daniel's certificate products (…)"). The contradictory "unresolved … then all percentages use the PA amount" is removed. | `lib/rag2/benefit-records.ts`, `calc/tool.ts`, `evaluate.ts`, `tools.ts`, `loop/statement-render.ts` |
| 3. The Compassionate Death Allowance was rejected | A heading and the paragraph under it verify as **one benefit** (`lib/rag2/headings.ts`: heading detection and wrapped paragraphs). A bare `$` is never treated as SGD. It is said as "2,000 (printed with a “$” sign; the document does not say which currency)", unless the same document prints *the same benefit* with an explicit currency, in which case that line is cited. The supported terms are kept rather than the benefit being dropped. | `lib/rag2/headings.ts`, `loop/compose.ts`, `loop/hook.ts` |
| 4. Unfinished clauses ("…, which"), echoes, and stale repair messages | Clauses are read as whole sentences across wrapped lines; a quotation is used only when it is complete and short, otherwise a supported paraphrase. Say-backs already quoted by the answer are dropped. Calculations are listed first. Repair messages follow the `evaluate_benefit` contract. | `lib/rag2/benefits.ts`, `loop/hook.ts`, `loop/compose.ts`, `loop/loop.ts` |
| 5. Latency | One record resolution per person per turn (`recordsFor`). The state note lists benefits already evaluated, so a later turn re-evaluates by `benefit_id`. The first step batches resolve_person, note_facts and person_benefits; a lookup after an ambiguous mention is still refused. Token limits and retries are unchanged. | `lib/rag2/tools.ts`, `loop/prompt.ts`, `loop/loop.ts` |

`scripts/case-selection-conflicts-regressions.ts` was renamed to `scripts/reliable-chat-case-selection-regressions.ts`.
The old file name made `rag2:tools-test` (F4 import boundary) fail on main.

## Before / after visible answers

These are the scripted replays of the reported calls through the real chat route, on the booklet household.

**BK1, turn 1:** "Daniel fell off a ladder at home. The doctor says he fractured his hip, or possibly his tibia - they are not sure yet. It is a closed fracture. What can his accident cover pay?"

- Before (12 model steps, 9 `ask_user` refusals, stopped by `turn_calls`):
  ```
  Civil Service Group Insurance Scheme - Certificate prints “Group Personal Accident” as S$300,000.
  I stopped before finishing because this question reached its model-use limit. I didn’t get as far as working out an amount for what you described, so I haven’t given one.
  ```
- After (the same calls, 4 steps, 0 refused; the ask without fact_key binds to requirement q1_1):
  ```
  The Group Insurance Benefits Booklet (page 7) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Skull 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%; Arm, Wrist or Elbow 40%.
  Was it Daniel's hip or his tibia that was fractured?
  ```
- After, with model use blocked: the server asks the requirement itself, with the same terms, and the question "Which of these cases is it: Hip or Jaw, Pelvis, Leg, Ankle or Knee?".

**BK1, turn 2:** "The scan confirms it was his hip."

- Before: `case_conflict`, then a model error.
  ```
  I couldn’t finish: the assistant model returned an error, so I stopped before answering rather than guess. …
  ```
- After (the case question is cleared and the calculation recomputes to S$3,750):
  ```
  If the Simple Fracture benefit applies to Daniel's case “Hip” (as you described: “The scan confirms it was his hip.”), the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
  Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
  ```

**BK2:** "Daniel's hip fracture turned out to be a compound (open) fracture. What would the Other Fracture benefit pay?"

- Before:
  ```
  The Group Insurance Benefits Booklet (page 8) pays the Other Fracture as a percentage of “Sum Insured” for each listed case: Skull (Other Fracture) 100%; Hip (Other Fracture) 75%; Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%.
  ```
- After (recomputes; base = Daniel's own Group Personal Accident row on the certificate; Grace gets her own row):
  ```
  If the Other Fracture benefit applies to Daniel's case “Hip (Other Fracture)” (as you described: “hip fracture turned out to be a compound (open) fracture”), the conditional illustration is S$225,000: 75% of Daniel's sum insured of S$300,000 (Group Personal Accident), under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
  ```
- After, with no product headings: no amount is chosen, and the answer names the missing link.

**BK3:** "If Daniel died in an accident, is there anything to help with funeral costs?"

- Before:
  ```
  I haven’t stated the amount for If an Insured Person sustains bodily injury as a result of an Accident, which in Group Insurance Benefits Booklet (page 9), because the currency didn’t match what the document prints.
  ```
- After:
  ```
  The Group Insurance Benefits Booklet's Compassionate Death Allowance Benefit pays the funeral expenses incurred, up to 2,000 (printed with a “$” sign; the document does not say which currency), if Daniel dies as a result of an Accident within 365 days, on receipt of proof of death and the original receipts.
  ```

The real-model answers are in [LIVE-RESULT-rc-live-5.md](LIVE-RESULT-rc-live-5.md) and its grade file, verbatim.

## Checks

**Completed** (sandbox, Node 20.20.2, on the tested tree `523efea`):

- `tsc --noEmit` is clean, and `next build` succeeds.
- `npm run reliable-chat:booklet-test` passes all four variants (default 26/26, related currency 24/24, unrelated 26/26,
  no sections 21/21) and batched steps 2/2. Its controls cover:
  - wrong person, unknown requirement, wrong fact and stale requirement: all refused;
  - identical amounts for two people: each person's own row is used;
  - superseded certificate: never the base;
  - adjacent section (Repatriation $5,000): never attached to the allowance;
  - S$ asserted from a bare $: dropped;
  - complete clauses only.
- 102 of the 103 CI steps from `verify:assertions-test` onward pass. This covers every `reliable-chat:*` and `rag2:*`
  suite, including grader controls, correction, wrong-person, `security:*` and `launch:check`. The exception is
  `security:env-contract-test`:
  - it fails on main too, with 24 undocumented test-only names from earlier PRs;
  - this PR documents its own two (`BOOKLET_CURRENCY`, `BOOKLET_SECTIONS`) in `.env.example`, so the count is back to
    main's 24.
- Earlier CI steps: `npm ci`, `typecheck` and `system:test` pass. The remaining claims / v1 / r-series steps were not
  re-run here; this PR does not change those areas.
- Browser checks (real chat page, `next build`, local PostgreSQL):
  - `e2e:reliable-chat-booklet` 3/3: BK1 ambiguity → one question → S$3,750, question cleared; BK2 S$225,000;
    BK3 allowance kept with no S$ and no cut clause;
  - `e2e:reliable-chat` 3/3 (RC1–RC3, including correction withdrawing the old illustration);
  - `e2e:rag2-pr50` 3/3.
- Latency script `scripts/reliable-chat-latency.ts` (application time with a zero-time model):
  - about 100–150 ms per turn;
  - reported BK1 turn 1 before: 12 model steps / 9 refused; after: 4 / 0.
- One real-model run (rc-live-5) on the frozen candidate: see [LIVE-RESULT-rc-live-5.md](LIVE-RESULT-rc-live-5.md).

**Blocked:**

- Reading the production traces and library (access not authorised). The fixtures follow the report instead.
- GitHub Actions: no job started for main or for this branch ("recent account payments have failed or your spending
  limit needs to be increased"). Every result above is from the sandbox.

## Remaining limitations

1. **BKL1 turn 2 (live, 2/2):** after the correct S$3,750, the model also evaluated Other Fracture for a closed fracture
   and asked an insurer-only question.
   - The server has no open/closed applicability test from the booklet's own definitions, and does not enforce "never
     ask what only the insurer can answer".
   - This is the next repair. A naive carry-over of the clarification to other benefits would show S$225,000 for a
     closed fracture, so it was deliberately not done.
2. **BKL3 (live):** a model-written caveat claimed the documents do not confirm Daniel's enrolment. The certificate lists
   him. Statements about enrolment are not yet verified against the person's certificate rows.
3. **The heading search for percentage bases** only covers tables. A paragraph benefit (the allowance) has no product
   binding, so its applicability to the person is stated loosely.
4. **A model sentence asserting S$ from a bare $ is dropped whole.** It is not rewritten into the bare-$ form. The safe
   form is produced only when the model writes `$`.
5. **The fixtures are anonymised reconstructions.** The real booklet's layout (OCR, table extraction) may differ.
6. **The sample is tiny:** 4 conversations and one run. It supports no reliability rate, and certainly not 99%.

## Release recommendation

**Do not release yet.** Findings 2, 3 and 5 are fixed and were verified live:

- BKL2 was correct and useful;
- BKL3 kept the allowance with honest currency;
- latency fell from 12–38 s to 7–13 s per turn.

Finding 1 is fixed at the boundary: the question is asked, the clarified amount is correct and nothing is refused. The
full uncertain-fracture conversation still ends with an unnecessary, unanswerable question in 2/2 live attempts.

Next steps:

1. Fix limitation 1: server-side fracture-type applicability, and refusing requirements the household cannot answer.
2. Fix limitation 2.
3. Run one more small pre-registered live check before release.

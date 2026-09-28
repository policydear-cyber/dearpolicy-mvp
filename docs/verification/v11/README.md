# V1.1 independent release evaluation (workstream 5)

Everything here is synthetic and runs only against the local stack (local Postgres, local storage,
fake VirusTotal, the test-only Auth stand-in, and the deterministic model stand-in
`DEARPOLICY_DETERMINISTIC_MODEL=synthetic-e2e`). Production is never touched.

## Files

| Path | What it is |
|---|---|
| `e2e/support/v11-dataset.ts` | The reviewed synthetic dataset: 17 documents (16 for household A, 1 for household B) rendered at runtime, the people, the upload order, the evaluation questions with their expectations, and the Task 6 coverage matrix. |
| `docs/verification/v11/eval-set.json` | Machine-readable export of the same (documents with the printed text of every page, 28 questions with answerable/forbidden assertions, citations, required next question, whether an amount is allowed, positive controls). Regenerate with `--export`. Names carry the run's `SYNTHETIC-DPTEST-<run id>` prefix, so they differ per run. |
| `scripts/v11-eval-score.ts` | The scorer: release gates applied to one answer set. |
| `scripts/v11-eval-run.ts` | `--api` (in-process run: real ingestion + real chat route), `--score <answers.json>` (browser transcript), `--export <dir>`, `--usage --since <iso> --journey <journey.json>` (model calls and cost for a run from `model_executions`). |
| `scripts/v11-eval-task0.ts` | The eight Task 0 live defects as executable checks (T0-1, 2, 3, 4, 5, 7 in-process; T0-4/5/6/7/8 on rendered pages in the journey). |
| `e2e/tests/v11-journey.spec.ts` + `e2e/playwright.v11.config.ts` | The full browser journey with real sessions: sign-up/sign-in (T0-8), family, uploads and processing, linking, factual questions, the claim interview through its final response, evidence review with a DearPolicy reviewer, the final answer, the reopened conversation, supersession and deletion, Task 0 page checks, household B, both households deleted in the app. |

## Release gates (scripts/v11-eval-score.ts)

| Gate | Fails when |
|---|---|
| `unsupported_amount` | an amount is shown that the question does not allow, or is shown without its source page cited (an amount printed on a page of the person's own current document counts as supported only with that page cited) |
| `unsupported_assertion` | a forbidden assertion appears; an expected material assertion is made without citing its passage page; one of two contradictory values is chosen; an amended or expired term is presented as current |
| `cross_scope` | another person's or household's document or amount is used |
| `deleted_superseded` | a deleted (after deletion) or superseded document or value is used |
| `blocked_gap` | a blocked answer does not explain the specific gap, or turns "not found" into "not covered" |
| `positive_control` | a positive control is not answered correctly with its citation |
| `internal_text` | model/provider names, quota or org text, raw errors, storage keys, rule/page counts, reader status, routine repair tasks ("Re-analyse", "fix a row", "confirm this heading") in chat or on the documents list |
| `fact_finding` | the claim interview asks out of order, repeats a question, asks several at once, does not finish; a claim event is named after a reply; the claims list says "Assessment ready" without an evidence-backed estimate; a reopened conversation differs |

## Commands (serialise with `flock /home/user/test.lock`; Node 22)

```
. /home/user/node22.env; source /home/user/e2e.env; export E2E_RUN_ID=<fresh id>
node --import tsx scripts/v11-eval-run.ts --api --out docs/verification/v11/<label>/api
node --import tsx scripts/v11-eval-task0.ts --out docs/verification/v11/<label>/task0
# browser journey: start the owner/reviewer stack (see .github/workflows/owner-reviewer-e2e.yml), then
npx playwright test -c e2e/playwright.v11.config.ts
node --import tsx scripts/v11-eval-run.ts --score e2e-results/v11-journey/answers.json --out <dir>
node --import tsx scripts/v11-eval-run.ts --usage --since <journey start> --journey e2e-results/v11-journey/journey.json --out <dir>
node --import tsx scripts/v1-db-verification.ts --cleanup-proof
```

## Known limits of the local evaluation (stated, not hidden)

- The model is the deterministic stand-in: interpretation, reading and extraction are fixed rules. A production model can do better or worse on the free-text parts; the source/ownership/amount/leak gates do not depend on it.
- Images (the scanned page) prove OCR plumbing only: the stand-in's OCR returns a fixed transcript and never reads pixels.
- "Unreadable OCR" is exercised as a file that starts like a PDF and cannot be parsed.
- The provider-quota case is in-process: every provider request answers 429 `insufficient_quota` with an organisation id.
- In-process timings exclude network, page rendering and provider latency; the browser journey measures the page.
- A visible citation names the product, not the document version: in the browser transcript the 2022/2025 HospitalShield editions and the AccidentGuard schedule/endorsement are recorded as candidates.
- The evidence-review step uses the owner/reviewer journey's operator-seeded critical-illness certificates (e2e/support/seed-claim-fixture.ts): the reviewer decision path is proven on that fixture, not on the fracture claim.
- Supersession has no control on the Documents page at the tested commit; the journey uses the upload route's own `supersedesPolicyId` field.

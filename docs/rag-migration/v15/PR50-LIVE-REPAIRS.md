# Repairs for the live failures after PR #50

Base: `main` = `3ded1d965d59997eb130423e4a8fca9eb6bdf1c5` (checked unchanged at the start and end). Branch: `claude/v1.5-pr50-live-repairs`. Nothing was merged or deployed, no live document, data or configuration was touched, and no model was called.

**Limitation.** The live records (conversations `dd6e4bd6…`, `43b67589…`, `792abbd2…`) were not read from this session. The reproductions use the report's own evidence structures and recorded tool calls, anonymised in `scripts/fixtures/rag2-pr50/household.ts` (people, insurers, scheme and policy numbers renamed). The live file names are not in the report, so the inventory file-name shapes (snake_case, UUID, long digits) are hypotheses. The snake and UUID shapes reproduce the loss; the digit-only shape does not.

## Root causes and fixes

| # | Failure | Exact cause | Fix |
|---|---|---|---|
| D | `No percentage table is printed in or right after that passage.` (both calls) | The calculator reads the **retrieved passage and its stored page**, not the support excerpt (`loop.ts` `rowFromPage` via `proportionPages`). `percentTables` (`lib/rag2/calc/pct-rows.ts`) only recognised a `% of …` header and rows separated by a tab or 3+ spaces. Page 13 is plain text with single spaces (`Bone fractured Compensation (% of S$5,000)` / `Jaw, Pelvis, Leg, Ankle or Knee 50%`), so no table was found. The prefix `name the case the figure is for` comes from `figureFromWords`, which ignores 3-letter words such as "Leg". | `pct-rows.ts` now recognises a plain-text table. The header must be a short line with no sentence ending, immediately followed by a row. A row must be a label with exactly one percentage at the end of the line (bullets stripped). Section boundaries still apply, so Other Fracture rows stay separate. |
| D | The empty `base_value_id` was refused as an unknown id | `runCalculate` (`lib/rag2/calc/tool.ts`) looked up `""`. Its single-space row was also not recognised as a table row (`tableRow` regex), so the call fell through to "needs a sum insured". | An empty `*_id` counts as not given. A row of a reconstructed table is the percentage. The base is the printed `Simple Fracture Benefit Limit: S$5,000`, which the server reads itself. A passed `v1` (Term Life S$1,000,000) is not used, and the result notes this. |
| D | `S$5,000 — a figure from the household’s message` | `identityLabel` (`compose.ts`) found two lines printing S$5,000 (the limit line and the `(% of S$5,000)` header), could not pick a label, and left the figure unbound. | A `% of <amount>` header restating the base is no longer treated as a second label. |
| D | `…separate Simple Fracture Benefit Limit and • Death due to Accident amounts` | `wordScore` (`compose.ts`) compared label words stemmed by `benefitWords` (`simpl`, `fractur`) with clause words stemmed by `contentWords` (`simple`, `fracture`). Simple Fracture Benefit Limit scored 0. The bullet `• Death due to Accident` (page 9) shared only "accident", scored 1, and won as the "better" label. The `productMiss` fallback then printed it. **Reproduced word for word** with the old `wordScore` once the binding above is fixed. | Both sides now use the same words. A bullet item is not a benefit label, and `tidyLabel` strips bullets. |
| C | Both FWD-equivalent records and the unreadable upload were missing from the saved answer | The last save-time transformation: `guardChatAnswer` (`lib/chat/output-guard.ts`, called in `saveTurn`). Its `LEAKS` patterns (snake_case identifier, UUID) dropped every sentence naming such a file. In the inventory lines, the guard's sentence split at "Pte. Ltd." left the fragment `Ltd., reference wording).` Composition and the gate had kept the lines; citations and `libraryNames` still held them, which matches the report. Separately, `withoutUnconfirmedAddress` capitalised any sentence, so `scan_…jpg` became `Scan_…jpg` (identity changed). | The guard protects the household's own document and file names (`answer.libraryNames`, set by the server from the library record) like quoted text. Any other identifier or id is still dropped (check G). Only a sentence that was actually changed is re-capitalised. |
| A | The Singlife-equivalent contact step was lost with the FWD clause | `withoutOtherInsurers` (`compose.ts`) only removes a list item ("X and Y"). For "…, and ask <other insurer> whether…" it returned null, which dropped the whole step. | When list removal does not apply, only the clauses naming the other insurer are removed. The remainder must still name the person's own insurer. |
| A | Enrolment uncertainty treated as an exclusion | **Not reproduced.** With the report's wording, "The documents do not establish that Adrian is enrolled…" is kept (A1, also at base). The live wording is not in the report. | No change. |

## Before and after (complete visible answers, deterministic replay)

**D, fixed-limit fracture.** These are the recorded calls: `proportion` e15, `applies_when` "Leg", then `base_value_id` "" and then v1.

- **Before (3ded1d9):** "I’ve left out an amount I couldn’t match to your documents." With the `% of` binding repaired but the old `wordScore`, the answer becomes the live text: "The Public Officers Group Personal Accident - Summary of Benefits lists separate Simple Fracture Benefit Limit and • Death due to Accident amounts; I couldn’t confirm the • Death due to Accident amount for this answer. / I’ve left out an amount I couldn’t match to your documents."
- **After (browser, saved = displayed):** "If the Simple Fracture provision applies to a leg fracture, the conditional illustration is S$2,500, which is 50% of the S$5,000 Simple Fracture Benefit Limit; this is not a promise of payment, and only for an injury the insurer accepts as caused by an accident (the policy says “We will pay the percentage of the Simple Fracture Benefit Limit shown below for a Simple Fracture of a nature listed, caused by an Accident”). / Other Fracture is a separate benefit, a percentage of the Sum Insured rather than of the Simple Fracture Benefit Limit."
- **Unresolved control ("leg or arm"):**
  - The refusal returns `v3 = “Jaw, Pelvis, Leg, Ankle or Knee” 50%` and `v4 = “Arm, Wrist or Elbow” 40%` as usable ids.
  - The answer keeps the verified terms: "If the Simple Fracture provision applies to a leg fracture due to an Accident, the illustration would be 50% of the S$5,000 limit." It has no S$2,500 and no other benefit.

**Saved calculation** (`kind: conditional_illustration`, `calculator: lump_sum`, which re-verifies through `recomputeCalculation` → 250000 minor units, and `verifyAnswerFigures` → no problems):

| Operand | Value | Source span |
|---|---|---|
| `benefit_limit` | S$5,000 | “Simple Fracture Benefit Limit: S$5,000”, Summary of Benefits p13, `sha256:pr50-summary`, subject Adrian |
| `percent` | 50% | “Jaw, Pelvis, Leg, Ankle or Knee 50%”, same page and document, subject Adrian |
| `s_part` | percent_of → **S$2,500** | assumption "If that provision applies"; condition "reviewed medical decision" unresolved |

Term Life S$1,000,000 is not an operand.

**C, inventory (snake_case file names).**

- **Before:** the model's lines end "Ethan has no documents on file. / Ltd., reference wording). / Scan_20241003_153045.jpg could not be read." Both travel files are gone and the scan is renamed. The server's inventory lines lose the unreadable line, leaving "Nothing in it can be used; …".
- **After (browser):** "… Ethan has no documents on file. / Linked to nobody: travel_policy_wording_2024.pdf (Harbourline General Insurance Pte. Ltd., reference wording); travel_benefit_summary.pdf (Harbourline General Insurance Pte. Ltd., reference wording). / scan_20241003_153045.jpg could not be read."

**A, death.**

- **Before:** the three sentences only. The step "Contact Kestrel Life Ltd through the scheme administrator to report the death, and ask Harbourline General whether a travel policy covered the trip." was dropped whole.
- **After:** the same three sentences, plus the next step "Contact Kestrel Life Ltd through the scheme administrator to report the death." The Harbourline-only step is still removed.

## Inventory reconciliation by document identity

| Fixture document | Id | Expected | Saved record | Displayed (browser) |
|---|---|---|---|---|
| CERT (personal certificate) | …0101 | listed for both people | cited | yes, "personal certificate" |
| SUMMARY (reference) | …0102 | listed | cited | yes, "reference wording" |
| WORDING (reference) | …0103 | listed | cited | yes, "reference wording" |
| TRAVEL_WORDING (other insurer, unlinked) | …0104 | listed, not personal | cited + libraryNames | yes (by file name) |
| TRAVEL_SUMMARY (other insurer, unlinked) | …0105 | listed, not personal | cited + libraryNames | yes (by file name) |
| SCAN (failed) | …0106 | listed as unreadable, no evidence invented | libraryNames | yes, "could not be read" |
| DELETED (soft_deleted) | …0107 | absent | absent | absent |
| OTHER (another household) | …0201 | absent | absent | absent |

The browser run first showed the DELETED upload. Cause: the e2e seed ignored `lifecycle` and inserted it as active. This was a test-seed defect, not an application defect. The seed now honours `lifecycle`, and the spec checks deleted and other-household documents by id.

## Checks on the tested candidate

- `scripts/rag2-pr50-regressions.ts` (written and pushed first, failing at base):
  - plain 13/13, snake 3/3, uuid 3/3, digits 3/3;
  - at base: plain 8/13, snake 0/3;
  - added to CI as `npm run rag2:pr50-regressions`.
- 50 affected suites: all passed. The one failure, `rag2:tools-test` F4 (import boundary), was fixed by allowing the new fixture directory and reran at 38/38.
- Typecheck: clean. `next build`: clean.
- Browser (Chromium, real chat page and `/api/chat`, local PostgreSQL):
  - `e2e:rag2-pr50` 3/3;
  - `e2e:rag2-s52-replay` 4/4;
  - `e2e:rag2-livelib` 2/2.

| Timing (browser replay, scripted model) | Loop, recorded | Click → visible answer | Checking indicator left after answer |
|---|---|---|---|
| P50D fracture | 78 ms | 2,332 ms | 9 ms |
| P50C inventory | 88 ms | 2,194 ms | 4 ms |
| P50A death | 107 ms | 2,271 ms | 14 ms |

These times exclude the model, so they measure only the application's own overhead. In the live run the time from model to visible answer will be longer than these figures. The brief overlap of a completed answer with the indicator is reproduced here (4–43 ms across runs) but is not large enough to explain what the report observed.

## What replay cannot establish, and the smallest capped test

Replay fixes the model's moves. It cannot show:

- whether the live model now makes a successful call on the first try;
- how it phrases the enrolment uncertainty;
- what the actual live file names are.

Proposed, if authorised: one actual-model run of the three affected prompts (D, C, A turn 2) on the PR50 fixture household through the existing dedicated setup, capped at US$0.006 with no retries, reporting loop time and time to visible answer separately. Not run.

## Recommendation

Release candidate for review. Before merging:

1. Run the browser workflow on this branch in CI.
2. Optionally run the capped test above.

The enrolment-uncertainty item stays open until its live wording is available.

---

## PR #51 review round (15 Oct, after 14:48 SGT)

### 1. The actual stored representation of page 13

The fixture default is now the report's representation (`SUM_P13_TABS`):

```
Simple Fracture Benefit Limit: S$5,000
Schedule<TAB>Compensation
(% of S$5,000)
Neck, Skull or Spine (Full Break)<TAB>100%
Hip<TAB>75%
Jaw, Pelvis, Leg^, Ankle or Knee<TAB>50%
```

- The search reproduces the recorded passage: e15 is page 13, offsets 88–247, exactly those six lines. Its support excerpt is 88–126, the limit line only. Check D0 asserts both.
- The single-space variant is kept as `PR50_PAGE=plain`.

**Why the old parser failed on this representation.** `percentTables` needs one line that is both a `% of …` header and tab or 3+-space separated.

| line | `% of` header | tab / gap |
|---|---|---|
| `Schedule<TAB>Compensation` | no | yes |
| `(% of S$5,000)` | yes | no |

The header is wrapped over two lines, so neither line qualified and no table was found. That is the live message "No percentage table is printed in or right after that passage."

- On this representation, base `3ded1d9` reproduces both recorded refusals word for word. It also reproduces the exact live visible answer ("…lists separate Simple Fracture Benefit Limit and • Death due to Accident amounts; I couldn’t confirm the • Death due to Accident amount for this answer. / I’ve left out an amount I couldn’t match to your documents.").
- **Fix:** a `% of` line that directly follows a cell line with no digits continues that header. The header becomes "Schedule Compensation (% of S$5,000)".
- The tabbed rows are cells as before. `Leg^` is read as "leg".
- The label fix (shared stemming in `wordScore`) is what removes "Death due to Accident" on this page. The `% of` binding fix was only needed for the single-space variant.

### 2. The complete uncertainty sentence

Anonymised with its clause structure and source (the wording's Compassionate Death Allowance Benefit, page 3):

> “The Public Officers wording also describes a Compassionate Death Allowance Benefit for accidental death, requiring proof of death and relevant documents in the insurer’s prescribed form, and says it can be claimed under either the Core Scheme or Voluntary Scheme; the uploaded documents do not establish Adrian’s applicable Sum Insured or scheme enrollment for this benefit.”

**Before:** dropped whole, with "it says something is not covered / not included, but its evidence says nothing of the kind".

**Trace** (`lib/rag2/loop/statements.ts`):
1. `UNCERTAINTY` only set aside "do not establish **whether/if** …" and "… **cover**".
2. "do not establish Adrian’s applicable **Sum Insured** or scheme enrollment" therefore stayed in the asserted text.
3. There `NEGATIVE_SENTENCE` read "not … Insured" as an exclusion.
4. The wording prints no negative, so the whole sentence was rejected.

**Fix:**
- "do not establish / confirm / specify / determine / prove <object>" is now uncertainty.
- A cited sentence is checked clause by clause, and an unsupported clause is removed while the supported ones stay.
- Exceptions: a labelled list such as "Adrian: …; …", an absence clause, and the household's own words said back to them are judged as before.

**Results:**
- A4: the whole sentence is kept, nothing is dropped, and nothing is called an exclusion.
- A5 (negative control): the same sentence with "says it is payable only to a surviving spouse" loses only that clause.

### 3. The file-name exception stays narrow

- `ChatAnswer.libraryNames` is set only by the server, from `household_documents`. That lookup is household-scoped and lifecycle-filtered (`activePredicate`, `superseded_at IS NULL`).
- `protectableNames()` (`lib/chat/output-guard.ts`) accepts a value only if it is shaped like a document or file name. It refuses:
  - paths and storage keys (`/` or `\`);
  - key- or token-shaped values;
  - bare UUIDs;
  - any value containing one of the answer's own record ids;
  - values over 160 characters.
- A name is protected only as a whole token, never as part of a longer identifier.
- Key-shaped values (prefixed API keys, JWTs, PEM blocks, long mixed-case random strings) are now leaks in their own right. Before, `sk_live_51H…` passed the guard.

**Checks:**
- G2 (unit): a storage path, a key, the scan's own record id, an unknown id, and "summary" inside `summary_internal_table` are all dropped. The real name stays.
- G3 (end to end):
  - another household's `other_household_certificate.pdf`, the deleted upload's `old_benefit_summary_deleted.pdf` and a model-invented `invented_policy_schedule.pdf` never reach the saved answer or its `libraryNames`;
  - real file names keep their exact case.

### 4. Freeze and verification

**Frozen candidate:** `371ba7d3ec2f298735ec8234a04fa64a70c62ab6`.

**Local checks (completed):**
- `rag2:pr50-regressions`, both page representations:
  - names plain 18/18, snake 5/5, uuid 5/5, digits 5/5 (tabs page);
  - plain 18/18 (plain page).
- 52 affected suites: rc 0.
- Typecheck clean. `next build` OK, BUILD_ID `-GqmFKGh4u06esGcA0ela`.
- Browser (Chromium, real page, local PostgreSQL): `e2e:rag2-pr50` 3/3, `e2e:rag2-s52-replay` 4/4, `e2e:rag2-livelib` 2/2.

**Hosted checks: not run.** Every GitHub Actions job on `e3ae6cc` and `371ba7d` was "not started because recent account payments have failed or your spending limit needs to be increased". This is a billing block, not a test failure. No payment was requested.

**Actual-model run pr50-live-1:** see `LIVE-RESULT-pr50-live-1.md`.
- Result: **FAIL** overall.
- P50C inventory passed 6/6: all six document ids are displayed.
- P50D fracture passed 4/4: the saved, source-bound S$2,500 calculation re-computes.
- P50A death next steps did not finish. The run-cap guard's worst-case reservation for its fourth call exceeded what was left under the US$0.006 cap, after US$0.003029 had been spent.
- The run was not repeated.

### Remaining limitations

- P50A, the contact-advice and uncertainty behaviour, has no real-model result yet. A second capped run of P50A alone, at US$0.006, would settle it. That is not authorised, so it was not done.
- In P50C the model's own unreadable-file sentence was dropped, because digits in its file name counted as a figure in the uncited-sentence check. The server's line replaced it. That check should be narrowed.
- P50D took 52 s and 6 model calls, against 27 s in the live report.
- The household is synthetic and anonymised; the live library was not accessed.
- Hosted CI is blocked by billing.

---

## Final round (15 Oct, after 15:56 SGT)

- **pr50a-live-2:** the death next-steps prompt alone, pre-registered with R1–R7 and grader controls passing 10/10, run once on `004d25e`, whose product code is identical to `371ba7d`. The result was **BLOCKED**: the run-cap guard refused the sixth call after US$0.002322 had been spent. See `LIVE-RESULT-pr50a-live-2.md`.
- **Release SHA** (product code `371ba7d`; later commits are records and test scripts only): see the PR description.
- **Local checks** on the final product code: all completed and passing. They are listed in the review round above, and `rag2:pr50-regressions` was rerun on `004d25e`.
- **Hosted checks:** GitHub Actions jobs were not started because of a billing or spending-limit block. They are not a gate for this PR.

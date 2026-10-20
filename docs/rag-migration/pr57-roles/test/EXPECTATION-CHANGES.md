# Expectation corrections (Test engineer, PR #57 follow-up)

Each change below edits an existing check's expectation. Each has a ruling or a demonstrated reason, the original line is quoted next to the change in the test file, and git history keeps it. None was made to turn a red check green without that reason.

| test | check | was | now | reason |
| --- | --- | --- | --- | --- |
| `scripts/reliable-chat-fx-repairs-test.ts` | A1-A5, A8-A10 (K6b dental), B1 (K6a cancer) | ran on the fracture fixture as stored | same checks, wording unchanged, run on a **fully stored variant** (`fullyStored`): the missing pages added as pages that print no benefit wording, `page_count` Product Summary 37, Benefit Summary 9; stored pages unchanged; restored afterwards | Critic ruling 553c1e8: they asserted an absence over a 4-of-37-page copy, which the full-read rule rightly refuses. A supported absence stays tested on documents read in full |
| same | A11-A13 (new) | | on the partial fixture: no absence stated (refusal names "not read in full"); the answer names what was read and that the rest could not be checked; not the "couldn't confirm" note or the model-error reply | Critic ruling 553c1e8 |
| same | C3 (K2) | `!/\$\s?250|\b250\b/` (no 250 anywhere) | the 250 only as printed terms with all printed conditions (accident injury, 30 days, 24 hours, same injury, Core or Voluntary) and currency basis (S$ only with the Product Summary, else the bare "$"), never as an amount for this stay; and "accident condition is not met" on what was reported | Policy QC ruling 1 (`qc/FINDINGS-C1.md`): "no 250" hides a documented benefit |
| `scripts/reliable-chat-pr57-acceptance-test.ts` | R6 (K2) | no S$250 / $250 | same rule as C3 for any 250 | Policy QC ruling 1 |
| `scripts/reliable-chat-structured-answers.ts` | complete conditions (J2, J3, J3b, J4, J6, SBa) | pattern ended at the not-a-payment clause or the footnotes | also allows `; under the table it prints: “…”` before the final full stop; still ONE sentence for the splitter, displayed and reopened whole | the QC Q1 repair adds the table's printed condition. On C1 I wrote that the quoted full stop splits the sentence; that was wrong: the splitter keeps it whole, only the pattern failed |
| same | table condition (J2, J4) (new) | | the illustration from the page-8 table must carry "under the table it prints: “This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme”" inside its one sentence | so the relaxed pattern cannot hide the clause going missing |
| `scripts/reliable-chat-absence-scope-test.ts` | unit fixture (C1.1) | `pageCount` 2 by default; pages 8, 3, 9 | `pageCount` = pages stored, numbered from 1; S12, S13 partial-document checks added | Critic ruling 553c1e8: renumbered unit fixture accepted |
| fracture fixture (C1.1) | `pageCount` | none | certificate 1, Product Summary 37, Benefit Summary unknown | the documents' own length; both summaries stay incomplete (Critic: 37 correct) |

## `rag2:s52-replay`: S52A#0 adds three statements, not two (after C3)

- **Original expectation:** S52A#0 adds two statements (the repatriation S$2,000 sentence, and "notify ... within 6 months").
- **Observed on main (C0), C2 and C3 alike:** a third statement, "The policy wording says reasonable costs of returning the remains to Singapore are reimbursed up to 2,000 (printed with a “$” sign; the document does not say which currency)."
- **Why the old expectation is wrong:** the policy wording prints "up to $2,000" with a bare "$" (`scripts/fixtures/rag2-livelib/household.ts:105`). The live s52 sentence said "S$2,000" for it, which the currency rule now refuses. The new statement is the same fact with its currency left unresolved, split from the summary's S$2,000 sentence. No figure changes; the expected removal list is unchanged.
- **Change:** the test now expects that third statement by its exact wording (so a different extra statement still fails). The original is kept in a comment beside it. This is test-only, after the C3 freeze, so it is not part of C3's own result.

## `reliable-chat-fracture-replay` A6: the C4 wording of the missing definition (after C5)

- **Original expectation:** `/print no definition of which fractures that is/`.
- **Observed on C4 and C5:** "(the row the document labels “Other Fracture”; these documents do not define which fractures count as Other Fracture, so the insurer decides whether it applies)".
- **Why the change is genuine:** C4 rewrote this clause on purpose (C4 item 4, closed fracture). The new text says the same fact, that the documents print no definition, and adds who decides. Both are true of the fixture's pages. The row label is still there.
- **Change:** the check accepts either wording. The original pattern is kept in a comment.

## Not changed: `reliable-chat:fx-repairs-test` A12 (partly stored copy), on C5

- **Observed on C5:** "...(pages 8, 12-13, 37 of 37)... The other pages are not in the copy that was uploaded, so I can't say either way whether there is such cover."
- **Why it is not an expectation change:** the reason given is not supported. In production `page_count` is the number of pages extracted from the uploaded PDF (`lib/rag/ingest.ts`, `page_count = pages.length`). A stored count below `page_count` means pages were not stored, not that the uploaded file lacks them. "37 of 37" proves the file has 37 pages, so "not in the copy that was uploaded" contradicts the evidence it rests on. The C2/C3 wording, "the rest is not stored and could not be checked", was accurate. A12 stays as it is and fails on C5. This is a C5 finding.

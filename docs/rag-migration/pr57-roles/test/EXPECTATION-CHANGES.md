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

## Browser spec `reliable-chat-fx-repairs.spec.ts`: FX-K2 and FX-K6B (after C5)

These are the browser versions of changes already ruled for the scripted suites. The browser seed also now writes `page_count`, as the PGlite harness does (`e2e/support/seed-rag2-stress-report.ts`). Without it, every document read as partial, and FX-K6A failed for that reason alone.

- **FX-K2 (sickness).** The original `not.toMatch(/\$\s?250|\b250\b/)` is replaced by Policy QC ruling 1 (`qc/FINDINGS-C1.md`), the same change as `reliable-chat:fx-repairs-test` C3. The 250 may appear only as the benefit's printed terms, with all of its conditions (accident injury, 30 days, 24 hours, same injury, Core or Voluntary) and its currency basis (S$ only with the Product Summary, otherwise the bare "$"). It must never appear as an amount for this stay. Passes on C5 with the seed.
- **FX-K6B (dental).** The original expected the absence ("do not describe a benefit for dental treatment") over the fixture's Product Summary (4 of 37 pages) and Benefit Summary (unknown length). Under the read-in-full rule (Critic M2/M5, rulings 553c1e8; scripted fx-repairs A11-A13, acceptance M5), the absence must not be said there. The test now requires: no absence, what was read named with its pages, "could not be checked" (as fx-repairs A12), never "couldn't confirm", and never "no dental cover". It fails on C5 only on "could not be checked" (C5 finding 1) and must pass on C6.

## Auth journeys (`e2e/auth-tests`), PR #65 round

- **mobile-critical-path, bottom navigation.** The original tapped Claims and Family in the bar. PR #65 moves them under More, so the test now taps More, then the sheet's item, and checks that Ask is in the bar and that the sheet closes. On PR #65 the original times out.
- **mobile-critical-path, after deleting the household.** The original used `signOutThroughUi`, which finds two "Sign out" buttons on the deleted-household page (the top bar's and the page's). It fails the same way on main ca6af69. The test now taps the page's own button.
- **owner-reviewer-journey 8-9, unreadable document.** The original expected "Analysis stopped" on the household card and clicked a "Re-analyse" button. Households see "This document could not be read". "Analysis stopped" and Re-analyse belong to the operator page. Both steps fail the same way on main ca6af69. The test now checks the household's wording. It clicks "Try reading it again" when the card offers it, and otherwise expects the "clearer copy" advice. The document must still never become ready. The originals are kept in comments.
- **Not changed: owner-reviewer-journey 11, "no amount".** The factual critical-illness answer prints the sum insured (S$200,000 and US$100,000, page 1, "not confirmed current") on both main and PR #65. Whether a factual answer may show printed amounts is a product decision, not a stale expectation, so the step still fails. Steps 12-23 do not run on either SHA.

## Browser specs, PR #65 final round (f874a9d / 27af0fd)

- **keyboard-critical-path, second person.** PR #65 no longer pre-chooses a relationship, and "+ Add person" stays disabled until one is chosen. The test now tabs to the relationship field and presses Home before adding. The original went straight from the name to the button.
- **v11-ux-r5, new person.** For the same reason, the test now chooses "child" (`selectOption("child")`). There was no original line; the old form pre-chose one.
- **household-journey, covers chip.** The tick is now an `aria-hidden` mark beside the name, so the chip's accessible name no longer contains "✓". The state is read from `aria-pressed=true`. The original `getByRole("button", { name: \`${who} ✓\` })` is kept in a comment.
- **claim-journey 1, cited page.** PR #65 shows one source row per document, with its pages on one line ("pages 1, 4, 5"). The check accepts page 5 in that line. The original `toContainText("Page 5")` is kept in a comment.
- **Opening chat history (v11-journey, v1-core-loop, claim-journey, ingest-live, document-ingestion).** This is not an expectation change. Clicking `details.chat-history summary` raced the page's hydration on PR #65, so the panel sometimes closed again. The test now sets `open` and waits for the first entry, retrying for up to 30 s. The original line was `await page.locator("details.chat-history summary").click();`.
- **reliable-chat RC1, reopened chat.** The test read the page once, right after the first question appeared. On PR #65 the answers below finish rendering a moment later; the failure snapshot shows S$20,000 on the page. The test now polls for up to 30 s. The original single read is kept in a comment. On main it passes either way.
- **document-unlink, set up.** This is a defect in my own PR #67 test, not PR #65's. household-journey runs earlier in the same suite and ends by permanently deleting household A, so the set-up found "No household". It fails the same way on main whenever the two run together. `beforeAll` now calls `/api/household/start`, which is idempotent and keeps an existing household.

## Browser specs, PR #77 (designer's design pass)

The UI changed on purpose; each original is kept in a comment beside the change.

| test | check | was | now | reason |
| --- | --- | --- | --- | --- |
| `e2e/tests/v11-ux-r5.spec.ts` (~217) | empty chat | `.prompt-grid` visible, containing this household's employee and not "Josephine"/"endowment" | no `.prompt-grid`; `chat-welcome` invites "Ask anything about your policies, in your own words." and names nothing from another household; it does not say "Upload a policy first" once documents are ready | PR #77 first-run: no fixed starter questions (DC 11:54, any question) |
| same (new, after the empty portfolio) | first-run chat | | with nothing uploaded, `chat-welcome` says "Upload a policy first" and links "Upload a document" to /policies; no `.prompt-grid` | the upload-first state of the same change |
| `e2e/auth-tests/owner-reviewer-journey.spec.ts` test 7 | preferred-name edit | filled "Preferred name" on the card directly | clicks "Edit details" first | PR #77 family page: fields are folded behind "Edit details" |
| same, test 7 (after Save) | the save is confirmed | the button turns into "Saved" | the card's status line reads "Saved <name>." and "Edit details" is back; the saved preferred name is still checked through the API | PR #77 family page: a successful save closes the details |
| `e2e/tests/household-journey.spec.ts` test 7 | linking each ready document to a person | clicked the person chip directly | opens the "Covers" picker ("Choose"/"Change") first, then the chip; the "Saved" notice and the pressed chip are unchanged | PR #77 c0969e5: same one-line picker as v1-core-loop |
| `e2e/auth-tests/owner-reviewer-journey.spec.ts` test 8-9 | linking the clean ready policy to the child | clicked the child chip directly | opens the "Covers" picker ("Choose"/"Change") first, then the chip; the "Saved" notice and the API link check are unchanged | PR #77 c0969e5: same one-line picker as v1-core-loop |
| same, test 22 | delete a child still linked to a document | "Confirm delete", then the status "has linked documents or activity" | Delete shows an alert "… is still linked to a document" and a "Go to Documents" link to /policies; no "Confirm delete" is offered; the child is still in the household. The second half (delete the document, then the child) is unchanged | PR #77 family page: someone still on a document is sent to Documents instead of a delete that fails |
| `e2e/tests/v1-core-loop.spec.ts` (~152), `e2e/tests/v11-journey.spec.ts` (~266) | assigning the owner of a document nobody is linked to | clicked the `.declare-owner` chip directly | opens the one-line "Covers" picker first ("Choose" when nobody is linked, "Change" otherwise), then the chip | PR #77 c0969e5: "Who does this cover" starts as one line for every document |
| `e2e/tests/document-unlink.spec.ts` (~52), `e2e/tests/reliable-chat-stale-answers.spec.ts` (~52), `e2e/tests/v11-ux-r5.spec.ts` (~149) | opening the picker | `{ name: "Change" }` | `{ name: /^(?:Change\|Choose)$/ }` | the same change: an unlinked document's button reads "Choose" |

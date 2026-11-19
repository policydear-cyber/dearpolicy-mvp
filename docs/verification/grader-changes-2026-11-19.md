# Grader changes, 19 Nov 2026: documents named by title, never by file name

**Approved by DC** on 19 Nov 2026 (10:07 UTC), on the decision card "Change the registered answer graders so they stop
expecting file names?". This follows DC's 18 Nov rule: no file names in anything a household sees.

## Why

Ask answers now name each document by its title. An upload with no name of its own reads "Photo uploaded 3 Nov 2026",
and a multi-policy part reads "… (part 2 of 3)". The household inventory (lib/rag2/inventory.ts) no longer carries file
names at all, so the model never sees one to repeat.

Several registered graders and their tests identified a document by its exact file name, for example "IMG_0042.jpg could
not be read". They would have failed a correct answer, or passed a leaked file name.

## What changed, and what did not

Only the words that identify a document changed. Every check still grades the same behaviour, with the same pass rule
and the same check id:

- An eligible upload is still listed.
- An unreadable upload is still stated as unreadable on its own line.
- Deleted and other-household uploads are still absent.
- Reference wording is still not presented as personal cover.

The shared matcher is scripts/rag2-live/spoken-name.ts. It identifies a document by its product or title
(documentName), or, for an upload with no name of its own, by the shape "Photo uploaded <day>". The day depends on when
the fixture was seeded.

| File | Check | Before | Now |
|---|---|---|---|
| scripts/rag2-live/pr50-check.ts | C1, C2, C5 | product or exact file name | product or title, or "Photo uploaded <day>" |
| scripts/rag2-live/pr50-check.ts | C4 | absent by product, file name or id | absent by product or title, file name, or id (unchanged strictness) |
| scripts/rag2-live/pr50-check.ts | C3 | the line names `scan.filename` | the line names the scan as above |
| scripts/rag2-live/livelib-check.ts | S52C turn 1 | `/IMG_0042\.jpg/` | "Photo uploaded <day>", and not IMG_0042.jpg |
| scripts/rag2-live/check-regressions.ts | C52 | fixture text with IMG_0042.jpg | fixture with "Photo uploaded 19 Nov 2026"; a new control shows the file name now fails |
| scripts/rag2-s52-replay.ts | S52C, expected differences | IMG_0042.jpg | "Photo uploaded <day>", and not IMG_0042 |
| e2e/tests/rag2-s52-replay.spec.ts | R52C | IMG_0042.jpg | "Photo uploaded <day>", and not IMG_0042 |
| e2e/tests/rag2-pr50.spec.ts | P50C | product or file name | spoken-name match, and the file name is not displayed |
| scripts/rag2-pr50-regressions.ts | C, G3 | file names shown exactly | titles shown; no file name shown |
| scripts/rag2-live-verify-regressions.ts | INVENTORY checks | IMG_0042.jpg, scan-0042.jpg, "Claim S$5,000 receipt 05-03-2024.pdf" | "Photo uploaded <day>"; "Claim S$5,000 receipt" (the title) |
| scripts/rag2-stress-regressions.ts | C1 | lena-hospital-plan.pdf, IMG_2231.jpg | "Lena Hospital Plan", "Photo uploaded <day>"; the file names are now in `never` |
| scripts/rag2-stress-report-regressions.ts | R1 | scan-0042.jpg could not be read | "Photo uploaded <day> could not be read", and not scan-0042 |

Earlier saved grade files for past live runs are left as they were recorded. A past run's answer that showed a file name
would now fail these checks, as intended.

## Tightened after review (TE #564 F2, F3)

- A text that shows a document's file name never counts as naming that document. For a nameless upload, its file
  name's stem counts too, in any case ("IMG_0042", "img_0042.JPG"). So "Photo of letter.jpg could not be read" and
  "Photo uploaded 3 Nov 2026 (IMG_0042.jpg)" now fail C1 and C3, where before this change they passed.
- A nameless upload must be said with its own format word ("Photo" for a .jpg, never "PDF") and with the exact casing.
  Only the day is open, because it depends on when the fixture was seeded.
- livelib-check S52C now needs the "could not be read" status on the same line as the photo, as pr50-check C3 already did.
- TE #564 L-A to L-C: pr50-check C3 and livelib-check S52C now need the photo and its status in the same sentence, not
  only on the same line. A nameless upload's stem counts as its file name with any separators ("IMG 0042", "img-0042"),
  as a whole word. A stem under 4 characters, or made only of common words with no digit ("photo", "scan"), is too
  ordinary to tell from plain words, so only its whole file name counts. New controls in
  scripts/rag2-live/check-regressions.ts cover the separator and two-sentence cases.

## Test battery and browser specs updated with the CI fixes

These are not registered graders. They are listed here so every file-name expectation that changed is in one place.

| File | Case | Before | Now |
|---|---|---|---|
| scripts/r10/battery.ts | current SilverShield schedule | `SilverShield_Schedule_2026.pdf` or 2026; must not call `SilverShield_2025_photo.png` current | "SilverShield Integrated Plan (PDF)" or 2026; must not call "(photo, ending 0417)" current |
| scripts/r10/battery.ts | schedule uploaded twice | `SilverShield_Schedule_2026.pdf` or PDF | "SilverShield Integrated Plan (PDF)" or PDF |
| scripts/r10/battery.ts | premium last year | /2025/ | /2025/ or "earlier schedule" |
| scripts/r10/battery.ts | documents that couldn't be read (3 cases) | the three file names | the three titles in quotes, and no file name shown |
| scripts/r10/battery.ts | letters rather than policies | the letter's and decision's file names, or premium / claim | "(letter)" or premium; "(claim decision)" or claim |
| scripts/r10/battery.ts | every document for Papa | `SilverShield_Schedule_2026.pdf`, `Merlion_Claim_Decision` | "SilverShield Integrated Plan (PDF)", "SilverShield Integrated Plan (claim decision)", and no file name shown |
| scripts/r10/battery.ts | was the 2025 premium S$1,962 | S$1,962, unclear or 2025 | the same, or "(photo, ending 0417)" |
| scripts/r10/battery.ts | is that from the policy (2 cases) | the schedule's or screenshot's file name | its title in quotes; the screenshot's file name must not show |
| e2e/tests/rag2-stress-report.spec.ts | R1 | scan-0042.jpg could not be read | "Photo uploaded <day> could not be read", and not scan-0042 |
| e2e/tests/rag2-livelib.spec.ts | L1 | the line holding the file name | the line holding the title "Claim S$5,000 receipt", and not the file name |

Two of these passed on main only because a citation showed the file name `SilverShield_2025_photo.png`, which holds
"2025". The answers themselves are unchanged from main: "What was Papa's SilverShield premium last year?" says it is the
earlier schedule and leaves out the unclear amount, and "Was Papa's 2025 premium S$1,962?" leaves out the amount. The
battery now accepts the 2025 photo's title in place of the file name. Whether that second answer should say more is a
follow-up, not part of this change.

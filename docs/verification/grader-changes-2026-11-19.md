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

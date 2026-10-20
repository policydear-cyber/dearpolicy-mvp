# UX review of the designer's six held patches on PR #65 head 27af0fd

Patches came from `/mnt/project-files/ux-design/` and were applied in this order (all cleanly), identified by the first
12 characters of their SHA-256: `first-run.patch` 88b0a2ba2d53, `answer-wait.patch` b48f8c72ad0b,
`coverage-alternatives.patch` 4ac64253ce23, `coverage-glance.patch` e72132c9ffdf, `documents-card.patch` b578566e756e, `family-page.patch` c234c4a920d7.

Method: a real browser on the local app. Desktop was 1366x900; the phone was 390x844 with touch. All data is
**synthetic**: the `fracture` seed household, plus browser-mocked API responses with made-up "SYN"/"SYNTHETIC" names to
create the first-run, Coverage and unmatched-name states. A slow answer was simulated by holding the job-status responses
for 75 s. No real model, no production, no paid calls. Type-check: no errors in source files. Scripts are in this folder;
screenshots are in `shots/`.

## Verdicts

| Check | Verdict | Evidence |
|---|---|---|
| First-time user can upload and ask freely | **Pass** | With no documents, the chat shows "Upload a policy first… nothing to answer from yet" and an "Upload a document" button, and the message box still works. With one document still being read: "You can ask now; answers use it once it is ready". With one that failed: "'SYNTHETIC-photo.jpg' couldn't be read… See Documents →". There's no empty "Previous chats · 0" panel. On a phone the file picker is 316x54 px, and photos and scans are accepted. |
| The wait never looks stuck | **Pass** | It shows "Working on your answer" with a moving bar and a clock: "2s · usually under a minute", then "29s · usually under a minute". At 1m 04s it adds "Taking longer than usual. You can leave this page: the answer is saved to this chat when it is ready." Same on phone and desktop. |
| Double-send blocked | **Pass** | During the wait, Enter and a forced click on Send produced **one** `POST /api/chat` in total. Send is disabled, with "You can send this once the answer above arrives." |
| Coverage shows who has what, either/or once | **Pass** | Each person has a "found" chip, a "Not found" line and kind sections. The wrist pair appears once as "Either / or … OR …", with S$1,250 and S$120,000 each shown exactly once, followed by the "never added together; the insurer decides" note. A person with no rows gets their own line. |
| "Not found" never reads as "not covered" | **Pass with one gap** | Every line says "Not found in your uploaded documents" and ends "A plan you haven't uploaded may still cover it". While reading it says "…documents **yet**" and "More may appear once all your documents are read". A person with nothing: "No cover for SYN Kid was found in your uploaded documents…". The gap is in item 1 below. |
| Documents cards: what, status, whose, what was found, unmatched names | **Pass** | The card shows the title; "Insurer · Certificate · Personal proof"; the status; "For Daniel, Grace" or "Covers … · Change"; "Found Accidental death, … and 1 more. See in Coverage →"; or "Its benefits couldn't be read for Coverage yet: a table could not be read." An unmatched name asks "'SYNTHETIC Uncle Ah Kow' is named in it. Who is this?" with "Until you choose, nothing in it is used for that person." |
| Family: each card shows who, linked documents and cover | **Pass** | Each card shows the name, "Spouse · goes by Grace" and "3 documents linked", then either "Covered for …" or "Nothing found in your uploaded documents for them yet. See cover →". A person with no documents gets "No documents linked yet. Link one on Documents →". |
| Family: remove dialogs say what happens | **Pass** | For a linked person: "Tan Hui Min Grace is still linked to 3 documents. Untick them on each one on the Documents page first. Saved answers that used their cover are then marked out of date when reopened." For an unlinked person: "Remove SYNTHETIC Test Child from your household? This can't be undone. Saved answers that used their cover are marked out of date when reopened." Confirming removes them, and "Removed SYNTHETIC Test Child." is shown. |
| Family: the server's refusal shows on the card | **Pass** | Confirming for a linked person sends `DELETE /api/family/<id>`, which returns 409. The card then shows "This profile has linked documents or activity, so it can't be deleted. Remove those first." |
| Unlink, re-link, delete unchanged | **Pass** | Patched and unpatched (stashed) builds behave identically. Unticking Grace sticks after a reload, and re-ticking sticks. Delete shows "Confirm delete / Cancel" and removes the card (3 to 2). The calls are the same: `POST /api/policies/link-person` 200 twice, then `DELETE /api/policies/<id>` 200. |

## Fixes for the designer

1. **"Not found" when a document couldn't be read (major).** When a document has failed and the banner says
   "'SYNTHETIC-photo.jpg' couldn't be read", the gaps line still says "More may appear once all your documents are read",
   and a person with no rows reads "Nothing for SYN Kid yet. Documents are still being read." That document won't be read.
   For the failed state, say "Not found in the documents read so far. One document couldn't be read (see above), and it
   may cover this."
2. **No way to dismiss an unmatched name (major).** "Who is this?" lists only family members. A person named on the
   document who isn't family, such as a beneficiary or an employer contact, leaves the question there forever. Add
   "Not in my family" or "Someone else".
3. **The "found" chip overclaims (minor).** For a person whose only row is Death, the chip reads "Life and disability".
   Meanwhile Grace has Accidental death (S$600,000) under "Accidents and injuries", yet her "Not found" line lists "Life and
   disability", so a reader may think she has no death cover. Add a note in that line when accidental death is found
   ("accidental death is listed under Accidents").
4. **Family: don't offer "Confirm delete" for someone the server will refuse (minor).** For a linked person the warning
   already says to untick them first, but the card still shows "Confirm delete", which always fails. Show "Go to
   Documents" instead, and style the refusal as an error (it's plain grey text now). The refusal also mentions "or
   activity", so someone with no documents but past chats may be refused after a dialog that promised removal. That case
   is untested here.
5. **Family: still from earlier rounds (minor).** Each card keeps the full edit form open; "3 documents linked" isn't a
   link; dates show mm/dd/yyyy; and "Covered for" inherits the chip overclaim in item 3.
6. **Small wording (minor).**
   - "A plan you haven't uploaded may still cover it" should say "them" after a list.
   - The found line lower-cases the next item and leaves a mixed case: "Accidental death, other Fracture, hospital cash".
   - The "Read" status badge reads like an instruction; "Ready" is clearer.
   - On a phone, "Delete" wraps onto its own line under "Details".

Not observable locally: real answer stages (`stageId`) and real Coverage rows from a model read. The mocked shapes follow
`coverage-alternatives-shape.md`.

## Re-check after the designer's fixes (13:05)

`documents-card.patch` (c5cc9814fcbc) and `family-page.patch` (9f3b2177331e) were re-exported. All six patches still
apply in order on 27af0fd. Same method: synthetic data only, no paid calls.

| Item | Verdict | Evidence |
|---|---|---|
| 1. "Not found" when a document couldn't be read | **Pass** | It now says "Not found in the documents read so far: … One document couldn't be read (see above), and it may cover them." and "No cover for SYN Kid was found in the documents read so far…". The reading and done states are unchanged. `shots/recheck-coverage-unreadable.jpg` |
| 2. Unmatched name can be dismissed | **Pass** | "Not in my family" is offered. Choosing it hides the question, including after a reload, and the notice says "remembered on this device only for now, so DearPolicy may ask again elsewhere". No server call is made, as intended until the server change lands. Minor: there's no way to undo it on the page. `shots/recheck-not-in-my-family.jpg` |
| 3. Chip overclaim, accidental-death confusion | **Pass** | Daniel's chip now reads "Death". Grace's line adds "For death, only accidental death was found (under Accidents and injuries)." |
| 4. Family: no doomed "Confirm delete" | **Pass** | For a linked person, the warning (now red) offers "Edit details · Go to Documents · Cancel" and no confirm. `shots/recheck-family-remove-linked-phone.jpg` |
| 5. Small wording | **Pass** | It now says "may still cover them", "Accidental death, Other Fracture and Hospital cash", and "Ready". The edit form is now behind "Edit details". "3 documents linked →" is a link, though to the whole library rather than filtered to that person. The date field is the browser's own date input, so its format follows the phone or browser's language setting. |

**Verdict: pass.** What's left is minor, for later: an undo for "Not in my family", filtering the library to the person,
and "Critical illness and hospital and medical cover" reads awkwardly with two "and"s.

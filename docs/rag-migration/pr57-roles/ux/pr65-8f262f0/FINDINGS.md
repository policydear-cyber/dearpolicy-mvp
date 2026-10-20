# UX re-test of designer PR #65 at head 8f262f0 (second round)

Same method as `../pr65-72568be/FINDINGS.md`: a real browser on the local app, the **synthetic** `fracture` and `livelib`
households, the scripted model (category 1), desktop 1366x900 and phone 390x844. No real model, no production, no paid
calls. Screenshots are in `shots/`.

## Earlier fails and pass-with-issues items

| Item (from) | Now | Evidence |
|---|---|---|
| Removing a person from a document doesn't stick (screens #1, critical) | **Still fails, and the message is now more misleading.** I unticked Grace: `POST /api/policies/link-person` returned 200, the banner says "Saved — … covers Lee Wei Ming, Daniel", and a "Saved" label shows next to the chips, but Grace stays ticked, including after a reload. This is a product defect for the **Developer**, not a design issue. | `shots/covers-untick-saved-but-ticked.jpg` |
| "Who does this document cover?" always open (screens #2) | **Fixed.** It's now one line ("Covers Daniel, Grace · plan not chosen yet · Change"). Opening it shows check chips, "(which plan?)" with "Not sure", and a "Done" button. | `shots/covers-collapsed.jpg` |
| Coverage stuck on "still being read" (screens #3) | **Fixed on Coverage**: "Some documents couldn't be read for this page yet… Try again". **Partly fixed on Benefits**: after about 60 s the top changes to "couldn't be read yet… Try again", but the empty message below still says "Your documents are still being read", so the page contradicts itself. Locally nothing can be read without a model, so the success path still needs a live check. | `shots/coverage-try-again.jpg`, `benefits-after-70s.jpg` |
| Upload error shown in green (screens #4) | **Fixed.** It shows in red with "Not uploaded." and a proper dash. | `shots/upload-error-red.jpg` |
| Sign-up gives no reason (screens #6) | **Fixed.** It shows "That doesn't look like an email address." and "At least 8 characters (5 more)." | run log |
| Upload buried on phones (screens #7) | **Fixed.** The upload form is now the first thing under the heading. | `shots/phone-documents.jpg` |
| Payments roadmap note (screens #8) | **Fixed.** It now says "Upload a premium notice, renewal notice or receipt as a PDF." | |
| Jargon header and "Profile hint" (screens #9) | **Fixed**, except that the default option is still cut off on desktop ("Not sure: DearPolicy checks the nam…"). | `shots/upload-error-red.jpg` |
| Sign-in copy and show password (screens #11, #14) | **Fixed.** "Welcome back", a Show toggle. | `shots/phone-sign-in.jpg` |
| Tab titles, 404 (screens #12) | **Fixed**, with page titles like "Documents · DearPolicy" and a branded 404 with "Back to your portfolio". Minor: the 404 page's tab is still just "DearPolicy". | `shots/phone-404.jpg` |
| Bold first line not a bottom line (PR #65 round 1) | **Resolved by removal.** No bold lead until the server sends one. There's still no plain bottom line, which is a server-side task. | |
| Sources: two rows look identical (round 1) | **Fixed.** Rows read "Product summary · Product Summary.pdf", "Certificate · Certificate of Insurance.pdf" and "Certificate · Benefit Summary.pdf". Still open: the unrelated quote ("disappears as a result of the sinking or wrecking of the ship…") under a fracture answer, and "…thumb, finger and palm are not" is still cut off mid-sentence. No date shows on these rows. | `shots/sources-desktop.jpg` |
| Unreadable card: no name, "Reading" ×3 (round 1) | **Mostly fixed.** It shows "IMG_0042.jpg", the notice reads "Reading IMG_0042.jpg again…", and while reading there's one status. Minor: before the retry the card still shows a stray "·" subtitle, a "Reference" tag on an unread photo, and Title Case badges ("Could Not Be Read", "Usually Ready In Under A Minute"). | `shots/unreadable-retrying.jpg` |

Also new: the portfolio cost now says "Not known yet" instead of S$0.00, which is better. "Confirmed protection 0" with
"Not found" in every category is unchanged and still needs a live check.

## Remaining top issues

1. **Critical (Developer): unticking a person from a document says "Saved" but doesn't remove them.**
2. **Benefits still says "Your documents are still being read"** under its new "couldn't be read… Try again" notice.
3. **Answers still have no plain bottom line, and sources show an unrelated quote** (disappearance at sea under a
   fracture) **and a quote cut mid-sentence.**

# Paying-customer review of the screens earlier rounds covered least (main ca6af69)

Method: a real browser (Playwright, Chromium) on the local app at main `ca6af69`, using the **synthetic** `fracture`
household (SYNTHETIC-DPTEST) and a local database. Uploaded files were synthetic test files made for this review. No real
model, no production, no paid calls. Desktop is 1366x900; mobile is 390x844. Scripts are in this folder; screenshots are
in `shots/`.

Not reviewed: a successful sign-up and the first-run screens. The local app has no sign-in service, so every sign-up
fails with "Could not create your account" (a harness limit, not judged). Benefit reading needs a model, so pages that
depend on it can't finish locally (see item 3).

Kind: **F** = factual or behaviour defect (for the Developer), **U** = usability failure (for the designer),
**V** = visual preference.

## Ranked findings

| # | Sev | Kind | Screen | What happens | Smallest fix |
|---|---|---|---|---|---|
| 1 | critical | F | Documents, "Who does this document cover?" | On a reference certificate, pressing "Tan Hui Min Grace ✓" to remove her sends `POST /api/policies/link-person` (200) and shows "Saved — … covers Lee Wei Ming, Daniel (Employee)", but the button stays "Grace ✓" (`aria-pressed=true`), including after a reload. The confirmation and the screen disagree, and a wrongly linked person can't be removed, so their answers may keep using that document. | Make removal stick (or say why it can't, e.g. "Grace is named on this certificate"), and render the saved state from the response. `shots/covers-remove-ignored.jpg` |
| 2 | major | U | Documents, every reference document | The "Who does this document cover?" panel is always open. It shows full-width orange bars that look like primary buttons but are already-selected toggles, an empty "Choose…" per person with Employee/Spouse/Child options that aren't explained, and long instructions. The "Saved" confirmation appears at the top of the library, off-screen from the control. | Collapse it to one line ("Covers Daniel, Grace · Change"), use checkboxes or chips for people, explain the tier ("Which plan is Daniel on?"), and confirm next to the control. `shots/covers-picker.jpg` |
| 3 | major | U | Coverage and Benefits | With every document marked Ready, both pages say "Some of your documents are still being read. This page updates on its own", and Coverage also says "Nothing here yet. Upload a certificate…". The page tries to read once, silently (`app/ledger/page.tsx:49-54`), and has no failed state or retry, so a failed read leaves the banner forever. Locally the read can't succeed without a model, so **check this live**. | Name which document is being read, show a failed state with "Try again", and never show "Upload a certificate" when one exists. `shots/coverage-still-reading.jpg` |
| 4 | major | U | Documents, upload | A rejected upload ("This file isn't a real PDF -- its contents are a different kind of file…") is shown in the same green box as success, with "--" in place of a dash. | Error styling (red or amber, icon, `role=alert`), and fix the dash. `shots/upload-error-green.jpg` |
| 5 | major | U | Documents, new upload card | While a file is processed, its card says "Insurer Pending · Document" (reads as an insurer named Pending), is already tagged "Reference", and shows "SCANNING On hold: malware scanning unavailable". The scanner message may be local only; **check live**. | "Reading… (usually under a minute)", no type tag until it's known, and plain copy if a check is delayed. `shots/upload-card-pending.jpg` |
| 6 | major | U | Sign-up | With "not-an-email" and a 3-character password, "Create household" just stays disabled. Nothing says what's wrong. | Keep the button enabled and show inline errors on submit ("Enter a valid email", "Use at least 8 characters"). `shots/signup-bad-input.jpg` |
| 7 | major | U | Mobile, Documents | The upload control is below the title, a paragraph, three explainer cards and a status banner (the file field is about 740 px down). The bottom tab bar still cuts off after "Coverage", so Ask DearPolicy isn't visible. | Put the upload button first on mobile, fold the three steps into one line, and make the tab bar fit or scroll visibly. `shots/mobile-documents.jpg` |
| 8 | major | U | Payments | Customer-facing text says "Photo and email-receipt OCR can be added before public beta." | Remove the roadmap note; say what's accepted ("PDF receipts and renewal notices"). `shots/payments-roadmap-copy.jpg` |
| 9 | major | U | Documents, header copy | "DearPolicy decides what is personal proof, what is legal/reference wording, who is actually insured and which facts are safe to show on the portfolio." This is system language. The "Profile hint" label is jargon, and its default option is cut off ("…detect nan"). | "Upload any policy, certificate or summary. We'll work out who it covers." Rename "Profile hint" to "Who is this for? (optional)". |
| 10 | minor | U | Family | Each person is shown as an open edit form, with a Delete button and "3 linked documents" that can't be clicked. The add form defaults Relationship to "parent". Relationships are lower case ("self", "spouse"). Dates show mm/dd/yyyy for a Singapore household. | Show people as cards with "Edit"; link the document count to a filtered library; default to "Choose…"; use dd/mm/yyyy. `shots/mobile-family.jpg` |
| 11 | minor | U | Sign-in | A wrong password gives "Could not sign in. Please try again." | "That email and password don't match. Try again or reset your password." |
| 12 | minor | U | All pages | Every browser tab is titled "DearPolicy". The 404 page is the framework default ("This page could not be found.") with no way back. | Per-page titles ("Documents · DearPolicy"); a branded 404 with "Back to your portfolio". |
| 13 | minor | V | Plan usage | The month shows as "2026-10". | "October 2026". |
| 14 | minor | V | Sign-in | The heading repeats the logo ("DearPolicy") and has no reason to sign in; there's no "show password". | "Welcome back" heading; a show-password toggle. `shots/mobile-login.jpg` |

What works: the reset-password message ("If that email has an account, a reset link has been sent") is right; the
not-a-PDF message itself is clear; the Claims empty state tells the user how to start; there's no horizontal scrolling
on any mobile page checked.

## Still open from earlier rounds (not repeated above)

Sources can't be opened, answers buried in legal prose, the portfolio's "Confirmed protection 0 / Not found ×15" with a
linked certificate (still on ca6af69, `d_.txt` in the run), no per-person document view, Enter doesn't send. See
`../PAYING-CUSTOMER-REVIEW.md`.

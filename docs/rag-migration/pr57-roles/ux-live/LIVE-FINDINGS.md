# Live UX acceptance: production, part 1 (no chat turns sent)

- App: https://dearpolicy-mvp.vercel.app, running main 4956588 (not the PR #61 candidate).
- Date: 2026-10-20, 07:30–07:50Z. Headless Chromium (Playwright), desktop 1366×900 and mobile 390×844.
- Account: the login DC supplied in the environment. It is DC's own household (real family records, plus one
  synthetic person "Alex Synthetictest"). DC allowed use of the main account in the thread root. Nothing was
  uploaded, edited, deleted or sent. No chat message was sent, so no model call was made.
- No real names, policy numbers, scheme names, file names or amounts from the account are recorded here. People are
  "member A" (self), "spouse" and "synthetic member". Screenshots stay in the private project folder, not in git.
- Evidence category: actual-library observation of the live UI. Nothing here is a scripted test or a chat test.

## Checklist from the earlier tester (PAYING-CUSTOMER-REVIEW.md)

| Item | Live result |
|---|---|
| Portfolio shows "0 confirmed / Not found" despite a linked certificate | **Does not reproduce.** Member A and spouse (both on the linked certificate) each show 4 confirmed categories with amounts. The synthetic member (no documents) correctly shows 0 with an "Upload personal proof" to-do. |
| Mobile tab bar hides Ask DearPolicy | **Reproduces.** At 390 px only Portfolio…Coverage fit; Benefits, Claims, Ask DearPolicy and Household are off-screen. The chat page opens scrolled past its heading. |
| Unreadable upload has no useful name or reason | **Reproduces, worse.** See finding 4. |
| Enter sends? | No key handler in `app/chat/page.tsx` on main (code check, not tried in the browser to avoid a paid send). Enter adds a new line. |
| Previous chats can't be scanned | Reproduces: list is collapsed by default, the title is the first message, and a chat about D is tagged "Whole family". |
| Sign-in, sign-out, expiry | Works. Wrong password: "Incorrect email or password." Sign-out revokes the session (old cookie redirects to login). A corrupted session goes to login and keeps the `next` page, but with no "your session expired" note. |

## Findings, ranked

1. **Critical (factual + usability). The saved live GP-bill answer gives the user nothing.** Reopened chat
   "[member A] tripped over the kerb… GP bill [amount]": "You told me tripped over the kerb and fell. … I couldn't confirm an
   answer to that from your documents. I haven't yet looked up what your documents pay for the bill you mentioned."
   The user can't tell whether they can claim, the first line is ungrammatical, and the next step is generic. This is
   the reported G1/G2 failure; the fix is in PR #61, not in production. Smallest fix: ship the PR #61 fix.
2. **Major, suspected factual (needs the Policy Evidence Reviewer). Coverage and Benefits rows that look mislabelled.**
   On Coverage for member A, under the group scheme: a row "Death — the actual cost, up to [small amount]" and an
   "Accidental permanent disablement — the actual cost, up to [amount]" row (they read like funeral and medical-expense
   items); a "Hospitalisation" group listing sports-equipment and family-visit benefits (reads like travel wording). On
   Benefits: a row titled "percent (20%) of the surface of the Life", and a small "Death Benefit" amount next to a much
   larger death figure elsewhere. Every certificate row's source says "Your policy wording, page 1" while the quoted
   snippet is a certificate row. An ordinary user could read the small amount as the death payout. Not verified against
   the PDFs by me.
3. **Major. Mobile navigation hides the core feature.** Ask DearPolicy, Benefits, Claims and Household are off the
   right edge of the bottom bar with no scroll hint. Smallest fix: five tabs (Portfolio, Documents, Coverage, Ask,
   More).
4. **Major. Unreadable upload tells the user to press a button that doesn't exist.** Card: "[internal file name].pdf ·
   Insurer Pending · Document · Reference · Could Not Be Read … use Re-analyse to try again." The only button is
   Delete. No reason is shown. Smallest fix: add the Re-analyse button (or drop the sentence) and show the stored reason.
5. **Major. "Current insurance cost S$0.00/month, ≈ S$0.00 per year from the latest payment evidence"** while there is
   no payment evidence. Reads as "you pay nothing". Smallest fix: show "Not known yet" instead of S$0.00.
6. **Major. Document counts disagree.** Library "All 8"; portfolio "Your documents 5" (D) / 3 (C) / 0 (Alex); Family
   page "6 / 4 / 2 linked documents" (Alex has 2 on Family, 0 on the portfolio). Home says 2 documents need an owner,
   but the Library shows the "Who does this document cover?" panel on 6 reference documents.
7. **Major. Slow screens.** Page load to settled: 4–6 s on most pages, Benefits 9–11 s, Household 8–9 s. Sign-in 4–10 s.
   Switching person on the portfolio took ~4 s, and during that time the old person's tiles stay on screen with the new
   person's name highlighted (my first run read the wrong person's numbers for this reason).
8. **Minor.** Documents named by internal file names (a random ID or an "output_<timestamp>.pdf" name). Records page shows
   developer copy ("Photo and email-receipt OCR can be added before public beta."). The Benefits page is ~26,600 px tall
   on mobile and overflows by 11 px. The login page paints Email before Password.

## Journey verdicts so far (non-chat)

| Journey | Verdict |
|---|---|
| Finding a family member's documents | Complete with friction (counts disagree, no per-person library filter) |
| Understanding an unreadable upload | **Unable to complete** (no reason, instructed button missing) |
| Simple policy question via Coverage page | Complete with friction (some rows suspect, see 2) |
| Reopening a conversation | Complete with friction (reopens consistently, but the saved answer is finding 1) |
| Sign-in, sign-out, expiry | Complete without help |
| Chat journeys (scenario, clarification, correction, side question, conflict, next step) | Not yet run: waiting for authorisation of the planned turns |

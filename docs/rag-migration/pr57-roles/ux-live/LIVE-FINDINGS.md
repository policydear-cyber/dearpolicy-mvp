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
| Chat journeys | See part 2 below |

# Part 2: ten live chat turns (2026-10-20, 07:47–08:00Z)

- Authorised by DC in the thread ("YES", 07:47Z) after the coordinator's card. Exactly 10 messages sent, once each, in
  4 new chats. 10 model calls on production's own key (not the repository test ledger). 0 errors, every request
  `202 POST /api/chat`. No retries.
- Evidence category: actual-library acceptance on the owner's real household, production main 4956588.
- Names below are generic: "member A" (self), "spouse", "synthetic member". Full transcripts and screenshots are in
  the private project folder (`ux-live/chat-turns/`, `ux-live/screenshots/`).
- Turn 3 was planned as "answer its one question", but turn 2 asked none, so I volunteered a fact instead.

## Timing (first feedback vs complete answer)

First feedback was immediate on every turn (0.07–0.12 s): the user's message and a "Checking your policies… 12s"
indicator with a running timer. That part is good.

| Turn | Message (generic) | Kind | Complete | Target |
|---|---|---|---|---|
| 1 | what is [spouse] covered for | direct | 47.2 s | 10 s, missed |
| 2 | my wife slipped on the stairs and broke her wrist, what can we claim | scenario | 43.0 s | 20 s, missed |
| 3 | she went to A&E and they put it in a cast, no operation | scenario | 60.2 s | 20 s, missed |
| 4 | sorry, it was [member A] not her | correction | 41.2 s | 20 s, missed |
| 5 | side question: does the group plan cover dental? | direct | 26.9 s | 10 s, missed |
| 6 | ok so roughly how much could he get | scenario | 40.7 s | 20 s, missed |
| 7 | what do i do now | direct | 22.0 s | 10 s, missed |
| 8 | [member A] tripped on the kerb, GP bill was $[amount], can he claim | scenario | 37.6 s | 20 s, missed |
| 9 | is the death payout [large figure] or [small figure]? | direct | 31.2 s | 10 s, missed |
| 10 | [synthetic member] had a fever and stayed in hospital 2 nights, anything we can claim? | scenario | 31.9 s | 20 s, missed |

All 10 missed their target. Median about 39 s.

## What came back

1. **Cover list (turn 1): good content, slow.** It listed the four certificate covers with the certificate date and
   said the date doesn't prove current cover. It also added one stray line, a fracture limit from the reference
   wording, which wasn't asked about.
2. **Wrist fracture (turns 2, 3, 6): accurate caveats, unusable shape.** Two alternatives, a small figure and one 100×
   larger, from two documents, "never a total", with no plain line saying what to expect. Each answer is 6 paragraphs,
   and the same block is repeated almost word for word on turns 3, 4 and 6. Turn 3's new fact ("cast, no operation")
   changed nothing, which it said. No clarifying question was asked. The 100× alternative needs the Policy Evidence
   Reviewer to confirm it is supported for a wrist.
3. **Correction (turn 4): works.** "Updated: this is about [member A], not [spouse]. The earlier estimates … no longer
   apply." The earlier answers above it stay on screen with no marking.
4. **Dental (turn 5): no answer.** The whole reply was "The wording also lists a separate dental-expenses benefit for
   dental treatment medically necessary to treat an injury caused by an accident, subject to its stated conditions."
   No yes or no, no amount, and it opens with "also".
5. **"what do i do now" (turn 7): failed.** The whole reply was "I couldn't confirm an answer to that from your
   documents." The previous answer had a next step, so this is a regression inside the same chat.
6. **GP bill (turn 8): much better than the saved 20 Oct failure.** It found the GP benefit (panel "as charged",
   a fixed non-panel amount and a co-pay) and asked one useful question (panel or non-panel GP). But those two figures have no currency, and
   it adds a confusing line: "I left out a sentence that stated an amount: until claim evidence has been reviewed…".
7. **"[large] or [small]?" (turn 9): not answered.** It listed seven death-related items (the certificate figure, a
   small death benefit "in the document (page 9)", a compassionate allowance shown twice, once with "a bare $ sign",
   catastrophe 15%, and so on) and never says which applies or why they differ. The small figure seems to come from a
   critical-illness wording that is not linked to anyone; the home page says unlinked documents are not used to
   answer questions. **Needs the Policy Evidence Reviewer.** It then re-attached the old GP question ("When you're
   ready, here is the question I was on.").
8. **Synthetic member hospital stay (turn 10): misleading shape.** It opens with an irrelevant exclusion
   (self-inflicted injury, pregnancy), withholds the hospital-cash amount, and asks for admission and discharge
   dates and times. The quoted rule pays only "from the 11th day onwards", so a 2-night stay can't qualify, and the
   question is unnecessary. It never says plainly that this person has no personal policy on file. No amount was
   invented.
9. **Sources: still unusable.** A collapsed "Sources" list of plain text (document name + page), no link, no quote,
   with duplicates (turn 2 lists page 13 four times and page 8 three times). The product summary and the certificate
   show the same name.

## Reopen check (all 4 chats)

Reopening took 9–11 s per chat. 9 of 10 saved answers match what was returned word for word. **Turn 8 does not:** the
reopened version adds a sentence that wasn't on screen when it was returned ("I haven't yet looked up what your
documents pay for the bill you mentioned (… $[amount]), so that is still open."). Returned and saved answers must
agree.

## Chat journey verdicts (live, real library)

| Journey | Verdict |
|---|---|
| Asking a simple policy question (turn 1) | Complete with friction (correct, 47 s) |
| Asking what might apply to an accident (turn 2) | Complete with friction, severe (no plain bottom line, 100× alternatives) |
| Answering a clarification (turn 3) | Complete with friction (no question was asked; whole answer repeated) |
| Correcting a person (turn 4) | Complete with friction (works; old answers unmarked) |
| Asking a side question (turn 5) | **Unable to complete** (no yes or no) |
| Understanding conflicting documents (turn 9) | **Unable to complete** (question not answered; possible use of an unlinked document) |
| Finding the next practical action (turn 7) | **Unable to complete** ("I couldn't confirm an answer") |
| Accident GP bill (turn 8) | Complete with friction (good question; bare 30 and 10) |
| Illness for a person with no policy (turn 10) | **Unable to complete** (unnecessary question, no plain "nothing on file") |
| Reopening a conversation | Complete with friction (1 of 10 saved answers differs) |

## Top three for the coordinator

1. **Follow-up questions fail.** "what do i do now", "is it [large] or [small]" and "does it cover dental" get
   no usable answer. These are the most common things a customer types after the first reply.
2. **Every answer takes 22–60 s** (median about 39 s) against 10 s and 20 s targets. The progress indicator helps,
   but a paying user won't wait 40 s for a cover list.
3. **Scenario answers have no plain bottom line and can't be checked.** Six paragraphs repeated on every follow-up,
   a 100× range with no guidance, and sources that are unlinked, duplicated plain text.

Next after those: mobile tab bar hides Ask DearPolicy; the unreadable upload's missing Re-analyse button; S$0.00
insurance cost.

# Part 3: GP-bill re-ask after the PR #61 merge (2026-10-20, 08:23Z)

- PR #61 merged as ca6af69 at 08:03:59Z. The deployment couldn't be confirmed directly: Vercel access is refused and
  the site has no version marker. Login and `/api/health` were fine; the login page cache restarted at about 08:06Z.
- One paid call (DC: "always yes"), new chat, no error, 49.6 s to complete, first feedback 0.09 s.
- **Result: worse than turn 8 an hour earlier, and still not useful.** It opened with "The documents do not establish
  whether [member A]'s GP was a panel/preferred GP or whether he is enrolled in this outpatient benefit", repeated the
  user's words ungrammatically ("You told me tripped on the kerb."), and quoted the **Overseas** Emergency Outpatient
  clause (treatment "outside Singapore"), which doesn't fit the event. It didn't state the panel and non-panel GP benefit
  that turn 8 found, and it didn't ask the panel-or-non-panel question. Sources list the GP benefit pages (16, 33),
  but the text doesn't use them. The reopened answer matched what was returned.
- Neither PR #61's new server sentence for an unpaid bill ("I could not confirm from your documents what pays for the
  bill…" / "The pages I read do not print a benefit for the bill…") nor the old one appeared, so the wording can't
  tell us which build answered. One sample can't separate a deployment change from the model's normal variation.

# Paying-customer standard: strict re-rating (C4 fbeed4a, synthetic, scripted, local browser)

DC asked (2026-10-20 07:10Z) for the UX to be judged critically, to the standard expected by a paying customer. This file
re-rates the same evidence (main, C2, C3 and C4 runs in this folder) without softening a finding because the journey
technically completes. No new runs. Nothing here has been checked on the live app. The checks that need it are listed
at the end as unverified.

## Would a paying customer accept this today? No.

The answers are largely accurate and honest by now. But the product doesn't yet *feel* like something worth paying for:
the main answer is buried in legal prose, the "with the page each answer comes from" promise can't be used, and the
first screen tells a household with a linked certificate that nothing is covered (if that also happens live).

## Re-rated severities

| # | Finding | Earlier | Strict | Why for a paying customer |
|---|---|---|---|---|
| 1 | Sources are plain text: not clickable, no quote, duplicated (10 entries, 4 identical), and the summary and the certificate share a name | major | **critical** | The home page promises "the page each answer comes from". Large amounts can't be checked, so trust depends on believing the app. |
| 2 | Answers are dense legal paragraphs. The main figure is buried, "conditional illustration… not a payment or an insurer's decision" repeats after every figure, and there's jargon ("sum insured", "calculation base", "bare '$' sign") | major | **critical** | A paying user wants "what could we get, and what do I do" in the first two lines. The fracture answers take 10–20 lines to read. |
| 3 | Closed hip: S$3,750 or S$450,000 side by side, with no "the insurer decides which document applies" note (C4; the Developer is adding it in C5) | major | **major** | Supported figures, but a 100x gap needs one plain sentence on top saying which is the safe expectation. |
| 4 | Portfolio: "Confirmed protection 0" and "Not found" in all 15 categories, plus a to-do "Upload personal proof", while a Personal proof certificate is Ready and linked | major if real | **critical if it reproduces live** | It's the first screen. It tells a paying household they have no cover. May be a synthetic-seed artifact; not yet verified live, and the first live check. |
| 5 | Superseded answer stays on screen unmarked after a correction | major | **major** | A user scrolling back reads withdrawn figures. |
| 6 | Unreadable upload card has no filename (title "·"), a generic reason, and is labelled "Reference" | major | **major** | The user can't tell which file failed or how to fix it, though the system stored a helpful reason. |
| 7 | No per-person document view. The family page says "5 linked documents" (not clickable) while the library shows 4 | major | **major** | Basic household navigation, and a count mismatch reads as a bug. |
| 8 | Mobile: the bottom tab bar cuts off after "Coverage", so **Ask DearPolicy**, Benefits and Claims are off-screen. The chat page opens scrolled past its heading | minor | **major** | The core feature isn't visible in the primary mobile navigation. |
| 9 | Enter inserts a new line instead of sending, with no hint | minor | **major** | Every chat product a customer uses sends on Enter. |
| 10 | Previous chats: titles are the first message (several identical), all tagged "Whole family" even when about one person | minor | **major** | The list can't be scanned to find a past conversation. |
| 11 | Error copy: "Nothing was saved from this attempt", yet the message and error are still there after reload. The "Following Grace" banner resets on reload | minor | minor | Small contradictions erode trust. |
| 12 | Reference documents show an expanded "Who does this document cover?" panel with pre-selected people and empty "Choose…" dropdowns, contradicting the upload note | minor | **major** | It looks like unfinished work on every reference document, the bulk of the library. |
| 13 | Next steps are generic ("Contact [insurer] through the employer… to ask what it needs") and sometimes duplicated in one answer | friction | major | The "know what to do next" promise is thin. |
| 14 | Sickness stay recites five conditions and "250 (printed with a bare '$' sign…)" before saying it doesn't apply | friction | major | The answer to a yes/no question should start with "No". |
| 15 | Dates in date-of-birth fields show mm/dd/yyyy for a Singapore household. The disabled Send button looks broken (pale peach) | minor | minor | Polish. |

## Strict verdicts (C4)

| Journey | Verdict at a paying-customer standard |
|---|---|
| Finding a family member's documents | Complete with friction (severe: no per-person view, count mismatch) |
| Understanding an unreadable upload | Complete with friction (severe: no filename, generic reason) |
| Asking a simple policy question | Complete without help (dental and cancer now clear) |
| Asking what might apply to an accident or illness | Complete with friction (severe: buried answer, 100x alternatives, sources unusable) |
| Answering a clarification | Complete with friction |
| Correcting a person or injury | Complete with friction (old answer unmarked) |
| Asking a side question | Complete with friction |
| Understanding conflicting documents | **Unable to complete without help.** The app says the documents conflict, but an ordinary person can't weigh them, can't open the pages, and is left with "ask the insurer". |
| Reopening a conversation | Complete with friction (conversation list can't be scanned) |
| Finding the next practical action | Complete with friction (generic, duplicated steps) |

## Smallest changes with the biggest effect (for the coordinator to scope)

1. Make each source a link to the document page, with the quoted row, and remove duplicates.
2. Lead every answer with one plain sentence, e.g. "If it's the hip: S$3,750 under the product summary, or up to
   S$450,000 under the PA summary; the insurer decides which applies." State the illustration caveat once.
3. Mark superseded answers after a correction.
4. Show the filename and the stored reason on an unreadable upload.
5. Make Enter send, and keep "Ask DearPolicy" visible in the mobile tab bar.

## Unverified: needs a live check

- Does the portfolio show "0 confirmed / Not found" for people with a linked certificate (finding 4)?
- Real upload: progress display, processing time and the failure message for a blurred photo.
- Real model: time to first feedback and to a complete answer (targets 10 s direct, 20 s scenario), and whether a
  progress indicator shows while waiting. Scripted turns took ~1.4 s here, which says nothing about production.
- Free-form everyday wording, corrections in the user's own words and tapping a clarification button. The scripted model
  couldn't follow paraphrases.
- Sign-in, sign-out and session expiry. All my runs used the development identity.

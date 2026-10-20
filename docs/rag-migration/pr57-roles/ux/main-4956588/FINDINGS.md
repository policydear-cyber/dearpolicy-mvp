# UX acceptance, first pass: main 4956588 (what users get today)

Role: User Experience Acceptance Agent. Date: 2026-10-20. Tested commit: `4956588` (main, production).

## What this is and is not

- **Evidence category: scripted (category 1), in a real browser.** The real Next.js app and `/api/chat` ran locally
  (`e2e/support/rag2-loop-server.ts`, `DEARPOLICY_RAG_LOOP=1`) on a local PostgreSQL seeded with the **synthetic**
  households `fracture`, `actuallib`, `deathjourney` and `livelib` (`e2e/support/seed-rag2-stress-report.ts`). Chromium via
  Playwright, desktop 1366x900 and mobile 390x844.
- The "model" is a scripted replay. **It only follows the recorded wording.** When I typed my own everyday phrasing,
  most multi-turn scenarios returned "the assistant model returned an error" (transcripts `*n.txt`, `fr1.txt`, `SA2.txt`,
  `SA3.txt`). Those errors are a harness limit, not a product defect. Where that happened I re-ran with the recorded
  wording and say so. Everyday phrasing that *did* work: "grace fell down and broke her arm", "oh sorry, actually it was
  daniel not grace", "does grace have dental?", "what does grace get if she gets cancer", "grace was in hospital 3 days
  last week, she was sick not an accident…".
- **Not tested:** real-model behaviour, the owner's actual library, production, real uploads (local processing needs
  model keys), and real response times. Scripted turns finished in about 1.4 s; first feedback (your message shown)
  appeared in under 100 ms. Those timings say nothing about a real model.
- `livelib` runs the older answer contract (the test server forces `legacy-operands` for it), so its chat answers are
  weaker evidence than the other households'.
- Facts below are **as displayed**. I have not checked them against the documents; the Policy Evidence Reviewer is
  asked to (see "Questions for the Policy Evidence Reviewer").
- One scripted-harness oddity for the developer: scenario `FX-K4B` turn 1 answered correctly once, then returned the
  model-error message on every later run, including after re-seeding (`k4b.txt` vs `dk4b.txt`). Probably harness state,
  but not confirmed.

## Top three issues

### 1. A closed fracture shows a "could be S$120,000 / S$300,000 / S$450,000" alternative next to S$1,250 to S$3,750 (critical, pending fact check)

- Steps: fracture household, "grace fell down and broke her arm" (`fr1.txt`, `shots/fr1-t1.jpg`). Booklet library,
  "Daniel fractured his tibia… closed fracture" then "Correction: it was his hip" (`SA2x.txt`, `SA3x.txt`, `SA4.txt`).
- On screen: two "conditional illustrations" side by side. One is S$1,250 (arm), S$2,500 (leg) or S$3,750 (hip) from the
  Simple Fracture table. The other is S$120,000, S$300,000 or S$450,000, a percentage of a S$600,000 personal accident sum
  insured, from a row the answer itself says is labelled "Other Fracture" with "no definition of which fractures that is".
  The user said **closed** fracture each time.
- Why an ordinary user struggles: the figures differ by a factor of 100 or more. The text says "not a payment or an
  insurer's decision" and "alternatives… never a total", but the reader is left believing a broken arm might be worth
  S$120,000. Nothing tells them which is more likely or why the second row might not apply to a closed fracture. If the
  documents do define "Other Fracture" (for example as compound or open fractures), this is a wrong-amount error, which is
  the worst kind.
- Smallest improvement: if the reviewer finds a definition, apply it and drop the inapplicable row. If there truly is
  none, lead with the figure the user's facts support and put the second row under a plainly worded line such as "One
  summary also lists a much larger 'Other Fracture' payment but doesn't say which fractures count; ask the insurer before
  relying on it."

### 2. Sources can't be opened, and they repeat and look alike (major)

- Steps: any answer, then expand "Sources" (`shots/fr1s-sources2.jpg`).
- On screen: ten entries for one answer. Four say "Aldermoor Life Ltd · Scheme X Group Insurance, Page 13". The Product
  Summary and the Certificate have the same visible name, and each entry says only "Your uploaded document". The entries
  are plain text (`div.citation`): no link, no quoted wording, no way to open the page.
- Why: the product's promise is "with the page each answer comes from". A user who wants to check S$120,000 cannot get to
  page 8 or see the printed row, and can't tell which "Scheme X Group Insurance" is meant.
- Smallest improvement: remove duplicate entries, show the document type (Certificate, Product Summary, Booklet) and the
  quoted row, and link each entry to that document's page in Documents → Details.

### 3. Answers are dense legal prose and the main answer is hard to find (major)

- Steps: every accident answer (`SA3x.txt` turn 1, `shots/sa3-q.jpg`; `fr1.txt`).
- On screen: the hip/tibia answer opens with one 15-line paragraph listing every row of two tables, footnote markers
  "(marked ^)" and "(marked #)", and sentences like "these are alternatives from separate documents, never a total". Each
  figure repeats "it is an illustration from the document's terms, not a payment or an insurer's decision", and the
  footnote is repeated. The death answer lists the compassionate allowance twice, once with "printed with a bare '$' sign"
  (`DJ1.txt`).
- Why: the reader can't see "what could we get" at a glance. Terms like "conditional illustration", "sum insured" and
  "calculation base" are never explained. The repeated caveats bury the one caveat that matters.
- Smallest improvement: one plain lead sentence ("If it's the hip: S$3,750. If it's the leg: S$2,500."), then supporting
  detail. Say "this is an estimate from the policy wording, not a promise to pay" once per answer, next to the first
  figure.

## Other findings

Each finding is labelled as factual (F), usability (U) or visual preference (V).

| # | Journey | Finding | Type | Severity | Evidence | Smallest improvement |
|---|---|---|---|---|---|---|
| 4 | Correction | After "it was his hip", the earlier tibia answer (S$2,500 / S$300,000) stays above with no "replaced" marking. The notice in the new answer is clear, but someone scrolling back reads withdrawn figures. Same after reload. | U | major | `shots/sa2-old.jpg`, `SA2x.txt` | Grey out the superseded answer with "Replaced by the corrected answer below". |
| 5 | Unreadable upload | The unreadable file's card has **no name** (title shows "·"), is labelled "Reference" and gives a generic message. The specific reason the system stored ("too blurred… lay the page flat in good light…") is not shown. | U | major | `shots/ll-unread.jpg` | Show the filename (IMG_0042.jpg) and the stored reason. Don't label it Reference. |
| 6 | Unreadable upload, chat | "List all our documents… including any that could not be read" names IMG_0042.jpg but says "(it could not be read)" twice, gives no reason or fix, and leaves out the roles that were asked for. | U | minor | `L1.txt` | Add the reason and "upload a clearer copy". |
| 7 | Finding a person's documents | Documents can be filtered only by All / Personal proof / Reference, not by person. Family shows "5 linked documents" for each person, which can't be clicked, while the library shows 4 (a superseded 2022 summary is counted but hidden). | U | major | `shots/fam.jpg`, `shots/docs.jpg` | Make "N linked documents" a link to a person-filtered library. Count only the documents shown. |
| 8 | Portfolio | With a "Personal proof" certificate Ready and linked to Daniel and Grace, the portfolio says "Confirmed protection 0", "Not found" for all 15 categories, and the to-do says "Upload personal proof". **May be a synthetic-seed limitation** (the seed may not build the coverage ledger). Developer to confirm against production. | U/F | major if real | `shots/home.jpg` | Developer to confirm first. |
| 9 | Documents | Reference documents show "Who does this document cover?" with both people pre-selected and "Choose…" cover dropdowns, while the upload note says reference documents don't need assigning. Two different documents are both titled "Scheme X Group Insurance… Certificate". | U | minor | `shots/docs.jpg` | Hide or collapse the assignment panel for reference documents, or explain why it's there. |
| 10 | Accident (first answer) | The first fracture answer has no next step. The next step appears only on a later turn. | U | minor | `fr1.txt` vs `fr1x.txt` | Include the next step on the first complete answer. |
| 11 | Death, what to do | "I did not read a claims procedure… before this question's model-use limit" exposes an internal limit and reads as "I gave up". A line also says death by natural catastrophe "applies only to a death caused by an Accident", which is self-contradictory to a lay reader. | U | major | `DJ1.txt` | Say "Your documents I checked don't list the claim steps; the insurer will tell you", with no mention of limits. |
| 12 | Death abroad (legacy contract) | "Adrian died in a car accident in Japan" gives only Term Life S$1,000,000. It doesn't mention the personal accident cover or the single-trip travel policy in the same library. The next steps were good. | F (omission?) | major if confirmed | `L2.txt` | Reviewer to confirm whether accidental death and travel benefits apply. |
| 13 | Side question | Switching to "And if Grace fractured her hip…" correctly answers for Grace only (S$3,750), with no Daniel facts carried over. A dangling line then follows: "Grace's certificate lists Group Personal Accident of S$100,000", with no explanation of how it relates. | U | minor | `SA6.txt` | Drop the line or say what it means for this question. |
| 14 | Simple question | Cancer: "Group Living Care of S$350,000" then "does not state what Group Living Care pays for cancer". The reader can't tell whether Living Care is relevant at all. | U (F?) | minor | `FX-K6A.txt` | Reviewer: does the document say what Living Care covers? |
| 15 | Clarification | The question card is good: one question, buttons, and why it matters. But someone who said "tibia" has to work out that it falls under "Jaw, Pelvis, Leg, Ankle or Knee". Typed answers in my own words couldn't be tested (scripted). | U | minor | `shots/sa3-q.jpg` | Show the matching row, e.g. "Leg (tibia)". |
| 16 | Reopen | Reopen and reload show identical answers, figures and next steps. However, the chat list titles are the first message, so several chats look identical, all are tagged "Whole family" even when about Grace, and the "Following Grace" context banner resets after reload. | U | minor | `shots/prev.jpg`, `fr1.txt` | Tag each chat with the person it is about. |
| 17 | Error state | The model-error message says "Nothing was saved from this attempt", yet the message and the error are still there after reload. | U | minor | `fr1.txt` (after reload) | Say "Your message was saved, but no answer was produced. Try sending it again." |
| 18 | Mobile | No horizontal overflow at 390 px. However, the bottom tab bar cuts off after "Coverage", so Benefits, Claims and **Ask DearPolicy** are off-screen. The chat page also opens scrolled past its own heading. | U | minor | `shots/mvp_chat.jpg` | Show "Ask DearPolicy" in the visible tabs. |
| 19 | Keyboard | Tab order is logical and links show a focus ring. Enter inserts a new line instead of sending, with no hint. The textarea shows no focus outline. | U | minor | `vp` run output | Add an "Enter to send, Shift+Enter for a new line" hint, or keep the current behaviour and say so. |
| 20 | Visual | Text contrast is good (dark brown on cream). The disabled Send button is light peach and reads like a broken button. | V | minor | `shots/fr1-t1.jpg` | Preference only. |

## Verdict per journey (main 4956588, synthetic, scripted)

| Journey | Verdict | Main reason |
|---|---|---|
| Finding a family member's documents | Complete with friction | No per-person filter; family count (5) ≠ library (4); portfolio shows nothing confirmed (#7, #8) |
| Understanding an unreadable upload | Complete with friction | The failed card has no filename and a generic reason (#5) |
| Asking a simple policy question | Complete without help (dental) / with friction (cancer) | #14 |
| Asking what might apply to an accident or illness | **Unsafe or misleading** (pending fact check) | S$120k–S$450k "Other Fracture" alternative for a closed fracture (#1); hard to read (#3) |
| Answering a clarification | Complete with friction | Good single question; bone-to-row mapping left to the user (#15) |
| Correcting a person or injury | Complete with friction | Recalculates correctly and names the change; the old answer is not marked (#4) |
| Asking a side question | Complete with friction | No contamination; a dangling figure (#13) |
| Understanding conflicting documents | **Unsafe or misleading** (same as #1) | It says the documents conflict but doesn't help the user weigh them; sources can't be opened (#2) |
| Reopening a conversation | Complete without help | Identical after reload and reopen; minor labelling (#16) |
| Finding the next practical action | Complete with friction | Generic "contact the insurer through the employer"; the death answer exposes a "model-use limit" (#11) |

## Questions for the Policy Evidence Reviewer (route via coordinator)

1. Fracture and actuallib/booklet households: do any documents define "Other Fracture" (for example compound or open)? If
   so, should a stated closed fracture get the S$120,000 / S$300,000 / S$450,000 alternative at all?
2. Is the S$600,000 Group Personal Accident sum insured printed for **both** Daniel and Grace in the fracture household?
   In actuallib, Grace's is S$100,000.
3. Fracture household: does Group Living Care (S$350,000) state what it covers? Is cancer within it?
4. Livelib: for an accidental death in Japan, do the Personal Accident certificate and the single-trip travel schedule
   print a death benefit that the answer left out?
5. Deathjourney: do the documents print a death claims procedure (forms, documents)?

## Files

- `transcripts/`: page text after each turn, with the status, first-feedback and settle times. The `*n.txt` files are my
  everyday-language attempts. The others use the recorded wording.
- `shots/`: screenshots referenced above (JPEG).
- `chat.mjs`, `snap.mjs`: the browser drivers used. They need the local loop server on port 3300.

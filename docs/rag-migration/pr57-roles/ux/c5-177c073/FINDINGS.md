# UX acceptance, final candidate C5: 177c073427bab0acb231a34018208a8d0448100f

Same method and limits as the earlier passes: **scripted (category 1) in a real browser**, synthetic households, local
server and database, production answer setup (`benefits` contract; livelib forced with
`DEARPOLICY_CHAT_CONTRACT=benefits`). No real model, no actual library, no production. Nothing verified live. Judged to
the paying-customer standard in `../PAYING-CUSTOMER-REVIEW.md`.

## The three checks

| Check | C4 fbeed4a | C5 177c073 | Evidence |
|---|---|---|---|
| Closed hip, actuallib (SA2) | S$3,750 or S$450,000, "does not settle which applies", next step "ask which of the two schedules applies" | **Identical to C4** (page text diff empty apart from timings and the chat count). Both figures are supported (Reviewer). The two-document point appears only as the generic opening line and the next step. Nothing next to S$450,000 says it may not be the one that applies. | `transcripts/SA2x.txt`, `shots/closed-hip.jpg` |
| Dental, partial copy (recorded and own wording) | "I checked… [pages]… can't say either way" | **Same as C4.** Clear and honest. | `transcripts/K6Bx.txt`, `K6Bn.txt` |
| Death abroad, livelib (L2) | Travel line removed | **Travel line is back, with its limits:** "prints Accidental Death: S$100,000. The schedule prints this cover for… 'Wong Jia Hui, Adrian', the period of insurance '10/03/2025 to 17/03/2025' and the destination 'Indonesia'; whether that trip fits this event is for the insurer to confirm." | `transcripts/L2prod.txt`, `shots/death-abroad.jpg` |

## Strict assessment of the C5 changes

- **Death abroad (major).** Showing the trip's limits is honest and better than C3's bare S$100,000. But the user said
  *Japan*, and the schedule says *Indonesia*, March 2025. Leaving that "for the insurer to confirm" invites a grieving
  family to hope for S$100,000 that plainly doesn't fit. Smallest improvement: say "This travel policy covered a March
  2025 trip to Indonesia, so it doesn't appear to apply to a death in Japan."
- **Closed hip (major, unchanged).** The figures are correct. A paying customer still sees S$3,750 and S$450,000 as equal
  alternatives in eight lines of prose. Smallest improvement: one plain lead sentence, e.g. "Your two documents give
  very different amounts (S$3,750 or S$450,000), and neither says which applies. Ask the insurer which one applies before
  relying on the larger figure."
- **Dental:** acceptable.

## Final top three (C5, paying-customer standard)

1. **Sources can't be opened, repeat, and look alike** (critical). This is unchanged since main because no UI change was in scope.
2. **The main answer is buried in legal prose, with caveats repeated after every figure** (critical). The closed hip and
   death abroad answers above are the clearest examples.
3. **Large figures shown without plain guidance on which is likely:** S$450,000 alongside S$3,750 for a closed hip, and a
   S$100,000 travel benefit for a different country and year "for the insurer to confirm" (major).

Also open and unverified live: the portfolio "Confirmed protection 0 / Not found ×15" with a linked certificate
(critical if it reproduces live).

## Final verdicts (C5, synthetic, scripted, paying-customer standard)

| Journey | Verdict |
|---|---|
| Finding a family member's documents | Complete with friction (severe: no per-person view; count mismatch) |
| Understanding an unreadable upload | Complete with friction (severe: no filename or reason on the card) |
| Asking a simple policy question | Complete without help |
| Asking what might apply to an accident or illness | Complete with friction (severe: buried answer; large alternatives without guidance; sources unusable) |
| Answering a clarification | Complete with friction (not re-run since C2) |
| Correcting a person or injury | Complete with friction (old answer unmarked) |
| Asking a side question | Complete with friction (not re-run since C2) |
| Understanding conflicting documents | **Unable to complete without help** |
| Reopening a conversation | Complete with friction (chat list can't be scanned) |
| Finding the next practical action | Complete with friction (generic and duplicated steps) |

No journey is unsafe or misleading on the scripted evidence, provided the Reviewer's confirmation of S$450,000 holds.
Every journey except the simple question still falls short of the paying-customer standard.

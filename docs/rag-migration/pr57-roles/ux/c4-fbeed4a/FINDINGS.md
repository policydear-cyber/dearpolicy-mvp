# UX acceptance, final repeat on C4: fbeed4af76800a62c866def07b6d6bd1587c5749

Same method and limits as the earlier passes: **scripted (category 1) in a real browser**, synthetic households, local
server and database, production answer setup (`benefits` contract; livelib forced with
`DEARPOLICY_CHAT_CONTRACT=benefits`). No real model, no actual library, no production. C4 changes no UI files.

## What changed from C3

| Check | C3 17668630 | C4 fbeed4a | Evidence |
|---|---|---|---|
| "Other Fracture" rows (arm and leg; fracture and actuallib households) | "these documents print no definition of which fractures that is" | **Better.** It now says "these documents do not define which fractures count as Other Fracture, or whether a closed fracture is one, so the insurer decides whether it applies" (the "closed" clause appears when the user said closed) | `transcripts/SA3x.txt`, `SA4.txt`, `k4b.txt` |
| Closed hip (actuallib SA2) | S$3,750 or S$450,000 | **Unchanged.** S$450,000 (75% of S$600,000) with no "insurer decides" note. The hip row isn't labelled "Other Fracture", so the new note doesn't attach. | `transcripts/SA2x.txt`, `shots/closed-hip.jpg` |
| Death abroad (livelib L2) | Listed an unrelated travel policy's S$100,000 | **Fixed.** Travel line gone. It shows Term Life S$1,000,000, PA S$600,000 with "Accidental Death: 100% of the Sum Insured", and repatriation S$2,000 outside Singapore. | `transcripts/L2prod.txt`, `shots/death-abroad.jpg` |
| Dental (recorded and own wording) | "…the rest is not stored and could not be checked…" | **Fixed.** "I checked Grace's documents for dental treatment: [pages]. Those pages do not mention dental treatment. The other pages may not all be in the copy that was uploaded, so I can't say either way whether there is such cover." Plain and honest. | `transcripts/K6Bx.txt`, `K6Bn.txt`, `shots/dental.jpg` |
| Cancer | Same "not stored" paragraph | **Fixed.** Same new wording | `transcripts/FX-K6A.txt` |
| X-ray card (FX-K4B, fresh seed and server) | None | None (still fixed) | `transcripts/k4b.txt` |
| Sickness stay | Long recital before "doesn't apply" | Unchanged | `transcripts/FX-K2.txt` |

## Question for the Policy Evidence Reviewer

On actuallib's Group Personal Accident Benefit Summary page 8, is the "Hip 75%" row payable for any accidental hip
fracture, closed included? If yes, S$450,000 is a supported alternative and the remaining problem is only how it's
explained. If the row is limited (for example to "Other" fractures), the closed-hip answer still shows an unsupported
S$450,000. My accident verdict below depends on this.

## Top three issues on C4

1. **A closed hip fracture shows S$3,750 or S$450,000 as two equal-looking "alternatives"** in long prose. Unlike the
   arm and leg rows, it has no note that the insurer decides which applies. A reader is likely to anchor on S$450,000.
   (Major; critical if the reviewer finds the hip row doesn't cover a closed fracture.)
2. **Sources can't be opened, repeat, and look alike** (ten entries, four identical; the summary and the certificate share a name), so a user can't
   check the S$450,000 or S$600,000 themselves. (Major, unchanged since main; no UI change.)
3. **Answers are dense legal prose and corrections leave the old answer unmarked.** "Conditional illustration… not a
   payment or an insurer's decision" repeats after every figure. The death-abroad answer makes the reader combine "S$600,000"
   and "100% of the Sum Insured" themselves, adds an irrelevant Terminal Illness line, and gives two next steps that say
   the same thing. (Major, unchanged.)

Still open from main: the unreadable-upload card has no filename or reason, and the family page count (5) doesn't match
the library (4).

## Final verdicts (C4, synthetic, scripted)

| Journey | Verdict | Basis |
|---|---|---|
| Finding a family member's documents | Complete with friction | UI unchanged since main |
| Understanding an unreadable upload | Complete with friction | UI unchanged since main |
| Asking a simple policy question | **Complete without help** | Dental and cancer answers now plain and honest |
| Asking what might apply to an accident or illness | **Complete with friction** (pending the reviewer's hip answer; unsafe or misleading if the hip row doesn't cover a closed fracture) | Other Fracture rows now say the insurer decides; death abroad fixed; closed hip S$450,000 has no such note |
| Answering a clarification | Complete with friction | Not re-run on C4; C2 result stands |
| Correcting a person or injury | Complete with friction | Notice correct; old answer unmarked |
| Asking a side question | Complete with friction | Not re-run on C4; C2 result stands |
| Understanding conflicting documents | **Complete with friction** | The conflict is stated and the next step says to ask which schedule applies, but a 100x gap in dense prose with unopenable sources is hard to weigh |
| Reopening a conversation | Complete without help | C3 result stands; no change in C4 |
| Finding the next practical action | Complete with friction | Present but generic, sometimes duplicated |

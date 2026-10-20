# UX acceptance, final repeat on C3: 17668630fab90a94997f3c918d8a5b31139ec40e

Same method and limits as `../main-4956588/FINDINGS.md`: **scripted (category 1) in a real browser**, synthetic
households, local server and database, no real model and no production. C3 changes no UI files. Every run used the
production answer setup (`benefits` contract). Livelib's test server forces the legacy contract by default, so I
overrode it with `DEARPOLICY_CHAT_CONTRACT=benefits`.

**Label correction:** the closed-fracture runs that I called "Booklet library" in the main and C2 files ran on the
**actuallib** household, whose library includes a benefits booklet. I never ran the separate `booklet` household. Both
earlier files are corrected.

## Repeated journeys

| Check | C2 98ada99 | C3 17668630 | Evidence |
|---|---|---|---|
| X-ray card (FX-K4B, fresh seed and server) | Unprompted X-ray question citing the leg row | **Fixed.** No question card; the answer matches main | `transcripts/k4b.txt`, `shots/fracture-no-question.jpg` |
| Correction line (FX-K4B turn 2) | Line saying Grace's estimate no longer applies was missing | **Fixed.** "The earlier estimates I worked out for Grace… no longer apply" is back, and survives reload | `transcripts/k4b.txt` |
| Dental (FX-K6B, recorded and own wording) | "I couldn't confirm an answer" | **Better than C2, worse than main.** It lists the pages checked and says they don't mention dental, then: "the rest is not stored and could not be checked, so this is not an answer about whether there is such cover." A user may read "not stored" as lost data. | `transcripts/K6Bx.txt`, `K6Bn.txt`, `shots/dental.jpg` |
| Sickness stay (FX-K2) | Long recital of accident-benefit conditions, then "doesn't apply" | **Unchanged from C2.** Conclusion correct but buried. The "Living Care" pointer is unexplained. | `transcripts/FX-K2.txt` |
| Cancer (FX-K6A) | Clear | Adds the same "only part… not stored" paragraph, so it says the same thing twice | `transcripts/FX-K6A.txt` |
| Death abroad (livelib L2, production setup) | Legacy run omitted PA S$600,000 and S$2,000 repatriation | **Now shown:** PA S$600,000, "Accidental Death: 100% of the Sum Insured", repatriation S$2,000 if death is outside Singapore. **New problem:** it also lists "Single Trip Travel Insurance… Accidental Death: S$100,000" without saying that policy covers a different trip (the Reviewer: Indonesia, March 2025). Irrelevant "Terminal Illness Benefit" line; two next steps say the same thing. | `transcripts/L2prod.txt`, `shots/death-abroad.jpg` |
| Closed hip fracture, actuallib (SA2) | S$3,750 alongside S$450,000 "Other Fracture" | **Unchanged.** Still S$450,000, still no line saying "closed" isn't defined | `transcripts/SA2x.txt` |

My own wording for death abroad ("what if adrian died in a car crash in japan…") got the scripted model's error
(`L2n.txt`), which is a harness limit.

## Top three issues on C3

1. **Closed fracture shows a S$120,000 / S$300,000 / S$450,000 alternative** next to S$1,250–S$3,750, from an undefined
   "Other Fracture" row. The answer doesn't say the documents don't define "closed". The Reviewer rates this high risk
   here, and a wrong amount in two other synthetic households. (Critical, unchanged since main.)
2. **Death abroad lists a S$100,000 travel accidental-death benefit from a policy for a different trip** as if it might
   add to the family's money. (Major, new under the production setup. I can't compare it with main because my main run
   used the legacy setup.)
3. **Sources can't be opened, repeat, and look alike** (ten entries, four identical; the summary and the certificate share a name), so a user can't
   check the figures in issues 1 and 2. (Major, unchanged; no UI change in C3.)

Still open from main: dense legal prose with caveats repeated per figure, superseded answers not marked after a
correction, the unreadable-upload card with no filename or reason, and the family "5 linked documents" vs library 4.

## Final verdicts (C3, synthetic, scripted)

| Journey | Verdict | Basis |
|---|---|---|
| Finding a family member's documents | Complete with friction | UI unchanged since main (no per-person filter; count mismatch) |
| Understanding an unreadable upload | Complete with friction | UI unchanged (no filename or reason on the card) |
| Asking a simple policy question | Complete with friction | Dental and cancer now carry the confusing "rest is not stored" wording |
| Asking what might apply to an accident or illness | **Unsafe or misleading** | Issue 1; death abroad issue 2; sickness stay correct but buried |
| Answering a clarification | Complete with friction | Not re-run on C3; main/C2 result stands (good single question; user maps tibia to "Leg") |
| Correcting a person or injury | Complete with friction | Notice restored; superseded answer still unmarked |
| Asking a side question | Complete with friction | Not re-run on C3; C2 result stands |
| Understanding conflicting documents | **Unsafe or misleading** | Same alternative figures as issue 1; sources can't be opened |
| Reopening a conversation | Complete without help | Correction conversation identical after reload on C3; reopen worked on main |
| Finding the next practical action | Complete with friction | Next steps present but generic and sometimes duplicated |

Compared with C2, C3 fixes both C2 regressions (the X-ray card and the missing correction line) and partly fixes the
dental answer. It doesn't change the closed-fracture alternative, the sources or the reading burden.

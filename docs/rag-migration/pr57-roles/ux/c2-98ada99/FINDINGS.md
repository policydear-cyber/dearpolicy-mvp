# UX acceptance, repeat on C2: 98ada99 (claude/pr57-followup-pgaq7d)

Same method and limits as `../main-4956588/FINDINGS.md`: **scripted (category 1) in a real browser**, synthetic
households, local server and database, no real model and no production. C2 changes no UI files (`app/`, `components/`),
so I repeated the chat journeys only. The GP-bill fix (G1, G2) has no browser scenario in the scripted server, so it was
**not** tested here.

## Regressions on C2 compared with main

### R1. Unprompted X-ray question returns, citing the leg row for an arm fracture (critical)

- Steps: fresh seed and fresh server, scenario `FX-K4B`, "grace fell down and broke her arm".
- Main 4956588: an answer with no question (`transcripts/main-4956588-fresh-FX-K4B.txt`).
- C2 98ada99: the same answer, then the card "A fact that changes this assessment: Was Grace's arm fracture confirmed by
  X-ray and certified by a registered medical practitioner?" with "This changes what your policy pays under: 'Jaw,
  Pelvis, Leg, Ankle or Knee (Other Fracture) 50%' (page 8)" (`shots/xray-question.jpg`, `transcripts/c2fresh.txt`,
  `transcripts/k4b.txt`).
- Why: an invented paperwork requirement, tied to the wrong body part's row. This is the shape of the owner's live
  complaint.
- Reproduction note: only the first `FX-K4B` run after a fresh seed and server is usable on either build. Later runs
  return the model-error message on both (`transcripts/rep1.txt`). That is harness state, not a product difference.

### R2. Dental question loses its supported answer (major)

- Steps: `FX-K6B`, "Does Grace's cover pay for dental treatment?" (recorded wording) and "does grace have dental?"
  (mine).
- Main: "Grace's documents (… three named) do not describe a benefit for dental treatment. That is not the same as saying
  there is no such cover… only the insurer can confirm."
- C2: "I couldn't confirm an answer to that from your documents." (`shots/dental.jpg`, `transcripts/K6Bx.txt`).
- Why: a vague non-answer in place of a useful, supported one. The user can't tell whether anything was checked.

## Changed, not regressions

- Cancer (`FX-K6A`): clearer. It now says "The sum insured listed for Group Living Care does not by itself say what is
  paid for a particular diagnosis".
- Sick hospital stay (`FX-K2`): longer and harder to read. It now prints all five Accidental Hospital Recuperation
  conditions and "250 (printed with a bare '$' sign…)" before saying they don't apply, then adds "Grace's certificate also
  lists Group Living Care and Group Living Care Plus" without saying whether those could help.
- Person correction (`FX-K4B` turn 2): the line "The earlier estimates I worked out for Grace… no longer apply" is gone.
  Only "Updated: this is about Daniel, not Grace." remains, while Grace's X-ray question card is still answerable above.
- Fracture answers now add "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme" and drop
  "…or which applies to this event". No effect on understanding.

## Unchanged on C2 (main findings still apply)

Top issue 1 (S$120,000 / S$300,000 / S$450,000 "Other Fracture" alternative for a stated closed fracture), top issue 2
(sources not openable and duplicated), top issue 3 (dense prose), the unmarked superseded answer, the unreadable-upload
card and the family/library count mismatch. actuallib-household journeys (not the `booklet` household; earlier mislabelled) SA2, SA3, SA5 and SA6 give the same figures as on
main.

## Policy Evidence Reviewer answers (relayed by the coordinator; EVIDENCE.md sections 6-7 @ ca3742d)

1. "Other Fracture" is not defined in the fracture and actuallib households, so "no definition" is true there. Showing
   S$120,000 for a closed fracture is **high risk rather than wrong**, and the answer should say that "closed" isn't
   defined. In two other synthetic households it *is* defined, and there the alternative would be a wrong amount (sent to
   the Developer).
2. S$600,000 Group Personal Accident is printed for both Daniel and Grace (as of 6 Oct 2022).
3. Living Care doesn't say what it covers and doesn't mention cancer, so the C2 wording is accurate.
4. Livelib death abroad: documented benefits were **omitted**, namely Personal Accident at 100% of S$600,000 worldwide
   and S$2,000 for repatriation. The travel policy doesn't apply (Indonesia, March 2025). Main finding #12 is confirmed as
   a factual omission.
5. There is no general death-claims procedure; individual benefits list documents to send. The main answer's "model-use
   limit" sentence is therefore the wrong explanation, though the substance (no procedure listed) is right.

## Verdicts on C2 (changes from main in bold)

| Journey | Main 4956588 | C2 98ada99 |
|---|---|---|
| Finding a family member's documents | Complete with friction | Complete with friction (UI unchanged) |
| Understanding an unreadable upload | Complete with friction | Complete with friction (UI unchanged) |
| Asking a simple policy question | Complete without help (dental) | **Complete with friction: dental now a non-answer (R2)** |
| Asking what might apply to an accident or illness | Unsafe or misleading | **Unsafe or misleading, worse: invented X-ray question on the wrong row (R1)** |
| Answering a clarification | Complete with friction | Complete with friction |
| Correcting a person or injury | Complete with friction | Complete with friction (weaker notice) |
| Asking a side question | Complete with friction | Complete with friction |
| Understanding conflicting documents | Unsafe or misleading | Unsafe or misleading |
| Reopening a conversation | Complete without help | Not re-run (no UI or storage change) |
| Finding the next practical action | Complete with friction | Complete with friction |

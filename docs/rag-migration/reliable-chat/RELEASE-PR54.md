# PR #54 release recommendation (17 Oct 2026)

**Recommendation: ready for DC's merge decision**, as a reviewable, unmerged PR. Main (`d549a27`) and production are
unchanged. Merge only on DC's approval; after deploying, re-ask the affected questions against the actual library
before calling them fixed there (all evidence below is synthetic or anonymised-fixture evidence).

## What changes for the household

- A benefit printed as a heading above its paragraph (the booklet's Compassionate Death Allowance) is found and stated
  by name with its own conditions; a bare "$" is said with its currency unstated, never as S$.
- A benefit summary's bullet / tab rows are named by the benefit, with their footnote condition.
- The server writes the benefit's terms; the model selects the benefit. If the model's own statement about an offered
  benefit fails its check, the benefit's checked terms are still shown.
- Two statement checks (this round):
  1. a restriction restated with a limit its cited wording does not print ("…, but not both") is left out whole -- the
     restriction is already said as printed in the benefit's terms;
  2. "these documents do not establish that this benefit applies to him" is said as separate terms: the person's dated
     certificate listing (with its later-date limit) and that eligibility for this event is not established. A
     statement that also calls the enrolment unconfirmed keeps the earlier behaviour (the dated listing alone); a
     statement already limited to "now" and a person no certificate lists are left as said.

## Evidence

| Check | Result |
|---|---|
| rc-live-9 (real model, tested `c729058`, grader v7) | FL5a PASS 13/13, FL5b PASS 13/13; US$0.003323, 10.3 s / 15.0 s |
| Saved FL5 answers replayed on the final code (route) | 20/20 incl. positive and negative controls for both checks |
| Same replay in the browser (real chat page, displayed = saved) | FL5A, FL5B, RC8 3/3; booklet 6/6; Tan 3/3 |
| person_benefits boundary / rc-live-8 replay | 20/20 / 26/26 |
| Active route, rag2 fix / binding / live-verify / loop, verify assertions / gate, v11 / r5 / r7, claims, tsc, build (Node 22) | all pass |

Earlier real-model results are kept as graded: rc-live-6 (synthetic-only FL3), rc-live-7 (FL4, v5 FAIL), rc-live-8
(FL4b, v6 FAIL), rc-live-9 (PASS). No model-facing record, prompt or tool schema changed after rc-live-9 (prompt
`rag2-loop-v18-applicability`, system sha `10d8a4d144da`, tools sha `98a759ed14a3`), so no further paid run was made.

## Visible changes to the saved rc-live-9 answers

- FL5a: "The benefit can be claimed under either the Core Scheme or the Voluntary Scheme, but not both." is no longer
  shown (the printed restriction stays in the allowance's terms).
- FL5b: "The booklet says the certificate shows which products and amounts apply; so these documents do not establish
  that this funeral benefit applies to him." becomes "Daniel's certificate lists Daniel under Group Personal Accident
  as of 01/04/2024; whether the Compassionate Death Allowance Benefit applies to Daniel for this event is not
  established by the documents." plus "A dated certificate shows who it listed on that date; it does not by itself
  establish cover on a later date."

## Limits and risks

- One real-model attempt per question: consistency across repeated attempts is not established.
- All live evidence is on the anonymised recorded fixture, not the actual library.
- The heading-and-paragraph reader takes a section as a benefit only when it prints exactly one amount and no
  percentage table; other layouts stay unresolved rather than guessed.
- FL5a (10.3 s) is just over the 10 s direct-answer target.
- A model-written contact step is checked against the answer's cited documents; the server-rendered `contact:<policy>`
  form (what the models used) is unaffected.

## Migration, data and rollback

No migration, no schema or stored-data change, no new dependency. Rollback: revert the merge commit; nothing to undo
in data.

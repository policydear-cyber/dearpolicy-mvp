# Correction to scenario-grade.md / scenario-grade.json (appended 2026-10-13; the original grade is unchanged)

The pre-registered grader gave this run **FAIL** with "earliest failing stage: calculation". The FAIL verdict stands, but that stage label is wrong:

- **Calculation succeeded.** Turn 5's `calculate lump_sum` (with the 50% simple-fracture share) returned a correct S$9,000 `conditional_illustration`.
- **First rejection: composition.** The composer dropped the sentence for its wording ("an illustration must state its what-if"). The turn's single repair went unanswered, because the model made no further call.
- **Second rejection: verification.** The save-time gate refused the S$300,000 certificate figure. The composer had bound it to the roster row's name cell ("Lim Wei Jie, Desmond") instead of its product heading (GROUP PERSONAL ACCIDENT).
- **Presentation:** the household saw neither figure.

The grader only gives the "calculation" label when no saved lump-sum record exists. Here the record was missing because the sentence was dropped, not because the calculation failed. **Corrected earliest failing stage: composition, then verification, then presentation.**

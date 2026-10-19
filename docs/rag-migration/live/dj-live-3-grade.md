# dj-live-3 grade (death-v1 grader, unchanged)

Run `dj-live-3`, scenario DI, tested code `f2fe6a630243bd19ac4ccaec95df965aa8504dc5`, model gpt-6-luna (provider-reported), 3 calls, US$0.002098, 65.5 s. The harness's own `scenario-check.ts` did not grade DI (INCOMPLETE, 0 checks); the death-v1 grader (`scripts/rag2-live/death-check.ts`, the same one used for dj-live-1/2) was run on the saved record: **FAIL**.

## Complete visible answer
> The Group Insurance Product Summary says the Group Term Life death benefit is 100% of the Sum Assured, and death must occur while the insured person is covered; it defines the Sum Assured as the amount on the person’s certificate. Daniel’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; that dated amount does not confirm cover on his date of death. The uploaded documents do not establish whether Daniel was covered on the date he died or what amount applied then.
> What was Daniel’s exact date of death?

## Checks
- G1 PASS - no budget-only dead end, refusal or “couldn't confirm” text, and no model error
- G2 PASS - no unfinished clause: no cut quotation, no orphan fragment, every line ends as a sentence or a question
- G3 PASS - no payment promise
- G4 PASS - no raw internal identifier
- G5 PASS - no invented paperwork, deadline or party
- G6 PASS - returned = saved = displayed: the answer the browser was given equals the saved answer, whole
- G7 PASS - every saved next step is visible (none saved but not shown)
- I1 PASS - Daniel's Group Term Life S$1,000,000 is stated on a line naming Term Life and Daniel, with the certificate date, not presented as current cover
- I2 PASS - no accident-only benefit's figure (S$600,000, Accidental Death 100%, the allowance's 2,000) is presented as potentially payable: any line with one says it is accident-only / does not fit
- I3 PASS - Personal Accident / Accidental Death / the allowance, if named, are said to depend on an Accident (the death was reported as an illness)
- I4 PASS - no dismemberment / fracture benefit, row, figure or window for a death question
- I5 FAIL - a visible next step: contact the person's own insurer (Aldermoor Life Ltd) about a claim
- I6 FAIL - no unnecessary question: the person and the cause (illness) are known
- I7 PASS - Grace's figures (S$200,000 / S$100,000) are not attached to Daniel

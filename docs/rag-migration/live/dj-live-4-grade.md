# dj-live-4 grade (death-v1 grader, unchanged)

Run `dj-live-4`, scenario DI, tested code `654121fbafe57df5211eb020c26e99115f3d1278` (PR #56), model gpt-6-luna (provider-reported), one attempt, 3 calls, US$0.0021476, 31.8 s (provider/proxy hop 30.6 s of it: 4.5 + 15.5 + 10.7 s). US$0 preflight first (`RUN-dj-live-4-pre-*`, 0 calls). Cap US$0.01; the US$0.15 reservation and all spend history unchanged. The relay was stopped afterwards. The unchanged death-v1 grader (`scripts/rag2-live/death-check.ts`) on the saved record: **PASS** (G1-G7, I1-I7 all true). The original dj-live-2 and dj-live-3 grades are untouched.

DI message: "Daniel passed away last week after a long illness - it was not an accident. What would the family receive from his insurance, and what should we do?"

## Complete visible answer (saved = displayed; outcome final_answer, no question)
```
Daniel’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; that dated amount is not confirmation of cover on the date he died.
The Group Insurance Product Summary says Group Term Life pays 100% of the Sum Assured for death or terminal illness, provided death occurs while the insured person is covered, and defines the Sum Assured as the amount on the person’s certificate.
Daniel's certificate lists Daniel under Group Term Life as of 06/10/2022.
The Compassionate Death Allowance wording applies to death as a result of an accident, so it does not fit the circumstances you described.
For a death reported as an illness, Compassionate Death Allowance Benefit is printed as accident-only (printed condition: “If an Insured Person dies as a result of an Accident”), so it does not fit that report and no amount is given for it.
For a death reported as an illness, Group Personal Accident is printed as accident-only, so it does not fit that report and no amount is given for it.
For a death reported as an illness, Accidental Death is printed as accident-only and Death due to natural catastrophe is printed for a natural catastrophe, so they do not fit that report and no amount is given for them.
Daniel's certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.
A dated certificate shows who it listed on that date; it does not by itself establish cover on a later date.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.
```

## Against the stated bar
* Useful dated Term Life information: yes -- S$1,000,000 as of 6 October 2022, with "not confirmation of cover on the date he died".
* No inapplicable PA amount: yes -- Personal Accident, Accidental Death and Compassionate Death Allowance are named only as accident-only, with no amount.
* Supported practical step: yes -- contact Aldermoor Life Ltd (the insurer of Daniel's own certificate) to ask what it needs for a claim.
* Honest date/cover uncertainty: partly. Cover on the date of death is stated as not confirmed. This run the model answered without asking, so the new deferral note (the household's words and message date) was NOT exercised live; it is covered offline (replay and browser DI3).
* Matching saved/displayed output: the saved record's visible text equals the answer above; the browser equality is shown by the offline replay of the same code path.
* Weaknesses seen: two near-duplicate Term Life certificate lines and one awkward Compassionate Death Allowance line; no wrong figure.

One observation, no rerun: the model chose to answer rather than ask this time (the earlier dj-live-3 attempt asked). Trace: ["search_passages: 10 hit(s), 10 new, 0 already returned this turn", "search_passages: 5 hit(s), 0 new, 5 already returned this turn", "final_answer: left out the terms of 1 benefit(s) whose definition does not fit what the household reported", "final_answer: stated how each accident-only death benefit's printed condition relates to the reported cause of death", "final_answer: kept the validated terms of Group Term Life for a statement about it that failed its check"].

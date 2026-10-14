# V1.3 stress-test structures: expected behaviour

Written from the rendered fixture pages (`scripts/fixtures/rag2-stress/household.ts`) before the fixes were made. It does not reuse the earlier percentage-of-sum-insured scenario as evidence for this structure. Everything in the fixture is invented: no source document, name, ID, policy number or amount from the 14 October stress test is used.

## What the pages say

| Document | Who | Role | What it prints |
|---|---|---|---|
| ROSTER: Arbor Civil Service Group Scheme certificate | Ivan, Lena | personal proof | Separate product headings, each with one row per person, "As of 01/04/2026". **Group Term Life:** Ivan S$400,000, Lena S$150,000. **Group Personal Accident:** Ivan S$200,000, Lena S$100,000. |
| GPA_WORD: Arbor Civil Service Group Personal Accident - Policy Wording | linked to Ivan and Lena | reference wording, not personal proof | See below. |
| LENA_TERM: Harbourline Life SecureLife Term Plan | Lena | personal | Basic sum assured S$250,000. |
| TRAVEL: Bluewave General Annual Travel Plan | nobody | unlinked | — |
| LOCKED: lena-hospital-plan.pdf | Lena | unreadable | Password protected. |
| PHOTO: IMG_2231.jpg | Ivan | unreadable | Photo too blurred to read. |
| ROSTER_OLD (2025) | — | superseded | Never a source, never listed. |
| OTHER | another household | — | Never visible. |

GPA_WORD prints:
- **4.1 Simple Fracture.** The benefit limit is S$5,000. The table's percentages are "% of Simple Fracture benefit limit"; Leg (tibia or fibula) is 50%.
- **4.2 Other Fracture.** For a compound fracture, or a bone not listed in 4.1, it pays 5% of the Sum Insured.
- **5.1 Daily Hospital Income.** S$150 per day, payable from the 11th day of continuous confinement, up to 180 days.
- **Section 3, Schedule of Compensation.** These percentages ARE "% of Sum Insured", for example loss of sight of one eye 50%.

## Expected answers

1. **Inventory ("What policies does my family have?").** Group the documents by person (Ivan, Lena, Noah), giving the insurer, product and role. Mark the policy wording as reference, not personal proof. Name the travel plan as linked to no one, and name both unreadable files with the reason. Noah has nothing on file. No amounts are needed, and none may be invented. The superseded certificate and the other household are never shown.
2. **Ivan's Personal Accident amount.** S$200,000 as of 1 April 2026, from the Group Personal Accident heading. It is never S$400,000, which is Term Life.
3. **Correction from Lena to Ivan.** First Lena's figures: S$250,000 under SecureLife and S$150,000 under Group Term Life. After "I meant Ivan", Ivan's Group Term Life: S$400,000.
4. **The user claims S$400,000 Personal Accident.** Correct it to S$200,000 Personal Accident, and say that S$400,000 is the Term Life figure.
5. **Simple tibia fracture.** A conditional illustration: if Simple Fracture applies, 50% × S$5,000 = **S$2,500**. It is never 50% × S$200,000 = S$100,000. Other Fracture (5% of the Sum Insured, S$10,000) must not replace it.
6. **Invalid date, then a valid correction.** "31 September" is refused and asked again. "30 September 2026 at 9am" is then recorded. Repeating the discharge time with a time zone is not a correction.
7. **Waiting period.** A 48-hour stay does not reach the 11th day, "if this provision applies". No amount is shown, and no S$0. This holds even when the model's rate quote is refused.
8. **Unknown member "Bob".** Say he is not in the household and offer Ivan, Lena and Noah. No amounts.

## Controls

- **The two structures cannot be mixed.**
  - The Simple Fracture percentage uses the S$5,000 limit even when the Sum Insured is passed.
  - The Sum Insured percentage (loss of sight, 50%) uses Ivan's S$200,000, giving S$100,000, never the limit. With no sum insured passed, it is not worked out.
- **Conflicting limits.** Two different Simple Fracture limits in the wording: the conflict is named and no amount is given. If no limit is printed, nothing is worked out.
- **Figures stay strict.** Each of these is not stated:
  - another product's figure;
  - another person's row;
  - another currency;
  - a superseded figure;
  - an unsupported figure.
  When a sentence's figure is unsupported, the supported document fact in that sentence is kept.
- **Waiting period.** A stay that can reach the 11th day is not refused because of it. An invalid date decides nothing.
- **Times.** The same time with a time zone added is the same fact. A different time is still a correction.

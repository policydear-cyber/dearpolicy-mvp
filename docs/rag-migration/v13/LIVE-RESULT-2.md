# V1.3 actual-model sample on the stress-test structures: second run (s48-live-2)

- **Code tested:** `5568ddc` (5568ddc23a9fbfd9e247077c24a1f9639b10768b), prompt `rag2-loop-v13`. Model `openai:gpt-6-luna` (provider reported `gpt-6-luna`), through the existing authorised relay.
- **Household:** the same anonymised stress fixture as s48-live-1. Six fixed turns. Run once; not rerun.
- **Verdict** (pre-registered grader `scripts/rag2-live/stress-check.ts`): **FAIL**, 5 of 26 checks failed (all labelled usefulness by the grader -- but see the safety finding below).
- **Cost:** US$0.006207 for 21 calls (0 refused, 0 failed). Run cap US$0.023, so both samples together stay within US$0.03 (US$0.006949 + US$0.006207 = US$0.013156). Ledger remaining after the run: US$0.120852. The US$0.15 reservation is untouched.
- **Time:** 53.3 s for the conversation; first useful answer 5.1 s.

## Finding: a wrong-product answer the grader classed as usefulness (turns 2 and 3)

The model labelled its sentence *Group Personal Accident* but stated the certificate's **Term Life** S$400,000 as "a sum assured". The
candidate's new figure-identity binding bound the figure to the Term Life row; the value-path product check did not read the sentence's
own benefit field, and “Group” in the sentence counted as naming “Group Term Life”. The save-time gate passed it. Turn 3 repeated the
sentence after the model asked resolve_person about “my personal accident cover”. This defect was introduced by `5568ddc` and is fixed
after this run (see the PR); the run is replayed without a model call in `npm run rag2:stress-test`.

## Failed checks

| turn | check | kind | result | stage | visible |
|---|---|---|---|---|---|
| 2 | Ivan's Personal Accident S$200,000 is stated | usefulness | **FAIL** | verification | Ivan’s Arbor Civil Service Group Scheme certificate lists a sum assured of S$400,000 as of 1 April 2026; the policy wording uses the Sum Insured as the basis for some personal-accident benefits, but the uploaded documents do not establish that this is the current amount in force. |
| 3 | the S$400,000 claim is corrected to S$200,000 | usefulness | **FAIL** | model reasoning-tool selection | I couldn’t identify “my personal accident cover” among the family members linked to your account. Which family member do you mean? If they aren’t added yet, you can add them on the Household page. |
| 4 | the Simple Fracture illustration S$2,500 (50% x S$5,000 limit) is shown, conditionally | usefulness | **FAIL** | calculation | You told me, “I fractured my leg, the tibia, when I fell down the stairs. It's a simple fracture and the X-ray confirmed it.” Ivan’s Arbor Group Personal Accident wording lists the Simple Fracture benefit limit as S$5,000 per insured person per accident and says a simple fracture confirmed by X-ray is payable at the percentage shown for the bone; its table lists 50% for a leg (tibia or fibula), bu |
| 4 | a saved lump_sum record of S$2,500 on the S$5,000 benefit limit | usefulness | **FAIL** | calculation | [] |
| 6 | Bob is not in the household and the members are offered | usefulness | **FAIL** | person-version resolution | I couldn’t identify “Bob” among the family members linked to your account. Which family member do you mean? If they aren’t added yet, you can add them on the Household page. |

## Calculations attempted

- turn 4: calculate lump_sum for “Simple Fracture” -- refused: proportion.evidence_id: that passage has no single line that prints one percentage for “a simple fracture”
- turn 4: calculate lump_sum for “Simple Fracture” -- refused: proportion.evidence_id: that passage has no single line that prints one percentage for “a simple fracture”
- turn 5: calculate hospital_cash for “Daily Hospital Income” -- ok

Turn 4's proportion cited a passage that ends at the table's first row (Skull 100%), so the leg row was not in it; the refusal was
correct, but the useful figure was withheld. Fixed after this run: a passage cut off inside a table is read with the rest of that
table on the same page, and a row is chosen by the calculation's own condition only when exactly one row fits best.

## Per turn

| turn | answer saved (s) | model time (s) | model calls | charged (US$) |
|---|---|---|---|---|
| 1 | 5.1 | 4.6 | 2 | 0.000294 |
| 2 | 9.4 | 8.9 | 4 | 0.000770 |
| 3 | 5.0 | 4.1 | 2 | 0.000902 |
| 4 | 15.7 | 15.5 | 6 | 0.001456 |
| 5 | 11.6 | 10.6 | 4 | 0.001708 |
| 6 | 5.7 | 4.6 | 3 | 0.001077 |

## Visible transcript (exactly as shown)

**USER:** What policies does my family have?

**APP:**

> Ivan: Arbor Civil Service Group Scheme - Certificate (Arbor Assurance, a personal policy document); Arbor Civil Service Group Personal Accident - Policy Wording (Arbor Assurance, reference wording for the scheme, not a personal policy document); IMG_2231.jpg could not be read (the photo is too blurred, dark or faint to read).
> Lena: Arbor Civil Service Group Scheme - Certificate (Arbor Assurance, a personal policy document); Arbor Civil Service Group Personal Accident - Policy Wording (Arbor Assurance, reference wording for the scheme, not a personal policy document); SecureLife Term Plan (Harbourline Life, a personal policy document); lena-hospital-plan.pdf could not be read (it is password protected and was uploaded without its password).
> Noah: no documents on file.
> Not linked to anyone in the household: Annual Travel Plan (Bluewave General) -- link it to a person so it can be used for them.

**USER:** How much is my personal accident cover?

**APP:**

> Ivan’s Arbor Civil Service Group Scheme certificate lists a sum assured of S$400,000 as of 1 April 2026; the policy wording uses the Sum Insured as the basis for some personal-accident benefits, but the uploaded documents do not establish that this is the current amount in force.

**USER:** My personal accident cover is S$400,000, right?

**APP:**

> I couldn’t identify “my personal accident cover” among the family members linked to your account. Which family member do you mean? If they aren’t added yet, you can add them on the Household page.

**USER:** I fractured my leg, the tibia, when I fell down the stairs. It's a simple fracture and the X-ray confirmed it. How much can I claim?

**APP:**

> You told me, “I fractured my leg, the tibia, when I fell down the stairs. It's a simple fracture and the X-ray confirmed it.”
> Ivan’s Arbor Group Personal Accident wording lists the Simple Fracture benefit limit as S$5,000 per insured person per accident and says a simple fracture confirmed by X-ray is payable at the percentage shown for the bone; its table lists 50% for a leg (tibia or fibula), but the uploaded documents do not establish that the certificate’s S$400,000 sum assured is the current amount in force.
> The wording defines a simple fracture as a closed fracture where the skin is not broken, and the documents do not state that the fall down the stairs meets the policy’s definition of an Accident.

**USER:** I was also in hospital for 48 hours: admitted 5 October 2026 at 10am, discharged 7 October 2026 at 10am. Does the Daily Hospital Income pay anything?

**APP:**

> Ivan’s Arbor Group Personal Accident wording lists Daily Hospital Income at S$150 for each day of inpatient confinement directly resulting from an Accident, payable from the 11th day of continuous confinement, up to 180 days per Accident.
> For the 48-hour stay you reported, the calculator finds no Daily Hospital Income benefit because the stay does not reach the 11th day of continuous confinement, if this provision applies to the stay.
> Arbor Civil Service Group Personal Accident - Policy Wording daily hospital income does not apply to these facts: the stay you reported (48 hours, from 5 October 2026 to 7 October 2026: at most 3 days even counting the days of admission and discharge) does not reach the 11th day of confinement that the benefit is payable from (“payable from the 11th day of continuous confinement”), if this provision applies to the stay.

**USER:** What cover does Bob have?

**APP:**

> I couldn’t identify “Bob” among the family members linked to your account. Which family member do you mean? If they aren’t added yet, you can add them on the Household page.

Full trace, citations, saved state and relay log: `docs/rag-migration/live/RUN-s48-live-2-2026-10-14T05-44-46/`.

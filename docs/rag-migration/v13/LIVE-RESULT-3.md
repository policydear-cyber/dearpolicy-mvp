# V1.3 actual-model sample on the stress-test structures: third run (s48-live-3, final candidate)

- **Code tested:** `fdc2dae` (fdc2daee4d62aad2c85c9d496b13cdeaff37570a), prompt `rag2-loop-v13`. Model `openai:gpt-6-luna` (provider reported `gpt-6-luna`), through the existing authorised relay; production build of the same tree.
- **Household:** the same anonymised stress fixture. Six fixed turns. Run once; not rerun.
- **Why a third run:** s48-live-2 found a wrong-product defect introduced by `5568ddc`; the code changed, so the changed code was sampled once. This is not a rerun of unchanged code.
- **Verdict** (pre-registered grader `scripts/rag2-live/stress-check.ts`): **FAIL**, 1 of 26 checks failed (usefulness: the unknown member's reply does not list the household's members). Every safety check passed.
- **Cost:** US$0.007577 for 22 calls (0 refused, 0 failed). Run cap US$0.016. All three samples: US$0.006949 + US$0.006207 + US$0.007577 = **US$0.020733**, within the task cap of US$0.03. Ledger remaining after the run: US$0.113275. The US$0.15 reservation is untouched.
- **Time:** 66.8 s for the conversation; first useful answer 6.5 s.

## Failed checks

| turn | check | kind | result | stage | visible |
|---|---|---|---|---|---|
| 6 | Bob is not in the household and the members are offered | usefulness | **FAIL** | person-version resolution | I couldn’t identify “Bob” among the family members linked to your account. Which family member do you mean? If they aren’t added yet, you can add them on the Household page. |

## Calculations

- turn 4: calculate lump_sum for “Simple Fracture” -- ok
- turn 5: calculate hospital_cash for “Daily Hospital Income” -- ok

Saved calculation record (turn 4): `lump_sum` = S$2,500 from operands `benefit_limit` S$5,000 (the Simple Fracture benefit limit, page 1) and `percent` 50 (the Leg (tibia or fibula) row); no `sum_insured` operand. Turn 5 saved no amount: the waiting-period conclusion is stated without a payment or a zero.

## Per turn

| turn | answer saved (s) | model time (s) | model calls | charged (US$) |
|---|---|---|---|---|
| 1 | 6.5 | 6.0 | 2 | 0.000991 |
| 2 | 13.4 | 12.2 | 5 | 0.000931 |
| 3 | 5.2 | 4.4 | 2 | 0.000880 |
| 4 | 16.1 | 15.4 | 5 | 0.001896 |
| 5 | 13.5 | 12.4 | 4 | 0.001697 |
| 6 | 11.0 | 9.9 | 4 | 0.001181 |

## Visible transcript (exactly as shown)

**USER:** What policies does my family have?

**APP:**

> Ivan: Arbor Civil Service Group Scheme - Certificate (Arbor Assurance, a personal policy document); Arbor Civil Service Group Personal Accident - Policy Wording (Arbor Assurance, reference wording for the scheme, not a personal policy document); IMG_2231.jpg could not be read (the photo is too blurred, dark or faint to read).
> Lena: Arbor Civil Service Group Scheme - Certificate (Arbor Assurance, a personal policy document); Arbor Civil Service Group Personal Accident - Policy Wording (Arbor Assurance, reference wording for the scheme, not a personal policy document); SecureLife Term Plan (Harbourline Life, a personal policy document); lena-hospital-plan.pdf could not be read (it is password protected and was uploaded without its password).
> Noah: no documents on file.
> Not linked to anyone in the household: Annual Travel Plan (Bluewave General) -- link it to a person so it can be used for them.

**USER:** How much is my personal accident cover?

**APP:**

> Ivan’s Arbor Civil Service Group Personal Accident sum assured is listed as S$200,000 as of 1 April 2026.

**USER:** My personal accident cover is S$400,000, right?

**APP:**

> No—Ivan’s Arbor Civil Service Group Personal Accident sum assured is listed as S$200,000 as of 1 April 2026.

**USER:** I fractured my leg, the tibia, when I fell down the stairs. It's a simple fracture and the X-ray confirmed it. How much can I claim?

**APP:**

> Ivan’s Arbor Civil Service Group Personal Accident wording lists a Simple Fracture benefit limit of S$5,000 per insured person per accident, and lists 50% of that limit for a leg (tibia or fibula) fracture (page 1).
> Based on what you told me, the calculator gives a conditional illustration of S$2,500 if the insurer’s medical assessment determines the fracture meets the policy’s definition of a simple fracture; this is not a confirmed claim amount, and only for an injury the insurer accepts as caused by an accident (the policy says “Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means”).

**USER:** I was also in hospital for 48 hours: admitted 5 October 2026 at 10am, discharged 7 October 2026 at 10am. Does the Daily Hospital Income pay anything?

**APP:**

> Ivan’s Daily Hospital Income is listed as S$150 for each day of inpatient confinement directly resulting from an Accident, payable from the 11th day of continuous confinement and up to 180 days per Accident (page 2).
> The calculator finds no benefit for the 48-hour stay you reported, because it does not reach the 11th day of continuous confinement.
> Arbor Civil Service Group Personal Accident - Policy Wording daily hospital income does not apply to these facts: the stay you reported (48 hours, from 5 October 2026 to 7 October 2026: at most 3 days even counting the days of admission and discharge) does not reach the 11th day of confinement that the benefit is payable from (“payable from the 11th day of continuous confinement”), if this provision applies to the stay.

**USER:** What cover does Bob have?

**APP:**

> I couldn’t identify “Bob” among the family members linked to your account. Which family member do you mean? If they aren’t added yet, you can add them on the Household page.

Full trace, citations, saved calculation records and relay log: `docs/rag-migration/live/RUN-s48-live-3-2026-10-14T06-37-26/`.

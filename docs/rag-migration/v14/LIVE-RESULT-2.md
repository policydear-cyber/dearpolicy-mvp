# V1.4 actual-model sample on the frozen candidate (s49-live-2)

- **Code tested:** `4e35f58` (4e35f58d95de7019b285ae7101b0212171440bd0), prompt `rag2-loop-v14`, production build of that tree. Model `openai:gpt-6-luna` (provider reported `gpt-6-luna`), through the existing authorised relay.
- **Conversations:**
  - **S49:** the reported question, then the date follow-up.
  - **S49B:** a paraphrase in its own conversation ("passed away", "traffic accident", "What insurance can we claim for him?").
- **Run once; not rerun.**
- **Grade** (binding grader version 2; version 2's pattern change has its own controls in `scripts/rag2-live/check-regressions.ts`): **FAIL**, 2 of 27 checks failed. Both failures are explained below.
- **Cost:** US$0.004377 for 13 calls (0 refused, 0 failed). The run cap was US$0.03.
- **Ledger:** US$0.102629 remains after the run. The US$0.15 reservation is untouched, and no budget was changed.
- **No malformed call** was refused in any turn, and **no turn reached a limit**. Peak use was 54,349 of 80,000 input tokens in one turn.

## Failed checks

| conversation | turn | check | kind | result | detail |
|---|---|---|---|---|---|
| S49 | 1 | exactly one question, about the accident date | usefulness | **FAIL** | ["When did Darren die (the date of death)?"] |
| S49B | 1 | no other person's amounts as Darren's (S$500,000 / S$300,000 / S$400,000 / S$150,000 / S$100,000) | correctness | **FAIL** | Darren’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; the Group Term Life wording says the Death Benefit is the Sum Assured shown in the certificate, but these documents do not confirm the amount or cover in force at the time of death. Darren’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, and the product summary describes Accidental Death as 100% of the Sum Insured if death results from an Accident within 365 days; it also states worldwid |

### Reading of the failures

- **S49 turn 1: "exactly one question, about the accident date".** The model asked one question, but about the **date of death** ("When did Darren die (the date of death)?"). That date is also needed for the cited "within 365 days of that Accident" condition. The question is relevant and grounded, but it is not the accident date the grader requires.
  - DearPolicy's own condition question is asked only when the reply asks nothing.
  - In turn 2, after the user gave the accident date, the model asked for the date of death again. That is the fact still missing, not a repeat of the accident-date question.
- **S49B: "no other person's amounts as Darren's": a grader false positive (new).** The answer gives **Darren's own** Group Living Care Plus amount, S$300,000, as of 6 October 2022. That figure happens to equal Michelle's certificate PA amount in the grader's list of other people's figures. The amount is Darren's, printed on his own row. The grade is kept as recorded; the grader was not changed after this run.

## Requirements as observed

| requirement | S49 t1 | S49 t2 | S49B |
|---|---|---|---|
| Term Life and PA given separately, each from its own document row with its date | yes | yes | yes |
| Correct person, product and document dates | yes | yes | yes |
| No combined payout | yes | yes | yes |
| One relevant question when needed | yes (date of death) | yes (date of death, still missing) | yes (accident date, asked by DearPolicy from the 365-day condition) |
| No redundant question after the date is given | n/a | yes (the accident date is not asked again) | n/a |
| No generic or incomplete answer from malformed calls or tokens | yes | yes | yes |

## Per turn

| conversation | turn | answer saved (s) | model time (s) | model calls | input / output tokens | charged (US$) | outcome |
|---|---|---|---|---|---|---|---|
| S49 | 1 | 13.0 | 12.3 | 5 | 45,197 / 549 | 0.001901 | ask_user |
| S49 | 2 | 6.4 | 5.2 | 2 | 15,537 / 369 | 0.001060 | ask_user |
| S49B | 1 | 18.9 | 17.7 | 6 | 54,349 / 736 | 0.001416 | ask_user |

## Visible transcript (exactly as shown)

**S49 USER:** Darren died in a car accident in Japan, what can I do?

**APP:**

> I’m very sorry for your loss. Darren’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; the Group Term Life wording says to notify Meridian Life Ltd of a death within 6 months, with the death certificate. Darren’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, and the summary says Accidental Death is 100% of the Sum Insured if death results from an Accident within 365 days; its territorial limit is worldwide, 24 hours a day.
> When did Darren die (the date of death)?

**S49 USER:** The accident happened on 3 October 2026.

**APP:**

> I’m very sorry for your loss. Darren’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; the Group Term Life wording says to notify Meridian Life Ltd of a death within 6 months, with the death certificate. Darren’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, and the summary says Accidental Death is 100% of the Sum Insured if death results from an Accident within 365 days; its territorial limit is worldwide, 24 hours a day.
> What was Darren’s date of death?

**S49B USER:** Darren passed away after a traffic accident while travelling in Japan. What insurance can we claim for him?

**APP:**

> Darren’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; the Group Term Life wording says the Death Benefit is the Sum Assured shown in the certificate, but these documents do not confirm the amount or cover in force at the time of death. Darren’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, and the product summary describes Accidental Death as 100% of the Sum Insured if death results from an Accident within 365 days; it also states worldwide cover, 24 hours a day, but the uploaded documents do not establish the current Sum Insured or whether the policy’s Accident definition is met here. The uploaded documents also list Group Living Care of S$350,000 and Group Living Care Plus of S$300,000 for Darren as of 6 October 2022, but they do not state that either is payable on death.
> On what date did the accident happen?

The full trace, citations, saved state and relay log are in `docs/rag-migration/live/RUN-s49-live-2-2026-10-14T09-18-57/`.

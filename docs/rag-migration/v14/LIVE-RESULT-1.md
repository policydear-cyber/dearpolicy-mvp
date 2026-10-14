# V1.4 actual-model sample: person / product / benefit binding (s49-live-1)

- **Code tested:** `c6c1dba` (c6c1dba22d7ff38242e719319b7e54e1ee18893d), prompt `rag2-loop-v14`, production build of that tree. Model `openai:gpt-6-luna` (provider reported `gpt-6-luna`), through the existing authorised relay.
- **Household:** the anonymised binding fixture (`scripts/fixtures/rag2-binding/household.ts`).
  - **S49** is the reported question, followed by the accident date.
  - **S49B** is a paraphrase, run as its own conversation.
- **Run once; not rerun.**
- **Verdict** (pre-registered grader `scripts/rag2-live/binding-check.ts`, committed before the run): **INCOMPLETE**. S49B stopped at the per-turn token limit, and 4 of 22 checks failed (see below).
- **Cost:** US$0.006269 for 16 calls (0 refused, 0 failed). The run cap was US$0.03.
- **Ledger:** US$0.107006 remains after the run. The US$0.15 reservation is untouched, and no budget was changed.

## Failed checks (as graded)

| conversation | turn | check | kind | result | detail |
|---|---|---|---|---|---|
| S49 | 1 | Term Life is never presented as Personal Accident (S$1,000,000 is not called the PA amount) | correctness | **FAIL** | I’m very sorry for your loss. Darren’s certificate lists Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000 as of 6 October 2022; these are dated amounts, not confirmation of cover on the date of death. The Group Term Life wording says the Death Benefit is the Sum Assured shown in the certificate, and says to notify Meridian Life Ltd of a death within 6 months with the death certificate. The Group Personal Accident summary says Accidental Death is 100% of the Sum Insured if  |
| S49B | 1 | Darren's Group Term Life S$1,000,000 is stated with its product | usefulness | **FAIL** | PUBLIC SERVICE GROUP INSURANCE SCHEME prints “Group Personal Accident” as S$600,000. I stopped before finishing because this question reached its model-use limit. I didn’t get as far as working out an amount for what you described, so I haven’t given one. |
| S49B | 1 | the accidental-death condition (within 365 days of the accident) is given | usefulness | **FAIL** | PUBLIC SERVICE GROUP INSURANCE SCHEME prints “Group Personal Accident” as S$600,000. I stopped before finishing because this question reached its model-use limit. I didn’t get as far as working out an amount for what you described, so I haven’t given one. |
| S49B | 1 | exactly one question, about the accident date | usefulness | **FAIL** | [] |

### Reading of the failures

- **S49 turn 1, "Term Life is never presented as Personal Accident": a grader false positive.** The answer says "Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000". Each figure has its own product. The grader's pattern ("S$1,000,000" followed within 30 characters by "personal accident") matched "S$1,000,000 and Group Personal Accident". The pre-registered grade is kept as recorded.
- **S49B: the turn ran out of its per-turn token limit before answering.** Two calls the model wrote with malformed arguments (an `"e2": [...]` key inside a statement) were refused by the tool schema. The model also made redundant lookups (`person_benefits`, `policies_for`, two searches and `select_table_value`), reaching about 68,000 of the 80,000 tokens. The visible answer is the limit fallback, with only the PA amount. **This is a real usefulness failure.** It was not fixed and not rerun.
- **S49 turn 1 was useful and correct:**
  - Term Life and PA are given separately, with their date;
  - the Death Benefit is described as the Sum Assured;
  - the 365-day accidental-death condition is given;
  - the model itself asked one question about the date.
- **S49 turn 2:**
  - It gave the documented amounts again and did not ask for the date again.
  - The sentence about the accidental-death condition was dropped by an existing absence check (a false positive on "do not establish whether ... cover was in force").
  - The new next-step rule dropped "ask what claim forms and supporting documents are required" as if it stated a requirement. **That was a false positive in `c6c1dba`.** It is fixed after this run (asking the insurer what is required counts as a suggestion), with a test.

## Per turn

| conversation | turn | answer saved (s) | model time (s) | model calls | charged (US$) | outcome |
|---|---|---|---|---|---|---|
| S49 | 1 | 17.8 | 16.9 | 5 | 0.002383 | ask_user |
| S49 | 2 | 12.1 | 10.9 | 5 | 0.001909 | final_answer |
| S49B | 1 | 18.0 | 16.8 | 6 | 0.001977 | limit_reached |

## Visible transcript (exactly as shown)


**S49 USER:** Darren died in a car accident in Japan, what can I do?

**APP:**

> I’m very sorry for your loss. Darren’s certificate lists Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000 as of 6 October 2022; these are dated amounts, not confirmation of cover on the date of death. The Group Term Life wording says the Death Benefit is the Sum Assured shown in the certificate, and says to notify Meridian Life Ltd of a death within 6 months with the death certificate. The Group Personal Accident summary says Accidental Death is 100% of the Sum Insured if death results from an Accident within 365 days, and its territorial limit is worldwide, 24 hours a day.
> When did Darren die (the date of the accident/death)?
>
> [question] When did Darren die (the date of the accident/death)?


**S49 USER:** The accident happened on 3 October 2026.

**APP:**

> You told me, “The accident happened on 3 October 2026.”
> Darren’s certificate lists Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000 as of 6 October 2022; those dated amounts do not confirm the cover or amount on the accident date.
> The Group Term Life wording says the Death Benefit is the Sum Assured shown in the Certificate of Group Insurance, and says to notify Meridian Life Ltd of a death within 6 months with the death certificate.
> What you’ve told me is your own account, not a reviewed medical record: the insurer will check it against the documents it asks for (such as the doctor’s report and the test or scan results) and decides the claim after reviewing them.


**S49B USER:** Darren passed away after a traffic accident while travelling in Japan. What insurance can we claim for him?

**APP:**

> PUBLIC SERVICE GROUP INSURANCE SCHEME prints “Group Personal Accident” as S$600,000.
> I stopped before finishing because this question reached its model-use limit. I didn’t get as far as working out an amount for what you described, so I haven’t given one.


The full trace, citations, saved state and relay log are in `docs/rag-migration/live/RUN-s49-live-1-2026-10-14T08-44-21/`.

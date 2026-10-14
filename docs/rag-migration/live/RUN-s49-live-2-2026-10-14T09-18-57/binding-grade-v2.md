# S49 actual-model grade (grader version 2): FAIL


| conversation | turn | check | kind | result | detail |
|---|---|---|---|---|---|
| S49 | 1 | the turn was not ended by a limit, and no answer call was refused as malformed | usefulness | pass |  |
| S49 | 2 | the turn was not ended by a limit, and no answer call was refused as malformed | usefulness | pass |  |
| S49 | 1 | no person's name used as a product or benefit | correctness | pass |  |
| S49 | 1 | the unrelated insurer (Lumen General) is not suggested | correctness | pass |  |
| S49 | 1 | no other person's amounts as Darren's (S$500,000 / S$300,000 / S$400,000 / S$150,000 / S$100,000) | correctness | pass |  |
| S49 | 1 | no superseded (S$800,000 / S$450,000) or other-household (S$2,000,000) amount | correctness | pass |  |
| S49 | 1 | no total of different benefits (S$1,600,000 or similar) and no promised payment / current-cover claim | correctness | pass |  |
| S49 | 1 | Term Life is never presented as Personal Accident (S$1,000,000 is not called the PA amount) | correctness | pass |  |
| S49 | 1 | Term Life S$1,000,000 and PA S$600,000 are each bound (saved) to their own product and to Darren | usefulness | pass |  |
| S49 | 1 | Darren's Group Term Life S$1,000,000 is stated with its product | usefulness | pass |  |
| S49 | 1 | Darren's Group Personal Accident S$600,000 is stated with its product | usefulness | pass |  |
| S49 | 1 | the accidental-death condition (within 365 days of the accident) is given | usefulness | pass |  |
| S49 | 1 | exactly one question, about the accident date | usefulness | **FAIL** | ["When did Darren die (the date of death)?"] |
| S49 | 2 | after the accident date is given, it is not asked for again | usefulness | pass |  |
| S49 | 2 | no promised payment, no unrelated insurer, no person's name as a product | correctness | pass |  |
| S49B | 1 | the turn was not ended by a limit, and no answer call was refused as malformed | usefulness | pass |  |
| S49B | 1 | no person's name used as a product or benefit | correctness | pass |  |
| S49B | 1 | the unrelated insurer (Lumen General) is not suggested | correctness | pass |  |
| S49B | 1 | no other person's amounts as Darren's (S$500,000 / S$300,000 / S$400,000 / S$150,000 / S$100,000) | correctness | **FAIL** | Darren’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; the Group Term Life wording says the Death Benefit is the Sum Assured shown in the certificate, but these documents do not confirm the amount or cover in force at the time of death. Darren’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, and the product summary describes Accidental Death as 100% of the Sum Insured if death results from an Accident within 365 days; it also states worldwid |
| S49B | 1 | no superseded (S$800,000 / S$450,000) or other-household (S$2,000,000) amount | correctness | pass |  |
| S49B | 1 | no total of different benefits (S$1,600,000 or similar) and no promised payment / current-cover claim | correctness | pass |  |
| S49B | 1 | Term Life is never presented as Personal Accident (S$1,000,000 is not called the PA amount) | correctness | pass |  |
| S49B | 1 | Term Life S$1,000,000 and PA S$600,000 are each bound (saved) to their own product and to Darren | usefulness | pass |  |
| S49B | 1 | Darren's Group Term Life S$1,000,000 is stated with its product | usefulness | pass |  |
| S49B | 1 | Darren's Group Personal Accident S$600,000 is stated with its product | usefulness | pass |  |
| S49B | 1 | the accidental-death condition (within 365 days of the accident) is given | usefulness | pass |  |
| S49B | 1 | exactly one question, about the accident date | usefulness | pass |  |

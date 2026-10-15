# s52 actual-model grade (livelib-check, pre-registered): FAIL


| conversation | turn | check | kind | result | detail |
|---|---|---|---|---|---|
| S52A | 1 | no model-use-limit dead end (the turn was not ended by a limit) | usefulness | pass |  |
| S52A | 1 | no unrelated Living Care / Living Care Plus figure | correctness | pass |  |
| S52A | 1 | no 365-day condition borrowed from Permanent Dismemberment for death | correctness | pass |  |
| S52A | 1 | no promised payment or approval | correctness | pass |  |
| S52A | 2 | no model-use-limit dead end (the turn was not ended by a limit) | usefulness | pass |  |
| S52A | 2 | no unrelated Living Care / Living Care Plus figure | correctness | pass |  |
| S52A | 2 | no 365-day condition borrowed from Permanent Dismemberment for death | correctness | pass |  |
| S52A | 2 | no promised payment or approval | correctness | pass |  |
| S52B | 1 | no model-use-limit dead end (the turn was not ended by a limit) | usefulness | pass |  |
| S52B | 1 | no unrelated Living Care / Living Care Plus figure | correctness | pass |  |
| S52B | 1 | no 365-day condition borrowed from Permanent Dismemberment for death | correctness | pass |  |
| S52B | 1 | no promised payment or approval | correctness | pass |  |
| S52B | 2 | no model-use-limit dead end (the turn was not ended by a limit) | usefulness | pass |  |
| S52B | 2 | no unrelated Living Care / Living Care Plus figure | correctness | pass |  |
| S52B | 2 | no 365-day condition borrowed from Permanent Dismemberment for death | correctness | pass |  |
| S52B | 2 | no promised payment or approval | correctness | pass |  |
| S52C | 1 | no model-use-limit dead end (the turn was not ended by a limit) | usefulness | pass |  |
| S52C | 1 | no unrelated Living Care / Living Care Plus figure | correctness | pass |  |
| S52C | 1 | no 365-day condition borrowed from Permanent Dismemberment for death | correctness | pass |  |
| S52C | 1 | no promised payment or approval | correctness | pass |  |
| S52D | 1 | no model-use-limit dead end (the turn was not ended by a limit) | usefulness | pass |  |
| S52D | 1 | no unrelated Living Care / Living Care Plus figure | correctness | pass |  |
| S52D | 1 | no 365-day condition borrowed from Permanent Dismemberment for death | correctness | pass |  |
| S52D | 1 | no promised payment or approval | correctness | pass |  |
| S52A | 1 | Term Life S$1,000,000 and PA S$600,000, each with its product, and the certificate date | usefulness | pass |  |
| S52A | 1 | both amounts saved bound to Adrian's own certificate row and product | correctness | pass |  |
| S52A | 1 | a useful death explanation: the Death Benefit or Accidental Death wording | usefulness | pass |  |
| S52A | 1 | at most one question, and a relevant next question or practical next step (not a dead end) | usefulness | pass |  |
| S52A | 1 | no other household's amount (S$2,000,000) | correctness | pass |  |
| S52A | 2 | both supplied dates are used (3 and 5 October 2026) | usefulness | pass |  |
| S52A | 2 | neither date is asked for again | usefulness | pass |  |
| S52A | 2 | the benefits are explained: Term Life and Personal Accident (Accidental Death) both named | usefulness | pass |  |
| S52A | 2 | next steps are given | usefulness | pass |  |
| S52B | 1 | Adrian's Term Life S$1,000,000 and PA S$600,000 separately, with the certificate date | usefulness | pass |  |
| S52B | 1 | both bound to Adrian | correctness | pass |  |
| S52B | 2 | switches to Cheryl and states her PA S$600,000 (bound to Cheryl) | usefulness | pass |  |
| S52B | 2 | does not confirm the wrong premise (PA S$1,000,000) | correctness | pass |  |
| S52B | 2 | no Adrian-only figure stated as Cheryl's | correctness | pass |  |
| S52C | 1 | the unreadable upload is included (IMG_0042.jpg, could not be read) | usefulness | pass |  |
| S52C | 1 | every readable upload is listed | usefulness | pass |  |
| S52D | 1 | conditional S$2,500 from 50% of the S$5,000 Simple Fracture Benefit Limit | usefulness | **FAIL** | For Adrian, the Simple Fracture section lists a S$5,000 benefit limit and 50% for a leg, ankle, knee, jaw or pelvis fracture—so the printed calculation is 50% of that limit for a leg fracture, provided it is a Simple Fracture caused by an Accident. The wording defines a Simple Fracture as a closed fracture where the skin is not broken, and defines Other Fracture as a fracture that is not a Simple Fracture, including a compound (open) fracture. For comparison, the Other Fracture table lists 50% of the Sum Insured for a leg, ankle, knee, jaw or pelvis fracture, rather than 50% of the Simple Frac |
| S52D | 1 | the S$2,500 is a saved, re-runnable calculation record (not model arithmetic) | correctness | **FAIL** | [] |
| S52D | 1 | Other Fracture is distinguished (a percentage of the Sum Insured) | usefulness | pass |  |
| S52D | 1 | no other base used (no S$300,000 / S$600,000-based fracture amount) | correctness | pass |  |

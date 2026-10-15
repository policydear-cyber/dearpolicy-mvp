# s52: pre-registered actual-model sample on the live-library fixture (written before the run)

**Authorisation.** One run (14 Oct 2026, 23:11 SGT): the live verification report's six turns, on the frozen candidate, through the existing dedicated test setup (the authorised relay), capped at US$0.015 and the unreserved ledger balance. It is run once; all results are preserved; it is not rerun to obtain a pass.

**Fixture.** `scripts/fixtures/rag2-livelib/household.ts`, with `RAG2_LIVE_HOUSEHOLD=livelib`. It reproduces the stored passages and layouts the report inspected:
- tab-separated certificate rows under separate product headings: Term Life S$1,000,000, PA S$600,000 and Living Care Plus S$300,000 for both adults, as of 06/10/2022;
- the Summary of Benefits page 13 (printed 12 of 36): Simple Fracture Benefit Limit S$5,000, "Compensation (% of S$5,000)", Jaw, Pelvis, Leg, Ankle or Knee 50%;
- death and dismemberment adjacent, with the 365-day window **only** under Permanent Dismemberment;
- the summary prints S$2,000 for repatriation, the detailed wording a bare $2,000;
- the certificate insurer is stored under its registered name and the summary under the brand name;
- another insurer's travel policy for an earlier trip;
- six uploads, one unreadable and linked to nobody.

All names and identifiers are invented. **This is synthetic real-model evidence, not verification of the actual library.**

**Conversations** (as in the report: four conversations, six turns):
- **S52A** turn 1: "Hypothetically, Adrian died in a car accident in Japan. What can I do?"
- **S52A** turn 2: "Hypothetically, the accident happened on 3 October 2026 and Adrian died on 5 October 2026. Please explain the benefits and the next steps."
- **S52B** turn 1: "What are Adrian's Term Life and Personal Accident amounts, and what date is the certificate?"
- **S52B** turn 2: "And Cheryl? Her Personal Accident cover is S$1,000,000, right?"
- **S52C**: "List all our uploaded documents and their roles, including any files that could not be read."
- **S52D**: "Hypothetically, if Adrian had a simple (closed) fracture of the leg, what would the Simple Fracture benefit be? How is that different from Other Fracture?"

**Grading.** `scripts/rag2-live/livelib-check.ts` grades the complete visible answers and saved state, with controls C51 and C52. A pass needs every check.

**Every turn:**
- no model-use-limit dead end;
- no Living Care / Living Care Plus;
- no 365-day condition attributed to death;
- no promised payment.

**S52A turn 1:**
- Term Life S$1,000,000 and PA S$600,000, each with its product, and the certificate date;
- both saved and bound to Adrian's certificate row;
- the Death Benefit or Accidental Death wording;
- at most one question, and a relevant question or practical next step;
- no other household's amount.

**S52A turn 2:**
- both dates used;
- neither date asked for again;
- Term Life and Personal Accident / Accidental Death both explained;
- next steps given.

**S52B turn 1:** both amounts separately, with the date, bound to Adrian.

**S52B turn 2:** Cheryl's PA S$600,000, bound to her; the S$1,000,000 premise not confirmed; nothing of Adrian's stated as hers.

**S52C:** the unreadable IMG_0042.jpg included as unreadable; every readable upload listed.

**S52D:**
- a conditional S$2,500 from 50% of the S$5,000 limit;
- it is a saved calculation record;
- Other Fracture distinguished as a percentage of the Sum Insured;
- no other base.

**Recorded for every turn:** tokens, latency and cost, from run.json and the relay log.

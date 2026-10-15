# s52d-live-2: pre-registered actual-model run of ONE conversation (written before the run)

**Authorisation.** One conversation was authorised on 15 Oct 2026, 12:39 SGT: the live verification report's turn 6 (S52D).
- It runs on the frozen candidate, through the existing dedicated test setup (the authorised relay and the test key
  held behind it).
- It is capped at **US$0.006** and at the unreserved ledger balance (US$0.085894). The US$0.15 `trial-codespace-1`
  reservation is not touched.
- It runs once. The result is preserved whatever it is, and it is not rerun.

**Setup.**
- Fixture: `scripts/fixtures/rag2-livelib/household.ts`, the same live-library household as s52-live-1, with
  `RAG2_LIVE_HOUSEHOLD=livelib`.
- Command: `scripts/rag2-live/run.ts --live --run-id s52d-live-2 --scenarios S52D`.
- Model: `openai:gpt-6-luna`, with the same request settings as s52-live-1.

**The question:** "Hypothetically, if Adrian had a simple (closed) fracture of the leg, what would the Simple Fracture
benefit be? How is that different from Other Fracture?"

**Grading.** `scripts/rag2-live/s52d-check.ts`, written before the run and not changed after.
- It grades the complete visible answer as the chat page shows it (summary, details, questions, every next step) and
  the saved state.
- It is deterministic; there is no AI judge.
- PASS needs all six requirements.

| id | requirement |
|---|---|
| R1 | A conditional S$2,500 from 50% × S$5,000 is visible. Every sentence stating it is conditional or an illustration, not a payment. |
| R2 | A saved calculation with source-bound operands: 50% from the "Jaw, Pelvis, Leg, Ankle or Knee" row and S$5,000 from "Simple Fracture Benefit Limit: S$5,000", both on Summary of Benefits page 13. The result is S$2,500 and it re-computes. |
| R3 | Simple Fracture and Other Fracture are kept separate. The S$2,500 is not given as Other Fracture's, and no Simple Fracture amount is stated on the Sum Insured. |
| R4 | No unsupported Other Fracture amount. Any Other Fracture amount must be a saved calculation on the policy wording's Other Fracture row and the certificate's S$600,000 sum insured. |
| R5 | No false statement that the certificate lacks the Group Personal Accident sum insured. |
| R6 | No token-limit fallback, and no unrelated benefit or figure (Living Care, Term Life, repatriation, hospital cash, travel). |

**Grader controls.**
- The s52-live-1 S52D record fails R1, R2 and R5, as it should.
- The scripted positive control (`PART=livelib`, MULTILINE) passes all six.

**Report.** The exact tested SHA, the complete visible answer, the calculation, latency, tokens and cost.

**Evidence class.** This is synthetic real-model evidence, not verification of the actual library.

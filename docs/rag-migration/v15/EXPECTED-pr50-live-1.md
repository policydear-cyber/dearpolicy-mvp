# pr50-live-1: pre-registered actual-model run of the three prompts that failed after PR #50 (written before the run)

**Authorisation.** One run was authorised on 15 Oct 2026 at 14:48 SGT. It covers the three affected prompts (fracture, inventory and death next steps).
- It uses the existing dedicated setup: the loopback relay and the test key held behind it.
- It is capped at **US$0.006** and at the unreserved ledger balance (US$0.084104). The US$0.15 `trial-codespace-1` reservation is not touched.
- It runs once. Failures are preserved, and there is no rerun.

**Setup.**
- Fixture: `scripts/fixtures/rag2-pr50/household.ts`, the anonymised PR #50 household.
  - Page 13 is stored as the report gives it, with tabs and the wrapped "(% of S$5,000)" header.
  - It has six eligible uploads: one personal certificate, two reference documents, two documents from the other (travel) insurer linked to nobody, and one failed upload. It also has one deleted upload and one other-household upload.
  - File names are the snake_case variant (`PR50_NAMES=snake`).
- Environment: `RAG2_LIVE_HOUSEHOLD=pr50`.
- Command: `scripts/rag2-live/run.ts --live --run-id pr50-live-1`.
- Model: `openai:gpt-6-luna`, with the request settings of s52d-live-2.

The three conversations run as single turns, in this order:

| id | prompt |
|---|---|
| P50C | "What policies does my family have? List my uploaded documents by person, insurer and product. Distinguish personal certificates from reference wording and unreadable files." |
| P50D | "Hypothetical document-arithmetic test for Adrian: in the uploaded Summary of Benefits, Simple Fracture has a S$5,000 limit and a Leg row of 50%. If that provision applies, what is the illustration? Distinguish this from the separate Other Fracture provision and do not promise a payment." |
| P50A | "Hypothetical test: Adrian died in a car accident in Japan. The accident happened on 3 October 2026 and he died on 5 October 2026. Based on my uploaded documents, explain which death benefits may apply and what I should do next." |

P50A puts both of the report's death turns into one message, to stay within the cap.

## Expected complete visible answers

These describe content, not exact wording, because the model's phrasing is free.

**P50C**
- Adrian and Cheryl each have:
  - Public Officers Group Insurance Scheme - Certificate (Kestrel Life Ltd), a personal certificate;
  - Public Officers Group Personal Accident - Summary of Benefits (KestrelOne), reference wording;
  - Public Officers Group Personal Accident - Policy Wording (Kestrel Life Ltd), reference wording.
- Ethan has no documents.
- Linked to nobody:
  - Travel Insurance - Policy Wording, or `travel_policy_wording_2024.pdf`;
  - Travel Insurance - Benefit Summary, or `travel_benefit_summary.pdf`;
  - both from Harbourline General Insurance Pte. Ltd., and not presented as personal cover.
- `scan_20241003_153045.jpg` could not be read. The name is shown exactly, with its case.
- The deleted upload and the other household's upload are absent.

**P50D**
- A conditional illustration: if Simple Fracture applies to a leg fracture, it is S$2,500, which is 50% of the S$5,000 Simple Fracture Benefit Limit. This is not a promise of payment.
- Other Fracture is separate, as a percentage of the Sum Insured.
- There is no "Death due to Accident", no Compassionate Death Allowance, and no Term Life.
- It is backed by a saved calculation with source-bound operands from Summary of Benefits page 13.

**P50A**
- Which death benefits may apply, for example Accidental Death (100% of the PA Sum Insured) and the Compassionate Death Allowance subject to enrolment. Any amount shown is one the documents print.
- An uncertainty about enrolment or the event-date status may be stated as uncertainty, never as an exclusion.
- A supported next step: contact or notify Kestrel Life Ltd, or the scheme administrator or employer.
- No instruction to contact or claim from Harbourline, and its wording is not presented as Adrian's cover.

## Grading

The grader is `scripts/rag2-live/pr50-check.ts`. It was written before the run and is not changed after. It is deterministic, with no AI judge. It grades the complete visible answer (summary, details, questions and every next step) and the saved state.

PASS needs every check in all three scenarios.

| id | requirement |
|---|---|
| C1 | All six eligible uploads are displayed by identity: product name, or exact file name. |
| C2 | Each one is in the saved record, as a citation of its document id or as its library name. |
| C3 | The failed upload is stated as unreadable. |
| C4 | The deleted and other-household uploads are absent, by name and by id. |
| C5 | Travel documents are not presented as personal cover. |
| C6 | No limit fallback. |
| D1 | A conditional S$2,500 is visible. |
| D2 | A saved calculation: 50% from the leg row and S$5,000 from the limit line, both on page 13. The result is S$2,500 and it re-computes. There is no Term Life operand. |
| D3 | No unrelated benefit label or figure. |
| D4 | No fallback, and no "left out an amount" in place of the illustration. |
| A1 | Supported contact advice: the person's own insurer or the scheme administrator. |
| A2 | No unrelated-insurer instruction or cover claim. |
| A3 | Only amounts the documents print. |
| A4 | No unsupported exclusion. |
| A5 | No limit fallback. |

**Grader controls.** Both were run before the live run.
- The scripted replay on the candidate passes every check.
- The same scripted turns on the base `3ded1d9` fail C1, C3, D1–D4 and A1.

**Report.** The exact tested SHA, the transcripts, the calculation and source bindings, the cost, and latency (model time and time to the visible answer, separately).

**Evidence class.** This is synthetic real-model evidence on an anonymised household, not verification of the actual library.

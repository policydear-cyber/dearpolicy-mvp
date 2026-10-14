# s50-live-2: one real-model conversation on the cell-per-line certificate (14 Oct 2026)

- **Code tested:** `a13c755bd9ffedcf5f1b96a3fb65308f7050b514`.
  - The provenance guard confirmed before the run that the working tree was exactly this commit: tree manifest, 866 source files by git blob hash, and a build newer than the source.
  - `run.json`, `report.md` and the ledger all record this SHA.
- **Model:** `openai:gpt-6-luna`, through the existing authorised relay.
- **Household:** `RAG2_LIVE_HOUSEHOLD=binding-cells`, the synthetic household with its certificate one cell per line.
- **Cost:** US$0.004238 for 12 calls (0 refused, 0 failed). Cap US$0.01. The ledger has **US$0.094299** remaining, the reservation is untouched, and no budget was changed.
- **Run once; not rerun.** The expectations (`EXPECTED.md`, "s50-live-2") and grader version 4 were written and pushed in `a13c755` before the run.
- **Grade (v4): FAIL, 2 of 26 checks failed.** Both failures come from one cause in turn 2, explained below.

## Visible transcript (verbatim)

**USER:** Darren died in a car accident in Japan, what can I do?

**APP:** I'm so sorry for your loss, Michelle; Darren's uploaded certificate lists Group Term Life of S$1,000,000 as of 6 October 2022, and the linked wording says the Death Benefit is the Sum Assured shown in the Certificate of Group Insurance. The same certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, while the linked summary says Accidental Death is 100% of the Sum Insured if death results from an Accident within 365 days; it also says territorial limits are worldwide, 24 hours a day. The uploaded documents do not establish the amount applicable on the date of death: an endorsement effective 1 January 2024 is linked to the policy, and the certificate figures above are dated 6 October 2022. The Term Life summary says to notify Meridian Life Ltd of a death within 6 months, with the death certificate. The uploaded documents do not state the Personal Accident claim-notification process or the documents required for that claim.
On what date did the accident happen?
This changes what your policy pays under: Public Service Group Personal Accident - Product Summary pays its Accidental Death only if the Insured Person dies as a result of an Accident within 365 days of that Accident

*Saved bindings:* S$1,000,000 Group Term Life and S$600,000 Group Personal Accident, both `person_row` bindings to "Tan Kai Ming, Darren" in the rebuilt cell-per-line roster. The save-time check found no problems.

**USER:** The accident happened on 3 October 2026 and he died on 5 October 2026.

**APP:** You told me the accident happened on 3 October 2026 and Darren died on 5 October 2026.
The linked Personal Accident summary says Accidental Death is 100% of the Sum Insured if death results from an Accident within 365 days, and that territorial limits are worldwide, 24 hours a day; the dates you gave fall within that stated period, but the documents do not confirm whether the event meets the policy definition of Accident.
The Term Life summary says the Death Benefit is the Sum Assured shown in the Certificate of Group Insurance and says to notify Meridian Life Ltd of a death within 6 months, with the death certificate.
The certificate lists Darren's Group Personal Accident sum insured as S$600,000 as of 6 October 2022, but the uploaded documents do not establish the amount applicable on the accident date; an endorsement effective 1 January 2024 is linked to the policy.
What you've told me is your own account, not a reviewed medical record: the insurer will check it against the documents it asks for (such as the doctor's report and the test or scan results) and decides the claim after reviewing them.
Notify Meridian Life Ltd about the Term Life death claim and provide the death certificate; ask the insurer what additional documents it needs for both claims.

*Saved bindings:* S$600,000 Group Personal Accident bound to Darren's row. No question was asked.

## Requirements

| requirement | turn 1 | turn 2 |
|---|---|---|
| Darren's TL and PA amounts, separately sourced | **pass:** both stated and saved as separate bindings to his row | PA restated and bound; TL was given in turn 1 and not restated |
| no inventory replacing the answer | **pass** | **pass** |
| no unrelated insurer recommendation | **pass** | **pass** |
| relevant death conditions and question | **pass:** the 365-day condition and Term Life notification; one question, the accident date | **pass:** the dates "fall within that stated period", which is correct for 2 days apart and leaves the Accident definition to the insurer |
| no injury-specific boilerplate | **pass** | **FAIL:** "not a reviewed medical record … (such as the doctor's report and the test or scan results)" |
| no invented document requirements | **pass** | **FAIL:** the same sentence. The model's own next step is fine: the death certificate is documented, and it asks the insurer for anything else. |
| no repeated date question after both dates | n/a | **pass** |

## Cause of the turn-2 failure (traced, reproduced, fixed after the run; not rerun)

The sentence is not the model's. It is DearPolicy's own note, added when the household answers the question it was asked (`forward` in `lib/rag2/loop/loop.ts`).

`reportedFactFollowUp` chose the medical version of that note by scanning **every passage the answer cited**, rather than the condition the answered question was about. Two things then pushed it to the medical version:
- The Term Life summary passage also prints "on diagnosis of a Terminal Illness".
- The medical pattern's `certif\w*` matched "death certificate" and "Certificate of Group Insurance".

**Fix in the final candidate:**
- The note is chosen from the answered condition only: the question's "why" and the lines of its own evidence that state that condition.
- The medical pattern now matches "certified", "certification" and "medical certificate", and no longer matches "death certificate" or "Certificate of Insurance".
- Fracture, X-ray and specialist conditions still get the medical note.

**Regression:** `REPORTED NOTE` in `rag2:binding-test`. With the old classification restored, it fails (42/43). With the fix, it passes (43/43).

## Not graded but observed

- **"I'm so sorry for your loss, Michelle".** The model assumed who is writing. Darren is the account's "self" member in the fixture, and the user's identity is not established.
- **"an endorsement effective 1 January 2024 is linked to the policy".** Here it is presented as a reason Darren's amount is uncertain. That endorsement is linked only to Michelle and amends only Michelle's PA amount. Darren's benefit view has no amendment or conflict, so this is the model's over-caution from the shared policy number. It is an uncertainty statement, not a wrong figure, but it is misleading.

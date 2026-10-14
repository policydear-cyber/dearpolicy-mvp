# V1.4 actual-model conversation on the one-cell-per-line certificate (s50-live-1)

- **Code tested:** `402399a` (402399a0233518123ed1e44edbb2cec8378ed925), prompt `rag2-loop-v14`, production build of that tree.
  - The ledger entry records this SHA.
  - The run's own `run.json` and `report.md` say `4e35f58`. That is wrong: the sandbox's `RAG2_LIVE_TESTED_SHA` had not been updated since s49-live-2.
  - The run cannot have been on `4e35f58`, because S50 and the `binding-cells` household do not exist in that tree.
  - The saved files are kept unchanged, as recorded.
- **Model:** `openai:gpt-6-luna` (provider reported `gpt-6-luna`), through the existing authorised relay.
- **Household:** `RAG2_LIVE_HOUSEHOLD=binding-cells`. This is the synthetic binding household with the certificate's text layer one cell per line (`certLayout("cells")`).
- **Conversation (S50), two turns:**
  1. "Darren died in a car accident in Japan, what can I do?"
  2. "The accident happened on 3 October 2026 and he died on 5 October 2026."
- **Run once; not rerun.**
- **Cost:** US$0.004092 for 11 calls (0 refused, 0 failed). The run cap was US$0.03. The ledger has **US$0.098537** remaining; the reservation is untouched and no budget was changed.
- **Grade** (binding grader version 3, written before the run): **FAIL**, 2 of 20 checks failed.

## Failed checks

| turn | check | kind | reading |
|---|---|---|---|
| 1 | Darren's TL S$1,000,000 and PA S$600,000 bound to their products and to Darren | usefulness | **Real defect, now fixed (not re-run live).** See the root cause below. |
| 1 | the unrelated insurer (Lumen General) is not suggested | correctness | The answer did not suggest Lumen General; it listed it under "Not linked to anyone in the household". This is a consequence of the same defect. The pre-registered check counts any mention, so the FAIL stands. |

## Root cause of turn 1 (traced, reproduced with scripted moves, fixed)

1. The model called `person_benefits` and received Darren's amounts **reconstructed from the one-cell-per-line certificate**.
2. It wrote a correct sentence citing both values: "Darren's certificate lists Group Term Life sum assured of S$1,000,000 and Group Personal Accident sum assured of S$600,000, each as of 6 October 2022; …"
3. It had also called `household_documents`. The V1.3 inventory rule (`withInventory` in `lib/rag2/loop/loop.ts`) runs on **any** turn that called that tool.
   - The answer did not name every document, so the rule replaced it with the inventory.
   - It removed every sentence containing a figure and every figure binding.
   - `trace.dropped` stayed empty, so the loss was silent.
4. Then the date question was added as designed.

**Reproduction.** The same scripted moves (household_documents → person_benefits → final_answer with the two-figure sentence) lost the amounts on **both** the row and the cell layouts. The defect does not depend on layout.

**Fix.** Only an inventory question ("what policies does my family have?", `INVENTORY_QUESTION`) is answered as an inventory. A turn that looks the documents up while answering something else keeps its verified, bound answer.

**Regression.** `INVENTORY` in `npm run rag2:binding-test`:
- on both layouts, the amounts and both bindings are kept;
- no Lumen General;
- one date question;
- inventory and non-inventory questions classified correctly.

The inventory conversations (stress C1, browser R1) still pass.

## Turn 2 (cell-per-line layout, live)

- **Amounts.** "Darren's certificate lists Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000, each as of 6 October 2022; these are dated amounts, not confirmation of cover on the event date."
  - Both are saved as `person_row` bindings to Darren's name cell in the reconstructed roster.
  - The save-time gate was clean.
  - **This is the actual-model evidence that the reconstruction works end to end.**
- **Questions.** Neither date was asked again. The 365-day condition was stated, not concluded, which is correct under grader v3. No payment was promised and no unrelated insurer was named.
- **Observed but not graded** (not in the pre-registered checks), recorded as remaining defects:
  - The PA calculator's generic missing-fact text says that whether the death "meets the policy's definition must be confirmed through the insurer's medical assessment" and mentions "a specialist's diagnosis report". This wording was written for injury and illness benefits and does not fit a death.
  - A next step says "provide the death certificate and relevant medical records". The death certificate is documented; "medical records" is not. It is phrased as a suggestion rather than a requirement, so the requirement filter does not catch it.

## Grader version 3 on the earlier runs (recorded separately; earlier grade files unchanged)

- **s49-live-1** (`c6c1dba`): INCOMPLETE, 7 of 31 failed. The limit stop and malformed calls fail as before. The S49 turn 1 question "the date of the accident/death" is ambiguous, so it fails.
- **s49-live-2** (`4e35f58`): PASS, 0 of 31 failed. Version 2's two failures were the date-of-death question and the S$300,000 false positive. Both are corrected generally by version 3.
  - This regrade is post hoc: version 3 was written after seeing s49-live-2.
  - The version-2 FAIL remains the pre-registered result.

Correction: the run's own `run.json` / `report.md` SHA is corrected in `RUN-s50-live-1-2026-10-14T09-49-27/PROVENANCE-CORRECTION.md` (originals unchanged).

# Structured-answers release: acceptance expectations

Written against the journeys script `scripts/reliable-chat-structured-answers.ts` BEFORE any product change; it was run on
the unchanged baseline (main `86c5940`, 13 of 35 checks failing; transcript in `transcripts/structured-answers-BASELINE-86c5940.txt`).

## Limitation
The report `DearPolicy-live-verification-PR54-2026-10-17.md` was **not available** to this work (not in Drive search, not
in uploads). The concrete findings in the release request are used instead. Nothing here was read from the actual library:
the fixture (`scripts/fixtures/reliable-chat/actual-lib.ts`) reproduces the repo's stored page text of the two real
fracture documents (insurer, address and web path anonymised consistently), the recorded booklet passage and a certificate
layout. INFERRED: the Group Personal Accident sum insured (S$600,000, implied by the reported S$300,000 for a 50% row),
dates and document metadata. INVENTED controls: another household, a superseded earlier product summary, Grace's row.

## Journeys (each: returned = saved = reopened)
1. Closed tibia -> conditional S$2,500 (Leg row 50% of the S$5,000 limit), complete, with the second document's table said separately and its relationship unestablished.
2. Correction to hip -> the tibia illustration is not current; "If the Simple Fracture benefit applies to Daniel's case “Hip” ... S$3,750 ..." is one complete conditional statement, saved with its calculation record, displayed whole; the household's message is not quoted.
3. Uncertain hip/tibia -> one question naming both cases, supported terms first, no unrelated row cited -> clarification -> illustration for the current case, earlier uncertain report not its assumption, no repeated question.
4. Simple vs Other comparison -> separate bases (S$5,000 limit; Daniel's S$600,000 sum insured), no total, relationship unestablished, no imported definition.
5. Death allowance -> retained, complete printed conditions, bare "$" currency unstated, contact step to the person's own insurer.
6. Person switch -> Grace's own illustration, her own certificate row (S$100,000, 1 July 2024), never Daniel's.
7. Reopen -> same calculation records and citations.
Negative controls: another household / superseded version (S$7,000, S$4,000, S$900,000 never used), neighbouring section (Disappearance, Ambulance, Mobility), currency (bare $500/$10,000 never S$).

Failure definitions: a safe but needlessly empty answer, a correct number in a contradictory answer, and a saved answer differing from the displayed one are each failures.

## Real-model batch (pre-registered; written before any model call)
Household `RAG2_LIVE_HOUSEHOLD=actuallib` (the faithful fixture above), grader **v8** (`scripts/rag2-live/structured-check.ts`; its controls
run offline in `scripts/reliable-chat-structured-answers.ts`: the scripted journeys pass, the baseline's refusal, an unfinished quotation,
a stale S$2,500, a total of alternatives and Daniel's amount in Grace's answer each fail on the intended check). Scenarios, each run **once**,
no rerun of an unchanged failure:
- correction journey, two independent attempts (SAa, SAb) + one fresh paraphrase (SAp)
- ambiguity journey, two independent attempts (SBa, SBb) + one fresh paraphrase (SBp)
- SC Simple versus Other comparison, SD death allowance (fresh wording), SE person switch.
Frozen before the run: code SHA, prompt (`LOOP_PROMPT_VERSION`), tool schemas, model configuration, fixtures, expectations. A failed check is traced
to the earliest broken boundary, reproduced offline, fixed, and a new candidate frozen; expectations are not changed to accept an output.

### Budget
Cumulative cap US$1.00 including all earlier spending. Reconciled from the committed documents (the in-repo `LEDGER.json` stops at rc-live-1;
later runs are recorded in the EXPECTED/LIVE-RESULT documents): available to automated runs before rc-live-9 US$0.489558 (EXPECTED-rc-live-9.md),
rc-live-9 spent US$0.003323 -> **spent over all runs US$0.363765; the separate US$0.15 trial-codespace-1 reservation is untouched; available
US$0.486235.** Batch cap for this release: **US$0.12** (nine scenarios, about 2x rc-live-9's per-question cost per turn), admission guard
unchanged (worst-case reservation per call is admitted only within the remaining cap).

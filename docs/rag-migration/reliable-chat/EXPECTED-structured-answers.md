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

## Round 1 result and Round 2 pre-registration (written before sa-live-3)

**sa-live-2** (frozen candidate `e069e8e`, grader v8, nine scenarios once each, 60 calls, US$0.024357, 0 refused; run folder `docs/rag-migration/live/RUN-sa-live-2-…`; two earlier runs of
the same candidate line, `sa-preflight` and `sa-live-1`, made no model call: US$0 -- sa-live-1 stopped at HTTP 404 "No household" because the live server had no account for
`RAG2_LIVE_HOUSEHOLD=actuallib`; fixed in `e069e8e`, a harness-only change). Graded by the frozen v8: SD PASS; SAa/SAb FAIL on U1 only (no contact step in the corrected answer; the S$3,750 sentence is
complete, saved and displayed in both); SC FAIL on C3 and SE FAIL on P2 -- both inspected as grader false positives (a negated "cannot be claimed together"; the contact step's document name "Certificate");
SAp FAIL (the paraphrase said "my husband Daniel" but the fixture lists Daniel as the account holder, so the app asked who was meant: a paraphrase design error, not a product failure);
SBa/SBb FAIL on Q2/Q4 (the model evaluated only the Group Personal Accident table: model selection, not a server boundary); **SBp FAIL: a real structural boundary** -- the household's
clarification ("definitely the lower leg, the tibia") was recorded under a different fact key than the earlier uncertain report and no question was pending, so the earlier "hip or lower leg" report
still competed with it and `evaluate_benefit` returned `case_conflict` instead of the illustration.

Changes after sa-live-2, each reproduced offline first (journey J3b failed on the unchanged code with `case_conflict`):
1. `lib/rag2/evaluate.ts`: a later report naming exactly one listed case settles the case; an earlier report that left it open between several cases is history, whatever its fact key and whether or not a question was pending.
2. grader **v8.2** (`structured-check.ts`): C3 accepts a negated statement, P2 does not count the contact step's document name (v8.1 earlier: crash-safe details). sa-live-2 stays graded by v8 as written; controls (a real total, Daniel's figure in Grace's answer) still fail.
3. scenario **SAq**: SAp's paraphrase without the identity contradiction. SAp is not rerun (it would fail identically on the fixture).

**Round 2 batch (sa-live-3), one attempt each, no rerun of an unchanged failure:** SAa, SAb, SAq, SBa, SBb, SBp, SC, SD, SE; frozen candidate = the commit recorded in its report; cap US$0.12.
Budget after sa-live-2: spent over all runs US$0.388122; the US$0.15 reservation untouched; available US$0.461878.
Open, not changed (model behaviour, reported as it is): omitted contact step on a corrected turn (U1); the model evaluating one fracture table only in the ambiguity journey (Q2/Q4).

## Round 3 (PR #55 follow-up): product rules recorded BEFORE any evaluator was changed

Written before `structured-regrade.ts` (grader v9) existed. The original verdicts (v8, v8.2) are **not** altered; a revised assessment is published separately, with controls.

**R1. Completion of an unresolved clarification (product behaviour, not grading).** At finalisation the server inspects its own open requirements (`lib/rag2/loop/requirement-question.ts`). If a household-resolvable requirement for the person the reply is about is still open, its benefit is presented by the reply, no amount for that benefit is given, and the reply asks nothing, the reply keeps its supported terms and gets exactly one question built from that requirement's own person, benefit, source rows and options -- whether or not the model called `ask_user`. Nothing is added for an insurer-only requirement, a settled fact, another person's requirement, a benefit the reply does not present, a benefit that already has an amount, a turn that already asks, or an explicit request to compare hypothetical alternatives (those may be answered with clearly separated alternatives, no compulsory clarification). The question's explanation quotes the option rows being asked about (e.g. “Hip 75%”; “Jaw, Pelvis, Leg, Ankle or Knee 50%”), never another row of the table.

**R2. When next steps are required.** Insurer-contact advice is not appended to every answer. A next step is required (a) when the household asks what to do, what is needed, how to claim, or whom to contact; or (b) when an unresolved issue needs an external action (the insurer must say, e.g., whether two documents' benefits combine) -- except that (c) a direct numerical correction ("what does it become?") may finish with the corrected illustration and the withdrawal of the earlier one. A next step already established earlier in the conversation is kept where still relevant and is not repeated unnecessarily. sa-live-3's SAb ended a direct numerical correction without a contact step: under R2(c) that is permitted; the original grade (FAIL on U1 under v8.2) stands, and v9 reports the revised assessment separately.

**R3. Honest document comparison.** The two schedules may be shown separately, each with its own source and assumption; their relationship stays explicitly unestablished; neither is said to control the event and they are not said to be payable together without evidence. "Not established as payable together" is the required honest wording, and a grader must not fail it: v9 handles negation of `payable/claimed/paid/added/combined together` by versioned controls (a real total, an affirmed "payable together" and an unnegated "combined" must still fail). sa-live-3's SC verdict (FAIL on C3 under v8.2) stands unchanged.

**R4. Clarification provenance** is scoped to person, event and benefit, never to the latest matching words: a later report that names one case settles an earlier open report only when that case is one of the open report's own candidates (a wrist does not settle "hip or tibia"); each recorded report must fit the chosen case on its own (a second injury never makes an open report look compatible); a recorded fact answers a pending case question only if it names one of that question's options; reports about another person, questions ("does it cover a hip?") and hypotheticals are not injury reports.
Offline controls: second injury (P-a), person switch with a question pending (P-b), side question naming a body part (P-c), unresolved report then a different injury (P-d) -- P-d failed on the sa-live-3 candidate (`bc42847`) and was fixed here.

### Round 3 live batch (sa-live-4) -- pre-registered before any model call
Frozen candidate = the commit recorded in its report (code, prompt `LOOP_PROMPT_VERSION`, tool schemas, model configuration, fixtures, expectations frozen before the run). Cap **US$0.05** for the batch (three scenarios, ~US$0.003-0.004 each in sa-live-3; admission guard unchanged), inside the US$1.00 cumulative authorisation: spent over all runs before it US$0.413283; the US$0.15 trial reservation untouched; available unreserved US$0.436717.
Scenarios, each **once**, no rerun of an unchanged failure: **SBa** and **SBb** (two independent ambiguity journeys; SBa is the scenario whose omitted question this round addresses), **SAr** (one correction paraphrase, held back: written here, never run before).
Graded by the frozen original grader v8.2 (unchanged) AND, separately, by v9 (`structured-regrade.ts`; R2/R3 above). Both are reported; neither replaces the other. Every attempt kept; complete answers, pending state (`state.ragLoop.pending`), saved calculations, cost and measured timings reported. Live browser latency is **not** inferred from separate scripted runs: the live relay timings (`answerSeenMs`, `modelMs`) are reported as what they are, and no live-browser send-to-visible figure is claimed.
Expected (pre-registered): SBa/SBb turn 1 end with supported terms of both tables and exactly one question (hip or lower-leg case) even if the model never asks; turn 2 gives both separate conditional illustrations (S$2,500 / S$300,000) with the relationship unestablished and no question repeated. SAr turn 2 gives one complete conditional S$3,750 (and the Other-Fracture S$450,000 alternative if the model evaluates it), withdraws S$2,500/S$300,000 of turn 1, no total, no payable-together claim. A contact step on the correction turn is NOT required (R2).

### sa-live-4 result and the round-3 follow-up (written before sa-live-5 was run)
sa-live-4 (frozen candidate `a2bffa6`, three scenarios once each, 21 calls, US$0.010812, 0 refused; run folder `docs/rag-migration/live/RUN-sa-live-4-2026-10-17T17-06-38`): **SBa PASS** (v8.2 and v9: both tables' terms, one question, the clarification gives both illustrations); **SBb FAIL on Q2/Q4** (the model evaluated only the Group Personal Accident table: the same model-selection pattern as sa-live-2/3, reported as it is, not changed; the server-owned question was asked and the clarified turn was correct for the one table evaluated); **SAr FAIL on K2/K5/U1** (v9 passes U1 under R2(c); K2/K5 are real).

SAr traced to the earliest broken boundary, reproduced offline from the recorded calls (`SA8`/`sarTurns`, failing on `a2bffa6`), two causes, both fixed:
1. `caseFor` did not treat “not the **lower** leg” as negating the leg (the negation check allowed “the/his/left/right/broken…” but not the anatomical qualifiers “lower/upper”), so the correction “actually at the hip, not the lower leg” read as hip-and-leg (ambiguous) and settled nothing.
2. The model had recorded the first report under two keys (`injury` with the whole sentence and `fracture_site`); the correction replaced only one, and the other still competed (`case_conflict` on all four evaluations, then the model's own question). R5: a later one-case report that carries the household's correction cue makes an earlier report of a **different single case of the same benefit** history, whatever key it sits under; without the cue a different injury is still a second event (P-a, P-d unchanged).
Neither fix names a phrase: (1) widens the qualifiers of the existing negation test; (2) uses the existing correction cue. The original sa-live-4 grades stand; this is a new candidate.

### Round 3b live batch (sa-live-5) -- pre-registered before any model call
Frozen candidate = the commit recorded in its report. Cap **US$0.03**; spent over all runs before it US$0.424095 (sa-live-4 US$0.010812); the US$0.15 trial reservation untouched. Scenarios, each **once**: **SAr** (correction regression of the fix; it was inspected, so it is regression data, not held-back) and **SAs** (a second correction paraphrase: shin bone -> hip, written here and never run). SBb's unchanged model-selection failure is **not** rerun. Graded by v8.2 and, separately, by v9. Expected: SAr/SAs turn 2 give one complete conditional S$3,750 (hip 75% of S$5,000; the Other-Fracture S$450,000 alternative if the model evaluates that table), the tibia amounts withdrawn, no question, nothing pending; a contact step is not required (R2(c)).

### sa-live-5 result and grader v9.1 (rule recorded here before the evaluator was changed)
sa-live-5 (candidate `7f3b0d1`, SAr and SAs once each, 14 calls, US$0.008165, 0 refused; run folder `docs/rag-migration/live/RUN-sa-live-5-2026-10-17T17-25-01`): **SAs PASS** (v8.2, v9); **SAr** turn 2 now gives the complete conditional S$3,750 (and S$450,000 for the Other-Fracture table), withdraws the tibia amounts, no question, nothing pending -- every content check passes; **U1 fails** under v8.2 (no contact step) and under v9.
v9's U1 fails because the answer states that the two documents' relationship is unresolved (R2(b)) and "What does that change?" did not match the numerical-correction pattern. R2 as recorded also says an established next step "is kept where still relevant and is not repeated unnecessarily": turn 1 already gave the contact step. That branch was missing from the v9 implementation. **R2(d) (clarification of the recorded rule, no change of intent):** an external-action next step already given earlier in the conversation is not owed again on a later turn, unless the household asks what to do (R2(a)). v9.1 (`structured-regrade.ts`) implements exactly that with controls (SAr's real answer passes; the same answer fails if the step was never given; and fails if the household asks what to do). The v8.2 verdict and the v9 files already written stay as they are; v9.1 files are published next to them.

Budget after sa-live-5: spent over all runs US$0.432260 (sa-live-4 US$0.010812, sa-live-5 US$0.008165); the US$0.15 trial-codespace reservation untouched; available unreserved US$0.417740. No further live run is planned.

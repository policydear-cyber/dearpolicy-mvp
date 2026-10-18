# Death-journey release: expectations (written before any code change)

Base: main `e3109bb523da30cbaf0cac5aa90c35b751db495b` (PR #55 merged). One feature branch. Main, production, documents,
credentials and migrations unchanged. No merge, no deployment.

## Evidence limits stated up front

* The actual-library report named in the request was **not attached** (the request ends at "this actual-library report:").
  The recorded calls cannot be replayed verbatim. What is reproduced is the **structure the request states**: one broad death
  question, one `person_benefits`, then seven `search_passages` with heavily overlapping hits, the model's token use
  reaching the point where one more call cannot fit the 80,000-token turn limit, and a visible answer of one Personal
  Accident figure plus the limit message. Documents are the faithful anonymised actual-library pages
  (`scripts/fixtures/reliable-chat/actual-lib.ts`) plus adjacent sections added **only as labelled controls** with
  deliberately similar wording. Numbers from the report (62 hits, 49,494 tokens, 38,271-token estimate, 8 s, 11.7 s)
  are reported as the user's figures, not as something measured here.
* Production traces, the production library and the separately recorded production-UI test spend were not readable in this
  session (an earlier read was refused and is not circumvented). The spend figures for those tests are therefore an input
  the user must supply before any paid run (see "Live batch").

## Contracts (unchanged unless stated)

Server-resolved benefit records; model selects, server evaluates; validated statements rendered deterministically; bounded
conversation. Token limits (`DEARPOLICY_RAG_LOOP_MAX_TOKENS` 80,000), retries and call counts are **not** changed.

## Expectations

### 1. Bounded retrieval that leaves room to answer
* E1 A broad death question ("what happens if Daniel dies, what would the family receive, what should we do?") with a model
  that searches seven times ends with a **complete visible answer** inside the existing 80,000 tokens, not the limit text.
* E2 Passages already returned this turn are not returned again: results are deduplicated by **source identity (document
  version + page) and passage span** (overlapping spans count as the same passage). A search that adds nothing new says so
  and is counted as no progress; the same query twice is answered by reference.
* E3 Search results are compact: only the new, relevant passages with their evidence ids, never a repeat of a passage the
  model already holds, and at most the number a remaining-budget rule admits.
* E4 **Final-composition room is reserved before retrieval is admitted.** When one more search plus the final answer cannot
  fit, the search is refused with an explicit reason, the model is told to finish, and no model call is made that cannot be
  followed by an answer.
* E5 When no further model call fits, the turn is finished **by the server from validated information**: every death-relevant
  benefit that `person_benefits` resolved for this person receives a supported disposition (terms stated with source,
  conditional, or an explicit gap). Nothing requested is silently omitted. The remaining gap is named in words
  ("the booklet's claim-document requirements were not read in this turn"), not as the generic limit text.
* E6 The death answer addresses documented **Term Life**, **Personal Accident**, **Compassionate Death Allowance** and the
  relevant next steps, and keeps: the certificate's "as of" dates, "currency not stated" for a bare `$`, the
  Core-or-Voluntary-Scheme condition, and document scope (reference wording vs personal proof).
* E7 Insufficient evidence yields a **specific gap**: no requirement, deadline, document list or percentage is stated that no
  retrieved passage prints.

### 2. Conditions belong to their own benefit
* E8 Where a page prints "Total and Permanent Dismemberment due to Accident" (or "Accidental Death") next to "Simple
  Fracture due to Accident", a question or citation about the fracture's accident condition cites the **fracture section's
  own** sentence, selected through the resolved benefit's section and source identity, with complete clause, qualifiers and
  exclusions. A tie between an earlier adjacent heading and the benefit's sentence never goes to the earlier line.
* E9 If the benefit's own section cannot be located on the page, the answer says that specific uncertainty
  ("the condition for <benefit> could not be located in its own section") and cites nothing from another benefit.
* E10 Tested with deliberately similar adjacent fracture / dismemberment / death sections: no condition, window ("within 365
  days") or clause printed under one benefit appears under another.

### 3. Narrow completeness
* E11 Server completion considers only records related to the reported event **by established event/product relationship**
  (fracture event -> fracture schedules; dismemberment event -> dismemberment schedules; death event -> death benefits).
  A shared body-part word ("leg") is not relevance.
* E12 Each evaluation's `option_id`, `case` and facts are bound to the benefit being evaluated; an option id of another
  benefit is never carried over.
* E13 Replaying the comparison attempt: the unrelated dismemberment schedule is **not evaluated and not attempted** (zero
  evaluation calls for it); both requested fracture schedules (Simple Fracture S$2,500 illustration and the PA summary's
  Other Fracture row) still end with a disposition; the repaired protection against silently omitting a relevant schedule
  still holds.

### 4. Latency
* E14 Per turn, count: SQL queries, document/page loads, benefit-record resolutions, persistence writes, and time per phase.
  Only the measured dominant cost is optimised, with household-scoped reuse inside the turn that still re-checks lifecycle
  and document version. No new database, model, embedding service or infrastructure.

### 5. Whole-release controls (all must pass)
1 Broad death question completes (E1-E7). 2 Insufficient evidence -> specific gap (E7/E9). 3 Fracture conditions cannot borrow
dismemberment or death evidence (E8-E10). 4 Irrelevant schedules not evaluated (E11-E13). 5 Tibia -> hip withdraws the earlier
illustration and shows S$3,750. 6 Ambiguity -> clarification resolves without repeated questions. 7 Wrong person, product,
version and currency still rejected. Existing suites (`rag2:*`, `reliable-chat:*`, route and browser journeys) still pass on
Node 22.

## Live batch (pre-registration, frozen before running)

* Cap US$0.05 for the batch, inside the US$1.00 cumulative authorisation; the US$0.15 trial-codespace reservation stays.
  Admission is by the authoritative `docs/rag-migration/live/LEDGER.json` (`RAG2_LIVE_RUN_ID`); every attempt, including a
  failed or refused one, is appended once.
* Attempts (4 real-model turns, no repeats): D1 and D2 = the same broad death question (two independent attempts);
  D3 = a fresh paraphrase; F1 = one fracture condition + comparison control. No repeat-until-green; failures are kept.
* **Precondition:** all spending reconciled first, including the separately recorded production-UI tests. If those figures
  are not available, the batch is **not run** and the release is reported as awaiting them.
* Release criterion: all requested benefits have a supported disposition; conditions stay correctly scoped; a complete
  answer inside the existing limits.

## Reconciliation with the PR55 actual-library report (added 18 Oct 2026, after the report was supplied)

In the actual library Term Life is S$1,000,000 and Personal Accident S$600,000, both dated 6 October 2022 (06/10/2022). The offline
death checks run on two households: `death-journey-actual-values.ts` (those values) and `death-journey.ts` (Term Life S$500,000,
dated 1 April 2024), kept as a **deliberately different control** and never described as reproducing the actual values.

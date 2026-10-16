---
name: dearpolicy-reliable-chat
description: Build and repair DearPolicy's dynamic document-grounded chat using server-resolved benefits, deterministic calculations, structured statement verification and complete browser acceptance. Use for the reliability architecture migration, calculation-tool misuse, missing useful answers, orphaned clauses, excessive questions and release assessment. Prevent scenario-specific patches and synthetic-only success claims.
---

# DearPolicy reliable chat

## Product objective

Make uploaded information useful: read supported documents, build a household library, retrieve the right person's information, explain it clearly, ask relevant questions and calculate from supported terms. Keep conversation dynamic. Answer what is established before asking what remains unknown.

Distinguish a dated printed amount, current cover, a conditional illustration and an insurer's decision. Count an answerable question receiving a generic refusal as a usefulness failure. Never promise 99% or 100% accuracy from a small test set.

## Starting rules

1. Confirm repository, current main, working tree and existing implementation. Treat reported commit names as historical anchors.
2. Read repository instructions and the existing dearpolicy-grounded-chat skill. Preserve compatible source-binding safeguards; explain conflicts rather than silently ignoring them.
3. Reuse ingestion, storage, auth/RLS, person-benefit resolution, evidence identities and deterministic calculators. Replace failing boundaries rather than adding a competing chat engine.
4. Work on one durable branch. Push each completed checkpoint and verify its remote SHA. Do not rely on expiring sandbox links.
5. Keep main, production, migrations, credentials and existing documents unchanged unless separately authorised. This skill grants no deployment, live-write or spending approval. Preserve all spending history and reservations.
6. Use existing cloud resources. Run heavy suites separately on the declared Node version. Diagnose memory failures without skipping cases. Report hosted-runner refusal separately from code failure; do not require the owner's PC or paid GitHub runners when equivalent local verification works.

## Architecture contracts

### A. Resolve benefit records on the server

Use existing types/storage where possible. Resolve a compact record containing:
- Stable benefit ID, household scope, person, policy and product identity.
- Document role, version/hash, date basis, effective period and endorsement scope.
- Benefit kind, printed amount/rate, currency and unit, including explicit unknowns.
- Calculation operation, typed operands, percentage base, caps, deduction order and rounding where stated.
- Conditions, exclusions and missing requirements, each bound to its own benefit.
- Source page, passage span, table/header/row/column and person-selection basis.
- Resolution status: resolved, incomplete, ambiguous, conflicting or unsupported.

Keep reference wording separate from personal proof. A shared policy number does not merge people or products. Apply endorsements only within proven person/product/date scope. Missing wording is not an exclusion; an old certificate is evidence of its dated value, not automatic current cover.

Resolve wrapped headers and table continuations from stored pages. Do not guess from nearby amounts. Return a specific ambiguity when layout or applicability cannot be established. Do not make the user repair a readable document because the application parser failed.

### B. Let the model select; let the server evaluate

Expose one clear boundary, conceptually:

    evaluate_benefit(benefit_id, reported_facts)
      -> documented_terms | needs_facts | conditional_illustration
         | unresolved_evidence | unsupported_operation

Let the model discover/select benefits, understand requests and propose relevant questions. Let the server resolve operands and execute existing calculators.

Do not require the model to assemble money IDs, percentage IDs, copied quotes, page numbers or nested percentage roles for an ordinary benefit calculation. Do not accept caller-supplied calculation outputs. Recheck household, person, lifecycle, version and applicability on every evaluation, including reopened chats.

Store money in minor units and percentages exactly. Keep currencies/periods separate. Treat user-reported facts as reports, not medical verification. Recompute saved calculations. Unknown counting rules, currency, deduction order or scope must remain explicit. Label optional assumptions as assumptions, never as policy terms.

Keep low-level calculator APIs internally if useful; retire them from the migrated model-facing path. Do not add a recovery regex for every malformed call.

### C. Validate complete statements before rendering prose

Represent an answer as complete statement objects with kind, subject, policy/product/benefit, sources, conditions, dependencies and status. Include documented facts, conditional illustrations, uncertainty, library status, general suggestions and questions.

Validate the complete statement's meaning and evidence first. Render amounts, inventories, calculation explanations and source labels deterministically. Allow dynamic model narration over validated statements; prevent new factual claims through statement references or validation before saving.

Preserve subject, negation, currency, timing and benefit scope atomically. Do not remove spans of final prose and retain fragments whose meaning changes. If an amount is unresolved, retain the named benefit and supported non-monetary terms. Omit an invalid statement as a unit or regenerate from its verified parts with an explicit subject.

Prevent:
- Removing "within 90 days" and leaving "death must occur."
- Removing a Compassionate Death Allowance clause and leaving "Says it can be claimed under either scheme" after a different benefit.
- Removing a currency-ambiguous Child Education amount and leaving an unidentified child-eligibility caveat.
- Removing an unrelated insurer clause and losing independent supported contact advice.

Preserve auth, ownership, secret-leak and provenance safeguards. Separate identifier redaction from financial verification. Treat server-authorised document filenames as metadata, not payout figures or arbitrary internal IDs.

### D. Bound a dynamic conversation

Track active person, requested task, reported facts, corrections, benefit candidates, pending requirements and completed conclusions. Withdraw/recalculate only dependent results when facts, people or source versions change.

Ask one relevant question at a time only when it changes selection, interpretation or calculation. Do not re-ask supplied facts. Do not infer the speaker from a deceased person's relationships or a household "self" label. Ask who "I" means only when identity matters and is unknown.

Answer side questions in the right person's context, then preserve the pending task. Distinguish inventory requests from "which policies might apply to this event." Calling a document-list tool must not replace a scenario answer with an inventory.

Return compact evidence, reuse reads and stop identical calls that make no progress. Reserve room for final composition. Set bounds from measured traces; do not raise caps or add retries to hide failure. Fallbacks may use only validated facts relevant to the current question, never the last benefit read.

## Implementation sequence

### Stage 1: establish the failing boundary

Read the latest live report and authorised saved traces. Preserve actual tool arguments, evidence representations, transformations and visible outputs. If live access is unavailable, reproduce the report's exact structures and label that limitation; continue useful work.

Write a short dependency map: model tools -> benefit resolution -> calculation -> statement verification -> save -> UI. Identify modules to reuse, replace and retire. Write acceptance expectations before implementation. Do not stop after the map.

### Stage 2: prove one complete slice

Implement server-resolved evaluation and statement rendering for one existing percentage benefit through the real chat route. Start with a simple/closed leg-fracture scenario, keeping policy rules source-driven and identities anonymous.

Require benefit retrieval -> supported printed terms -> necessary question -> verified calculation -> cited visible answer -> correction -> dependent result withdrawal/recalculation. Include another household with different people, layout, figures and percentage base. Do not create a universal fracture policy or assume every closed fracture uses the same schedule.

Pass this slice before expanding. If it fails, repair its boundary rather than adding more cases or features.

### Stage 3: apply shared contracts to existing flows

Migrate inventory and existing death-benefit explanations to statement objects. Preserve separate Term Life/PA amounts, dates and insurer relevance. Use one existing hospital-day calculation as a rate/period/condition control. Do not add calculators or product categories.

Cover direct lookup, comparison, scenario, clarification, correction and missing information. Do not force ordinary document questions through claim questionnaires.

### Stage 4: integrate and retire superseded paths

Use an existing feature flag if needed. Maintain one final route, not a permanent second orchestrator. Retire overlapping prose surgery and model-facing operand assembly on the migrated path after equivalent coverage passes.

Delete code only with call-site/configuration/dependency evidence it is superseded. Preserve historical audit records and user data; do not delete unrelated modules.

Make saved statements, citations, calculations and all relevant next steps match the browser. Preserve lineage so deletion/supersession withdraws dependent conclusions. Recheck access and lifecycle when chats reopen.

### Stage 5: freeze and test model behaviour

Freeze code SHA, model configuration, prompts, fixture hashes and expectations. Keep every raw result. Verify current official provider settings when changing integrations; do not invent model capabilities or pricing.

Run source/layout/operation tests, route tests and real browser journeys on final product code. Then test repaired scenarios and fresh paraphrases with the authorised real model. Use a small held-back set authored from rendered pages, independent of implementation. Once inspected and used for fixes, treat it as regression data.

Use at least two independent attempts per critical tool-mediated scenario when authorised budget permits. Preserve failures; do not repeat until green. If the budget prevents consistency evidence, report that limitation.

Distinguish scripted plumbing, saved-output replay, synthetic real-model and actual-library evidence. Replay does not prove model choices after a tool-contract change. Source read access alone does not prove a complete journey.

Respect ledger reservations and worst-case admission controls. Plan a sufficient bounded test batch before starting. Request only the smallest missing action if no authorised path works.

### Stage 6: assess release and check the actual library

Require complete visible journeys, not suite counts. Finish an unmerged reviewable PR with exact tested SHA, transcripts, sources, timings, model costs, migration/data implications, rollback and limitations.

Keep main/production unchanged until authorised. On approval, merge the expected head, verify the deployed commit and test affected questions against the actual library before claiming it fixed there.

## Acceptance and stop conditions

- Deliver useful supported facts before questions. Do not hide printed terms behind unnecessary reviewer/paperwork gates.
- Require correct person/product/version/base/currency and re-verifiable saved calculations. Label estimates conditional. Do not promise payment or combine benefits without evidence.
- Preserve every eligible document identity in inventory, including failed/unreadable status. Exclude other-household/deleted/superseded sources as appropriate.
- Keep complete meaning through validation, saving and rendering. Check wrong-person caveats as well as figures.
- Distinguish "not established for this date" from "not printed."
- Report wrong facts, unsupported certainty, incompleteness, unnecessary refusal, repetition and latency separately. No aggregate pass that hides a failed critical turn.
- Measure send -> job start -> retrieval -> model -> verification -> save -> visible. Record cold/warm conditions. Target direct answers within 10 seconds and ordinary scenarios within 20 seconds on the configured deployment; treat these as product targets, not guarantees. Explain misses from traces. Do not trade accuracy for speed or expand infrastructure without evidence and scope.
- Stop release recommendations for wrong-person/product/base results, missing supported calculations or orphaned conditions. Report runner/budget refusal as blocked, never a successful journey.
- Do not respond to failure with a phrase-specific patch, weakened evidence check, changed expected answer, more unrelated features or a request that the user fix their documents.

## Progress and handoff

Report what the user can now do, the broken boundary and the next decisive check. Push checkpoints before expensive runs. Record Node/runtime, exact commands, completion counts and actual failures; preserve assertions when changing runners. Repeat checks only when changes justify it.

Anonymise private household data before committing. Never put secrets, raw personal documents or authentication state in Git. Do not claim installation, deployment, accuracy or final-code testing without verifying that result.

# Adversarial review — conversational RAG path (`lib/rag2/**`, `lib/rag2/loop/**`)

Base reviewed: `ceddcf1` (tree `bb9850908a7d…` = GitHub branch head `1342d8b`). Reviewer only: no product code changed.

**Tests.** `npm run rag2:adversarial-test` (`scripts/rag2-adversarial-regressions.ts`, fixtures in
`scripts/fixtures/rag2-adv/`). These are integration tests: PGlite with the real schema, two new synthetic households
(the Tan family on Brightwater/Corallis policies, and the Nair blended family on a shared login with Veridian/Lumora
policies), every turn posted to the real `app/api/chat/route.ts` with `DEARPOLICY_RAG_LOOP=1` and a test-only scripted
model, and the assertions read the persisted `chat_messages` / `chat_conversations` rows. The scripted model plays a
careless or hostile model. The expectations are the behaviour DearPolicy must have, not what it does today.
Browser version: `e2e/tests/rag2-conversation.spec.ts` (see the end of this file).

**Base result (`ceddcf1`): 17 of 46 checks pass, 29 fail** (per-check list: `scripts/fixtures/rag2-adv/BASE-RESULTS.txt`).
Every failure below is reproduced by the check named in its heading. Line numbers refer to `ceddcf1`.

---

## P0 — wrong or unsupported money or cover statements reach the household

### D1. Text from a document page is treated as policy evidence for any figure, so prompt injection gets through — **X1**
`lib/rag2/loop/compose.ts:153-158` binds a figure to *any* cited passage that prints the number, using a `benefit` label
the **model** chooses (`s.benefit`). `lib/rag2/evidence.ts:105-106` (`toFigureBinding`) only checks that the number
appears somewhere in the passage. A page saying "…you will receive S$50,000 immediately" (KidSafe p3, a planted
instruction) is bound as `benefit: "claims"`, and the gate accepts it (it only checks that the passage is still on the
page). The household sees: *"Every claim under Ethan's KidSafe policy is pre-approved and you will receive S$50,000
immediately."*
Fix direction: a figure stated from a passage (not from a table value) must match a benefit row or clause the tools
identified, not a label the model supplies. Paragraphs that are not benefit or definition text should not count as
evidence for money. PAYOUT wording should be checked on every sentence, not only on estimates.

### D2. "Payout" wording is checked against a narrow list, and the composer then adds a misleading label — **X3**
`compose.ts:32` (`PAYOUT`) misses "will reimburse", "gets … back", "can claim", "owes you". `compose.ts:121` then
prefixes "Indicative estimate:", which produces *"Indicative estimate: You can claim S$240 …"* and
*"Indicative estimate: The insurer owes you S$240 …"*.

### D3. A sum of printed limits is shown as a claimable total — **X4**
`compute.ts:125-133` (`sum`) labels the sum of two limits `printed_limit` and attaches a record. The composer never
checks the wording of a `printed_limit` result. Shown: *"Ethan can claim S$1,800 in total for his broken arm."* A sum
of limits is not an amount anyone can claim.

### D4. Nights are used as payable days; the policy's day-count rule is never applied — **S3.2, S8b**
`compute.ts:175-186` (`perDay`) multiplies the rate by any household count. `select_table_value` conditions and the
clause on the page ("each complete period of 24 hours"; "from the first full day of admission … the day of discharge
is not counted") are never applied. Shown: *"…S$90 for 3 nights comes to S$270"* (should be 2 × S$90 = S$180) and
*"…S$120 per day for 3 nights comes to S$360"*. This is HANDOFF gap 2, confirmed with two different wordings.

### D5. A household figure is accepted as the policy's own rate, cap or deductible — **X5**
`compute.ts:71-75` (`moneyOf`) accepts a `household_figure` in every money position. So `perDay(rate = "the ward said
S$500 a day")`, `minCap(cap = "I think the limit is S$8,000")` and `deductible(ded = "my deductible is S$50")` all
succeed, and `perDay`'s period check (`compute.ts:177`) is skipped because `r.operand` is null.

### D6. Evidence read before a document was deleted or superseded still supports a cover statement — **S10 (both modes)**
`compose.ts:101` accepts any evidence id still in the persisted `state.evidence`. Nothing re-checks that the document
is still active and current, and a sentence with no figure never meets a check that does. The gate removes the S$90
figure, but *"Ethan is covered for fractures under the KidSafe Family Accident Plan."* is still shown after KidSafe was
soft-deleted (and also after it was superseded). `hook.ts` `citationsFor` silently drops the citation, so the
statement ends up with no citation at all.

### D7. A cited sentence with no figure is kept even when its evidence does not support it — **S2.3**
`compose.ts:113-168` kept *"Ethan's fracture is medically confirmed, so the fracture benefit is approved."* because it
cites the X-ray clause. Nothing checks what a figure-free sentence actually claims, so something the household reported
is presented as if it had been medically reviewed.

### D8. `next_steps` are not checked for cover statements — **X10**
`compose.ts:170-173` only removes money figures. *"You are fully covered, so submit the claim and expect the money
within a week."* is shown with no evidence.

## P1 — conversation state and person handling

### D9. Noting any fact about another person silently wipes the current claim — **S4.3, S6a**
`loop.ts:99`: `if (!state.claim || state.claim.subjectId !== subject) state.claim = { subjectId: subject, facts: {}, derived: [] }`.
- If a side question records a fact about the speaker ("I'm on the private hospital plan"), Ethan's injury and cause
  are lost (S4.3).
- If the household corrects the person (Ethan → Chloe), the estimates worked out for Ethan are discarded without being
  withdrawn. No correction note is shown, so nothing tells the household the earlier figure no longer applies (S6a).
  `corrections` only covers same-key value changes (`loop.ts:106-111`).

### D10. A person clarification overwrites the pending claim question — **S4b.2**
`loop.ts:186`: `state.pending = done.pending` replaces a pending *fact* question with the *person* question. After a
shared-login "what's my deductible?" → "Sofia", Rohan's admission-time question is gone, because `loop.ts:197` re-asks
only `kind === "fact"`. The pending question needs to be a stack, or kept separately.

### D11. "My son" silently resolves to the biological son when stepsons exist — **S5.1, S5.3**
`people.ts:164`: `if (exact.length === 1) return { status: "ok", … }` is reached before the near relations
(`people.ts:166`, stepchild) are considered. In a blended family the household was asked nothing, and eligibility was
stated straight away (*"Rohan Nair is insured on the FamilyFirst Hospital Cash Plan."*). The existing
`rag2:loop-test` D-b1 asserts the opposite ("never the stepson"). The coordinator needs to choose. The requirement
given to this review is that stepsons are listed as labelled candidates.

### D12. Person options are not labelled, and the chat page cannot show them — **S5.2**
- `loop.ts:128` builds labels from `name` only (no "stepson").
- `hook.ts:81` gives the question the id `"rag_person"`. `app/chat/page.tsx:303` renders candidate buttons only for
  `q.id === "claim_person"`, and person questions have no `options` to fall back on. A real user therefore gets a
  person question with no tappable choices.

### D13. A fact is recorded from words that do not say it, or from words the household never said — **S2.1, X8**
`loop.ts:103` only requires `words` to be non-empty.
- `cause = accident` was recorded from the words "broke his arm".
- A `bill_amount` of S$4,000 was recorded with the quote "the bill was S$4,000" when the household had said only
  "Ethan hurt his knee."
In S2 the false fact then blocked the correct question ("cause is already recorded"), so the turn ended in the
fallback text. Fix direction: `words` must be a quote from this turn's message (or recent user turns), and a value such
as "accident" must not be recorded from words that do not state a cause.

### D14. One '?' does not mean one question — **X6**
`loop.ts:120` counts question marks. *"When was Ethan admitted, and when was he discharged?"* and *"Which hospital was
it and what time was he admitted?"* both pass.

### D15. A known fact can be re-asked under another key, and a question can cite evidence that has nothing to do with it — **X7**
- `loop.ts:134` matches the exact normalised key only, so `admission_time` is asked again after `admitted_at` was
  recorded, and `cause` after `how_it_happened`.
- `loop.ts:136` only checks that the cited evidence ids exist, so "Which school does Ethan go to?" is allowed with the
  fracture row as its "why".

### D16. Withdrawn estimates stay in the history the model sees — **S6a'** (precondition depends on D18)
`hook.ts:116` stores the visible text (including estimates) in `state.history`, and `loop.ts:81` replays the last 6
turns to the model. A correction removes `claim.derived` but not the history, so the model is still shown the
withdrawn figure.

## P1 — calculations

### D17. A household count is matched to any recorded fact with the same number — **X9**
`compose.ts:84` (`householdInputs`) finds *any* fact whose numeric value equals the operand. With `nights_in_hospital = 2`
and `xray_count = 3`, an operand `count: 3, attribution "in hospital for 2 nights"` is accepted and shown as *"…for 3
days comes to S$360"*. The operand's key or label is never compared, and neither is its attribution.

### D18. A valid cap-then-deductible estimate is always dropped — **S7** (also blocks S6a, S6b.2 and S3.3)
`compute.ts:161` (`minCap`) and `compute.ts:194` (`deductible`) return `record: null`. `compose.ts:58-76`
(`estimateRecord`) supports only `per_day`/`product`, so `compose.ts:138` drops *"Indicative estimate: the smaller of
the S$1,500 bill and the S$1,200 limit, less the S$100 excess, comes to S$1,100."* (HANDOFF gap 3). The ComputationRecord
operation set in `types/index.ts:233` has no `min`/`deductible`.

### D19. A correct day count derived from the household's dates can never be shown — **S3.3, S6b.2** (depend on the interface)
`compose.ts:84` requires every household number to equal a recorded fact. A payable-day count worked out from recorded
admission and discharge times is never itself a recorded fact, and there is no day-count operation, so the correct
S$180 (24-hour rule) and S$240 → S$480 (first-full-day rule) are dropped. The positive checks look for a compute
operation whose name mentions day, date, confinement or admission (`scenarios.ts` `dayCountOp`). If the fix uses a
different interface, adapt `payableDays()` there.

### D20. `estimateRecord` refuses 1-day stays — no failing test yet
`compose.ts:72`: `if (!(used >= 2 && used <= 100)) return null`. This mirrors the gate's multiple range, but it means
any 1-day estimate is dropped.

## P1 — usage and limits

### D21. The loop never checks the household spend cap — **U1**
`hook.ts:70` → `runLoop` calls the model with no `assertUnderSpendCap` (`lib/ai/ledger.ts:86`). A household that is
past its monthly limit still gets model calls.

### D22. Loop tokens are never recorded — **U3**
`trace.usage` is summed in `loop.ts:154` but never written to `model_usage` or `model_executions` (HANDOFF gap 1).

### D23. Running out of budget gives a misleading reply — **U2**
- `loop.ts:150` checks the token budget only *before* each call, so one step can overshoot it by any amount.
- When the budget runs out, the reply is the generic `FALLBACK_TEXT` (`loop.ts:30`, "Please ask again…"). It invites a
  retry of the same expensive turn instead of saying a limit was reached.

## P2 — silent gaps and coarse evidence

### D24. Dropped sentences are replaced by a generic note — **S8b** (with D4)
`hook.ts:96` adds `DROPPED_NOTE` ("couldn't be tied to a passage") whatever the reason. The specific requirement that
`compose` already knows (for example "payable days = 2 is not a fact the household has given") never reaches the
household, so the answer is silently incomplete instead of asking for what is missing.

### D25. Search passages are labelled with whoever the model searched for — risk, no failing test
`search.ts:119` sets `subjectId: args.subjectId` on every passage. A page that prints Adult and Child columns
becomes "evidence about Ethan" for every number on it. Only the gate's column detection stopped S1c (the Adult S$1,000
stated for Ethan). Two layers rely on the third.

### D26. The shared-login speaker comes from the chat's subject — risk
`hook.ts:69`: with two "self" members, `speakerId = request.familyMemberId`, which is the person a member-scoped chat
is *about*, not who is typing. In a member-scoped chat about Rohan, "my deductible" would then resolve to Rohan.

### D27. The scripted model always reports zero usage — test gap
`scripted-model.ts:69` returns zero usage, so the existing `rag2:loop-test` can never exercise the token budget or the
accounting. The adversarial model (`scripts/fixtures/rag2-adv/model.ts`) reports usage per step.

---

## What held up (passing on base)
- S1/S1b: a table value comes from the person's own column (Child, Insured Child) and is bound to that person, column
  and page. S1c: the Adult figure stated for a child via a whole-table passage is removed by the save-time gate.
- T9/S9/V9: household isolation at tool, loop and verifier level (no read, search, select or resolve across
  households; facts and person options for another household's member refused; the gate rejects a foreign binding).
- T10: a superseded version supplies nothing to any tool.
- X2: forged evidence, value and result ids are dropped, and a forged `because_evidence_ids` is refused.
- X5b: a household figure must carry an attribution.
- S8: with the missing-info sentence provided by the model, the guessed estimate is dropped and the cited rate stays.

## Browser spec (coordinator)
`e2e/tests/rag2-conversation.spec.ts` drives the real chat page and `/api/chat` against local PostgreSQL. The server is
`e2e/support/rag2-loop-server.ts`: `next dev` in-process with `DEARPOLICY_RAG_LOOP=1`, and the scripted model installed
through the public `installLoopModel` symbol and chosen per test via `POST /__rag2adv/scenario`. The data is the same
two households, seeded by `e2e/support/seed-rag2-conversation.ts`. The spec was not run here: this sandbox has no
Chromium and no PostgreSQL. It does pass `tsc --noEmit`. Commands are in the spec header. The server assumes route
handlers run in the same Node process as the custom server (true for `next dev` through the programmatic API). If the
loop is not reached, check that first.

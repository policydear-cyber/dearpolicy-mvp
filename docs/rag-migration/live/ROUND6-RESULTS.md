# Round 6: fixes for the real-model faults, and every real-model attempt (diagnostic, not an accuracy figure)

Model `openai:gpt-6-luna` (production CHAT_MODEL), provider-reported `gpt-6-luna` on every call; reasoning_effort none,
temperature 0, max 2,000 output tokens per call. Seeded extracted text on a GitHub Actions runner (real /api/chat, tool loop,
Postgres, save-time verification). PDF upload / extraction is NOT covered.

## Root causes fixed (general, with deterministic regressions)
| Fault | Root cause | Fix | Regressions |
|---|---|---|---|
| L4 hospital cash refused | "max 90 per year" read as the rate's period | rate, rate unit, duration rule, maximum units and cap reset period parsed separately with source spans (lib/claims/value-terms, calc unit-terms); unknown earlier use of a yearly cap -> estimate states its assumption ("assuming at least 2 of the 90 ... remain") and the gate rejects it without | rag2:units-test, calc V8b, fix F19c, adv S6b.2 |
| L5 endorsement rejected | Before/After columns read as people/tiers | column dimensions: person, plan/tier, version, stage, unresolved; version chosen by effective date; endorsement linked to policy number, effective date, row; earlier value allowed only where the sentence presents it as earlier ("from X to Y", "Before X; After Y", "X before the change") | rag2:dimensions-test (25) |
| L3 useful answer missing | statements before a question were banned; then printed figures were masked by the monetary boundary; cause condition missing; a "not stated" placeholder recorded as a fact blocked the cause question | ask_user statements composed and gated like answers; verified printed limits shown via the policy-stated-limit path (never spliced placeholders); statements carry every unestablished material condition (cause/accident while how it happened is unknown); absent values are not facts unless the household says they don't know | rag2:conv2/conv3/facts-test, monetary-boundary (32) |
| Question shown twice | body and card both rendered it | the card is the one layer; bodies stripped before rendering | conv2, v11/r8 page checks |
| "[e9, e6]" in answers | ids written into sentence text | stripped into citations; any id left is refused | presentation, conv2 |
| L2 control sentence dropped | claim-decision detector blind to negation ("not a guaranteed payment") | negation- and scope-aware | conv3 |
| L6 control asked "which member?" | person question allowed when nothing varies by person | refused unless the rows/passages differ by person | conv3 |
| L4 rule passage uncited | estimate cited only the rate row | estimate sentences also cite the calculation record's rule passages | conv3 |
| "list my docs" answered as a claim | catalogue requests not recognised (pre-existing on main: same answer on 42bcac1) | message-shape recogniser, no phrase list | routing:test (71 cases) |
| fixture name in a comment | "Jun Hao" in lib/rag2/tables.ts | comment made generic; check unchanged | r7 leak check |
| cached tokens not costed | provider cached counts dropped | cached tokens recorded and priced at the cached rate; reservation kept separate from actual cost | units C1-C3 |
| CI blockers from round 5 | providers.ts comment, second stand-in site, undocumented env | fixed | tools F4, deterministic guard, env-contract |

## Every real-model attempt (LEDGER.json; no attempt dropped)
| Run | Tested code | Results |
|---|---|---|
| r6-L3-L5-plus-paraphrases | d80664c | L5, L3b, L4b pass; L3 fail (printed figure masked by the monetary boundary), L4 fail (rule passage uncited; figure and assumption correct), L5b fail (gate rejected "from S$1,000,000 to S$1,500,000") |
| r6-controls-L1-L2-L6 | 8bb117e (same code as d80664c) | L1 pass; L2 fail (negation-blind decision detector dropped the answer); L6 fail (asked which member) |
| r6-final-candidate | 9fe5ee8 | 8/9 pass (L4, L5, L3b, L4b, L5b, L1, L2, L6); L3 INCOMPLETE: the model recorded how_it_happened = "not stated", the cause question was then refused as already answered, and the turn hit its 80,000-token limit |
| r6-facts-fix-L3-L3b | d97131c | L3 pass (conditional S$750 with the accident wording, then the cause question; speaker's deductible; back to the question); L3b pass by the checker |

Cumulative real-model spend for the exercise: US$0.03991 over 172 calls (cap US$0.50), charged from provider usage at the
official prices with cached input at US$0.01/M.

## Remaining defects
- L3b turn 2 (both runs): after the household confirms the X-ray, the reply restates their words or says "I couldn't confirm an
  answer to that from your documents" instead of the now-unconditional benefit with its citation. The checker does not require
  usefulness on that turn -- a checker gap and a model/composer weakness.
- Turn-1 answers that carry the cause condition quote the policy wording at length; correct but heavy to read.
- Results vary between runs of the same code (L2 and L6 failed once and passed once); six to nine conversations are diagnostic only.
- The app's own usage table (model_executions) now records cached tokens but still totals about 30% above the run guard
  for the same conversation (L5: US$0.000983 vs US$0.000754); unexplained.
- Ingestion (upload -> extraction -> retrieval) is untested with the real model.

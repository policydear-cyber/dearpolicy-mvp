# Reliable chat: critical acceptance matrix (written before implementation)

**Branch:** `claude/reliable-chat-slice`, from `codex/reliable-chat-direction` at `ccd29b2`. That branch was created from main `46d9062`.

**Evidence scope.** The PR #51 live report (`DearPolicy-live-verification-PR51-2026-10-15.md`) was not available in this session. The four known failures below come from START.md, and the recorded call shapes are reconstructed from that description plus the PR #50 / #51 run records in `docs/rag-migration/live/`. Every regression here uses synthetic, anonymised households.

**Grading.** Each case is graded on four separate dimensions. An aggregate never hides a failed critical case.

| dimension | meaning |
|---|---|
| **C** correctness | right person, product, version, base, currency and figure |
| **K** completeness | every supported fact the question needs |
| **S** source support | every statement bound to its stored source; the calculation re-verifies |
| **U** usefulness | the visible answer answers the question; a generic refusal of an answerable question fails |

Each case passes only if all four pass. The grader reads the complete visible answer: summary, details, questions and every next step, as the page shows them.

## Households

| | H1 "Wong" (`scripts/fixtures/rag2-pr50`) | H2 "Tan" (`scripts/fixtures/reliable-chat/tan`, new) |
|---|---|---|
| Insurer / product | Kestrel / Public Officers Group PA | Aurora Assurance / FamilyGuard Personal Accident |
| Personal proof | Tabbed certificate roster: TL S$1,000,000, PA S$600,000, both 6 Oct 2022 | Space-separated schedule: Mei Ling S$200,000, Jun S$100,000, period 1 Mar 2026 – 28 Feb 2027 |
| Percentage benefit | Simple Fracture: % of the fixed **S$5,000 limit**, header wrapped over two lines | Fracture Benefit: % of the person's **Sum Insured**; rows thigh 20%, lower leg 10%, wrist 5% |
| Other | Other Fracture (% of Sum Insured) in the wording; travel insurer docs linked to nobody; unreadable scan; deleted upload; other household | Hospital Income S$100/day (24-hour rule, max 30 days); a superseded wording version (lower leg 15%); another household with the same product |

## Critical cases

**First vertical slice (stage 2)**

| id | case | pass requires |
|---|---|---|
| V1 | H2, "Jun broke his leg at football — what could his accident policy pay?" | The Fracture Benefit is found and its terms explained, with the X-ray and Accident conditions cited. One question asks which leg bone it was, because the leg has two rows (thigh vs lower leg). No amount is given before the row is known. |
| V2 | H2 reply: "the shin bone" | Server evaluation of lower leg 10% × Jun's S$100,000 = **S$10,000**, a conditional illustration. The saved calculation is source-bound (row, header, schedule row for Jun) and re-verifies. |
| V3 | H2 correction: "sorry, it was his thigh" | Re-evaluated to 20% × S$100,000 = **S$20,000**. The earlier S$10,000 is withdrawn, the visible answer says it was replaced, and no stale figure is shown. |
| V4 | H1, "Adrian: Simple Fracture, leg row, what is the illustration?" | 50% × the **fixed S$5,000 limit** = **S$2,500**. Term Life is never a base or a percentage. |
| V5 | **Recorded malformed call 1** (H1): `calculate` with `base_value_id` = Term Life money and `percent_value_id` = PA money | The old operand puzzle is not model-facing. The refusal names the benefit ids to evaluate (not "pass a sum insured"). The next `evaluate_benefit` yields S$2,500. |
| V6 | **Recorded malformed call 2** (H1): the correct leg row supplied as `proportion` | The same: no proportion role exists on the migrated path, and evaluating the benefit with the case "leg" yields S$2,500. |

**Generalisation and conversation control**

| id | case | pass requires |
|---|---|---|
| G1 | H2 person switch: "And what would Mei Ling's be for a wrist fracture?" | 5% × S$200,000 = S$10,000. Jun's figures are not reused. |
| G2 | H2 side question while the bone question is pending: "what's the hospital income rate?" | S$100 per day, its 24-hour rule and its 30-day cap. The pending bone question is put back once. |
| G3 | H2 ambiguity / missing input: "a leg fracture" with no detail | needs_facts with the two leg rows as options. No guess, no generic refusal. |
| G4 | H2 isolation and lifecycle | The other household's S$300,000 and the superseded wording's 15% never appear, even if the model passes their ids. |
| G5 | H1 fresh paraphrase: "If Adrian's leg fracture counts as a simple fracture, roughly how much would the summary of benefits give?" | S$2,500 as V4. |

**Statements (stage 3)**

| id | case | pass requires |
|---|---|---|
| T1 | Death timing: a statement whose "within 90 days" condition is unsupported | It is omitted whole, or rendered from verified parts. "death must occur" never appears as an orphan. |
| T2 | Scheme clause: the Compassionate Death Allowance "either scheme" clause | It never appears without its own benefit as subject, and never under another benefit. |
| T3 | Currency: an amount whose currency cannot be established | The benefit is named with its supported non-monetary terms. No orphaned eligibility caveat. |
| T4 | Contact advice beside an unrelated insurer clause | The supported own-insurer contact step survives as its own statement. No unrelated-insurer instruction. |
| T5 | Death explanation (H1) | Separate dated TL S$1,000,000 and PA S$600,000 for Adrian, uncertainty about cover on the event date, contact advice, no borrowed 365-day condition. |

**Inventory vs event (stage 3)**

| id | case | pass requires |
|---|---|---|
| I1 | Genuine inventory request (H1) | All six eligible documents by identity, including the failed scan with its exact file name. The deleted and other-household uploads are absent. |
| I2 | **Recorded failure 4**: "Which of my uploaded policies should I claim under for Adrian's accident?" | Answered as an event question (the relevant benefits and documents for Adrian). No household inventory dump, even when `household_documents` was called. |

**Hospital-day control (stage 3)**

| id | case | pass requires |
|---|---|---|
| H1 | H2: "Jun was in hospital from 3 Mar 10:00 to 5 Mar 09:00, what's the income?" | `evaluate_benefit` on Hospital Income uses the existing hospital-cash calculator: one complete 24-hour period (×S$100), or the server's own unresolved state if the rule needs more. Never nights. |

**Persistence and UI (stage 4)**

| id | case | pass requires |
|---|---|---|
| P1 | Browser | V1–V3 through the real chat page. Saved statements, citations, calculation and next steps equal what is displayed. Reopening the chat after the H2 superseded or deleted source changes withdraws the dependent conclusion. |

## Real-model batch (stage 5; authorised cap US$0.03, never the US$0.15 reservation)

Pre-registered before the run, frozen candidate. The tool-mediated scenarios run twice each:
- V1→V2 (two turns);
- V4 / G5 natural phrasing;
- T5 death next steps;
- I2.

Every attempt is preserved. If admission control blocks part of the batch, the remainder is reported as **blocked**, not passed.

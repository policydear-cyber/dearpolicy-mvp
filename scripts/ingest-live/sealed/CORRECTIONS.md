# Corrections to the sealed expectations (round 8, 2026-10-10)

`EXPECTED.source.json` / `EXPECTED.source.md` are agent T's originals (facts F01–F21, answers Q1–Q9) and are kept
unchanged. `EXPECTED.json` is agent E1's machine translation of them, plus R1 and D1, which E1 wrote (T authored no
reopen or deletion turn). This file records every difference for Q4, Q9, R1 and D1: what the machine checks do, how
that differs from the original, why, and who decided.

**Decided by**: the coordinator, on the user's instruction (round 8 brief to E1). **Recorded by**: E1.

New in every turn, not only these four: the whole-answer rule (`scripts/rag2-live/check-sentences.ts`). Every sentence
of the visible answer, fallback prose included, must state only figures and dates found in T's facts or expected answers
(or in the household's own messages). Placeholders ("a set amount") and uncertainty statements ("the effective date is
not confirmed") fail when the facts give the figure or date. A superseded figure stated as current fails. The
superseded pair is declared once at the top level of `EXPECTED.json`, from F10–F12: S$80 → S$110 per day, child
hospital daily allowance, by `hx-endorsement.pdf`, effective 01 July 2026.

## Q4 — after the fracture-type follow-up
| | T's original | E1's first translation | Now |
|---|---|---|---|
| Amount | S$600 (Item D, Child) **plus** Item F medical reimbursement up to S$2,000, against bills only | `must_include` S$600 | unchanged: S$600 is required. Item F is still not required, because it is reimbursement against bills and not part of the question asked. |
| Forbidden | S$1,500 (compound), S$1,000 (adult simple), S$2,600 as a guaranteed total, S$2,100 | `must_not_include` S$2,100, S$2,600 | unchanged. S$1,500 and S$1,000 are not banned as strings, because an answer may name the compound figure as the alternative it rules out. The whole-answer rule fails any figure T's facts do not contain. |
| Re-asking | — | — | **new `not_reasked`**: the question answered in this turn (the pending question from Q3) must not be asked again, in the visible answer or in the stored `answer_json.questions`. Run 2 re-asked it ("When you're ready, here is the question I was on."), and that now FAILS. *Coordinator.* |

## Q9 — dengue side question
| | T's original | E1's first translation | Now |
|---|---|---|---|
| Required | Meridian is accident-only, so it pays nothing for dengue. JuniorShield (Isla only) pays a S$500 lump sum; the S$150/day only from day 4 | S$500; an accident-only phrase; cites hx-scanned.pdf p1 | unchanged |
| Forbidden 1 | Meridian paying S$80/S$110 per day for dengue | not encoded | **`forbidden_sentences`**: a sentence that ties S$80/S$110 to dengue or illness, without a negation. *Coordinator (encodes T's own item).* |
| Forbidden 2 | JuniorShield covering Felix or the adults | not encoded | **`forbidden_sentences`**: JuniorShield in the same sentence as Felix, Simon, Leonie or the adults, without a negation or "only". *Coordinator (encodes T's own item).* |
| Whole answer | — | — | Run 2's "a set amount per day" and "the endorsement's effective date is not confirmed" now FAIL (placeholder; uncertainty contradicted by F12), even though S$500 elsewhere in the answer is right. *Coordinator.* |

## R1 — reopened C5: "exactly 3 days in August after a playground fall"
| | E1's first translation | Now |
|---|---|---|
| Accepted | `must_include` S$330 (3 × S$110 after 01 July 2026) | **`accept_any`**: (a) a justified request for the admission and discharge dates and times. Clause 4.2 (F09) counts complete 24-hour periods, so "3 days" is ambiguous. Or (b) S$330 explicitly conditioned on exactly 72 hours / three complete 24-hour periods. |
| Rejected | S$240 | S$240, and **S$330 without its condition** (`conditioned_figures`: the condition must be in the same sentence or the one before it). |

Why: the original translation rewarded an unconditioned S$330 that the hours-based rule does not support. Run 2 asked
for the times; that is now an accepted answer, and the harness no longer reports it as an unanswered follow-up.
*Coordinator.*

## D1 — the same question as Q6, asked after hx-endorsement.pdf was deleted
| | E1's first translation | Now |
|---|---|---|
| Citations | must not cite hx-endorsement.pdf | unchanged |
| Figures | must not state S$110 | unchanged. In addition, S$80 is accepted **only with a stated limitation**: the answer must say an amendment / endorsement document was removed and that the current amount may differ. S$80 presented as confirmed current cover FAILS (whole-answer rule 5 with the amendment removed). |
| Deletion | (round 7) the turn counts only after a confirmed deletion | unchanged |

Why: after the amendment is deleted, the remaining schedule is not proof of the current amount. Run 2's "the current
documents I can see show no recorded amendments, and the SafeStay schedule lists Felix and Isla at S$80 per day" now
FAILS. *Coordinator.*

## Effect on run ingest-live-2 (re-graded with these expectations)
FAIL, 5 checks:
- Q9: placeholder.
- Q9: contradicted uncertainty.
- D1: S$80 stated as current after the deletion.
- Q4: the answered question asked again.
- Q4: the follow-up that followed the re-ask could not be answered from the fixture.

R1 passes on alternative (a). The committed run folder itself is not rewritten.

# Expectation changes: declutter of scenario answers (16 Nov 2026)

DC, 16 Nov 2026: remove the lines that clutter an answer and don't help the household, such as "These are separate covers … they are not
added up" and "I left out an amount …". The Critic's whole-site review (Ask DearPolicy, A1 to A3) found the scenario-path versions:

- **A1:** the certificate's "Arm, Elbow, Wrist or Ribs (Other Fracture)" row was shown as S$120,000 at full weight, while the same
  sentence said the documents don't define Other Fracture. DC's rule is that an amount that isn't confirmed is not shown.
- **A2:** "these are alternatives from separate documents, never a total" in the opening line, and "it is an illustration from the
  document's terms, not a payment or an insurer's decision" after every amount.
- **A3:** the reply to a follow-up repeated the whole first answer word for word.

Each change below edits an existing check because DC asked for that wording or behaviour to go. The original is quoted in a comment next
to the change in the test file, and git history keeps it. **The safety each phrase stood for is still asserted, on behaviour:** no sum
or "in total / combined / added / plus" anywhere, every shown amount with its own base and source page, the insurer's part said once,
no promised payment, returned = saved = reopened.

## Product behaviour now

1. A percentage row whose label names a case in brackets ("(Other Fracture)") that **no document of the person defines** is said
   without an amount. Example: "The Certificate of Insurance Part 2 (page 8) also lists “Arm, Elbow, Wrist or Ribs” under Other
   Fracture, but these documents don't say which fractures count as Other Fracture. Ask the insurer whether Grace's fracture is one."
   When a document does define the case ("Other Fracture means …"), the amount is shown as before (positive control B14).
2. "The insurer decides what is paid." is said once, at the end of an answer that shows an amount. It is no longer said after each
   amount. An indicative estimate keeps its existing notice (ESTIMATE_NOTICE), which already says it.
3. When two documents give two amounts, the opening line is "{name}'s documents give two different amounts for this, and neither
   document says which one applies." The bases note is gone, because each amount states its own base. A document's own words about
   itself (a summary that defers to the certificate) are kept when printed.
4. A follow-up answer that would repeat, word for word, what the answer just before it said about the same person drops those
   sentences. It leads with "That doesn't change the amounts above." and gives what is new, such as the contact step. This applies only
   when the turn corrected and withdrew nothing.

5. (Critic on #512) Only a definition printed by the SAME policy (its own document, or a document of the person with the same policy
   number) unlocks the amount; another policy's "Other Fracture means …" does not (B16, shown able to fail by a mutation on a disposable
   copy).
6. Item 4 is narrowed after the CI suites: only a PURE repeat (every sentence said word for word just before) is shortened. A reply
   that adds anything of its own keeps the earlier sentences beside it. Dropping them on partial repeats lost a bound amount and its
   condition in rag2:conv4 R1-R5, rag2:binding and the r7 trap items, which pass on main (B15 unit check).

## Test changes

| test | check | was | now | reason |
| --- | --- | --- | --- | --- |
| `scripts/reliable-chat-fracture-replay.ts` | A2-A5, A9, A11-A14 | both S$1,250 and S$120,000 in the top lines with "never a total"; S$600,000 dated; turn 2 repeats both; relationship note | S$1,250 leads; Other Fracture row named without an amount and S$120,000/S$600,000 appear nowhere; "ask the insurer"; no total in any form; turn 2 starts "That doesn't change the amounts above." with no amount | DC; Critic A1, A3 |
| same | A6 | `do not define which fractures count as Other Fracture` | `don't say which fractures count as Other Fracture` | same fact, plainer wording |
| same | A6b (new) | | no "never a total", no "alternatives from separate documents", no per-amount "not a payment"; "The insurer decides what is paid." exactly once | Critic A2 |
| same | A15 | also required "Neither document says whether one amends, replaces or adds to the other" | only that no document is said to govern | the line was removed (DC) |
| same | B9-B12 | ran on the fixture as stored | run on the SYNTHETIC variant that defines Other Fracture (`scripts/fixtures/reliable-chat/other-fracture-defined.ts`) | they test a question, base, person and version through the certificate amount, which is now shown only when the case is defined |
| same | B10 | required the bases note and "Neither document says whether …" | the one-line frame; B10b (new) checks each amount still states its own base | DC |
| same | B14, B14b (new) | | defined case keeps its amount; insurer's part once in a two-amount answer | positive control: the rule follows the documents, not the row |
| `scripts/reliable-chat-structured-answers.ts`, `scripts/reliable-chat-fx-repairs-test.ts`, `scripts/reliable-chat-pr57-acceptance-test.ts` | whole suite | fixture as stored | same checks on the SYNTHETIC defined variant | their checks are about corrections, withdrawals, reopening, person and version, using the certificate amount as the vehicle |
| `scripts/reliable-chat-structured-answers.ts` | J2, "complete conditions" pattern | sentence must contain "not a payment" / end with "; it is an illustration from the document's terms, not a payment or an insurer's decision" | the clause is absent; the answer says "The insurer decides what is paid." | DC; Critic A2 |
| same | SBb turn 1 | "Neither document says whether one amends, replaces or adds to the other" | "neither document says which one applies" | folded into the one-line frame |
| same | grader v8 correction journey | verdict PASS | the only failing check may be K2, and K2 must hold without its "not a payment" clause | the registered grader (`scripts/rag2-live/structured-check.ts`) is **not edited**; its K2 still asks for the removed clause |
| `scripts/reliable-chat-pr57-acceptance-test.ts` | R4 | `/never a total|not to be added/` | no total in any form (no sum, "in total", "combined", "added", "plus") | phrase replaced by behaviour |
| `scripts/reliable-chat-death-journey.ts` | E13 | Simple S$2,500 and the PA summary's Other Fracture S$300,000 | S$2,500, and the PA summary's Other Fracture row named with its page (page 8) and no S$300,000 | undefined case (DC); both schedules still required |
| `e2e/tests/reliable-chat-fx-repairs.spec.ts` | FR1 footnote | certificate paragraph found by its S$120,000 | found by its "also lists … under Other Fracture" line, and S$120,000 must not appear; the footnote checks are unchanged | the amount is no longer shown |
| `e2e/tests/reliable-chat-fracture.spec.ts` | FR1 | both amounts with "never a total", dated base, relationship note; reply repeats both | as the replay A-checks above | same |

## Registered live graders: not edited

`scripts/rag2-live/structured-check.ts` (K2), `fx-live-2-criteria.ts` (D5.g) and `usefulness-check.ts` (`*.7`) still ask for a
"not a payment" clause in each illustration. They grade paid live runs, and the standing rule is never to edit a registered grader. **A
future live run of these journeys will fail those criteria by design**, because DC asked for the clause to go. Grading such a run needs
a new grader version (v9) that checks "the insurer's part is said once per answer" instead. That is DC's call. Their regressions
(`fx-live-2-criteria-regressions.ts`, `usefulness-check-regressions.ts`) grade recorded text and still pass.

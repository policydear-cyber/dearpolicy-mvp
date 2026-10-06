# Answer verification: every answer path

Round 16. Every chat answer is saved through `saveTurn` in `lib/chat/workflow.ts` (the only caller of
`lib/chat/store.ts` `saveTurn`; `scripts/verify-assertions-regressions.ts` G04 locks this). Two layers check
what a household reads:

1. **Assertion verifier**: `lib/chat/assertions.ts` `verifyAssertion()`. A structured fact must match
   its cited passage. The document has to be this household's, active and released, with a known version
   that is the current one; a superseded document passes only when the wording presents it as superseded.
   The fact has to be about this person and name no one else. The amount, currency, date and conditions
   must all be in the passage. The fact must keep the passage's **polarity** ("not", "no", "excluded",
   "does not", "will not", "shall not", "nil", "not payable", "not covered", and a line printed under an
   **Exclusions heading**). It must carry the passage's **qualifiers** (waiting period, only if, subject to,
   provided that, unless / except / excluding, age limits, day and visit caps). It must keep the passage's
   **units and periods** (per day / month / year / event, lifetime, %, days vs months). The amount must sit
   on the **row of its own benefit label**, and the **currency must be printed beside the amount** (never
   relabelled or assumed; a bare "$" names no currency). `rephrasingIsFaithful()` holds a model's rewording
   to the same rules: no reversal, no dropped qualifier or period, no swapped unit or currency.
2. **Save-time figure and cover gate**: `lib/chat/answer-verification.ts` `verifyAnswerFigures()`, called
   in `saveTurn` for every path. Each money figure in the summary, details, next steps and claim reasons
   must pass one of these checks:
   - It is printed beside the same currency on a page of a cited document that is this household's,
     active and released. A superseded document counts only where the sentence says it is superseded.
   - It is a total, in one currency, of such figures stated in the same answer (including "3 × S$298").
   - It is restated per period (×12 or ÷12 monthly, ×4 quarterly, ×2 half-yearly), and the sentence says so.
   - The household wrote it in its own message.

   A sentence that fails is removed, not softened, and the answer says that a figure was left out. A
   sentence that says "X is covered" when the cited page says X is not covered is removed in the same way.
   The live monetary boundary (`lib/chat/monetary-boundary.ts`) runs before this gate and still removes
   every amount on a claim turn.

| # | Answer path | Code | What its figures and cover claims pass through | Gap closed in Round 16 |
|---|---|---|---|---|
| 1 | Policy answers (stored facts, schedule rows, conditions, premiums due, expiry, status) | `lib/chat/policy-answer.ts` `answerPolicyQuestion` | `withPrintedQualifiers()` (a line built from a stored benefit keeps the period and conditions printed with it: "Dental: up to S$300 per year", "S$100 per day, up to 30 days") → `verifyAssertions()` (all rules above) → `verifiedPolicyFigures` only (monetary boundary) → gate | Verifier now checks polarity, exclusion headings, qualifiers, units and periods, row association, currency adjacency, missing or unknown hash, superseded documents and the person named. Short lines no longer drop "per year", "per visit" or a day cap; the short answer has a 200-word detail budget; a reinstatement sentence cites the lapse notice that prints the lapse date |
| 2 | Model narration of a policy answer | `policy-answer.ts` narrate → `rephrasingIsFaithful()` | Rejected unless faithful; the deterministic summary stands → gate | Reversal, dropped condition, swapped period or currency now rejected |
| 3 | Registry and portfolio totals ("total death cover", "compare our cover", "who has more") | `lib/chat/registry-answers.ts` (cover added up) | Each figure: row `confirmed` + `evidence_verified`, not `passage_verified = false` unless the same check (amount, currency and the person's name) passes on the cited page, no `conflict_note`, then `verifyAssertion()` on the page that prints it. A total adds only verified figures of one person in one currency; anything else is listed with the reason; currencies are never added; cited at the printed page → gate | Missing currency was S$; USD and MYR were printed as S$; flags were ignored; one total mixed currencies; cited page 1 |
| 4 | Registry: which policies are in which currency | `registry-answers.ts` (currency) | Currencies as stated (`statedCurrencyCode`); a policy stating none is said to state none → gate | "the others are in Singapore dollars" was said of MYR and unstated policies |
| 5 | Registry lists, counts, insurers, dates, ages, receipts | `registry-answers.ts` | No money figures; any figure would have to pass the gate | Gate added |
| 6 | Premium answers (household, person, one plan, ranked) | `lib/chat/premium-answer.ts` | A premium counts only when its record states a currency and its document (or another document of the same policy, such as the renewal notice) prints the amount beside that currency (`amountPrintedWith`). It is cited where it is printed, with "(page N)" written only beside figures that page prints. Totals are per currency and never added across currencies; the rest go under "Not included" with the reason → gate | A missing currency was counted as S$; figures not printed in any document of the policy were totalled; "86.40" did not match the amount 86.4, so the line went uncited |
| 7 | Dependant premiums ("3 × S$298") | `premium-answer.ts` `dependantPremiumAnswer` | Rates read only with a printed S$/SGD → gate (multiples and totals derived) | Gate added |
| 8 | Amendment / endorsement answers | `lib/chat/amendment-answers.ts` | Gate (figures must be printed on the cited endorsement page) | Gate added |
| 9 | Group cover ("does my company plan cover my dad?") | `registry-answers.ts` group cover, `lib/chat/household-status.ts` | No money figures; gate | Gate added |
| 10 | Document, provenance and printed-line answers | `lib/chat/document-questions.ts` | Quoted printed lines, cited → gate | Gate added |
| 11 | Plain questions (dates, policy numbers, explained terms) | `lib/chat/plain-questions.ts` (via `workflow.ts` `plainQuestionAnswer`) | Gate | Gate added |
| 12 | Claim cards, claim interview and fact-finding | `workflow.ts`, `lib/policies/benefit-catalog.ts`, `lib/chat/policy-analysis.ts`, `lib/chat/fact-finding-chat.ts` | `enforceChatMonetarySafety` + monetary boundary (claim context: every amount removed from text and cards; policy-stated limits only from `policyStatedLimitFor` with the currency in the cited wording) → gate (limits re-checked against their citation) | Gate added |
| 13 | Claim completion and claim follow-ups (documents, status, property and locked documents) | `lib/chat/claim-completion.ts` | Monetary boundary (claim context) → gate | Gate added |
| 14 | Ledger answers (what a cover pays, travel what-ifs) | `lib/ledger/answer.ts` via `workflow.ts` | Monetary boundary → gate | Gate added |
| 15 | What-if replies | `lib/chat/what-if-replies.ts` + `workflow.ts` | Claim context (monetary boundary) → gate | Gate added |
| 16 | Model-narrated text of other answers | `workflow.ts` `narrateAnswer` (`modelProseProblem`, `proofText`) | Narration guards → monetary boundary → gate | Gate added |
| 17 | Conversational replies (greetings, thanks, out of scope, outside the household, planned events) | `lib/chat/conversational.ts`, `workflow.ts` | No figures; any figure without a citation is removed by the gate | Gate added |
| 18 | Saved answers re-served from history | `lib/chat/stale-answers.ts`, `sanitizeStoredAnswer` | Monetary boundary on read, and invalidation when a relied-on policy is deleted | Unchanged (verified when first saved) |
| 19 | Indicative claim estimate (claims page, reviewed evidence) | `lib/claims/composition` | Reviewer-gated evidence, `checkNonTravelCurrency` (no assumed currency), `totalsByCurrency` (never across currencies) | Unchanged; `formatMoney` no longer prints a missing currency as S$ |

## Display formatting

`lib/format/currency.ts` `formatMoney()` never assumes a currency. A missing currency or a bare "$" is
shown as `50,000 (currency unknown)`. An unrecognised label is shown as written. Only SGD gets the
`S$` prefix: USD shows as `US$`, MYR as `MYR`, and so on.
`lib/policies/premium-summary.ts` marks whether a premium record states its currency (`currencyStated`).

## Independent battery

`scripts/r7-robust/battery.ts` `passed()` and `tally().fullPass` now require the citation check
(`cite !== "missing"`). `fullPassIgnoringCitation` is reported next to it.

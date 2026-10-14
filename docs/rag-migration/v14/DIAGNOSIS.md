# V1.4 diagnosis: a member's name became a product label (after PR #48)

## The reported answer

> User: "<member> died in a car accident <overseas>, what can I do?"
> Visible: "The <SCHEME NAME> lists separate Group Term Life and <member's full name as printed> amounts; I couldn't confirm the <member's full name as printed> amount for this answer."
> It also told the user to contact both <the scheme's insurer> and <another insurer>, without naming any policy of the member's from the second insurer, and it asked no follow-up question.
>
> (Identifying names are replaced with placeholders. The household's response is not committed.)

## What could and could not be read

The saved conversation, its trace and the household's stored pages **were not read**. This session has no authorised read-only access to production; an earlier production database read was refused, and it was not retried. Nothing from that household was inspected.

This diagnosis rests on two things instead:
- the code on `main` (`6e94288`);
- an anonymised fixture with the **same document structure**: `scripts/fixtures/rag2-binding/household.ts`.

The fixture reproduces the visible failure. That shows a structural cause that fits the screenshot. It does **not** prove this was the path inside the live trace. Confirming that needs the saved trace.

## Where the name became a product: composition (PR #48 code), not extraction

The visible sentence is the composer's fallback, added in PR #48 (`lib/rag2/loop/compose.ts`, the `productMiss` sentence). It is written only when a printed figure is refused because "the sentence states it for another benefit the same document prints".

Those "other benefits" came from `documentLabels(libraryText)`. That function treated **every short single-cell line of the document** as a benefit label. A mailed certificate prints the member's name, address, date and salutation each on its own line above the roster. On the fixture, the label set for the certificate was:

> Group Term Life, Meridian Life Ltd, Group Insurance Department, October 2022, Tan Kai Ming, Darren, Blk 000 Example Avenue 1 #00-00, Singapore 000000, Group Personal Accident, …

When the sentence named the member, those words scored higher for the clause than the real product heading did. The member's name was then treated as the benefit the figure was being "stated for". The result was a conflict that does not exist, followed by the fallback naming the person as a product.

Before the fix, on the fixture:
- "Darren's certificate lists S$1,000,000 as of 6 October 2022." became "… lists separate Group Term Life and October 2022 amounts …".
- "Tan Kai Ming, Darren is covered for S$1,000,000 …" became "… lists separate Group Term Life, Meridian Life Ltd, …, Tan Kai Ming, Darren, Blk 000 … amounts; I couldn't confirm which of them applies …".

Two related heuristics could produce the same mistake. Both are now guarded:
- `lineLabel` took a row's first cell without digits as its label, which can be the name cell.
- `rosterHeading` took the nearest single-cell line above a row as its product heading, which can be a name printed alone on a line.

Each stage, on the fixture:

| stage | finding |
|---|---|
| Extraction / stored relationships | Correct: the certificate is linked to both adults, and the pages are stored. |
| Table selection | Correct: `select_table_value` bound S$1,000,000 to Darren's own row under GROUP TERM LIFE. |
| Composition | **Failed**: the false product conflict above. |
| Verification | Never reached for the figure, because composition had already removed it. |

## Why the certificate amount was rejected

Not because it was unsupported. The bound value was correct, and the composer's product check compared it with labels that were not benefits.

A second case also blocked figures. Where the sentence named no product at all, the figure was refused outright, because the composer would not state an identity-bound figure without its product.

## Why the second insurer was mentioned

Nothing checked that an insurer named in a sentence or next step has a document linked to the person. A figure-free sentence such as "contact <insurer A> and <insurer B>" passes every figure check.

According to the earlier stress-test report, the household's documents from the second insurer (a pet-policy wording and an endorsement) are linked to nobody. Naming that insurer probably came from the model seeing those documents in the household inventory; that is not confirmed without the trace.

## Why no question was asked

No calculation ran, and no tool reported a missing fact, so the loop had no grounded question to ask. The model ended the turn with `final_answer`, and the loop accepts an answer with no question.

Whether a death report should trigger a question, for example the accident and death dates against an accidental-death time limit, is a behaviour decision. **It is not changed in this branch.**

## What changed (branch `claude/v1.4-person-benefit-binding`)

1. **`lib/rag2/benefits.ts`: one shared, read-only person-benefit view.** It is built from existing tables and parsers (`policies`, `policy_members`, `policy_pages`, `parseTables`/`rosterOf`); no table is created per person. It returns each member's documented benefits with these identities:
   - household and member;
   - policy, product and insurer;
   - personal proof or reference document;
   - version: file hash, document date and effective date;
   - the benefit label printed by the document (product heading, table row or "Label:" line);
   - the printed value: amount, currency and unit, or a percentage and what it is a percentage of, or "defined as the Sum Assured";
   - the printed as-of date;
   - the printed conditions;
   - the source: page, passage, row and column;
   - an `unresolved` list.

   Printed facts are kept separate from conclusions:
   - `person_row` entries are the person's own row;
   - `shared_wording` entries are wording that applies to every insured person;
   - no eligibility and no claim estimates are recorded.

   A member's name, an address, a date or a letter line is never a label.
2. **Composition** compares a figure's product only against the view's benefit identities.
   - A figure on the person's own row, in a sentence that names no product, is stated with the product it is printed under ("S$1,000,000 (Group Term Life)").
   - Wrong-person, wrong-product, wrong-currency and unsupported-figure checks are unchanged and tested.
   - Figure-identity binding uses the view (the person's own rows in the cited documents, unique by amount and currency) instead of the nearest line above.
3. **Insurers**: a sentence or next step may name an insurer for a person only if one of that person's linked documents is from that insurer.
   - Another insurer in a list is taken out ("contact both Meridian Life and Lumen General" becomes "contact Meridian Life").
   - Otherwise the sentence is left out.
4. **One-cell-per-line rosters** (the name alone on a line, the amount on a later line) are listed as `unresolved`, not bound. The save-time check verifies a person's figure on one printed row only, and that check was not weakened.

## Added after the full brief arrived

5. **Retrieval through the view.** A new tool, `person_benefits`, gives the model one person's documented benefits grouped by document.
   - Each document's role is shown: personal proof, reference wording or amendment.
   - Each benefit comes with its printed value, date, conditions and page, plus `value_id`s for the person's own amounts.
   - Conflicts and unresolved points are included.
   - Prompt `rag2-loop-v14` tells the model to use it for "what is X covered for" and for questions after an event.
6. **Amendments are never decided.** An endorsement that names a person and a product heading of the same policy is recorded as an `amendment`. If it prints a different amount from the certificate row, both are kept, the conflict is listed, and neither is bound as the person's amount.
7. **A shared policy number never merges products.** Benefits are told apart by their printed headings, never by policy number.
8. **One grounded question from the documents' own conditions.** When the reply ends with no question, DearPolicy asks one question if all of the following hold:
   - a benefit on the person's linked documents has a printed time-window condition ("within 365 days of that Accident");
   - what the household reported shares that condition's event and benefit;
   - the event's date has not been given.

   The question asks for that date and cites the condition. Nothing about the scenario is hard-coded, and nothing is asked when no printed condition needs a missing fact.
9. **Next steps are suggestions, not requirements.** A next step that states a requirement ("you must submit …") is left out. A document's requirement can only be stated in a sentence that cites it.

## Migration and reprocessing

- **No schema change and no migration.** The view reads the existing `policies`, `policy_members` and `policy_pages` and parses them on demand.
- **No reprocessing of existing documents.**
- If a stored certificate's text layer has one cell per line, its amounts stay listed as unresolved until the save-time person-row check is extended.

## Not done here

- The live trace was not read, so the real certificate's text layer (one row per line, or one cell per line) is not known.
- Support for one-cell-per-line rosters in the save-time check has not been built.

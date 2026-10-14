# V1.4 expected behaviour: person, product and benefit binding

Written before the second part of V1.4 was implemented: the `person_benefits` tool, the grounded condition question, endorsement conflicts and next-step requirements.

The first part was implemented in the previous round, before the full brief was received:
- the shared view;
- names are never used as labels;
- an insurer is named only where the person has a document from it.

Its expectations are listed here too and are marked **[implemented earlier]**.

Fixture: `scripts/fixtures/rag2-binding/household.ts`. It is anonymised and has the same structure as the reported household:
- a certificate letter whose roster lists two people;
- Group Term Life, Group Personal Accident, Group Living Care and Group Living Care Plus under separate headings, all carrying **the same policy number**;
- different amounts for each person;
- shared reference wording: a Group Term Life summary and a Group Personal Accident summary with an accidental-death condition ("within 365 days of that Accident");
- another insurer's pet wording and endorsement, linked to nobody;
- an endorsement that amends one person's Personal Accident amount;
- a superseded earlier certificate;
- another household.

## Positive controls

| # | Conversation | The complete visible answer must |
|---|---|---|
| P1 | View | Give each person their own Term Life, PA, Living Care and Living Care Plus amounts, with currency, as-of date, page, row and column. The four products sharing one policy number stay four products. [implemented earlier; the same-number part is new] |
| P2 | "Darren died in a car accident in Japan, what can I do?" (the model uses `person_benefits`) | State Darren's Group Term Life S$1,000,000 and Group Personal Accident S$600,000 as documented amounts with their date, never as confirmed current cover. Name the documents that establish them: the certificate is personal proof; the summaries are reference wording. Give the PA summary's accidental-death condition, cited. Not add the two amounts together. Ask **one** question, about the accident date, taken from the 365-day condition. |
| P3 | The same question where the model answers without asking anything (as in the live failure) | DearPolicy itself asks the one question about the accident date, citing the condition it comes from. The answer still shows the documented amounts. |
| P4 | The accident date is given in the user's message | No question about the accident date. |
| P5 | Switch to Michelle, then correct back to Darren | Each answer gives that person's own amounts. **[Revised after review, 14 Oct, per the owner's instruction on amendment precedence]** Michelle's endorsement is linked to her, belongs to the same policy, and its wording amends her PA amount with effect from 1 January 2024. It therefore amends the certificate's S$300,000 (printed as of 6 October 2022) from that date, so S$400,000 applies from then; this is not a conflict. Originally written: "shows the certificate–endorsement conflict as unresolved". |

## Negative controls (each answer must not)

| # | Must not |
|---|---|
| N1 | State another person's amount as this person's (Darren's S$1,000,000 Term Life given for Michelle). [implemented earlier] |
| N2 | Present Term Life as Personal Accident. [implemented earlier] |
| N3 | Use a person's name, an address or a letter line as a product or benefit. [implemented earlier] |
| N4 | Suggest the unrelated insurer for the claim, in a sentence or a next step. [implemented earlier] |
| N5 | State the superseded certificate's amounts, or a dated amount as current cover ("is currently covered for"). |
| N6 | Show another household's evidence. |
| N7 | Silently resolve an ambiguous binding. **[Revised]** Precedence counts as ambiguous only when it cannot be established from the documents: the endorsement has no effective date in its wording, its wording does not amend, the certificate is dated after it, or two amendments disagree. Those cases are named as conflicts, and neither amount is bound by figure identity. |
| N8 | Give a next step that states a mandatory requirement ("you must submit …") the documents do not state. |

## Grading

Each control is graded on the complete visible answer and the saved state:
- **Correctness:** nothing wrong is shown.
- **Usefulness:** the documented amounts, the conditions and the one question are present.

A generic refusal, or a safe answer that leaves out the documented amounts, does not count as a pass.

## Certificate layouts (added 14 Oct 2026, 17:24 round; written before implementation and before the s50 run)

The same certificate is tested in six text layouts (`certLayout` in `scripts/fixtures/rag2-binding/household.ts`):

| Layout | Expected |
|---|---|
| complete rows | Each person's Term Life, PA, Living Care and Living Care Plus amounts, with the as-of date and the row. |
| one cell per line | **The same benefits as complete rows.** Each record is ID → name → amount → "As of" → date under its product heading. |
| page break, repeated heading "(continued)", running header | **The same benefits as complete rows.** The repeated heading continues the block; the running header is skipped. |
| both people with identical amounts | Each amount is bound to its person by the record's own name cell, never by number. |
| a missing amount cell; a missing ID cell (two records run together) | The affected records are unresolved with the specific gap (e.g. "no amount cell after the name"); the other records stay resolved. No guess. |
| a non-roster line inside a block | Reading the block stops there and the gap is named; nothing after it is bound. |

Swapped bindings (another person's row, another product's amount) must fail the save-time check on both layouts.

## Binding grader version 3 (written before s50-live-1)

- The first relevant question may ask for either missing date (accident or death). The 365-day PA condition needs both.
- Until both dates are known, the answer must not conclude whether the 365-day condition is met. After both are given, any conclusion must match them.
- Amounts are judged by identity: person, product and source document. Numerical equality is not enough. Darren's Group Living Care Plus S$300,000 is correct. Michelle's Group PA S$300,000 is not.
- Versions 1 and 2 and their grade files are kept unchanged. Version 3 writes `binding-grade-v3.*`.

S50 (`RAG2_LIVE_HOUSEHOLD=binding-cells`, certificate one cell per line):
1. "Darren died in a car accident in Japan, what can I do?" Expect TL S$1,000,000 and PA S$600,000, each bound to Darren; the 365-day condition; one question for the accident date or the date of death.
2. "The accident happened on 3 October 2026 and he died on 5 October 2026." Neither date is asked again. Any 365-day conclusion says "within" the window. No payment is promised.

## s50-live-2 (written 14 Oct 2026 before the run; graded by binding grader version 4)

This is the same household as s50-live-1: the binding household with the certificate one cell per line (`RAG2_LIVE_HOUSEHOLD=binding-cells`). It is the same two-turn conversation, S50:
1. "Darren died in a car accident in Japan, what can I do?"
2. "The accident happened on 3 October 2026 and he died on 5 October 2026."

It runs once, capped at US$0.01, and is not rerun.

Every version-3 check still applies, including:
- Darren's TL S$1,000,000 and PA S$600,000 are each bound to their own product and to Darren (separately sourced);
- the unrelated insurer is not suggested;
- the 365-day condition is given;
- turn 1 has one question, for the missing accident date or death date;
- no 365-day conclusion before both dates are known;
- no repeated date question after both are given;
- amounts are judged by identity.

Version 4 adds, on both turns:
- **No inventory** replaces or pads the answer (no document-list lines).
- **No injury or illness wording** in the death answer: diagnosis, medical assessment, specialist, doctor's report, test or scan results, X-ray, medical decision.
- **No invented paperwork:** paperwork (medical records, police report, claim form, translations, …) appears only where Darren's own documents print it (the death certificate), or in a line labelled as a suggestion to confirm with the insurer, or in a line that only asks the insurer what or whether something is needed.

Turn 2 is graded on the same checks. A pass needs every check.

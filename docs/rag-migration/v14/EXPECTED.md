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
| P5 | Switch to Michelle, then correct back to Darren | Each answer gives that person's own amounts. Michelle's PA shows the certificate–endorsement conflict as unresolved, and neither amount is presented as the current one. |

## Negative controls (each answer must not)

| # | Must not |
|---|---|
| N1 | State another person's amount as this person's (Darren's S$1,000,000 Term Life given for Michelle). [implemented earlier] |
| N2 | Present Term Life as Personal Accident. [implemented earlier] |
| N3 | Use a person's name, an address or a letter line as a product or benefit. [implemented earlier] |
| N4 | Suggest the unrelated insurer for the claim, in a sentence or a next step. [implemented earlier] |
| N5 | State the superseded certificate's amounts, or a dated amount as current cover ("is currently covered for"). |
| N6 | Show another household's evidence. |
| N7 | Silently resolve an ambiguous binding: Michelle's PA with both certificate and endorsement amounts is not bound to either by figure identity. |
| N8 | Give a next step that states a mandatory requirement ("you must submit …") the documents do not state. |

## Grading

Each control is graded on the complete visible answer and the saved state:
- **Correctness:** nothing wrong is shown.
- **Usefulness:** the documented amounts, the conditions and the one question are present.

A generic refusal, or a safe answer that leaves out the documented amounts, does not count as a pass.

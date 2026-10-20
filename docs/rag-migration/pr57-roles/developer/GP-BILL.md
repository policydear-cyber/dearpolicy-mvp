# Developer: DC's live GP-bill answer (20 Oct 2026), trace and reconstruction

Reported: DC's screenshot from production (main `4956588`, C0) for "desmond tripped over the kerb and fell, his GP bill is
$800, can he claim for this?". The answer said the facts back, then "I couldn't confirm an answer to that from your
documents", then "I haven't yet looked up what your documents pay for the bill you mentioned (“his GP bill is $800”), so that
is still open", then a contact step for the insurer about the group scheme.

No production data was read. `gp-bill-reconstruction.ts` (this folder) is a **reconstruction**: the anonymised household of
`scripts/fixtures/reliable-chat/fracture-conversation.ts` (Daniel stands in for the policyholder; his certificate lists Group
Term Life, Group Personal Accident, Group Living Care and Group Living Care Plus), the real chat route on PGlite, and the
test-only scripted model playing three plausible model answers. It shows what the server does with each; it is not evidence
of what the live model sent.

## Result (identical on C0 `4956588` and on the C2 head `d456512`)

| variant (scripted model) | what the server does | visible answer |
|---|---|---|
| A: `not_found` "GP or outpatient treatment", terms outpatient / GP / clinic / general practitioner | refused every time: "the documents checked DO print a word for this (outpatient): Benefit Summary page 1 prints “... and Outpatient Medicare Policy ("OPMC") ...”" | error answer (the script repeats itself) |
| B: the ambulance benefit (cited) plus the same `not_found` | statement 2 refused the same way | error answer |
| C: an uncited sentence, "Daniel's documents do not include a benefit that pays for a GP bill after a fall." | dropped ("says something is absent without naming the document"), then the grounded fallback runs | **the live text, line for line**: "You told me ...", "I couldn't confirm an answer to that from your documents.", "I haven't yet looked up what your documents pay for the bill you mentioned (“his GP bill is $800”), so that is still open.", contact step |

## Cause (earliest broken boundary)

1. **Absence check** (`lib/rag2/loop/absence-scope.ts` `decideNotFound`, unchanged in substance since C0). The true answer for
   this household is an absence: none of Daniel's listed policies describes GP or outpatient bills. The check refuses it
   because the Benefit Summary's page 1 *names* the scheme's Outpatient Medicare Policy (OPMC) in its list of group policies.
   That same page says "A Benefit is only applicable to you if the Policy containing the Benefit is specifically stated in
   Part 1", and Daniel's Part 1 (his certificate) does not list OPMC. The refusal tells the model to "say what those lines
   print"; the model has no way to say "the scheme has an OPMC policy, but your certificate does not list it" that the
   composer accepts, so it falls back to an uncited sentence, which is dropped.
2. **Composer**: correct to drop the uncited absence (variant C).
3. **Grounded fallback** (`lib/rag2/loop/loop.ts`, the reported-bill note): its wording "I haven't yet looked up" is untrue when
   the turn did search (search_passages ran); it should say the documents read do not print a benefit for the bill.

Not the cause: retrieval (the search ran and found the accident pages), benefit records (`person_benefits` ran), or a
fallback suppressing supported terms (no benefit for a GP bill is printed in this reconstruction, so there was nothing to
suppress). Whether DC's real library prints one (for example an Outpatient Medicare or shield plan on his own certificate) is
unknown without the saved trace of that conversation.

## Read-in-full refusal (C2)

It does not cause this and does not change it: the term hit is found first, so the refusal is the same on C2. Where the term
is absent and part of a document is not stored, C2 now says which pages were read instead of the bare "couldn't confirm".

## Does C2 cover it?

No. Proposed repair, for the Critic before any change:

- **G1** (absence-scope): when every hit of a `benefit_not_found` over a person's documents is in a line that names a group
  policy which that person's own certificate (Part 1) does not list, the server writes the statement itself: the policies the
  certificate lists, that none of their pages describes the topic, and that the scheme document also names that policy, which
  the certificate does not list (cited). No amount, no "not covered".
- **G2** (fallback wording): "I haven't yet looked up" only when no search ran this turn; otherwise "The pages I read do not
  print a benefit for the bill you mentioned (...)", plus the insurer contact step.

To confirm which variant the live model took, the saved trace of that one conversation (tool calls and drop reasons) would
need to be read in production, read-only. That needs DC's permission.

## Implemented in C2 (`98ada99`), after Critic round 4 and Policy QC's ruling

- **G1** (`absence-scope.ts`): a hit sitting in a scheme document's own list of its group policies (a sentence naming three or more
  policies with their abbreviations) is set aside only when the person's certificate is read in full, lists neither the policy's full
  name nor its abbreviation, prints one "As of" date, and no medical-expense wording ("medical expenses", "medical reimbursement",
  "medical treatment", "outpatient", "clinic", "general practitioner", "consultation", ...) is printed anywhere else in the scope. The
  server then says what the certificate lists (dated), that the scheme document names that policy, which the certificate does not list,
  and that the insurer or administrator confirms current cover; the absence (or what was read of a partly stored scope) follows as
  before. No exclusion claim; the Part 1 applicability clause is not quoted. Any other hit refuses as before.
- **Repeat refusal**: when the model sends the same refused absence again, the server replaces it with the lines the documents print,
  quoted and cited (medical-expense wording first). Inside such a quote the insurer's own words ("we will reimburse") are not read as
  the answer calling an amount a payout.
- **G2** (`loop.ts` grounded fallback): after a search for the bill ran this turn, a GP / clinic / outpatient bill is checked by the
  server itself (absence with G1, partial, or the printed lines); any other bill gets "The pages I read do not print a benefit for the
  bill you mentioned (“...”)" instead of "I haven't yet looked up". The household's words are quoted unchanged.

Results on `98ada99` (scripted, no spend): GP group AC 9/9, GUARD 13/13; full acceptance AC 20/26 (the 6 open are the known R1, R2,
R3, R7, R9 and N5b), GUARD 41/41; fx-repairs 89/89, absence-scope 32/32, structured-answers 123/123 + 8/8, tools 38/38, env-contract
green.

Not done by the server (depends on the model): QC's expected answer also names the conditional accident benefits (ambulance to hospital,
the 24-hour hospital stay, fracture) and that Living Care is not described. The server adds neither; a live run is needed to see
whether the model states them. The quoted "$" amount inside a printed line is annotated by the existing currency-silence rule
("printed with a “$” sign"), which changes the quote's text.

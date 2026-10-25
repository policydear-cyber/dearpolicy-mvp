# Developer: DC's live GP-bill answer (20 Oct 2026), trace and reconstruction

Reported: DC's screenshot from production (main `4956588`, C0) for "raymond tripped over the kerb and fell, his GP bill is
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

## C3 (`1766863`): Critic round 5 and UX regressions

- **F1**: a scheme's own list of its group policies is never quoted as medical-expense wording (only the person's documents' other lines).
- **A2**: the scheme-listing case reads only the product headings followed by a row for this person (their full name in the row) and
  only those rows' dates.
- **A3**: "doctor", "physician", "medical practitioner" and "charges / fees / bills / costs" near a medical word count as medical-expense
  wording; any such line in the person's documents refuses the absence and is quoted instead.
- **F2**: after a refused check the GP note says "I could not confirm from your documents what pays for the bill you mentioned", never
  that the pages do not print one.
- **F3**: the partial-scope statement is added only when it is about the answer's own subject.
- **F4** (confirmed, no change): a quoted line with a bare "$" is still marked "printed with a “$” sign; the document does not say which
  currency" (GP replay: the quoted medical-expenses line "up to 2,000 (printed with a “$” sign ...)").
- **A1**: the "too / also" block was removed from person corrections; only an explicit correction moves facts.
- **UX FX-K4B**: a cited reason from another benefit's section is now caught before the question card is built (the card asked about the
  X-ray because a shifted replay id pointed at the mobility-aid passage). The correction line is back in turn 2.
- **UX FX-K6B**: the server's partial-scope statement replaces "I couldn't confirm an answer to that from your documents".

Results on C3 (scripted, no spend): GP group AC 12/12, GUARD 16/16; full acceptance AC 20/26 (same 6 open: R1, R2, R3, R7, R9, N5b),
GUARD 41/41.

## Live re-ask after PR #61 (main `ca6af69`, ~08:24): why the fix did not show

Reconstructed in `gp-bill-live-repro.ts` (anonymised fixture plus two invented Product Summary pages: an overseas emergency
outpatient clause on page 20, a panel GP benefit on page 25; no production data read). It reproduces all three live symptoms.

- **"You told me tripped on the kerb."**: `sayBack` (compose.ts) ran words with no subject of their own straight after "You told
  me". Predates PR #61. Now quoted: “You told me: “tripped on the kerb”.”
- **The overseas clause**: the G2 path did run. Its absence check was refused (the library prints "outpatient"), and the server quoted
  the first two printed lines in page order: the overseas clause and its own heading. Nothing ranked a line limited to treatment abroad
  after the others. Now: lines limited to treatment outside Singapore / overseas / abroad go last, bare all-capitals headings just before
  them, and a line already inside another chosen line of the same page is not quoted twice.
- **No panel GP benefit**: "GP" (two letters) is dropped by the term filter, so a panel GP line was never searched for by name, and the
  overseas lines filled both quote slots. G2 now also searches "panel gp", "gp clinic" and "gp consultation".

Reconstruction after the fix: the answer quotes the panel GP line (page 25), not the overseas clause. Not done by the server: asking
whether a panel GP was seen (depends on the model).

### PR #64 second commit: Policy Evidence Reviewer 12.1-12.2, Critic R10-1 to R10-4

- **Whose cover (12.1, R10-1, R10-3)**: when a quoted line is not from the person's own confirmed certificate and its page does not name
  them, the server's note after the quote says what their certificate lists (dated), any scheme policy the scheme's list names that the
  certificate does not list (G1's facts, kept), the heading the line sits under (and that the certificate does not list it, when the heading
  names a policy), and that only the insurer or the scheme administrator can confirm whether it applies to them.
- **Where the bill was (12.2, R10-2)**: G2 passes the place the household gave (abroad, home, or not said). A line that pays only for
  treatment abroad ("in Singapore or overseas" is not abroad-only) is quoted only when the bill was placed abroad. Otherwise it is said
  apart, as applying only if the treatment was abroad (when the place was not said, or when nothing else is printed). The ranking runs only
  on this bill path, not on other refusals.
- **Headings (R10-4)**: a short heading ("Panel GP Benefit") is not quoted beside a line of its own.
- The "$30 per visit" stays inside the quote, marked as printed with a bare "$"; nothing ties it to the $800 bill and nothing is computed.

`gp-bill-live-repro.ts` now runs three cases: place not said, the bill in Bangkok, and the panel GP line under an "OUTPATIENT MEDICARE
POLICY" heading. The original fixture (`gp-bill-reconstruction.ts` variant C) is unchanged: G1 still states the certificate and OPMC.

### PR #64 third commit: Critic round 11 (R11-1 to R11-4), Evidence Reviewer 13

- **R11-1**: "which that certificate does not list" is said only when none of the products on the person's own rows shares a distinctive
  word with the policy name (Group / Policy / Plan / Benefit / Insurance / Scheme ignored) or is its abbreviation. A section heading
  gives a policy name only from an explicit "... POLICY" phrase, and only when the scheme's own list gives its abbreviation; otherwise
  nothing is said about listing. G1's scheme sentence uses the same word check. Cases E ("GROUP OUTPATIENT MEDICARE") and E2
  ("GROUP OPMC") on Daniel's rows: no "does not list".
- **R11-2**: a bill is abroad only on explicit words in the current message (overseas, abroad, on holiday, travelling, a trip);
  "a GP in Tampines" and "fell in Grace's room" are "not said".
- **R11-3**: the whose-cover note is the first note, directly under the server's quote, and only when that quote survived composing.
- **R11-4**: "The only line found for this is in the X (page N), and it pays only for treatment outside Singapore, ..."; never
  "Policy Policy" (G1's sentence too, R6-4).
- **Evidence Reviewer 13**: the note names the benefit printed just above the line ("under “Panel GP Benefit”") and its section.

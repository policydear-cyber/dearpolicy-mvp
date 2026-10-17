# PR #54 follow-up: applicability, who resolves a requirement, enrolment caveats — expectations

These expectations were written before the repair. The prior tested head was `2077c6e`, with product code `523efea`. The
earlier live results (rc-live-1 … rc-live-5) stay unchanged.

## 1. Benefit applicability from the policy's own definitions

The server reads each benefit's definition from the same uploaded document and version. The definition is the
document's own `<Benefit> means …` sentence, cited.

The definition is compared with what the household reported, one observable attribute at a time. The only attribute in
scope is whether a fracture was closed or open (the skin broken). This is a vocabulary for the household's words; the
policy decides what each value means. The result is one of:

- **consistent**: the definition fits what was reported.
- **inconsistent**: the report contradicts the definition. No calculation is made, no clarification is created and no
  question is asked about the benefit. The evaluation says which definition and which report disagree. A previous
  illustration of that benefit is withdrawn.
- **unresolved**: the definition turns on an attribute the household has not reported. One household question is asked
  for that attribute, with the definition as the reason.
- A benefit with no definition in its document, or one that constrains no known attribute, is evaluated as before.

None of these is an insurer decision; each states only how the document's wording relates to the household's report.

### Booklet household (anonymised fixture)

- **Closed hip** ("hip, possibly tibia; closed", then "it is his hip"):
  - Simple Fracture is consistent. Turn 1 asks one case question, with no amount; turn 2 gives S$3,750.
  - Other Fracture is inconsistent: no S$225,000, no requirement and no Other Fracture question, in either turn.
- **Open hip**: Other Fracture is consistent and gives S$225,000. Simple Fracture is inconsistent: no S$3,750 and no
  question.
- **Unspecified** ("broke his hip"): Simple Fracture and Other Fracture are both unresolved. One question asks whether
  the fracture was closed or open (a household fact), with no amount.
  - The answer "closed" gives S$3,750 and no Other Fracture question.
- **Corrected** (closed → "actually it was an open fracture"):
  - The S$3,750 illustration is withdrawn and the answer says so.
  - Simple Fracture becomes inconsistent and Other Fracture gives S$225,000.
  - This holds whether the correction is recorded under the same fact key or another one.

### A second policy with different definitions (`BOOKLET_DEFS=alt`)

The alternative definitions are:

- Simple Fracture means any fracture, whether open or closed.
- Other Fracture means an open (compound) fracture.

Expected outcomes:

- **Closed**: Simple Fracture is consistent and Other Fracture is inconsistent.
- **Open**: both are consistent; neither is withdrawn because of the word "open".

No universal closed/open rule is applied.

## 2. Household questions versus insurer decisions

Every requirement records who resolves it:

- **household**: a reported or observable fact, such as which bone, closed or open, dates, how it happened, or what the
  doctor said;
- **insurer**: an assessment or approval, such as whether a diagnosis meets a definition, or acceptance of the claim.

`ask_user` asks only household requirements. Enforcement is at the requirement and `ask_user` boundary, not by prompt
wording:

- A requirement whose resolver is the insurer is refused, and its condition is stated instead.
- A free-form fact question whose subject is an assessment of the policy terms is classified as insurer and refused,
  with the supported information kept.
- When the model words a server requirement as an assessment, the server asks the requirement's own household question
  instead.

**BKL1a and BKL1b replay** (the saved live calls, no model): after "hip", the answer shows the conditional S$3,750. It
ends without an Other Fracture question and without any pending question.

## 3. Enrolment and uncertainty statements

A negative or uncertain statement about a person's enrolment, cover or listing is checked against that person's
certificate evidence:

- **The person is listed** on a current certificate of this household: the statement is replaced by the dated fact,
  "<certificate> lists <name> under <product> as of <date>", and the answer adds that this alone does not establish
  cover on a later date.
- **The person is absent** (no row for them): the statement is kept.
- **A dated limitation** ("cover on the date of death is not established") is kept.
- **Another person's certificate** (another household, or another member's row) never counts as listing them.
- **A paragraph benefit** (the Compassionate Death Allowance) keeps its product scope from the booklet's own section
  headings, not from document titles.

**BKL3 replay**: no "do not confirm Daniel's enrolment". The answer keeps the allowance, its conditions and the bare-$
amount.

## Unchanged

- Latency: the number of model steps for the replayed turns does not increase.
- The ownership, product, currency, version and calculation safeguards, and every existing suite.
- The prior live results and ledger entries.
- Cost admission and the US$0.15 trial reservation.

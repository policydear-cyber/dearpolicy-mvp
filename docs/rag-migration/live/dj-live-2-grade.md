# dj-live-2 grade (original graders, unchanged)

Live-tested SHA: `605f677d25428d29055897fdfc5b5336029ad9fd` (actual model `openai:gpt-6-luna`, dedicated test connection, run once, no repeat). Graders: death-v1 for D1, D2, D3, F1 (frozen before dj-live-1); `gradeIllness` for DI (frozen in the dj-live-2 addendum before any call). Grades are the grader's literal output; `dj-live-2-regrade.md` is a separate reading and changes none of them.

| case | original grade (death-v1 / DI) | failed checks | model calls | total s | model s | application s | cost | tokens in+out |
|---|---|---|---|---|---|---|---|---|
| D1 | FAIL | A6 | 5 | 23.6 | 22.2 | 1.4 | US$0.00271 | 62648+1133 |
| D2 | FAIL | A6 | 4 | 13.5 | 11.8 | 1.6 | US$0.00158 | 46713+618 |
| D3 | FAIL | G1,A6 | 4 | 17.3 | 15.8 | 1.5 | US$0.00320 | 46074+1213 |
| F1 | FAIL | F3 | 4 | 13.9 | 12.5 | 1.4 | US$0.00158 | 43983+729 |
| DI | FAIL | G2,I1,I2 | 4 | 19.8 | 18.4 | 1.4 | US$0.00211 | 52069+1405 |

Cost US$0.011186 over 21 calls (ledger entry dj-live-2). Application s = total minus model time (retrieval, tools, verification, save).

## Complete visible answers

### D1
- Daniel’s Scheme X Group Insurance certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; the group wording says the death benefit is 100% of the Sum Assured if death occurs while the insured person is covered, and defines that sum as the amount on the certificate, but the uploaded documents do not establish cover on a later date or the amount payable now.
- Daniel’s certificate also lists Group Personal Accident of S$600,000 as of 6 October 2022, while the accident wording says Accidental Death pays 100% of the Sum Insured if bodily injury from an accident results in death within 365 days; the documents do not establish that this condition applies to a particular death or confirm current cover.
- Daniel's certificate lists Daniel under Group Term Life and Group Personal Accident as of 06/10/2022.
- The uploaded documents do not state who the beneficiary is, the claim deadline or the full claim paperwork for the Group Term Life benefit.
- The Group Insurance Product Summary (page 13) prints the Compassionate Death Allowance Benefit, up to S$2,000, with the printed condition “This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.”.
- The Group Insurance Product Summary (page 13) prints Death due to natural catastrophe: 15%.
- The Group Insurance Benefits Booklet (page 9, under “Section 5 - Compassionate Death Allowance Benefit”) prints the Compassionate Death Allowance Benefit for the funeral expenses incurred, up to 2,000 (printed with a bare “$” sign; the Group Insurance Benefits Booklet does not say which currency), with the printed conditions “If an Insured Person dies as a result of an Accident”, “on receipt of proof of death and the relevant documents in our prescribed form” and “This Benefit can only be claimed either under the Core Scheme or the Voluntary Scheme.”.
- Compassionate Death Allowance Benefit is printed as accident-only (printed condition: “If an Insured Person dies as a result of an Accident”); this applies only to a death caused by an Accident, and an accident is not assumed here.
- Group Personal Accident is printed as accident-only; this applies only to a death caused by an Accident, and an accident is not assumed here.
- Accidental Death is printed as accident-only and Death due to natural catastrophe is printed for a natural catastrophe; these apply only to a death caused by an Accident, and an accident is not assumed here.
- A dated certificate shows who it listed on that date; it does not by itself establish cover on a later date.
- Next step: Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.

### D2
- Daniel’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; the Group Term Life wording says 100% of the certificate’s Sum Assured is payable if death occurs while the insured person is covered under the Scheme, but the uploaded documents do not establish cover on a later date or confirm a claim payment.
- The Group Insurance Product Summary also describes Accidental Death as 100% of the Sum Insured if an accident-related bodily injury results in death within 365 days, but Daniel’s certificate amount is dated 6 October 2022 and the documents do not establish that this amount or cover remains current.
- The uploaded documents do not establish who would receive any benefit or provide a complete claim-submission process.
- Daniel's certificate lists Group Personal Accident of S$600,000 as of 6 October 2022.
- The Group Insurance Product Summary (page 13) prints the Compassionate Death Allowance Benefit, up to S$2,000, with the printed condition “This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.”.
- The Group Insurance Product Summary (page 13) prints Death due to natural catastrophe: 15%.
- The Group Insurance Benefits Booklet (page 9, under “Section 5 - Compassionate Death Allowance Benefit”) prints the Compassionate Death Allowance Benefit for the funeral expenses incurred, up to 2,000 (printed with a bare “$” sign; the Group Insurance Benefits Booklet does not say which currency), with the printed conditions “If an Insured Person dies as a result of an Accident”, “on receipt of proof of death and the relevant documents in our prescribed form” and “This Benefit can only be claimed either under the Core Scheme or the Voluntary Scheme.”.
- Compassionate Death Allowance Benefit is printed as accident-only (printed condition: “If an Insured Person dies as a result of an Accident”); this applies only to a death caused by an Accident, and an accident is not assumed here.
- Group Personal Accident is printed as accident-only; this applies only to a death caused by an Accident, and an accident is not assumed here.
- Accidental Death is printed as accident-only and Death due to natural catastrophe is printed for a natural catastrophe; these apply only to a death caused by an Accident, and an accident is not assumed here.
- Next step: Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.

### D3
- Daniel’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; the Group Insurance Product Summary says this benefit is 100% of the Sum Assured and requires death while insured under the scheme, so the uploaded documents do not establish the amount or whether that condition was met on the date of death.
- Daniel’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, and the reference wording lists Accidental Death at 100% of Sum Insured; the certificate does not establish that this amount or cover remained in force last week.
- The Group Insurance Benefits Booklet (page 9, under “Section 5 - Compassionate Death Allowance Benefit”) prints the Compassionate Death Allowance Benefit for the funeral expenses incurred, up to 2,000 (printed with a bare “$” sign; the Group Insurance Benefits Booklet does not say which currency), with the printed conditions “If an Insured Person dies as a result of an Accident”, “on receipt of proof of death and the relevant documents in our prescribed form” and “This Benefit can only be claimed either under the Core Scheme or the Voluntary Scheme.”.
- The uploaded documents do not confirm Daniel’s enrolment in the Core or Voluntary Scheme, so they do not establish whether the Compassionate Death Allowance applies to him.
- Daniel's certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.
- Daniel's certificate lists Group Personal Accident of S$600,000 as of 6 October 2022.
- The Group Insurance Product Summary (page 12) prints Accidental Death: 100%.
- The Group Insurance Product Summary (page 13) prints the Compassionate Death Allowance Benefit, up to S$2,000, with the printed condition “This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.”.
- The Group Insurance Product Summary (page 13) prints Death due to natural catastrophe: 15%.
- I did not read a claims procedure for a death claim (how to notify the insurer, or which documents it asks for) in the part of the documents I could look at before this question's model-use limit, so none is listed beyond what each benefit above prints; the insurer can confirm what it needs.
- Next step: Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.

### F1
- If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
- The Group Insurance Product Summary says the benefit applies when bodily injury from an accident results in a listed Simple Fracture, and its schedule lists Hip at 75% of S$5,000 (page 13).
- Daniel’s certificate lists Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000 as of 6 October 2022, while the summary describes accidental death as 100% of the Sum Insured; these dated figures do not confirm current cover.
- The Group Insurance Product Summary lists Simple Fracture (page 13) separately from the death benefits (Accidental Death, Compassionate Death Allowance and Death due to natural catastrophe), each with its own printed terms; the passages I read do not say whether they can be paid for the same event, so that is not established and no total is given.
- Next step: Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.

### DI
- The Group Insurance Product Summary says Group Term Life pays 100% of the Sum Assured for death or terminal illness, provided death occurs while the insured person is covered, and defines the Sum Assured as the amount on the person’s certificate. [Page 12]
- The Group Insurance Product Summary describes Accidental Death as a separate benefit, and the Compassionate Death Allowance wording applies only when death results from an accident; based on what you told me, those accident-related terms do not match Daniel’s reported death. [Pages 12, 9]
- Suggested next step: contact the employer or scheme administrator and Aldermoor Life Ltd to confirm cover on the date of death, the beneficiary/claimant process, and the required claim documents; the uploaded documents do not set out that process.
- For a death reported as an illness, Compassionate Death Allowance Benefit is printed as accident-only (printed condition: “If an Insured Person dies as a result of an Accident”), so it does not fit that report and no amount is given for it.
- For a death reported as an illness, Group Personal Accident is printed as accident-only, so it does not fit that report and no amount is given for it.
- For a death reported as an illness, Accidental Death is printed as accident-only and Death due to natural catastrophe is printed for a natural catastrophe, so they do not fit that report and no amount is given for them.
- You told me: “Daniel passed away last week”.
- You told me after a long illness.
- You told me it was not an accident.
- Scheme X Group Insurance - Certificate lists Daniel's Group Personal Accident as S$600,000 as of 6 October 2022; the schedule's percentages are of that sum insured.
- Next step: Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.

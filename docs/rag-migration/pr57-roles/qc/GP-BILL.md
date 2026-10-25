# Policy QC: the GP-bill question, expected answer from the source pages

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Policy QC | verify the Developer's GP-bill reading; derive the expected answer | `720f5f5` (integration branch; fixture page text identical to C0/C1) | done | this file | DC's real library not read: this rules on the anonymised household only |

Question (DC, live): "raymond tripped over the kerb and fell, his GP bill is $800, can he claim for this?" The reconstruction uses the anonymised
fracture household (`scripts/fixtures/reliable-chat/fracture-conversation.ts`), where Daniel stands in for Raymond. The page text there is unchanged
from C0. `720f5f5` only adds `pageCount` (CERT 1, Product Summary 37, Benefit Summary unknown).

## The Developer's claims, checked against the pages

| claim (GP-BILL.md) | verdict | pages |
| --- | --- | --- |
| BS p1 names an Outpatient Medicare Policy (OPMC) | **True**: "Part 2: Highlights of the insurance cover provided under the Group Term Life ... Disability Income Policy ("DI"), and Outpatient Medicare Policy ("OPMC")" | BS p1 |
| BS p1 says a benefit applies only if its policy is listed on the certificate | **True**: "Not all Group Policies or Benefits described in Part 2 of this Certificate will apply to you. A Benefit is only applicable to you if the Policy containing the Benefit is specifically stated in Part 1 of this Certificate." Linking CERT p1 to "Part 1" is an inference, but a sound one: BS p1 says Part 1 holds the particulars, policy, Sum Insured and effective date, which is exactly what CERT p1 prints | BS p1, CERT p1 |
| His certificate does not list OPMC | **True**: Daniel's rows are Group Term Life S$1,000,000, Group Personal Accident S$600,000, Group Living Care S$350,000 and Group Living Care Plus S$300,000, each "As of 06/10/2022". No OPMC, and no DI either | CERT p1 |
| None of his listed policies describes GP bills | **True only as "no stored page describes one"; too strong as worded.** (a) No stored page describes Group Living Care or Living Care Plus at all, so they are *undescribed*, not shown to exclude GP bills. (b) The stored pages are partial: the Product Summary has 4 of its 37 pages, and the Benefit Summary 6 of an unknown total. Its lettered sections skip from H (p8) to J (p9), so section I and Benefit 2 parts A to C are not stored. (c) BS p1 says the scheme has a Core Scheme besides the Voluntary Scheme that the certificate is issued under; Core cover is not in these documents | all |

## Accident benefits on his listed policies: relevance to a fall with a GP visit

The stored pages print **no accidental medical expenses or outpatient reimbursement benefit**. The Group Personal Accident key-features list (PS p8)
names fracture cover, ambulance reimbursement, TPD at 150% and 24/7 cover, and no medical-expense reimbursement. The benefit list on PS p13 and
BS p7 to p9 has none either. What each printed accident benefit needs, against what was reported (a fall and a GP visit):

| benefit | printed condition | relevant to a GP bill? | pages |
| --- | --- | --- | --- |
| Ambulance Cost | actual ground ambulance costs "for transportation (including the medical supplies used) to the Hospital", per event, up to **$500** (BS, bare $) / **S$500 per incident** (PS); claim under Core or Voluntary only | No for a GP bill. Only if an ambulance took him to hospital, which was not reported | BS p8, PS p13 |
| Accidental Hospital Recuperation | confined in hospital for at least 24 continuous hours within 30 days of the accident; one-time **$250** (BS) / **S$250** (PS) | No for a GP visit. Only if he was then admitted for 24 hours or more | BS p9, PS p13 |
| Simple Fracture (PS) / Simple or Other Fracture (BS) | a fracture of a listed kind caused by the accident | Only if the fall caused a fracture, which was not reported. Then the two documented alternatives apply, never added | PS p13, BS p8 |
| Injury due to Accident | non-union leg fracture, leg shortening, third-degree burns | No | BS p7 |
| Group Term Life | death or terminal illness | No | BS p3 |

## Expected answer (what a correct, complete reply says)

1. In the documents uploaded, none of Daniel's listed cover prints a benefit that pays a GP or outpatient bill. His certificate lists Group Term Life,
   Group Personal Accident, Group Living Care and Group Living Care Plus, as of 6 Oct 2022 (CERT p1). This is not a statement that he is "not
   covered". Missing wording is not an exclusion.
2. The scheme document also names an Outpatient Medicare Policy, but his certificate does not list it, and the document says a benefit applies only
   if its policy is listed on the certificate (BS p1, cited). Say it as what is printed, not as a verdict on his cover.
3. His Personal Accident cover prints benefits for specific results of an accident, none of them a GP bill: an ambulance to hospital (up to S$500 per
   incident, PS p13), a hospital stay of at least 24 hours (S$250 one-time, PS p13), and a fracture (the two alternatives). These apply only if one
   of those happened. Stating them conditionally keeps the documented benefits visible. At most one question, for example whether the fall caused a
   fracture or a hospital stay, and only if the answer would change something.
4. Group Living Care and Living Care Plus are listed, but no uploaded page describes them, and only part of the Product Summary and the Benefit
   Summary is stored. So whether any of his cover pays outpatient bills is not shown either way.
5. No amount, and nothing computed from "$800" (the household's bare "$" stays the household's figure).
6. Next step: ask Aldermoor, through the scheme administrator, whether Daniel holds outpatient cover (OPMC or Core Scheme cover) and what Living
   Care covers.

**Must not:** "not covered" / "excluded"; "I haven't yet looked up" after a search ran (the Developer's G2); any amount for the GP bill; the S$250 or
S$500 shown as payable for this visit; "none of his policies covers GP bills" as a statement about Living Care.

## On the Developer's proposed repair

- **G1** is right in direction. Its server-written statement must not say "none of their pages describes the topic" for Living Care / Living Care Plus,
  which have no pages. Say they are listed but not described, and keep the partial-storage scope (C2's "pages read" wording). It should also keep
  the conditional accident benefits (item 3); otherwise an absence-only answer hides documented benefits.
- **G2** is supported: after a search, "I haven't yet looked up" is untrue.
- The live answer ("I couldn't confirm an answer ...", "I haven't yet looked up ...") hides nothing that pays a GP bill. It does fail the contract,
  though: it does not state the documented accident benefits and their conditions, or the OPMC point.
- This rules on the anonymised household only. Whether DC's real certificate lists OPMC or other outpatient cover is unknown without his real
  documents, which need his permission to read.

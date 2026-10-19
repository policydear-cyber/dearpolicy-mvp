# fx-live-1: independent review of the expected facts, and how each difference was settled

Status: **settled before any generated answer for K1, K2, K4a, K4b, K6a or K6b was inspected** (K3 is regression data; see the
pre-registration `EXPECTED-fracture-usefulness.md`). The pre-registration is NOT rewritten: it stays as written. This file records
what a fresh reviewer, given ONLY the rendered pages of the anonymised fixture and the questions, expected; where it differs from the
pre-registration, and what the graders (`scripts/rag2-live/usefulness-check.ts`, grader v1) do about it. Each decision below was made
now, before any live result exists.

Reviewer protocol: the reviewer saw the rendered pages (certificate p1; Product Summary p8, p12, p13, p37; Benefit Summary p1, p3, p5,
p7, p8, p9) and the eight questions, nothing else (no code, no pre-registration, no generated answer).

## Where the two agree (the gating checks)

| case | agreed content |
|---|---|
| K1 | Grace's Group Personal Accident S$600,000 from her certificate row; not S$1,000,000 / S$350,000 / S$300,000 / S$5,000; no question |
| K2 | sickness is not an accident: the accident hospital benefit (S$250) and every accident benefit do not apply to what was described; the pages say nothing about a sickness hospital benefit; no question |
| K3 | two documented figures with their own rows and bases (25% of S$5,000 = S$1,250; 20% of S$600,000 = S$120,000); no total; no X-ray / practitioner certificate requirement (no page prints one); not an approved payment; turn 2 acknowledges the report and changes no amount |
| K4a | leg row: 50% of S$5,000 = S$2,500 (summary) and 50% of S$600,000 = S$300,000 (certificate highlights); the arm figures are dropped; S$120,000 is NOT the leg amount; no total |
| K4b | Daniel is the injured person, his own S$600,000 line; both alternatives; Grace is not the subject |
| K6a | Group Living Care S$350,000 is printed for Grace; no page describes what it pays; cancer is not established as covered; no invented condition |
| K6b | no dental benefit is shown in the supplied pages; absence is not an exclusion |

## Differences, and the decision for each

| # | difference | reviewer | pre-registration | decision |
|---|---|---|---|---|
| D1 | **Which K3 figure leads.** The reviewer would lead with the certificate-highlights figure (S$120,000), because the Product Summary (July 2021) says the precise terms are in the certificate, and say why it leads | lead with S$120,000 and say why | present the two as alternatives; neither "prevails"; the documents do not settle which applies | **Pre-registration kept.** The task forbids silently choosing one, and the certificate highlights say they are "not a contract of insurance" and defer to a Group Policy that is not supplied, so "the certificate controls" is not established by the wording. The reviewer's reasoning is shown to the reader as the documents' own cited sentences (summary defers to the certificate; certificate is not the contract). The grader does NOT score order. Whether to lead with the certificate figure is an owner product decision, listed in the PR as such, not decided here. |
| D2 | K1 date format | quote "06/10/2022" as printed; day/month order is ambiguous | "6 October 2022" | Grader accepts either the printed form or the day-first reading. The application's day-first reading of the certificate's date cell is the existing, pre-PR behaviour (Singapore documents); recorded as a limitation. |
| D3 | K1 extras | death 100%, fixed amounts, TPD 150% | none | Not gating (SHOULD). A direct question about the amount is answered by the amount. |
| D4 | K1 citation | her figure comes from the certificate (p1), not the Product Summary's "maximum coverage of S$600,000" | cited to the certificate | **Adopted** as a check: the figure's citation includes the certificate. |
| D5 | K1 currency of cover | no end date: "currently in force" is not proven | printed date, not later cover | Same content; grader fails an answer that says she IS covered today without the date. |
| D6 | K2 next step | offer the insurer hotline | none | Not gating: the contract asks for a next step "when requested". Recorded SHOULD. |
| D7 | K2 S$250 multiples | no multiple of S$250 or of days | no S$250 as payable | **Adopted**: any S$250 / S$750 amount presented as payable fails. |
| D8 | K3 side benefits | ambulance (S$500) and 24-hour hospital (S$250) as conditional extras; payment goes to the Insured Person; contract wording not supplied | none | SHOULD only, never gating, and never an unsolicited question that gates the main answer. |
| D9 | K3 optional question | one optional question (ambulance / 24 hours) that must not gate | none required | Grader: any question is allowed only if the main answer is already given; a question asking for an X-ray / medical certificate fails. |
| D10 | K4a extras | hip is its own row (75%); toe/foot excluded (summary footnote); the "established non-union" row (20% = S$120,000) and the 5cm shortening row are separate conditional benefits whose interaction is unstated | S$120,000 must not be the leg-fracture amount | **Adopted**: a total such as S$420,000 or "S$300,000 + S$120,000" fails; the non-union row, if mentioned, must be named as a different benefit. Others SHOULD. |
| D11 | K6a | also forbids S$650,000 (350,000 + 300,000), and S$1,000,000 Term Life as a cancer payout | invented condition / "cancer is covered" | **Adopted** as additional MUST NOTs. |
| D12 | K6b wording | "on these pages routine dental treatment is not covered" but "say not shown, never definitively excluded" | never "excluded / not covered" as a policy term | Reconciled: acceptable = "no dental benefit is shown in the documents"; unacceptable = "excluded", or "not covered" without a documents/pages/shown/found qualifier. |
| D13 | Fixture | the certificate's footer and some lines still carried a real insurer's name and address (the anonymisation pattern had missed lines) | n/a | **Fixed**: the committed fixture is now already anonymised and refuses any residue. The expected facts are unaffected. |
| D14 | Reviewer observations with no expectation change | Core vs Voluntary Scheme (the certificate is for the Voluntary Scheme); the Benefit Summary letters skip from H to J (selected pages); the Product Summary's PDF page 13 is printed "Page 12 of 36"; the footers of two documents name different insurers (D13) | none | Recorded. "Selected pages" supports K6b (absence of dental is not proof of exclusion). Citations use the PDF page, as the household's own question did ("pages 8 and 13"). |

## What the review changed

- Graders v1 were written after this reconciliation and contain D2, D4, D5, D7, D9, D10, D11 and D12.
- Nothing in the product code was changed because of the review except D13 (test fixture only).
- D1 is the one substantive disagreement. It is reported, not resolved.

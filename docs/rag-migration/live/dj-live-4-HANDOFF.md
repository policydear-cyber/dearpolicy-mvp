# PR #56 final handoff (death journey, dj-live-4)

**Recommendation: READY FOR REVIEW with the limitations below. Not a release: do not merge or deploy until the actual-library check is done.** No correctness defect was found that justifies HOLD (section 4). The PR stays unmerged and draft until the owner decides otherwise.

## 1. Exact SHAs
* **Live-tested product code: `654121fbafe57df5211eb020c26e99115f3d1278`** (production build `OZC2202S9wm_BDkOcsn7m`, clean tree, manifest of 960 files verified before the run).
* `129fe3407c17c20f21cf238a907f60d01df9411a` = 654121f + one commit adding only results, ledger and docs (14 files), verified with the compare API. The head after this handoff commit also differs from 654121f in docs only (no source, test or workflow file).

## 2. dj-live-4 complete answer (DI, one attempt, outcome final_answer, no question)
User message: "Daniel passed away last week after a long illness - it was not an accident. What would the family receive from his insurance, and what should we do?"

```
Daniel’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; that dated amount is not confirmation of cover on the date he died.
The Group Insurance Product Summary says Group Term Life pays 100% of the Sum Assured for death or terminal illness, provided death occurs while the insured person is covered, and defines the Sum Assured as the amount on the person’s certificate.
Daniel's certificate lists Daniel under Group Term Life as of 06/10/2022.
The Compassionate Death Allowance wording applies to death as a result of an accident, so it does not fit the circumstances you described.
For a death reported as an illness, Compassionate Death Allowance Benefit is printed as accident-only (printed condition: “If an Insured Person dies as a result of an Accident”), so it does not fit that report and no amount is given for it.
For a death reported as an illness, Group Personal Accident is printed as accident-only, so it does not fit that report and no amount is given for it.
For a death reported as an illness, Accidental Death is printed as accident-only and Death due to natural catastrophe is printed for a natural catastrophe, so they do not fit that report and no amount is given for them.
Daniel's certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.
A dated certificate shows who it listed on that date; it does not by itself establish cover on a later date.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.
```

### Source bindings (saved citations)
| chunk | document | page | excerpt |
|---|---|---|---|
| rag2:e1 | Scheme X Group Insurance - Certificate (schedule) | p1 | S****411A Lee Wei Ming, Daniel S$1,000,000 As of 06/10/2022 |
| rag2:e18 | Group Insurance Product Summary (benefit_summary) | p12 | • Group Term Life: Death or Terminal Illness 100% of Sum Assured |
| rag2:e20 | Group Insurance Benefits Booklet (policy_wording) | p9 | If an Insured Person dies as a result of an Accident, we will pay the funeral expenses incurred, up to $2,000, |
| rag2:e28 | Group Personal Accident Benefit Summary (benefit_summary) | p8 | If an Insured Person sustains bodily injury as a result of an Accident, which necessitates the use of an ambulance, we will reimburse the actual |
| rag2:e3 | Group Insurance Product Summary (benefit_summary) | p12 | • Accidental Death 100% of Sum Insured |
| rag2:e8 | Group Insurance Product Summary (benefit_summary) | p13 | • Death due to natural catastrophe 15% of Sum Insured |

Figure bindings: both Term Life lines bind to the certificate row "Lee Wei Ming, Daniel  S$1,000,000  As of 06/10/2022" (Aldermoor Life Ltd, Scheme X Group Insurance - Certificate, p1, document hash sha256:al-cert-real, as of 2022-10-06). The Compassionate Death Allowance and accident-only lines are bound to the printed conditions (Benefits Booklet p9, PA Benefit Summary p8, Product Summary p12-13); the S$2,000 allowance figure and the Personal Accident S$600,000 row are not shown. The contact step names the insurer printed on Daniel's own certificate.

## 3. Original failures beside the new pass (death-v1 grader, unchanged)
| run | code | DI result | detail |
|---|---|---|---|
| dj-live-2 | earlier | FAIL (G2, I1, I2) | the same run also failed D3 (G1, A6) and F1 (F3) |
| dj-live-3 | f2fe6a6 | FAIL (I5, I6) | no visible next step; asked "What was Daniel's exact date of death?"; 65.5 s |
| **dj-live-4** | **654121f** | **PASS (G1-G7, I1-I7)** | dated Term Life, no PA amount, insurer step, no question; 31.8 s |

Only DI was rerun live. dj-live-2 D1/D2/D3/F1 were not re-confirmed live against the final code (offline suites cover them). The original grade files are unchanged.

## 4. The repeated Term Life lines and the allowance line (assessed, not repaired)
* The repeated Term Life lines carry the same amount, date and cited row with no conflict: **stylistic repetition only.**
* "The Compassionate Death Allowance wording applies to death as a result of an accident, so it does not fit the circumstances you described." It says the benefit does not fit an illness death and shows no amount, consistent with the following accident-only line. Clumsy and partly redundant, but applicability and meaning are unchanged: **stylistic only, so no HOLD.** Recorded; no repair cycle.

## 5. Final checks
* Typecheck; dj-live-3 replay 48/48 (date convention and boundaries, DI replay, controls); death-journey, death-live-repairs, death-cause, death-applicability suites; `security:ci-workflow-coverage-test` (all 137 required suites present in ci.yml) on the final code; production `next build`; browser DI3 and DIQ (open question visible beside the contact step, equal to saved and reopened).
* **Known baseline failure: `rag2:s52-replay` 11/12** (extra split sentence), pre-existing on baseline `81b1b07`; the same 11/12 on this code; not caused by this PR.

## 6. Spend (ledger reconciled, one append for dj-live-4)
dj-live-4: US$0.0021476, 3 calls, 0 refused, 0 failed (cap US$0.01); preflight dj-live-4-pre US$0. Exercise cap US$1.00 = US$0.505459 recorded spend (some earlier entries are labelled estimates) + **US$0.15 trial-codespace-1 reservation, untouched** + US$0.344541 remaining. No further paid runs. Relay stopped after the run.

## 7. Latency: target not met
31.8 s for the one DI turn against targets of 10 s (direct) and 20 s (ordinary scenario). The provider/proxy hop was 30.6 s of it (4.5 + 15.5 + 10.7 s over three sequential calls); the application's own share was about 1.2 s. One observation; no limit changed; not traced further.

## 8. Limitations and outstanding verification
* **Synthetic-only evidence**: one real-model attempt on the synthetic death-journey household, no consistency evidence (single attempt, no rerun by design). The model answered without asking this time, so the deferral note (the household's "last week", the message date, cover not established) was not exercised live; it is verified offline and in the browser only.
* **Actual-library verification is outstanding** (the owner's real uploaded documents), required before any release claim.
* The window for "last week" (6-18 Oct 2026) is an application-defined uncertainty envelope, not a calendar-week interpretation; it never establishes eligibility, calculates a deadline or confirms cover.
* No printed document establishes cover on the date of death; the contact step is a suggestion to ask the insurer, not a claims procedure.

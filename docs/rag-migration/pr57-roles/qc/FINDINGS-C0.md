# PR #57 follow-up: independent policy QC on candidate C0

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Policy QC | expected answers from source pages; compare afterwards | C0 `4956588a4e2cae948809e34d78d3b728a99a96ed` | done for C0; waits for C1 | this file | none |

`origin/main` was read as `4956588a4e2cae948809e34d78d3b728a99a96ed` on 2026-10-20 (`git fetch origin main`, `git rev-parse origin/main`), equal to C0.

## Method

Source: the anonymised fracture household, `scripts/fixtures/reliable-chat/fracture-conversation.ts` at C0. Pages cited below as
CERT p1 (certificate), PS p8/p12/p13/p37 (Product Summary, stored page index; printed page is one less, e.g. PS p13 prints "Page 12 of 36"),
BS p1/p3/p5/p7/p8/p9 (Benefit Summary, titled "Certificate of Insurance Part 2: Highlights of Cover").
Scenario wording from `fracture-script.ts`, `fx-repairs-scenarios.ts` and the K6c wording registered in `EXPECTED-fx-live-2.md`.
Expected answers were written from the pages first. Only then were they compared with `answers.json` of the fx-live-2 run (real model,
`c4edd48`; product code since changed only in `loop.ts` / `statement-render.ts`), the FR1 replay assertions, and `EXPECTED-fracture-usefulness.md`.
No build, test suite, DB or model call was run.

Facts used throughout (all CERT p1, each "As of 06/10/2022"): Grace and Daniel each hold Group Term Life S$1,000,000, Group Personal
Accident S$600,000, Group Living Care S$350,000, Group Living Care Plus S$300,000. BS p1: a benefit applies only if its policy is in Part 1;
the certificate "is not a contract of insurance"; Disability Income and Outpatient Medicare exist in the scheme but are NOT in either person's Part 1.
No stored page mentions dental, X-ray, a medical certificate for fractures, a definition of Simple / Other Fracture, or any Living Care terms.

## Expected answers (derived from pages only)

| scenario | expected answer | pages |
| --- | --- | --- |
| FR1 turn 1 / K3t1 "grace fell down and broke her arm" | Two alternatives, never added: (a) Simple Fracture, Arm/Elbow/Wrist/Ribs 25% of the fixed S$5,000 limit = **S$1,250**, with the `#` note (thumb, finger, palm not covered); (b) Simple or Other Fracture, Arm/Elbow/Wrist/Ribs **(Other Fracture)** 20% of Grace's GPA sum insured S$600,000 = **S$120,000**, dated 6 Oct 2022, and "can only be claimed either under the Core Scheme or Voluntary Scheme". Simple vs Other is undefined. Conditional on an accident; not a payment. No `^` (toe/foot) note. No X-ray question | PS p13, BS p8, CERT p1, PS p37, BS p1 |
| FR1 turn 2 "...confirmed by X-ray...: yes" | Same two figures; the confirmation is the household's report and changes nothing; no new question | as above |
| K2 sick, 3-day stay, "does her accident cover pay anything?" | No. The personal accident benefits are payable only upon an accident (PS p37); the hospital benefit needs bodily injury from an Accident (BS p9: S$250, within 30 days, at least 24 hours), so it does not apply to sickness. No amount. Her certificate also lists Group Living Care S$350,000 and Living Care Plus S$300,000, which no stored page describes, so whether they bear on the stay is not shown. No question | PS p37, BS p9, CERT p1 |
| K4b correction to Daniel | Daniel is the injured person; his own GPA S$600,000 (row S\*\*\*\*411A, 6 Oct 2022) is the base: S$1,250 and S$120,000, same framing; nothing for Grace is current | CERT p1, PS p13, BS p8 |
| K6a / K6c cancer, Group Living Care | Certificate lists Group Living Care S$350,000 as of 6 Oct 2022; no stored page says what it pays or how cancer is treated, so no payable amount can be stated; ask the insurer for the Living Care terms. Must not say "will pay S$350,000" | CERT p1 |
| K6b dental | None of the three documents' stored pages describes a dental benefit; that is not an exclusion. Outpatient Medicare is not in Grace's Part 1, so it does not apply to her | all pages, BS p1 |
| person correction semantics | Same as K4b; Grace's figures withdrawn, Daniel's recomputed from his own row | CERT p1 |

Arithmetic checked: 25% × 5,000 = 1,250; 20% × 600,000 = 120,000; no total (S$121,250) is ever valid.

## Comparison with the generated answers

No wrong claimable amount was found. Every figure in `answers.json` matches the pages and the arithmetic above, and is tied to the right person and date.

| # | severity | scenario | finding |
| --- | --- | --- | --- |
| Q1 | **High (amount risk, not shown wrong)** | K3t1, K4b, FR1 | The S$120,000 alternative is 96 times the S$1,250 one and is presented with equal weight. Two printed facts that bear on which applies are not said: BS p8 "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme" (directly under that row), and PS p8 is headed "VOLUNTARY SCHEME" while BS p1 says certificates are issued to members covered under the Voluntary Scheme. They do not settle it, so "do not establish which applies" stays defensible, but the S$120,000 row's own printed condition is omitted. Needs DC's judgement; an insurer check is the real resolution |
| Q2 | Medium (usefulness) | K2 | Answer covers only the Accidental Hospital Recuperation Benefit (it cites "page 9" without naming the document). It does not say the accident cover as a whole pays only upon an accident (PS p37), and omits Living Care / Living Care Plus being listed but undescribed (v1 `K2.3`, still open) |
| Q3 | Medium (test gap) | K4b | Grace and Daniel hold identical sums (S$600,000), so the K4b correction cannot show that Daniel's figures were recomputed rather than carried. The replay's B11 wrong-person control uses S$800,000, but in separate conversations, not the correction path. Suggest a correction case with differing sums (Test engineer) |
| Q4 | Low | K6a, K6c, K6b | K6a/K6c omit that Living Care Plus S$300,000 is also listed and equally undescribed. K6a scopes its absence to "The Scheme X Group Insurance" (one name) although three documents were checked. K6c "the policy definition" implies a definition exists (known) |
| Q5 | Low (fixture limit) | K6b | The fixture Product Summary holds 4 of its printed 36 pages, so an absence over "the product summary" is tested only over those pages. Correct for the fixture; says nothing about the actual library |
| Q6 | Low (clarity) | all | Page numbers are stored indexes; PS "page 13" prints "Page 12 of 36", so a user paging the PDF by printed number may not find the cited text |

## Disagreements with existing EXPECTED files

| file | item | disagreement |
| --- | --- | --- |
| `EXPECTED-fracture-usefulness.md` | source table, row B13 | Attributes "can only be claimed either under the Core Scheme or Voluntary Scheme" to the PS p13 Simple Fracture benefit. On PS p13 that note covers only the asterisked benefits (ambulance, mobility aid, home renovation, recuperation, child education, compassionate allowance); Simple Fracture has no asterisk. The sentence does apply to the BS p8 fracture benefit |
| `EXPECTED-fracture-usefulness.md` | K3 MUST | Does not require the BS p8 Core/Voluntary condition with the S$120,000 alternative (see Q1) |
| `EXPECTED-fx-live-2.md` | K3t1, K4b, K6a/c, K6b, K2 | Agrees with the derived figures, footnotes and dates; no disagreement on amounts |

## For C1

When the coordinator relays C1, reassess these scenarios on that exact commit: re-read the fixture pages if changed, re-check every figure,
and re-run this comparison against whatever answers the Test engineer produces at C1.

C1 checklist (the project's answer contract, relayed by the coordinator 2026-10-20): every benefit statement tied to the right person,
product, document role, version and date, row, conditions, footnotes, amount, currency and base; missing information is never stated as
an exclusion; an answer that unnecessarily hides a documented benefit fails like an unsupported amount. Under that contract Q1 (the
omitted BS p8 condition) and Q2 (the Living Care / Living Care Plus listing left out of K2) count as failures to re-check, not only usefulness gaps.

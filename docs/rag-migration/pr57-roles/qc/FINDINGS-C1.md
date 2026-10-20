# PR #57 follow-up: independent policy QC on candidate C1

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Policy QC | reassess C0 expected answers on C1; rule on K2 S$250 and the S$120,000 condition | C1 `8c63250cec7acb4e21fb41655a057f7ffc8ee65b` | done | this file; `FINDINGS-C0.md` | rendered C1 text not seen (see Method) |

C1 read as commit `8c63250cec7acb4e21fb41655a057f7ffc8ee65b` (`git rev-parse 8c63250`) from `origin/claude/pr57-followup-pgaq7d`, whose
head `9d3327e` adds only docs on top of it (`developer/C1.md`, `CANDIDATE.md`).

## Method

The source pages (`scripts/fixtures/reliable-chat/fracture-conversation.ts`) are unchanged between C0 and C1, so the C0 expected answers stand.
C1 was assessed by reading its product diff against C0 (`lib/rag2/calc/pct-rows.ts` `tableConditions`, `statement-render.ts`, `loop.ts`
cause path) and tracing it over the fixture pages by hand, plus the Developer's and Test engineer's recorded checks. QC ran no suite, build,
DB or model call (this container has no `node_modules`). The exact rendered C1 sentences should be confirmed from the Test engineer's C1 run.

## Ruling 1: the sickness hospital stay (K2) and the S$250

Pages: BS p9 "J, Accidental Hospital Recuperation Benefit": "if within 30 days following bodily injury as a result of an Accident ... confined
as a resident patient in a Hospital for a continuous period of at least 24 hours ... We will pay a one-time amount of **$250** per
hospitalisation. Subsequent hospitalisation resulting from the same injury will not be payable. This Benefit can only be claimed either under
the Core Scheme or Voluntary Scheme." PS p13: "Accidental Hospital Recuperation Benefit\* S$250" (asterisk: Core-or-Voluntary). PS p37: "The
benefits of a personal accident policy will only be payable upon an accident occurring."

**Ruling: showing the benefit's printed terms is supported by the wording and is not an unsupported amount, under these conditions.
The old expectation "no 250 anywhere" (fx-repairs C3, acceptance R6) is stricter than the policy requires and conflicts with the contract
rule that a documented benefit is not hidden. C1's verdict sentence for a pure sickness report goes too far the other way.**

1. **Allowed:** the benefit named with its document and page, the printed amount as the printed figure ("one-time ... per hospitalisation"),
   with its printed conditions together: bodily injury from an Accident, within 30 days, at least 24 hours continuous, the same-injury bar,
   Core-or-Voluntary. It must be said as the benefit's printed terms, never as an amount for this stay.
2. **Currency:** BS p9 prints a bare "$250". "S$250" is supported only if PS p13 is cited for it. If only BS p9 is cited, the figure must stay
   "250 with a bare $" (C1's `renderTerms` does this for a currency-less record). A BS-p9-only "S$250" fails the contract.
3. **Event eligibility, not the claim decision:** for a household that reported only sickness, the pages support saying that, on what was
   reported, the stay does not meet the benefit's accident condition (PS p37 and BS p9), while the claim decision stays with the insurer.
   C1's "whether its condition is met is for the insurer to decide" (loop.ts, `cause === "illness"` branch) presents a pure-sickness stay
   as an open question. The wording gives no basis for that, and beside a printed S$250 it reads as a possible payout. That is a misleading
   qualifier under the contract (distinguish event eligibility from the insurer's claim decision). Recommended sentence: "... is an illness,
   not an accident, so on what you have told me this benefit's accident condition is not met for this stay and its amount is not an estimate
   for it; any claim decision is the insurer's." The C1 "unresolved" branch (sickness and injury both reported) is right as written.
4. Still open from C0 Q2: the answer does not say that the accident cover as a whole is payable only upon an accident (PS p37), or that her
   certificate also lists Group Living Care S$350,000 and Living Care Plus S$300,000, which no stored page describes. Under the contract,
   leaving out listed cover that may bear on the stay is a hidden-benefit failure, not only a usefulness gap.

So: **C3/R6 should be revised to "the S$250 may appear only as printed terms with their conditions and the correct currency basis, never as an
amount for this stay"**, and the C1 illness sentence should keep "condition not met on what you told me" alongside "the insurer decides any claim".
Revising the tests is the Test engineer's work, and changing the sentence is the Developer's.

## Ruling 2: the S$120,000 and its Core-or-Voluntary condition

Traced `tableConditions` over the fixture pages:

| page | table | lines after the last percentage row | captured |
| --- | --- | --- | --- |
| BS p8 | Simple or Other Fracture (% of Sum Insured) | "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme." then "F.\tDisappearance" (tab ends it) | that one sentence: **correct**, it is the benefit's own printed condition |
| PS p13 | Simple Fracture (% of S$5,000) | `^` note, `#`, `#` note, then "•\tDisappearance" (bullet ends it) | nothing: **correct**. PS p13's "\*This Benefit can only be claimed..." belongs to the asterisked benefits only, and it is not attached to Simple Fracture |
| BS p7 | Injury due to Accident | footer "Aldermoor Life Ltd. ...", "Company Reg.No. ..." | nothing (no line ends a sentence): correct |

`calc/tool.ts` adds these to the row's notes and `rowNote` says them in the illustration's own sentence ("; under the table it prints: “...”").
**Confirmed from the code and pages: the S$120,000 alternative (BS p8, 20% of the person's S$600,000, 6 Oct 2022) now carries its printed
Core-or-Voluntary condition, attached to the right benefit, and the S$1,250 alternative correctly carries none.** Arithmetic unchanged.

Caveats:
- No executable check asserts it. No C1 test or fixture asserts "Core Scheme or Voluntary Scheme" in the S$120,000 illustration; the
  Developer's R1/R3 note shows it only indirectly. A positive check (BS p8 S$120,000 carries it) and a negative one (PS p13 S$1,250 does not)
  are needed (Test engineer).
- The rule takes any capitalised sentence directly under a table that ends in a full stop. A page footer that ends in a full stop would be
  read as a condition. It does not happen on these pages, but it should have a control.
- C0 Q1's other point stays open for DC's judgement, not a code defect: PS p8 is the Voluntary Scheme summary, and BS p1 says certificates
  go to members covered under the Voluntary Scheme. That bears on which alternative applies, and only the insurer can settle it.

## Other C0 findings on C1

| C0 finding | C1 state |
| --- | --- |
| Q1 S$120,000 condition | **Fixed** (ruling 2), pending an executable check |
| Q2 K2 completeness | **Open** (R5 fails by decision); now a contract failure, see ruling 1 item 4 |
| Q3 correction test with differing sums | **Closed**: acceptance Q3.1 to Q3.4 use Daniel S$400,000, so 20% = **S$80,000** (arithmetic correct), and Grace's S$120,000 / S$600,000 are not carried. They pass on C1 per `developer/C1.md` |
| Q4 K6a/K6c Living Care Plus, scope wording | **Open** (R7, R9 accepted as wording gaps) |
| Q5 absence over a partly stored Product Summary | **Addressed** by M2: an absence needs every page stored and a known page count. The 4-of-36-page Product Summary is correctly refused. Side effect: the fixture stores no `page_count`, so the K6b dental absence cannot be assessed on C1 until the Test engineer adds it. A refused absence is not a wrong answer, but if production documents also lack `page_count`, every dental-style answer would be refused. That needs checking before release |
| Q6 page numbering | Open, low |

No wrong claimable amount on C1. The figures (S$1,250, S$120,000, S$350,000, S$80,000 test) match the pages and arithmetic.

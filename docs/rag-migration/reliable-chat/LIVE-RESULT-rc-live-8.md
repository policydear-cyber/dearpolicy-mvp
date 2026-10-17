# rc-live-8 result: recorded-passage death question on the repaired code — FAIL

- **Tested code (frozen):** `6386aaa84f401f0c443a96971e8a9f8add5bf907`; provenance by tree manifest (920 files); production build of that tree.
  Pre-registration [EXPECTED-rc-live-8.md](EXPECTED-rc-live-8.md) in the same commit, before the run. Grader **v6**
  (`gradeFL4b`), unchanged after the run. One live run, no rerun. rc-live-7's v5 FAIL is kept as graded.
- **Run:** `rc-live-8-booklet-cda` (`RAG2_LIVE_HOUSEHOLD=booklet BOOKLET_CDA=recorded`, scenario FL4b), cap
  **US$0.015**. Dry run listed FL4b only.
- **Spend:** US$0.002416 over 4 calls (0 refused, 0 failed; worst-case reservations US$0.0026–0.0037 per call).
  Ledger: spent by all runs US$0.360442; **available to automated runs US$0.489558 after** the open US$0.15
  `trial-codespace-1` reservation (unspent, not released). Earlier entries unchanged.
- **Latency:** send → visible 15.3 s (answer saved 15.0 s; model 14.0 s over 4 steps; upstream 3.1–4.0 s per call).
- **Saved / displayed:** the answer body returned to the household (summary + details) is identical to the saved
  answer; the saved answer additionally carries its next step (the contact line), which the run's turn record never
  includes (same in rc-live-6 and rc-live-7).
- **Files:** `live/RUN-rc-live-8-booklet-cda-2026-10-17T09-42-53/`, `live/rc-live-8-booklet-cda-2026-10-17T09-42-53-grade.md` / `.json`.

## Complete visible answer (saved)

> If Daniel died in an accident, what would our booklet pay towards his funeral, and what documents would the insurer want from us?

```
The booklet does not specify the exact supporting documents or forms beyond proof of death and the insurer’s prescribed documents, so the uploaded documents do not establish a specific checklist.
I haven’t stated the amount for Compassionate Death Allowance Benefit in Insurance Benefits Summary (page 12), because I couldn’t confirm it against the document.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

## Grade (v6): FAIL — A2K, A2S, A2U, G1

- **The allowance is absent** (A2K, A2S). The model never stated the booklet's Section 5 benefit. It wrote one
  server-rendered `benefit_terms` sentence for the separate summary — "The Insurance Benefits Summary (page 12)
  prints : S$2,000." — which the save-time gate rejected ("the sentence does not name the benefit the figure is
  printed for"), leaving the "I haven't stated the amount…" line (A2U, G1).
- **Currency honest, nothing invented** (A2C, A2X pass): no S$2,000 shown, no 365 days / original receipts / illness.
- **Membership** (A3E, A3L pass): the model's sentence "the uploaded certificate does not confirm Daniel's enrolment
  in the Core or Voluntary Scheme…" was itself dropped by the statement check (it called the booklet "reference
  wording"), so neither a Core / Voluntary uncertainty nor a certificate-listing claim is shown.

## Diagnosis (offline, from the saved trace and a scripted `person_benefits` call on the same fixture)

1. **The booklet's Compassionate Death Allowance is not a benefit record.** `person_benefits` for Daniel offers the
   certificate rows and the booklet's Simple Fracture limit, but nothing for Section 5 (its amount is a bare `$2,000`),
   so the model is steered to the summary.
2. **The summary's bullet rows are mislabelled.** "•\tCompassionate Death Allowance Benefit*\tUp to S$2,000" becomes a
   record whose benefit is "•"; its rendering ("prints : S$2,000") names no benefit and is rejected by the gate.
3. The currency correction from `483c6d5` / `6386aaa` was not exercised: the model wrote no S$ for the booklet.

These are benefit-record defects (labels of bullet / tab rows; heading-paragraph benefits with a bare-$ amount), not
the currency or membership handling. Not repaired in this commit.

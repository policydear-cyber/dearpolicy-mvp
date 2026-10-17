# rc-live-7 result: the death allowance over the recorded passage — FAIL

- **Tested code:** `070c666ab03cab52846164a8eb56cb98a6b8c38f` (pre-registration commit; provenance by tree manifest, 920 files). Grader v5
  (`gradeFL4`), unchanged after the run. One live run, no rerun.
- **Run:** `rc-live-7-booklet-cda` (`RAG2_LIVE_HOUSEHOLD=booklet BOOKLET_CDA=recorded`), run cap US$0.05. Dry run listed
  FL4 only and refused FL3 under the recorded page.
- **Spend:** US$0.002558 over 4 calls (0 refused, 0 failed). Ledger: spent by all runs US$0.358026; **available to
  automated runs US$0.491974 after** the open US$0.15 `trial-codespace-1` reservation (US$0.641974 before it). The
  reservation is untouched and every earlier entry unchanged.
- **Latency:** send → visible 14.7 s (model 13.8 s, 4 model steps; upstream 2.6–4.9 s per call).
- **Files:** `live/RUN-rc-live-7-booklet-cda-2026-10-17T08-49-22/`, `live/rc-live-7-booklet-cda-2026-10-17T08-49-22-grade.md` / `.json`.

## Complete visible answer

> If Daniel died in an accident, what would our booklet pay towards his funeral, and what documents would the insurer want from us?

```
The booklet does not specify which particular documents the prescribed form requires.
The uploaded documents do not establish whether Daniel is enrolled in the Core or Voluntary Scheme, so the funeral benefit’s applicability to him is unresolved.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

## Grade (v5): FAIL — A2K, A2S, A2E, A2L

- **A2K / A2S (real failure).** The model's main sentence named the benefit with every printed condition (accidental
  death, proof of death and the prescribed-form documents, Core / Voluntary restriction) but wrote the amount as
  **"up to S$2,000"**. The booklet prints a bare `$2,000` and states no currency, so the server dropped the **whole**
  sentence ("states S$2,000 from Group Insurance Benefits Booklet, which prints that amount with a bare $"). The
  household got neither the benefit nor its amount. No synthetic addition appeared (A2X pass), no S$ was shown
  (A2C pass), and Repatriation's $5,000 was not used.
- **A2E / A2L (grader too strict, recorded as graded).** They matched "do not establish whether Daniel is enrolled in
  the Core or Voluntary Scheme". That statement is true for these documents: the certificate lists Daniel under the
  scheme's products as of 01/04/2024 but prints neither Core nor Voluntary, and the product already treats a Core /
  Voluntary caveat as legitimate (it is not the false scheme-enrolment caveat). The grade is not changed.

## Repair (offline only; no rerun)

Committed after this result: an S$ written for a bare-$ amount no longer drops the statement; the S$ is taken out
(recorded) and the amount is said as printed. The rc-live-7 wording replayed offline keeps the benefit with its
conditions and "2,000 (printed with a “$” sign; the document does not say which currency)", and passes the FL4
grader. This is offline evidence only; the real-model result above stays FAIL.

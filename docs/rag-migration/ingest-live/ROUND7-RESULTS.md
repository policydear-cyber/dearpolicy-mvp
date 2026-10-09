# Round 7: fresh uploads through the real path (diagnostic, not a reliability measure)

Model `openai:gpt-6-luna` for every role (production configuration), provider-reported `gpt-6-luna`. GitHub Actions runner,
real Next.js build, real upload UI driven by Playwright, local storage, request-drain job progress, pgvector Postgres.
No extracted text, rows, person links or answers were inserted into the database. Expected facts were written by an
independent author from the rendered pages (scripts/ingest-live/sealed/EXPECTED.source.*) and copied into the run only after
the conversations.

## Documents (scripts/ingest-live/fixture/source/)
- hx-text.pdf: text PDF, adult/child benefit table, daily allowance with a 60-day cap and a counting rule on page 2.
- hx-endorsement.pdf: raises the child daily allowance from S$80 to S$110 from 01 Jul 2026.
- hx-scanned.pdf: image-only page (no text layer), benefit table with a material footnote.

## Runs (every attempt kept)
| Run | Tested code | Result | Cost |
|---|---|---|---|
| ingest-preflight-ci-1 | 2dccec3 | path ran; results commit failed (dirty tree) -- fixed with --autostash | US$0 |
| ingest-preflight-ci-2 | d9e2011 | upload, drain, native text extraction OK; 11 model calls refused as designed | US$0 |
| ingest-live-1 | 6f1e878 | FAIL 71/82: ingestion, OCR and linking all passed; chat failed at verification/tools (see below); the harness deleted the wrong document | US$0.02689 |
| ingest-live-2 | a386b6e | FAIL 83/86: see remaining defects | US$0.02404 |

Cumulative exercise spend (LEDGER.json): US$0.09084 of US$0.50, including OCR, extraction, catalogue/condition/ledger
calls at upload time, conversations and retries. The app's own model_executions over-count in round 6 was a harness
attribution bug (a neighbouring turn's row counted again), now fixed; prices were correct.

## Path, per stage (ingest-live-2)
- Upload and job progress: all three reached ready (21-35 s) through the request drain.
- Extraction: every key figure, header, the counting rule and the scanned footnote preserved with page numbers
  (extracted/*.txt). The scanned page was read by gpt-6-luna as a PDF file part.
- Production defect found and fixed on the branch: with READING_MODEL=openai, lib/documents/ocr.ts skipped OCR entirely,
  so scanned pages were stored empty in production; the Gemini fallback was unreachable.
- Person linking: automatic and correct for all three documents (four people; Isla only for the scanned certificate).
- Retrieval and answers with citations: Q1 policy number and expiry; Q2 child S$40,000 vs adult S$150,000;
  Q3 fracture S$600 / S$1,500 with the certification condition, then the question; Q5 S$360 under the printed rule
  (3 complete 24-hour periods, remainder 10 h 40 min not counted) with the yearly-cap assumption; Q6 S$80 -> S$110 from
  01 Jul 2026; Q7 premium not in the documents; Q8 the footnote (payable only from the 4th consecutive day, so a two-night
  stay does not qualify); D1 after deleting the endorsement: S$80, no amendment relied on.
- Reopened conversation: kept the person and policy (R1).
- Deletion through the UI: confirmed (notice, unlisted, pending_deletion) before the next question.

## Faults found by ingest-live-1 and fixed (general, with regressions built from the stored rows)
calculate could not read uploaded documents (policy matched only by exact id; value from the endorsement of the same
policy refused); the printed "24 hours plus a 12-hour remainder" rule was unsupported; the gate required the long row
label word for word and treated item codes / a single "Amount payable" column as person columns; the earlier endorsement
value was not in the cited evidence; a figure-free explanatory preface was refused; turns ran out of token budget on
repeated failing tools; a rejected figure left only a generic failure; the harness deleted the wrong document and its
usefulness check accepted generic failures; L3b turn 2 echoed the user.

## Regression suites
GitHub CI on the tested code a386b6e: all 144 steps passed (build included).

## Remaining defects (ingest-live-2)
- Q4: after the user answered the X-ray question, the reply restated the S$600 benefit with its condition (the L3b fix
  working on the real model) but then put the same question back as "the question I was on".
- Q9: a figure-free rewrite of rejected sentences produced misleading text ("a set amount per day", "the endorsement's
  effective date is not confirmed in the records") next to correct content (dengue lump sum S$500; SafeStay is
  accident-only). The checker did not catch it.
- R1: for "exactly 3 days in August" the model asked for admission and discharge times instead of giving the
  expected S$330 (3 x S$110); the question is defensible under an hours-based rule, but no conditional figure was given.

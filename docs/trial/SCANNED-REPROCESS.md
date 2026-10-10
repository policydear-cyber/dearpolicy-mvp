# Re-reading scanned pages that production never read

**Status:** a plan only. Nothing here has been run against production, and no live data was touched.

## What happened
- Production reads documents with `READING_MODEL=openai:gpt-6-luna`.
- Until commit 8f01528, `lib/documents/ocr.ts` skipped OCR whenever the reading provider was not Anthropic or Gemini (`supportsHostedDocumentReading("openai")` was false). The Gemini fallback inside `hostedDocumentToText` was therefore never reached.
- Every image-only page was returned unchanged, with no request made and no mark. Reproduced on base 4103157: 0 provider requests, page text "", `extraction_method` "native".

`lib/rag/ingest.ts` then stored one of two outcomes:

| Upload | What production stored |
|---|---|
| A text-layer PDF with some scanned pages | `policy_pages.text` = '' (or a few stray characters) with `extraction_method` = 'native'. The document is otherwise `ready`, so answers silently miss everything printed only on those pages. |
| An all-scan PDF or a photo | Under 100 readable characters, so ingest stopped: `policies.processing_status` = 'failed', `processing_error` = `UNREADABLE_DOCUMENT_MESSAGE` (or `UNREADABLE_PHOTO_MESSAGE`), and no `policy_pages` rows. The household was told the document "could not be read". |

After the fix, a read page is stored as 'ocr'. A page nothing could read is stored as 'unreadable' and named in the document's notes.

## 1. Detect (read only)
`docs/trial/scanned-detect.sql` runs inside `BEGIN TRANSACTION READ ONLY … ROLLBACK` and uses only the real schema:
- `policies(id, account_id, original_filename, product_name, processing_status, processing_error, processing_completed_at, updated_at, page_count, lifecycle_state)`, from sql/schema.sql and sql/lifecycle.sql.
- `policy_pages(policy_id, page_number, text, extraction_method)`, from sql/schema.sql and sql/v11-ingestion-evidence.sql.

```
psql "$READ_ONLY_DATABASE_URL" -v fixed_at='<deploy time of the fixed commit, UTC>' -f docs/trial/scanned-detect.sql
```

It lists every active document processed before `fixed_at` that has either of these:

| Finding | Test |
|---|---|
| **Empty native pages** | At least one page has fewer than 24 letters or digits (the same threshold as `pagesNeedingOcr`), stored 'native' or NULL, and no page of the document is 'ocr' or 'unreadable'. The empty page numbers are returned. |
| **A whole document unread** | `failed` with exactly one of the two unreadable messages, and no pages stored. |

A second query gives the totals used for the cost estimate.

`policy_pages` does not keep a page's image count, so a genuinely blank text page is listed as well. Re-reading it costs nothing extra, because only image-backed pages are sent to the reading model.

**Tested:** `node --import tsx scripts/ingest-live/scanned-detect-test.ts` runs the query on PGlite loaded with the real schema, using run ingest-live-2's scanned-page text.
- **Found:** a pre-fix mixed document (pages 2 and 3), a pre-fix all-scan PDF, and a pre-fix photo. That is 3 documents and 4 pages to read.
- **Not listed:** documents read after the fix ('ocr'), visibly unread pages ('unreadable'), text-only documents, a document in `pending_deletion`, a document processed after `fixed_at`, and an unrelated failure.
- The test also asserts the file contains no write statement.

## 2. The re-read path the app already has
`POST /api/policies/reprocess {policyId}` (app/api/policies/reprocess/route.ts). It authenticates a **household member** and authorises the policy against that household under row-level security.
- It requires `quarantine_status` to be `scan_clean` or `not_scanned_prototype`, and refuses a document already being processed. A stalled one, older than 2 minutes with no live job, may be re-queued.
- It sets the document to `queued`, clears its catalogue checkpoints (`clearCatalogCheckpoints`), and runs `enqueuePolicyProcessing` with `resurrectTerminal: true`.
- The job runs `processPolicy` again from the stored file. Every stage replaces its own output: pages, people, cover, benefits, conditions, ledger and chunks.
- Model readings are cached by content, so only the newly read text costs anything. The extraction cache key includes the sample text, which now differs.

Where people trigger it:
- The **Re-analyse** button on `app/operator/documents/page.tsx` calls this route.
- The household Policies page uses it only to unlock password-protected PDFs.

**There is no cross-household admin route.** There are two ways to re-read, and choosing between them is a decision for the owner:
- **(a) Inside each household's session.** The household, or the operator with the household's consent, presses Re-analyse.
- **(b) A small operator script.** It would call `enqueuePolicyProcessing` with the route's own pre-checks: quarantine state, not in flight, `clearCatalogCheckpoints`. This script does not exist yet. It would be new code to review, and it must not bypass the per-household spend cap (`assertUnderSpendCap` runs inside each model call).

## 3. Cost
Prices for gpt-6-luna, from developers.openai.com/api/docs/models/gpt-6-luna and `lib/ai/providers.ts`: US$0.10 per 1M input tokens, US$0.01 cached, US$0.50 output.

| Per | Reserved by the live fetch guard (worst case) | Actual (run ingest-live-2) |
|---|---|---|
| Scanned page (OCR call) | Body characters / 2.5 + 6 000 page-image tokens, plus max(2 048, 1 200 × pages) output. For the 1-page, 129 747-byte page: 75 908 input + 2 048 output = **US$0.0086** | 1 351 in / 381 out = **US$0.00033** |
| Document re-read (extraction, catalogue, conditions, ledger) | About US$0.01. Extraction 6 000 output, ledger 4 000 + 1 500, catalogue 700–900 per page, all at US$0.50/M, plus input | US$0.0079 for the three documents: **about US$0.003 per document** |

**Budget:** documents × US$0.01 + pages × US$0.009 is the worst case. Expect documents × US$0.003 + pages × US$0.0004. For example, 50 documents with 120 scanned pages: worst case under US$1.60, expected about US$0.20.

## 4. Dry run (no production writes)
1. Run the detection query read-only, and keep its output: document ids and page numbers. Count pages and documents, and check them against the budget above and the monthly OpenAI cap (US$5).
2. Reproduce one case locally. Upload a synthetic copy with the same layout (a text page plus a scanned page) to the local harness (`npm run ingest:live -- --preflight` and then a live CI run). Confirm the page becomes 'ocr' with text, and look at the cost.
3. In production, re-read **one** document belonging to the operator's own household first. Before and after, run the per-document read-only check from step 5. The empty page numbers must become 'ocr' with text, or 'unreadable' and named in the notes. The document must still be `ready`, its people still linked, and `model_usage` for that household must match the estimate.

## 5. Procedure
1. **Snapshot** (read only) each listed document's derived rows before it is re-read:
   - `COPY (SELECT * FROM <t> WHERE policy_id = ANY(:ids)) TO STDOUT WITH CSV HEADER`
   - for `policy_pages`, `policy_members`, `policy_detected_people`, `policy_coverages`, `policy_reference_coverages`, `policy_benefits`, `policy_cover_conditions`, `premium_records` (by `source_document_id`) and `policy_chunks`;
   - plus the `policies` rows themselves. Store the files privately: they contain household data.
2. **Re-read in batches** of 10 documents, through the route (2a) or the reviewed script (2b). Wait for each batch to finish (`processing_status` ready or failed) before starting the next.
3. **Verify** after each batch by re-running the detection query. Those documents must no longer be listed. Also compare page counts and linked people with the snapshot, and the batch's spend in `model_usage` with the estimate. Stop if a batch costs more than twice the estimate, or if any document that was `ready` became `failed`.
4. **Tell the household** through the document's own notes. The app writes them, for example naming pages that are still unreadable.

## 6. Rollback
Re-reading changes only derived rows; the stored file is never touched. To undo for a document:
1. **Restore that document's derived rows.** Do this in a single transaction, as an operator, from the step-5 snapshot: delete its rows in the tables listed above, then re-insert them from the CSVs. Then set `policies.processing_status`, `processing_error` and `page_count` back to their snapshot values.
2. **Or re-read it again.** The job is idempotent.
3. **Last resort:** Supabase point-in-time recovery to before the batch. That affects the whole database, so it is only for a systemic failure.

Rows the re-read creates in `model_usage` and `model_executions` are records of real spend, and are kept.

-- docs/trial/scanned-detect.sql -- READ ONLY. Documents whose scanned pages were never read because lib/documents/ocr.ts
-- skipped OCR for an OpenAI reading model (before commit 8f01528 "OCR: scanned pages are read by the configured OpenAI
-- reading model"). Usage (psql, production read replica or a read-only role):
--   psql "$DATABASE_URL" -v fixed_at='2026-10-10T00:00:00Z' -f docs/trial/scanned-detect.sql
-- fixed_at = when the OCR fix reached production (the Vercel deployment time of the fixed commit).
--
-- What the defect left behind (lib/rag/ingest.ts):
--   * a document with a text layer AND scanned pages: the scanned pages were stored in policy_pages with text '' (or a
--     few stray characters) and extraction_method 'native' (the pre-fix code returned them unchanged, unmarked).
--     After the fix such a page is 'ocr' (read) or 'unreadable' (visibly unread).
--   * a document that was ALL scans (or a photo): under 100 readable characters, so ingest stopped with
--     UNREADABLE_DOCUMENT_MESSAGE / UNREADABLE_PHOTO_MESSAGE (lib/documents/processing-errors.ts) in
--     policies.processing_error, processing_status 'failed', and NO policy_pages rows.
-- "Near-empty" mirrors pagesNeedingOcr() (lib/documents/ocr.ts): fewer than 24 letters / digits on the page.
-- policy_pages does not store the page's image count, so a genuinely blank text page is also listed; re-reading it
-- costs nothing extra (only image-backed pages are sent to the reading model).
BEGIN TRANSACTION READ ONLY;

WITH page_stats AS (
  SELECT pp.policy_id,
         count(*)                                                                      AS pages_stored,
         count(*) FILTER (WHERE coalesce(pp.extraction_method, 'native') = 'native'
                            AND length(regexp_replace(pp.text, '[^[:alnum:]]', '', 'g')) < 24) AS empty_native_pages,
         array_agg(pp.page_number ORDER BY pp.page_number)
           FILTER (WHERE coalesce(pp.extraction_method, 'native') = 'native'
                     AND length(regexp_replace(pp.text, '[^[:alnum:]]', '', 'g')) < 24)        AS empty_page_numbers,
         count(*) FILTER (WHERE pp.extraction_method = 'ocr')                          AS ocr_pages,
         count(*) FILTER (WHERE pp.extraction_method = 'unreadable')                   AS unreadable_pages
    FROM policy_pages pp
   GROUP BY pp.policy_id
)
SELECT p.account_id,
       p.id                     AS policy_id,
       p.original_filename,
       p.product_name,
       p.processing_status,
       coalesce(p.processing_completed_at, p.updated_at) AS processed_at,
       p.page_count,
       s.pages_stored,
       s.empty_native_pages,
       s.empty_page_numbers,
       CASE
         WHEN s.policy_id IS NULL THEN 'whole document unread (failed: no readable text)'
         ELSE 'scanned pages stored empty as native text'
       END                      AS finding
  FROM policies p
  LEFT JOIN page_stats s ON s.policy_id = p.id
 WHERE p.lifecycle_state = 'active'
   AND coalesce(p.processing_completed_at, p.updated_at) < :'fixed_at'::timestamptz
   AND (
         -- a text-layer document with empty native pages and no page OCR'd (nothing was read by the hosted reader)
         (s.empty_native_pages > 0 AND s.ocr_pages = 0 AND s.unreadable_pages = 0)
         -- an all-scan document (or photo) refused as having no readable text
      OR (s.policy_id IS NULL AND p.processing_status = 'failed'
          AND p.processing_error IN (
            'DearPolicy could not find readable text in this document, so the insured people, benefits and amounts in it are not available. The original PDF or a clearer scan would let DearPolicy read it.',
            'DearPolicy couldn’t read this photo — it is too blurred, dark or faint to make out the words, so nothing in it is available. Take it again: lay the page flat in good light with no shadow across it, hold the phone steady and straight above the page, and keep the whole page in the frame. A PDF from the insurer is even better.'))
       )
 ORDER BY p.account_id, processed_at;

-- Summary for the cost estimate (pages to read; an all-scan document counts its page_count, or 1 when unknown).
SELECT count(*) AS documents,
       sum(CASE WHEN s.policy_id IS NULL THEN coalesce(nullif(p.page_count, 0), 1) ELSE s.empty_native_pages END) AS pages_to_read
  FROM policies p
  LEFT JOIN (SELECT policy_id,
                    count(*) FILTER (WHERE coalesce(extraction_method, 'native') = 'native'
                                       AND length(regexp_replace(text, '[^[:alnum:]]', '', 'g')) < 24) AS empty_native_pages,
                    count(*) FILTER (WHERE extraction_method IN ('ocr', 'unreadable')) AS read_or_marked
               FROM policy_pages GROUP BY policy_id) s ON s.policy_id = p.id
 WHERE p.lifecycle_state = 'active'
   AND coalesce(p.processing_completed_at, p.updated_at) < :'fixed_at'::timestamptz
   AND ((s.empty_native_pages > 0 AND s.read_or_marked = 0)
     OR (s.policy_id IS NULL AND p.processing_status = 'failed'
         AND p.processing_error IN (
           'DearPolicy could not find readable text in this document, so the insured people, benefits and amounts in it are not available. The original PDF or a clearer scan would let DearPolicy read it.',
           'DearPolicy couldn’t read this photo — it is too blurred, dark or faint to make out the words, so nothing in it is available. Take it again: lay the page flat in good light with no shadow across it, hold the phone steady and straight above the page, and keep the whole page in the frame. A PDF from the insurer is even better.')));

ROLLBACK;

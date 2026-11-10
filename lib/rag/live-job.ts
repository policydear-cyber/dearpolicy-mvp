/** The one rule for whether a document is being read right now, as the Documents page shows it
 * (app/api/policies/route.ts processing_stalled; Try again in app/api/policies/reprocess/route.ts). The chat
 * (lib/simple-chat/library.ts) and Coverage (lib/benefit-table/service.ts) say "being read" only by this rule, so a
 * document whose intake job died is never "still being read" there while the Documents page calls it stalled.
 * SQL text only: no database import, so pure modules and tests can use it. */

export const POLICY_PROCESSING_JOB_TYPE = "policy_processing";
/** A queued job that nothing has claimed for this long is stalled: the page offers Try again, which starts it. */
export const UNCLAIMED_STALL_MINUTES = 10;
/** SQL: a job row (alias `j`) that is actually backing its document: running under a live lease, waiting out a retry
 * delay, or queued for less than UNCLAIMED_STALL_MINUTES (given as the parameter `minutes`, e.g. "$4"). Anything else
 * is stalled: nothing is running it, so the page offers Try again (25 Oct: a document sat queued for a day). */
export const livePolicyJob = (j: string, minutes: string) =>
  `((${j}.status IN ('queued','failed_retryable') AND ${j}.available_at > now() - make_interval(mins => ${minutes}))
     OR (${j}.status='processing' AND ${j}.lease_expires_at > now()))`;
/** SQL: true when the policy row (alias `p`) has a live intake job (livePolicyJob): its own, or the later re-read intake
 * schedules after a reading-service failure (key `<id>:retry-read`, lib/rag/ingest.ts; TE). Without one, a document in an
 * in-progress status is stalled, not being read. Only server constants are written into the text. */
export const policyJobLive = (p: string) =>
  `EXISTS (SELECT 1 FROM background_jobs bj WHERE bj.job_type='${POLICY_PROCESSING_JOB_TYPE}' AND bj.idempotency_key IN (${p}.id::text, ${p}.id::text || ':retry-read')
     AND ${livePolicyJob("bj", String(UNCLAIMED_STALL_MINUTES))})`;
/** The automatic malware-scan retry (lib/scanning/retry.ts SCAN_RETRY_JOB_TYPE; keys `policy_document:<id>:scan-retry:<N>`). */
export const SCAN_RETRY_JOB_TYPE = "document_scan_retry";
/** SQL: true when the policy row (alias `p`) has a live automatic malware-scan retry, by the same livePolicyJob rule. A
 * document on hold for its scan waits on this job, not on an intake job, and Try again refuses it until the scan is clean
 * (app/api/policies/reprocess/route.ts). Only server constants are written into the text. */
export const scanJobLive = (p: string) =>
  `EXISTS (SELECT 1 FROM background_jobs sj WHERE sj.job_type='${SCAN_RETRY_JOB_TYPE}' AND sj.idempotency_key LIKE 'policy_document:' || ${p}.id::text || ':scan-retry:%'
     AND ${livePolicyJob("sj", String(UNCLAIMED_STALL_MINUTES))})`;
/** A long document's table reading carried over runs (lib/benefit-table/table-reading-job.ts; keys
 * `<id>:table-reading:<reading>:<N>`). */
export const TABLE_READING_JOB_TYPE = "benefit_table_reading";
/** SQL: true when the policy row (alias `p`) has a live continuation of its table reading (livePolicyJob's rule): the
 * table then shows the document as being read, never as unread. Only server constants are written into the text. */
export const tableReadingJobLive = (p: string) =>
  `EXISTS (SELECT 1 FROM background_jobs tj WHERE tj.job_type='${TABLE_READING_JOB_TYPE}' AND tj.idempotency_key LIKE ${p}.id::text || ':table-reading:%'
     AND ${livePolicyJob("tj", String(UNCLAIMED_STALL_MINUTES))})`;
/** SQL: true when the policy row (alias `p`) has a continuation of its table reading still to run (queued, running or
 * to be retried), however long it has waited: a continuation waits for the next request or the daily run, so it can
 * wait for hours. Only server constants are written into the text. */
export const tableReadingJobPending = (p: string) =>
  `EXISTS (SELECT 1 FROM background_jobs tp WHERE tp.job_type='${TABLE_READING_JOB_TYPE}' AND tp.idempotency_key LIKE ${p}.id::text || ':table-reading:%'
     AND tp.status IN ('queued','processing','failed_retryable'))`;

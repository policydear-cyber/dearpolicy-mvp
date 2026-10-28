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
/** SQL: true when the policy row (alias `p`) has a live intake job (livePolicyJob). Without one, a document in an
 * in-progress status is stalled, not being read. Only server constants are written into the text. */
export const policyJobLive = (p: string) =>
  `EXISTS (SELECT 1 FROM background_jobs bj WHERE bj.job_type='${POLICY_PROCESSING_JOB_TYPE}' AND bj.idempotency_key=${p}.id::text
     AND ${livePolicyJob("bj", String(UNCLAIMED_STALL_MINUTES))})`;

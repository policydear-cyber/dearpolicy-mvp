/**
 * A password-protected PDF whose malware scan is still pending is not read
 * yet: processPolicy() stops at the quarantine gate and the scan retry
 * (./retry-processor.ts) reads it later from the original processing job's
 * payload. So that job keeps its pdfPassword, and only while the scan is
 * pending: completeJob() (lib/jobs/queue.ts) drops the password from every
 * finished job unless the payload says HELD_FOR_SCAN_KEY, and the scan
 * retry drops both once the document is no longer waiting for its scan
 * (read, rejected, gone) or the automatic attempts are used up. The
 * password is never copied anywhere else.
 */
import { query } from "@/lib/db/client";
import { POLICY_PROCESSING_JOB_TYPE } from "@/lib/rag/live-job";
import { getPolicyQuarantineRow } from "@/lib/policies/quarantine/store";

export const HELD_FOR_SCAN_KEY = "heldForScan";

async function waitingForScan(accountId: string, policyId: string): Promise<boolean> {
  const row = await getPolicyQuarantineRow(accountId, policyId);
  return Boolean(row && !row.superseded_at && row.quarantine_status === "scan_pending");
}

/** After a processing run: mark this (leased) job to keep its password while
 * the document waits for its scan, and unmark it otherwise. */
export async function holdPasswordWhileScanPending(params: { jobId: string; workerId: string; accountId: string; policyId: string }): Promise<void> {
  const hold = await waitingForScan(params.accountId, params.policyId);
  await query(
    `UPDATE background_jobs
        SET payload = CASE WHEN $3::boolean AND payload ? 'pdfPassword' THEN payload || jsonb_build_object('${HELD_FOR_SCAN_KEY}', true)
                           ELSE payload - '${HELD_FOR_SCAN_KEY}' END,
            updated_at = now()
      WHERE id=$1 AND lease_owner=$2 AND status='processing' AND jsonb_typeof(payload)='object'`,
    [params.jobId, params.workerId, hold],
  );
}

/** From the scan retry: once the document is no longer waiting for its scan
 * (or `force`, when the automatic attempts are used up), the password is
 * dropped from the document's finished processing jobs (its first read and
 * its deferred re-read). A job that is running again (a
 * fresh read with a password typed again) is left alone. */
export async function releaseHeldPassword(accountId: string, policyId: string, force = false): Promise<void> {
  if (!force && await waitingForScan(accountId, policyId)) return;
  await query(
    `UPDATE background_jobs SET payload = payload - 'pdfPassword' - '${HELD_FOR_SCAN_KEY}', updated_at = now()
      WHERE job_type=$1 AND idempotency_key IN ($2, $2 || ':retry-read') AND account_id=$3 AND status IN ('succeeded','dead_letter','cancelled')
        AND jsonb_typeof(payload)='object' AND (payload ? 'pdfPassword' OR payload ? '${HELD_FOR_SCAN_KEY}')`,
    [POLICY_PROCESSING_JOB_TYPE, policyId, accountId],
  );
}

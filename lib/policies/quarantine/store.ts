/**
 * The policy-document quarantine gate: the single module that decides
 * whether a policy document is allowed into lib/rag/ingest.ts's
 * processPolicy() pipeline (OCR, parsing, structured extraction,
 * embeddings, indexing), and the only writer of `policies.quarantine_status`.
 *
 * Every write here is a compare-and-swap (`WHERE quarantine_status=$from`)
 * scoped to account_id and `superseded_at IS NULL`, so: two concurrent
 * callers racing to advance the same document can never both succeed (the
 * second CAS simply matches zero rows and is treated as a safe no-op);
 * a duplicate or out-of-order scan-result write is idempotent rather than
 * corrupting state; and a deleted or superseded document can never be
 * revived by a late-arriving result. See recordPolicyScanResult() below
 * for the full decision table.
 */
import { query, pool } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { currentFileScanAdapter } from "@/lib/scanning/adapter";
import { assertValidPolicyQuarantineTransition } from "./state-machine";
import { appendPolicyDocumentAudit } from "./audit";
import { persistableScanResultDetail } from "./ui";
import { recordProcessingFailure, SCAN_ATTEMPT_FAILED_MESSAGE } from "@/lib/diagnostics/processing-failures";
import { isPolicyQuarantineStatus, type PolicyQuarantineRow, type PolicyQuarantineStatus, type PolicyScanResultOutcome } from "./types";
import type { ScanRetryHint } from "@/lib/scanning/adapter";
import { VirusTotalAdapterError } from "@/lib/scanning/adapters/virustotal";
import { MAX_SCAN_RETRY_ATTEMPTS, SCAN_RETRY_SCHEDULED_MESSAGE, scheduleScanRetry } from "@/lib/scanning/retry";

const ROW_COLUMNS = `id::text,account_id,quarantine_status,scan_provider,scan_result_detail,scan_event_id,
  scanned_at::text,supersedes_id::text,superseded_at::text,processing_status,storage_key`;

export async function getPolicyQuarantineRow(accountId: string, policyId: string): Promise<PolicyQuarantineRow | null> {
  const result = await query<PolicyQuarantineRow>(
    `SELECT ${ROW_COLUMNS} FROM policies WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,
    [policyId, accountId],
  );
  return result.rows[0] ?? null;
}

/** Every read/write below filters on account_id explicitly, on top of the
 * policy id -- so a forged or cross-household policyId can never read or
 * mutate another account's document, matching the rest of this codebase's
 * convention (see lib/claims/evidence/store.ts's own comment). */
async function transitionQuarantineStatus(args: {
  accountId: string; policyId: string; from: PolicyQuarantineStatus; to: PolicyQuarantineStatus;
  scanProvider?: string | null; scanResultDetail?: string | null; scanEventId?: string | null; markScanned?: boolean;
}): Promise<PolicyQuarantineRow | null> {
  assertValidPolicyQuarantineTransition(args.from, args.to);
  const result = await query<PolicyQuarantineRow>(
    `UPDATE policies
        SET quarantine_status=$1,
            scan_provider=COALESCE($2,scan_provider),
            scan_result_detail=COALESCE($3,scan_result_detail),
            scan_event_id=COALESCE($4,scan_event_id),
            scanned_at=CASE WHEN $5 THEN now() ELSE scanned_at END,
            updated_at=now()
      WHERE id=$6 AND account_id=$7 AND quarantine_status=$8 AND superseded_at IS NULL AND ${activePredicate()}
      RETURNING ${ROW_COLUMNS}`,
    [args.to, args.scanProvider ?? null, args.scanResultDetail ?? null, args.scanEventId ?? null,
     Boolean(args.markScanned), args.policyId, args.accountId, args.from],
  );
  return result.rows[0] ?? null;
}

/** True only when the persisted, re-read-from-the-database status is
 * exactly "scan_clean" -- an unexpected/malformed value is never treated
 * as clean (see isPolicyQuarantineStatus()). This is the ONE function every
 * processing/reprocessing/reindexing path must call, and it always re-reads
 * the row rather than trusting a caller-supplied flag, so a resumed or
 * retried call re-checks the real persisted state every time. */
export function isPolicyProcessingAllowed(row: Pick<PolicyQuarantineRow, "quarantine_status">): boolean {
  return isPolicyQuarantineStatus(row.quarantine_status) && row.quarantine_status === "scan_clean";
}

export class PolicyNotClearedForProcessingError extends Error {
  constructor(public readonly policyId: string, public readonly quarantineStatus: string | null) {
    super(`Policy document ${policyId} is not cleared for processing (quarantine_status=${quarantineStatus ?? "unknown"}).`);
  }
}

/** Re-reads the row fresh from the database and throws unless it is
 * genuinely scan_clean. Called at the top of lib/rag/ingest.ts's
 * processPolicy() -- the single entry point for OCR/parsing/extraction/
 * embeddings/indexing/benefit extraction/model calls on a policy document
 * -- so every caller of that function (upload, reprocess, any future
 * background job) is gated the same way with no way to bypass it. */
export async function assertPolicyProcessingAllowed(accountId: string, policyId: string): Promise<PolicyQuarantineRow> {
  const row = await getPolicyQuarantineRow(accountId, policyId);
  if (!row || row.superseded_at) throw new PolicyNotClearedForProcessingError(policyId, row?.quarantine_status ?? null);
  if (!isPolicyProcessingAllowed(row)) throw new PolicyNotClearedForProcessingError(policyId, row.quarantine_status);
  return row;
}

/** scan_rejected and deleted documents must never be handed out through a
 * normal signed/download path. No such route exists yet for raw policy
 * PDFs today (readPolicyFile() is only ever called internally, by
 * processPolicy() itself and the DELETE route's own cleanup) -- this guard
 * is here so the FIRST such route added later is gated from day one rather
 * than needing this checked in from scratch. */
export function assertPolicyDownloadable(row: Pick<PolicyQuarantineRow, "quarantine_status">): void {
  if (row.quarantine_status === "scan_rejected" || row.quarantine_status === "deleted") {
    throw new Error(`Policy document is not downloadable (quarantine_status=${row.quarantine_status}).`);
  }
}

/**
 * Idempotent scan-result write. Only ever moves a document OUT of
 * scan_pending via a CAS -- so:
 *  - A first, genuine result: CAS succeeds, row updated, audited. -> "applied"
 *  - A duplicate delivery of the SAME event after it already applied: CAS
 *    matches zero rows (status is no longer scan_pending); the row's own
 *    scan_event_id already equals this event, so this is recognised as a
 *    harmless replay and produces no second audit event. -> "duplicate_ignored"
 *  - An out-of-order/conflicting result (a different event id arriving
 *    after the document already has a final verdict): CAS matches zero
 *    rows and the row's scan_event_id differs -- ignored, with its own
 *    distinct audit event so the conflict is still visible to an operator,
 *    without ever moving the document. -> "conflicting_ignored"
 *  - The document has been deleted or superseded: ignored outright, no
 *    audit noise, no existence signal beyond "nothing happened". -> "deleted_or_superseded_ignored"
 *  - No such document/account pair: ignored identically to the deleted
 *    case, so a scan callback for someone else's document (or a forged id)
 *    can never distinguish "wrong account" from "doesn't exist" from
 *    "already decided". -> "not_found"
 */
export async function recordPolicyScanResult(args: {
  accountId: string; policyId: string; status: "scan_clean" | "scan_rejected";
  scanProvider: string; scanResultDetail?: string | null; scanEventId?: string | null;
}): Promise<PolicyScanResultOutcome> {
  // Provider-internal detail (an analysis id, engine counts) is logged for
  // operators and never written to the household-readable column.
  if (args.scanResultDetail) console.info(`malware scan result (${args.scanProvider}) for policy ${args.policyId}: ${args.scanResultDetail}`);
  const applied = await transitionQuarantineStatus({
    accountId: args.accountId, policyId: args.policyId, from: "scan_pending", to: args.status,
    scanProvider: args.scanProvider,
    scanResultDetail: persistableScanResultDetail(args.status === "scan_rejected" ? "infected" : "clean", args.scanResultDetail),
    scanEventId: args.scanEventId, markScanned: true,
  });
  if (applied) {
    await appendPolicyDocumentAudit(args.accountId, {
      actor: "system", action: "scan_result_recorded", policyId: args.policyId,
      previousValue: { quarantineStatus: "scan_pending" },
      newValue: { quarantineStatus: args.status, scanProvider: args.scanProvider, scanEventId: args.scanEventId ?? null },
      reasonCode: args.status === "scan_rejected" ? "MALWARE_DETECTED" : undefined,
    });
    return "applied";
  }

  const row = await getPolicyQuarantineRow(args.accountId, args.policyId);
  if (!row) return "not_found";
  if (row.superseded_at || row.quarantine_status === "deleted") return "deleted_or_superseded_ignored";
  if (row.quarantine_status === args.status && (args.scanEventId == null || row.scan_event_id === args.scanEventId)) {
    return "duplicate_ignored";
  }
  // Some other terminal/non-pending state, or a conflicting verdict for a
  // different event id -- ignored, but recorded so it is not invisible.
  await appendPolicyDocumentAudit(args.accountId, {
    actor: "system", action: "scan_result_ignored_conflicting", policyId: args.policyId,
    previousValue: { quarantineStatus: row.quarantine_status, scanEventId: row.scan_event_id },
    newValue: { attemptedStatus: args.status, attemptedScanEventId: args.scanEventId ?? null },
    reasonCode: "CONFLICTING_SCAN_RESULT",
  });
  return "conflicting_ignored";
}

/**
 * Runs (or resumes) the quarantine gate for one policy document, cascading
 * through as many of uploaded -> quarantined -> scan_pending ->
 * scan_clean|scan_rejected as are currently reachable in one call --
 * exactly like lib/claims/evidence/pipeline.ts's processClaimEvidence()
 * cascades through its own early states. Always re-reads the row from the
 * database first, never trusts a caller-supplied status, so a resumed or
 * retried call (a reprocess, a reindex, a re-run of a crashed background
 * job) always re-checks real persisted state rather than an assumption.
 *
 * A scanner exception (the adapter throwing -- a timeout, a storage read
 * failure while fetching bytes to scan) is caught here and leaves the
 * document at scan_pending with an audited "scan_attempt_failed" entry,
 * never advances it to scan_clean, and never throws further -- an upload
 * request must not 500 just because the file could not be scanned yet.
 */
/** Schedules the next bounded automatic retry (lib/scanning/retry.ts) and
 * audits it with fixed wording. Failure-isolated: if scheduling itself fails
 * the document simply stays on hold -- never released, never a 500. */
async function schedulePolicyScanRetry(accountId: string, policyId: string, hint: ScanRetryHint): Promise<void> {
  try {
    const outcome = await scheduleScanRetry({ accountId, resourceType: "policy_document", resourceId: policyId, hint });
    if (outcome.scheduled && outcome.created) {
      await appendPolicyDocumentAudit(accountId, {
        actor: "system", action: "scan_retry_scheduled", policyId,
        newValue: { attempt: outcome.attempt, maxAttempts: MAX_SCAN_RETRY_ATTEMPTS, notBefore: outcome.availableAt.toISOString() },
        reason: SCAN_RETRY_SCHEDULED_MESSAGE, reasonCode: "SCAN_RETRY_SCHEDULED",
      });
    }
  } catch (error) {
    console.warn(`could not schedule a scan retry for policy ${policyId} (${error instanceof Error ? error.name : "unknown"})`);
  }
}

export async function runPolicyQuarantineGate(args: {
  accountId: string; policyId: string; readBytes: () => Promise<Uint8Array>;
}): Promise<{ cleared: boolean; row: PolicyQuarantineRow | null }> {
  let row = await getPolicyQuarantineRow(args.accountId, args.policyId);
  if (!row || row.superseded_at) return { cleared: false, row };

  if (row.quarantine_status === "uploaded") {
    const moved = await transitionQuarantineStatus({ accountId: args.accountId, policyId: args.policyId, from: "uploaded", to: "quarantined" });
    if (moved) {
      row = moved;
      await appendPolicyDocumentAudit(args.accountId, {
        actor: "system", action: "quarantined", policyId: args.policyId,
        previousValue: { quarantineStatus: "uploaded" }, newValue: { quarantineStatus: "quarantined" },
      });
    } else {
      row = await getPolicyQuarantineRow(args.accountId, args.policyId);
      if (!row || row.superseded_at) return { cleared: false, row };
    }
  }

  if (row.quarantine_status === "quarantined") {
    const moved = await transitionQuarantineStatus({ accountId: args.accountId, policyId: args.policyId, from: "quarantined", to: "scan_pending" });
    if (moved) {
      row = moved;
      await appendPolicyDocumentAudit(args.accountId, {
        actor: "system", action: "scan_started", policyId: args.policyId,
        previousValue: { quarantineStatus: "quarantined" }, newValue: { quarantineStatus: "scan_pending" },
      });
    } else {
      row = await getPolicyQuarantineRow(args.accountId, args.policyId);
      if (!row || row.superseded_at) return { cleared: false, row };
    }
  }

  if (row.quarantine_status === "scan_pending") {
    // scan_pending is a resting state on every OTHER resumed call (a
    // reprocess/reindex re-checking persisted state must not re-invoke the
    // scanner every time -- see this function's own doc comment). It is
    // only actively scanned HERE, immediately after the transition into it
    // above, in the same cascade -- i.e. exactly once per fresh
    // uploaded/quarantined starting point, never on a resume that finds
    // the document already sitting at scan_pending from a previous call.
    const scannedJustNow = row.scanned_at == null;
    if (scannedJustNow) {
      const adapter = currentFileScanAdapter();
      let result: Awaited<ReturnType<typeof adapter.scanFile>> | null = null;
      try {
        const bytes = await args.readBytes();
        result = await adapter.scanFile(bytes);
      } catch (error) {
        // The audit trail is household-readable: a fixed reason only. The raw
        // error (which can name a storage key or a provider response) is not
        // stored; the server log gets its class name for operators.
        console.warn(`malware scan attempt failed for policy ${args.policyId} (${error instanceof Error ? error.name : "unknown"})`);
        await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_scan", resourceId: args.policyId, failureCode: "SCAN_ATTEMPT_FAILED", error });
        await appendPolicyDocumentAudit(args.accountId, {
          actor: "system", action: "scan_attempt_failed", policyId: args.policyId,
          previousValue: { quarantineStatus: "scan_pending" },
          reason: SCAN_ATTEMPT_FAILED_MESSAGE, reasonCode: "SCAN_ATTEMPT_FAILED",
        });
        // A scanner that threw on its own misconfiguration (bad API key,
        // unrecognised response) is never retried automatically; anything
        // else (reading the stored bytes, a crashed provider call) is
        // treated as a temporary provider failure.
        if (!(error instanceof VirusTotalAdapterError)) {
          await schedulePolicyScanRetry(args.accountId, args.policyId, { reason: "provider_unavailable", retryAfterSeconds: null });
        }
        return { cleared: false, row };
      }
      if (result.status === "infected") {
        if (result.detail) console.info(`malware scan result (${adapter.name}) for policy ${args.policyId}: ${result.detail}`);
        await recordPolicyScanResult({ accountId: args.accountId, policyId: args.policyId, status: "scan_rejected", scanProvider: adapter.name, scanResultDetail: "This file was flagged by malware scanning and cannot be processed." });
      } else {
        // "clean" or "scan_unavailable" -- scan_unavailable is recorded as
        // the scan_result_detail on an otherwise-still-scan_pending row: no
        // FileScanStatus value here promotes the document past scan_pending
        // except a real "clean" verdict from a real adapter.
        if (result.status === "clean") {
          await recordPolicyScanResult({ accountId: args.accountId, policyId: args.policyId, status: "scan_clean", scanProvider: adapter.name, scanResultDetail: result.detail ?? null });
        } else {
          if (result.detail) {
            console.info(`malware scan unavailable (${adapter.name}) for policy ${args.policyId}: ${result.detail}`);
            await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_scan", resourceId: args.policyId, failureCode: "SCAN_UNAVAILABLE", error: result.detail });
          }
          await query(`UPDATE policies SET scan_provider=$1, scan_result_detail=$2, updated_at=now() WHERE id=$3 AND account_id=$4 AND quarantine_status='scan_pending'`, [adapter.name, persistableScanResultDetail("scan_unavailable", result.detail), args.policyId, args.accountId]);
          if (result.retry) await schedulePolicyScanRetry(args.accountId, args.policyId, result.retry);
        }
      }
      row = await getPolicyQuarantineRow(args.accountId, args.policyId);
    }
  }

  return { cleared: Boolean(row && isPolicyProcessingAllowed(row)), row };
}

/** Marks a document deleted (terminal quarantine state). Called by the
 * policy DELETE route BEFORE the row itself is removed, so the audit trail
 * survives even though the row does not, and so a scan result racing the
 * delete is rejected by recordPolicyScanResult()'s own CAS the instant this
 * commits (quarantine_status is no longer scan_pending). */
export async function markPolicyDocumentDeleted(accountId: string, policyId: string): Promise<void> {
  const row = await getPolicyQuarantineRow(accountId, policyId);
  if (!row || row.quarantine_status === "deleted") return;
  await query(`UPDATE policies SET quarantine_status='deleted', updated_at=now() WHERE id=$1 AND account_id=$2`, [policyId, accountId]);
  await appendPolicyDocumentAudit(accountId, {
    actor: "system", action: "deleted", policyId,
    previousValue: { quarantineStatus: row.quarantine_status }, newValue: { quarantineStatus: "deleted" },
  });
}

/** A corrected re-upload: the OLD document row is marked superseded (kept,
 * never deleted -- its audit history stays valid) and the NEW row already
 * carries supersedes_id from its own INSERT. Mirrors
 * lib/claims/evidence/store.ts's supersedeEvidenceDocument() exactly. */
export async function supersedePolicyDocument(args: { accountId: string; oldPolicyId: string; newPolicyId: string }): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE policies SET superseded_at=now(), updated_at=now() WHERE id=$1 AND account_id=$2`, [args.oldPolicyId, args.accountId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  await appendPolicyDocumentAudit(args.accountId, {
    actor: "system", action: "superseded", policyId: args.oldPolicyId,
    newValue: { supersededBy: args.newPolicyId },
  });
}

/**
 * Safe processing-failure storage. Household members can read their own rows
 * of policies, claim_evidence_documents and both audit logs directly (RLS),
 * so only these fixed, classified messages are ever written there. Raw
 * detail (provider responses, analysis ids, storage paths, stack fragments)
 * goes to the service-only processing_failure_diagnostics table
 * (sql/processing-failure-diagnostics.sql), which no browser role can read.
 */
import { query } from "@/lib/db/client";

export const POLICY_PROCESSING_FAILED_MESSAGE = "Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again.";
export const EVIDENCE_PROCESSING_FAILED_MESSAGE = "Processing stopped. DearPolicy kept the uploaded document; it can be processed again.";
export const SCAN_ATTEMPT_FAILED_MESSAGE = "The malware scan could not be completed; the document stays on hold.";

export type DiagnosticResourceType = "policy_document" | "claim_evidence" | "policy_scan" | "claim_evidence_scan";
const MAX_DETAIL = 2000;

/** Records raw failure detail server-side. Never throws: losing a
 * diagnostic must never turn a handled failure into an unhandled one. */
export async function recordProcessingFailure(args: {
  accountId: string; resourceType: DiagnosticResourceType; resourceId: string; failureCode: string; error: unknown;
}): Promise<void> {
  const errorClass = args.error instanceof Error ? args.error.name : typeof args.error;
  const detail = args.error instanceof Error ? args.error.message : typeof args.error === "string" ? args.error : null;
  try {
    await query(
      `INSERT INTO processing_failure_diagnostics(account_id,resource_type,resource_id,failure_code,error_class,detail) VALUES($1,$2,$3,$4,$5,$6)`,
      [args.accountId, args.resourceType, args.resourceId, args.failureCode.slice(0, 80), errorClass.slice(0, 80), detail ? detail.slice(0, MAX_DETAIL) : null],
    );
  } catch {
    console.warn(`processing-failure diagnostic could not be recorded (${args.resourceType}, ${errorClass})`);
  }
}

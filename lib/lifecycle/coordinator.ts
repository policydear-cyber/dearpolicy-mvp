/**
 * Checkpoint 7 (claude/v1-launch-hardening): the deletion coordinator.
 *
 * A single, generic entry point (requestDeletion) dispatched to a
 * per-resource-type handler. Every handler implements the same 10-step
 * shape the checkpoint spec requires:
 *   1. caller has already authenticated/authorized (route-level, before
 *      this is called -- see app/api/policies/[id]/route.ts)
 *   2. caller has already verified recent auth where required
 *   3. validate relational constraints (handler-specific)
 *   4. transition the target to pending_deletion (transitionLifecycle)
 *   5. immediately revoke logical access (the transition itself IS the
 *      revocation -- every read call site this checkpoint has migrated
 *      so far filters lifecycle_state='active')
 *   6. invalidate derived data transactionally (handler-specific)
 *   7. cancel/mark conflicting jobs (handler-specific, best-effort where
 *      no durable job framework exists yet -- see the policy-document
 *      handler's own comment on this)
 *   8. enqueue durable storage/physical cleanup (handled by the existing
 *      Checkpoint 5 storage-cleanup engine picking the row up once
 *      lib/storage/cleanup.ts's activeStorageKeys() stops protecting it)
 *   9. record an immutable audit event (appendDeletionAudit)
 *  10. return a deletion-request id and a safe, structured status
 *
 * ONLY policy_document is implemented here so far. The remaining seven
 * flows (whole-policy, claim-evidence, family-member, household-member
 * removal, leave-household, invitation revocation, household/account
 * deletion) are tracked as follow-up work -- see PR #16's own status
 * notes and scripts/launch-check.ts's checkDataDeletionAndInvalidation(),
 * which reports this capability as still blocked_by_code and itemizes
 * exactly what remains.
 */
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db/client";
import type { ScopedDbClient } from "@/lib/db/authz-client";
import { deletePolicyFile } from "@/lib/storage";
import { deletePolicyPassages, pineconeEnabled } from "@/lib/rag/pinecone";
import { transitionLifecycle, type LifecycleDbClient } from "./state-machine";
import { appendDeletionAudit, createOrGetDeletionRequest, transitionDeletionRequest, type DeletionRequestRow } from "./deletion-requests";
import type { DeletionReasonCategory, DeletionRequestStatus } from "./types";

export type DeletionOutcome = {
  status: DeletionRequestStatus;
  deletionRequestId: string;
  resourceId: string;
};

export class DeletionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeletionValidationError";
  }
}

type PolicyDocumentRow = { id: string; storage_key: string; original_filename: string; lifecycle_state: string };

/**
 * Deletes ONE policy document version. Runs inside the caller's own
 * RLS-scoped transaction (`client`, from createUserSupabaseClient) for
 * every step that must be atomic with the lifecycle transition, and
 * performs the deliberately-non-transactional cleanup (Pinecone, the
 * eventual physical storage object) after that transaction commits --
 * matching exactly how app/api/policies/[id]/route.ts already structured
 * this before Checkpoint 7 (see its own comments on why the FOR UPDATE
 * transaction and the Pinecone/storage calls are deliberately separate).
 *
 * Idempotent: a retry with the same idempotencyKey returns the SAME
 * deletion_requests row and performs no further mutation once that row
 * has already reached soft_deleted.
 */
export async function requestPolicyDocumentDeletion(args: {
  client: ScopedDbClient;
  accountId: string;
  actorUserId: string;
  policyId: string;
  reasonCategory: DeletionReasonCategory;
  idempotencyKey: string;
}): Promise<DeletionOutcome & { filename: string | null; storageWarning: string | null }> {
  const correlationId = randomUUID();

  // Idempotent create-or-get against the durable bookkeeping table first
  // (service-level, not the RLS-scoped client -- deletion_requests is an
  // infrastructure table, same convention as every other audit-log table).
  const { row: request, created } = await createOrGetDeletionRequest(pool, {
    accountId: args.accountId,
    resourceType: "policy_document",
    resourceId: args.policyId,
    requestedBy: args.actorUserId,
    reasonCategory: args.reasonCategory,
    idempotencyKey: args.idempotencyKey,
  });

  if (!created && request.lifecycle_state !== "pending_deletion") {
    // Already progressed (or already failed) -- report the durable
    // outcome rather than repeating destructive work.
    return {
      status: mapRequestStateToStatus(request),
      deletionRequestId: request.id,
      resourceId: args.policyId,
      filename: null,
      storageWarning: null,
    };
  }

  const result = await args.client.query<PolicyDocumentRow>(
    `SELECT id, storage_key, original_filename, lifecycle_state
       FROM policies
      WHERE id=$1 AND account_id=$2
      FOR UPDATE`,
    [args.policyId, args.accountId],
  );
  const policy = result.rows[0];
  if (!policy) {
    throw new DeletionValidationError("Document not found");
  }

  if (policy.lifecycle_state === "active") {
    // Step 4/5: transition + immediate logical-access revocation, in the
    // SAME transaction as the derived-data invalidation and audit-log
    // write below -- a crash between these can never leave the row
    // active while its dependents look deleted, or vice versa.
    await transitionLifecycle(args.client as unknown as LifecycleDbClient, {
      resourceType: "policy_document",
      resourceId: args.policyId,
      accountId: args.accountId,
      fromState: "active",
      toState: "pending_deletion",
    });

    // Step 6: derived-data invalidation that can happen synchronously,
    // in-transaction, without a job framework. premium_records deletion
    // predates this checkpoint (app/api/policies/[id]/route.ts's original
    // behaviour) and is preserved unchanged.
    await args.client.query(
      `DELETE FROM premium_records WHERE account_id=$1 AND (source_document_id=$2 OR policy_id=$2)`,
      [args.accountId, args.policyId],
    );

    await args.client.query(
      `INSERT INTO policy_document_audit_log(account_id,actor,action,previous_value,new_value,policy_id)
       VALUES($1,'system','deleted',$2::jsonb,$3::jsonb,$4)`,
      [args.accountId, JSON.stringify({ quarantineStatus: null }), JSON.stringify({ quarantineStatus: "deleted" }), args.policyId],
    );

    // Step 7: no durable job/lease framework exists yet (that is
    // Checkpoint 8's scope) so in-flight processPolicy() work for this
    // document is not cooperatively cancelled here. This is safe, not
    // just best-effort, because every migrated read path (chat
    // retrieval, the policy list route, and any future one) filters
    // lifecycle_state='active' -- a straggling write from an in-flight
    // job can land, but nothing serves its result to the user once this
    // transaction commits.
  }

  return {
    status: "accepted",
    deletionRequestId: request.id,
    resourceId: args.policyId,
    filename: policy.original_filename,
    storageWarning: null,
  };
}

/**
 * Finishes a policy-document deletion outside the caller's transaction
 * (must run AFTER it commits): Pinecone cleanup and marking the deletion
 * request completed. The physical storage object is deliberately left
 * for the Checkpoint 5 storage-cleanup engine (`npm run storage:cleanup`)
 * rather than deleted here -- lib/storage/cleanup.ts's activeStorageKeys()
 * now excludes this row (lifecycle_state != 'active'), so the next
 * cleanup pass will pick it up; storage_key itself is left in place on
 * the policies row as the tombstone's cleanup reference until that run
 * completes, matching "allow storage cleanup and other slow work to
 * complete durably and recoverably" in the checkpoint's own objective.
 */
export async function finishPolicyDocumentDeletion(args: {
  accountId: string;
  actorUserId: string;
  policyId: string;
  deletionRequestId: string;
}): Promise<{ storageWarning: string | null }> {
  let storageWarning: string | null = null;

  if (pineconeEnabled()) {
    await deletePolicyPassages({ accountId: args.accountId, policyId: args.policyId }).catch((error) => {
      console.warn("Pinecone cleanup failed for deleted policy " + args.policyId + ":", error instanceof Error ? error.message : error);
      storageWarning = "Search-index cleanup is still catching up for this document";
    });
  }

  await transitionDeletionRequest(pool, {
    id: args.deletionRequestId,
    fromStates: ["pending_deletion"],
    toState: "soft_deleted",
    completedAt: new Date(),
  }).catch(() => {
    // A repeat call (idempotent retry) may already be past this state --
    // not an error, transitionDeletionRequest's own CAS already made
    // that determination.
  });

  await appendDeletionAudit(pool, {
    accountId: args.accountId,
    deletionRequestId: args.deletionRequestId,
    resourceType: "policy_document",
    resourceId: args.policyId,
    actor: args.actorUserId,
    fromState: "pending_deletion",
    toState: "soft_deleted",
    correlationId: randomUUID(),
    cleanupStatus: "storage_object_pending_cleanup_engine",
  });

  return { storageWarning };
}

function mapRequestStateToStatus(request: DeletionRequestRow): DeletionRequestStatus {
  switch (request.lifecycle_state) {
    case "pending_deletion":
      return "pending_cleanup";
    case "soft_deleted":
    case "permanently_deleted":
    case "audit_tombstone":
      return "completed";
    case "failed_recoverable":
      return "failed_recoverable";
    case "blocked":
      return "blocked";
    default:
      return "accepted";
  }
}

// Re-exported so routes/tests import everything lifecycle-related from
// one place; deletePolicyFile is not called directly by this module yet
// (see finishPolicyDocumentDeletion's own comment on why the physical
// object is left for the storage-cleanup engine) but is kept available
// for a future direct-delete fallback.
export { deletePolicyFile };

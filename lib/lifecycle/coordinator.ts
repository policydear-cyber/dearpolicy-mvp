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
 * policy_document (a single document version) and policy (the whole
 * logical policy -- its full version chain plus any shared reference
 * document it orphans, see requestPolicyDeletion/resolvePolicyDeletionChain
 * below) are implemented here. The remaining six flows (claim-evidence,
 * family-member, household-member removal, leave-household, invitation
 * revocation, household/account deletion) are tracked as follow-up work
 * -- see PR #16's own status notes and scripts/launch-check.ts's
 * checkDataDeletionAndInvalidation(), which reports this capability as
 * still blocked_by_code and itemizes exactly what remains.
 */
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db/client";
import type { ScopedDbClient } from "@/lib/db/authz-client";
import { deletePolicyFile } from "@/lib/storage";
import { deletePolicyPassages, pineconeEnabled } from "@/lib/rag/pinecone";
import { transitionLifecycle, type LifecycleDbClient } from "./state-machine";
import { readIncludingDeletedForInternalUse } from "./scopes";
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

  // Deliberately reads regardless of lifecycle_state -- the coordinator
  // has to see a row that is already pending_deletion/soft_deleted to
  // make idempotent retries and recovery possible, which is exactly what
  // readIncludingDeletedForInternalUse() exists to name and document
  // rather than silently omit the active predicate.
  readIncludingDeletedForInternalUse("deletion_coordinator", "must read a policy document regardless of its current lifecycle state to validate/transition/retry a deletion request");
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

type PolicyChainCandidateRow = {
  id: string;
  family_member_id: string;
  personal_coverage_confirmed: boolean;
  supersedes_id: string | null;
  lifecycle_state: string;
};

/**
 * Resolves everything Flow 2 (whole-policy deletion) must treat as ONE
 * logical policy:
 *   1. The full version chain reachable from rootPolicyId by walking
 *      supersedes_id in both directions (a renewal/replacement upload
 *      points its NEW row at the OLD row's id -- see
 *      lib/policies/quarantine/store.ts's supersedePolicyDocument()).
 *   2. Shared reference/wording documents (personal_coverage_confirmed=
 *      false rows linked in via policy_members.source='scheme_reference_
 *      match' -- see lib/policies/linking.ts's linkRelatedReferenceDocuments())
 *      that this deletion would leave with zero remaining active
 *      authorized reference, which are cascaded into the same deletion
 *      so a shared master-wording document never lingers unreferenced.
 *
 * If a document EXPLICITLY targeted by the version chain is itself a
 * shared reference document still authorizing another active family
 * member's confirmed personal cover, the whole deletion is refused
 * (`blocked: true`, empty chain) rather than silently breaking that
 * other member's coverage -- "shared master wording is deleted only
 * when no active authorized reference remains" is enforced as a
 * precondition, not a best-effort cleanup.
 */
async function resolvePolicyDeletionChain(
  client: ScopedDbClient,
  accountId: string,
  rootPolicyId: string,
): Promise<{ chainIds: string[]; blocked: boolean }> {
  const cache = new Map<string, PolicyChainCandidateRow | null>();
  const load = async (id: string): Promise<PolicyChainCandidateRow | null> => {
    if (cache.has(id)) return cache.get(id) ?? null;
    const { rows } = await client.query<PolicyChainCandidateRow>(
      `SELECT id, family_member_id, personal_coverage_confirmed, supersedes_id, lifecycle_state
         FROM policies WHERE id=$1 AND account_id=$2`,
      [id, accountId],
    );
    const row = rows[0] ?? null;
    cache.set(id, row);
    return row;
  };

  const root = await load(rootPolicyId);
  if (!root) return { chainIds: [], blocked: false };

  // Step 1: the version chain. Lifecycle-state-agnostic on purpose (a
  // retry after a partial run must still find chain members that are
  // already pending_deletion/soft_deleted from the first attempt).
  const versionChain = new Set<string>([rootPolicyId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of [...versionChain]) {
      const row = await load(id);
      if (!row) continue;
      if (row.supersedes_id && !versionChain.has(row.supersedes_id)) {
        versionChain.add(row.supersedes_id);
        grew = true;
      }
      const { rows: newer } = await client.query<{ id: string }>(
        `SELECT id FROM policies WHERE account_id=$1 AND supersedes_id=$2`,
        [accountId, id],
      );
      for (const n of newer) {
        if (!versionChain.has(n.id)) {
          versionChain.add(n.id);
          grew = true;
        }
      }
    }
  }

  // Step 2: shared reference-document protection & orphan cascade.
  const chainIds = new Set<string>(versionChain);
  let blocked = false;
  grew = true;
  let iterations = 0;
  while (grew && iterations < 25 && !blocked) {
    grew = false;
    iterations++;
    const chainArray = [...chainIds];

    const { rows: candidates } = await client.query<{ id: string }>(
      `SELECT DISTINCT ref.id
         FROM policy_members pm
         JOIN policies ref ON ref.id=pm.policy_id AND ref.account_id=$1 AND ref.personal_coverage_confirmed=false
        WHERE pm.account_id=$1 AND pm.source='scheme_reference_match'
          AND pm.family_member_id IN (
            SELECT DISTINCT family_member_id FROM policy_members WHERE account_id=$1 AND policy_id=ANY($2::uuid[])
          )`,
      [accountId, chainArray],
    );
    const refCandidates = new Set<string>(candidates.map((c) => c.id));
    for (const id of chainArray) {
      const row = await load(id);
      if (row && row.personal_coverage_confirmed === false) refCandidates.add(id);
    }

    for (const refId of refCandidates) {
      const refRow = await load(refId);
      if (!refRow || refRow.lifecycle_state !== "active") continue;

      const { rows: remaining } = await client.query<{ family_member_id: string }>(
        `SELECT DISTINCT pm.family_member_id
           FROM policy_members pm
           JOIN family_members fm ON fm.id=pm.family_member_id AND fm.lifecycle_state='active'
          WHERE pm.account_id=$1 AND pm.policy_id=$2 AND pm.source='scheme_reference_match'
            AND EXISTS (
              SELECT 1 FROM policies personal
              JOIN policy_members pm2 ON pm2.policy_id=personal.id AND pm2.account_id=$1 AND pm2.family_member_id=pm.family_member_id
              WHERE personal.account_id=$1 AND personal.personal_coverage_confirmed=true
                AND personal.lifecycle_state='active' AND NOT (personal.id=ANY($3::uuid[]))
            )`,
        [accountId, refId, chainArray],
      );

      if (remaining.length > 0) {
        // Someone outside this deletion still has an active, confirmed
        // personal policy authorized by this reference document.
        if (versionChain.has(refId)) {
          // ...and it was EXPLICITLY targeted (the user's own request, or
          // a version of it) -- refuse the whole deletion rather than cut
          // off another family member's coverage silently.
          blocked = true;
        }
        // Otherwise it was only a cascade candidate: leave it alone.
        continue;
      }

      if (!chainIds.has(refId)) {
        chainIds.add(refId);
        grew = true;
      }
    }
    if (blocked) break;
  }

  return { chainIds: blocked ? [] : [...chainIds], blocked };
}

type PolicyChainLockedRow = { id: string; family_member_id: string; original_filename: string; lifecycle_state: string };

/** Supersedes every non-superseded cause/CI/disability definition-match
 * row citing one of the deleted policies -- "the OLD match cannot keep
 * unlocking anything" (sql/claim-evidence.sql's own invariant) applies
 * exactly as much to a deleted policy as to a corrected one. For any
 * claim_session this leaves with a stale, now-unsupported decision, the
 * session's cached decision_packet/pending_question is cleared and its
 * status is reset to 'fact_finding' -- the one non-terminal status this
 * codebase uses (see lib/claims/orchestrator.ts's saveClaimSession calls)
 * -- so the claim shows as needing fresh evidence/document rather than a
 * stale figure computed against a policy that no longer exists. Returns
 * the ids of every open (non-'complete') session actually reset. */
async function invalidateClaimMatchesForDeletedPolicies(
  client: ScopedDbClient,
  accountId: string,
  policyIds: string[],
): Promise<string[]> {
  const affectedSessions = new Set<string>();
  const MATCH_TABLES = ["claim_cause_definition_matches", "claim_ci_definition_matches", "claim_disability_definition_matches"] as const;
  for (const table of MATCH_TABLES) {
    const { rows } = await client.query<{ claim_session_id: string }>(
      `UPDATE ${table} SET superseded_at=now(), superseded_reason='policy_deleted'
        WHERE account_id=$1 AND contract_id=ANY($2::uuid[]) AND superseded_at IS NULL
       RETURNING claim_session_id`,
      [accountId, policyIds],
    );
    for (const r of rows) affectedSessions.add(r.claim_session_id);
  }
  if (!affectedSessions.size) return [];

  const { rows: reset } = await client.query<{ id: string }>(
    `UPDATE claim_sessions SET status='fact_finding', pending_question=NULL, decision_packet=NULL, updated_at=now()
      WHERE account_id=$1 AND id=ANY($2::uuid[]) AND status<>'complete'
     RETURNING id`,
    [accountId, [...affectedSessions]],
  );
  return reset.map((r) => r.id);
}

export type PolicyDeletionOutcome = DeletionOutcome & {
  filename: string | null;
  chainPolicyIds: string[];
  affectedFamilyMemberIds: string[];
  affectedOpenClaimSessionIds: string[];
  storageWarning: string | null;
};

/**
 * Deletes a WHOLE logical policy: every version in its supersedes_id
 * chain, plus any shared reference/wording document this leaves
 * orphaned (see resolvePolicyDeletionChain). Independent policies --
 * anything outside the resolved chain -- are never touched. Runs inside
 * the caller's own RLS-scoped transaction for every step that must be
 * atomic with the lifecycle transitions, matching
 * requestPolicyDocumentDeletion's own split between in-transaction work
 * here and the deliberately-non-transactional cleanup in
 * finishPolicyDeletion.
 *
 * Idempotent: a retry with the same idempotencyKey returns the SAME
 * deletion_requests row (keyed by the originally requested policyId,
 * resource_type='policy') and performs no further destructive work once
 * every chain member has already reached pending_deletion/soft_deleted.
 */
export async function requestPolicyDeletion(args: {
  client: ScopedDbClient;
  accountId: string;
  actorUserId: string;
  policyId: string;
  reasonCategory: DeletionReasonCategory;
  idempotencyKey: string;
}): Promise<PolicyDeletionOutcome> {
  const { row: request, created } = await createOrGetDeletionRequest(pool, {
    accountId: args.accountId,
    resourceType: "policy",
    resourceId: args.policyId,
    requestedBy: args.actorUserId,
    reasonCategory: args.reasonCategory,
    idempotencyKey: args.idempotencyKey,
  });

  if (!created && request.lifecycle_state !== "pending_deletion") {
    return {
      status: mapRequestStateToStatus(request),
      deletionRequestId: request.id,
      resourceId: args.policyId,
      filename: null,
      chainPolicyIds: [],
      affectedFamilyMemberIds: [],
      affectedOpenClaimSessionIds: [],
      storageWarning: null,
    };
  }

  // Deliberately reads/writes regardless of lifecycle_state -- same
  // justification as requestPolicyDocumentDeletion: resolving the full
  // chain and making retries idempotent both require seeing rows that
  // may already be pending_deletion/soft_deleted from a prior attempt.
  readIncludingDeletedForInternalUse(
    "deletion_coordinator",
    "must resolve the whole-policy version chain and reference-document graph, and read chain members regardless of their current lifecycle state to validate/transition/retry a whole-policy deletion request",
  );

  const { chainIds, blocked } = await resolvePolicyDeletionChain(args.client, args.accountId, args.policyId);

  if (blocked) {
    throw new DeletionValidationError(
      "This policy is shared reference wording still authorizing another family member's confirmed cover, so it cannot be deleted while that reference is active.",
    );
  }
  if (!chainIds.length) {
    throw new DeletionValidationError("Policy not found");
  }

  const orderedIds = [...chainIds].sort();
  const { rows: lockedRows } = await args.client.query<PolicyChainLockedRow>(
    `SELECT id, family_member_id, original_filename, lifecycle_state
       FROM policies WHERE id=ANY($1::uuid[]) AND account_id=$2
       FOR UPDATE`,
    [orderedIds, args.accountId],
  );

  const rootRow = lockedRows.find((r) => r.id === args.policyId) ?? null;
  const affectedFamilyMemberIds = [...new Set(lockedRows.map((r) => r.family_member_id))];

  for (const row of lockedRows) {
    if (row.lifecycle_state !== "active") continue; // already transitioned by a prior partial run

    // Step 4/5: transition + immediate logical-access revocation, in the
    // SAME transaction as the derived-data invalidation below.
    await transitionLifecycle(args.client as unknown as LifecycleDbClient, {
      resourceType: "policy",
      resourceId: row.id,
      accountId: args.accountId,
      fromState: "active",
      toState: "pending_deletion",
    });

    // Step 6: derived-data invalidation that can happen synchronously,
    // in-transaction, without a job framework. Everything else derived
    // from a policy (pages, chunks, coverages, benefit rules, reference
    // coverages, detected people, corrections, member links) has no
    // lifecycle_state of its own and is invalidated TRANSITIVELY: every
    // read this checkpoint has migrated to activePredicate() stops
    // returning it the instant its parent policy row above is no longer
    // 'active'. premium_records is the one exception (it predates the
    // lifecycle column and is still hard-deleted here, same as
    // requestPolicyDocumentDeletion).
    await args.client.query(
      `DELETE FROM premium_records WHERE account_id=$1 AND (source_document_id=$2 OR policy_id=$2)`,
      [args.accountId, row.id],
    );

    await args.client.query(
      `INSERT INTO policy_document_audit_log(account_id,actor,action,previous_value,new_value,policy_id)
       VALUES($1,'system','deleted',$2::jsonb,$3::jsonb,$4)`,
      [args.accountId, JSON.stringify({ quarantineStatus: null }), JSON.stringify({ quarantineStatus: "deleted" }), row.id],
    );

    // Step 7: no durable job/lease framework exists yet (Checkpoint 8) so
    // in-flight processPolicy() work for this document is not
    // cooperatively cancelled here -- safe for the same reason as the
    // policy_document flow: every migrated read filters
    // lifecycle_state='active', so a straggling write can land but is
    // never served to a user once this transaction commits.
  }

  // An open claim that had a confirmed determination against one of
  // these policies must never keep showing that stale result once the
  // policy is gone -- reset it to a safe, needs-document state.
  const affectedOpenClaimSessionIds = await invalidateClaimMatchesForDeletedPolicies(args.client, args.accountId, orderedIds);

  return {
    status: "accepted",
    deletionRequestId: request.id,
    resourceId: args.policyId,
    filename: rootRow?.original_filename ?? null,
    chainPolicyIds: orderedIds,
    affectedFamilyMemberIds,
    affectedOpenClaimSessionIds,
    storageWarning: null,
  };
}

/**
 * Finishes a whole-policy deletion outside the caller's transaction
 * (must run AFTER it commits): Pinecone cleanup for every chain member
 * and marking the deletion request completed. Physical storage objects
 * are left for the Checkpoint 5 storage-cleanup engine, same as
 * finishPolicyDocumentDeletion -- lib/storage/cleanup.ts's
 * activeStorageKeys() already excludes every chain row once its
 * lifecycle_state left 'active' above.
 */
export async function finishPolicyDeletion(args: {
  accountId: string;
  actorUserId: string;
  policyId: string;
  chainPolicyIds: string[];
  deletionRequestId: string;
}): Promise<{ storageWarning: string | null }> {
  let storageWarning: string | null = null;

  if (pineconeEnabled()) {
    for (const id of args.chainPolicyIds) {
      await deletePolicyPassages({ accountId: args.accountId, policyId: id }).catch((error) => {
        console.warn("Pinecone cleanup failed for deleted policy " + id + ":", error instanceof Error ? error.message : error);
        storageWarning = "Search-index cleanup is still catching up for this document";
      });
    }
  }

  await transitionDeletionRequest(pool, {
    id: args.deletionRequestId,
    fromStates: ["pending_deletion"],
    toState: "soft_deleted",
    completedAt: new Date(),
  }).catch(() => {
    // A repeat call (idempotent retry) may already be past this state.
  });

  await appendDeletionAudit(pool, {
    accountId: args.accountId,
    deletionRequestId: args.deletionRequestId,
    resourceType: "policy",
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

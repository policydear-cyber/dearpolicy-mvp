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
 * policy_document (a single document version), policy (the whole
 * logical policy -- its full version chain plus any shared reference
 * document it orphans, see requestPolicyDeletion/resolvePolicyDeletionChain
 * below), claim_evidence (one claim-evidence document, see
 * requestClaimEvidenceDeletion), family_member (one family-member
 * profile -- refused rather than cascaded whenever it has any linked
 * policy/claim/coverage/chat activity, see requestFamilyMemberDeletion),
 * household_member (an owner removing another member, see
 * requestHouseholdMemberRemoval), household_leave (a member removing
 * themselves, see requestHouseholdLeave -- both wrap the same
 * lib/household/repo.ts's removeMember(), which already owns the
 * last-owner-protection business rule and is deliberately not
 * reimplemented here), and invitation (revoking a still-pending
 * invitation, see requestInvitationRevocation -- wraps
 * lib/household/repo.ts's revokeInvitation() the same way), and household
 * (the whole account, see requestHouseholdDeletion -- wraps
 * lib/household/repo.ts's deleteHousehold(); see that function's own doc
 * comment for why this flow, alone among the eight, keeps an immediate
 * hard delete rather than a deferred soft-delete) are implemented here.
 * All 8 deletion flows this checkpoint's LIFECYCLE_RESOURCE_TYPES
 * anticipated are now implemented -- see scripts/launch-check.ts's
 * checkDataDeletionAndInvalidation() for the up-to-date per-flow report.
 */
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db/client";
import type { ScopedDbClient } from "@/lib/db/authz-client";
import { deletePolicyFile } from "@/lib/storage";
import { enqueueStoragePurge, purgeSoon } from "@/lib/storage/purge";
import { deleteHouseholdPassages, pineconeEnabled } from "@/lib/rag/pinecone";
import { scrubDeletedDocuments } from "./content-scrub";
import { transitionLifecycle, type LifecycleDbClient } from "./state-machine";
import { activePredicate, readIncludingDeletedForInternalUse } from "./scopes";
import { appendDeletionAudit, createOrGetDeletionRequest, transitionDeletionRequest, type DeletionRequestRow } from "./deletion-requests";
import { appendClaimEvidenceAudit } from "@/lib/claims/evidence/audit";
import { appendPolicyDocumentAudit } from "@/lib/policies/quarantine/audit";
import { scrubDeletedDocumentDerivedContent } from "./derived-content-scrub";
import { recordEvent } from "@/lib/telemetry";

/** Deleting a document must not leave side-channel traces of it behind.
 *
 * Two stores are keyed by the document's id rather than FK-linked to it, so
 * nothing else ever cleans them: policy_analysis_cache (chat analysis and
 * catalogue checkpoints for the document) and the document's durable
 * background_jobs row, whose payload can hold the PDF password the person
 * typed at upload. This sweep deletes the cache rows, strips the password
 * from the job payload immediately and asks any in-flight run to stop
 * (cooperative cancel); the job row itself stays, password-free, as part of
 * the operational record. It runs on the TRUSTED connection because both
 * tables are service-only (browser roles cannot touch them -- see
 * scripts/infrastructure-table-permissions-regressions.ts), and it is
 * best-effort: hygiene must never fail a deletion the person asked for.
 * The to_regclass pre-check exists for regression databases that load only
 * a schema subset; live databases always have both tables. */
async function sweepDeletedDocumentSideChannels(accountId: string, policyId: string) {
  try {
    const present = await pool.query<{ kv: boolean; jobs: boolean }>(
      `SELECT to_regclass('public.policy_analysis_cache') IS NOT NULL AS kv,
              to_regclass('public.background_jobs') IS NOT NULL AS jobs`,
    );
    if (present.rows[0]?.kv) {
      await pool.query(
        `DELETE FROM policy_analysis_cache WHERE account_id=$1 AND cache_key LIKE '%'||$2||'%'`,
        [accountId, policyId],
      );
    }
    if (present.rows[0]?.jobs) {
      await pool.query(
        `UPDATE background_jobs SET payload=payload-'pdfPassword', cancel_requested=true, updated_at=now()
          WHERE account_id=$1 AND job_type='policy_processing' AND idempotency_key=$2`,
        [accountId, policyId],
      );
    }
  } catch (error) {
    console.warn(`side-channel sweep failed for deleted policy ${policyId}:`, error instanceof Error ? error.message : error);
  }
}
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { removeMember, revokeInvitation, deleteHousehold, NotFoundError } from "@/lib/household/repo";
import type { DeletionReasonCategory, DeletionRequestStatus } from "./types";
import { scrubDeletedDocumentClaimSnapshots } from "./claim-snapshot-scrub";

/** Round 5: once a document deletion has completed, its stored file is
 * removed -- queued durably first (lib/storage/purge.ts), then removed right
 * away; anything that fails is retried by the request drain. Never fails the
 * deletion itself. */
async function purgeDeletedObjects(table: "policies" | "claim_evidence_documents", accountId: string, ids: string[]) {
  try {
    const rows = await pool.query<{ storage_key: string | null }>(
      `SELECT storage_key FROM ${table} WHERE account_id=$1 AND id=ANY($2::uuid[]) AND lifecycle_state IN ('soft_deleted','permanently_deleted','audit_tombstone') AND storage_key IS NOT NULL`, [accountId, ids]);
    await enqueueStoragePurge(rows.rows.map((r) => ({ domain: table === "policies" ? "policy" as const : "claim-evidence" as const, storageKey: r.storage_key as string })), "document_deleted");
    await purgeSoon();
  } catch (error) {
    console.warn("storage purge after deletion was not completed now; it will be retried:", error instanceof Error ? error.name : "unknown");
  }
}

/** Once a policy deletion request has completed, the documents' content really goes (lib/lifecycle/content-scrub.ts):
 * the rows become soft_deleted, their search passages leave Pinecone, everything read from them is hard-deleted, and
 * their stored files are queued and removed now. Whatever fails here is retried by the request drain. Never throws. */
async function scrubAndPurgeDeletedPolicies(policyIds: string[]): Promise<string | null> {
  const scrub = await scrubDeletedDocuments({ policyIds, deletionFinished: true });
  await purgeSoon();
  return scrub.searchIndexPending.length || scrub.failed ? "Search-index cleanup is still catching up for this document" : null;
}

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
  // FOR NO KEY UPDATE, never FOR UPDATE, in every deletion transaction in
  // this file: the audit write below goes through the SERVICE pool (a
  // different connection), and its foreign key to this row takes FOR KEY
  // SHARE, which FOR UPDATE blocks. With FOR UPDATE the request waits on its
  // own second connection forever (an application-level deadlock Postgres
  // cannot detect) while holding the row lock. FOR NO KEY UPDATE still
  // serialises concurrent deletions/updates of the row.
  const result = await args.client.query<PolicyDocumentRow>(
    `SELECT id, storage_key, original_filename, lifecycle_state
       FROM policies
      WHERE id=$1 AND account_id=$2
      FOR NO KEY UPDATE`,
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
    await sweepDeletedDocumentSideChannels(args.accountId, args.policyId);

    // The audit trail has one writer, the trusted server connection
    // (sql/household-rls.sql: browser sessions may only read it).
    await appendPolicyDocumentAudit(args.accountId, {
      actor: "system", action: "deleted", previousValue: { quarantineStatus: null }, newValue: { quarantineStatus: "deleted" }, policyId: args.policyId,
    });

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
  // Claim calculations that used the document keep which calculation it was, never what it said (never throws).
  await scrubDeletedDocumentClaimSnapshots({ policyIds: [args.policyId] });

  const correlationId = randomUUID();
  // What chat answers and the coverage ledger took from the document goes too (never throws; retried by the drain).
  await scrubDeletedDocumentDerivedContent({ policyIds: [args.policyId] });

  await appendDeletionAudit(pool, {
    accountId: args.accountId,
    deletionRequestId: args.deletionRequestId,
    resourceType: "policy_document",
    resourceId: args.policyId,
    actor: args.actorUserId,
    fromState: "pending_deletion",
    toState: "soft_deleted",
    correlationId,
    cleanupStatus: "storage_object_pending_cleanup_engine",
  });

  await recordEvent({
    name: "lifecycle.deletion.finished",
    correlationId,
    status: "success",
    processingState: "soft_deleted",
    resourceRef: pseudonymizeId(args.policyId),
    householdRef: pseudonymizeId(args.accountId),
    extra: { resourceType: "policy_document" },
  });

  storageWarning = await scrubAndPurgeDeletedPolicies([args.policyId]);
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
  return invalidateClaimMatchesReferencing(client, accountId, { contractIds: policyIds });
}
/** Generalized form of the match-invalidation logic Flow 2 (whole-policy
 * deletion) introduced: supersedes every non-superseded cause/CI/
 * disability definition-match row citing ANY of the given deleted
 * contracts (policies) and/or deleted evidence documents -- either
 * reference going stale is exactly the same "cannot keep unlocking
 * anything" problem, since loadActiveCauseDefinitionMatches() and its
 * CI/disability siblings (lib/claims/evidence/store.ts) only filter
 * superseded_at IS NULL, with no JOIN back to policies or
 * claim_evidence_documents to catch a deleted contract or evidence
 * document on their own. For any claim_session this leaves with a stale,
 * now-unsupported decision that is still OPEN, its cached decision_packet/
 * pending_question is cleared and status reset to 'fact_finding'. Returns
 * the ids of every open session actually reset. */
async function invalidateClaimMatchesReferencing(
  client: ScopedDbClient,
  accountId: string,
  refs: { contractIds?: string[]; evidenceDocumentIds?: string[] },
): Promise<string[]> {
  const contractIds = refs.contractIds ?? [];
  const evidenceDocumentIds = refs.evidenceDocumentIds ?? [];
  if (!contractIds.length && !evidenceDocumentIds.length) return [];

  const affectedSessions = new Set<string>();
  const MATCH_TABLES = ["claim_cause_definition_matches", "claim_ci_definition_matches", "claim_disability_definition_matches"] as const;
  for (const table of MATCH_TABLES) {
    if (contractIds.length) {
      const { rows } = await client.query<{ claim_session_id: string }>(
        `UPDATE ${table} SET superseded_at=now(), superseded_reason='policy_deleted'
          WHERE account_id=$1 AND contract_id=ANY($2::uuid[]) AND superseded_at IS NULL
         RETURNING claim_session_id`,
        [accountId, contractIds],
      );
      for (const r of rows) affectedSessions.add(r.claim_session_id);
    }
    if (evidenceDocumentIds.length) {
      const { rows } = await client.query<{ claim_session_id: string }>(
        `UPDATE ${table} SET superseded_at=now(), superseded_reason='evidence_deleted'
          WHERE account_id=$1 AND evidence_document_id=ANY($2::uuid[]) AND superseded_at IS NULL
         RETURNING claim_session_id`,
        [accountId, evidenceDocumentIds],
      );
      for (const r of rows) affectedSessions.add(r.claim_session_id);
    }
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

type ClaimEvidenceRow = { id: string; family_member_id: string; claim_session_id: string; original_filename: string; storage_key: string; lifecycle_state: string };

export type ClaimEvidenceDeletionOutcome = DeletionOutcome & {
  filename: string | null;
  affectedOpenClaimSessionIds: string[];
};

/**
 * Deletes ONE claim-evidence document (resource_type='claim_evidence',
 * table claim_evidence_documents -- already lifecycle-tracked, see
 * lib/lifecycle/types.ts's LIFECYCLE_TABLE_BY_RESOURCE). Unlike Flow 2,
 * this is deliberately a single-document action, not a whole-chain one:
 * an evidence document's own supersedes_id/superseded_at pair (set by
 * lib/claims/evidence/store.ts's supersedeEvidenceDocument() on a
 * re-upload) is business-level version history that this codebase's own
 * comments say must stay "intact and inspectable" for audit -- a
 * superseded-but-not-deleted row is not itself a target of this flow,
 * and deleting the CURRENT version of a slot never reaches back into its
 * own superseded predecessors.
 *
 * Runs inside the caller's own RLS-scoped transaction for every step
 * that must be atomic with the lifecycle transition, matching every
 * other flow's split between in-transaction work here and the
 * deliberately-non-transactional cleanup in finishClaimEvidenceDeletion.
 * There is no Pinecone/vector index to clean up for this resource type
 * (claim-evidence documents are never chunked/embedded, unlike policy
 * documents), so finishing this flow is lighter than the policy flows.
 *
 * Idempotent: a retry with the same idempotencyKey returns the SAME
 * deletion_requests row and performs no further mutation once the
 * document has already reached soft_deleted.
 */
export async function requestClaimEvidenceDeletion(args: {
  client: ScopedDbClient;
  accountId: string;
  actorUserId: string;
  evidenceDocumentId: string;
  reasonCategory: DeletionReasonCategory;
  idempotencyKey: string;
}): Promise<ClaimEvidenceDeletionOutcome> {
  const { row: request, created } = await createOrGetDeletionRequest(pool, {
    accountId: args.accountId,
    resourceType: "claim_evidence",
    resourceId: args.evidenceDocumentId,
    requestedBy: args.actorUserId,
    reasonCategory: args.reasonCategory,
    idempotencyKey: args.idempotencyKey,
  });

  if (!created && request.lifecycle_state !== "pending_deletion") {
    return {
      status: mapRequestStateToStatus(request),
      deletionRequestId: request.id,
      resourceId: args.evidenceDocumentId,
      filename: null,
      affectedOpenClaimSessionIds: [],
    };
  }

  // Deliberately reads regardless of lifecycle_state -- same
  // justification as every other flow: idempotent retries and recovery
  // both require seeing a row that may already be pending_deletion/
  // soft_deleted from a prior attempt.
  readIncludingDeletedForInternalUse(
    "deletion_coordinator",
    "must read a claim-evidence document regardless of its current lifecycle state to validate/transition/retry a deletion request",
  );
  const result = await args.client.query<ClaimEvidenceRow>(
    `SELECT id, family_member_id, claim_session_id, original_filename, storage_key, lifecycle_state
       FROM claim_evidence_documents
      WHERE id=$1 AND account_id=$2
      FOR NO KEY UPDATE`,
    [args.evidenceDocumentId, args.accountId],
  );
  const doc = result.rows[0];
  if (!doc) {
    throw new DeletionValidationError("Evidence document not found");
  }

  if (doc.lifecycle_state === "active") {
    // Step 4/5: transition + immediate logical-access revocation, in the
    // SAME transaction as the match-invalidation below -- every read
    // this checkpoint has migrated (getEvidenceDocument,
    // listEvidenceDocuments, etc. in lib/claims/evidence/store.ts)
    // already filters lifecycle_state='active'.
    await transitionLifecycle(args.client as unknown as LifecycleDbClient, {
      resourceType: "claim_evidence",
      resourceId: doc.id,
      accountId: args.accountId,
      fromState: "active",
      toState: "pending_deletion",
    });
  }

  // Step 6: derived-data invalidation. loadActiveCauseDefinitionMatches()
  // and its CI/disability siblings only filter superseded_at IS NULL --
  // they do not join back to claim_evidence_documents -- so a match
  // citing this evidence document must be explicitly superseded or it
  // would keep being read (and keep unlocking a claim amount) even after
  // its source document is gone.
  const affectedOpenClaimSessionIds = await invalidateClaimMatchesReferencing(args.client, args.accountId, {
    evidenceDocumentIds: [doc.id],
  });

  // Step 9 (partial, in-transaction): the append-only claim-evidence
  // audit trail has exactly one writer (lib/claims/evidence/audit.ts's
  // appendClaimEvidenceAudit -- "the one place allowed to write to
  // claim_evidence_audit_log"), so the deletion event goes through it
  // rather than a raw INSERT here, unlike policy_document_audit_log
  // (which this coordinator already writes directly for the policy
  // flows -- that table has no such single-writer convention).
  await appendClaimEvidenceAudit(args.accountId, {
    actor: args.actorUserId,
    action: "deleted",
    previousValue: { lifecycleState: "active" },
    newValue: { lifecycleState: "pending_deletion" },
    evidenceDocumentId: doc.id,
    claimSessionId: doc.claim_session_id,
  });

  return {
    status: "accepted",
    deletionRequestId: request.id,
    resourceId: args.evidenceDocumentId,
    filename: doc.original_filename,
    affectedOpenClaimSessionIds,
  };
}

/**
 * Finishes a claim-evidence deletion outside the caller's transaction:
 * marks the deletion request completed. The physical storage object is
 * deliberately left for the Checkpoint 5 storage-cleanup engine, same
 * convention as the policy flows -- lib/storage/cleanup.ts's
 * activeStorageKeys(db, "claim-evidence") already excludes this row the
 * instant its lifecycle_state left 'active' above (that domain's
 * predicate, ` AND lifecycle_state='active'`, was already wired in
 * Checkpoint 5, ahead of this flow existing).
 */
export async function finishClaimEvidenceDeletion(args: {
  accountId: string;
  actorUserId: string;
  evidenceDocumentId: string;
  deletionRequestId: string;
}): Promise<void> {
  await transitionDeletionRequest(pool, {
    id: args.deletionRequestId,
    fromStates: ["pending_deletion"],
    toState: "soft_deleted",
    completedAt: new Date(),
  }).catch(() => {
    // A repeat call (idempotent retry) may already be past this state.
  });

  const correlationId = randomUUID();

  await appendDeletionAudit(pool, {
    accountId: args.accountId,
    deletionRequestId: args.deletionRequestId,
    resourceType: "claim_evidence",
    resourceId: args.evidenceDocumentId,
    actor: args.actorUserId,
    fromState: "pending_deletion",
    toState: "soft_deleted",
    correlationId,
    cleanupStatus: "storage_object_pending_cleanup_engine",
  });

  await recordEvent({
    name: "lifecycle.deletion.finished",
    correlationId,
    status: "success",
    processingState: "soft_deleted",
    resourceRef: pseudonymizeId(args.evidenceDocumentId),
    householdRef: pseudonymizeId(args.accountId),
    extra: { resourceType: "claim_evidence" },
  });
  await purgeDeletedObjects("claim_evidence_documents", args.accountId, [args.evidenceDocumentId]);
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
       FOR NO KEY UPDATE`,
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
    await sweepDeletedDocumentSideChannels(args.accountId, row.id);

    await appendPolicyDocumentAudit(args.accountId, {
      actor: "system", action: "deleted", previousValue: { quarantineStatus: null }, newValue: { quarantineStatus: "deleted" }, policyId: row.id,
    });

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

  await transitionDeletionRequest(pool, {
    id: args.deletionRequestId,
    fromStates: ["pending_deletion"],
    toState: "soft_deleted",
    completedAt: new Date(),
  }).catch(() => {
    // A repeat call (idempotent retry) may already be past this state.
  });
  // Claim calculations that used these documents keep which calculation it was, never what it said (never throws).
  await scrubDeletedDocumentClaimSnapshots({ policyIds: args.chainPolicyIds.length ? args.chainPolicyIds : [args.policyId] });

  const correlationId = randomUUID();
  // What chat answers and the coverage ledger took from these documents goes too (never throws; retried by the drain).
  await scrubDeletedDocumentDerivedContent({ policyIds: args.chainPolicyIds.length ? args.chainPolicyIds : [args.policyId] });

  await appendDeletionAudit(pool, {
    accountId: args.accountId,
    deletionRequestId: args.deletionRequestId,
    resourceType: "policy",
    resourceId: args.policyId,
    actor: args.actorUserId,
    fromState: "pending_deletion",
    toState: "soft_deleted",
    correlationId,
    cleanupStatus: "storage_object_pending_cleanup_engine",
  });

  await recordEvent({
    name: "lifecycle.deletion.finished",
    correlationId,
    status: "success",
    processingState: "soft_deleted",
    resourceRef: pseudonymizeId(args.policyId),
    householdRef: pseudonymizeId(args.accountId),
    extra: { resourceType: "policy", chainSize: args.chainPolicyIds.length },
  });

  storageWarning = await scrubAndPurgeDeletedPolicies(args.chainPolicyIds.length ? args.chainPolicyIds : [args.policyId]);
  return { storageWarning };
}

export class HasLinkedActivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HasLinkedActivityError";
  }
}

type FamilyMemberRow = {
  id: string;
  relationship: string;
  display_name: string;
  lifecycle_state: string;
};

export type FamilyMemberDeletionOutcome = DeletionOutcome & {
  displayName: string | null;
};

/**
 * Deletes a single family-member profile (resource_type='family_member',
 * table family_members -- already lifecycle-tracked, see
 * lib/lifecycle/types.ts's LIFECYCLE_TABLE_BY_RESOURCE). Migrates the
 * hard, irrecoverable `DELETE FROM family_members` previously done
 * directly in app/api/family/[id]/route.ts's DELETE handler onto this
 * checkpoint's CAS state machine (pending_deletion, recoverable window,
 * audited, idempotent) -- family_members was already migrated for READS
 * (lib/lifecycle/scopes.ts's activePredicate() call sites) but its own
 * deletion path still bypassed the lifecycle machinery entirely, doing
 * an immediate, unrecoverable row delete with no deletion_requests
 * bookkeeping and no audit trail. That real gap is what this flow
 * closes.
 *
 * Preserves, unchanged, the pre-existing product rule the original route
 * enforced: deletion is REFUSED (not cascaded) whenever the profile has
 * any real linked activity -- an uploaded policy, a policy-ownership
 * link, chat history, a claim session, a coverage-ledger rule, or a
 * premium record. That rule predates this checkpoint and its own
 * route-level comment explains why: silently cascading a delete through
 * a family member's policy documents and claim history in a family
 * insurance app is exactly the kind of data loss that must never be a
 * single click. This flow keeps that refusal as a precondition checked
 * BEFORE any mutation, consistent with how Flow 2 refuses rather than
 * cascades through a still-authorizing shared reference document.
 *
 * Idempotent: a retry with the same idempotencyKey returns the SAME
 * deletion_requests row and performs no further mutation once the
 * profile has already reached soft_deleted.
 */
export async function requestFamilyMemberDeletion(args: {
  client: ScopedDbClient;
  accountId: string;
  actorUserId: string;
  familyMemberId: string;
  reasonCategory: DeletionReasonCategory;
  idempotencyKey: string;
}): Promise<FamilyMemberDeletionOutcome> {
  const { row: request, created } = await createOrGetDeletionRequest(pool, {
    accountId: args.accountId,
    resourceType: "family_member",
    resourceId: args.familyMemberId,
    requestedBy: args.actorUserId,
    reasonCategory: args.reasonCategory,
    idempotencyKey: args.idempotencyKey,
  });

  if (!created && request.lifecycle_state !== "pending_deletion") {
    return {
      status: mapRequestStateToStatus(request),
      deletionRequestId: request.id,
      resourceId: args.familyMemberId,
      displayName: null,
    };
  }

  // Deliberately reads regardless of lifecycle_state -- same
  // justification as every other flow: idempotent retries and recovery
  // both require seeing a row that may already be pending_deletion/
  // soft_deleted from a prior attempt.
  readIncludingDeletedForInternalUse(
    "deletion_coordinator",
    "must read a family member regardless of its current lifecycle state to validate/transition/retry a deletion request",
  );
  const result = await args.client.query<FamilyMemberRow>(
    `SELECT id, relationship, display_name, lifecycle_state
       FROM family_members
      WHERE id=$1 AND account_id=$2
      FOR NO KEY UPDATE`,
    [args.familyMemberId, args.accountId],
  );
  const member = result.rows[0];
  if (!member) {
    throw new DeletionValidationError("Family member not found");
  }

  if (member.lifecycle_state === "active") {
    // Step 3: validate relational constraints BEFORE any mutation --
    // the exact same usage count app/api/family/[id]/route.ts's DELETE
    // handler computed, now the coordinator's own precondition rather
    // than a route-level check that bypassed the lifecycle machinery.
    // Only `policies` carries its own lifecycle_state among these
    // tables, so it is scoped by activePredicate() -- both directly and
    // through policy_members (a link to a policy that has already been
    // deleted is not "linked activity": otherwise a person who deletes the
    // only document linked to a profile can never delete that profile,
    // and the UI offers nothing left to remove). The
    // others (chat_conversations, claim_sessions,
    // coverage_rules, premium_records) have no lifecycle column of
    // their own and are counted as-is, exactly matching prior behavior.
    const usage = await args.client.query<{ n: number }>(
      `SELECT (
          (SELECT count(*) FROM policies WHERE family_member_id=$1 AND ${activePredicate()})
        + (SELECT count(*) FROM policy_members pm JOIN policies p ON p.id=pm.policy_id AND p.account_id=pm.account_id
            WHERE pm.family_member_id=$1 AND ${activePredicate("p")})
        + (SELECT count(*) FROM chat_conversations WHERE family_member_id=$1)
        + (SELECT count(*) FROM claim_sessions WHERE family_member_id=$1)
        + (SELECT count(*) FROM coverage_rules WHERE family_member_id=$1)
        + (SELECT count(*) FROM premium_records WHERE family_member_id=$1)
       )::int AS n`,
      [args.familyMemberId],
    );
    if ((usage.rows[0]?.n ?? 0) > 0) {
      throw new HasLinkedActivityError("This profile has linked documents or activity, so it can't be deleted. Remove those first.");
    }

    // Step 4/5: transition + immediate logical-access revocation -- every
    // read this checkpoint has migrated for this table (lib/lifecycle/
    // scopes.ts's activePredicate() call sites) already filters
    // lifecycle_state='active'.
    await transitionLifecycle(args.client as unknown as LifecycleDbClient, {
      resourceType: "family_member",
      resourceId: member.id,
      accountId: args.accountId,
      fromState: "active",
      toState: "pending_deletion",
    });
  }

  // Step 6: no derived data to invalidate here -- the precondition above
  // guarantees zero policies/claims/coverage rows reference this member
  // by the time the transition above runs, so nothing else could keep
  // surfacing stale results.
  // Step 9: no dedicated per-resource audit table exists for
  // family_members (unlike policy_document_audit_log/
  // claim_evidence_audit_log) -- the shared deletion_audit_log written
  // in finishFamilyMemberDeletion() below is this flow's only audit
  // trail, same convention as every flow with no dedicated table of its
  // own.

  return {
    status: "accepted",
    deletionRequestId: request.id,
    resourceId: args.familyMemberId,
    displayName: member.display_name,
  };
}

/**
 * Finishes a family-member deletion outside the caller's transaction:
 * marks the deletion request completed and writes the audit event.
 * Unlike the policy/claim-evidence flows, there is no storage object or
 * search-index entry belonging directly to a family_members row itself
 * (those belong to the policies/claim-evidence rows this flow's own
 * precondition guarantees are already absent), so there is nothing for
 * the storage-cleanup engine to pick up here -- this flow finishes
 * immediately rather than staying pending_cleanup.
 */
export async function finishFamilyMemberDeletion(args: {
  accountId: string;
  actorUserId: string;
  familyMemberId: string;
  deletionRequestId: string;
}): Promise<void> {
  await transitionDeletionRequest(pool, {
    id: args.deletionRequestId,
    fromStates: ["pending_deletion"],
    toState: "soft_deleted",
    completedAt: new Date(),
  }).catch(() => {
    // A repeat call (idempotent retry) may already be past this state.
  });

  const correlationId = randomUUID();

  await appendDeletionAudit(pool, {
    accountId: args.accountId,
    deletionRequestId: args.deletionRequestId,
    resourceType: "family_member",
    resourceId: args.familyMemberId,
    actor: args.actorUserId,
    fromState: "pending_deletion",
    toState: "soft_deleted",
    correlationId,
    cleanupStatus: null,
  });

  await recordEvent({
    name: "lifecycle.deletion.finished",
    correlationId,
    status: "success",
    processingState: "soft_deleted",
    resourceRef: pseudonymizeId(args.familyMemberId),
    householdRef: pseudonymizeId(args.accountId),
    extra: { resourceType: "family_member" },
  });
}

/**
 * Household-member removal (resource_type='household_member', an owner
 * removing someone else) and leave-household (resource_type=
 * 'household_leave', a member removing themselves) both compile down to
 * the SAME underlying operation -- lib/household/repo.ts's removeMember()
 * already treats them as one DELETE, distinguished only by whether
 * callerUserId===targetUserId, with RLS's household_members_delete
 * policy (not this coordinator) enforcing who's allowed to do which.
 * household_members has no id column of its own (its primary key is the
 * composite (household_id, user_id)) and, per lib/lifecycle/types.ts's
 * LIFECYCLE_TABLE_BY_RESOURCE, no lifecycle-tracked table at all -- so
 * unlike every flow above, there is no transitionLifecycle() step here;
 * this flow is represented entirely through deletion_requests, exactly
 * as that module's own comment anticipates (see also
 * lib/lifecycle/state-machine.ts's LifecycleResourceUntrackedError,
 * which documents this exact fallback).
 *
 * removeMember() already carries its own well-tested authorization (RLS)
 * and business rule (refuses to remove/leave the household's LAST
 * remaining owner -- see removeMember()'s own ConflictError and
 * scripts/household-regressions.ts's existing coverage of it) -- this
 * coordinator deliberately does NOT reimplement or duplicate that rule.
 * Reimplementing a security-critical invariant in a second place is how
 * the two copies drift; calling the single existing function is the
 * safer choice, at the cost of removeMember()'s mutation running in its
 * OWN internal transaction (via createUserSupabaseClient) rather than
 * inside a coordinator-supplied client. Because there is nothing
 * external to defer afterward (no storage, no search index), the
 * bookkeeping transition and audit write happen immediately after
 * removeMember() returns, in this same function -- unlike the flows
 * above, there is no separate finish...() step to call.
 *
 * Idempotent at the deletion_requests level: a repeat with the same
 * idempotencyKey short-circuits on the ALREADY-CREATED row without
 * calling removeMember() again (whether the first attempt succeeded or
 * was refused), so a retry can never duplicate an audit event or attempt
 * a second destructive call against a member already removed. A refusal
 * (ConflictError/NotFoundError/ForbiddenError from removeMember()) is
 * allowed to propagate unhandled -- app/api/household/members/[userId]/
 * route.ts's existing routeErrorResponse() already maps all three to the
 * correct HTTP status, so this coordinator does not need its own error
 * class for this flow.
 */
async function performMembershipRemoval(args: {
  accountId: string;
  callerUserId: string;
  targetUserId: string;
  resourceType: "household_member" | "household_leave";
  reasonCategory: DeletionReasonCategory;
  idempotencyKey: string;
}): Promise<DeletionOutcome> {
  const { row: request, created } = await createOrGetDeletionRequest(pool, {
    accountId: args.accountId,
    resourceType: args.resourceType,
    resourceId: args.targetUserId,
    requestedBy: args.callerUserId,
    reasonCategory: args.reasonCategory,
    idempotencyKey: args.idempotencyKey,
  });

  if (!created) {
    return { status: mapRequestStateToStatus(request), deletionRequestId: request.id, resourceId: args.targetUserId };
  }

  // The actual removal -- see this function's own doc comment on why
  // removeMember() is called rather than reimplemented. A thrown error
  // here leaves this deletion_requests row at its default
  // pending_deletion state; a retry with the same idempotencyKey is
  // caught by the `!created` branch above and safely returns without
  // attempting the removal again.
  await removeMember(args.callerUserId, args.accountId, args.targetUserId);

  await transitionDeletionRequest(pool, {
    id: request.id,
    fromStates: ["pending_deletion"],
    toState: "soft_deleted",
    completedAt: new Date(),
  }).catch(() => {
    // A repeat call (idempotent retry) may already be past this state --
    // unreachable in practice since the `!created` branch above already
    // short-circuits every retry, kept for the same defensive symmetry
    // every other flow's transition uses.
  });

  const correlationId = randomUUID();

  await appendDeletionAudit(pool, {
    accountId: args.accountId,
    deletionRequestId: request.id,
    resourceType: args.resourceType,
    resourceId: args.targetUserId,
    actor: args.callerUserId,
    fromState: null, // no lifecycle-tracked resource row exists for this flow to report a fromState for
    toState: "soft_deleted",
    correlationId,
    cleanupStatus: null,
  });

  await recordEvent({
    name: "lifecycle.deletion.finished",
    correlationId,
    status: "success",
    processingState: "soft_deleted",
    resourceRef: pseudonymizeId(args.targetUserId),
    householdRef: pseudonymizeId(args.accountId),
    extra: { resourceType: args.resourceType },
  });

  return { status: "completed", deletionRequestId: request.id, resourceId: args.targetUserId };
}

/** Owner removes another member. See performMembershipRemoval()'s doc
 * comment for the shared implementation and its rationale. */
export async function requestHouseholdMemberRemoval(args: {
  accountId: string;
  callerUserId: string;
  targetUserId: string;
  idempotencyKey: string;
}): Promise<DeletionOutcome> {
  return performMembershipRemoval({ ...args, resourceType: "household_member", reasonCategory: "owner_removed_member" });
}

/** A member removes themselves ("leave"). See performMembershipRemoval()'s
 * doc comment for the shared implementation and its rationale -- in
 * particular, removeMember()'s own last-owner protection applies exactly
 * the same way here as for an owner-initiated removal, refusing a leave
 * that would empty the household of owners. */
export async function requestHouseholdLeave(args: {
  accountId: string;
  callerUserId: string;
  targetUserId: string;
  idempotencyKey: string;
}): Promise<DeletionOutcome> {
  return performMembershipRemoval({ ...args, resourceType: "household_leave", reasonCategory: "member_left" });
}

/**
 * Invitation revocation (resource_type='invitation'). Wraps
 * lib/household/repo.ts's revokeInvitation() the same way Flows 5-6 wrap
 * removeMember() -- see performMembershipRemoval()'s doc comment for the
 * shared rationale (do not reimplement an existing, well-tested,
 * RLS-authorized business operation; defer to it and let its errors
 * propagate). household_invitations has a real `id` column (unlike
 * household_members' composite key) but, like household_member/
 * household_leave, no entry in LIFECYCLE_TABLE_BY_RESOURCE -- revoking an
 * invitation is a single soft-update (revoked_at=now()) inside
 * revokeInvitation()'s own RLS-scoped transaction, not a lifecycle_state
 * transition, so this flow too is represented entirely through
 * deletion_requests, with no transitionLifecycle() step and no separate
 * finish...() step (nothing external to defer).
 *
 * Idempotent: a repeat with the same idempotencyKey short-circuits on
 * the already-created deletion_requests row without calling
 * revokeInvitation() again -- a second call against an
 * already-revoked invitation would otherwise throw NotFoundError
 * (revokeInvitation()'s WHERE clause excludes rows that already have
 * revoked_at set), which a retry must never surface as a fresh failure.
 */
export async function requestInvitationRevocation(args: {
  callerUserId: string;
  invitationId: string;
  idempotencyKey: string;
}): Promise<DeletionOutcome> {
  // household_invitations always has a real household_id of its own,
  // and it is NOT necessarily the caller's currently active household --
  // revokeInvitation() authorizes by the invitation's own household
  // ownership via RLS (is_household_owner(household_id) read FROM THE
  // INVITATION ROW), not the caller's active household context (see
  // app/api/household/invitations/[id]/route.ts's own comment on why
  // that is deliberate: a caller who owns two households can revoke
  // either one's invitations regardless of which is "active"). Reading
  // household_id here (service-level, plain pool; revokeInvitation()'s
  // RLS-scoped UPDATE below still decides the revocation itself) keeps the deletion_requests/deletion_audit_log
  // bookkeeping correctly scoped to the invitation's REAL household even
  // when it differs from the caller's active one.
  // Only an owner of the invitation's own household gets past this point:
  // the deletion_requests row below is written into that household, and a
  // repeat of it answers "ok", so it is never created (or reported) for
  // anyone else. A caller outside that household is told only "not found",
  // the same as for an id that does not exist; a member who is not an owner
  // gets the NotFoundError revokeInvitation() itself would give.
  const invitationRow = await pool.query<{ household_id: string; role: string | null }>(
    `SELECT i.household_id, hm.role FROM household_invitations i
       JOIN household_members hm ON hm.household_id=i.household_id AND hm.user_id=$2
      WHERE i.id=$1`,
    [args.invitationId, args.callerUserId],
  );
  if (invitationRow.rows[0] && invitationRow.rows[0].role !== "owner") throw new NotFoundError("Invitation not found");
  const accountId = invitationRow.rows[0]?.household_id;
  if (!accountId) {
    throw new DeletionValidationError("Invitation not found");
  }

  const { row: request, created } = await createOrGetDeletionRequest(pool, {
    accountId,
    resourceType: "invitation",
    resourceId: args.invitationId,
    requestedBy: args.callerUserId,
    reasonCategory: "invitation_revoked",
    idempotencyKey: args.idempotencyKey,
  });

  if (!created) {
    return { status: mapRequestStateToStatus(request), deletionRequestId: request.id, resourceId: args.invitationId };
  }

  // The actual revocation -- see this function's own doc comment on why
  // revokeInvitation() is called rather than reimplemented. A thrown
  // error here (NotFoundError: already revoked/accepted/no such
  // invitation, or the RLS-enforced "not this household's owner" case)
  // leaves this deletion_requests row at its default pending_deletion
  // state; a retry with the same idempotencyKey is caught by the
  // `!created` branch above and never attempts the revocation again.
  await revokeInvitation(args.callerUserId, args.invitationId);

  await transitionDeletionRequest(pool, {
    id: request.id,
    fromStates: ["pending_deletion"],
    toState: "soft_deleted",
    completedAt: new Date(),
  }).catch(() => {
    // A repeat call (idempotent retry) may already be past this state --
    // unreachable in practice since the `!created` branch above already
    // short-circuits every retry, kept for the same defensive symmetry
    // every other flow's transition uses.
  });

  const correlationId = randomUUID();

  await appendDeletionAudit(pool, {
    accountId,
    deletionRequestId: request.id,
    resourceType: "invitation",
    resourceId: args.invitationId,
    actor: args.callerUserId,
    fromState: null, // no lifecycle-tracked resource row exists for this flow to report a fromState for
    toState: "soft_deleted",
    correlationId,
    cleanupStatus: null,
  });

  await recordEvent({
    name: "lifecycle.deletion.finished",
    correlationId,
    status: "success",
    processingState: "soft_deleted",
    resourceRef: pseudonymizeId(args.invitationId),
    householdRef: pseudonymizeId(accountId),
    extra: { resourceType: "invitation" },
  });

  return { status: "completed", deletionRequestId: request.id, resourceId: args.invitationId };
}

/**
 * Household (whole-account) deletion (resource_type='household'), the
 * most destructive flow in this checkpoint -- wraps lib/household/repo.ts's
 * pre-existing deleteHousehold() (`DELETE FROM accounts WHERE id=$1`, which
 * cascades via ON DELETE CASCADE to every table this household owns:
 * policies, family_members, claim_evidence_documents, household_members,
 * household_invitations, deletion_requests, deletion_audit_log, and every
 * other account_id/household_id-scoped table in the schema).
 *
 * Unlike every flow above, `household` genuinely cannot follow the
 * "transition to pending_deletion now, physically delete later" pattern
 * those flows use, even though it has its own LIFECYCLE_TABLE_BY_RESOURCE
 * entry (accounts). Two schema facts rule that pattern out here:
 *   1. Both deletion_requests.account_id and deletion_audit_log.account_id
 *      are `REFERENCES accounts(id) ON DELETE CASCADE` (sql/lifecycle.sql).
 *      The instant accounts.id is hard-deleted, EVERY deletion_requests/
 *      deletion_audit_log row for that account_id is destroyed with it --
 *      there is no way to keep a durable audit trail scoped to an account
 *      that no longer exists, in this schema, however the work is
 *      sequenced. So this flow's own audit record is only ever committed
 *      IMMEDIATELY BEFORE the physical delete (see below), not after --
 *      there is no separate finishHouseholdDeletion() step, because there
 *      would be nothing left afterward to finish.
 *   2. No existing read path (resolveActiveHouseholdId/listMemberships,
 *      requireHouseholdContext, or any RLS policy on a household-scoped
 *      table) filters by accounts.lifecycle_state -- only household_members'
 *      own row presence gates access. So merely transitioning
 *      accounts.lifecycle_state to pending_deletion, without also hard-
 *      deleting, would revoke NOTHING: every member would keep full,
 *      unrestricted access indefinitely, since no Checkpoint-8 durable job
 *      exists yet to ever finish the job. That would be a silent
 *      regression from deleteHousehold()'s current, real, immediate
 *      behavior to a deletion request that visibly does nothing at all --
 *      worse than not wrapping it here.
 * Given both, this flow keeps deleteHousehold()'s existing semantics
 * (immediate, real, irreversible deletion, gated by the caller's own
 * confirmName re-entry and, as of this flow, recent re-authentication --
 * see app/api/household/route.ts's DELETE handler) and adds only what
 * Checkpoint 7 requires around it: idempotency bookkeeping and a best-
 * effort audit record for the moment the deletion was authorized, written
 * just before the irreversible step -- not a durable post-hoc trail,
 * since none can survive the account's own deletion.
 */
export async function requestHouseholdDeletion(args: {
  actorUserId: string;
  householdId: string;
  idempotencyKey: string;
}): Promise<DeletionOutcome> {
  // A retry (same idempotencyKey) against an ALREADY-fully-deleted
  // household has nothing left to attach a deletion_requests row to --
  // the accounts row, and via ON DELETE CASCADE every deletion_requests/
  // deletion_audit_log row that ever referenced it, is already gone. The
  // common case (a signed-in caller re-submitting) never reaches this
  // function at all, since requireHouseholdContext() itself fails first
  // once household_members is empty -- this check is for the rarer path
  // of a retry driven by a stored idempotency key rather than session
  // state. Checked before attempting the deletion_requests insert below
  // so that case surfaces as the same NotFoundError deleteHousehold()
  // itself already throws for "no such household", not a raw foreign-key
  // violation from inserting a deletion_requests row against a
  // nonexistent account_id.
  const existing = await pool.query<{ id: string }>(`SELECT id FROM accounts WHERE id=$1`, [args.householdId]);
  if (!existing.rows[0]) {
    throw new NotFoundError("Household not found");
  }

  const { row: request } = await createOrGetDeletionRequest(pool, {
    accountId: args.householdId,
    resourceType: "household",
    resourceId: args.householdId,
    requestedBy: args.actorUserId,
    reasonCategory: "account_closure",
    idempotencyKey: args.idempotencyKey,
  });

  // Unlike every flow above, a retry that finds an EXISTING deletion_requests
  // row does NOT short-circuit here -- there is no separate finish() step
  // to resume, and the existence check above already proved the household
  // is still present, so re-attempting deleteHousehold() below is safe
  // whether this is a genuine first attempt or a retry of one that
  // crashed between the deletion_requests insert and the physical delete.
  const correlationId = randomUUID();

  await appendDeletionAudit(pool, {
    accountId: args.householdId,
    deletionRequestId: request.id,
    resourceType: "household",
    resourceId: args.householdId,
    actor: args.actorUserId,
    fromState: "active",
    toState: "pending_deletion",
    correlationId,
    cleanupStatus: null,
  }).catch(() => {
    // Best-effort: a repeat of an already-audited attempt (same request
    // row, retried before the delete completed) duplicating this one
    // "pending_deletion" audit line is harmless and expected, not an
    // error worth failing the deletion over.
  });

  await recordEvent({
    name: "lifecycle.deletion.household_closure_started",
    correlationId,
    status: "in_progress",
    processingState: "pending_deletion",
    resourceRef: pseudonymizeId(args.householdId),
    householdRef: pseudonymizeId(args.householdId),
    extra: { resourceType: "household" },
  });

  await deleteHousehold(args.actorUserId, args.householdId);
  // model_usage keys its rows by account_id with no foreign key, so the
  // cascade above leaves them behind. They are the household's own usage
  // records; remove them too (best-effort -- a missing table in a partial
  // environment must not fail an already-completed deletion).
  await pool.query("DELETE FROM model_usage WHERE account_id=$1", [args.householdId]).catch((error: unknown) => {
    console.warn("model_usage cleanup after household deletion failed:", error instanceof Error ? error.message : String(error));
  });
  // The cascade does not reach Pinecone either, which holds the text of every
  // passage this household uploaded in a namespace of its own. Remove the
  // whole namespace (best-effort, as for each document's passages above: the
  // household is already gone, so a Pinecone outage must not fail it).
  if (pineconeEnabled()) {
    await deleteHouseholdPassages({ accountId: args.householdId }).catch((error: unknown) => {
      console.warn("Pinecone cleanup after household deletion failed:", error instanceof Error ? error.message : String(error));
    });
  }
  // The accounts row -- and with it, via ON DELETE CASCADE, the
  // deletion_requests row created above and the deletion_audit_log row
  // just written -- no longer exists past this point. See this
  // function's own doc comment for why that is a deliberate, schema-
  // driven trade-off (no finishHouseholdDeletion(), no durable post-
  // completion audit trail) rather than an oversight.

  return { status: "completed", deletionRequestId: request.id, resourceId: args.householdId };
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

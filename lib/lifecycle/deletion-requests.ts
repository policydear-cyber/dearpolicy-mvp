/**
 * Checkpoint 7 (claude/v1-launch-hardening): durable, idempotent
 * deletion-request bookkeeping.
 *
 * deletion_requests / deletion_audit_log are infrastructure/job-tracking
 * tables, not RLS-mediated household content -- same category as
 * policy_document_audit_log, scan_provider_events, storage_cleanup_locks,
 * household_exports. They use the established plain-pool (service-level)
 * access convention: direct pool.query() with an explicit account_id
 * predicate on every read, mirroring how the caller's OWN authorization
 * check (not RLS) is what actually scopes access to a route.
 */
import { pool } from "@/lib/db/client";
import type {
  DeletionReasonCategory,
  FailureCategory,
  LifecycleResourceType,
  LifecycleState,
} from "./types";

type DbClient = { query: typeof pool.query };

export type DeletionRequestRow = {
  id: string;
  account_id: string;
  resource_type: LifecycleResourceType;
  resource_id: string;
  requested_by: string | null;
  requested_at: Date;
  reason_category: DeletionReasonCategory;
  lifecycle_state: "pending_deletion" | "soft_deleted" | "permanently_deleted" | "audit_tombstone" | "failed_recoverable" | "blocked";
  state_version: number;
  retention_deadline: Date | null;
  cleanup_job_id: string | null;
  completed_at: Date | null;
  failure_category: FailureCategory | null;
  retry_count: number;
  idempotency_key: string;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS =
  "id, account_id, resource_type, resource_id, requested_by, requested_at, reason_category, lifecycle_state, state_version, " +
  "retention_deadline, cleanup_job_id, completed_at, failure_category, retry_count, idempotency_key, created_at, updated_at";

/** Idempotent create-or-get: a repeated request with the same
 * (accountId, resourceType, resourceId, idempotencyKey) returns the SAME
 * row rather than creating a second one or repeating destructive work --
 * the exact contract Checkpoint 7 requires ("Repeated requests with the
 * same idempotency key must return the same deletion request. A retry
 * must not duplicate audit events, jobs, or destructive operations"),
 * built the same way lib/household/export-store.ts's
 * createOrGetExportRequest() proved idempotency for exports: a unique
 * index (idx_deletion_requests_idempotency) plus ON CONFLICT DO NOTHING,
 * then an unconditional re-read by the natural key so a racing duplicate
 * insert and a genuine repeat both resolve to the one row that won. */
export async function createOrGetDeletionRequest(
  db: DbClient,
  params: {
    accountId: string;
    resourceType: LifecycleResourceType;
    resourceId: string;
    requestedBy: string | null;
    reasonCategory: DeletionReasonCategory;
    idempotencyKey: string;
    retentionDeadline?: Date | null;
  },
): Promise<{ row: DeletionRequestRow; created: boolean }> {
  const inserted = await db.query<DeletionRequestRow>(
    `INSERT INTO deletion_requests(account_id, resource_type, resource_id, requested_by, reason_category, idempotency_key, retention_deadline)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (account_id, resource_type, resource_id, idempotency_key) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      params.accountId,
      params.resourceType,
      params.resourceId,
      params.requestedBy,
      params.reasonCategory,
      params.idempotencyKey,
      params.retentionDeadline ?? null,
    ],
  );
  if (inserted.rows[0]) return { row: inserted.rows[0], created: true };

  const existing = await db.query<DeletionRequestRow>(
    `SELECT ${COLUMNS} FROM deletion_requests
      WHERE account_id=$1 AND resource_type=$2 AND resource_id=$3 AND idempotency_key=$4`,
    [params.accountId, params.resourceType, params.resourceId, params.idempotencyKey],
  );
  if (!existing.rows[0]) {
    throw new Error("createOrGetDeletionRequest: insert was skipped by ON CONFLICT but no existing row was found -- this should never happen");
  }
  return { row: existing.rows[0], created: false };
}

export class DeletionRequestVersionConflictError extends Error {
  constructor(public readonly id: string) {
    super(`Deletion request ${id} lost a concurrent race -- its state changed underneath it`);
    this.name = "DeletionRequestVersionConflictError";
  }
}

/** CAS transition for the deletion_requests row itself (separate from,
 * and in addition to, the target resource's own lifecycle_state --
 * see transitionLifecycle() in state-machine.ts). Re-reads on a lost
 * race rather than trusting the caller, same pattern throughout. */
export async function transitionDeletionRequest(
  db: DbClient,
  params: {
    id: string;
    fromStates: DeletionRequestRow["lifecycle_state"][];
    toState: DeletionRequestRow["lifecycle_state"];
    completedAt?: Date | null;
    failureCategory?: FailureCategory | null;
    cleanupJobId?: string | null;
    incrementRetry?: boolean;
  },
): Promise<DeletionRequestRow> {
  const { rows } = await db.query<DeletionRequestRow>(
    `UPDATE deletion_requests
        SET lifecycle_state=$1,
            state_version=state_version+1,
            completed_at=COALESCE($2, completed_at),
            failure_category=$3,
            cleanup_job_id=COALESCE($4, cleanup_job_id),
            retry_count=retry_count + CASE WHEN $5 THEN 1 ELSE 0 END,
            updated_at=now()
      WHERE id=$6 AND lifecycle_state = ANY($7::text[])
      RETURNING ${COLUMNS}`,
    [
      params.toState,
      params.completedAt ?? null,
      params.failureCategory ?? null,
      params.cleanupJobId ?? null,
      params.incrementRetry ?? false,
      params.id,
      params.fromStates,
    ],
  );
  if (rows[0]) return rows[0];

  const { rows: current } = await db.query<DeletionRequestRow>(`SELECT ${COLUMNS} FROM deletion_requests WHERE id=$1`, [params.id]);
  if (!current[0]) throw new Error(`Deletion request ${params.id} does not exist`);
  throw new DeletionRequestVersionConflictError(params.id);
}

export async function getDeletionRequest(db: DbClient, id: string, accountId: string): Promise<DeletionRequestRow | null> {
  const { rows } = await db.query<DeletionRequestRow>(`SELECT ${COLUMNS} FROM deletion_requests WHERE id=$1 AND account_id=$2`, [id, accountId]);
  return rows[0] ?? null;
}

/** Immutable audit trail. Deliberately accepts only structural metadata --
 * no raw policy text, medical facts, filenames or tokens can be passed
 * through this function's own type signature, matching the redaction
 * convention already used by appendCleanupAudit / appendExportAudit. */
export async function appendDeletionAudit(
  db: DbClient,
  params: {
    accountId: string;
    deletionRequestId: string | null;
    resourceType: LifecycleResourceType;
    resourceId: string | null;
    actor: string | null;
    fromState: LifecycleState | null;
    toState: LifecycleState;
    correlationId: string;
    cleanupStatus?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO deletion_audit_log(account_id, deletion_request_id, resource_type, resource_id, actor, from_state, to_state, correlation_id, cleanup_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      params.accountId,
      params.deletionRequestId,
      params.resourceType,
      params.resourceId,
      params.actor,
      params.fromState,
      params.toState,
      params.correlationId,
      params.cleanupStatus ?? null,
    ],
  );
}

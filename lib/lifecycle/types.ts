/**
 * Checkpoint 7 (claude/v1-launch-hardening): shared types for the
 * deletion & derived-data invalidation lifecycle. See sql/lifecycle.sql
 * for the schema these types describe and lib/lifecycle/state-machine.ts
 * for the only function permitted to change a resource's lifecycle_state.
 */

export type LifecycleState =
  | "active"
  | "pending_deletion"
  | "soft_deleted"
  | "permanently_deleted"
  | "audit_tombstone";

export const LIFECYCLE_STATES: readonly LifecycleState[] = [
  "active",
  "pending_deletion",
  "soft_deleted",
  "permanently_deleted",
  "audit_tombstone",
];

// Every deletion flow this checkpoint governs. household_member/
// household_leave/invitation have no lifecycle-tracked table of their own
// (see LIFECYCLE_TABLE_BY_RESOURCE below) -- those flows are represented
// entirely through deletion_requests.
export type LifecycleResourceType =
  | "policy_document"
  | "policy"
  | "claim_evidence"
  | "family_member"
  | "household_member"
  | "household_leave"
  | "invitation"
  | "household";

export const LIFECYCLE_RESOURCE_TYPES: readonly LifecycleResourceType[] = [
  "policy_document",
  "policy",
  "claim_evidence",
  "family_member",
  "household_member",
  "household_leave",
  "invitation",
  "household",
];

export type DeletionReasonCategory =
  | "user_requested"
  | "duplicate"
  | "superseded"
  | "household_cleanup"
  | "owner_removed_member"
  | "member_left"
  | "invitation_revoked"
  | "account_closure";

// The safe, structured status vocabulary the coordinator and every route
// built on top of it must return -- never a raw internal error or
// database/storage term (per Checkpoint 7's "UI and API" requirement).
export type DeletionRequestStatus = "accepted" | "pending_cleanup" | "completed" | "failed_recoverable" | "blocked";

export type FailureCategory = "storage_partial_failure" | "database_partial_failure" | "provider_failure" | "validation_failure";

// The tables whose rows carry a lifecycle_state/lifecycle_version pair,
// and therefore are valid targets of transitionLifecycle(). "policy" (the
// whole-policy flow) and "policy_document" (the single-document-version
// flow) both target the same `policies` table -- they differ in which
// rows get transitioned and what gets invalidated alongside them (see
// lib/lifecycle/coordinator.ts), not in the underlying column.
export const LIFECYCLE_TABLE_BY_RESOURCE: Partial<Record<LifecycleResourceType, { table: string; idColumn: string }>> = {
  policy_document: { table: "policies", idColumn: "id" },
  policy: { table: "policies", idColumn: "id" },
  claim_evidence: { table: "claim_evidence_documents", idColumn: "id" },
  family_member: { table: "family_members", idColumn: "id" },
  household: { table: "accounts", idColumn: "id" },
};

// Explicit, tested allowed transitions. Recovery (-> "active") is only
// structurally reachable from pending_deletion/soft_deleted, never from
// permanently_deleted/audit_tombstone -- "recovery only where policy
// permits, only before permanent deletion" from the checkpoint spec.
// Whether recovery is actually OFFERED for a given resource/flow is a
// coordinator/policy decision (see coordinator.ts), not assumed here:
// this table only says which transitions are structurally possible.
export const ALLOWED_LIFECYCLE_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  active: ["pending_deletion"],
  pending_deletion: ["soft_deleted", "active"],
  soft_deleted: ["permanently_deleted", "active"],
  permanently_deleted: ["audit_tombstone"],
  audit_tombstone: [],
};

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === "string" && (LIFECYCLE_STATES as readonly string[]).includes(value);
}

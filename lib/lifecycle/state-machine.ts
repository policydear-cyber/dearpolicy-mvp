/**
 * Checkpoint 7 (claude/v1-launch-hardening): the central lifecycle state
 * machine.
 *
 * transitionLifecycle() is the ONLY function permitted to change a
 * resource's lifecycle_state / lifecycle_version columns. Every
 * deletion-flow handler (lib/lifecycle/coordinator.ts) and every route
 * that touches lifecycle state calls this instead of updating those
 * columns directly -- scripts/lifecycle-query-guard-regressions.ts'
 * static scan is what enforces that in practice.
 *
 * Concurrency: an optimistic compare-and-swap, same shape as the CAS
 * convention already used throughout this branch (policy quarantine,
 * scan callbacks, household export status). The UPDATE only matches a
 * row that is still in `fromState`; a lost race means someone else moved
 * it first. Rather than trust anything the caller passed in when that
 * happens, this re-reads the authoritative row and reports which of
 * "doesn't exist" / "already moved" occurred -- the exact lesson from
 * lib/household/export-store.ts's expireIfPast() race fix (a first draft
 * of that function returned a stale caller-supplied row on a lost CAS,
 * which could show an already-expired export as still valid).
 */
import {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  LIFECYCLE_TABLE_BY_RESOURCE,
  type LifecycleResourceType,
  type LifecycleState,
} from "./types";

export class InvalidLifecycleTransitionError extends Error {
  constructor(from: LifecycleState, to: LifecycleState) {
    super(`Cannot transition lifecycle state from '${from}' to '${to}'`);
    this.name = "InvalidLifecycleTransitionError";
  }
}

export class LifecycleVersionConflictError extends Error {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string,
  ) {
    super(`Lifecycle transition for ${resourceType} ${resourceId} lost a concurrent race -- its state changed underneath it`);
    this.name = "LifecycleVersionConflictError";
  }
}

export class LifecycleResourceNotFoundError extends Error {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string,
  ) {
    super(`${resourceType} ${resourceId} does not exist`);
    this.name = "LifecycleResourceNotFoundError";
  }
}

export class LifecycleResourceUntrackedError extends Error {
  constructor(resourceType: string) {
    super(`${resourceType} has no lifecycle-tracked table -- use the deletion-request-only flow instead (lib/lifecycle/deletion-requests.ts)`);
    this.name = "LifecycleResourceUntrackedError";
  }
}

export type LifecycleRow = {
  id: string;
  lifecycle_state: LifecycleState;
  lifecycle_version: number;
  account_id: string;
};

// Deliberately the narrowest possible shape -- compatible with both a
// plain `pool` (service-level, used by lib/lifecycle/deletion-requests.ts
// for the account-agnostic bookkeeping tables) AND the RLS-scoped
// ScopedDbClient returned inside createUserSupabaseClient()'s callback,
// so a route can call transitionLifecycle() from INSIDE its own
// already-open, already-RLS-scoped transaction -- exactly how
// app/api/policies/[id]/route.ts's DELETE handler already writes its
// audit-log row in the same transaction as the row mutation.
export type LifecycleDbClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

export async function transitionLifecycle(
  db: LifecycleDbClient,
  params: {
    resourceType: LifecycleResourceType;
    resourceId: string;
    accountId: string;
    fromState: LifecycleState;
    toState: LifecycleState;
  },
): Promise<LifecycleRow> {
  const target = LIFECYCLE_TABLE_BY_RESOURCE[params.resourceType];
  if (!target) throw new LifecycleResourceUntrackedError(params.resourceType);

  const allowed = ALLOWED_LIFECYCLE_TRANSITIONS[params.fromState] ?? [];
  if (!allowed.includes(params.toState)) {
    throw new InvalidLifecycleTransitionError(params.fromState, params.toState);
  }

  const { rows } = await db.query<LifecycleRow>(
    `UPDATE ${target.table}
        SET lifecycle_state=$1, lifecycle_version=lifecycle_version+1, updated_at=now()
      WHERE ${target.idColumn}=$2 AND account_id=$3 AND lifecycle_state=$4
      RETURNING id, lifecycle_state, lifecycle_version, account_id`,
    [params.toState, params.resourceId, params.accountId, params.fromState],
  );

  if (rows[0]) return rows[0];

  const { rows: current } = await db.query<LifecycleRow>(
    `SELECT id, lifecycle_state, lifecycle_version, account_id FROM ${target.table} WHERE ${target.idColumn}=$1 AND account_id=$2`,
    [params.resourceId, params.accountId],
  );
  if (!current[0]) throw new LifecycleResourceNotFoundError(params.resourceType, params.resourceId);
  throw new LifecycleVersionConflictError(params.resourceType, params.resourceId);
}

/** Read-only helper so callers (and regressions) can check current state
 * without going through a transition. Never used to gate a mutation --
 * any code that reads then writes lifecycle state without a CAS reopens
 * exactly the race transitionLifecycle() exists to close. */
export async function getLifecycleState(
  db: LifecycleDbClient,
  params: { resourceType: LifecycleResourceType; resourceId: string; accountId: string },
): Promise<LifecycleRow | null> {
  const target = LIFECYCLE_TABLE_BY_RESOURCE[params.resourceType];
  if (!target) throw new LifecycleResourceUntrackedError(params.resourceType);
  const { rows } = await db.query<LifecycleRow>(
    `SELECT id, lifecycle_state, lifecycle_version, account_id FROM ${target.table} WHERE ${target.idColumn}=$1 AND account_id=$2`,
    [params.resourceId, params.accountId],
  );
  return rows[0] ?? null;
}

/**
 * Checkpoint 7 (claude/v1-launch-hardening): the shared "active read"
 * scope every ordinary application read across the four lifecycle-scoped
 * tables (accounts, policies, claim_evidence_documents, family_members)
 * is expected to filter through, so a soft_deleted/permanently_deleted/
 * audit_tombstone row never comes back from a normal query just because
 * nobody remembered to exclude it.
 *
 * RECONSTRUCTED during Checkpoint 14b (privacy_safe_observability /
 * model_prompt_schema_governance): this file was found completely absent
 * from the branch at commit 3d6365a93939a76bd6c39bc4caea97c178d3b201 --
 * confirmed via the GitHub API against the real remote branch, not a
 * local checkout artifact -- despite being imported by 30+ production
 * files (lib/ai/ledger.ts, lib/chat/workflow.ts, lib/household/export.ts,
 * lib/lifecycle/coordinator.ts, most app/api/* routes, ...) and by
 * scripts/active-read-scopes-regressions.ts, which encodes this module's
 * exact expected behavior as an executable spec. Its absence made every
 * one of those files fail to load at all (Cannot find module
 * '@/lib/lifecycle/scopes'), which in turn made it impossible to run ANY
 * regression suite that touches them -- including the two production
 * chokepoints (lib/ai/llm.ts, lib/documents/ocr-hosted.ts) this
 * checkpoint's own work depends on. This reconstruction is deliberately
 * minimal and derived directly from that regression suite's own
 * assertions (activePredicate()'s bare/aliased output,
 * readIncludingDeletedForInternalUse()'s allowed-context behavior) plus
 * every real call site's usage across the codebase -- not a redesign.
 * The data_deletion_and_invalidation capability (Checkpoint 7, tracked
 * separately from this checkpoint's two capabilities) owns this file;
 * whoever picks that capability back up should treat this as a starting
 * point to review, not a finished, independently-designed contract.
 */

/** The four tables this checkpoint's lifecycle machinery tracks -- see
 * lib/lifecycle/types.ts's LIFECYCLE_TABLE_BY_RESOURCE for the resource
 * types that map onto them. */
export type LifecycleScopedTable = "accounts" | "policies" | "claim_evidence_documents" | "family_members";

export const LIFECYCLE_SCOPED_TABLES: readonly LifecycleScopedTable[] = [
  "accounts",
  "policies",
  "claim_evidence_documents",
  "family_members",
];

/** The one predicate every ordinary read of a lifecycle-scoped table must
 * include. With no alias, returns the bare column predicate for a
 * single-table query; with an alias (e.g. "p" for `FROM policies p`),
 * qualifies the column so it is unambiguous in a multi-table JOIN. Never
 * parameterized -- 'active' is a fixed literal, not a caller-suppliable
 * value, so there is no injection surface here. */
export function activePredicate(alias?: string): string {
  return `${alias ? `${alias}.` : ""}lifecycle_state='active'`;
}

/** Thrown by readIncludingDeletedForInternalUse() for a context that is
 * not on the allowed list -- classified by lib/telemetry/errors.ts's
 * classifyError() (by constructor.name, category "authorization",
 * HTTP 403) alongside this codebase's other authorization-shaped
 * errors. */
export class InternalReadAuthorizationError extends Error {}

/** The only contexts permitted to read a lifecycle-scoped table WITHOUT
 * activePredicate() -- see scripts/lifecycle-query-guard-regressions.ts's
 * INTENTIONAL_INTERNAL_READS, which is the enforced source of truth this
 * list must stay in sync with. "deletion_coordinator": lib/lifecycle/
 * coordinator.ts must be able to see a row regardless of its current
 * lifecycle_state to validate, transition, or retry a deletion request
 * against it (a row already pending_deletion/soft_deleted from a prior
 * attempt is exactly what an idempotent retry needs to see). */
const ALLOWED_INTERNAL_READ_CONTEXTS = ["deletion_coordinator"] as const;
export type InternalReadContext = (typeof ALLOWED_INTERNAL_READ_CONTEXTS)[number];

/** Names and authorizes an application read that deliberately does NOT
 * filter through activePredicate(). This function does not itself touch
 * the database -- it is a documentation-and-gate marker a call site
 * invokes immediately before running its own unguarded query, so that
 * "this file reads a lifecycle-scoped table without the predicate" is
 * always a declared, reviewed exception (tracked in
 * INTENTIONAL_INTERNAL_READS) rather than a silent omission a future
 * reader or scripts/lifecycle-query-guard-regressions.ts's static scan
 * would otherwise have no way to distinguish from a bug. `reason` is
 * required so every call site states, in its own words, why the
 * exception is safe -- never actually used at runtime beyond that
 * documentation purpose. Throws InternalReadAuthorizationError for any
 * context not on the allowed list, fail-closed rather than silently
 * permitting an unreviewed exception to slip in. */
export function readIncludingDeletedForInternalUse(context: InternalReadContext, reason: string): void {
  if (!ALLOWED_INTERNAL_READ_CONTEXTS.includes(context)) {
    throw new InternalReadAuthorizationError(`"${String(context)}" is not an authorized internal-read context for bypassing activePredicate().`);
  }
  void reason;
}

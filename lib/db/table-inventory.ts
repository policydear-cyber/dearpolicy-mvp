/**
 * Central, executable inventory of every application table created by
 * sql/*.sql, classified by who may reach it DIRECTLY through Supabase (the
 * `anon` / `authenticated` Postgres roles a browser JWT maps to).
 *
 * The trusted server connection (DATABASE_URL; the table owner, which
 * non-forced RLS does not apply to) is not a browser role and is not listed
 * as one. Reviewers never read household tables directly: their only access
 * is through the server-side boundary in lib/claims/reviewers/boundary.ts.
 *
 * scripts/infrastructure-table-permissions-regressions.ts discovers every
 * table from the migrations and fails CI if a table is missing here (or
 * listed here but no longer created); scripts/launch-check.ts refuses to
 * report the infrastructure_table_protection capability as ready unless the
 * migration source enforces this inventory.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const TABLE_CLASSES = [
  "household_readable", // direct SELECT of own household's rows only; no direct writes
  "household_writable", // direct SELECT and writes of own household's rows (RLS member/owner-scoped)
  "reviewer_boundary", // reachable by reviewers only through the server boundary, never directly
  "service_only", // server / worker only: no browser role holds any privilege
  "operator_only", // written only by the operator CLI (scripts/claim-reviewer-admin.ts); read by the server boundary
  "public", // intentionally readable by anyone
] as const;
export type TableClass = (typeof TABLE_CLASSES)[number];
export type DirectOperation = "select" | "insert" | "update" | "delete";

export type TableInventoryEntry = {
  class: TableClass;
  /** Operations the `authenticated` role may perform directly (subject to the listed RLS). `anon` never has any. */
  authenticated: readonly DirectOperation[];
  /** RLS policies that govern direct access (by name). */
  policies: readonly string[];
  /** Whether the browser roles need any table grant at all. */
  browserGrantsRequired: boolean;
  /** The production code path that legitimately reads/writes this table. */
  codePath: string;
};

const MEMBER_CRUD = ["household_member_select", "household_member_insert", "household_member_update", "household_member_delete"] as const;
const DENY = (t: string) => [`${t}_no_client_access`];

export const TABLE_INVENTORY: Record<string, TableInventoryEntry> = {
  // --- household data: member/owner-scoped through sql/household-rls.sql ---
  accounts: { class: "household_writable", authenticated: ["select", "update", "delete"], policies: ["accounts_select", "accounts_update", "accounts_delete"], browserGrantsRequired: true, codePath: "lib/household/repo.ts, app/api/household/route.ts (RLS-scoped client)" },
  household_members: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: ["household_members_select", "household_members_insert", "household_members_update", "household_members_delete"], browserGrantsRequired: true, codePath: "lib/household/repo.ts, lib/auth/request-context.ts" },
  household_invitations: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: ["household_invitations_select", "household_invitations_insert", "household_invitations_update", "household_invitations_delete"], browserGrantsRequired: true, codePath: "lib/household/repo.ts (owner-scoped; acceptance runs on the service connection)" },
  family_members: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "app/api/family/*, lib/lifecycle/coordinator.ts" },
  policies: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "app/api/policies/*, lib/rag/ingest.ts" },
  policy_members: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "app/api/policies/*, app/api/family/route.ts" },
  policy_detected_people: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "app/api/policies/*" },
  policy_pages: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "lib/rag/ingest.ts" },
  policy_chunks: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "lib/rag/ingest.ts, lib/chat" },
  policy_coverages: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "app/api/coverage/route.ts, lib/coverage/facts.ts" },
  premium_records: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "app/api/premiums/route.ts" },
  chat_messages: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "lib/chat/store.ts" },
  chat_conversations: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "lib/chat/store.ts" },
  policy_corrections: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "app/api/policies/[id]/route.ts" },
  policy_reference_coverages: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "app/api/coverage/route.ts" },
  claim_sessions: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "app/api/claims/*, lib/claims/session.ts, lib/lifecycle/coordinator.ts" },
  policy_benefits: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "lib/policies/benefit-catalog.ts, lib/household/export.ts" },
  coverage_rules: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "lib/ledger/store.ts" },
  policy_cover_conditions: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "lib/rag/ingest.ts" },
  claim_composition_snapshots: { class: "household_writable", authenticated: ["select", "insert", "update", "delete"], policies: MEMBER_CRUD, browserGrantsRequired: true, codePath: "lib/claims/composition/store.ts, lib/household/export.ts" },
  // Evidence: readable, with one narrowly guarded write (lifecycle move to pending_deletion).
  claim_evidence_documents: { class: "household_writable", authenticated: ["select", "update"], policies: ["household_member_select", "household_member_update", "trigger guard_household_evidence_update", "column grant lifecycle_state/lifecycle_version/updated_at"], browserGrantsRequired: true, codePath: "lib/claims/evidence/store.ts (service); lib/lifecycle/coordinator.ts requestClaimEvidenceDeletion (RLS-scoped)" },
  claim_evidence_extractions: { class: "household_readable", authenticated: ["select"], policies: ["household_member_select"], browserGrantsRequired: true, codePath: "lib/claims/evidence/store.ts (service)" },
  claim_evidence_audit_log: { class: "household_readable", authenticated: ["select"], policies: ["household_member_select"], browserGrantsRequired: true, codePath: "lib/claims/evidence/audit.ts (service, single writer); lib/household/export.ts (RLS read)" },
  policy_document_audit_log: { class: "household_readable", authenticated: ["select"], policies: ["household_member_select"], browserGrantsRequired: true, codePath: "lib/policies/quarantine/audit.ts (service, single writer); lib/household/export.ts (RLS read)" },
  // Decision tables: readable; retire-only through the guarded column grant.
  claim_cause_definition_matches: { class: "reviewer_boundary", authenticated: ["select", "update"], policies: ["household_member_select", "household_member_update", "trigger guard_household_decision_retirement", "column grant superseded_at/superseded_reason"], browserGrantsRequired: true, codePath: "lib/claims/reviewers/decisions.ts via lib/claims/reviewers/boundary.ts (service)" },
  claim_ci_definition_matches: { class: "reviewer_boundary", authenticated: ["select", "update"], policies: ["household_member_select", "household_member_update", "trigger guard_household_decision_retirement", "column grant superseded_at/superseded_reason"], browserGrantsRequired: true, codePath: "lib/claims/reviewers/decisions.ts via lib/claims/reviewers/boundary.ts (service)" },
  claim_disability_definition_matches: { class: "reviewer_boundary", authenticated: ["select", "update"], policies: ["household_member_select", "household_member_update", "trigger guard_household_decision_retirement", "column grant superseded_at/superseded_reason"], browserGrantsRequired: true, codePath: "lib/claims/reviewers/decisions.ts via lib/claims/reviewers/boundary.ts (service)" },

  // --- infrastructure: no browser role holds any privilege ---
  background_jobs: { class: "service_only", authenticated: [], policies: DENY("background_jobs"), browserGrantsRequired: false, codePath: "lib/jobs/queue.ts, lib/jobs/worker-runtime.ts, lib/jobs/dead-letter.ts" },
  background_job_audit_log: { class: "service_only", authenticated: [], policies: DENY("background_job_audit_log"), browserGrantsRequired: false, codePath: "lib/jobs/queue.ts appendJobAudit" },
  chat_analysis_jobs: { class: "service_only", authenticated: [], policies: DENY("chat_analysis_jobs"), browserGrantsRequired: false, codePath: "lib/chat/jobs.ts, app/api/chat/history/[id]/route.ts (service)" },
  chat_history_epochs: { class: "service_only", authenticated: [], policies: DENY("chat_history_epochs"), browserGrantsRequired: false, codePath: "lib/chat/store.ts (service)" },
  policy_analysis_cache: { class: "service_only", authenticated: [], policies: DENY("policy_analysis_cache"), browserGrantsRequired: false, codePath: "lib/chat/policy-analysis.ts (service)" },
  deletion_requests: { class: "service_only", authenticated: [], policies: DENY("deletion_requests"), browserGrantsRequired: false, codePath: "lib/lifecycle/deletion-requests.ts, lib/lifecycle/coordinator.ts (service pool)" },
  deletion_audit_log: { class: "service_only", authenticated: [], policies: DENY("deletion_audit_log"), browserGrantsRequired: false, codePath: "lib/lifecycle/deletion-requests.ts appendDeletionAudit" },
  rate_limit_buckets: { class: "service_only", authenticated: [], policies: DENY("rate_limit_buckets"), browserGrantsRequired: false, codePath: "lib/http/db-rate-limit.ts (service)" },
  household_exports: { class: "service_only", authenticated: [], policies: DENY("household_exports"), browserGrantsRequired: false, codePath: "lib/household/export-store.ts, app/api/household/export/* (service), lib/jobs/household-export-processor.ts" },
  household_export_audit_log: { class: "service_only", authenticated: [], policies: DENY("household_export_audit_log"), browserGrantsRequired: false, codePath: "lib/household/export-store.ts appendExportAudit" },
  storage_cleanup_locks: { class: "service_only", authenticated: [], policies: DENY("storage_cleanup_locks"), browserGrantsRequired: false, codePath: "lib/storage/cleanup.ts withCleanupLock" },
  storage_cleanup_audit_log: { class: "service_only", authenticated: [], policies: DENY("storage_cleanup_audit_log"), browserGrantsRequired: false, codePath: "lib/storage/cleanup.ts appendCleanupAudit" },
  model_executions: { class: "service_only", authenticated: [], policies: DENY("model_executions"), browserGrantsRequired: false, codePath: "lib/ai/provenance.ts recordModelExecution" },
  model_usage: { class: "service_only", authenticated: [], policies: DENY("model_usage"), browserGrantsRequired: false, codePath: "lib/ai/ledger.ts (service; enforces the plan spend cap)" },
  scan_provider_events: { class: "service_only", authenticated: [], policies: DENY("scan_provider_events"), browserGrantsRequired: false, codePath: "lib/scanning/callback-auth.ts recordCallbackEventOnce" },
  claim_reviewers: { class: "operator_only", authenticated: [], policies: DENY("claim_reviewers"), browserGrantsRequired: false, codePath: "lib/claims/reviewers/admin.ts (operator CLI); lib/claims/reviewers/boundary.ts (service read)" },
  claim_review_assignments: { class: "operator_only", authenticated: [], policies: DENY("claim_review_assignments"), browserGrantsRequired: false, codePath: "lib/claims/reviewers/admin.ts (operator CLI); lib/claims/reviewers/boundary.ts (service read)" },
  claim_reviewer_audit_log: { class: "operator_only", authenticated: [], policies: DENY("claim_reviewer_audit_log"), browserGrantsRequired: false, codePath: "lib/claims/reviewers/audit.ts (append-only, service)" },
};

/** Tables no browser role may touch at all. */
export const INFRASTRUCTURE_TABLES: readonly string[] = Object.entries(TABLE_INVENTORY)
  .filter(([, e]) => e.class === "service_only" || e.class === "operator_only")
  .map(([t]) => t)
  .sort();

/** Tables a household may read but never write directly. */
export const HOUSEHOLD_READ_ONLY_TABLES: readonly string[] = Object.entries(TABLE_INVENTORY)
  .filter(([, e]) => e.class === "household_readable")
  .map(([t]) => t)
  .sort();

/** Every table created by a migration file, from the SQL itself. */
export function discoverMigrationTables(sqlDir = "sql"): string[] {
  const tables = new Set<string>();
  for (const file of readdirSync(sqlDir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(path.join(sqlDir, file), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) tables.add(m[1].toLowerCase());
  }
  return [...tables].sort();
}

export function inventoryDrift(discovered: readonly string[]): { unclassified: string[]; stale: string[] } {
  const known = new Set(Object.keys(TABLE_INVENTORY));
  const found = new Set(discovered);
  return {
    unclassified: discovered.filter((t) => !known.has(t)),
    stale: [...known].filter((t) => !found.has(t)).sort(),
  };
}

/**
 * Household export (checkpoint 6, claude/v1-launch-hardening): builds the
 * versioned, deterministic JSON snapshot a household is entitled to
 * export. lib/household/export-store.ts owns the request lifecycle
 * (idempotency, expiry, audit); this module only builds the content.
 *
 * Every query here runs through the RLS-scoped client
 * (lib/db/authz-client.ts's createUserSupabaseClient(), the same
 * convention every other multi-table household read in this codebase
 * uses -- see e.g. app/api/policies/route.ts), AND every query still
 * carries an explicit `account_id = $1` / `household_id = $1` predicate.
 * That is deliberate belt-and-suspenders, not redundancy: RLS scopes a
 * caller to every household they belong to, but an export request names
 * ONE specific household, and only the explicit predicate enforces that
 * narrower scope -- "another household's information" must never appear
 * in an export just because the caller happens to also belong to it.
 *
 * ## What is deliberately excluded, and why
 *
 * Per the checkpoint-6 spec's own exclude list:
 *  - passwords / session tokens / service credentials: never stored in
 *    this schema at all (Supabase Auth owns them) -- nothing to exclude.
 *  - invitation token material: household_invitations.token_hash is never
 *    read here; this module does not touch that table at all.
 *  - internal prompts / raw provider payloads: `policies.extracted_json`
 *    (the raw extraction-pipeline output) and any scan-provider detail
 *    fields are never selected -- only the structured, human-meaningful
 *    tables (policy_coverages, policy_benefits) are, which is what
 *    "coverage and benefit summaries" in the spec actually names.
 *  - signed URLs: no storage_key, no signed URL, for any document, is
 *    ever included -- see policySection()/evidenceSection() below.
 *  - internal security telemetry: audit history is curated (see
 *    auditHistorySection()) to a human-meaningful action allowlist, and
 *    strips the raw previous_value/new_value/reason JSON payloads
 *    entirely, rather than exporting the raw audit tables as-is.
 *  - another household's information: see the belt-and-suspenders note
 *    above.
 */
import type { ScopedDbClient } from "@/lib/db/authz-client";

export const HOUSEHOLD_EXPORT_SCHEMA_VERSION = 1;

export interface HouseholdExportSnapshot {
  schemaVersion: number;
  household: { id: string; name: string; createdAt: string };
  members: { userId: string; role: string; joinedAt: string }[];
  familyMembers: {
    id: string;
    displayName: string;
    relationship: string;
    dateOfBirth: string | null;
    preferredName: string | null;
    notes: string | null;
    createdAt: string;
  }[];
  policies: {
    id: string;
    familyMemberId: string;
    insurer: string | null;
    productName: string | null;
    policyNumber: string | null;
    policyType: string | null;
    documentRole: string | null;
    status: string;
    quarantineStatus: string;
    originalFilename: string;
    pageCount: number | null;
    createdAt: string;
  }[];
  coverages: {
    id: string;
    policyId: string;
    familyMemberId: string;
    category: string;
    amount: string | null;
    currency: string | null;
    notes: string | null;
    confirmed: boolean;
  }[];
  benefits: {
    id: string;
    policyId: string;
    benefitName: string;
    productName: string | null;
    formulaKind: string;
    formulaValue: string | null;
    currency: string | null;
    quote: string;
  }[];
  claims: {
    id: string;
    familyMemberId: string;
    status: string;
    eventType: string | null;
    eventSummary: string | null;
    facts: unknown;
    decisionPacket: unknown;
    createdAt: string;
    completedAt: string | null;
  }[];
  evidence: {
    id: string;
    claimSessionId: string;
    documentType: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    status: string;
    scanStatus: string;
    identityStatus: string;
    createdAt: string;
  }[];
  calculationSnapshots: {
    id: string;
    claimSessionId: string;
    calculationId: string;
    engineVersion: string;
    factsSnapshot: unknown;
    coverageVersions: unknown;
    result: unknown;
    calculatedAt: string;
  }[];
  auditHistory: { occurredAt: string; action: string; actor: string; subject: { kind: string; id: string } }[];
}

/** Human-meaningful audit actions this export includes. Deliberately an
 * allowlist, not a denylist: a new action added to either audit-log table
 * in the future is excluded from exports by default until someone decides
 * it belongs here, rather than silently appearing the moment it's added
 * (the safer default for a table whose whole job is "appropriate for the
 * user", per the spec's own wording). Diagnostic-only actions (a failed
 * scan attempt, a conflicting scan result silently ignored by the CAS)
 * are excluded -- they describe internal retry/consistency mechanics, not
 * something the person did or that happened to their document. */
const POLICY_AUDIT_ALLOWLIST = new Set(["quarantined", "scan_started", "scan_result_recorded", "deleted", "superseded"]);
const EVIDENCE_AUDIT_ALLOWLIST = new Set([
  "status_transition",
  "rejected",
  "cause_definition_match_recorded",
  "ci_definition_match_recorded",
  "disability_definition_match_recorded",
  "medical_bill_review_confirmed",
]);

export async function buildHouseholdExportSnapshot(client: ScopedDbClient, householdId: string): Promise<HouseholdExportSnapshot> {
  const household = await client.query<{ id: string; name: string; created_at: string }>(
    `SELECT id, name, created_at FROM accounts WHERE id=$1`,
    [householdId],
  );
  if (household.rows.length === 0) {
    throw new Error(`Household ${householdId} not found while building export.`);
  }

  const members = await client.query<{ user_id: string; role: string; created_at: string }>(
    `SELECT user_id, role, created_at FROM household_members WHERE household_id=$1 ORDER BY created_at ASC, user_id ASC`,
    [householdId],
  );

  const familyMembers = await client.query<{
    id: string;
    display_name: string;
    relationship: string;
    date_of_birth: string | null;
    preferred_name: string | null;
    notes: string | null;
    created_at: string;
  }>(
    `SELECT id, display_name, relationship, date_of_birth, preferred_name, notes, created_at
       FROM family_members WHERE account_id=$1 ORDER BY created_at ASC, id ASC`,
    [householdId],
  );

  const policies = await client.query<{
    id: string;
    family_member_id: string;
    insurer: string | null;
    product_name: string | null;
    policy_number: string | null;
    policy_type: string | null;
    document_role: string | null;
    status: string;
    quarantine_status: string;
    original_filename: string;
    page_count: number | null;
    created_at: string;
  }>(
    `SELECT id, family_member_id, insurer, product_name, policy_number, policy_type, document_role, status,
            quarantine_status, original_filename, page_count, created_at
       FROM policies WHERE account_id=$1 ORDER BY created_at ASC, id ASC`,
    [householdId],
  );

  const coverages = await client.query<{
    id: string;
    policy_id: string;
    family_member_id: string;
    category: string;
    amount: string | null;
    currency: string | null;
    notes: string | null;
    confirmed: boolean;
  }>(
    `SELECT id, policy_id, family_member_id, category, amount, currency, notes, confirmed
       FROM policy_coverages WHERE account_id=$1 ORDER BY created_at ASC, id ASC`,
    [householdId],
  );

  const benefits = await client.query<{
    id: string;
    policy_id: string;
    benefit_name: string;
    product_name: string | null;
    formula_kind: string;
    formula_value: string | null;
    currency: string | null;
    quote: string;
  }>(
    `SELECT id, policy_id, benefit_name, product_name, formula_kind, formula_value, currency, quote
       FROM policy_benefits WHERE account_id=$1 ORDER BY created_at ASC, id ASC`,
    [householdId],
  );

  const claims = await client.query<{
    id: string;
    family_member_id: string;
    status: string;
    event_type: string | null;
    event_summary: string | null;
    facts: unknown;
    decision_packet: unknown;
    created_at: string;
    completed_at: string | null;
  }>(
    `SELECT id, family_member_id, status, event_type, event_summary, facts, decision_packet, created_at, completed_at
       FROM claim_sessions WHERE account_id=$1 ORDER BY created_at ASC, id ASC`,
    [householdId],
  );

  const evidence = await client.query<{
    id: string;
    claim_session_id: string;
    document_type: string;
    original_filename: string;
    mime_type: string;
    byte_size: number;
    status: string;
    scan_status: string;
    identity_status: string;
    created_at: string;
  }>(
    `SELECT id, claim_session_id, document_type, original_filename, mime_type, byte_size, status, scan_status, identity_status, created_at
       FROM claim_evidence_documents WHERE account_id=$1 ORDER BY created_at ASC, id ASC`,
    [householdId],
  );

  const calculationSnapshots = await client.query<{
    id: string;
    claim_session_id: string;
    calculation_id: string;
    engine_version: string;
    facts_snapshot: unknown;
    coverage_versions: unknown;
    result: unknown;
    calculated_at: string;
  }>(
    `SELECT id, claim_session_id, calculation_id, engine_version, facts_snapshot, coverage_versions, result, calculated_at
       FROM claim_composition_snapshots WHERE account_id=$1 ORDER BY calculated_at ASC, id ASC`,
    [householdId],
  );

  const policyAudit = await client.query<{ policy_id: string | null; action: string; actor: string; occurred_at: string }>(
    `SELECT policy_id, action, actor, occurred_at FROM policy_document_audit_log WHERE account_id=$1 ORDER BY occurred_at ASC, id ASC`,
    [householdId],
  );
  const evidenceAudit = await client.query<{ evidence_document_id: string | null; action: string; actor: string; occurred_at: string }>(
    `SELECT evidence_document_id, action, actor, occurred_at FROM claim_evidence_audit_log WHERE account_id=$1 ORDER BY occurred_at ASC, id ASC`,
    [householdId],
  );

  const auditHistory = [
    ...policyAudit.rows
      .filter((r) => POLICY_AUDIT_ALLOWLIST.has(r.action) && r.policy_id)
      .map((r) => ({ occurredAt: r.occurred_at, action: r.action, actor: r.actor, subject: { kind: "policy", id: r.policy_id as string } })),
    ...evidenceAudit.rows
      .filter((r) => EVIDENCE_AUDIT_ALLOWLIST.has(r.action) && r.evidence_document_id)
      .map((r) => ({
        occurredAt: r.occurred_at,
        action: r.action,
        actor: r.actor,
        subject: { kind: "claim_evidence", id: r.evidence_document_id as string },
      })),
  ].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.subject.id.localeCompare(b.subject.id)));

  return {
    schemaVersion: HOUSEHOLD_EXPORT_SCHEMA_VERSION,
    household: { id: household.rows[0].id, name: household.rows[0].name, createdAt: household.rows[0].created_at },
    members: members.rows.map((r) => ({ userId: r.user_id, role: r.role, joinedAt: r.created_at })),
    familyMembers: familyMembers.rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      relationship: r.relationship,
      dateOfBirth: r.date_of_birth,
      preferredName: r.preferred_name,
      notes: r.notes,
      createdAt: r.created_at,
    })),
    policies: policies.rows.map((r) => ({
      id: r.id,
      familyMemberId: r.family_member_id,
      insurer: r.insurer,
      productName: r.product_name,
      policyNumber: r.policy_number,
      policyType: r.policy_type,
      documentRole: r.document_role,
      status: r.status,
      quarantineStatus: r.quarantine_status,
      originalFilename: r.original_filename,
      pageCount: r.page_count,
      createdAt: r.created_at,
    })),
    coverages: coverages.rows.map((r) => ({
      id: r.id,
      policyId: r.policy_id,
      familyMemberId: r.family_member_id,
      category: r.category,
      amount: r.amount,
      currency: r.currency,
      notes: r.notes,
      confirmed: r.confirmed,
    })),
    benefits: benefits.rows.map((r) => ({
      id: r.id,
      policyId: r.policy_id,
      benefitName: r.benefit_name,
      productName: r.product_name,
      formulaKind: r.formula_kind,
      formulaValue: r.formula_value,
      currency: r.currency,
      quote: r.quote,
    })),
    claims: claims.rows.map((r) => ({
      id: r.id,
      familyMemberId: r.family_member_id,
      status: r.status,
      eventType: r.event_type,
      eventSummary: r.event_summary,
      facts: r.facts,
      decisionPacket: r.decision_packet,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    })),
    evidence: evidence.rows.map((r) => ({
      id: r.id,
      claimSessionId: r.claim_session_id,
      documentType: r.document_type,
      originalFilename: r.original_filename,
      mimeType: r.mime_type,
      byteSize: r.byte_size,
      status: r.status,
      scanStatus: r.scan_status,
      identityStatus: r.identity_status,
      createdAt: r.created_at,
    })),
    calculationSnapshots: calculationSnapshots.rows.map((r) => ({
      id: r.id,
      claimSessionId: r.claim_session_id,
      calculationId: r.calculation_id,
      engineVersion: r.engine_version,
      factsSnapshot: r.facts_snapshot,
      coverageVersions: r.coverage_versions,
      result: r.result,
      calculatedAt: r.calculated_at,
    })),
    auditHistory,
  };
}

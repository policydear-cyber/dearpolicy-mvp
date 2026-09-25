/**
 * Read models for the internal reviewer area. Every function here takes an
 * already-authorized reviewer (lib/claims/reviewers/boundary.ts) and reads
 * only inside that reviewer's assignment scope: the assignment list is
 * filtered by the same conditions the boundary enforces, and an
 * assignment's workspace is built from the ids the boundary resolved --
 * never from request input.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { confirmedOwnedCoverages } from "@/lib/coverage/facts";
import { loadDeathEvidence } from "@/lib/claims/death-evidence";
import { loadCIEvidence } from "@/lib/claims/ci-evidence";
import { loadDisabilityEvidence } from "@/lib/claims/disability-evidence";
import { loadTravelEvidence } from "@/lib/claims/travel-evidence";
import type { ClaimEvidence } from "@/lib/claims/types";
import { evaluateEvidenceAuthority } from "@/lib/claims/evidence-authority";
import { documentTypeGroup, documentTypeLabel } from "@/lib/claims/evidence/document-catalogue";
import { provenanceSnapshotForExtraction } from "@/lib/claims/evidence/extraction-provenance";
import { ensureCriticalIllnessSchema } from "@/lib/claims/evidence/ci-schema";
import { ensureDisabilitySchema } from "@/lib/claims/evidence/disability-schema";
import { getLatestExtraction, listEvidenceDocuments } from "@/lib/claims/evidence/store";
import { ACTIVE_ASSIGNMENT_CONDITIONS, type AssignedClaimReview } from "./boundary";
import { isLegacyUnverifiedDecision } from "@/lib/claims/evidence/decision-selection";
import { ensureClaimReviewerSchema } from "./schema";

export type ReviewerAssignmentSummary = {
  id: string; claimSessionId: string; evidenceDocumentId: string | null; expiresAt: string; assignedAt: string;
  memberName: string; eventType: string | null; eventSummary: string | null; documentCount: number;
};

export async function listActiveAssignments(reviewerUserId: string): Promise<ReviewerAssignmentSummary[]> {
  await ensureClaimReviewerSchema();
  const { rows } = await query<{
    id: string; claim_session_id: string; evidence_document_id: string | null; expires_at: string; assigned_at: string;
    member_name: string; event_type: string | null; event_summary: string | null; document_count: number;
  }>(
    `SELECT a.id::text AS id, a.claim_session_id::text AS claim_session_id, a.evidence_document_id::text AS evidence_document_id,
            a.expires_at::text AS expires_at, a.assigned_at::text AS assigned_at,
            fm.display_name AS member_name, cs.event_type, cs.event_summary,
            (SELECT count(*)::int FROM claim_evidence_documents d
              WHERE d.account_id=a.account_id AND d.claim_session_id=a.claim_session_id AND d.family_member_id=a.family_member_id
                AND d.superseded_at IS NULL AND ${activePredicate("d")}
                AND (a.evidence_document_id IS NULL OR d.id=a.evidence_document_id)) AS document_count
       FROM claim_review_assignments a
       JOIN claim_reviewers r ON r.user_id=a.reviewer_user_id AND r.status='active'
       JOIN accounts acc ON acc.id=a.account_id AND ${activePredicate("acc")}
       JOIN family_members fm ON fm.id=a.family_member_id AND fm.account_id=a.account_id AND ${activePredicate("fm")}
       JOIN claim_sessions cs ON cs.id=a.claim_session_id AND cs.account_id=a.account_id AND cs.family_member_id=a.family_member_id
      WHERE ${ACTIVE_ASSIGNMENT_CONDITIONS}
      ORDER BY a.expires_at, a.id`,
    [reviewerUserId],
  );
  return rows.map((r) => ({
    id: r.id, claimSessionId: r.claim_session_id, evidenceDocumentId: r.evidence_document_id, expiresAt: r.expires_at, assignedAt: r.assigned_at,
    memberName: r.member_name, eventType: r.event_type, eventSummary: r.event_summary, documentCount: Number(r.document_count),
  }));
}

export type DefinitionRouteName = "match" | "ci-match" | "disability-match" | "travel-match";

export type DefinitionOption = {
  route: DefinitionRouteName;
  contractId: string; coverageId: string; label: string;
  benefitCode?: string; illnessName?: string; matchKey?: string;
  quote: string; citation: { policyName: string | null; pageStart: number | null; pageEnd: number | null; label: string | null };
};

export type DecisionHistoryEntry = {
  id: string; kind: "cause" | "ci" | "disability"; evidenceDocumentId: string; contractId: string; coverageId: string | null;
  benefitCode: string | null; illnessName: string | null; matchKey: string | null;
  result: string; reason: string | null; reviewedBy: string; reviewedAt: string; supersededAt: string | null; supersededReason: string | null;
  /** Recorded without a wording fingerprint: history only, never usable. */
  legacyUnverified: boolean;
};

function citationOf(c: ClaimEvidence) {
  return { policyName: c.policyName ?? null, pageStart: c.pageStart ?? null, pageEnd: c.pageEnd ?? null, label: c.evidenceLabel ?? null };
}

/** Everything an assigned reviewer needs to decide, scoped to the one claim
 * (and, for a single-document assignment, the one document) they were
 * given. Policy definitions come from the same loaders the confirm*Match()
 * functions and calculators use, so what the reviewer reads is exactly
 * what their decision will be checked against. */
export async function loadAssignmentWorkspace(review: AssignedClaimReview) {
  await ensureCriticalIllnessSchema();
  await ensureDisabilitySchema();
  const claim = await query<{ event_type: string | null; event_summary: string | null; member_name: string }>(
    `SELECT cs.event_type, cs.event_summary, fm.display_name AS member_name
       FROM claim_sessions cs JOIN family_members fm ON fm.id=cs.family_member_id AND fm.account_id=cs.account_id AND ${activePredicate("fm")}
      WHERE cs.id=$1 AND cs.account_id=$2 AND cs.family_member_id=$3`,
    [review.claimSessionId, review.accountId, review.familyMemberId],
  );

  const allDocuments = await listEvidenceDocuments(review.accountId, review.claimSessionId);
  const documents = allDocuments.filter((d) => d.family_member_id === review.familyMemberId
    && (!review.assignedEvidenceDocumentId || d.id === review.assignedEvidenceDocumentId));
  const documentViews = [];
  for (const d of documents) {
    const extraction = await getLatestExtraction(review.accountId, d.id);
    const fields = extraction ? { ...extraction.extracted_fields, ...(extraction.reviewed_fields ?? {}) } : null;
    const authorized = extraction
      ? evaluateEvidenceAuthority(provenanceSnapshotForExtraction(extraction, d.id), { expectedSourceDocumentId: d.id }).authorized
      : false;
    documentViews.push({
      id: d.id, documentType: d.document_type, documentTypeLabel: documentTypeLabel(d.document_type), group: documentTypeGroup(d.document_type),
      originalFilename: d.original_filename, status: d.status, identityStatus: d.identity_status, uploadedAt: d.created_at,
      fields, citations: fields?.pageCitations ?? [], modelReadingVerified: authorized,
    });
  }

  const coverages = await confirmedOwnedCoverages(review.accountId, review.familyMemberId);
  const definitions: DefinitionOption[] = [];
  const definitionErrors: string[] = [];
  const guard = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch { definitionErrors.push(label); }
  };
  await guard("accidental death", async () => {
    const { rules } = await loadDeathEvidence(review.accountId, review.familyMemberId, coverages);
    for (const r of rules.filter((x) => x.benefit === "gpa-accidental-death")) {
      definitions.push({ route: "match", contractId: r.citation.policyId, coverageId: r.coverageId, label: "Accidental death definition", quote: r.quote, citation: citationOf(r.citation) });
    }
  });
  await guard("travel accidental death", async () => {
    const { rules } = await loadTravelEvidence(review.accountId, review.familyMemberId, coverages);
    for (const r of rules) {
      if (r.benefitCode !== "travel-accidental-death") continue;
      definitions.push({ route: "travel-match", contractId: r.citation.policyId, coverageId: r.coverageId, label: "Travel accidental death definition", quote: r.quote, citation: citationOf(r.citation) });
    }
  });
  await guard("critical illness", async () => {
    const { rules } = await loadCIEvidence(review.accountId, review.familyMemberId, coverages);
    for (const r of rules) {
      definitions.push({ route: "ci-match", contractId: r.citation.policyId, coverageId: r.coverageId, label: `${r.illnessName} (${r.benefitCode})`, benefitCode: r.benefitCode, illnessName: r.illnessName, quote: r.quote, citation: citationOf(r.citation) });
    }
  });
  await guard("disability", async () => {
    const { rules } = await loadDisabilityEvidence(review.accountId, review.familyMemberId, coverages);
    for (const r of rules) {
      definitions.push({ route: "disability-match", contractId: r.citation.policyId, coverageId: r.coverageId, label: `${r.label} (${r.benefitCode})`, benefitCode: r.benefitCode, matchKey: r.matchKey, quote: r.quote, citation: citationOf(r.citation) });
    }
  });

  const documentIds = documentViews.map((d) => d.id);
  const history: DecisionHistoryEntry[] = documentIds.length === 0 ? [] : (await query<{
    id: string; kind: string; evidence_document_id: string; contract_id: string; coverage_id: string | null;
    benefit_code: string | null; illness_name: string | null; match_key: string | null; result: string; reason: string | null;
    reviewed_by: string; reviewed_at: string; superseded_at: string | null; superseded_reason: string | null; definition_evidence: unknown;
  }>(
    `SELECT id::text AS id, 'cause' AS kind, evidence_document_id::text AS evidence_document_id, contract_id::text AS contract_id, coverage_id::text AS coverage_id,
            NULL::text AS benefit_code, NULL::text AS illness_name, NULL::text AS match_key, result, reason, reviewed_by, reviewed_at::text AS reviewed_at,
            superseded_at::text AS superseded_at, superseded_reason, definition_evidence
       FROM claim_cause_definition_matches WHERE account_id=$1 AND claim_session_id=$2 AND family_member_id=$3 AND evidence_document_id=ANY($4::uuid[])
     UNION ALL
     SELECT id::text, 'ci', evidence_document_id::text, contract_id::text, coverage_id::text, benefit_code, illness_name, NULL::text, result, reason, reviewed_by, reviewed_at::text,
            superseded_at::text, superseded_reason, definition_evidence
       FROM claim_ci_definition_matches WHERE account_id=$1 AND claim_session_id=$2 AND family_member_id=$3 AND evidence_document_id=ANY($4::uuid[])
     UNION ALL
     SELECT id::text, 'disability', evidence_document_id::text, contract_id::text, coverage_id::text, benefit_code, NULL::text, match_key, result, reason, reviewed_by, reviewed_at::text,
            superseded_at::text, superseded_reason, definition_evidence
       FROM claim_disability_definition_matches WHERE account_id=$1 AND claim_session_id=$2 AND family_member_id=$3 AND evidence_document_id=ANY($4::uuid[])
     ORDER BY reviewed_at DESC, id`,
    [review.accountId, review.claimSessionId, review.familyMemberId, documentIds],
  )).rows.map((r) => ({
    id: r.id, kind: r.kind as DecisionHistoryEntry["kind"], evidenceDocumentId: r.evidence_document_id, contractId: r.contract_id, coverageId: r.coverage_id,
    benefitCode: r.benefit_code, illnessName: r.illness_name, matchKey: r.match_key, result: r.result, reason: r.reason,
    reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, supersededAt: r.superseded_at, supersededReason: r.superseded_reason,
    legacyUnverified: isLegacyUnverifiedDecision(r.definition_evidence),
  }));

  return {
    assignment: { id: review.assignmentId, expiresAt: review.expiresAt, singleDocument: review.assignedEvidenceDocumentId !== null },
    reviewer: { displayLabel: review.displayLabel, identity: review.reviewerIdentity },
    claim: { memberName: claim.rows[0]?.member_name ?? "", eventType: claim.rows[0]?.event_type ?? null, eventSummary: claim.rows[0]?.event_summary ?? null },
    documents: documentViews,
    coverages: coverages.map((c) => ({ id: c.id, policyId: c.policyId, category: c.category, productName: c.productName, insurer: c.insurer, policyName: c.policyName, policyNumber: c.policyNumber })),
    definitions,
    definitionErrors,
    history,
  };
}

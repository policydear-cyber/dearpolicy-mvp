/**
 * The single authorization boundary for DearPolicy's internal claim
 * reviewers. Every reviewer route -- the four policy-definition match
 * routes, the assignment list/detail and the assignment-checked document
 * stream -- goes through requireActiveClaimReviewer() or
 * requireAssignedClaimReviewer() below and nothing else
 * (scripts/route-inventory-regressions.ts enforces that statically).
 *
 * What makes someone a reviewer is a claim_reviewers row written by the
 * trusted operator procedure (lib/claims/reviewers/admin.ts), keyed by the
 * authenticated Supabase user id. Nothing a browser can send changes the
 * outcome: identity comes from the verified session, and household,
 * family member, claim, evidence document, contract and coverage are all
 * resolved here, server-side, from the assignment row -- a request body can
 * only NAME an assignment, a document or a coverage, and each named thing
 * must fall inside that assignment's scope or the request is refused.
 *
 * Refusals are deliberately indistinguishable: an unknown, foreign,
 * expired, revoked, out-of-scope or self-review assignment all produce the
 * same ReviewAssignmentNotFoundError, so a reviewer cannot probe for
 * claims they were not given.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isUuid, query } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/session";
import { routeErrorResponse } from "@/lib/auth/request-context";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { confirmedOwnedCoverages, type OwnedCoverage } from "@/lib/coverage/facts";
import { getScopedEvidenceDocument } from "@/lib/claims/evidence/store";
import type { ClaimEvidenceDocumentRow } from "@/lib/claims/evidence/types";
import { ensureClaimReviewerSchema } from "./schema";

/** The caller is not an active, provisioned DearPolicy reviewer. */
export class ReviewerAccessDeniedError extends Error {}
/** The named assignment/document/coverage is not within this reviewer's
 * active assignment -- for any reason. */
export class ReviewAssignmentNotFoundError extends Error {}

/** The actor string written into every match row and audit record. */
export function reviewerIdentity(userId: string): string {
  return `reviewer:${userId}`;
}

export type ActiveClaimReviewer = { userId: string; reviewerIdentity: string; displayLabel: string };

export async function requireActiveClaimReviewer(): Promise<ActiveClaimReviewer> {
  const user = await requireCurrentUser();
  if (!isUuid(user.id)) throw new ReviewerAccessDeniedError("Not an active DearPolicy reviewer.");
  await ensureClaimReviewerSchema();
  const { rows } = await query<{ display_label: string }>(
    `SELECT display_label FROM claim_reviewers WHERE user_id=$1 AND status='active'`,
    [user.id],
  );
  if (!rows[0]) throw new ReviewerAccessDeniedError("Not an active DearPolicy reviewer.");
  return { userId: user.id, reviewerIdentity: reviewerIdentity(user.id), displayLabel: rows[0].display_label };
}

export type AssignedClaimReview = ActiveClaimReviewer & {
  assignmentId: string;
  accountId: string;
  familyMemberId: string;
  claimSessionId: string;
  /** Set when the assignment covers exactly one document. */
  assignedEvidenceDocumentId: string | null;
  expiresAt: string;
  /** Resolved only when the caller named a document. */
  evidenceDocument: ClaimEvidenceDocumentRow | null;
  /** Resolved only when the caller named a contract (and optionally a
   * coverage): always one of this family member's own confirmed coverages. */
  coverage: OwnedCoverage | null;
};

type AssignmentRow = {
  id: string; account_id: string; family_member_id: string; claim_session_id: string;
  evidence_document_id: string | null; expires_at: string;
};

/** Every condition an assignment must meet to grant anything, in one
 * statement: the reviewer is still active; the assignment is theirs, active,
 * unrevoked and unexpired; the household, family member and claim still
 * exist, are still live and still belong together; and the reviewer is not
 * a member of the household (no one reviews their own household's claim,
 * however the membership came about or when). */
export const ACTIVE_ASSIGNMENT_CONDITIONS = `a.reviewer_user_id=$1 AND a.status='active' AND a.revoked_at IS NULL AND a.expires_at > now()
   AND NOT EXISTS (SELECT 1 FROM household_members hm WHERE hm.household_id=a.account_id AND hm.user_id=$1)`;

export async function loadActiveAssignment(reviewerUserId: string, assignmentId: string): Promise<AssignmentRow | null> {
  const { rows } = await query<AssignmentRow>(
    `SELECT a.id::text AS id, a.account_id::text AS account_id, a.family_member_id::text AS family_member_id,
            a.claim_session_id::text AS claim_session_id, a.evidence_document_id::text AS evidence_document_id, a.expires_at::text AS expires_at
       FROM claim_review_assignments a
       JOIN claim_reviewers r ON r.user_id=a.reviewer_user_id AND r.status='active'
       JOIN accounts acc ON acc.id=a.account_id AND ${activePredicate("acc")}
       JOIN family_members fm ON fm.id=a.family_member_id AND fm.account_id=a.account_id AND ${activePredicate("fm")}
       JOIN claim_sessions cs ON cs.id=a.claim_session_id AND cs.account_id=a.account_id AND cs.family_member_id=a.family_member_id
      WHERE a.id=$2 AND ${ACTIVE_ASSIGNMENT_CONDITIONS}`,
    [reviewerUserId, assignmentId],
  );
  return rows[0] ?? null;
}

const notFound = () => new ReviewAssignmentNotFoundError("Review assignment not found.");

export async function requireAssignedClaimReviewer(args: {
  assignmentId: unknown;
  /** The document the request acts on (e.g. the route's [id] segment). */
  evidenceDocumentId?: unknown;
  /** Present (even as null/undefined value) when the request acts on a
   * policy: pass `contractId` and `coverageId` from the body and both are
   * resolved against this family member's confirmed coverages. */
  contractId?: unknown;
  coverageId?: unknown;
}): Promise<AssignedClaimReview> {
  const reviewer = await requireActiveClaimReviewer();
  if (typeof args.assignmentId !== "string" || !isUuid(args.assignmentId)) throw notFound();
  const row = await loadActiveAssignment(reviewer.userId, args.assignmentId);
  if (!row) throw notFound();

  let evidenceDocument: ClaimEvidenceDocumentRow | null = null;
  if ("evidenceDocumentId" in args) {
    const documentId = args.evidenceDocumentId;
    if (typeof documentId !== "string" || !isUuid(documentId)) throw notFound();
    if (row.evidence_document_id && row.evidence_document_id !== documentId) throw notFound();
    evidenceDocument = await getScopedEvidenceDocument({
      accountId: row.account_id, familyMemberId: row.family_member_id, claimSessionId: row.claim_session_id, id: documentId,
    });
    if (!evidenceDocument) throw notFound();
  }

  let coverage: OwnedCoverage | null = null;
  if ("contractId" in args) {
    const contractId = args.contractId;
    const coverageId = args.coverageId ?? null;
    if (typeof contractId !== "string" || !isUuid(contractId)) throw notFound();
    if (coverageId !== null && (typeof coverageId !== "string" || !isUuid(coverageId))) throw notFound();
    const coverages = await confirmedOwnedCoverages(row.account_id, row.family_member_id);
    coverage = coverages.find((c) => c.policyId === contractId && (coverageId === null || c.id === coverageId)) ?? null;
    if (!coverage) throw notFound();
  }

  return {
    ...reviewer,
    assignmentId: row.id,
    accountId: row.account_id,
    familyMemberId: row.family_member_id,
    claimSessionId: row.claim_session_id,
    assignedEvidenceDocumentId: row.evidence_document_id,
    expiresAt: row.expires_at,
    evidenceDocument,
    coverage,
  };
}

export const REVIEWER_ACCESS_REQUIRED = { error: "This area is only for assigned DearPolicy reviewers.", reasonCode: "REVIEWER_ACCESS_REQUIRED" } as const;

/** Maps the boundary's refusals to responses: 403 for a caller who is not
 * an active reviewer at all (`deniedBody` lets a route keep its own
 * household-facing wording), one generic 404 for anything about an
 * assignment's scope, and routeErrorResponse() for everything else
 * (401 when not signed in, a generic 500 otherwise). */
export function reviewerRouteErrorResponse(
  error: unknown,
  options: { request?: NextRequest; deniedBody?: Record<string, string> } = {},
): NextResponse {
  if (error instanceof ReviewerAccessDeniedError) return NextResponse.json(options.deniedBody ?? REVIEWER_ACCESS_REQUIRED, { status: 403 });
  if (error instanceof ReviewAssignmentNotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return routeErrorResponse(error, { request: options.request });
}

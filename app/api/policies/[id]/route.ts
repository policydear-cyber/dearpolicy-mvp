import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { userFacingScanResultDetail, POLICY_PROCESSING_STOPPED_MESSAGE } from "@/lib/policies/quarantine/ui";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import {
  DeletionValidationError,
  finishPolicyDeletion,
  finishPolicyDocumentDeletion,
  requestPolicyDeletion,
  requestPolicyDocumentDeletion,
} from "@/lib/lifecycle/coordinator";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: policyId } = await params;
  if (!isUuid(policyId)) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  // Checkpoint 7: deletion now goes through the shared lifecycle
  // coordinator (lib/lifecycle/coordinator.ts) instead of hard-deleting
  // the row inline. Without an explicit Idempotency-Key header, a repeat
  // DELETE for the same document (a retried request, a double click)
  // defaults to a per-resource key so it still resolves to the SAME
  // deletion request rather than erroring or repeating destructive work.
  const idempotencyKey = request.headers.get("idempotency-key") || `delete:${policyId}`;

  // ?scope=policy deletes the WHOLE logical policy (every version in its
  // supersedes_id chain, plus any shared reference document this leaves
  // orphaned -- see requestPolicyDeletion). Omitted or any other value
  // preserves the original behaviour: deleting just this one document
  // version. A distinct query param rather than a body field because a
  // DELETE request body is not reliably forwarded by every client/proxy
  // in this stack, and the two flows share nothing but their target id.
  const scope = new URL(request.url).searchParams.get("scope");
  const wholePolicy = scope === "policy";

  let householdId: string;
  let actorUserId: string;

  if (wholePolicy) {
    let outcome: Awaited<ReturnType<typeof requestPolicyDeletion>> | null = null;
    try {
      const ctx = await requireHouseholdContext(request);
      householdId = ctx.householdId;
      actorUserId = ctx.userId;

      outcome = await createUserSupabaseClient(ctx.userId, async (client) => {
        try {
          return await requestPolicyDeletion({
            client,
            accountId: ctx.householdId,
            actorUserId: ctx.userId,
            policyId,
            reasonCategory: "user_requested",
            idempotencyKey,
          });
        } catch (error) {
          if (error instanceof DeletionValidationError) return null;
          throw error;
        }
      });
    } catch (error) {
      return routeErrorResponse(error);
    }

    if (!outcome) return NextResponse.json({ error: "Policy not found" }, { status: 404 });

    let storageWarning: string | null = null;
    if (outcome.status === "accepted") {
      const finished = await finishPolicyDeletion({
        accountId: householdId,
        actorUserId,
        policyId,
        chainPolicyIds: outcome.chainPolicyIds,
        deletionRequestId: outcome.deletionRequestId,
      });
      storageWarning = finished.storageWarning;
    }

    return NextResponse.json({
      deleted: true,
      id: policyId,
      filename: outcome.filename,
      chainPolicyIds: outcome.chainPolicyIds,
      affectedFamilyMemberIds: outcome.affectedFamilyMemberIds,
      affectedOpenClaimSessionIds: outcome.affectedOpenClaimSessionIds,
      storageWarning,
      deletionRequestId: outcome.deletionRequestId,
      status: outcome.status === "accepted" ? "completed" : outcome.status,
    });
  }

  let outcome: Awaited<ReturnType<typeof requestPolicyDocumentDeletion>> | null = null;
  try {
    const ctx = await requireHouseholdContext(request);
    householdId = ctx.householdId;
    actorUserId = ctx.userId;

    outcome = await createUserSupabaseClient(ctx.userId, async (client) => {
      try {
        // policy_pages, policy_chunks, policy_coverages, policy_members,
        // policy_detected_people and policy_corrections stay in place
        // (no longer removed by ON DELETE CASCADE at this step -- the row
        // itself is not hard-deleted here) until the storage-cleanup
        // engine's later pass; every read call site this checkpoint has
        // migrated already excludes them via lifecycle_state='active'.
        return await requestPolicyDocumentDeletion({
          client,
          accountId: ctx.householdId,
          actorUserId: ctx.userId,
          policyId,
          reasonCategory: "user_requested",
          idempotencyKey,
        });
      } catch (error) {
        if (error instanceof DeletionValidationError) return null;
        throw error;
      }
    });
  } catch (error) {
    return routeErrorResponse(error);
  }

  if (!outcome) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  let storageWarning: string | null = null;
  if (outcome.status === "accepted") {
    const finished = await finishPolicyDocumentDeletion({
      accountId: householdId,
      actorUserId,
      policyId,
      deletionRequestId: outcome.deletionRequestId,
    });
    storageWarning = finished.storageWarning;
  }

  return NextResponse.json({
    deleted: true,
    id: policyId,
    filename: outcome.filename,
    storageWarning,
    deletionRequestId: outcome.deletionRequestId,
    status: outcome.status === "accepted" ? "completed" : outcome.status,
  });
}

/** The document review screen's data: what DearPolicy detected, extracted
 * and linked for ONE of this household's documents -- with page citations,
 * verification flags and needs-review indicators. Never includes storage
 * keys, raw scan/provider detail, raw processing errors, prompts or any
 * internal identifier beyond the row ids the household already sees. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const ctx = await requireHouseholdContext(request);
    const result = await createUserSupabaseClient(ctx.userId, async (client) => {
      const policy = await client.query<Record<string, unknown>>(
        `SELECT id,original_filename,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,
                document_authority_label,personal_coverage_confirmed,needs_review,review_reason,page_count,
                effective_date::text,renewal_or_expiry_date::text,processing_status,processing_stage,processing_message,
                processing_error,quarantine_status,scan_result_detail,extracted_json,created_at::text,updated_at::text
           FROM policies WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,
        [id, ctx.householdId],
      );
      if (!policy.rows[0]) return null;
      const [members, detected, coverages, referenceCoverages, premiums] = await Promise.all([
        client.query(
          `SELECT f.id,f.display_name,pm.source,pm.confidence FROM policy_members pm
             JOIN family_members f ON f.id=pm.family_member_id AND f.account_id=pm.account_id AND ${activePredicate("f")}
            WHERE pm.policy_id=$1 AND pm.account_id=$2 ORDER BY f.display_name`,
          [id, ctx.householdId],
        ),
        client.query(
          `SELECT detected_name,matched_family_member_id,confidence FROM policy_detected_people WHERE policy_id=$1 AND account_id=$2 ORDER BY detected_name`,
          [id, ctx.householdId],
        ),
        client.query(
          `SELECT c.category,c.amount,c.currency,c.product_name,c.source_page,c.evidence_text,c.evidence_verified,f.display_name AS member_name
             FROM policy_coverages c JOIN family_members f ON f.id=c.family_member_id AND f.account_id=c.account_id AND ${activePredicate("f")}
            WHERE c.policy_id=$1 AND c.account_id=$2 ORDER BY f.display_name,c.category`,
          [id, ctx.householdId],
        ),
        client.query(
          `SELECT category,product_name,source_page FROM policy_reference_coverages WHERE policy_id=$1 AND account_id=$2 ORDER BY category`,
          [id, ctx.householdId],
        ),
        client.query(
          `SELECT amount,currency,frequency,payment_date::text,period_start::text,period_end::text,source_page FROM premium_records
            WHERE source_document_id=$1 AND account_id=$2 ORDER BY payment_date NULLS LAST`,
          [id, ctx.householdId],
        ),
      ]);
      return { policy: policy.rows[0], members: members.rows, detected: detected.rows, coverages: coverages.rows, referenceCoverages: referenceCoverages.rows, premiums: premiums.rows };
    });
    if (!result) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const p = result.policy as Record<string, unknown> & { extracted_json?: Record<string, unknown> | null };
    const extracted = (p.extracted_json ?? {}) as Record<string, unknown>;
    const corrections = await createUserSupabaseClient(ctx.userId, (client) =>
      client.query<{ field_name: string; ai_value: unknown; corrected_value: unknown; created_at: string }>(
        `SELECT field_name,ai_value,corrected_value,created_at::text FROM policy_corrections WHERE policy_id=$1 AND account_id=$2 ORDER BY created_at DESC LIMIT 20`, [id, ctx.householdId]),
    );
    // Household corrections are an append-only log; the newest correction per
    // field overlays the AI-extracted value in everything the person sees,
    // while the policies row itself (server-owned) keeps the original.
    const correctedFields: Record<string, string> = {};
    for (const row of corrections.rows) {
      if (!(row.field_name in correctedFields) && typeof row.corrected_value === "string") correctedFields[row.field_name] = row.corrected_value;
    }
    return NextResponse.json({
      document: {
        id: p.id, originalFilename: p.original_filename,
        insurer: correctedFields.insurer ?? p.insurer, productName: correctedFields.product_name ?? p.product_name,
        policyNumber: correctedFields.policy_number ?? p.policy_number, groupPolicyNumber: p.group_policy_number,
        policyType: correctedFields.policy_type ?? p.policy_type,
        correctedFields: Object.keys(correctedFields),
        documentRole: p.document_role, authorityLabel: p.document_authority_label,
        personalCoverageConfirmed: p.personal_coverage_confirmed, needsReview: p.needs_review, reviewReason: p.review_reason,
        pageCount: p.page_count, effectiveDate: p.effective_date, renewalOrExpiryDate: p.renewal_or_expiry_date,
        processingStatus: p.processing_status, processingStage: p.processing_stage, processingMessage: p.processing_message,
        processingError: p.processing_error ? POLICY_PROCESSING_STOPPED_MESSAGE : null,
        quarantineStatus: p.quarantine_status,
        scanResultDetail: userFacingScanResultDetail({ quarantine_status: String(p.quarantine_status), scan_result_detail: (p.scan_result_detail as string | null) ?? null }),
        uploadedAt: p.created_at, updatedAt: p.updated_at,
      },
      linkedMembers: result.members,
      detectedPeople: result.detected,
      coverages: result.coverages,
      referenceCoverages: result.referenceCoverages,
      premiums: result.premiums,
      extracted: {
        documentType: (extracted.documentType as string | null) ?? null,
        documentNotes: (extracted.documentNotes as string[] | undefined) ?? [],
        productsMentioned: (extracted.productsMentioned as string[] | undefined) ?? [],
        keyExclusions: (extracted.keyExclusions as string[] | undefined) ?? [],
        waitingPeriods: (extracted.waitingPeriods as string[] | undefined) ?? [],
        deductiblesAndCoinsurance: (extracted.deductiblesAndCoinsurance as string[] | undefined) ?? [],
        riders: (extracted.riders as string[] | undefined) ?? [],
        premium: (extracted.premium as { amount: number | null; currency: string | null; frequency: string | null } | undefined) ?? null,
      },
      corrections: corrections.rows,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Correction control for the review screen: the household corrects one of
 * a small allowlist of extracted header fields. Every correction is written
 * to the append-style policy_corrections log with the value it replaced. */
const CORRECTABLE_FIELDS = new Set(["insurer", "product_name", "policy_number", "policy_type"]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const ctx = await requireHouseholdContext(request);
    const body = (await request.json().catch(() => ({}))) as { field?: string; value?: string };
    const field = String(body.field ?? "");
    const value = String(body.value ?? "").trim().slice(0, 200);
    if (!CORRECTABLE_FIELDS.has(field)) return NextResponse.json({ error: "That field cannot be corrected here." }, { status: 400 });
    if (!value) return NextResponse.json({ error: "Enter the corrected value." }, { status: 400 });
    // The correction is a household-authored, RLS-scoped INSERT into the
    // append-only corrections log. The policies row itself is deliberately
    // NOT updated: its extraction/identity columns are server-owned (browser
    // sessions cannot write them, and nothing here escalates past the
    // caller's own row-level access). Read paths overlay the latest
    // correction per field, so the AI's original value is preserved in the
    // log while the person sees their corrected value everywhere.
    const outcome = await createUserSupabaseClient(ctx.userId, async (client) => {
      const current = await client.query<Record<string, unknown>>(
        `SELECT insurer,product_name,policy_number,policy_type FROM policies WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,
        [id, ctx.householdId],
      );
      if (!current.rows[0]) return null;
      const previous = current.rows[0][field] == null ? null : String(current.rows[0][field]);
      await client.query(
        `INSERT INTO policy_corrections(account_id,policy_id,field_name,ai_value,corrected_value) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)`,
        [ctx.householdId, id, field, JSON.stringify(previous), JSON.stringify(value)],
      );
      return { previous };
    });
    if (!outcome) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    return NextResponse.json({ ok: true, field, value, previous: outcome.previous });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

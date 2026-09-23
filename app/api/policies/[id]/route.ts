import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
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

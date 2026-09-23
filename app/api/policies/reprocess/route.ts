import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { enqueuePolicyProcessing } from "@/lib/rag/processing-queue";
import { getPolicyQuarantineRow } from "@/lib/policies/quarantine/store";
import { runAfterResponse } from "@/lib/http/background";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
// Re-reading a document can take as long as the original upload; give the
// background job room to finish inside after() rather than being cut off.
export const maxDuration = 300;

const Schema = z.object({ policyId: z.string().uuid(), pdfPassword: z.string().optional() });

class AlreadyProcessing extends Error {}
class NotClearedForProcessing extends Error {}

export async function POST(request: NextRequest) {
  try {
    const body = Schema.parse(await request.json().catch(() => ({})));
    const ctx = await requireHouseholdContext(request);

    const policy = await createUserSupabaseClient(ctx.userId, async (client) => {
      // Authorize the specific policy against this household before doing
      // anything else -- a client-supplied policyId for another household's
      // document must not even reveal whether it exists.
      const result = await client.query<{ family_member_id: string; storage_key: string; processing_status: string }>(
        `SELECT family_member_id,storage_key,processing_status FROM policies WHERE id=$1 AND account_id=$2`,
        [body.policyId, ctx.householdId],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (["queued", "extracting", "indexing"].includes(row.processing_status)) throw new AlreadyProcessing();

      // Re-check the PERSISTED quarantine/scan state here, on every
      // reprocess request -- never assume a document that was clean once
      // is still clear to process. A document that has not (yet, or ever)
      // passed a clean scan must not be silently re-queued only to have
      // lib/rag/ingest.ts's own gate no-op it a moment later with no
      // feedback to the person who asked for it.
      const quarantine = await getPolicyQuarantineRow(ctx.householdId, body.policyId);
      if (!quarantine || quarantine.quarantine_status !== "scan_clean") throw new NotClearedForProcessing();

      await client.query(
        `UPDATE policies SET processing_status='queued',processing_stage='queued',processing_progress=1,
         processing_message='Waiting to be analysed…',processing_error=NULL,processing_started_at=NULL,processing_completed_at=NULL,updated_at=now()
         WHERE id=$1 AND account_id=$2`,
        [body.policyId, ctx.householdId],
      );
      return row;
    });

    if (!policy) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // after() keeps this alive past the response instead of racing the
    // serverless instance being frozen the instant "queued" is returned.
    // Only the already-authorized, server-resolved identifiers (household id,
    // the policy's own family_member_id/storage_key) are handed to the
    // background job -- never anything client-supplied beyond the request's
    // own pdfPassword field.
    runAfterResponse(() => enqueuePolicyProcessing({
      accountId: ctx.householdId,
      familyMemberId: policy.family_member_id,
      policyId: body.policyId,
      storageKey: policy.storage_key,
      pdfPassword: body.pdfPassword || undefined,
      linkUploadMember: true,
    }));

    return NextResponse.json({ ok: true, status: "queued" }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: error.issues }, { status: 400 });
    if (error instanceof AlreadyProcessing) return NextResponse.json({ error: "This document is already being analysed." }, { status: 409 });
    if (error instanceof NotClearedForProcessing) return NextResponse.json({ error: "This document has not passed malware scanning yet and cannot be re-analysed." }, { status: 409 });
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Re-analysis failed" }, { status: 500 });
    return authResponse;
  }
}

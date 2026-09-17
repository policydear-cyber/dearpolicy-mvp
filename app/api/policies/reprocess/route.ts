import { NextResponse } from "next/server";
import { z } from "zod";
import { devAccountId, query } from "@/lib/db/client";
import { enqueuePolicyProcessing } from "@/lib/rag/processing-queue";

export const runtime = "nodejs";

const Schema = z.object({ policyId: z.string().uuid(), pdfPassword: z.string().optional() });

export async function POST(request: Request) {
  try {
    const body = Schema.parse(await request.json());
    const accountId = devAccountId();
    const result = await query<{ family_member_id: string; storage_key: string; processing_status: string }>(
      `SELECT family_member_id,storage_key,processing_status FROM policies WHERE id=$1 AND account_id=$2`,
      [body.policyId, accountId],
    );
    const policy = result.rows[0];
    if (!policy) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (["queued", "extracting", "indexing"].includes(policy.processing_status)) {
      return NextResponse.json({ error: "This document is already being analysed." }, { status: 409 });
    }

    await query(
      `UPDATE policies SET processing_status='queued',processing_stage='queued',processing_progress=1,
       processing_message='Waiting for local AI processing…',processing_error=NULL,processing_started_at=NULL,processing_completed_at=NULL,updated_at=now()
       WHERE id=$1 AND account_id=$2`,
      [body.policyId, accountId],
    );

    void enqueuePolicyProcessing({
      accountId,
      familyMemberId: policy.family_member_id,
      policyId: body.policyId,
      storageKey: policy.storage_key,
      pdfPassword: body.pdfPassword || undefined,
      linkUploadMember: true,
    });

    return NextResponse.json({ ok: true, status: "queued" }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Re-analysis failed" }, { status: 500 });
  }
}

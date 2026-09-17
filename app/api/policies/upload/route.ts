import { NextResponse } from "next/server";
import { runAfterResponse } from "@/lib/http/background";
import { createHash, randomUUID } from "node:crypto";
import { devAccountId, query } from "@/lib/db/client";
import { savePolicyFile } from "@/lib/storage";
import { enqueuePolicyProcessing } from "@/lib/rag/processing-queue";

export const runtime = "nodejs";
// Reading a scanned PDF (hosted OCR + LLM extraction) can take a couple of
// minutes for a long policy document; give the background job room to finish
// inside after() rather than being cut off.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    let familyMemberId = String(form.get("familyMemberId") ?? "");
    const explicitFamilyMember = Boolean(familyMemberId);
    const pdfPassword = String(form.get("pdfPassword") ?? "");

    if (!(file instanceof File)) return NextResponse.json({ error: "PDF file is required." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      return NextResponse.json({ error: "DearPolicy currently accepts PDF files only." }, { status: 400 });
    }
    if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "PDF exceeds the 50 MB upload limit." }, { status: 400 });

    const accountId = devAccountId();
    if (!familyMemberId) {
      const fallback = await query<{ id: string }>(
        `SELECT id FROM family_members WHERE account_id=$1 ORDER BY CASE WHEN relationship='self' THEN 0 ELSE 1 END,created_at LIMIT 1`,
        [accountId],
      );
      familyMemberId = fallback.rows[0]?.id ?? "";
    }
    if (!familyMemberId) return NextResponse.json({ error: "Create at least one family profile before uploading documents." }, { status: 400 });

    const owner = await query<{ id: string }>(`SELECT id FROM family_members WHERE id=$1 AND account_id=$2`, [familyMemberId, accountId]);
    if (!owner.rows[0]) return NextResponse.json({ error: "Family member not found." }, { status: 404 });

    const policyId = randomUUID();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const duplicate = await query<{ id: string; original_filename: string }>(
      `SELECT id,original_filename FROM policies WHERE account_id=$1 AND file_hash=$2 LIMIT 1`,
      [accountId, fileHash],
    );
    if (duplicate.rows[0]) {
      return NextResponse.json({ error: `This exact document is already in DearPolicy as ${duplicate.rows[0].original_filename}.` }, { status: 409 });
    }

    const storageKey = await savePolicyFile({ accountId, familyMemberId, policyId, filename: file.name, bytes });
    await query(
      `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message)
       VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting for local AI processing…')`,
      [policyId, accountId, familyMemberId, file.name, storageKey, fileHash],
    );

    // after() keeps this alive past the response (Vercel's waitUntil under the
    // hood) instead of racing the serverless function being frozen the
    // instant "queued" is returned to the browser, which is what a bare
    // fire-and-forget promise would do.
    runAfterResponse(() => enqueuePolicyProcessing({
      accountId,
      familyMemberId,
      policyId,
      storageKey,
      pdfPassword: pdfPassword || undefined,
      linkUploadMember: explicitFamilyMember,
    }));

    return NextResponse.json({ policyId, status: "queued" }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 500 });
  }
}

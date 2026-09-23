import { NextResponse, type NextRequest } from "next/server";
import { runAfterResponse } from "@/lib/http/background";
import { createHash, randomUUID } from "node:crypto";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { savePolicyFile } from "@/lib/storage";
import { enqueuePolicyProcessing } from "@/lib/rag/processing-queue";
import { looksLikePdf } from "@/lib/claims/evidence/validation";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
// Reading a scanned PDF (hosted OCR + LLM extraction) can take a couple of
// minutes for a long policy document; give the background job room to finish
// inside after() rather than being cut off.
export const maxDuration = 300;

class NoFamilyMember extends Error {}
class FamilyMemberNotFound extends Error {}
class DuplicateDocument extends Error {
  constructor(public filename: string) {
    super();
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
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

    const policyId = randomUUID();
    const bytes = new Uint8Array(await file.arrayBuffer());
    // The extension/MIME checks above only look at client-supplied labels --
    // trivial to spoof (a renamed file, a doctored form field). This checks
    // the actual bytes for a PDF's own magic header, the same check the
    // claim-evidence upload path already applies (see
    // lib/claims/evidence/validation.ts) before anything not genuinely a
    // PDF reaches storage or the PDF-parsing pipeline downstream.
    if (!looksLikePdf(bytes)) return NextResponse.json({ error: "The uploaded file is not a valid PDF." }, { status: 400 });
    const fileHash = createHash("sha256").update(bytes).digest("hex");

    // Every check below (family-member ownership, duplicate-hash lookup, the
    // insert itself) runs inside one RLS-scoped transaction so nothing here
    // ever depends on a client-supplied household/account id -- the only
    // identity in play is ctx.householdId, resolved server-side from the
    // caller's own session.
    const outcome = await createUserSupabaseClient(ctx.userId, async (client) => {
      if (!familyMemberId) {
        const fallback = await client.query<{ id: string }>(
          `SELECT id FROM family_members WHERE account_id=$1 ORDER BY CASE WHEN relationship='self' THEN 0 ELSE 1 END,created_at LIMIT 1`,
          [ctx.householdId],
        );
        familyMemberId = fallback.rows[0]?.id ?? "";
      }
      if (!familyMemberId) throw new NoFamilyMember();

      const owner = await client.query<{ id: string }>(`SELECT id FROM family_members WHERE id=$1 AND account_id=$2`, [familyMemberId, ctx.householdId]);
      if (!owner.rows[0]) throw new FamilyMemberNotFound();

      const duplicate = await client.query<{ id: string; original_filename: string }>(
        `SELECT id,original_filename FROM policies WHERE account_id=$1 AND file_hash=$2 LIMIT 1`,
        [ctx.householdId, fileHash],
      );
      if (duplicate.rows[0]) throw new DuplicateDocument(duplicate.rows[0].original_filename);

      return { familyMemberId };
    });

    // Server-generated storage path -- the object key is derived from the
    // household id, the authorized family member id, and a freshly generated
    // policyId, never from anything the client named directly.
    const storageKey = await savePolicyFile({ accountId: ctx.householdId, familyMemberId: outcome.familyMemberId, policyId, filename: file.name, bytes });

    try {
      await createUserSupabaseClient(ctx.userId, async (client) => {
        await client.query(
          `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message)
           VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting to be analysed…')`,
          [policyId, ctx.householdId, outcome.familyMemberId, file.name, storageKey, fileHash],
        );
      });
    } catch (error) {
      // A double-click or two tabs can both pass the pre-check and race each
      // other to the insert; the unique index on (account_id,file_hash) is the
      // real guard, so its violation gets the same friendly message as the
      // pre-check instead of a generic 500.
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "This exact document is already in DearPolicy." }, { status: 409 });
      }
      throw error;
    }

    // after() keeps this alive past the response (Vercel's waitUntil under the
    // hood) instead of racing the serverless function being frozen the
    // instant "queued" is returned to the browser, which is what a bare
    // fire-and-forget promise would do.
    runAfterResponse(() => enqueuePolicyProcessing({
      accountId: ctx.householdId,
      familyMemberId: outcome.familyMemberId,
      policyId,
      storageKey,
      pdfPassword: pdfPassword || undefined,
      linkUploadMember: explicitFamilyMember,
    }));

    return NextResponse.json({ policyId, status: "queued" }, { status: 202 });
  } catch (error) {
    if (error instanceof NoFamilyMember) return NextResponse.json({ error: "Create at least one family profile before uploading documents." }, { status: 400 });
    if (error instanceof FamilyMemberNotFound) return NextResponse.json({ error: "Family member not found." }, { status: 404 });
    if (error instanceof DuplicateDocument) return NextResponse.json({ error: `This exact document is already in DearPolicy as ${error.filename}.` }, { status: 409 });
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    return authResponse;
  }
}

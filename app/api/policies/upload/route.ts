import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { savePolicyFile } from "@/lib/storage";
import { enqueuePolicyProcessing } from "@/lib/rag/processing-queue";
import { looksLikePdf } from "@/lib/claims/evidence/validation";
import { supersedePolicyDocument } from "@/lib/policies/quarantine/store";
import { isUuid, pool } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";

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
    // Optional: this upload is a corrected re-upload of an existing
    // document, not a brand-new one. When present and valid, the OLD row
    // is marked superseded (never deleted -- its audit history stays
    // intact) once the new row is safely inserted below. See
    // lib/policies/quarantine/store.ts's supersedePolicyDocument().
    const supersedesPolicyIdRaw = String(form.get("supersedesPolicyId") ?? "");
    const supersedesPolicyId = isUuid(supersedesPolicyIdRaw) ? supersedesPolicyIdRaw : null;

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
          `SELECT id FROM family_members WHERE account_id=$1 AND ${activePredicate()} ORDER BY CASE WHEN relationship='self' THEN 0 ELSE 1 END,created_at LIMIT 1`,
          [ctx.householdId],
        );
        familyMemberId = fallback.rows[0]?.id ?? "";
      }
      if (!familyMemberId) throw new NoFamilyMember();

      const owner = await client.query<{ id: string }>(`SELECT id FROM family_members WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`, [familyMemberId, ctx.householdId]);
      if (!owner.rows[0]) throw new FamilyMemberNotFound();

      const duplicate = await client.query<{ id: string; original_filename: string }>(
        `SELECT id,original_filename FROM policies WHERE account_id=$1 AND file_hash=$2 AND superseded_at IS NULL AND ${activePredicate()} LIMIT 1`,
        [ctx.householdId, fileHash],
      );
      if (duplicate.rows[0]) throw new DuplicateDocument(duplicate.rows[0].original_filename);

      // A supersedesPolicyId must genuinely belong to this household -- a
      // forged id from another account must not be able to mark someone
      // else's document superseded via this upload.
      let verifiedSupersedesId: string | null = null;
      if (supersedesPolicyId) {
        const owned = await client.query<{ id: string }>(`SELECT id FROM policies WHERE id=$1 AND account_id=$2 AND superseded_at IS NULL AND ${activePredicate()}`, [supersedesPolicyId, ctx.householdId]);
        verifiedSupersedesId = owned.rows[0]?.id ?? null;
      }

      return { familyMemberId, verifiedSupersedesId };
    });

    // Server-generated storage path -- the object key is derived from the
    // household id, the authorized family member id, and a freshly generated
    // policyId, never from anything the client named directly.
    const storageKey = await savePolicyFile({ accountId: ctx.householdId, familyMemberId: outcome.familyMemberId, policyId, filename: file.name, bytes });

    try {
      // Written on the trusted server connection: every value here is
      // server-derived (ids authorized in the RLS-scoped transaction above,
      // the server-generated storage key and checksum, initial processing
      // state). Browser sessions hold no INSERT privilege on policies
      // (sql/household-rls.sql), so quarantine/processing state can never be
      // pre-set by a client.
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,supersedes_id)
         VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting to be analysed…',$7)`,
        [policyId, ctx.householdId, outcome.familyMemberId, file.name, storageKey, fileHash, outcome.verifiedSupersedesId],
      );
      if (outcome.verifiedSupersedesId) {
        await supersedePolicyDocument({ accountId: ctx.householdId, oldPolicyId: outcome.verifiedSupersedesId, newPolicyId: policyId });
      }
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

    // D13 (Wave 2 adversarial audit): enqueuePolicyProcessing() is now
    // awaited directly instead of deferred via runAfterResponse()/after().
    // The deferred version had no .catch() on this primary path, so a
    // failed background_jobs insert was silently swallowed -- the client
    // would see this route's 202 "queued" response (and the
    // "upload.policy.queued" telemetry event just below) for a policy that
    // was never actually enqueued for processing, and it would simply sit
    // "queued" in the UI forever. The insert itself is a single fast
    // INSERT, so awaiting it adds negligible latency to the response, and a
    // real failure now surfaces through this route's own catch block below
    // instead of disappearing.
    await enqueuePolicyProcessing({
      accountId: ctx.householdId,
      familyMemberId: outcome.familyMemberId,
      policyId,
      storageKey,
      pdfPassword: pdfPassword || undefined,
      linkUploadMember: explicitFamilyMember,
    });

    // Checkpoint 14b: "uploads" was named as a required telemetry call
    // site -- a successful queue outcome and the custom, early-return
    // error branches below all bypassed routeErrorResponse() (and so
    // never recorded telemetry) before this. Fire-and-forget, following
    // the exact same shape recordErrorEvent() calls use throughout this
    // codebase -- never blocks or slows the actual HTTP response.
    void recordEvent({
      name: "upload.policy.queued",
      correlationId: resolveCorrelationId(request.headers.get("x-correlation-id")),
      route: "/api/policies/upload",
      status: "success",
    });
    return NextResponse.json({ policyId, status: "queued" }, { status: 202 });
  } catch (error) {
    const correlationId = resolveCorrelationId(request.headers.get("x-correlation-id"));
    if (error instanceof NoFamilyMember) {
      void recordEvent({ name: "upload.policy.rejected", correlationId, route: "/api/policies/upload", status: "failure", errorCategory: "validation" });
      return NextResponse.json({ error: "Create at least one family profile before uploading documents." }, { status: 400 });
    }
    if (error instanceof FamilyMemberNotFound) {
      void recordEvent({ name: "upload.policy.rejected", correlationId, route: "/api/policies/upload", status: "failure", errorCategory: "validation" });
      return NextResponse.json({ error: "Family member not found." }, { status: 404 });
    }
    if (error instanceof DuplicateDocument) {
      void recordEvent({ name: "upload.policy.rejected", correlationId, route: "/api/policies/upload", status: "failure", errorCategory: "validation" });
      return NextResponse.json({ error: `This exact document is already in DearPolicy as ${error.filename}.` }, { status: 409 });
    }
    const authResponse = routeErrorResponse(error, { request, route: "/api/policies/upload" });
    if (authResponse.status === 500) return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    return authResponse;
  }
}

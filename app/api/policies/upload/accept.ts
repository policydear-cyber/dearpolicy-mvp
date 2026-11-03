/**
 * Accepting an uploaded policy document: the one path shared by the classic
 * multipart upload (route.ts, small files) and the direct-to-storage upload
 * (start -> browser uploads -> finalize/route.ts). Every security check lives
 * here once: size, real file-signature sniffing and extension/MIME agreement,
 * image decodability, household-scoped family-member authorization, the
 * duplicate check, the RLS-scoped transaction, and queuing for the malware
 * scan + processing pipeline.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import type { HouseholdContext } from "@/lib/auth/request-context";
import { recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { deletePolicyFile, savePolicyFile } from "@/lib/storage";
import { enqueuePolicyProcessing, POLICY_PROCESSING_JOB_TYPE } from "@/lib/rag/processing-queue";
import { scheduleJobStart } from "@/lib/jobs/request-drain";
import { probeImageDecodes, validateDocumentUpload } from "@/lib/documents/formats";
import { supersedePolicyDocument } from "@/lib/policies/quarantine/store";
import { pool } from "@/lib/db/client";
import { malwareScanningIntentionallyDisabled } from "@/lib/scanning/adapter";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { maskIdentityText } from "@/lib/chat/identity-numbers";
import { noteOwnerUnsure } from "@/lib/policies/upload-owner";

/** The largest document DearPolicy accepts. Direct uploads carry it to
 * storage; the classic multipart route is only for files the platform lets
 * through a function body (see MULTIPART_MAX_BYTES). */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
/** What a single request body may carry: Vercel functions refuse bodies over
 * about 4.5 MB, and the Next.js proxy buffers at most 10 MB. */
export const MULTIPART_MAX_BYTES = 4 * 1024 * 1024;
export const TOO_LARGE_MESSAGE = "Files must be 50 MB or smaller. Split the document or export it at a lower resolution, then upload it again.";

export class NoFamilyMember extends Error {}
export class FamilyMemberNotFound extends Error {}
class DuplicateDocument extends Error {
  constructor(public filename: string) {
    super();
  }
}

/** Resolves (and authorizes) the family member an upload belongs to: the
 * one named, which must be an active member of the caller's own household,
 * or the household's first profile. */
export async function resolveUploadFamilyMember(ctx: HouseholdContext, requested: string): Promise<string> {
  return createUserSupabaseClient(ctx.userId, async (client) => {
    let familyMemberId = requested;
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
    return familyMemberId;
  });
}

export function uploadErrorResponse(error: unknown, request: NextRequest): NextResponse | null {
  const correlationId = resolveCorrelationId(request.headers.get("x-correlation-id"));
  const reject = () => void recordEvent({ name: "upload.policy.rejected", correlationId, route: "/api/policies/upload", status: "failure", errorCategory: "validation" });
  if (error instanceof NoFamilyMember) { reject(); return NextResponse.json({ error: "Create at least one family profile before uploading documents." }, { status: 400 }); }
  if (error instanceof FamilyMemberNotFound) { reject(); return NextResponse.json({ error: "Family member not found." }, { status: 404 }); }
  if (error instanceof DuplicateDocument) { reject(); return NextResponse.json({ error: `This exact document is already in DearPolicy as ${maskIdentityText(error.filename)}.` }, { status: 409 }); }
  return null;
}

/** Validates and records one uploaded document. When `storedKey` is given
 * the bytes are already in storage (a direct upload) and are removed again
 * if they are refused; otherwise they are saved here. */
export async function acceptPolicyUpload(args: {
  request: NextRequest;
  ctx: HouseholdContext;
  policyId: string;
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  familyMemberId: string;
  explicitFamilyMember: boolean;
  pdfPassword: string;
  supersedesPolicyId: string | null;
  storedKey?: string;
}): Promise<NextResponse> {
  const { ctx, policyId, bytes } = args;
  // A refused direct upload's object is removed -- unless a policy row
  // already owns that key (a repeated finalize of an accepted upload must
  // never delete the accepted document's file).
  const discardStored = async () => {
    if (!args.storedKey) return;
    const owned = await pool.query(`SELECT 1 FROM policies WHERE storage_key=$1 AND ${activePredicate()} LIMIT 1`, [args.storedKey]).catch(() => ({ rows: [1] as unknown[] }));
    if (!owned.rows.length) await deletePolicyFile(args.storedKey).catch(() => undefined);
  };

  const validation = validateDocumentUpload({ filename: args.filename, mimeType: args.mimeType, byteSize: bytes.length, bytes, maxBytes: MAX_DOCUMENT_BYTES });
  if (!validation.valid) {
    await discardStored();
    return NextResponse.json({ error: validation.reasonCode === "FILE_TOO_LARGE" ? TOO_LARGE_MESSAGE : validation.message, reasonCode: validation.reasonCode }, { status: 400 });
  }
  const imageProblem = await probeImageDecodes(bytes, validation.format);
  if (imageProblem) {
    await discardStored();
    return NextResponse.json({ error: imageProblem, reasonCode: "CORRUPTED_FILE" }, { status: 400 });
  }
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  let outcome: { familyMemberId: string; verifiedSupersedesId: string | null };
  try {
    outcome = await createUserSupabaseClient(ctx.userId, async (client) => {
      const owner = await client.query<{ id: string }>(`SELECT id FROM family_members WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`, [args.familyMemberId, ctx.householdId]);
      if (!owner.rows[0]) throw new FamilyMemberNotFound();
      const duplicate = await client.query<{ id: string; original_filename: string }>(
        `SELECT id,original_filename FROM policies WHERE account_id=$1 AND file_hash=$2 AND superseded_at IS NULL AND ${activePredicate()} LIMIT 1`,
        [ctx.householdId, fileHash],
      );
      if (duplicate.rows[0]) throw new DuplicateDocument(duplicate.rows[0].original_filename);
      // A supersedesPolicyId must genuinely belong to this household.
      let verifiedSupersedesId: string | null = null;
      if (args.supersedesPolicyId) {
        const owned = await client.query<{ id: string }>(`SELECT id FROM policies WHERE id=$1 AND account_id=$2 AND superseded_at IS NULL AND ${activePredicate()}`, [args.supersedesPolicyId, ctx.householdId]);
        verifiedSupersedesId = owned.rows[0]?.id ?? null;
      }
      return { familyMemberId: args.familyMemberId, verifiedSupersedesId };
    });
  } catch (error) {
    await discardStored();
    throw error;
  }

  // Server-generated storage path (household, authorized member, fresh policy id).
  const storageKey = args.storedKey ?? await savePolicyFile({ accountId: ctx.householdId, familyMemberId: outcome.familyMemberId, policyId, filename: args.filename, bytes });

  // Deleted/superseded rows have no claim on the content hash (see the
  // unique index on (account_id,file_hash)); release it before inserting.
  await pool.query(
    `UPDATE policies SET file_hash=NULL, updated_at=now()
      WHERE account_id=$1 AND file_hash=$2
        AND (superseded_at IS NOT NULL OR lifecycle_state<>'active')`,
    [ctx.householdId, fileHash],
  ).catch((error) => {
    console.warn("stale file_hash release failed:", error instanceof Error ? error.message : error);
  });

  try {
    // Trusted server connection; every value is server-derived. Browser
    // sessions hold no INSERT privilege on policies.
    await pool.query(
      `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,supersedes_id)
       VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,$7,$8)`,
      [policyId, ctx.householdId, outcome.familyMemberId, args.filename, storageKey, fileHash,
        malwareScanningIntentionallyDisabled() ? "Document received — reading and extracting information." : "Waiting to be analysed…",
        outcome.verifiedSupersedesId],
    );
    // "Not sure": the owner above is only a placeholder, so the document is nobody's until someone is linked to it.
    if (!args.explicitFamilyMember) await noteOwnerUnsure(ctx.householdId, policyId);
    if (outcome.verifiedSupersedesId) {
      await supersedePolicyDocument({ accountId: ctx.householdId, oldPolicyId: outcome.verifiedSupersedesId, newPolicyId: policyId });
    }
  } catch (error) {
    // 23505: a double-click/two tabs racing past the duplicate pre-check
    // (unique (account_id,file_hash)), or a second finalize of the same
    // direct-upload intent (policies.id). Either way the document is
    // already there; the stored object is kept only if it is the row's own.
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") {
      await discardStored();
      return NextResponse.json({ error: "This exact document is already in DearPolicy." }, { status: 409 });
    }
    throw error;
  }

  await enqueuePolicyProcessing({
    accountId: ctx.householdId,
    familyMemberId: outcome.familyMemberId,
    policyId,
    storageKey,
    pdfPassword: args.pdfPassword || undefined,
    linkUploadMember: args.explicitFamilyMember,
  });
  // This document starts now, not when a drain or the daily run gets to it (lib/jobs/request-drain.ts).
  scheduleJobStart(POLICY_PROCESSING_JOB_TYPE, policyId);

  void recordEvent({
    name: "upload.policy.queued",
    correlationId: resolveCorrelationId(args.request.headers.get("x-correlation-id")),
    route: "/api/policies/upload",
    status: "success",
  });
  return NextResponse.json({ policyId, status: "queued" }, { status: 202 });
}

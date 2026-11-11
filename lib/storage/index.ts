/** Storage facade. Picks the backend once, at first use, so the rest of the
 * app never has to know or care whether a PDF lives on local disk (dev) or
 * in Supabase Storage (production/Vercel, where a request can land on a
 * different, ephemeral machine each time — local disk does not survive that).
 *
 * STORAGE_DRIVER=local forces local disk (the default when Supabase is not
 * configured). STORAGE_DRIVER=supabase forces Supabase Storage. Otherwise the
 * choice follows whether SUPABASE_URL is set. */
import * as local from "./local";
import * as supabaseStorage from "./supabase";

function driver(): "local" | "supabase" {
  const explicit = (process.env.STORAGE_DRIVER ?? "").trim().toLowerCase();
  if (explicit === "local" || explicit === "supabase") return explicit;
  return process.env.SUPABASE_URL ? "supabase" : "local";
}

function backend() {
  return driver() === "supabase" ? supabaseStorage : local;
}

export async function savePolicyFile(args: {
  accountId: string;
  familyMemberId: string;
  policyId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  return backend().savePolicyFile(args);
}

// --- Direct uploads (Round 5): the browser sends the file to storage
// itself instead of through a serverless function (whose request body is
// capped at about 4.5 MB on Vercel and 10 MB by the Next.js proxy).
// See app/api/policies/upload/{start,part,finalize}/route.ts.
export function policyUploadDriver(): "local" | "supabase" {
  return driver();
}
export function policyUploadKey(args: { accountId: string; familyMemberId: string; policyId: string; filename: string }) {
  return backend().policyObjectKey(args);
}
/** Supabase Storage only: a signed URL the browser uploads to directly. */
export async function createPolicyUploadUrl(storageKey: string) {
  return supabaseStorage.createPolicyUploadUrl(storageKey);
}
/** Local driver only: append one part (at most a few MB) of a direct upload. */
export async function appendPolicyUploadPart(storageKey: string, offset: number, bytes: Uint8Array) {
  return local.appendPolicyUploadPart(storageKey, offset, bytes);
}

export async function readPolicyFile(storageKey: string) {
  return backend().readPolicyFile(storageKey);
}

export async function deletePolicyFile(storageKey: string) {
  return backend().deletePolicyFile(storageKey);
}

/** Supabase Storage: a five-minute signed link to a policy file. Local driver:
 * null, and the caller streams the bytes itself (app/api/policies/[id]/file). */
export async function createPolicyFileSignedUrl(storageKey: string, download?: string) {
  return backend().createPolicyFileSignedUrl(storageKey, download);
}

// --- Claim evidence: a private, separate location from policy documents
// (see ./local.ts and ./supabase.ts). Signed URLs only, never a public path
// -- createClaimEvidenceSignedUrl returns null on the local driver, which
// tells the caller to stream the bytes itself through an authenticated
// route instead (see app/api/claims/evidence/[id]/file/route.ts).
export async function saveClaimEvidenceFile(args: {
  accountId: string;
  familyMemberId: string;
  claimSessionId: string;
  documentId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  return backend().saveClaimEvidenceFile(args);
}

export async function readClaimEvidenceFile(storageKey: string) {
  return backend().readClaimEvidenceFile(storageKey);
}

export async function deleteClaimEvidenceFile(storageKey: string) {
  return backend().deleteClaimEvidenceFile(storageKey);
}

export async function createClaimEvidenceSignedUrl(storageKey: string) {
  return backend().createClaimEvidenceSignedUrl(storageKey);
}

// --- Household export (checkpoint 6). See lib/storage/local.ts/
// supabase.ts's own comments on this domain.
export async function saveHouseholdExportFile(args: { householdId: string; exportId: string; bytes: Uint8Array }) {
  return backend().saveHouseholdExportFile(args);
}

export async function readHouseholdExportFile(storageKey: string) {
  return backend().readHouseholdExportFile(storageKey);
}

export async function deleteHouseholdExportFile(storageKey: string) {
  return backend().deleteHouseholdExportFile(storageKey);
}

// --- Baidu OCR hand-off (see ./supabase.ts). Supabase Storage only: on the local driver there is no link Baidu could
// reach, so stageOcrHandoff returns null and the caller uploads the bytes itself, as before.
export function ocrHandoffAvailable(): boolean {
  return driver() === "supabase";
}
export async function stageOcrHandoff(args: { accountId: string; handoffId: string; bytes: Uint8Array; ttlSeconds: number }): Promise<{ storageKey: string; url: string } | null> {
  if (driver() !== "supabase") return null;
  const storageKey = await supabaseStorage.saveOcrHandoffFile(args);
  try {
    return { storageKey, url: await supabaseStorage.createOcrHandoffSignedUrl(storageKey, args.ttlSeconds) };
  } catch (error) {
    await supabaseStorage.deleteOcrHandoffFile(storageKey).catch(() => undefined);
    throw error;
  }
}
export async function removeOcrHandoff(storageKey: string) {
  if (driver() !== "supabase") return;
  await supabaseStorage.deleteOcrHandoffFile(storageKey);
}

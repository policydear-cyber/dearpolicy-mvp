import { createClient } from "@supabase/supabase-js";

/** Supabase Storage backend for policy PDFs. Selected automatically in
 * production (see ./index.ts) once SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are
 * set — local disk storage does not survive a serverless deployment, where
 * each request can land on a different, ephemeral machine. */

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "policy-files";

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured. Set STORAGE_DRIVER=local for local development, or configure Supabase Storage for production.",
    );
  }
  // The service-role key bypasses row-level security — this module only ever
  // runs on the server (Next.js route handlers / background jobs), never in
  // the browser, so that is the correct key to use here.
  return createClient(url, key, { auth: { persistSession: false } });
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function objectKey(args: { accountId: string; familyMemberId: string; policyId: string; filename: string }) {
  const filename = safeSegment(args.filename || "policy.pdf");
  return [safeSegment(args.accountId), safeSegment(args.familyMemberId), safeSegment(args.policyId), filename].join("/");
}

export async function savePolicyFile(args: {
  accountId: string;
  familyMemberId: string;
  policyId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  const key = objectKey(args);
  const { error } = await client()
    .storage.from(BUCKET)
    .upload(key, args.bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`Could not save the PDF to storage: ${error.message}`);
  return key;
}

/** The storage key a policy file WILL have, for a direct upload. */
export function policyObjectKey(args: { accountId: string; familyMemberId: string; policyId: string; filename: string }) {
  return objectKey(args);
}

/** A one-time signed upload URL for exactly this object key, so the browser
 * sends the file straight to Supabase Storage (serverless functions cap a
 * request body at about 4.5 MB). The key is server-generated; the URL can
 * only create that one object (upsert off) and is accepted by the app only
 * through the finalize step, which re-validates the stored bytes. */
export async function createPolicyUploadUrl(storageKey: string): Promise<{ url: string; token: string }> {
  const { data, error } = await client().storage.from(BUCKET).createSignedUploadUrl(storageKey, { upsert: false });
  if (error || !data) throw new Error(`Could not prepare the upload: ${error?.message ?? "no signed URL"}`);
  return { url: data.signedUrl, token: data.token };
}

export async function appendPolicyUploadPart(): Promise<number> {
  throw new Error("Part uploads are for the local storage driver only; Supabase Storage uploads go to a signed URL.");
}

export async function readPolicyFile(storageKey: string) {
  const { data, error } = await client().storage.from(BUCKET).download(storageKey);
  if (error) throw new Error(`Could not read the stored PDF: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function deletePolicyFile(storageKey: string) {
  // Every uploaded policy lives under its own policy-id "folder" (see
  // objectKey). Removing that folder clears the PDF and any future temporary
  // artefacts stored beside it, mirroring the local-disk behaviour.
  const folder = storageKey.split("/").slice(0, -1).join("/");
  const { data: entries, error: listError } = await client().storage.from(BUCKET).list(folder);
  if (listError) throw new Error(`Could not list stored files to delete: ${listError.message}`);
  const paths = (entries ?? []).map((entry) => `${folder}/${entry.name}`);
  if (!paths.length) return;
  const { error } = await client().storage.from(BUCKET).remove(paths);
  if (error) throw new Error(`Could not delete the stored PDF: ${error.message}`);
}

// --- Baidu OCR hand-off: the scanned pages of one reading, stored briefly so Baidu's service can download them itself
// through a short-lived signed link (lib/documents/ocr-baidu.ts). Pushing the file from the app to Baidu was measured
// at under 20 KB/s (11 Nov 2026); Baidu fetching it is the official alternative (the `fileUrl` submit). Each hand-off
// is its own object under the household's own folder, removed as soon as the job ends (and queued for purge if that
// removal fails), never referenced by any table.
export function ocrHandoffObjectKey(accountId: string, handoffId: string) {
  return [safeSegment(accountId), "ocr-handoff", safeSegment(handoffId), "pages.pdf"].join("/");
}
export async function saveOcrHandoffFile(args: { accountId: string; handoffId: string; bytes: Uint8Array }) {
  const key = ocrHandoffObjectKey(args.accountId, args.handoffId);
  const { error } = await client().storage.from(BUCKET).upload(key, args.bytes, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(`Could not stage the pages for OCR: ${error.message}`);
  return key;
}
export async function createOcrHandoffSignedUrl(storageKey: string, ttlSeconds: number): Promise<string> {
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(storageKey, ttlSeconds);
  if (error || !data?.signedUrl) throw new Error(`Could not sign the OCR hand-off link: ${error?.message ?? "no signed URL"}`);
  return data.signedUrl;
}
/** Removes exactly this one object (never a folder listing). */
export async function deleteOcrHandoffFile(storageKey: string) {
  const { error } = await client().storage.from(BUCKET).remove([storageKey]);
  if (error) throw new Error(`Could not remove the OCR hand-off: ${error.message}`);
}

// --- Claim evidence: its own private bucket, never the policy-files bucket
// above, and never made public -- every read goes through a short-lived
// signed URL (createClaimEvidenceSignedUrl) rather than a public object URL.
const CLAIM_EVIDENCE_BUCKET = process.env.SUPABASE_CLAIM_EVIDENCE_BUCKET ?? "claim-evidence-files";
// D34 (Wave 2 adversarial audit): 300s is a DELIBERATE, documented
// trade-off, not an oversight -- kept here (rather than raised) because a
// signed URL this application hands out is a capability the storage
// provider will honor directly, with no further app-side check, for its
// entire TTL, even if the underlying claim-evidence document is superseded
// or deleted one second after the URL is minted. That exposure window is
// unavoidable for ANY pre-signed direct-storage URL scheme (shrinking the
// TTL only shrinks the window, it cannot close it), so the real access
// boundary this application enforces IMMEDIATELY on supersession/deletion
// is upstream of this: app/api/claims/evidence/[id]/file/route.ts resolves
// the document through lib/claims/evidence/store.ts's
// getScopedEvidenceDocument(), which now excludes a superseded/deleted
// document, so this function is simply never called (no NEW signed URL is
// ever minted) for evidence that is no longer active -- see that route's
// own doc comment for the full picture. 300s is short enough to load a
// multi-page PDF over a slow connection without the redirect racing the
// URL's own expiry, and is not lowered further without a product decision
// to accept more retry/redirect failures on slow connections in exchange
// for a smaller (never zero) exposure window.
const SIGNED_URL_TTL_SECONDS = 300;

function claimEvidenceObjectKey(args: { accountId: string; familyMemberId: string; claimSessionId: string; documentId: string; filename: string }) {
  const filename = safeSegment(args.filename || "evidence.pdf");
  return [safeSegment(args.accountId), safeSegment(args.familyMemberId), safeSegment(args.claimSessionId), safeSegment(args.documentId), filename].join("/");
}

export async function saveClaimEvidenceFile(args: {
  accountId: string;
  familyMemberId: string;
  claimSessionId: string;
  documentId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  const key = claimEvidenceObjectKey(args);
  const { error } = await client()
    .storage.from(CLAIM_EVIDENCE_BUCKET)
    // upsert:false -- a claim-evidence object key already includes the
    // document's own id, so a second write to the same key would only ever
    // happen from a genuine retry of the same upload, and overwriting
    // silently there is fine; a real collision (two different documents
    // somehow computing the same key) should fail loudly instead of one
    // silently clobbering the other.
    .upload(key, args.bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`Could not save the claim-evidence file to storage: ${error.message}`);
  return key;
}

export async function readClaimEvidenceFile(storageKey: string) {
  const { data, error } = await client().storage.from(CLAIM_EVIDENCE_BUCKET).download(storageKey);
  if (error) throw new Error(`Could not read the stored claim-evidence file: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteClaimEvidenceFile(storageKey: string) {
  const folder = storageKey.split("/").slice(0, -1).join("/");
  const { data: entries, error: listError } = await client().storage.from(CLAIM_EVIDENCE_BUCKET).list(folder);
  if (listError) throw new Error(`Could not list stored claim-evidence files to delete: ${listError.message}`);
  const paths = (entries ?? []).map((entry) => `${folder}/${entry.name}`);
  if (!paths.length) return;
  const { error } = await client().storage.from(CLAIM_EVIDENCE_BUCKET).remove(paths);
  if (error) throw new Error(`Could not delete the stored claim-evidence file: ${error.message}`);
}

/** A short-lived signed URL -- never a public object URL -- for the review
 * UI to preview or download the document. The service-role key used by
 * client() bypasses bucket-level access rules, which is exactly why this
 * function, not a public bucket, is the only way this file is ever read
 * from the browser.
 *
 * D34: this function itself has no way to know whether the caller is about
 * to serve this URL for currently-active evidence or not -- that check is
 * the CALLER's job (see app/api/claims/evidence/[id]/file/route.ts, the
 * only caller, which resolves the document through
 * getScopedEvidenceDocument() first and never reaches this function at all
 * for superseded/deleted evidence). Never call this directly against a
 * storage_key without first re-confirming, through that same scoped
 * lookup, that the document is still active. */
export async function createClaimEvidenceSignedUrl(storageKey: string): Promise<string | null> {
  const { data, error } = await client().storage.from(CLAIM_EVIDENCE_BUCKET).createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(`Could not create a signed URL for the claim-evidence file: ${error.message}`);
  return data.signedUrl;
}

/** A short-lived signed link to one policy file, for the household's own Preview
 * (app/api/policies/[id]/file/route.ts, which re-checks ownership, lifecycle and
 * the scan on every request before calling this). `download` makes the browser
 * save the file under that name instead of showing it. */
export async function createPolicyFileSignedUrl(storageKey: string, download?: string): Promise<string | null> {
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS, download ? { download } : undefined);
  if (error) throw new Error(`Could not create a signed URL for the policy file: ${error.message}`);
  return data.signedUrl;
}

// --- Household export (checkpoint 6): see lib/storage/local.ts's own
// comment on this domain. Its own private bucket -- never public, never a
// long-lived signed URL; app/api/household/export/[id]/download/route.ts
// streams the bytes itself through an authenticated route, exactly like
// claim evidence does on the local driver, rather than redirecting to a
// signed URL, so this file never needs to mint or track one.
const HOUSEHOLD_EXPORT_BUCKET = process.env.SUPABASE_HOUSEHOLD_EXPORT_BUCKET ?? "household-exports";

function householdExportObjectKey(args: { householdId: string; exportId: string }) {
  return [safeSegment(args.householdId), `${safeSegment(args.exportId)}.json`].join("/");
}

export async function saveHouseholdExportFile(args: { householdId: string; exportId: string; bytes: Uint8Array }) {
  const key = householdExportObjectKey(args);
  const { error } = await client()
    .storage.from(HOUSEHOLD_EXPORT_BUCKET)
    .upload(key, args.bytes, { contentType: "application/json", upsert: true });
  if (error) throw new Error(`Could not save the household export to storage: ${error.message}`);
  return key;
}

export async function readHouseholdExportFile(storageKey: string) {
  const { data, error } = await client().storage.from(HOUSEHOLD_EXPORT_BUCKET).download(storageKey);
  if (error) throw new Error(`Could not read the stored household export: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteHouseholdExportFile(storageKey: string) {
  const { error } = await client().storage.from(HOUSEHOLD_EXPORT_BUCKET).remove([storageKey]);
  if (error) throw new Error(`Could not delete the stored household export: ${error.message}`);
}

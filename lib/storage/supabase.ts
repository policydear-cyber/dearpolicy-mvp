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

// --- Claim evidence: its own private bucket, never the policy-files bucket
// above, and never made public -- every read goes through a short-lived
// signed URL (createClaimEvidenceSignedUrl) rather than a public object URL.
const CLAIM_EVIDENCE_BUCKET = process.env.SUPABASE_CLAIM_EVIDENCE_BUCKET ?? "claim-evidence-files";
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
 * from the browser. */
export async function createClaimEvidenceSignedUrl(storageKey: string): Promise<string | null> {
  const { data, error } = await client().storage.from(CLAIM_EVIDENCE_BUCKET).createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(`Could not create a signed URL for the claim-evidence file: ${error.message}`);
  return data.signedUrl;
}

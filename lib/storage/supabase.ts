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

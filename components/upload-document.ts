/**
 * Browser side of the direct-to-storage document upload (Round 5, item 1).
 *
 * A serverless function cannot receive a large request body (about 4.5 MB
 * on Vercel), so a document is never sent through one:
 *   1. POST /api/policies/upload/start  -> where to send the file + a signed token
 *   2. the file goes straight to storage: one PUT to a signed Supabase
 *      Storage URL in production, or 4 MB parts to /api/policies/upload/part
 *      on the local development driver
 *   3. POST /api/policies/upload/finalize -> the server re-checks the stored
 *      bytes (type sniffing, size, household, duplicates) and queues the scan
 *      and processing.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "50 MB";

/** Stored with the same content type the server-side save has always used
 * (lib/storage/supabase.ts savePolicyFile), so a bucket restricted to it
 * accepts direct uploads too. The real format is sniffed from the bytes at
 * finalize; nothing trusts this label. */
const STORAGE_CONTENT_TYPE = "application/pdf";

export class UploadError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

type StartResponse =
  | { token: string; mode: "signed-url"; uploadUrl: string; method: "PUT" }
  | { token: string; mode: "parts"; partUrl: string; partBytes: number };

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({}));
}
function errorOf(body: Record<string, unknown>, fallback: string) {
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

/** PUT with progress (fetch cannot report upload progress). */
function putWithProgress(url: string, body: Blob, headers: Record<string, string>, onProgress?: (sent: number) => void): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded); };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new UploadError("The connection dropped while uploading. Please try again."));
    xhr.ontimeout = () => reject(new UploadError("The upload took too long. Please try again on a faster connection."));
    xhr.send(body);
  });
}

export async function uploadPolicyDocument(file: File, options: {
  familyMemberId?: string | null;
  pdfPassword?: string;
  supersedesPolicyId?: string | null;
  /** 0..1 */
  onProgress?: (fraction: number) => void;
} = {}): Promise<{ policyId: string }> {
  if (file.size <= 0) throw new UploadError("That file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(`Files must be ${MAX_UPLOAD_LABEL} or smaller. Split the document or export it at a lower resolution, then upload it again.`);

  const startResponse = await fetch("/api/policies/upload/start", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, byteSize: file.size, familyMemberId: options.familyMemberId || null, supersedesPolicyId: options.supersedesPolicyId || null }),
  });
  const started = await json(startResponse);
  if (!startResponse.ok) throw new UploadError(errorOf(started, "The upload could not be started. Please try again."), startResponse.status);
  const plan = started as unknown as StartResponse;
  const report = (sent: number) => options.onProgress?.(Math.min(1, sent / file.size));

  if (plan.mode === "signed-url") {
    const put = await putWithProgress(plan.uploadUrl, file, { "content-type": STORAGE_CONTENT_TYPE, "x-upsert": "false" }, report);
    if (put.status < 200 || put.status >= 300) {
      throw new UploadError(put.status === 413 ? `Files must be ${MAX_UPLOAD_LABEL} or smaller.` : "The file could not be sent to secure storage. Please try again.", put.status);
    }
  } else {
    for (let offset = 0; offset < file.size; offset += plan.partBytes) {
      const part = file.slice(offset, Math.min(file.size, offset + plan.partBytes));
      const put = await putWithProgress(`${plan.partUrl}?offset=${offset}`, part, { "content-type": "application/octet-stream", "x-upload-token": plan.token }, (sent) => report(offset + sent));
      if (put.status < 200 || put.status >= 300) {
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(put.text); } catch { /* not JSON */ }
        throw new UploadError(errorOf(body, "The upload was interrupted. Please try again."), put.status);
      }
    }
  }
  report(file.size);

  const finalizeResponse = await fetch("/api/policies/upload/finalize", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: plan.token, pdfPassword: options.pdfPassword || undefined }),
  });
  const finalized = await json(finalizeResponse);
  if (!finalizeResponse.ok) throw new UploadError(errorOf(finalized, "Upload failed. Please try again."), finalizeResponse.status);
  return { policyId: String(finalized.policyId ?? "") };
}

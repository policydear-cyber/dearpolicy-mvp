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
import { uploadFailureMessage, type UploadStep } from "@/lib/documents/upload-problems";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "50 MB";

/** Stored with the same content type the server-side save has always used
 * (lib/storage/supabase.ts savePolicyFile), so a bucket restricted to it
 * accepts direct uploads too. The real format is sniffed from the bytes at
 * finalize; nothing trusts this label. */
const STORAGE_CONTENT_TYPE = "application/pdf";

export class UploadError extends Error {
  /** The server's reason, when it gave one (for example PLAN_DOCUMENT_LIMIT), so the page can offer the way forward. */
  constructor(message: string, public status = 0, public reasonCode: string | null = null) { super(message); }
}

type StartResponse =
  | { token: string; mode: "signed-url"; uploadUrl: string; method: "PUT" }
  | { token: string; mode: "parts"; partUrl: string; partBytes: number };

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({}));
}
/** The plain message for a step that went wrong: the server's own words only for a refusal it explains (4xx), our
 * side's fixed copy for a server error or an answer that isn't ours (a gateway page), never a raw code
 * (lib/documents/upload-problems.ts). */
function failure(step: UploadStep, status: number, body: Record<string, unknown> = {}) {
  return new UploadError(uploadFailureMessage(step, { status, serverMessage: typeof body.error === "string" ? body.error : null }), status, typeof body.reasonCode === "string" ? body.reasonCode : null);
}
/** fetch, with a dropped connection (the browser's own "Failed to fetch", "Load failed", "NetworkError…") said plainly. */
async function send(step: UploadStep, url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, init); } catch { throw failure(step, 0); }
}

/** PUT with progress (fetch cannot report upload progress). */
function putWithProgress(url: string, body: Blob, headers: Record<string, string>, onProgress?: (sent: number) => void): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded); };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(failure("send", 0));
    xhr.ontimeout = () => reject(new UploadError(uploadFailureMessage("send", { status: 0, timedOut: true })));
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

  const startResponse = await send("start", "/api/policies/upload/start", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, byteSize: file.size, familyMemberId: options.familyMemberId || null, supersedesPolicyId: options.supersedesPolicyId || null }),
  });
  const started = await json(startResponse);
  if (!startResponse.ok) throw failure("start", startResponse.status, started);
  const plan = started as unknown as StartResponse;
  const report = (sent: number) => options.onProgress?.(Math.min(1, sent / file.size));

  if (plan.mode === "signed-url") {
    const put = await putWithProgress(plan.uploadUrl, file, { "content-type": STORAGE_CONTENT_TYPE, "x-upsert": "false" }, report);
    if (put.status < 200 || put.status >= 300) {
      throw put.status === 413 ? new UploadError(`Files must be ${MAX_UPLOAD_LABEL} or smaller. Split the document or export it at a lower resolution, then upload it again.`, 413) : failure("send", put.status);
    }
  } else {
    for (let offset = 0; offset < file.size; offset += plan.partBytes) {
      const part = file.slice(offset, Math.min(file.size, offset + plan.partBytes));
      const put = await putWithProgress(`${plan.partUrl}?offset=${offset}`, part, { "content-type": "application/octet-stream", "x-upload-token": plan.token }, (sent) => report(offset + sent));
      if (put.status < 200 || put.status >= 300) {
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(put.text); } catch { /* not JSON */ }
        throw failure("send", put.status, body);
      }
    }
  }
  report(file.size);

  const finalizeResponse = await send("finalize", "/api/policies/upload/finalize", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: plan.token, pdfPassword: options.pdfPassword || undefined }),
  });
  const finalized = await json(finalizeResponse);
  if (!finalizeResponse.ok) throw failure("finalize", finalizeResponse.status, finalized);
  return { policyId: String(finalized.policyId ?? "") };
}

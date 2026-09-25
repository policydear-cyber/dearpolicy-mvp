import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { hostedDocumentToText, modelFor } from "@/lib/ai/providers";
import { assertUnderSpendCap, recordUsage } from "@/lib/ai/ledger";
import { recordModelExecution, assertVerifiedForMonetaryUse } from "@/lib/ai/provenance";
import type { PdfPage } from "@/lib/documents/pdf";
import { recordErrorEvent, recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";

type BridgePage = { pageNumber: number; text: string };

/** Builds a small standalone PDF containing only the requested pages, so a
 * scanned 90-page policy only ever sends the handful of image-only pages to
 * the model, not the whole document. */
async function subsetPdf(bytes: Uint8Array, pageNumbers: number[]) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, pageNumbers.map((n) => n - 1));
  copied.forEach((page) => out.addPage(page));
  return out.save();
}

const SYSTEM = "You transcribe scanned insurance-document pages exactly as printed. Reply with a single JSON object of the form "
  + '{"pages":[{"pageNumber":1,"text":"..."}]} and nothing else. Transcribe every line of visible text, in reading order, '
  + "including numbers, dates and table rows. If a page is blank or unreadable, use an empty string for its text. Never summarise or omit content.";

/** One transcription attempt for a set of page numbers. Returns whatever the
 * model actually reported rather than throwing, so the caller can retry just
 * the pages it dropped instead of failing the whole document on one flaky
 * response. */
async function attemptHostedOcr(args: { accountId: string; bytes: Uint8Array; pageNumbers: number[]; correlationId?: string }): Promise<BridgePage[]> {
  const choice = modelFor("reading");
  await assertUnderSpendCap(args.accountId);
  const subset = await subsetPdf(args.bytes, args.pageNumbers);
  const pdfBase64 = Buffer.from(subset).toString("base64");
  const started = Date.now();
  const requestedAt = new Date();
  // Checkpoint 10: each attemptHostedOcr() call is its own single-attempt
  // provenance group -- unlike structuredCompletion()'s model-tier fallback,
  // there is no alternate-model retry here, only the caller
  // (completePdfPagesWithHostedOcr) re-invoking this function for pages a
  // prior call dropped, which is a new OCR operation on a different page
  // subset, not a fallback attempt of the same one.
  const attemptGroupId = randomUUID();
  let reply;
  try {
    reply = await hostedDocumentToText(choice, {
      system: SYSTEM,
      user: `This PDF contains ${args.pageNumbers.length} page(s), in this order: ${args.pageNumbers.join(", ")}. `
        + `Number your JSON output using those original page numbers, not 1..${args.pageNumbers.length}. `
        + `Every one of these page numbers must appear exactly once in your "pages" array, even if its text is empty: ${args.pageNumbers.join(", ")}.`,
      pdfBase64,
      maxOutputTokens: Math.max(2048, args.pageNumbers.length * 1200),
    });
  } catch (error) {
    const durationMs = Date.now() - started;
    await recordUsage({ role: "reading", choice, input: 0, output: 0, durationMs, ok: false });
    await recordModelExecution({
      correlationId: args.correlationId, attemptGroupId, attemptIndex: 0, operation: "hosted_ocr", role: "reading",
      requested: { provider: choice.provider, model: choice.model, capability: "reading" },
      requestedAt, resolved: null, status: "failed", errorCategory: "model_provider", latencyMs: durationMs,
    });
    throw error;
  }
  const durationMs = Date.now() - started;
  await recordUsage({ role: "reading", choice, input: reply.usage.input, output: reply.usage.output, cached: reply.usage.cached, durationMs, ok: true });
  const record = await recordModelExecution({
    correlationId: args.correlationId, attemptGroupId, attemptIndex: 0, operation: "hosted_ocr", role: "reading",
    requested: { provider: choice.provider, model: choice.model, capability: "reading" },
    requestedAt, resolved: reply.resolved, status: "succeeded", usage: reply.usage, latencyMs: durationMs,
  });
  // Checkpoint 14b: hosted_ocr output feeds claim-evidence/document
  // extraction directly -- gate here, the one real chokepoint, rather than
  // at each downstream extraction call site. record === null (persistence
  // failure) deliberately does not block the caller -- same failure-
  // isolation contract as lib/ai/llm.ts's structuredCompletion().
  if (record) assertVerifiedForMonetaryUse(record);

  let parsed: { pages?: BridgePage[] };
  try {
    const text = reply.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    parsed = JSON.parse(text) as { pages?: BridgePage[] };
  } catch {
    return [];
  }
  // The model is explicitly told to return an empty string for a page that is
  // genuinely blank or unreadable (a divider, an inside cover, "this page
  // intentionally left blank"), which is a legitimate, honest answer, not a
  // failure -- a real insurance booklet has these often. Treating that empty
  // string the same as the model silently DROPPING the page entirely used to
  // fail the whole document over a single decorative page. Only a page with
  // no entry at all in the reply is a real transcription failure.
  return (parsed.pages ?? []).filter((p) => Number.isInteger(p.pageNumber));
}

/** Hosted replacement for the local PaddleOCR bridge (see ./ocr.ts). Sends
 * only the pages that actually need OCR, as their own tiny PDF, to a
 * document-capable hosted model, and asks it to transcribe them. This is
 * what runs in production (Vercel), where a local Python/GPU OCR process
 * cannot run at all. */
export async function completePdfPagesWithHostedOcr(args: {
  accountId: string;
  bytes: Uint8Array;
  pages: PdfPage[];
  pageNumbers: number[];
}): Promise<PdfPage[]> {
  // Checkpoint 14i: "Hosted OCR" was named as a required telemetry call
  // site (scripts/launch-check.ts's privacy_safe_observability
  // capability) -- deliberately DOCUMENT-level here (one event per
  // completePdfPagesWithHostedOcr() call, i.e. per document that needed
  // OCR at all), not per attemptHostedOcr() attempt: that per-attempt
  // provenance is already Checkpoint 10's separate recordModelExecution()/
  // assertVerifiedForMonetaryUse() governance concern, not telemetry.
  const correlationId = resolveCorrelationId(undefined);
  const householdRef = pseudonymizeId(args.accountId);
  try {
    let returned = await attemptHostedOcr({ accountId: args.accountId, bytes: args.bytes, pageNumbers: args.pageNumbers });
    let missing = args.pageNumbers.filter((n) => !returned.some((p) => p.pageNumber === n));
    // A model dropping a page it was asked for is usually a one-off flake
    // (a truncated reply, a page it briefly balked at) rather than something
    // genuinely unreadable -- retrying just the dropped pages, alone in their
    // own small request, recovers most of these without failing the entire
    // document over it. The document-level "not enough readable text" check
    // further up the pipeline still catches a document that is genuinely
    // unreadable throughout.
    if (missing.length) {
      const retried = await attemptHostedOcr({ accountId: args.accountId, bytes: args.bytes, pageNumbers: missing });
      returned = returned.concat(retried);
      missing = args.pageNumbers.filter((n) => !returned.some((p) => p.pageNumber === n));
    }
    if (missing.length) throw new Error(`The hosted document reader returned no usable text for page${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`);

    const replacements = new Map(returned.map((p) => [p.pageNumber, p.text.trim()]));
    const result = args.pages.map((page) => {
      const replacement = replacements.get(page.pageNumber);
      return replacement !== undefined ? { ...page, text: replacement, extractionMethod: "ocr" as const } : page;
    });
    void recordEvent({
      name: "documents.ocr_hosted.completed",
      correlationId,
      status: "success",
      householdRef,
      extra: { pagesRequested: args.pageNumbers.length, pagesRetried: returned.length - args.pageNumbers.length > 0 ? 1 : 0 },
    });
    return result;
  } catch (error) {
    void recordErrorEvent({
      name: "documents.ocr_hosted.failed",
      correlationId,
      householdRef,
      error,
      extra: { pagesRequested: args.pageNumbers.length },
    });
    throw error;
  }
}

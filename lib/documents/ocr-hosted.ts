import { PDFDocument } from "pdf-lib";
import { hostedDocumentToText, modelFor } from "@/lib/ai/providers";
import { assertUnderSpendCap, recordUsage } from "@/lib/ai/ledger";
import type { PdfPage } from "@/lib/documents/pdf";

type BridgePage = { pageNumber: number; text: string };

function usableCharacters(text: string) {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

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
  const choice = modelFor("reading");
  await assertUnderSpendCap(args.accountId);
  const subset = await subsetPdf(args.bytes, args.pageNumbers);
  const pdfBase64 = Buffer.from(subset).toString("base64");
  const started = Date.now();
  let reply;
  try {
    reply = await hostedDocumentToText(choice, {
      system: SYSTEM,
      user: `This PDF contains ${args.pageNumbers.length} page(s), in this order: ${args.pageNumbers.join(", ")}. `
        + `Number your JSON output using those original page numbers, not 1..${args.pageNumbers.length}.`,
      pdfBase64,
      maxOutputTokens: Math.max(2048, args.pageNumbers.length * 1200),
    });
  } catch (error) {
    await recordUsage({ role: "reading", choice, input: 0, output: 0, durationMs: Date.now() - started, ok: false });
    throw error;
  }
  await recordUsage({ role: "reading", choice, input: reply.usage.input, output: reply.usage.output, cached: reply.usage.cached, durationMs: Date.now() - started, ok: true });

  let parsed: { pages?: BridgePage[] };
  try {
    const text = reply.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    parsed = JSON.parse(text) as { pages?: BridgePage[] };
  } catch {
    throw new Error("The hosted document reader did not return usable text for the scanned page(s).");
  }
  const completed = (parsed.pages ?? []).filter((p) => Number.isInteger(p.pageNumber) && usableCharacters(p.text) >= 1);
  const missing = args.pageNumbers.filter((n) => !completed.some((p) => p.pageNumber === n));
  if (missing.length) throw new Error(`The hosted document reader returned no usable text for page${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`);

  const replacements = new Map(completed.map((p) => [p.pageNumber, p.text.trim()]));
  return args.pages.map((page) => {
    const replacement = replacements.get(page.pageNumber);
    return replacement ? { ...page, text: replacement, extractionMethod: "ocr" as const } : page;
  });
}

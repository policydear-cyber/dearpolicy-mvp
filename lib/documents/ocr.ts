import type { PdfPage } from "@/lib/documents/pdf";
import { modelFor, supportsHostedDocumentReading } from "@/lib/ai/providers";
import { completePdfPagesWithHostedOcr } from "@/lib/documents/ocr-hosted";

function usableCharacters(text: string) {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/** Select image-backed pages whose embedded text layer is missing or useless. */
export function pagesNeedingOcr(pages: PdfPage[]) {
  return pages
    .filter((page) => usableCharacters(page.text) < 24 && (page.imageCount ?? 0) > 0)
    .map((page) => page.pageNumber);
}

/** Fills in the text of scanned, image-only pages by having the reading model
 * look at the page.
 *
 * This used to fall back to a PaddleOCR process spawned on the machine running
 * the app, with a Python virtualenv and a GPU behind it. Production could never
 * use it -- Vercel cannot spawn that bridge at all -- so the fallback only ever
 * ran on one laptop, which meant a scanned document could be read there and not
 * read once deployed. One path now, the same everywhere: if the reading model
 * cannot look at documents, scanned pages are left as they are, and that shows
 * up in the document's own extracted text rather than as a silent difference
 * between two environments. */
export async function completePdfPagesWithOcr(args: {
  accountId: string;
  bytes: Uint8Array;
  password?: string;
  pages: PdfPage[];
  pageNumbers?: number[];
}) {
  if (/^(0|false|off)$/i.test(process.env.OCR_ENABLED?.trim() ?? "")) return args.pages;
  const pageNumbers = args.pageNumbers ?? pagesNeedingOcr(args.pages);
  if (!pageNumbers.length) return args.pages;
  if (!supportsHostedDocumentReading(modelFor("reading").provider)) return args.pages;
  return completePdfPagesWithHostedOcr({ accountId: args.accountId, bytes: args.bytes, pages: args.pages, pageNumbers });
}

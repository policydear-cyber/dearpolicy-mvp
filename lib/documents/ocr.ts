import type { PdfPage } from "@/lib/documents/pdf";

type BridgePage = { pageNumber: number; text: string };
import { documentReaderFor } from "@/lib/ai/providers";
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

/** Fold OCR'd page text back into the page list, keeping any page the reader
 * could not improve on. */
export function mergeOcrPages(pages: PdfPage[], ocrPages: BridgePage[]) {
  const replacements = new Map(
    ocrPages
      .filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0 && usableCharacters(page.text) >= 1)
      .map((page) => [page.pageNumber, page.text.trim()]),
  );
  return pages.map((page) => {
    const replacement = replacements.get(page.pageNumber);
    return replacement
      ? { ...page, text: replacement, extractionMethod: "ocr" as const }
      : page;
  });
}

/** Fills in the text of scanned, image-only pages by having the reading model
 * look at the page.
 *
 * This used to fall back to a PaddleOCR process spawned on the machine running
 * the app, with a Python virtualenv and a GPU behind it. Production could never
 * use it -- Vercel cannot spawn that bridge at all -- so the fallback only ever
 * ran on one laptop, which meant a scanned document could be read there and not
 * read once deployed. One path now, the same everywhere: the configured reading
 * model reads the scanned pages when it can look at documents (Anthropic,
 * Gemini, or an OpenAI vision model such as gpt-6-luna -- PDF file input);
 * otherwise a document-capable provider with a key does. When nothing can,
 * the scanned pages are marked UNREAD (policy_pages.extraction_method
 * 'unreadable', and the document says which pages are missing) -- never
 * returned as if read. Before this, an OpenAI reading model (production)
 * returned the scanned pages unchanged and silently: they were never OCR'd. */
export async function completePdfPagesWithOcr(args: {
  accountId: string;
  /** The document being read: provenance and the reading cache. */
  resourceId?: string;
  bytes: Uint8Array;
  password?: string;
  pages: PdfPage[];
  pageNumbers?: number[];
}) {
  if (/^(0|false|off)$/i.test(process.env.OCR_ENABLED?.trim() ?? "")) return args.pages;
  const pageNumbers = args.pageNumbers ?? pagesNeedingOcr(args.pages);
  if (!pageNumbers.length) return args.pages;
  if (!documentReaderFor()) {
    const unread = new Set(pageNumbers);
    return args.pages.map((page) => (unread.has(page.pageNumber) ? { ...page, unreadable: true } : page));
  }
  return completePdfPagesWithHostedOcr({ accountId: args.accountId, resourceId: args.resourceId, bytes: args.bytes, pages: args.pages, pageNumbers });
}

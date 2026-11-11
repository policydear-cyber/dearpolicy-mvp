import type { PdfPage } from "@/lib/documents/pdf";

type BridgePage = { pageNumber: number; text: string };
import { documentReaderFor } from "@/lib/ai/providers";
import { PageCopyUnavailable, completePdfPagesWithHostedOcr } from "@/lib/documents/ocr-hosted";
import { baiduOcrConfigured, completePdfPagesWithBaidu } from "@/lib/documents/ocr-baidu";

export function usableCharacters(text: string) {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}
/** Fewer letters and digits than this and a page's text does not count as read: the scan-detection bar, also the bar
 * a Baidu reading must clear before it replaces a scanned page (lib/documents/ocr-baidu.ts). */
export const OCR_TEXT_BAR = 24;

/** Select image-backed pages whose embedded text layer is missing or useless. */
export function pagesNeedingOcr(pages: PdfPage[]) {
  return pages
    .filter((page) => page.unmappedText || (usableCharacters(page.text) < OCR_TEXT_BAR && (page.imageCount ?? 0) > 0))
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
  const pageNumbers = args.pageNumbers ?? pagesNeedingOcr(args.pages);
  if (!pageNumbers.length) return args.pages;
  // No reader looks at the scanned pages: they are marked as not read (never as read and empty), so the document is
  // not called "no readable text" for a reason that is not the file's (new-household audit, 3 Nov).
  // Both flags: a document whose other pages carry enough text is still read, and its note names each scanned page
  // that was not read (Critic #323 M1: with scans switched off they were dropped without a word).
  const notRead = (pages: PdfPage[], numbers: number[]) => {
    const unread = new Set(numbers);
    return pages.map((page) => (unread.has(page.pageNumber) ? { ...page, unreadable: true, notRead: true } : page));
  };
  const baidu = baiduOcrConfigured();
  if (/^(0|false|off)$/i.test(process.env.OCR_ENABLED?.trim() ?? "") || (!baidu && !documentReaderFor())) return notRead(args.pages, pageNumbers);
  // Baidu's hosted PaddleOCR reads first (BAIDU_AISTUDIO_TOKEN set); every page it gives no text for -- it is down,
  // slow, over quota, or the page came back empty -- is read by the hosted AI reader, exactly as before.
  let pages = args.pages, remaining = pageNumbers;
  if (baidu) ({ pages, unread: remaining } = await completePdfPagesWithBaidu({ accountId: args.accountId, resourceId: args.resourceId, bytes: args.bytes, password: args.password, pages, pageNumbers }));
  if (!remaining.length) return pages;
  if (!documentReaderFor()) return notRead(pages, remaining);
  // A page that cannot be copied out of the file for the reader (a locked file pdf-lib cannot open, and the page is not
  // one image PDF.js can rebuild) is marked not read and named, and the other pages are still read (TE #410).
  const uncopied = new Set<number>();
  for (let todo = remaining; ;) {
    try {
      const read = todo.length ? await completePdfPagesWithHostedOcr({ accountId: args.accountId, resourceId: args.resourceId, bytes: args.bytes, password: args.password, pages, pageNumbers: todo }) : pages;
      return notRead(read, [...uncopied]);
    } catch (error) {
      if (!(error instanceof PageCopyUnavailable) || !error.pages.some((n) => todo.includes(n))) throw error;
      for (const n of error.pages) uncopied.add(n);
      todo = todo.filter((n) => !uncopied.has(n));
    }
  }
}

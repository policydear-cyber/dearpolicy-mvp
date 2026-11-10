import { PDF_PASSWORD_INCORRECT_MESSAGE, PDF_PASSWORD_REQUIRED_MESSAGE, UserActionableProcessingError } from "@/lib/documents/processing-errors";
import { existsSync } from "node:fs";
import path from "node:path";
import { renderPageLayout, type PageLine } from "./layout";

/** PDF.js's own character maps and standard fonts, shipped in pdfjs-dist (and
 * traced into the deployed function by next.config.ts). Without the character
 * maps, a page set in a CJK font that uses a predefined CMap (common in
 * Chinese/English bilingual insurer documents) yields NO text at all -- not
 * even the English on it. Undefined when the folders are not present. */
function pdfjsDataDir(name: "cmaps" | "standard_fonts"): string | undefined {
  const dir = path.join(process.cwd(), "node_modules", "pdfjs-dist", name);
  return existsSync(dir) ? dir + path.sep : undefined;
}

export type PdfPage = {
  pageNumber: number;
  text: string;
  imageCount?: number;
  extractionMethod?: "native" | "ocr";
  /** OCR was needed and the reader returned nothing for this page even after
   * a retry: anything printed only here is not available. */
  unreadable?: boolean;
  /** OCR was needed but no reader looked at the page (none is configured, or reading scans is switched off): it is not
   * known whether anything is printed there, so the document is never called unreadable because of it. */
  notRead?: boolean;
  /** Round 10: the reader said the page is hard to read (handwriting, a
   * smudged photo): only parts of it were transcribed with confidence. */
  legibility?: "poor";
  /** The page's text showed signs of a scrambled table and a second reading from its image did not agree with it
   * (lib/documents/layout-check.ts): its text stays searchable, but no amount is read from it. */
  unchecked?: boolean;
  /** Why the two readings of an unchecked page did not agree: kept for the processing history only, never as page text. */
  uncheckedWhy?: string;
  /** Some of the page's figure lines were confirmed by the image reading and some were not: the confirmed lines are kept
   * word for word, and the others keep their words with each figure shown as "[amount not checked]". */
  partChecked?: boolean;
  /** What kind of difference the two readings had (counts, shapes and positions of the figures, never a figure or a
   * word): kept for the processing history only. */
  checkLog?: string;
  /** Round 10: the page was photographed or scanned sideways or upside down
   * and was read after turning it by this many degrees (clockwise). */
  turnedBy?: number;
  /** Lines and cells recovered from the page geometry. A benefit schedule is a
   * table, and this is what makes it readable as one. */
  lines?: PageLine[];
};

export async function extractPdfPages(
  bytes: Uint8Array,
  password?: string,
  onProgress?: (completedPages: number, totalPages: number) => void | Promise<void>,
): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    // Preserve the processing options across PDF.js versions whose TypeScript
    // declarations no longer list the optional legacy isEvalSupported flag.
    const documentOptions = {
      // PDF.js TRANSFERS the buffer it is given and leaves the caller holding a
      // detached ArrayBuffer. The same bytes are needed afterwards to render
      // image-backed pages for OCR, so hand PDF.js its own copy. Without this,
      // any PDF that needs OCR fails with "Cannot perform Construct on a
      // detached ArrayBuffer" after the text pass has already succeeded.
      data: new Uint8Array(bytes),
      password: password || undefined,
      useSystemFonts: true,
      isEvalSupported: false,
      cMapUrl: pdfjsDataDir("cmaps"),
      cMapPacked: true,
      standardFontDataUrl: pdfjsDataDir("standard_fonts"),
    };
    const task = pdfjs.getDocument(documentOptions);
    const pdf = await task.promise;
    const pages: PdfPage[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      // Keep the position of every text item. Joining with spaces was throwing
      // away the layout, which is where a benefit table lives.
      // Each position is where the item is on the page as it is shown: a page stored turned (a landscape statement
      // kept as a portrait page with /Rotate 90) prints its rows along the stored page's x axis, so read in the stored
      // coordinates every table column came out as one line ("StatusIn ForceIn Force", "100,000.002,000.00500.00")
      // and no figure could be tied to its row (a household's schedules, held back since October). y counts up from
      // the bottom of the shown page, as the layout expects.
      const viewport = page.getViewport({ scale: 1 });
      const positioned = content.items.flatMap((item) => {
        if (!("str" in item) || !String(item.str).trim()) return [];
        const shown = pdfjs.Util.transform(viewport.transform, item.transform ?? [1, 0, 0, 1, 0, 0]);
        return [{ text: String(item.str), x: Number(shown[4] ?? 0), y: viewport.height - Number(shown[5] ?? 0), w: Number(item.width ?? 0) }];
      });
      const layout = renderPageLayout(positioned, viewport.width);
      const text = layout.text || content.items.map((item) => ("str" in item ? String(item.str) : "")).join(" ").replace(/\s+/g, " ").trim();
      // A page with almost no text but one or more painted images is normally a
      // scan. Remembering that signal lets the ingestion pipeline OCR only the
      // affected pages instead of reprocessing an otherwise healthy PDF.
      const operators = await page.getOperatorList();
      const imageOperations = new Set([
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintInlineImageXObject,
        pdfjs.OPS.paintImageMaskXObject,
      ]);
      const imageCount = operators.fnArray.reduce(
        (count, operation) => count + (imageOperations.has(operation) ? 1 : 0),
        0,
      );
      pages.push({ pageNumber, text, imageCount, extractionMethod: "native", lines: layout.lines });
      await onProgress?.(pageNumber, pdf.numPages);
    }

    return pages;
  } catch (error) {
    const anyError = error as { name?: string; code?: number; message?: string };
    const message = anyError?.message ?? "";
    if (anyError?.name === "PasswordException" || anyError?.code === 1 || anyError?.code === 2 || /password/i.test(message)) {
      if (!password || anyError?.code === 1 || /no password|need password/i.test(message)) {
        throw new UserActionableProcessingError(PDF_PASSWORD_REQUIRED_MESSAGE);
      }
      throw new UserActionableProcessingError(PDF_PASSWORD_INCORRECT_MESSAGE);
    }
    throw error;
  }
}

/** Round 7 (port): the Title in the PDF's own document properties, when it
 * reads as one (not a generator's or a word processor's placeholder). */
export async function pdfDocumentTitle(bytes: Uint8Array): Promise<string | null> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const title = (doc.getTitle() ?? "").replace(/\s+/g, " ").trim();
  if (title.length < 4 || title.length > 120 || /^(?:untitled|document\d*|microsoft word|scan\d*|img[_-]?\d+)/i.test(title) || /\.(?:pdf|docx?|jpe?g|png)$/i.test(title)) return null;
  return title;
}

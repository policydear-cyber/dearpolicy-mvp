import { renderPageLayout, type PageLine } from "./layout";

export type PdfPage = {
  pageNumber: number;
  text: string;
  imageCount?: number;
  extractionMethod?: "native" | "ocr";
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
    };
    const task = pdfjs.getDocument(documentOptions);
    const pdf = await task.promise;
    const pages: PdfPage[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      // Keep the position of every text item. Joining with spaces was throwing
      // away the layout, which is where a benefit table lives.
      const positioned = content.items.flatMap((item) =>
        "str" in item && String(item.str).trim()
          ? [{ text: String(item.str), x: Number(item.transform?.[4] ?? 0), y: Number(item.transform?.[5] ?? 0), w: Number(item.width ?? 0) }]
          : []);
      const layout = renderPageLayout(positioned, page.getViewport({ scale: 1 }).width);
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
        throw new Error("This PDF is password protected. Enter the PDF password and try again.");
      }
      throw new Error("The PDF password appears to be incorrect. Please check it and try again.");
    }
    throw error;
  }
}

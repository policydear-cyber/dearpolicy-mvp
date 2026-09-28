/**
 * Supported upload formats: real-signature sniffing, validation and
 * normalization for every document DearPolicy ingests (policy documents and
 * claim evidence).
 *
 * The extraction pipeline itself reads PDFs (lib/documents/pdf.ts +
 * lib/documents/ocr.ts), so everything else that is supported is NORMALIZED
 * to that path at processing time:
 *   - images (JPEG/PNG/WebP/TIFF) are decoded with sharp and wrapped into a
 *     PDF, one page per image frame, which then flows through the ordinary
 *     scanned-page OCR path;
 *   - Word documents (.docx) are read as text with mammoth -- an XML parse of
 *     the document body; embedded macros/objects are never executed -- and
 *     split into stored "pages" so citations still point at a stable page of
 *     the stored text.
 * The ORIGINAL uploaded bytes are always what is stored and checksummed;
 * normalization is recomputed from them at processing time and never
 * replaces them.
 *
 * What is deliberately NOT supported, and why the sniffing here rejects it
 * by real file signature rather than by extension alone:
 *   - executables (PE/ELF/Mach-O) -- never accepted, whatever the name;
 *   - archives (zip/rar/7z/gzip; a .docx is a zip but must contain the Word
 *     document entry to count as one);
 *   - HEIC/HEIF photos -- the deployed runtime's image decoder (sharp's
 *     prebuilt libvips) decodes AV1/AVIF but not HEVC-encoded HEIC, so
 *     accepting them would promise a format production cannot parse;
 *   - GIF and everything unrecognised.
 */
import { PDFDocument } from "pdf-lib";
import type { PdfPage } from "./pdf";

export type SupportedUploadFormat = "pdf" | "jpeg" | "png" | "webp" | "tiff" | "docx";

export const SUPPORTED_UPLOAD_FORMATS: SupportedUploadFormat[] = ["pdf", "jpeg", "png", "webp", "tiff", "docx"];

/** One sentence every rejection can end with, so the person always learns
 * what WOULD work. */
export const ACCEPTED_FORMATS_MESSAGE =
  "DearPolicy accepts PDF documents, photos or scans as JPEG, PNG, WebP or TIFF, and Word (.docx) files.";

export const FORMAT_EXTENSIONS: Record<SupportedUploadFormat, string[]> = {
  pdf: [".pdf"],
  jpeg: [".jpg", ".jpeg"],
  png: [".png"],
  webp: [".webp"],
  tiff: [".tif", ".tiff"],
  docx: [".docx"],
};

export const FORMAT_MIME_TYPES: Record<SupportedUploadFormat, string[]> = {
  pdf: ["application/pdf"],
  jpeg: ["image/jpeg", "image/jpg"],
  png: ["image/png"],
  webp: ["image/webp"],
  tiff: ["image/tiff", "image/tif"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

/** The `accept` attribute value for upload inputs. */
export const UPLOAD_ACCEPT_ATTRIBUTE = SUPPORTED_UPLOAD_FORMATS.flatMap((f) => FORMAT_MIME_TYPES[f].slice(0, 1).concat(FORMAT_EXTENSIONS[f])).join(",");

export type DocumentUploadRejection =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "EXECUTABLE_FILE"
  | "ARCHIVE_FILE"
  | "UNSUPPORTED_FORMAT"
  | "UNSUPPORTED_MIME_TYPE"
  | "UNSUPPORTED_EXTENSION"
  | "MIME_EXTENSION_MISMATCH"
  | "SIGNATURE_MISMATCH"
  | "CORRUPTED_FILE";

export type FormatSniff =
  | { ok: true; format: SupportedUploadFormat }
  | { ok: false; reasonCode: DocumentUploadRejection; message: string };

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return Buffer.from(bytes.subarray(start, start + length)).toString("latin1");
}

function zipContains(bytes: Uint8Array, marker: string): boolean {
  // A .docx keeps `word/document.xml` in its central directory (at the end)
  // and usually near the start too; search a bounded window of each.
  const needle = Buffer.from(marker, "latin1");
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headWindow = buffer.subarray(0, Math.min(buffer.length, 4 * 1024 * 1024));
  if (headWindow.includes(needle)) return true;
  const tailWindow = buffer.subarray(Math.max(0, buffer.length - 256 * 1024));
  return tailWindow.includes(needle);
}

/** Classifies the ACTUAL uploaded bytes by their real file signature.
 * Fails closed: anything unrecognised is rejected, never defaulted through. */
export function sniffFileFormat(bytes: Uint8Array): FormatSniff {
  if (bytes.length < 8) {
    return { ok: false, reasonCode: "CORRUPTED_FILE", message: `That file is too small to be a readable document. ${ACCEPTED_FORMATS_MESSAGE}` };
  }
  const head4 = ascii(bytes, 0, 4);
  const head8 = ascii(bytes, 0, 8);

  // Executables first -- never accepted, whatever they are called.
  if (
    head4.startsWith("MZ") ||
    head4 === "\x7fELF" ||
    ["\xfe\xed\xfa\xce", "\xfe\xed\xfa\xcf", "\xce\xfa\xed\xfe", "\xcf\xfa\xed\xfe", "\xca\xfe\xba\xbe"].includes(head4)
  ) {
    return { ok: false, reasonCode: "EXECUTABLE_FILE", message: `Executable files are never accepted. ${ACCEPTED_FORMATS_MESSAGE}` };
  }

  if (ascii(bytes, 0, 5) === "%PDF-") return { ok: true, format: "pdf" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ok: true, format: "jpeg" };
  if (head8 === "\x89PNG\r\n\x1a\n") return { ok: true, format: "png" };
  if (head4 === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return { ok: true, format: "webp" };
  if (head4 === "II*\x00" || head4 === "MM\x00*") return { ok: true, format: "tiff" };

  // ISO-BMFF (ftyp) container: HEIC/HEIF/AVIF photos. The deployed runtime
  // cannot reliably decode HEVC-encoded HEIC, so these are rejected with a
  // way forward rather than accepted and failed later.
  if (ascii(bytes, 4, 4) === "ftyp") {
    return {
      ok: false,
      reasonCode: "UNSUPPORTED_FORMAT",
      message: `HEIC/HEIF photos are not supported yet. Share or export the photo as JPEG or PDF and upload that instead. ${ACCEPTED_FORMATS_MESSAGE}`,
    };
  }

  if (head4.startsWith("PK")) {
    if (zipContains(bytes, "word/document.xml")) return { ok: true, format: "docx" };
    return {
      ok: false,
      reasonCode: "ARCHIVE_FILE",
      message: `Archives are not accepted -- upload the documents inside it individually. ${ACCEPTED_FORMATS_MESSAGE}`,
    };
  }
  if (head4.startsWith("Rar!") || head8.startsWith("7z\xbc\xaf") || (bytes[0] === 0x1f && bytes[1] === 0x8b)) {
    return { ok: false, reasonCode: "ARCHIVE_FILE", message: `Archives are not accepted -- upload the documents inside it individually. ${ACCEPTED_FORMATS_MESSAGE}` };
  }

  return { ok: false, reasonCode: "UNSUPPORTED_FORMAT", message: `That file format is not supported. ${ACCEPTED_FORMATS_MESSAGE}` };
}

export type DocumentUploadValidation =
  | { valid: true; format: SupportedUploadFormat }
  | { valid: false; reasonCode: DocumentUploadRejection; message: string };

function extensionOf(filename: string) {
  const match = /\.[a-z0-9]+$/i.exec(filename.trim());
  return match ? match[0].toLowerCase() : "";
}

/** Validates an upload end to end: size, real file signature, and that the
 * client-declared extension and MIME type both agree with what the bytes
 * actually are. A mismatch is always rejected -- a renamed or mislabelled
 * file never slips through on one check alone. */
export function validateDocumentUpload(args: {
  filename: string;
  mimeType: string;
  byteSize: number;
  bytes: Uint8Array;
  maxBytes: number;
}): DocumentUploadValidation {
  if (args.byteSize <= 0) return { valid: false, reasonCode: "EMPTY_FILE", message: "The uploaded file is empty." };
  if (args.byteSize > args.maxBytes) {
    return { valid: false, reasonCode: "FILE_TOO_LARGE", message: `Files must be ${Math.floor(args.maxBytes / (1024 * 1024))} MB or smaller.` };
  }
  const sniffed = sniffFileFormat(args.bytes);
  if (!sniffed.ok) return { valid: false, reasonCode: sniffed.reasonCode, message: sniffed.message };

  const extension = extensionOf(args.filename);
  const knownExtension = SUPPORTED_UPLOAD_FORMATS.some((f) => FORMAT_EXTENSIONS[f].includes(extension));
  if (!knownExtension) {
    return { valid: false, reasonCode: "UNSUPPORTED_EXTENSION", message: `"${extension || "(none)"}" is not a supported file extension. ${ACCEPTED_FORMATS_MESSAGE}` };
  }
  if (!FORMAT_EXTENSIONS[sniffed.format].includes(extension)) {
    return {
      valid: false,
      reasonCode: "SIGNATURE_MISMATCH",
      message: "The file's contents do not match its extension. Re-save or re-export the document, then upload it again.",
    };
  }
  const mime = (args.mimeType || "").toLowerCase().split(";")[0].trim();
  const knownMime = SUPPORTED_UPLOAD_FORMATS.some((f) => FORMAT_MIME_TYPES[f].includes(mime));
  if (!knownMime) {
    return { valid: false, reasonCode: "UNSUPPORTED_MIME_TYPE", message: `That file type is not supported. ${ACCEPTED_FORMATS_MESSAGE}` };
  }
  if (!FORMAT_MIME_TYPES[sniffed.format].includes(mime)) {
    return { valid: false, reasonCode: "MIME_EXTENSION_MISMATCH", message: "The file's declared type does not match its contents. Re-save the document and upload it again." };
  }
  return { valid: true, format: sniffed.format };
}

/** Upload-time decode probe for image formats: a corrupted image is rejected
 * at upload with a useful message instead of failing minutes later in the
 * background. Returns null when fine, or a safe message. */
export async function probeImageDecodes(bytes: Uint8Array, format: SupportedUploadFormat): Promise<string | null> {
  if (format === "pdf" || format === "docx") return null;
  try {
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(Buffer.from(bytes), { pages: 1 }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("no dimensions");
    return null;
  } catch {
    return "That image could not be read -- it may be corrupted. Re-export or re-photograph the document, then upload it again.";
  }
}

// ---------------------------------------------------------------------------
// Normalization for extraction
// ---------------------------------------------------------------------------

const MAX_IMAGE_PAGES = 20;
const MAX_IMAGE_DIMENSION = 2600; // px -- plenty for OCR, bounded for memory.

/** Wraps one image upload (possibly multi-frame TIFF) into a PDF, one page
 * per frame, so the ordinary scanned-page pipeline (page store -> OCR ->
 * extraction, with page-numbered citations) applies unchanged. */
export async function imageToPdf(bytes: Uint8Array, format: SupportedUploadFormat): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const buffer = Buffer.from(bytes);
  const metadata = await sharp(buffer).metadata();
  const frameCount = format === "tiff" ? Math.min(metadata.pages ?? 1, MAX_IMAGE_PAGES) : 1;
  const pdf = await PDFDocument.create();
  for (let frame = 0; frame < frameCount; frame++) {
    const frameSharp = sharp(buffer, { page: frame }).rotate(); // honour EXIF orientation
    const png = await frameSharp
      .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const embedded = await pdf.embedPng(png);
    const page = pdf.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }
  return pdf.save();
}

const DOCX_PAGE_CHARACTERS = 2800;

/** Reads a .docx body as text, keeping the two things a benefit schedule
 * needs: TABLE ROWS (each row one line, its cells joined by a tab -- the same
 * shape the PDF layout reader stores, so the deterministic benefit-row parser
 * reads a Word schedule exactly like a PDF one) and PRINTED PAGES (a hard page
 * break, or the page break Word recorded when it last laid the document out,
 * starts a new stored page, so a citation points at the page the person sees).
 *
 * The XML is scanned as text with JSZip; nothing embedded is ever executed.
 * A document with no recorded page breaks falls back to splitting on
 * paragraph boundaries every ~2,800 characters; a package this reader cannot
 * make sense of falls back to mammoth's plain-text read. */
export async function docxToPages(bytes: Uint8Array): Promise<PdfPage[]> {
  let structured: string[][] | null = null;
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(Buffer.from(bytes));
    const xml = await zip.file("word/document.xml")?.async("string");
    if (xml) structured = docxXmlToPageLines(xml);
  } catch {
    structured = null;
  }
  const hasText = structured?.some((page) => page.some((line) => line.trim()));
  if (!structured || !hasText) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    structured = [result.value.split(/\n+/)];
  }
  const printedPages = structured.map((lines) => lines.map((l) => l.replace(/[ \u00a0]+/g, " ").trim()).filter(Boolean)).filter((lines) => lines.length);
  if (printedPages.length > 1) {
    return printedPages.map((lines, index) => ({ pageNumber: index + 1, text: lines.join("\n"), imageCount: 0, extractionMethod: "native" as const }));
  }
  // No page breaks recorded: split on line boundaries, as before.
  const pages: PdfPage[] = [];
  let current: string[] = [];
  let currentLength = 0;
  const flush = () => {
    if (!current.length) return;
    pages.push({ pageNumber: pages.length + 1, text: current.join("\n"), imageCount: 0, extractionMethod: "native" });
    current = [];
    currentLength = 0;
  };
  for (const line of printedPages[0] ?? []) {
    if (currentLength + line.length > DOCX_PAGE_CHARACTERS && current.length) flush();
    current.push(line);
    currentLength += line.length + 1;
  }
  flush();
  return pages;
}

function decodeXmlText(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** word/document.xml -> pages of lines. Exported for regression tests. */
export function docxXmlToPageLines(xml: string): string[][] {
  const bodyStart = xml.indexOf("<w:body");
  const body = bodyStart >= 0 ? xml.slice(bodyStart) : xml;
  const pages: string[][] = [[]];
  let breakPending = false;
  const emit = (line: string) => {
    if (!line.trim()) return;
    if (breakPending && pages[pages.length - 1].length) pages.push([]);
    breakPending = false;
    pages[pages.length - 1].push(line);
  };
  let tableDepth = 0;
  let paragraph = "";
  let cell = "";
  let cells: string[] = [];
  let inText = false;
  const token = /<(\/?)(w:tbl|w:tr|w:tc|w:p|w:t|w:tab|w:br|w:cr|w:lastRenderedPageBreak)(?=[\s/>])([^>]*?)(\/?)>|<[^>]*>|([^<]+)/g;
  for (let m = token.exec(body); m; m = token.exec(body)) {
    const [, closing, tag, attrs, selfClosing, text] = m;
    if (text !== undefined) { if (inText) paragraph += decodeXmlText(text); continue; }
    if (!tag) continue;
    const open = !closing;
    switch (tag) {
      case "w:t": inText = open && !selfClosing; break;
      // A run's <w:tab/> is a printed tab; a <w:tab w:val=… w:pos=…/> inside
      // paragraph properties is only a tab-stop definition.
      case "w:tab": if (open && !/w:val=/.test(attrs)) paragraph += tableDepth ? " " : "\t"; break;
      case "w:cr": if (open) paragraph += " "; break;
      case "w:br":
      case "w:lastRenderedPageBreak": {
        const isPage = tag === "w:lastRenderedPageBreak" || /w:type="page"/.test(attrs);
        if (!isPage) { if (open) paragraph += " "; break; }
        if (!tableDepth) { emit(paragraph); paragraph = ""; }
        breakPending = true;
        break;
      }
      case "w:p":
        if (open && !selfClosing) paragraph = "";
        else if (!open) {
          if (tableDepth) cell += (cell && paragraph.trim() ? " " : "") + paragraph.trim();
          else emit(paragraph);
          paragraph = "";
        }
        break;
      // Only the outermost table's rows and cells are structure; a table
      // nested inside a cell flows into that cell's text.
      case "w:tc": if (tableDepth !== 1) break; if (open) cell = ""; else cells.push(cell.trim()); break;
      case "w:tr": if (tableDepth !== 1) break; if (open) cells = []; else emit(cells.filter(Boolean).join("\t")); break;
      case "w:tbl": tableDepth += open ? 1 : -1; if (tableDepth < 0) tableDepth = 0; break;
    }
  }
  return pages;
}

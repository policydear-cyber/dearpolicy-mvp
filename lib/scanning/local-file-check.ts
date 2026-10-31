/**
 * A local check of an uploaded file's structure, done entirely inside DearPolicy (no file content leaves).
 *
 * Used when the malware scanner only looks up a file's hash (lib/scanning/adapters/virustotal.ts) and the scanner has
 * never seen the file, which is true of almost every personal document. Instead of holding such a file forever, it is
 * checked here and then either proceeds or is rejected with a reason. Strict, and fails closed:
 *   - size: not empty, at most the upload limit;
 *   - type: the file's own signature must be one DearPolicy accepts (lib/documents/formats.ts sniffFileFormat);
 *   - structure: a PDF has its end marker; a JPEG, PNG or WebP ends where its own structure says it ends (nothing
 *     hidden after it); a Word file is a readable zip;
 *   - no active content: a PDF with JavaScript, launch actions, embedded files, rich media, XFA forms or form
 *     submission, also inside compressed streams and with hex-escaped names; a Word file with macros, ActiveX,
 *     embedded objects or external templates/frames;
 *   - anything that cannot be inspected (an encrypted PDF whose objects are compressed, a stream too large to
 *     unpack) is NOT passed.
 * This catches documents carrying active content; it is not a signature-based virus scan.
 */
import { inflateRawSync, inflateSync } from "node:zlib";
import { sniffFileFormat } from "@/lib/documents/formats";

export const LOCAL_CHECK_MAX_BYTES = 50 * 1024 * 1024;
/** Bounds on unpacking compressed parts, so a "zip bomb" is refused instead of exhausting memory. */
const MAX_UNPACKED_TOTAL = 200 * 1024 * 1024;
const MAX_UNPACKED_STREAM = 50 * 1024 * 1024;
const MAX_STREAMS = 20_000;

export type LocalFileCheck =
  | { ok: true; format: string }
  | { ok: false; reason: "too_large" | "empty" | "unsupported_type" | "structure" | "active_content" | "not_inspectable"; detail: string };

const latin1 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");

/** PDF names may hex-escape any character ("/J#61vaScript"); read them as written out. */
function unescapeNames(text: string): string {
  return text.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
/** PDF keys that carry or start active content. Links (/URI) and page-fit open actions are ordinary and allowed. */
const PDF_ACTIVE = /\/(?:JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA|SubmitForm|ImportData|GoToE|Sound|Movie)(?![A-Za-z0-9])/;

function checkPdf(bytes: Uint8Array): LocalFileCheck {
  const text = latin1(bytes);
  if (!text.slice(-2048).includes("%%EOF")) return { ok: false, reason: "structure", detail: "PDF end marker missing" };
  const encrypted = /\/Encrypt(?![A-Za-z0-9])/.test(text);
  // Dictionaries live outside streams, or inside compressed object streams. Stream data itself (images, page
  // drawing) is skipped, so random bytes in a photo never look like a key.
  let outside = "", from = 0, unpacked = 0, count = 0;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (++count > MAX_STREAMS) return { ok: false, reason: "not_inspectable", detail: "too many streams to inspect" };
    if (text.slice(Math.max(0, m.index - 3), m.index) === "end") continue;
    const before = text.slice(Math.max(from, m.index - 4096), m.index);
    const dictStart = before.lastIndexOf("<<");
    const own = unescapeNames(dictStart >= 0 ? before.slice(dictStart) : before);
    const start = m.index + m[0].length;
    const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(own);
    let end = direct ? start + Number(direct[1]) : -1;
    if (end < 0 || end > text.length || text.slice(end, end + 12).indexOf("endstream") < 0) end = text.indexOf("endstream", start);
    if (end < 0) return { ok: false, reason: "structure", detail: "unterminated stream" };
    outside += text.slice(from, start);
    from = end;
    re.lastIndex = end;
    if (!/\/Type\s*\/ObjStm/.test(own)) continue;
    // An object stream holds dictionaries; one we cannot read could hide active content.
    if (!/\/FlateDecode/.test(own)) return { ok: false, reason: "not_inspectable", detail: "object stream not in an inspectable encoding" };
    let decoded: Buffer;
    try { decoded = inflateSync(bytes.subarray(start, end), { maxOutputLength: MAX_UNPACKED_STREAM }); }
    catch { return { ok: false, reason: "not_inspectable", detail: encrypted ? "encrypted PDF with compressed objects" : "object stream could not be read" }; }
    unpacked += decoded.length;
    if (unpacked > MAX_UNPACKED_TOTAL) return { ok: false, reason: "not_inspectable", detail: "too much compressed content to inspect" };
    if (PDF_ACTIVE.test(unescapeNames(decoded.toString("latin1")))) return { ok: false, reason: "active_content", detail: "PDF contains active content in a compressed object" };
  }
  outside += text.slice(from);
  if (PDF_ACTIVE.test(unescapeNames(outside))) return { ok: false, reason: "active_content", detail: "PDF contains active content" };
  return { ok: true, format: "pdf" };
}

/** Bytes after an image's own end may hide another file; a few padding bytes are tolerated. */
const TRAILING_SLACK = 16;
function trailingOk(bytes: Uint8Array, end: number): boolean {
  if (end > bytes.length) return false;
  for (let i = end; i < bytes.length; i++) if (bytes[i] !== 0 && bytes[i] !== 0x0a && bytes[i] !== 0x0d && bytes[i] !== 0x20) return false;
  return bytes.length - end <= TRAILING_SLACK || bytes.subarray(end).every((b) => b === 0);
}
function checkJpeg(bytes: Uint8Array): LocalFileCheck {
  let end = -1;
  for (let i = bytes.length - 2; i >= Math.max(2, bytes.length - 2 - TRAILING_SLACK - 2); i--) if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) { end = i + 2; break; }
  return end > 0 && trailingOk(bytes, end) ? { ok: true, format: "jpeg" } : { ok: false, reason: "structure", detail: "JPEG does not end where its structure ends" };
}
function checkPng(bytes: Uint8Array): LocalFileCheck {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  while (p + 12 <= b.length) {
    const len = b.readUInt32BE(p), type = b.toString("latin1", p + 4, p + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return { ok: false, reason: "structure", detail: "PNG chunk unreadable" };
    p += 12 + len;
    if (type === "IEND") return trailingOk(bytes, p) ? { ok: true, format: "png" } : { ok: false, reason: "structure", detail: "data after PNG end" };
  }
  return { ok: false, reason: "structure", detail: "PNG end chunk missing" };
}
function checkWebp(bytes: Uint8Array): LocalFileCheck {
  const size = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32LE(4) + 8;
  return trailingOk(bytes, size + (size % 2)) || trailingOk(bytes, size) ? { ok: true, format: "webp" } : { ok: false, reason: "structure", detail: "WebP size does not match the file" };
}

/** Word files: a zip whose parts are read from its central directory. */
function checkDocx(bytes: Uint8Array): LocalFileCheck {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > b.length) return { ok: false, reason: "structure", detail: "zip directory missing" };
  const entries = b.readUInt16LE(eocd + 10), cdOffset = b.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) return { ok: false, reason: "not_inspectable", detail: "zip64 not inspected" };
  let p = cdOffset, unpacked = 0;
  for (let i = 0; i < entries; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) return { ok: false, reason: "structure", detail: "zip directory unreadable" };
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
    const name = b.toString("latin1", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (/vbaProject|vbaData|\/activeX\/|\/embeddings\/|\.bin$|\.(?:exe|dll|js|vbs|ps1|bat|cmd|scr|hta)$/i.test(name)) return { ok: false, reason: "active_content", detail: "Word file contains macros, ActiveX or embedded objects" };
    if (!/\.rels$/i.test(name)) continue;
    if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50) return { ok: false, reason: "structure", detail: "zip part unreadable" };
    const dataStart = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(dataStart, dataStart + csize);
    let xml: string;
    try { xml = (method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_UNPACKED_STREAM }) : null)?.toString("utf8") ?? ""; }
    catch { return { ok: false, reason: "not_inspectable", detail: "zip part could not be read" }; }
    if (method !== 0 && method !== 8) return { ok: false, reason: "not_inspectable", detail: "zip part in an unknown encoding" };
    unpacked += xml.length;
    if (unpacked > MAX_UNPACKED_TOTAL) return { ok: false, reason: "not_inspectable", detail: "too much compressed content" };
    // An external relationship other than a plain hyperlink (a remote template, frame, object or sub-document) fetches
    // and runs content from elsewhere when the file is opened.
    for (const rel of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
      if (/TargetMode\s*=\s*"External"/i.test(rel) && !/\/hyperlink"/i.test(rel)) return { ok: false, reason: "active_content", detail: "Word file loads external content" };
    }
  }
  return { ok: true, format: "docx" };
}

export function checkFileLocally(bytes: Uint8Array, maxBytes = LOCAL_CHECK_MAX_BYTES): LocalFileCheck {
  if (!bytes.length) return { ok: false, reason: "empty", detail: "empty file" };
  if (bytes.length > maxBytes) return { ok: false, reason: "too_large", detail: "file larger than the upload limit" };
  const sniff = sniffFileFormat(bytes);
  if (!sniff.ok) return { ok: false, reason: "unsupported_type", detail: "file type not accepted" };
  switch (sniff.format) {
    case "pdf": return checkPdf(bytes);
    case "jpeg": return checkJpeg(bytes);
    case "png": return checkPng(bytes);
    case "webp": return checkWebp(bytes);
    case "docx": return checkDocx(bytes);
    // TIFF: an image container with no scripting; its signature and size are checked above.
    case "tiff": return { ok: true, format: "tiff" };
    default: return { ok: false, reason: "unsupported_type", detail: "file type not accepted" };
  }
}

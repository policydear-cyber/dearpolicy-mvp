/**
 * Synthetic document fixtures for the document-ingestion browser journey
 * (e2e/ingestion-tests/document-ingestion.spec.ts). Every byte here is
 * generated locally and clearly synthetic -- nothing is a real insurance
 * document, a real person or real malware. The personalised certificate
 * carries its own extraction payload (the DPTEST-EXTRACTION marker that
 * lib/ai/deterministic-model.ts's stand-in decodes), so the browser journey
 * exercises the REAL upload -> storage -> queue -> read -> classify ->
 * extract -> verify -> link -> index -> chat pipeline with deterministic
 * content; only the hosted model call itself is a stand-in.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import JSZip from "jszip";
import { PREFIX, RUN_ID, name } from "./synthetic";

export { PREFIX, name };

/** Person names must read like real names to pass DearPolicy's own
 * person-name sanitizer (which correctly rejects labels and long digit
 * runs), so the run id is carried as letters in an obviously synthetic
 * surname instead of digits. */
const RUN_TAG = RUN_ID.replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "x");
export const personName = (first: string) => `${first} Dptest${RUN_TAG}`;

/** Draws lines of text on pages; returns the PDF bytes. */
async function textPdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((line, i) => page.drawText(line, { x: 40, y: 800 - i * 16, size: 9, font }));
  }
  return Buffer.from(await doc.save());
}

/** The synthetic extraction payload, wrapped in the marker pair and split so
 * every chunk fits on a drawn PDF line (the text layer keeps only what is
 * drawn). */
function extractionLines(payload: unknown): string[] {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  // Each marker sits on its own drawn line and the base64 body is chunked at
  // 80 characters: a chunk that overflows the page width loses its clipped
  // tail in text extraction, and a marker split across a line break is not
  // found at all -- either way the payload is (deliberately) treated as
  // absent rather than partially parsed.
  return ["DPTEST-EXTRACTION:", ...(encoded.match(/.{1,80}/g) ?? []), ":DPTEST-END"];
}

export type CertificateOptions = {
  label: string;
  policyNumber: string;
  insuredNames: string[];
  /** Coverage amount stated per insured name (index-matched); null = the
   * certificate states no amount for that person. */
  amounts?: (number | null)[];
  /** Currency written on the page; null = the document states none
   * ("missing stays missing" -- nothing may invent SGD). */
  currency?: string | null;
  expiryDate?: string | null;
  premium?: { amount: number; currency: string; frequency: string } | null;
  exclusions?: string[];
  waitingPeriods?: string[];
};

/** A personalised policy certificate: page 1 carries the human-readable
 * particulars (each evidence line verbatim, so verifyExtractionEvidence()
 * can bind facts to this page) plus the synthetic extraction payload. */
export async function certificatePdf(opts: CertificateOptions): Promise<Buffer> {
  const product = `${PREFIX}-${opts.label}`;
  const currency = opts.currency === undefined ? "SGD" : opts.currency;
  const amounts = opts.amounts ?? opts.insuredNames.map(() => 100000);
  // Evidence lines double as chat-retrieval targets: they are phrased so a
  // natural question shares several content words with exactly this line.
  const evidence = opts.insuredNames.map((who, i) => {
    const amount = amounts[i];
    return amount == null
      ? `Benefits included for ${who}: Critical Illness cover; the sum insured is not stated on this certificate.`
      : `Benefits included: Critical Illness with a Sum Insured of ${currency ? currency + " " : ""}${amount.toLocaleString("en-US")} for ${who}.`;
  });
  const exclusions = opts.exclusions ?? ["Exclusions that apply to this cover: for the Critical Illness Benefit, pre-existing conditions diagnosed before the cover start date are excluded."];
  const waiting = opts.waitingPeriods ?? ["A waiting period of 90 days applies to the Critical Illness Benefit."];
  // Kept deliberately compact: the whole payload must fit the extractor's
  // per-page evidence budget even for a two-person certificate.
  const payload = {
    documentType: "Certificate",
    documentRole: "certificate",
    documentNotes: [],
    insurer: "Synthetic Test Insurer",
    productName: product,
    productsMentioned: [],
    policyNumber: opts.policyNumber,
    groupPolicyNumber: null,
    policyType: "Critical Illness",
    policyholder: null,
    personalCoverageConfirmed: true,
    startDate: "2025-01-01",
    renewalOrExpiryDate: opts.expiryDate === undefined ? "2027-01-01" : opts.expiryDate,
    insuredPeople: opts.insuredNames.map((who, i) => ({
      name: who,
      relationshipHint: null,
      coverages: [{
        category: "Critical Illness", productName: product, policyNumber: null,
        amount: amounts[i], currency: amounts[i] == null ? null : currency,
        notes: null, sourcePage: 1, evidenceText: evidence[i], evidenceVerified: false,
      }],
    })),
    referenceCoverages: [],
    premium: opts.premium === undefined
      ? { amount: 55, currency: "SGD", frequency: "monthly" }
      : (opts.premium ?? { amount: null, currency: null, frequency: null }),
    paymentRecords: [],
    // Short forms only: the page carries the full sentences, and the payload
    // must stay inside the extractor's per-page evidence budget.
    keyExclusions: exclusions.map((line) => line.slice(0, 60)),
    waitingPeriods: waiting.map((line) => line.slice(0, 60)),
    deductiblesAndCoinsurance: [],
    riders: [],
  };
  const expiry = opts.expiryDate === undefined ? "2027-01-01" : opts.expiryDate;
  const page1 = [
    `${product} Certificate of Insurance`,
    "SYNTHETIC TEST DOCUMENT - NOT A REAL INSURANCE POLICY",
    `Certificate no. ${opts.policyNumber}. Issued by Synthetic Test Insurer.`,
    "Particulars of Insured",
    ...opts.insuredNames.map((who) => `Insured person: ${who}`),
    `The policy number printed on this certificate is ${opts.policyNumber}.`,
    ...evidence,
    ...(opts.premium === undefined ? ["The premium payable each month for this Critical Illness cover is SGD 55."] : opts.premium ? [`The premium payable each ${opts.premium.frequency === "monthly" ? "month" : "period"} for this Critical Illness cover is ${opts.premium.currency} ${opts.premium.amount}.`] : ["No premium amount is stated on this certificate."]),
    "Effective Date 2025-01-01." + (expiry ? ` This certificate will expire on ${expiry}; the expiry date is when cover ends unless renewed.` : " No expiry date is stated on this certificate."),
    ...waiting,
    ...exclusions,
    `Documents needed to make a claim on the Critical Illness Benefit: the claim form, this certificate ${opts.policyNumber} and the medical report.`,
  ];
  // The extraction control block gets a page of its own: the extractor's
  // evidence sample keeps at most ~2,200 characters per page, and the block
  // must arrive intact (a truncated payload is deliberately treated as no
  // payload at all, never partially parsed).
  return textPdf([page1, extractionLines(payload)]);
}

/** A generic policy-wording booklet (never personal proof): the wording /
 * terms-and-conditions phrasing classifies deterministically as a reference
 * document, with no model call at all. */
export async function wordingPdf(label: string): Promise<Buffer> {
  const product = `${PREFIX}-${label}`;
  return textPdf([
    [`${product} Policy Wording`, "Terms and Conditions", "SYNTHETIC TEST DOCUMENT - NOT A REAL INSURANCE POLICY", "Insurer: Synthetic Test Insurer (fictitious)"],
    ["Section 1 - Critical Illness Benefit", "We will pay 100% of the Sum Insured upon diagnosis of a covered critical illness.", "Section 2 - Waiting period", "A waiting period of 90 days applies to the Critical Illness Benefit from the cover start date.", `Reference: ${product}`],
  ]);
}

/** A small synthetic photo "page" (light background, dark bars standing in
 * for text lines) in the requested raster format. */
export async function imageBytes(format: "jpeg" | "png" | "webp" | "tiff", width = 900, height = 1200): Promise<Buffer> {
  const bars = Array.from({ length: 14 }, (_, i) =>
    `<rect x="60" y="${90 + i * 70}" width="${width - 120 - (i % 3) * 90}" height="26" fill="#333"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f4f1ea"/>${bars}</svg>`;
  const base = sharp(Buffer.from(svg));
  if (format === "jpeg") return base.jpeg({ quality: 80 }).toBuffer();
  if (format === "png") return base.png().toBuffer();
  if (format === "webp") return base.webp({ quality: 80 }).toBuffer();
  return base.tiff().toBuffer();
}

/** An image-only ("scanned") PDF: one embedded photo per page and no text
 * layer at all, so every page needs OCR. */
export async function scannedPdf(pages = 2): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const png = await imageBytes("png", 620, 870);
    const embedded = await doc.embedPng(png);
    const page = doc.addPage([595, 842]);
    page.drawImage(embedded, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await doc.save());
}

/** A minimal real .docx (a ZIP with word/document.xml), parseable by mammoth
 * without executing anything. Wording-style text so it classifies as a
 * reference document. */
export async function docxBytes(label: string): Promise<Buffer> {
  const product = `${PREFIX}-${label}`;
  const paragraphs = [
    `${product} Policy Wording`,
    "Terms and Conditions",
    "SYNTHETIC TEST DOCUMENT - NOT A REAL INSURANCE POLICY.",
    "Section 1 - Critical Illness Benefit: We will pay 100% of the Sum Insured upon diagnosis of a covered critical illness.",
    "Section 2 - Waiting period: A waiting period of 90 days applies to the Critical Illness Benefit from the cover start date.",
    `Reference: ${product}.`,
  ];
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** PNG magic followed by garbage: passes the signature sniff, fails decode. */
export function corruptedPng(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("this is not a real png body ".repeat(40))]);
}

/** A tiny GIF: a real format DearPolicy deliberately does not accept. */
export function gifBytes(): Buffer {
  return Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64, 0)]);
}

/** An MZ (Windows executable) header behind a document name. */
export function exeBytes(): Buffer {
  return Buffer.concat([Buffer.from("MZ"), Buffer.alloc(128, 0)]);
}

/** A real (empty-ish) ZIP that is NOT a .docx -- an archive upload. */
export async function zipBytes(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("readme.txt", "synthetic archive, not a document");
  return zip.generateAsync({ type: "nodebuffer" });
}

/** Minimal HEIC-flavoured bytes (an ISO-BMFF ftyp box declaring heic). */
export function heicBytes(): Buffer {
  const box = Buffer.alloc(24, 0);
  box.writeUInt32BE(24, 0);
  box.write("ftyp", 4);
  box.write("heic", 8);
  box.writeUInt32BE(0, 12);
  box.write("heic", 16);
  box.write("mif1", 20);
  return Buffer.concat([box, Buffer.alloc(64, 0)]);
}

/** Just over the 50MB policy-upload limit, with a real PDF magic header. */
export function oversizedPdf(): Buffer {
  const bytes = Buffer.alloc(50 * 1024 * 1024 + 1024, 0x20);
  bytes.write("%PDF-1.4\n", 0, "latin1");
  return bytes;
}

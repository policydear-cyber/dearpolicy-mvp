/**
 * V1 core-loop certification fixtures (ingestion/extraction).
 *
 * Generates, at runtime, clearly synthetic insurance documents for the
 * upload -> read -> extract -> cite -> link -> chat journey. Nothing here is a
 * real policy, insurer or person: every page says "SYNTHETIC TEST DOCUMENT -
 * NOT A REAL POLICY", the insurer is fictitious, and every product name and
 * policy number carries this run's SYNTHETIC-DPTEST-<run id> prefix. The two
 * household-A family members' DISPLAY names are "Josephine" and "Marcus" (so
 * the chat questions work); the documents print a two-word insured name
 * ("Josephine Dptest<tag>") because DearPolicy's person-name sanitizer
 * (lib/documents/intelligence.ts looksLikeActualPersonName) rejects a single
 * word, exactly as a real certificate prints a full name.
 *
 * Text formats (PDF, DOCX) carry the DPTEST-EXTRACTION control block that the
 * deterministic model stand-in (lib/ai/deterministic-model.ts) decodes in
 * place of the production reading model. Raster formats (JPEG/PNG/WebP/TIFF)
 * render the real schedule text as pixels, but NOTE: under the stand-in the
 * hosted-OCR step does not read pixels -- it returns a fixed "Scanned Care"
 * wording transcript -- so for images only the plumbing is testable locally.
 *
 * API: generateV1Fixtures({ include }) -> V1Fixture[] with the upload bytes,
 * MIME type, target household/member and the expected stored facts.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import JSZip from "jszip";
import { PREFIX, RUN_ID } from "./synthetic";

export const SYNTHETIC_BANNER = "SYNTHETIC TEST DOCUMENT - NOT A REAL POLICY";
export const INSURER = "Synthetic Test Assurance (fictitious)";
const RUN_TAG = RUN_ID.replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "x");
/** The name PRINTED on a document (two words, run-tagged). */
export const printedName = (displayName: string) => `${displayName} Dptest${RUN_TAG}`;

export type V1Format = "pdf" | "docx" | "jpeg" | "png" | "webp" | "tiff";
export type ExpectedBenefit = {
  name: string;
  /** Money amount printed, or the fraction of sum insured for a %-row (1 = 100%). */
  amount: number;
  /** ISO code of the currency PRINTED next to the amount; null for a %-of-sum-insured row. */
  currency: string | null;
  /** Printed page number (1-based) the row appears on. */
  page: number;
  formulaKind: "fixed" | "expense_cap" | "daily" | "sum_insured";
  /** The printed value cell, verbatim. */
  printed: string;
};
export type V1Fixture = {
  key: string;
  name: string;
  mimeType: string;
  format: V1Format;
  buffer: Buffer;
  /** Household-A display name, or the household-B member's display name. */
  member: "Josephine" | "Marcus";
  household: "A" | "B";
  /** primary = the one copy of each policy to upload for the chat journey;
   * format-variant = the same policy in another format (upload to a scratch
   * member/household, or it double-counts in chat). */
  role: "primary" | "format-variant";
  expected: {
    insurer: string;
    insured: string;
    policyNumber: string;
    productName: string;
    policyType: string;
    documentRole: "personal_schedule";
    sumInsured: { amount: number; currency: string } | null;
    benefits: ExpectedBenefit[];
    /** Benefits the document deliberately does NOT have (must never be answered as covered). */
    absent: string[];
    /** What the local deterministic stand-in can prove for this format. */
    standIn: "full" | "plumbing-only";
  };
};

type Row = [label: string, value: string];
type Spec = {
  key: string;
  household: "A" | "B";
  member: "Josephine" | "Marcus";
  label: string;
  policyType: string;
  category: string;
  sumInsured: { amount: number; currency: string; printed: string } | null;
  schedule: { heading: string; rows: Row[]; prose?: string[] }[];
  benefits: Omit<ExpectedBenefit, "page">[];
  absent: string[];
};

const SPECS: Spec[] = [
  {
    key: "hospital", household: "A", member: "Josephine", label: "HospitalShield", policyType: "Hospitalisation", category: "Hospitalisation",
    sumInsured: { amount: 1000000, currency: "SGD", printed: "S$1,000,000" },
    schedule: [{ heading: "Schedule of Benefits - Hospital and Surgical", rows: [
      ["Daily room and board (1-bed private ward)", "S$800 per day, maximum 120 days"],
      ["Intensive care unit", "S$1,500 per day, maximum 30 days"],
      ["Surgical fees", "Up to S$25,000 per surgery"],
      ["Pre-hospitalisation treatment", "Up to S$3,000 per admission"],
    ] }],
    benefits: [
      { name: "Daily room and board (1-bed private ward)", amount: 800, currency: "SGD", formulaKind: "daily", printed: "S$800 per day, maximum 120 days" },
      { name: "Intensive care unit", amount: 1500, currency: "SGD", formulaKind: "daily", printed: "S$1,500 per day, maximum 30 days" },
      { name: "Surgical fees", amount: 25000, currency: "SGD", formulaKind: "expense_cap", printed: "Up to S$25,000 per surgery" },
      { name: "Pre-hospitalisation treatment", amount: 3000, currency: "SGD", formulaKind: "expense_cap", printed: "Up to S$3,000 per admission" },
    ],
    absent: ["Fracture", "Maturity benefit"],
  },
  {
    key: "accident", household: "A", member: "Josephine", label: "AccidentGuard", policyType: "Personal Accident", category: "Personal Accident",
    sumInsured: { amount: 100000, currency: "SGD", printed: "S$100,000" },
    schedule: [{ heading: "Schedule of Benefits - Accident", rows: [
      ["Fracture of arm", "S$1,000"],
      ["Fracture of leg", "S$1,500"],
      ["Accident medical reimbursement", "Up to S$2,000 per accident"],
      ["Accidental death", "100% of Sum Insured"],
    ] }],
    benefits: [
      { name: "Fracture of arm", amount: 1000, currency: "SGD", formulaKind: "fixed", printed: "S$1,000" },
      { name: "Fracture of leg", amount: 1500, currency: "SGD", formulaKind: "fixed", printed: "S$1,500" },
      { name: "Accident medical reimbursement", amount: 2000, currency: "SGD", formulaKind: "expense_cap", printed: "Up to S$2,000 per accident" },
      { name: "Accidental death", amount: 1, currency: null, formulaKind: "sum_insured", printed: "100% of Sum Insured" },
    ],
    absent: ["Loss of arm"],
  },
  {
    key: "disability", household: "A", member: "Josephine", label: "DisabilityCare", policyType: "Permanent Disability", category: "Total Permanent Disability",
    sumInsured: { amount: 200000, currency: "SGD", printed: "S$200,000" },
    schedule: [{ heading: "Schedule of Permanent Disablement (% of Sum Insured)", rows: [
      ["Loss of arm at or above the elbow", "100% of Sum Insured"],
      ["Loss of hand at or above the wrist", "75% of Sum Insured"],
      ["Loss of thumb", "25% of Sum Insured"],
    ] }],
    benefits: [
      { name: "Loss of arm at or above the elbow", amount: 1, currency: null, formulaKind: "sum_insured", printed: "100% of Sum Insured" },
      { name: "Loss of hand at or above the wrist", amount: 0.75, currency: null, formulaKind: "sum_insured", printed: "75% of Sum Insured" },
      { name: "Loss of thumb", amount: 0.25, currency: null, formulaKind: "sum_insured", printed: "25% of Sum Insured" },
    ],
    absent: ["Fracture"],
  },
  {
    key: "travel", household: "A", member: "Marcus", label: "WanderSafe", policyType: "Travel", category: "Travel",
    sumInsured: null,
    schedule: [{ heading: "Schedule of Benefits - Travel", rows: [
      ["Overseas medical expenses", "US$250,000"],
      ["Emergency medical evacuation", "USD 500,000"],
      ["Trip cancellation", "S$5,000"],
      ["Baggage delay", "S$200 for every 6 hours"],
    ] }],
    benefits: [
      { name: "Overseas medical expenses", amount: 250000, currency: "USD", formulaKind: "fixed", printed: "US$250,000" },
      { name: "Emergency medical evacuation", amount: 500000, currency: "USD", formulaKind: "fixed", printed: "USD 500,000" },
      { name: "Trip cancellation", amount: 5000, currency: "SGD", formulaKind: "fixed", printed: "S$5,000" },
      { name: "Baggage delay", amount: 200, currency: "SGD", formulaKind: "fixed", printed: "S$200 for every 6 hours" },
    ],
    absent: ["Fracture", "Hospital room and board in Singapore"],
  },
  {
    key: "endowment", household: "A", member: "Marcus", label: "FutureSaver", policyType: "Endowment", category: "Savings",
    sumInsured: { amount: 50000, currency: "SGD", printed: "S$50,000" },
    schedule: [{ heading: "Schedule of Benefits - Endowment", rows: [
      ["Guaranteed maturity benefit", "S$50,000"],
      ["Death benefit", "100% of Sum Insured"],
    ], prose: ["This plan provides no medical, hospitalisation or accident benefits."] }],
    benefits: [
      { name: "Guaranteed maturity benefit", amount: 50000, currency: "SGD", formulaKind: "fixed", printed: "S$50,000" },
      { name: "Death benefit", amount: 1, currency: null, formulaKind: "sum_insured", printed: "100% of Sum Insured" },
    ],
    absent: ["Hospitalisation", "Fracture", "Medical expenses"],
  },
  {
    key: "isolation-b", household: "B", member: "Josephine", label: "OtherHouseholdPA", policyType: "Personal Accident", category: "Personal Accident",
    sumInsured: { amount: 80000, currency: "SGD", printed: "S$80,000" },
    schedule: [{ heading: "Schedule of Benefits - Accident", rows: [
      ["Fracture of arm", "S$3,500"],
      ["Accident medical reimbursement", "Up to S$9,000 per accident"],
    ] }],
    benefits: [
      { name: "Fracture of arm", amount: 3500, currency: "SGD", formulaKind: "fixed", printed: "S$3,500" },
      { name: "Accident medical reimbursement", amount: 9000, currency: "SGD", formulaKind: "expense_cap", printed: "Up to S$9,000 per accident" },
    ],
    absent: [],
  },
];

/** Which formats each policy is ALSO produced in (role format-variant). */
const VARIANTS: Record<string, V1Format[]> = {
  hospital: ["png"],
  accident: ["docx", "jpeg"],
  disability: ["webp"],
  travel: ["docx"],
  endowment: ["tiff"],
};

const MIME: Record<V1Format, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg", png: "image/png", webp: "image/webp", tiff: "image/tiff",
};
const EXT: Record<V1Format, string> = { pdf: "pdf", docx: "docx", jpeg: "jpg", png: "png", webp: "webp", tiff: "tif" };

function identity(spec: Spec) {
  const householdTag = spec.household === "B" ? "HB-" : "";
  return {
    product: `${PREFIX}-${spec.label}`,
    policyNumber: `${PREFIX}-${householdTag}${spec.key.toUpperCase().replace(/[^A-Z]/g, "")}-001`,
    insured: printedName(spec.member),
  };
}

/** Printed pages as label/value lines. Page 1 particulars, page 2 schedule. */
function pagesFor(spec: Spec): { lines: (string | Row)[] }[] {
  const id = identity(spec);
  const evidence = spec.sumInsured
    ? `${spec.category} cover with a Sum Insured of ${spec.sumInsured.printed} for ${id.insured}.`
    : `${spec.category} cover for ${id.insured} as set out in the Schedule of Benefits on page 2.`;
  const page1: (string | Row)[] = [
    `${id.product} Policy Schedule`,
    SYNTHETIC_BANNER,
    `Issued by ${INSURER}`,
    ["Policy number", id.policyNumber],
    ["Insured person", id.insured],
    ["Policy type", spec.policyType],
    ["Effective date", "2025-01-01"],
    ["Expiry date", "2027-01-01"],
    evidence,
  ];
  const page2: (string | Row)[] = [];
  for (const block of spec.schedule) {
    page2.push(block.heading);
    for (const row of block.rows) page2.push(row);
    for (const line of block.prose ?? []) page2.push(line);
  }
  page2.push(SYNTHETIC_BANNER);
  return [{ lines: page1 }, { lines: page2 }];
}

function extractionPayload(spec: Spec) {
  const id = identity(spec);
  const evidence = spec.sumInsured
    ? `${spec.category} cover with a Sum Insured of ${spec.sumInsured.printed} for ${id.insured}.`
    : `${spec.category} cover for ${id.insured} as set out in the Schedule of Benefits on page 2.`;
  return {
    documentType: "Policy Schedule", documentRole: "personal_schedule", documentNotes: [],
    insurer: INSURER, productName: id.product, productsMentioned: [], policyNumber: id.policyNumber,
    groupPolicyNumber: null, policyType: spec.policyType, policyholder: null, personalCoverageConfirmed: true,
    startDate: "2025-01-01", renewalOrExpiryDate: "2027-01-01",
    insuredPeople: [{ name: id.insured, relationshipHint: null, coverages: [{
      category: spec.category, productName: id.product, policyNumber: null,
      amount: spec.sumInsured?.amount ?? null, currency: spec.sumInsured?.currency ?? null,
      notes: null, sourcePage: 1, evidenceText: evidence, evidenceVerified: false }] }],
    referenceCoverages: [], premium: { amount: null, currency: null, frequency: null }, paymentRecords: [],
    keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
  };
}
function extractionLines(payload: unknown) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  if (encoded.length > 2000) throw new Error(`v1-fixtures: extraction payload too large (${encoded.length}); the extractor samples ~2,200 chars per page`);
  return ["DPTEST-EXTRACTION:", ...(encoded.match(/.{1,80}/g) ?? []), ":DPTEST-END"];
}

async function renderPdf(spec: Spec): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const printed = pagesFor(spec);
  const total = printed.length + 1;
  const draw = (lines: (string | Row)[], pageNumber: number) => {
    const page = doc.addPage([595, 842]);
    lines.forEach((line, i) => {
      const y = 790 - i * 20;
      if (typeof line === "string") page.drawText(line, { x: 48, y, size: 10, font });
      else { page.drawText(line[0], { x: 48, y, size: 10, font }); page.drawText(line[1], { x: 330, y, size: 10, font }); }
    });
    page.drawText(`Page ${pageNumber} of ${total}`, { x: 260, y: 30, size: 8, font });
  };
  printed.forEach((p, i) => draw(p.lines, i + 1));
  // Control page for the local stand-in only (production ignores it: a real
  // model reads the particulars and schedule pages).
  draw(["Synthetic extraction control block (test harness only)", ...extractionLines(extractionPayload(spec))], total);
  return Buffer.from(await doc.save());
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function renderDocx(spec: Spec): Promise<Buffer> {
  const para = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${xml(t)}</w:t></w:r></w:p>`;
  const cell = (t: string) => `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${para(t)}</w:tc>`;
  const pageBreak = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  const body: string[] = [];
  pagesFor(spec).forEach((page, index) => {
    if (index) body.push(pageBreak);
    let table: string[] = [];
    const flush = () => { if (table.length) body.push(`<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>${table.join("")}</w:tbl>`); table = []; };
    for (const line of page.lines) {
      if (typeof line === "string") { flush(); body.push(para(line)); } else table.push(`<w:tr>${cell(line[0])}${cell(line[1])}</w:tr>`);
    }
    flush();
    body.push(para(`Page ${index + 1}`));
  });
  body.push(pageBreak, para("Synthetic extraction control block (test harness only)"), ...extractionLines(extractionPayload(spec)).map(para));
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** One printed page as a raster "photo" with the real text drawn on it. */
async function pageSvg(lines: (string | Row)[], pageNumber: number, total: number) {
  const W = 1240, H = 1754;
  const text = lines.map((line, i) => {
    const y = 140 + i * 56;
    return typeof line === "string"
      ? `<text x="90" y="${y}">${xml(line)}</text>`
      : `<text x="90" y="${y}">${xml(line[0])}</text><text x="700" y="${y}">${xml(line[1])}</text>`;
  }).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fbfaf6"/><g font-family="DejaVu Sans, sans-serif" font-size="28" fill="#111">${text}<text x="560" y="${H - 60}" font-size="22">Page ${pageNumber} of ${total}</text></g></svg>`);
}
async function renderImage(spec: Spec, format: Exclude<V1Format, "pdf" | "docx">): Promise<Buffer> {
  const printed = pagesFor(spec);
  if (format === "tiff") {
    // Multi-page TIFF: one frame per printed page.
    const frames = await Promise.all(printed.map(async (p, i) => sharp(await pageSvg(p.lines, i + 1, printed.length)).png().toBuffer()));
    return sharp(frames, { join: { animated: true } }).tiff({ compression: "lzw" }).toBuffer();
  }
  // Single-image formats: one photo of the schedule page (page 2) with the
  // particulars block on top, as a person photographing one page would.
  const lines = [...printed[0].lines, "", ...printed[1].lines];
  const base = sharp(await pageSvg(lines, 1, 1));
  if (format === "jpeg") return base.jpeg({ quality: 85 }).toBuffer();
  if (format === "png") return base.png().toBuffer();
  return base.webp({ quality: 85 }).toBuffer();
}

function expectedFor(spec: Spec, format: V1Format): V1Fixture["expected"] {
  const id = identity(spec);
  const imageSingle = format === "jpeg" || format === "png" || format === "webp";
  return {
    insurer: INSURER, insured: id.insured, policyNumber: id.policyNumber, productName: id.product,
    policyType: spec.policyType, documentRole: "personal_schedule",
    sumInsured: spec.sumInsured ? { amount: spec.sumInsured.amount, currency: spec.sumInsured.currency } : null,
    // Schedule rows are on printed page 2 (page 1 for single-photo images).
    benefits: spec.benefits.map((b) => ({ ...b, page: imageSingle ? 1 : 2 })),
    absent: spec.absent,
    standIn: format === "pdf" || format === "docx" ? "full" : "plumbing-only",
  };
}

export async function generateV1Fixtures(opts: { include?: "primary" | "all"; only?: string[] } = {}): Promise<V1Fixture[]> {
  const out: V1Fixture[] = [];
  for (const spec of SPECS) {
    const formats: V1Format[] = ["pdf", ...(opts.include === "primary" ? [] : VARIANTS[spec.key] ?? [])];
    for (const format of formats) {
      const key = `${spec.key}-${format}`;
      if (opts.only && !opts.only.includes(key)) continue;
      const buffer = format === "pdf" ? await renderPdf(spec)
        : format === "docx" ? await renderDocx(spec)
        : await renderImage(spec, format);
      out.push({
        key, format, buffer, mimeType: MIME[format],
        name: `${PREFIX}-${spec.label}${spec.household === "B" ? "-HB" : ""}${format === "pdf" ? "" : "-" + format}.${EXT[format]}`,
        member: spec.member, household: spec.household,
        role: format === "pdf" ? "primary" : "format-variant",
        expected: expectedFor(spec, format),
      });
    }
  }
  return out;
}

/** CLI: `node --import tsx e2e/support/v1-fixtures.ts <outDir>` writes the
 * files plus manifest.json (expected facts, no bytes). */
if (process.argv[1] && /v1-fixtures\.ts$/.test(process.argv[1]) && process.argv[2]) {
  (async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = process.argv[2];
    await mkdir(dir, { recursive: true });
    const fixtures = await generateV1Fixtures({ include: "all" });
    for (const f of fixtures) await writeFile(path.join(dir, f.name), f.buffer);
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(fixtures.map(({ buffer, ...rest }) => ({ ...rest, bytes: buffer.length })), null, 2));
    console.log(`wrote ${fixtures.length} fixtures to ${dir}`);
  })().catch((e) => { console.error(e); process.exit(1); });
}

/** Password-protected PDFs (10 Nov: a certificate of insurance refused to read with its correct password). A locked PDF
 * keeps its document properties encrypted; the title was read without decrypting, so it came out as random characters,
 * often with a NUL the database refuses ("invalid byte sequence for encoding UTF8: 0x00"), and the upload failed.
 * The fixtures are made-up one-page certificates locked with RC4-128, AES-128 and AES-256 (password "Harbour-2026").
 * A page whose font maps a glyph to no character (NUL) is not read from its text either: dropping the NUL would make
 * another amount (Critic #400). Pure logic. No database, no network, no model.
 *   npm run -s documents:locked-pdf-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const PASSWORD = "Harbour-2026", TITLE = "Certificate of Insurance - Harbour Travel";
const CONTROL = /[\u0000-\u001f\u007f-\u009f�]/;
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

/** A one-page PDF whose font maps one character code to the given Unicode value in its ToUnicode map (Critic #400 probe):
 * "0000" makes that glyph a NUL, a character with no meaning. */
function unmappedGlyphPdf(target: string, text: string, hit: string): Uint8Array {
  const code = (parseInt(hit, 16) - 1).toString(16).toUpperCase(), next = (parseInt(hit, 16) + 1).toString(16).toUpperCase();
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def
1 begincodespacerange <00> <FF> endcodespacerange
2 beginbfrange <20> <${code}> <0020> <${next}> <7E> <00${next}> endbfrange
1 beginbfchar <${hit}> <${target}> endbfchar
endcmap CMapName currentdict /CMap defineresource pop end end`;
  const content = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objs = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`];
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

async function main() {
  const { pdfDocumentTitle, extractPdfPages } = await import("@/lib/documents/pdf");
  const { PDF_PASSWORD_REQUIRED_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE } = await import("@/lib/documents/processing-errors");
  for (const name of ["locked-rc4-128.pdf", "locked-aes-128.pdf", "locked-aes-256.pdf"]) {
    await test(`${name}: with its password the title is the document's own, and the page text reads`, async () => {
      assert.equal(await pdfDocumentTitle(fixture(name), PASSWORD), TITLE);
      const [page] = await extractPdfPages(fixture(name), PASSWORD);
      assert.match(page.text, /Sum Insured S\$ 50,000\.00/);
      assert.ok(!page.text.includes("\u0000"));
    });
    await test(`${name}: without the password, or with a wrong one, no title is made up from the encrypted bytes`, async () => {
      for (const pw of [undefined, "wrong"]) {
        const title = await pdfDocumentTitle(fixture(name), pw).catch(() => null);
        assert.ok(title === null || (title === TITLE), `got ${JSON.stringify(title)}`);
        assert.ok(!CONTROL.test(String(title ?? "")));
      }
    });
    await test(`${name}: a missing or wrong password still says so`, async () => {
      await assert.rejects(extractPdfPages(fixture(name)), (e: Error) => e.message === PDF_PASSWORD_REQUIRED_MESSAGE);
      await assert.rejects(extractPdfPages(fixture(name), "wrong"), (e: Error) => e.message === PDF_PASSWORD_INCORRECT_MESSAGE);
    });
  }
  await test("an unlocked PDF's title is read as before", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create(); doc.addPage(); doc.setTitle("Harbour Travel Policy Wording");
    assert.equal(await pdfDocumentTitle(await doc.save()), "Harbour Travel Policy Wording");
  });
  await test("a title holding a control character is never a title", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create(); doc.addPage(); doc.setTitle("Harbour\u0000Travel Policy");
    assert.equal(await pdfDocumentTitle(await doc.save()), null);
  });

  await test("a page whose font maps a digit to nothing is never read as another amount: its text is not used, and it goes to the image reader (Critic #400)", async () => {
    const { pagesNeedingOcr } = await import("@/lib/documents/ocr");
    for (const [hit, text] of [["30", "Sum Insured S$ 50,000.00 per year"], ["35", "Death Benefit S$ 150,000 and Hospital S$ 500 per day"]]) {
      const pages = await extractPdfPages(unmappedGlyphPdf("0000", text, hit));
      assert.equal(pages[0].text, "", `no figure of the page is used: ${JSON.stringify(pages[0].text)}`);
      assert.equal(pages[0].unmappedText, true);
      assert.deepEqual(pagesNeedingOcr(pages), [1]);
    }
    // The same font mapping its digits properly reads as before.
    const [plain] = await extractPdfPages(unmappedGlyphPdf("0030", "Sum Insured S$ 50,000.00 per year", "30"));
    assert.match(plain.text, /50,000\.00/);
    assert.ok(!plain.unmappedText);
  });

  // A locked scan sent to an OCR reader (Baidu or the hosted AI): pdf-lib copies the page's image still encrypted with the
  // source file's key, so the reader got noise. The page is rebuilt from the image PDF.js decodes, drawn with the same
  // matrix and /Rotate, so it shows exactly what the plain file shows. Made-up 64x48 gradient, placed off-centre, turned 90.
  const { subsetPdf } = await import("@/lib/documents/ocr-hosted");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  async function painted(bytes: Uint8Array) {
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false } as Parameters<typeof pdfjs.getDocument>[0]);
    const doc = await task.promise;
    try {
      const page = await doc.getPage(1);
      const ops = await page.getOperatorList();
      const at = ops.fnArray.indexOf(pdfjs.OPS.paintImageXObject);
      assert.ok(at >= 0, "the page paints an image");
      let m = [1, 0, 0, 1, 0, 0];
      for (let i = 0; i < at; i++) if (ops.fnArray[i] === pdfjs.OPS.transform) {
        const n = ops.argsArray[i] as number[];
        m = [n[0] * m[0] + n[1] * m[2], n[0] * m[1] + n[1] * m[3], n[2] * m[0] + n[3] * m[2], n[2] * m[1] + n[3] * m[3], n[4] * m[0] + n[5] * m[2] + m[4], n[4] * m[1] + n[5] * m[3] + m[5]];
      }
      const img = await new Promise<{ width: number; height: number; data: Uint8ClampedArray }>((r) => page.objs.get(String(ops.argsArray[at][0]), r as (v: unknown) => void));
      return { rotate: page.rotate, view: page.view, matrix: m.map((v) => Math.round(v * 1000) / 1000), width: img.width, height: img.height,
        rgb: Buffer.from(img.data.filter((_, i) => img.data.length === img.width * img.height * 3 || i % 4 !== 3)).toString("base64") };
    } finally { await task.destroy(); }
  }
  const plainScan = await painted(await subsetPdf(fixture("scan-plain.pdf"), [1]));
  await test("a plain scan's subset is unchanged (the baseline)", () => {
    assert.equal(plainScan.rotate, 90); assert.deepEqual(plainScan.matrix, [240, 0, 0, 180, 30, 110]); assert.equal(plainScan.width, 64);
  });
  await test("a locked scan (AES-256, with its password) is sent as the plain one shows", async () => {
    assert.deepEqual(await painted(await subsetPdf(fixture("scan-locked-aes256.pdf"), [1], undefined, PASSWORD)), plainScan);
  });
  await test("an owner-only lock (no password to open) is sent as the plain one shows", async () => {
    assert.deepEqual(await painted(await subsetPdf(fixture("scan-owner-only.pdf"), [1])), plainScan);
  });
  await test("a locked scan turned for a second read turns like the plain one", async () => {
    const turn = new Map([[1, 90]]);
    const plain = await painted(await subsetPdf(fixture("scan-plain.pdf"), [1], turn));
    assert.equal(plain.rotate, 180);
    assert.deepEqual(await painted(await subsetPdf(fixture("scan-locked-aes256.pdf"), [1], turn, PASSWORD)), plain);
  });
  await test("a locked scan with no password is copied as before (never fails the read)", async () => {
    const out = await subsetPdf(fixture("scan-locked-aes256.pdf"), [1]);
    assert.ok(out.length > 0);
  });

  console.log(`locked-pdf: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

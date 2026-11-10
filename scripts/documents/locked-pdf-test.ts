/** Password-protected PDFs (10 Nov: a certificate of insurance refused to read with its correct password). A locked PDF
 * keeps its document properties encrypted; the title was read without decrypting, so it came out as random characters,
 * often with a NUL the database refuses ("invalid byte sequence for encoding UTF8: 0x00"), and the upload failed.
 * The fixtures are made-up one-page certificates locked with RC4-128, AES-128 and AES-256 (password "Harbour-2026").
 * Pure logic. No database, no network, no model.
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

  console.log(`locked-pdf: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

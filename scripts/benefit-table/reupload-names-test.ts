/** Re-upload check, 10 Nov: a document whose PDF title is a system code ("XXGRP_COI_APP") was named by that code on
 * Coverage and in chat, and a benefit printed with "&" was dropped because the reader copied the page's markup escape
 * ("Death&amp;Dismemberment") and its quote no longer matched the page. Made-up documents; no model, database or network.
 *   npm run benefit-table:reupload-names-test */
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { documentName, isCodeName } from "@/lib/policies/document-name";
import { pdfDocumentTitle } from "@/lib/documents/pdf";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function main() {
  await test("a system code is not a name; a product name a person reads is", () => {
    for (const code of ["XXGRP_COI_APP", "POL_SCHED_V2", "cert_2026_final"]) assert.equal(isCodeName(code), true, code);
    for (const name of ["Harbour Term Life", "Shield_Plus Gold Plan", "Kestrel-Care", "CareShield", "Plan A"]) assert.equal(isCodeName(name), false, name);
  });
  await test("a document whose stored product is a code is named as if it had none (its kind and insurer)", () => {
    const named = documentName({ product_name: "XXGRP_COI_APP", original_filename: "0a1b2c3d-1111-4222-8333-444455556666.pdf", insurer: "Example Mutual", document_role: "certificate", policy_number: null });
    assert.doesNotMatch(named, /_/);
    assert.match(named, /Example Mutual/);
    assert.equal(documentName({ product_name: "Harbour Term Life", original_filename: "x.pdf" }), "Harbour Term Life");
  });
  await test("a PDF whose own title is a code gives no title; a readable title is kept", async () => {
    const make = async (title: string) => { const d = await PDFDocument.create(); d.addPage(); d.setTitle(title); return d.save(); };
    assert.equal(await pdfDocumentTitle(await make("XXGRP_COI_APP")), null);
    assert.equal(await pdfDocumentTitle(await make("Certificate of Insurance")), "Certificate of Insurance");
  });
  await test("a reading that copies the page's markup escapes is read as the page prints it, and its rows are kept", () => {
    const doc: SourceDoc = { id: "ffffffff-0000-4000-8000-000000000001", name: "Group schedule.pdf", readable: true,
      pages: [{ page: 2, text: "SCHEDULE OF BENEFITS\nAccidental Death & Dismemberment\tS$100,000\nMedical Expenses (<24h stay)\tS$2,000" }] };
    const raw = { document: { kind: "personal_proof", product: "Example Group Accident", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers: [],
      benefits: [
        { section: "Schedule of Benefits", column: null, benefit: "Accidental Death &amp; Dismemberment", pays: "amount", value: 100000, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, quote: "Accidental Death &amp; Dismemberment\tS$100,000" },
        { section: "Schedule of Benefits", column: null, benefit: "Medical Expenses (&lt;24h stay)", pays: "amount", value: 2000, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, quote: "Medical Expenses (&lt;24h stay)\tS$2,000" },
      ] };
    const r = checkReading(doc, raw);
    assert.deepEqual(r.benefits.map((b) => b.benefit), ["Accidental Death & Dismemberment", "Medical Expenses (<24h stay)"]);
    assert.ok(r.benefits.every((b) => !/&amp;|&lt;/.test(b.source.excerpt)));
  });
  console.log(`benefit-table re-upload names: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

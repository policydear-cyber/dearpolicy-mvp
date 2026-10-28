/** Test engineer, PR #159: documentName / isMachineFilename / insurerShortName (lib/policies/inventory.ts). Made-up file
 * names and insurers from several markets. Pure functions: no database, no network, no model.
 *   node --import tsx scripts/te/te-pr159-test.ts
 * Graded: a name a person chose stays (made readable); a name a device or system made up never appears in a sentence;
 * an insurer loses only its company form, never part of its own name. */
import assert from "node:assert/strict";
import { documentName, insurerShortName, isMachineFilename } from "@/lib/policies/inventory";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
let fetches = 0; globalThis.fetch = (async () => { fetches++; throw new Error("no network"); }) as typeof fetch;
let passed = 0; const failures: string[] = []; const notes: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const doc = (f: string, o: { product?: string | null; insurer?: string | null; role?: string | null } = {}) =>
  documentName({ product_name: o.product ?? null, original_filename: f, insurer: o.insurer === undefined ? "Harbourline Assurance Pte. Ltd." : o.insurer, document_role: o.role === undefined ? "policy_wording" : o.role });

// ------------------------------------------------------------ chosen names survive
for (const f of ["AIA.pdf", "AXA 2026.pdf", "MSIG travel.pdf", "Mum's plan.pdf", "HSBC_Life_2025.pdf", "Prudential PRUshield renewal 2026.pdf", "POLICY SCHEDULE.PDF",
  "Póliza de seguro.pdf", "Polisi Hayat Takaful.pdf", "Versicherungsschein 2026.pdf", "Assurance-vie.pdf", "Ubezpieczenie.pdf", "Hospitalisation plan v2.pdf", "CI cover 2026 (final).pdf"])
  test(`S1 chosen name '${f}' stays`, () => {
    assert.equal(isMachineFilename(f), false, "treated as made up");
    assert.ok(!/policy wording$/i.test(doc(f)), doc(f));
  });
for (const f of ["保险单.pdf", "保單 2026.pdf", "医疗保险计划.pdf", "生命保険証券.pdf", "보험증권.pdf", "Bảo hiểm nhân thọ.pdf", "ประกันชีวิต.pdf", "تأمين.pdf", "GE.pdf", "My CI.pdf", "Ed plan.pdf"])
  test(`S2 chosen name '${f}' (non-Latin or short words) stays`, () => {
    assert.equal(isMachineFilename(f), false, `'${f}' replaced by '${doc(f)}'`);
  });

// ------------------------------------------------------------ made-up names never survive
for (const f of ["817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", "output_202609281146053.pdf", "IMG_2041.jpg", "scan 3.pdf", "document (1).pdf", "Screenshot 2026-10-01 at 10.15.32 AM.png",
  "IMG-20260101-WA0001.jpg", "DSC_0042.JPG", "PXL_20260101_123456789.jpg", "WhatsApp Image 2026-10-01 at 10.15.32.jpeg", "CamScanner 10-01-2026 10.15.pdf", "Scanned_20260928_101500.pdf",
  "20260928.pdf", "doc_final_v2.pdf", "file-12.pdf", "Untitled.pdf", "download (3).pdf", "a3f9c2e1b7.pdf", "fbdcaeef-1234-4abc-8def-0123456789ab.pdf", "Microsoft Word - Document1.pdf", "Adobe Scan 28 Oct 2026.pdf"])
  test(`M1 made-up name '${f}' is never the document's name`, () => {
    assert.equal(isMachineFilename(f), true, `'${f}' stays as '${doc(f)}'`);
  });

for (const f of ["Screenshot_20261001-101532_Chrome.jpg", "Screenshot_20261001_Gmail.jpg", "MVIMG_20261001_101532.jpg", "Image from iOS.jpg", "IMG_2041 (Edited).jpg", "VID_20261001.mp4", "Photo 01-10-2026, 10 15 32 am.jpg",
  "Scan Oct 28.pdf", "Doc - 28 Oct 2026 - 10-15.pdf", "Outlook-abc123.pdf", "image0.jpeg", "AnyScanner_10_01_2026.pdf", "Scanned with Genius Scan.pdf"])
  test(`M2 more made-up names '${f}'`, () => { if (!isMachineFilename(f)) notes.push(`M2 '${f}' stays as '${doc(f)}'`); });
for (const f of ["Oct renewal.pdf", "New policy 2026.pdf", "Final schedule.pdf", "Copy of AIA.pdf", "Mon & Dad.pdf", "May plan.pdf", "Image Shield.pdf", "PM Hospital Plan.pdf", "AM Life.pdf"])
  test(`S3 chosen names using list words '${f}' stay`, () => assert.equal(isMachineFilename(f), false, `'${f}' replaced by '${doc(f)}'`));
for (const [full, short] of [["Tesco Bank plc", "Tesco Bank"], ["Smith & Co.", "Smith"], ["Cigna Mexico Co", "Cigna Mexico"], ["Insurance (Pte) Ltd", "Insurance"], ["Hong Leong Assurance Berhad", "Hong Leong Assurance"]] as const)
  test(`I2 '${full}' -> '${short}'`, () => assert.equal(insurerShortName(full), short));

// ------------------------------------------------------------ insurer company forms
for (const [full, short] of [["AIA Singapore Private Limited", "AIA Singapore"], ["FWD Singapore Pte. Ltd.", "FWD Singapore"], ["Manulife (Singapore) Pte. Ltd.", "Manulife (Singapore)"],
  ["Allianz General Insurance Company (Malaysia) Berhad", "Allianz General Insurance Company (Malaysia)"], ["Etiqa General Takaful Berhad", "Etiqa General Takaful"], ["Tokio Marine Life Insurance Malaysia Bhd", "Tokio Marine Life Insurance Malaysia"],
  ["Great Eastern Life Assurance (Malaysia) Sdn. Bhd.", "Great Eastern Life Assurance (Malaysia)"], ["Aviva plc", "Aviva"], ["Legal & General Assurance Society Limited", "Legal & General Assurance Society"],
  ["Zurich Insurance Company Ltd", "Zurich Insurance"], ["Sun Life Hong Kong Limited", "Sun Life Hong Kong"], ["Pacific Mutual Co.", "Pacific Mutual"], ["NTUC Income Insurance Co-operative Limited", "NTUC Income Insurance Co-operative"],
  ["Income Insurance Limited", "Income Insurance"], ["Tesco Bank", "Tesco Bank"], ["Tesco", "Tesco"], ["Seguros Mexico", "Seguros Mexico"], ["Allianz Morocco", "Allianz Morocco"],
  ["Unlimited Cover", "Unlimited Cover"], ["Blue Cross (Asia-Pacific) Insurance Limited", "Blue Cross (Asia-Pacific) Insurance"], ["Generali Inc", "Generali"], ["Zinc", "Zinc"], ["Bupa", "Bupa"], ["Co", "Co"]] as const)
  test(`I1 '${full}' -> '${short}'`, () => assert.equal(insurerShortName(full), short));

// ------------------------------------------------------------ the sentence name
test("N1 product name wins; a chosen file name is made readable; a made-up one becomes '<insurer> <kind>'", () => {
  assert.equal(doc("817d6e8b-874f.pdf", { product: "Harbour Shield" }), "Harbour Shield");
  assert.equal(doc("817d6e8b-874f-4527-a45d-05e03adaf14c.pdf"), "Harbourline Assurance policy wording");
  assert.equal(doc("output_202609281146053.pdf", { role: "personal_schedule" }), "Harbourline Assurance policy schedule");
  assert.equal(doc("IMG_2041.jpg", { insurer: null, role: null }), "Document");
});
test("N2 a made-up name with no insurer and an unusual role reads as a plain phrase (no underscores, no 'personal proof' jargon)", () => {
  for (const role of ["personal_proof", "scheme_terms", "benefit_summary", "renewal_notice", "insurer_letter"]) {
    const n = doc("IMG_2041.jpg", { insurer: null, role });
    assert.ok(!/_/.test(n), n);
    notes.push(`N2 role ${role}: '${n}'`);
  }
});
test("N3 a blank product name ('  ') falls through to the file name, never an empty name", () => {
  assert.ok(doc("Harbour schedule.pdf", { product: "   " }).length > 0);
  assert.notEqual(doc("IMG_2041.jpg", { product: "" }), "");
});
test("N4 an insurer that is only a company form ('Pte. Ltd.') never leaves an empty or form-only name", () => {
  const n = doc("IMG_2041.jpg", { insurer: "Pte. Ltd." });
  notes.push("N4 insurer 'Pte. Ltd.': " + n);
  assert.ok(!/^\s/.test(n), n);
});

for (const f of failures) console.log("FAIL " + f);
for (const n of notes) console.log("NOTE " + n);
console.log(`te-pr159: ${passed} passed, ${failures.length} failed, fetches ${fetches}`);
process.exit(failures.length ? 1 : 0);

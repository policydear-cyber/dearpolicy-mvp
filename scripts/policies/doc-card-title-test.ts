/** Documents page card titles (app/policies/page.tsx) use the same naming rule as sentences (lib/policies/inventory.ts
 * documentName, PR #159): product name; else a readable file name a person chose; else insurer + kind, "(ending NNNN)"
 * when there is a policy number. A machine-made file name ("817d6e8b-....pdf", "output_2026....pdf") is never a title.
 * Made-up rows only. Pure: no database, no network, no model.
 *   node --import tsx scripts/policies/doc-card-title-test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { documentCardTitle, documentLabels, isPlaceholderName } from "@/lib/policies/document-name";
import { documentName } from "@/lib/policies/inventory";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

type Row = { product_name: string | null; original_filename: string; insurer: string | null; document_role: string | null; policy_number: string | null; processing_status?: string };
const row = (o: Partial<Row>): Row => ({ product_name: null, original_filename: "x.pdf", insurer: "Harbourline Assurance Pte. Ltd.", document_role: "policy_wording", policy_number: null, ...o });

const machine = ["817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", "output_202609281146053.pdf", "output_202609281146157.pdf", "scan_20261001_101500.pdf"];
for (const f of machine) {
  test(`machine name '${f}', no number -> insurer + kind`, () => assert.equal(documentCardTitle(row({ original_filename: f })), "Harbourline Assurance policy wording"));
  test(`machine name '${f}', with number -> ending`, () => assert.equal(documentCardTitle(row({ original_filename: f, policy_number: "HL-0099-4321", document_role: "personal_schedule" })), "Harbourline Assurance policy schedule (ending 4321)"));
  test(`machine name '${f}' never the title`, () => assert.notEqual(documentCardTitle(row({ original_filename: f })), f));
}
test("chosen file name is prettified", () => assert.equal(documentCardTitle(row({ original_filename: "family_hospital_plan_2026.pdf" })), "Family Hospital Plan 2026"));
test("chosen file name with casing kept", () => assert.equal(documentCardTitle(row({ original_filename: "My CI Plan.pdf" })), "My CI Plan"));
// Live review on 4103e10 (finding 6): a brand written as one word in a name the person spaced is kept as typed.
test("one-word brand in a spaced name kept", () => assert.equal(documentCardTitle(row({ original_filename: "TerraFlexiSave Protection Plus (3rd Series) (TX3).pdf" })), "TerraFlexiSave Protection Plus (3rd Series) (TX3)"));
test("one-word brand with underscores kept", () => assert.equal(documentCardTitle(row({ original_filename: "Harbour_MediShield_Gold.pdf" })), "Harbour MediShield Gold"));
test("one-word brand with dashes kept", () => assert.equal(documentCardTitle(row({ original_filename: "LionCare-Takaful-Plan.pdf" })), "LionCare Takaful Plan"));
test("a name with no separator is still split", () => assert.equal(documentCardTitle(row({ original_filename: "FamilyHospitalPlan.pdf" })), "Family Hospital Plan"));
test("an acronym run into a word with no separator is still split", () => assert.equal(documentCardTitle(row({ original_filename: "AIAShieldBooklet.pdf" })), "AIA Shield Booklet"));
test("product name wins over everything", () => assert.equal(documentCardTitle(row({ product_name: " Shield Gold ", original_filename: machine[0], policy_number: "P1234" })), "Shield Gold"));
test("product name wins over a chosen file name", () => assert.equal(documentCardTitle(row({ product_name: "Shield Gold", original_filename: "my_plan.pdf" })), "Shield Gold"));
test("no insurer, machine name -> kind", () => assert.equal(documentCardTitle(row({ insurer: null, original_filename: machine[1] })), "Policy wording"));
test("no insurer, no role, with number", () => assert.equal(documentCardTitle(row({ insurer: "  ", document_role: null, original_filename: machine[0], policy_number: "AB-778812" })), "Document (ending 8812)"));
test("no file name at all still named", () => assert.equal(documentCardTitle({ ...row({}), original_filename: null as unknown as string }), "Harbourline Assurance policy wording"));
for (const status of ["queued", "extracting", "failed", "ready"]) {
  test(`status '${status}' keeps the readable name`, () => assert.equal(documentCardTitle(row({ original_filename: machine[1], processing_status: status })), "Harbourline Assurance policy wording"));
}

// Parity: the Documents title equals the sentence name for the same row.
const rows: Row[] = [
  ...machine.map((f) => row({ original_filename: f })), ...machine.map((f) => row({ original_filename: f, policy_number: "SG-55-0001" })),
  row({ original_filename: "family_hospital_plan_2026.pdf" }), row({ product_name: "Shield Gold", original_filename: machine[0] }),
  row({ insurer: null, original_filename: machine[2] }), row({ insurer: "Example Life Berhad", document_role: "insurer_letter", original_filename: machine[3], policy_number: "x" }),
];
for (const r of rows) test(`parity '${r.original_filename}' / ${r.product_name ?? "-"} / ${r.policy_number ?? "-"}`, () => assert.equal(documentCardTitle(r), documentName(r)));

// The page uses the shared rule for the card title, keeps the file name as the small line, and the API sends the fields.
const root = join(__dirname, "..", "..");
const page = readFileSync(join(root, "app/policies/page.tsx"), "utf8");
const route = readFileSync(join(root, "app/api/policies/route.ts"), "utf8");
const shared = readFileSync(join(root, "lib/policies/document-name.ts"), "utf8");
test("page titles cards with the shared rule", () => { assert.match(page, /from "@\/lib\/policies\/document-name"/); assert.match(page, /return documentCardTitle\(policy\)/); assert.doesNotMatch(page, /product_name\?\.trim\(\) \|\| policy\.original_filename/); });
test("a card never shows the upload's file name (DC 18 Nov: no file names)", () => assert.doesNotMatch(page, /\{policy\.original_filename\}|document-file/));
// Chat's note about a document that couldn't be read names it as the Documents card does (Critic R316 L1).
const chatPage = readFileSync(join(root, "app/chat/page.tsx"), "utf8");
test("chat names a failed document with the shared rule", () => { assert.match(chatPage, /from "@\/lib\/policies\/document-name"/); assert.match(chatPage, /name:documentCardTitle\(/); assert.doesNotMatch(chatPage, /p\.product_name\|\|p\.original_filename/); });
// Coverage names every document the same way (TE P179 F1): plan proof, wording, supporting-wording card and table source.
const coveragePage = readFileSync(join(root, "app/coverage/page.tsx"), "utf8");
const coverageRoute = readFileSync(join(root, "app/api/coverage/route.ts"), "utf8");
test("Coverage page prints no raw file name", () => {
  for (const raw of [/\{x\.ownership_filename\}/, /\{x\.reference_filename\}/, /\?\?x\.original_filename\}/]) assert.doesNotMatch(coveragePage, raw);
  assert.match(coveragePage, /confirmed by <b>\{x\.ownership_name\}<\/b>; this benefit is described in <b>\{x\.reference_name\}<\/b>/);
  assert.match(coveragePage, /<strong>\{x\.product_name\?\?x\.document_name\}<\/strong>/);
});
test("Coverage route names each document with the shared rule", () => {
  assert.match(coverageRoute, /from "@\/lib\/policies\/document-name"/);
  for (const r of [/ownership_name:documentCardTitle\(/, /reference_name:documentCardTitle\(/, /document_name:documentCardTitle\(/, /document:name\(r\.source\.documentId,r\.source\.document\)/]) assert.match(coverageRoute, r);
  // Each name carries its own document's number, so two policies of one insurer and kind stay apart (TE P179 r2 mutant).
  assert.match(coverageRoute, /ownership_name:documentCardTitle\(\{[^}]*policy_number:owner\.policy_number\}\)/);
  assert.match(coverageRoute, /reference_name:documentCardTitle\(\{[^}]*policy_number:ref\.policy_number\}\)/);
  assert.doesNotMatch(coverageRoute, /document:r\.source\.document\b/);
  assert.doesNotMatch(coverageRoute, /(ownership|reference)_filename:/);
});
// It may import only modules that import nothing themselves (the ID mask, TE pr181 F2), so it stays pure for client screens.
test("shared naming module is pure (imports only modules with no imports)", () => {
  for (const [, from] of shared.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)) {
    assert.match(from, /^@\/lib\//, from);
    assert.doesNotMatch(readFileSync(join(root, from.slice(2) + ".ts"), "utf8"), /^\s*import\s/m, from);
  }
  assert.doesNotMatch(shared.replace(/^\s*import\s[^;]*?from\s+"@\/lib\/[^"]+";?/gm, ""), /^\s*import\s/m);
});
test("GET /api/policies selects insurer, document_role, policy_number", () => { for (const c of ["p.insurer", "p.document_role", "p.policy_number"]) assert.ok(route.includes(c), c); });

// Ask labels (DC 18 Nov: no file names): a part of a multi-policy upload is stored as "<file> — part N of M (pages a–b).pdf"
// (lib/rag/ingest.ts) and reads by the file it came from; twins read apart by number, format, Singapore day, copy (TE M1, L1).
test("documentLabels: multi-policy parts, nameless uploads and twins never show a file name, and every label is unique", () => {
  const d = (id: string, f: string, p: string | null, n: string | null = null, c = "2026-11-03T02:00:00Z") => ({ id, original_filename: f, product_name: p, policy_number: n, created_at: c });
  const labels = [...documentLabels([
    d("a", "output_202611180000009 — part 2 of 2 (pages 3–4).pdf", null),
    d("b", "817d6e8b-874f-4527-a45d-05e03adaf14c — part 1 of 2 (pages 1–2).PDF", null, null, "2026-11-04T02:00:00Z"),
    d("c", "Pelican Family — part 3 of 3 (pages 5–6).pdf", null),
    d("d", "IMG_0042.jpg", null, null, "2026-11-17T16:30:00Z"),
    d("e", "x.pdf", "Finch Life", "FL-0001"), d("f", "y.pdf", "Finch Life", "FL-0002"),
    d("g", "z.pdf", "Shield (PDF)"), d("h", "s.pdf", "Shield"), d("i", "s.jpg", "Shield"),
  ], { describeUnnamed: true }).values()];
  assert.deepEqual(labels.slice(0, 6), ["PDF uploaded 3 Nov 2026 (part 2 of 2)", "PDF uploaded 4 Nov 2026 (part 1 of 2)", "Pelican Family (part 3 of 3)",
    "Photo uploaded 18 Nov 2026", "Finch Life (ending 0001)", "Finch Life (ending 0002)"]);
  assert.equal(new Set(labels).size, labels.length, labels.join(" | "));
  for (const l of labels) assert.doesNotMatch(l, /\.(?:pdf|jpe?g)\b|output_|817d6e8b|IMG_|pages \d/i, l);
});

// #564 (19 Nov): a letter or claim decision that carries the policy's name reads as what it is, not as "copy 2"; a PDF
// tool's stand-in title ("(anonymous)") is never a name.
test("documentLabels: letters and decisions read by kind; placeholder titles are not names", () => {
  const d = (id: string, f: string, p: string | null, r: string | null) => ({ id, original_filename: f, product_name: p, document_role: r, created_at: "2026-11-03T02:00:00Z" });
  const m = documentLabels([
    d("s", "a.pdf", "Shield Plan", "personal_schedule"), d("l", "b.pdf", "Shield Plan", "insurer_letter"),
    d("c", "c.pdf", "Shield Plan", "claim_decision"), d("x", "Novena_Final_Bill.pdf", "(anonymous)", "medical_bill"),
    d("u", "IMG_0042.pdf", "Untitled", null),
  ], { describeUnnamed: true });
  assert.deepEqual([...m.values()], ["Shield Plan", "Shield Plan (letter)", "Shield Plan (claim decision)", "Novena Final Bill", "PDF uploaded 3 Nov 2026"]);
  for (const t of ["Untitled-1", "Document1", "Microsoft Word - Document1", "untitled.pdf", "N/A", "-", "Unknown"]) assert.ok(isPlaceholderName(t), t);
  for (const t of ["Anonymous Benefits Plan", "Untitled Life Plan", "Document Plan", "Shield"]) assert.ok(!isPlaceholderName(t), t);
  assert.equal(documentCardTitle({ product_name: "(anonymous)", original_filename: "IMG_1.pdf", insurer: "Merlion", document_role: "medical_bill" }), "Merlion medical bill");
});

console.log(`doc-card-title: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }

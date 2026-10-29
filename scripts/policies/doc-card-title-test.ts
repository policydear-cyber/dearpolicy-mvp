/** Documents page card titles (app/policies/page.tsx) use the same naming rule as sentences (lib/policies/inventory.ts
 * documentName, PR #159): product name; else a readable file name a person chose; else insurer + kind, "(ending NNNN)"
 * when there is a policy number. A machine-made file name ("817d6e8b-....pdf", "output_2026....pdf") is never a title.
 * Made-up rows only. Pure: no database, no network, no model.
 *   node --import tsx scripts/policies/doc-card-title-test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { documentCardTitle } from "@/lib/policies/document-name";
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
test("page keeps the file name as the secondary line", () => assert.match(page, /documentName\(policy\) !== policy\.original_filename\?\.trim\(\) && <small className="document-file">\{policy\.original_filename\}<\/small>/));
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

console.log(`doc-card-title: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }

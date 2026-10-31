/** Documents page filters (app/policies/page.tsx): "Your policies" holds every document about the household's own cover
 * or account, "General wording" only general product documents nobody in the household is linked to. Any insurer, any
 * market: the rule reads the stored role, the reading's personal-cover flag and the people linked, never names.
 * Made-up rows only. Pure: no database, no network, no model.
 *   node --import tsx scripts/policies/document-filter-test.ts */
import assert from "node:assert/strict";
import { authorityLabel, isOwnDocument, readAsPolicyDocument } from "@/lib/policies/document-filter";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

type Row = Parameters<typeof isOwnDocument>[0] & { linked_people: { source: string }[] };
const doc = (o: Partial<Row>): Row => ({ personal_coverage_confirmed: false, document_role: "policy_wording", linked_people: [], ...o });
const chosen = [{ source: "user_declared" }], schemeOnly = [{ source: "scheme_reference_match" }];

test("a confirmed schedule or certificate is the household's own", () => {
  assert.ok(isOwnDocument(doc({ personal_coverage_confirmed: true, document_role: "personal_schedule" })));
  assert.ok(isOwnDocument(doc({ personal_coverage_confirmed: true, document_role: "certificate" })));
});
test("a schedule read in part, not confirmed, is their own, linked or not", () => {
  for (const linked_people of [[], chosen]) assert.ok(isOwnDocument(doc({ document_role: "personal_schedule", linked_people })));
});
test("a brochure, wording or illustration linked to someone (chosen, or a name it prints) is still General wording", () => {
  for (const role of ["policy_illustration", "product_summary", "policy_wording", "brochure"]) for (const source of ["user_declared", "upload_hint", "ai_name_match"]) assert.ok(!isOwnDocument(doc({ document_role: role, linked_people: [{ source }] })), `${role}/${source}`);
});
test("receipts, renewals, statements, letters and endorsements are about their own account", () => {
  for (const role of ["premium_receipt", "renewal_statement", "annual_statement", "insurer_letter", "claim_decision", "endorsement", "welcome_letter", "medical_bill"]) assert.ok(isOwnDocument(doc({ document_role: role })), role);
});
test("a file whose kind is not known stays with their own documents", () => {
  assert.ok(isOwnDocument(doc({ document_role: null })));
  assert.ok(isOwnDocument(doc({ document_role: "unknown" })));
});
test("general product documents with nobody linked are General wording", () => {
  for (const role of ["policy_wording", "product_summary", "benefit_guide", "brochure", "policy_illustration", "claim_form"]) assert.ok(!isOwnDocument(doc({ document_role: role })), role);
});
test("a wording whose reading confirmed the household's cover is their own, even with nobody linked yet", () => {
  assert.ok(isOwnDocument(doc({ personal_coverage_confirmed: true, document_role: "policy_wording" })));
  assert.ok(isOwnDocument(doc({ personal_coverage_confirmed: true, document_role: "product_summary", linked_people: schemeOnly })));
});
test("a wording used only as matching wording for someone's plan is still General wording", () => {
  assert.ok(!isOwnDocument(doc({ document_role: "policy_wording", linked_people: schemeOnly })));
});

test("the badge always agrees with the filter the card sits under", () => {
  const card = (o: Partial<Row> & { document_authority_label?: string | null }) => ({ document_authority_label: null, ...doc(o), ...o });
  assert.equal(authorityLabel(card({ document_role: "brochure", document_authority_label: "Reference information" })), "General wording");
  assert.equal(authorityLabel(card({ document_role: "policy_wording", document_authority_label: "Contract wording", linked_people: chosen })), "General wording");
  assert.equal(authorityLabel(card({ document_role: "personal_schedule", document_authority_label: "Supporting document", linked_people: chosen })), "Linked to your cover");
  assert.equal(authorityLabel(card({ document_role: "personal_schedule", personal_coverage_confirmed: true, document_authority_label: "Personal proof" })), "Your own policy");
  assert.equal(authorityLabel(card({ document_role: "premium_receipt", document_authority_label: "Current account record" })), "Current account record");
  assert.equal(authorityLabel(card({ document_role: null })), "Your document");
  for (const role of ["policy_wording", "brochure", "premium_receipt", "personal_schedule", null]) for (const linked_people of [[], chosen, schemeOnly]) for (const label of [null, "Reference", "Contract wording", "Supporting document"]) {
    const c = card({ document_role: role, linked_people, document_authority_label: label });
    assert.equal(authorityLabel(c) === "General wording", !isOwnDocument(c), `${role}/${label}/${linked_people.map((l) => l.source)}`);
  }
});
test("a pack filed as a letter whose reading found a cover is never called Correspondence; nothing else is renamed", () => {
  const card = (o: Partial<Row> & { document_authority_label?: string | null; reading_policy?: boolean | null }) => ({ document_authority_label: null, ...doc(o), ...o });
  assert.ok(readAsPolicyDocument({ document_role: "insurer_letter", reading_policy: true }));
  for (const linked_people of [[], chosen]) assert.notEqual(authorityLabel(card({ document_role: "insurer_letter", document_authority_label: "Correspondence", reading_policy: true, linked_people })), "Correspondence");
  assert.equal(authorityLabel(card({ document_role: "insurer_letter", document_authority_label: "Correspondence", reading_policy: true, linked_people: chosen })), "Linked to your cover");
  // A letter whose reading does not qualify keeps its label.
  for (const reading_policy of [false, null, undefined]) assert.equal(authorityLabel(card({ document_role: "insurer_letter", document_authority_label: "Correspondence", reading_policy, linked_people: chosen })), "Correspondence");
  // Only a letter can be a pack's cover letter: a claim decision, bill, screenshot or notes is never renamed, nor any other role.
  for (const role of ["claim_decision", "medical_bill", "app_screenshot", "personal_notes", "policy_wording", null]) assert.ok(!readAsPolicyDocument({ document_role: role, reading_policy: true }), String(role));
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`document-filter: ${passed} passed, fetches 0`);

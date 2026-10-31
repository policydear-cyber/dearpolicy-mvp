/** Documents page filters (app/policies/page.tsx): "Your policies" holds every document about the household's own cover
 * or account, "General wording" only general product documents nobody in the household is linked to. Any insurer, any
 * market: the rule reads the stored role, the reading's personal-cover flag and the people linked, never names.
 * Made-up rows only. Pure: no database, no network, no model.
 *   node --import tsx scripts/policies/document-filter-test.ts */
import assert from "node:assert/strict";
import { isOwnDocument } from "@/lib/policies/document-filter";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

type Row = Parameters<typeof isOwnDocument>[0];
const doc = (o: Partial<Row>): Row => ({ personal_coverage_confirmed: false, document_role: "policy_wording", linked_people: [], ...o });
const chosen = [{ source: "user_declared" }], schemeOnly = [{ source: "scheme_reference_match" }];

test("a confirmed schedule or certificate is the household's own", () => {
  assert.ok(isOwnDocument(doc({ personal_coverage_confirmed: true, document_role: "personal_schedule" })));
  assert.ok(isOwnDocument(doc({ personal_coverage_confirmed: true, document_role: "certificate" })));
});
test("a policy read in part, not confirmed, but with a person chosen on it is their own", () => {
  for (const role of ["personal_schedule", "policy_illustration", "product_summary", "policy_wording", null]) assert.ok(isOwnDocument(doc({ document_role: role, linked_people: chosen })), String(role));
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

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`document-filter: ${passed} passed, fetches 0`);

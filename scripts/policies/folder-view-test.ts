/** Scripted tests: what the Documents page shows for policy folders (lib/policies/folder-view.ts). A folder's name comes
 * from the household, else its own schedule's product as read, else who it is for; a shared printed policy number only
 * suggests a grouping, for the people every document is linked to, and never across two people, two insurers, a short
 * number or documents already together. Made-up documents; no database.
 *   npm run -s policies:folder-view-test */
import assert from "node:assert/strict";
import { folderSuggestions, folderTitle, type FolderDoc, type FolderView } from "@/lib/policies/folder-view";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const d = (id: string, over: Partial<FolderDoc> = {}): FolderDoc => ({ id, product_name: null, insurer: null, policy_number: null, linked_people: [{ id: "jane" }], ...over });
const f = (over: Partial<FolderView> = {}): FolderView => ({ id: "f1", name: null, complete: false, people: [{ id: "jane", name: "Jane Doe" }], documents: [], ...over });
const map = (docs: FolderDoc[]) => new Map(docs.map((x) => [x.id, x]));

test("T1 the household's own name wins", () => assert.equal(folderTitle(f({ name: "Jane's CI" }), map([])), "Jane's CI"));
test("T2 else the schedule's product with its insurer, even when the wording was added first", () => {
  const docs = [d("w", { product_name: "General Wording", insurer: "Example Life" }), d("s", { product_name: "Shield Plan", insurer: "Example Life" })];
  assert.equal(folderTitle(f({ documents: [{ policyId: "w", slot: "wording" }, { policyId: "s", slot: "schedule" }] }), map(docs)), "Example Life Shield Plan");
});
test("T3 the insurer is not repeated when the product already names it", () => {
  assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: null }] }), map([d("s", { product_name: "Example Life Shield", insurer: "Example Life" })])), "Example Life Shield");
});
test("T4 nothing read yet (new uploads, or an unreadable photo): who it is for", () => {
  assert.equal(folderTitle(f({ documents: [{ policyId: "x", slot: "schedule" }], people: [{ id: "a", name: "Jane" }, { id: "b", name: "John" }] }), map([d("x")])), "Policy for Jane and John");
  assert.equal(folderTitle(f({ people: [] }), map([])), "Policy");
});

test("T5 a schedule whose product is a system code: the plain product name from another document in the folder", () => {
  const docs = [d("s", { product_name: "XXGRP_COI_APP", insurer: "Example Assurance Ltd" }), d("p", { product_name: "Harbour Group Insurance", insurer: "Example Assurance Ltd" })];
  assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: "schedule" }, { policyId: "p", slot: "other" }] }), map(docs)), "Example Assurance Harbour Group Insurance");
});
test("T6 only codes or file names as products: never shown; who it is for instead", () => {
  const docs = [d("s", { product_name: "POL_SCHED_V2" }), d("w", { product_name: "wording_final.pdf" }), d("x", { product_name: "Terms.pdf" }), d("y", { product_name: "scan.TIFF" })];
  assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: "schedule" }, { policyId: "w", slot: "wording" }, { policyId: "x", slot: null }, { policyId: "y", slot: null }] }), map(docs)), "Policy for Jane Doe");
});
test("T7 the insurer's legal suffix is dropped, and not repeated when the product names it", () => {
  assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: "schedule" }] }), map([d("s", { product_name: "Shield Plan", insurer: "Example Life Pte. Ltd." })])), "Example Life Shield Plan");
  assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: "schedule" }] }), map([d("s", { product_name: "Example Life Shield", insurer: "Example Life Ltd" })])), "Example Life Shield");
});

test("S1 two documents with the same number (spaces and dashes aside), both Jane's: suggested for Jane", () => {
  const s = folderSuggestions([d("a", { policy_number: "AB-123 456" }), d("b", { policy_number: "ab123456" }), d("c")], []);
  assert.deepEqual(s, [{ policyNumber: "AB-123 456", policyIds: ["a", "b"], personIds: ["jane"] }]);
});
test("S2 the same number on Jane's and John's documents: nothing suggested (never across people)", () => {
  assert.deepEqual(folderSuggestions([d("a", { policy_number: "AB123456" }), d("b", { policy_number: "AB123456", linked_people: [{ id: "john" }] })], []), []);
});
test("S3 a link only by plan match does not count as the person's", () => {
  assert.deepEqual(folderSuggestions([d("a", { policy_number: "AB123456" }), d("b", { policy_number: "AB123456", linked_people: [{ id: "jane", source: "scheme_reference_match" }] })], []), []);
});
test("S4 two insurers print the same number: nothing suggested", () => {
  assert.deepEqual(folderSuggestions([d("a", { policy_number: "AB123456", insurer: "One" }), d("b", { policy_number: "AB123456", insurer: "Two" })], []), []);
});
test("S5 a short number (under 5 letters and digits): nothing suggested", () => {
  assert.deepEqual(folderSuggestions([d("a", { policy_number: "12-3" }), d("b", { policy_number: "123" })], []), []);
});
test("S6 already together in one folder: not suggested again; in two folders: still suggested", () => {
  const docs = [d("a", { policy_number: "AB123456" }), d("b", { policy_number: "AB123456" })];
  assert.deepEqual(folderSuggestions(docs, [f({ documents: [{ policyId: "a", slot: null }, { policyId: "b", slot: null }] })]), []);
  assert.equal(folderSuggestions(docs, [f({ documents: [{ policyId: "a", slot: null }] }), f({ id: "f2", documents: [{ policyId: "b", slot: null }] })]).length, 1);
});
test("S7 a document linked to nobody: nothing suggested", () => {
  assert.deepEqual(folderSuggestions([d("a", { policy_number: "AB123456", linked_people: [] }), d("b", { policy_number: "AB123456" })], []), []);
});

if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
console.log(`folder-view: ${passed} passed, 0 failed`);

/** Scripted tests: what the Documents page shows for policy folders (lib/policies/folder-view.ts). A folder's name comes
 * from the household, else its own schedule's product as read, else who it is for; a shared printed policy number only
 * suggests a grouping, for the people every document is linked to, and never across two people, two insurers, a short
 * number or documents already together. Made-up documents; no database.
 *   npm run -s policies:folder-view-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { folderSuggestions, folderTitle, policyStarters, slotForRole, type FolderDoc, type FolderView } from "@/lib/policies/folder-view";

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
test("T8 one-word codes without underscores are never a name; one-word plain names are", () => {
  for (const code of ["SGGRP-COI-APP", "PW9", "ABC123", "COI2026", "POL.SCHED.V2", "817d6e8b-874f-4527-9a3c-1f2e3d4c5b6a"])
    assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: "schedule" }] }), map([d("s", { product_name: code, insurer: "Example Life Ltd" })])), "Example Life policy for Jane Doe", code);
  for (const name of ["Eldershield", "MINDEF", "Kestrel-Care", "CareShield"])
    assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: "schedule" }] }), map([d("s", { product_name: name })])), name, name);
});
test("T7 the insurer's legal suffix is dropped, and not repeated when the product names it", () => {
  assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: "schedule" }] }), map([d("s", { product_name: "Shield Plan", insurer: "Example Life Pte. Ltd." })])), "Example Life Shield Plan");
  assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: "schedule" }] }), map([d("s", { product_name: "Example Life Shield", insurer: "Example Life Ltd" })])), "Example Life Shield");
});

test("T9 no plain product name: the insurer read from the folder's documents tells two policies apart", () => {
  const docs = [d("a", { product_name: "PW9", insurer: "Osprey Life Pte. Ltd." }), d("b", { product_name: "COI2026", insurer: "Plover Insurance" })];
  assert.equal(folderTitle(f({ documents: [{ policyId: "a", slot: "schedule" }] }), map(docs)), "Osprey Life policy for Jane Doe");
  assert.equal(folderTitle(f({ documents: [{ policyId: "b", slot: null }] }), map(docs)), "Plover Insurance policy for Jane Doe");
  assert.equal(folderTitle(f({ people: [], documents: [{ policyId: "b", slot: null }] }), map(docs)), "Plover Insurance policy");
});
test("T10 an insurer that is a code, a file name or only a legal suffix is never shown, beside a product or alone", () => {
  for (const insurer of ["EXA_INS_01", "insurer.pdf", "Ltd", "Pte. Ltd."]) {
    assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: "schedule" }] }), map([d("s", { product_name: "Harbour Shield", insurer })])), "Harbour Shield", insurer);
    assert.equal(folderTitle(f({ documents: [{ policyId: "s", slot: "schedule" }] }), map([d("s", { product_name: "PW9", insurer })])), "Policy for Jane Doe", insurer);
  }
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
test("S4b one insurer printed two ways (Pte Ltd / Pte. Ltd.): still suggested", () => {
  const s = folderSuggestions([d("a", { policy_number: "AB123456", insurer: "Example Singapore Pte Ltd" }), d("b", { policy_number: "AB123456", insurer: "Example Singapore Pte. Ltd." })], []);
  assert.equal(s.length, 1);
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

const sch = (id: string, over: Partial<FolderDoc> = {}) => d(id, { document_role: "personal_schedule", ...over });
test("P1 every schedule or certificate in no folder starts its own policy, for its own people", () => {
  const s = policyStarters([sch("a"), d("c", { document_role: "certificate", linked_people: [{ id: "jane" }, { id: "john" }] }), d("w", { document_role: "policy_wording" })], []);
  assert.deepEqual(s, [
    { scheduleId: "a", personIds: ["jane"], documents: [{ policyId: "a", slot: "schedule" }] },
    { scheduleId: "c", personIds: ["jane", "john"], documents: [{ policyId: "c", slot: "schedule" }] },
  ]);
});
test("P2 a same-number receipt from the same insurer (printed Pte Ltd / Pte. Ltd.) for the same person joins its schedule", () => {
  const s = policyStarters([sch("a", { policy_number: "26-0001 877", insurer: "Example Singapore Pte Ltd" }), d("r", { document_role: "premium_receipt", policy_number: "260001877", insurer: "Example Singapore Pte. Ltd." })], []);
  assert.deepEqual(s, [{ scheduleId: "a", personIds: ["jane"], documents: [{ policyId: "a", slot: "schedule" }, { policyId: "r", slot: "other" }] }]);
});
test("P3 never across people, insurers or a plan match; a short number joins nothing", () => {
  const docs = [sch("a", { policy_number: "AB123456", insurer: "One" }),
    d("john", { policy_number: "AB123456", insurer: "One", linked_people: [{ id: "john" }] }),
    d("other", { policy_number: "AB123456", insurer: "Two" }),
    d("plan", { policy_number: "AB123456", insurer: "One", linked_people: [{ id: "jane", source: "scheme_reference_match" }] }),
    sch("s", { policy_number: "12-3" }), d("t", { policy_number: "123" })];
  const s = policyStarters(docs, []);
  assert.deepEqual(s.map((x) => x.documents.map((y) => y.policyId)), [["a"], ["s"]]);
});
test("P4 a schedule already in a folder, linked to nobody, linked only by plan match, or not read yet starts nothing", () => {
  const docs = [sch("filed"), sch("nobody", { linked_people: [] }), sch("plan", { linked_people: [{ id: "jane", source: "scheme_reference_match" }] }), d("reading", { document_role: null })];
  assert.deepEqual(policyStarters(docs, [f({ documents: [{ policyId: "filed", slot: null }] })]), []);
});
test("P5 a joint schedule keeps both people; a same-number document of only one of them stays out", () => {
  const docs = [sch("a", { policy_number: "AB123456", linked_people: [{ id: "jane" }, { id: "john" }] }),
    d("j", { policy_number: "AB123456", linked_people: [{ id: "jane" }] }), d("both", { policy_number: "AB123456", linked_people: [{ id: "john" }, { id: "jane" }] })];
  assert.deepEqual(policyStarters(docs, []), [{ scheduleId: "a", personIds: ["jane", "john"], documents: [{ policyId: "a", slot: "schedule" }, { policyId: "both", slot: "other" }] }]);
});
test("P5b a document already made into a folder, or taken out of one, neither starts nor joins one", () => {
  const docs = [sch("a", { policy_number: "AB123456" }), d("r", { policy_number: "AB123456" }), sch("gone")];
  assert.deepEqual(policyStarters(docs, [], new Set(["r", "gone"])), [{ scheduleId: "a", personIds: ["jane"], documents: [{ policyId: "a", slot: "schedule" }] }]);
});
test("P5c a newer copy of a schedule in a folder starts no second folder (the folder offers it as Add it)", () => {
  assert.deepEqual(policyStarters([sch("new")], [f({ documents: [], replacements: [{ policyId: "old", slot: "schedule", by: "new" }] })]), []);
});
test("P6 two schedules with one number (a renewal) make one policy, not two", () => {
  const s = policyStarters([sch("a", { policy_number: "AB123456" }), sch("b", { policy_number: "AB123456" })], []);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].documents.map((x) => x.policyId), ["a", "b"]);
});
test("P7 slots from what was read: schedule, wording, rider, else other", () => {
  assert.deepEqual(["certificate", "policy_wording", "endorsement", "premium_receipt", null].map(slotForRole), ["schedule", "wording", "rider", "other", "other"]);
});

test("F1 a folder never shows a document's file name (DC: no file names in what a household reads)", () => {
  const src = readFileSync("components/policy-folders.tsx", "utf8");
  const uses = src.split("\n").filter((l) => l.includes("original_filename") && !/^\s*original_filename: string;/.test(l));
  assert.deepEqual(uses, []);
});
if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
console.log(`folder-view: ${passed} passed, 0 failed`);

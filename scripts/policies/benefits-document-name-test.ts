/**
 * The Benefits page heads each document's benefits, and names each source, by the name Documents gives that document
 * ("Example General endorsement"), never by a made-up file name ("output_202609281146157.pdf"), and two documents that
 * share a name keep their own groups. Source checks plus the shared namer; no database, no network, no model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

test("/api/benefits names documents with documentName, for benefits and for conditions", () => {
  const src = readFileSync("app/api/benefits/route.ts", "utf8");
  assert.doesNotMatch(src, /documentName:row\.original_filename/, "a raw file name is never a document's name");
  assert.doesNotMatch(src, /row\.document_product\?\?row\.original_filename/);
  assert.equal((src.match(/documentName\(\{product_name:row\.document_product,original_filename:row\.original_filename,insurer:row\.insurer,document_role:row\.document_role,policy_number:row\.document_policy_number\}\)/g) ?? []).length, 2);
});

test("the Benefits page keeps one group per document when documents share a name", () => {
  const page = readFileSync("app/schedule/page.tsx", "utf8");
  assert.match(page, /const key=benefit\.productName\?\?"doc:"\+benefit\.policyId/);
  for (const p of [page, readFileSync("app/operator/benefits/page.tsx", "utf8")]) assert.match(p, /<h2>\{groupHeading\(groups,product\)\}<\/h2>/);
});

test("two documents with the same name are headed 1 of 2 and 2 of 2; a unique name carries no number", async () => {
  const { groupHeading } = await import("@/lib/policies/group-heading");
  type Named = { productName: string | null; documentName: string };
  const wording: Named[] = [{ productName: null, documentName: "Example Life policy wording" }];
  const groups: [string, Named[]][] = [["doc:a", wording], ["doc:b", wording], ["Example Shield", [{ productName: "Example Shield", documentName: "x" }]]];
  assert.equal(groupHeading(groups, "doc:a"), "Example Life policy wording (1 of 2)");
  assert.equal(groupHeading(groups, "doc:b"), "Example Life policy wording (2 of 2)");
  assert.equal(groupHeading(groups, "Example Shield"), "Example Shield");
});

test("the names it gives", async () => {
  const { documentName } = await import("@/lib/policies/document-name");
  assert.equal(documentName({ product_name: null, original_filename: "output_202609281146157.pdf", insurer: "Example General Pte. Ltd.", document_role: "endorsement" }), "Example General endorsement");
  assert.equal(documentName({ product_name: null, original_filename: "817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", insurer: "Example Life", document_role: "policy_wording" }), "Example Life policy wording");
  assert.equal(documentName({ product_name: "Example Shield", original_filename: "x.pdf" }), "Example Shield");
});

/** "Which documents haven't been fully read?" lists every file not read in full, in the words other answers use: a file
 * the benefit table has not read ("has not had its benefits read"), one read past some pages, one with details not matched
 * to their page (the Documents page's words), and one read in part by the upload check. A linked file uploaded for someone
 * else says so as one contrast (launch checklist C10, 17 Nov). Made-up household; no model, database or network.
 *   npm run simple:read-status-test */
import assert from "node:assert/strict";
import type { Household, HouseholdDocument } from "../../lib/simple-chat/library";
import { libraryFact, verifyAnswer } from "../../lib/simple-chat/verify";
import type { ModelStatement } from "../../lib/simple-chat/prompt";

let passed = 0;
const failed: string[] = [];
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log("ok - " + name); }
  catch (e) { failed.push(name); console.log("not ok - " + name + "\n  " + (e instanceof Error ? e.message : String(e))); }
}
const base: HouseholdDocument = {
  policyId: "dddddddd-0000-4000-8000-000000000001", name: "x.pdf", insurer: "Example Insurance", productName: null, policyNumber: null, documentType: null,
  documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-28", uploadedFor: "Rowan Hartley", linkedPeople: ["Rowan Hartley"],
  supersededAt: null, processingStatus: "ready", pages: [{ page: 1, text: "Example schedule" }], tableState: "read",
};
const doc = (n: number, extra: Partial<HouseholdDocument>): HouseholdDocument => ({ ...base, policyId: `dddddddd-0000-4000-8000-00000000000${n}`, ...extra });
const HOUSE: Household = {
  accountId: "33333333-3333-4333-8333-333333333333",
  members: [{ name: "Rowan Hartley", relationship: "self" }, { name: "Mei Hartley", relationship: "spouse" }],
  documents: [
    doc(1, { name: "Shield.pdf", productName: "Example Shield" }),
    doc(2, { name: "Booklet.pdf", productName: null, documentRole: "scheme_reference", tableState: "no_table" }),
    doc(3, { name: "Plan W.pdf", productName: "Plan W", needsReview: true }),
    doc(4, { name: "Plan E.pdf", productName: "Plan E", linkedPeople: ["Mei Hartley"], partCheckedPages: [3] }),
    doc(5, { name: "Plan C.pdf", productName: "Plan C", tableState: "read_in_part:7,8" }),
    doc(6, { name: "Receipt.pdf", productName: null, documentRole: "premium_receipt", tableState: "no_table" }),
  ],
};
const st = (text: string, document: string | null): ModelStatement => ({ kind: "fact", text, person: null, document, quote: null, amount: null, alternativeGroup: null, percentOf: null, conditions: [] });

check("every file not read in full is listed, even when the model named one", () => {
  const { answer } = verifyAnswer(HOUSE, { bottomLine: "Nothing here is unreadable.", nextSteps: [], question: null, statements: [st("Plan E was read in part.", "D4")] },
    ["Which of our documents haven't been fully read?"]);
  const t = answer.statements!.map((x) => x.text).join("\n");
  // Named as its Documents page card is titled, never by its file name when that only repeats the title (post-#539 check).
  assert.match(t, /^Booklet was read\. It has not had its benefits read, so no cover or amount from it is counted in answers\./m, t);
  assert.doesNotMatch(t, /\.pdf/, t);
  assert.match(t, /Plan W[^\n]*could not be matched to the page they came from/, t);
  assert.match(t, /Plan E[^\n]*was read in part/, t);
  assert.match(t, /Plan C[^\n]*Its benefits were read in part: pages 7 and 8 could not be read/, t);
  assert.doesNotMatch(t, /Shield\.pdf/, t);
  assert.doesNotMatch(t, /Receipt\.pdf/, t);
  assert.match(t, /Plan E[^\n]*It is linked to Mei Hartley in DearPolicy, but it was uploaded for Rowan Hartley\./, t);
});
check("whom a file was uploaded for is said as one contrast with whom it is linked to", () => {
  assert.doesNotMatch(libraryFact(HOUSE, HOUSE.documents[3]), /\. It was uploaded for/);
  assert.match(libraryFact(HOUSE, doc(7, { name: "Loose.pdf", linkedPeople: [] })), /not linked to anyone[^\n]*uploaded for Rowan Hartley/);
});
check("a question not about reading lists only what the model named (negative control)", () => {
  const { answer } = verifyAnswer(HOUSE, { bottomLine: "", nextSteps: [], question: null, statements: [st("Plan E is linked to Mei.", "D4")] }, ["Which documents are linked to Mei?"]);
  const t = answer.statements!.map((x) => x.text).join("\n");
  assert.doesNotMatch(t, /Booklet/, t);
});
check("a table state is said of the benefits, never against 'was read' (Critic on #521, M1)", () => {
  for (const [state, words] of [["not_readable", "Its benefits could not be read"], ["waiting", "Its benefits are still being read"], ["stalled", "The reading of its benefits stopped"], ["held", "The reading of its benefits is on hold"]] as const) {
    const t = libraryFact(HOUSE, doc(8, { name: "Plan X.pdf", productName: "Plan X", tableState: state }));
    assert.match(t, new RegExp(`was read\\. ${words}`), t);
    assert.doesNotMatch(t, /\. It (?:could not be read|is still being read|stopped being read|is on hold)/, t);
  }
  assert.doesNotMatch(libraryFact(HOUSE, doc(9, { name: "Old.pdf", supersededAt: "2026-11-01", tableState: "no_table" })), /benefits/);
});
check("only a which/what/any/all question about files being read lists them all (Critic on #521, M2)", () => {
  const ask = (q: string) => verifyAnswer(HOUSE, { bottomLine: "", nextSteps: [], question: null, statements: [st("Plan E is linked to Mei.", "D4")] }, [q]).answer.statements!.map((x) => x.text).join("\n");
  for (const q of ["Which of our documents haven't been fully read?", "Were all my files read?", "Are any documents unreadable?", "What documents could not be read?"]) assert.match(ask(q), /Booklet/, q);
  for (const q of ["Can you read the document I uploaded and tell me if I'm covered for dental?", "Did you read my Example Shield document?",
    "What does my uploaded file say about dental? Did you read it?", "I read in my documents that dental is covered. Is it?"]) assert.doesNotMatch(ask(q), /Booklet/, q);
});
console.log(`\n${passed} read-status checks passed, ${failed.length} failed`);
if (failed.length) process.exit(1);

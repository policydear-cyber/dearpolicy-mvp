/** An answer that shows amounts for a person while some of that person's documents gave it nothing never reads as the
 * person's whole cover (fresh-start run 10 Nov: a death answer showed one policy's figure while another policy's benefits
 * were unread). The bottom line says the amounts may not be all of it and names those documents: not read, read in part,
 * still being read, on hold, or whose benefits the benefit table could not read. Receipts and letters, superseded copies
 * and other people's documents are never named. The pure check (noteCoverNotCounted) and the app's own chat turn
 * (runSimpleChat, scripted model). Made-up household; no model, network or database.
 *   npm run simple:cover-not-counted-test */
import assert from "node:assert/strict";
import type { StructuredAnswer } from "@/components/answer-cards";
import type { ChatContext } from "@/lib/chat/workflow";
import type { Household, HouseholdDocument } from "@/lib/simple-chat/library";
import type { SimpleModel } from "@/lib/simple-chat/model";
import { noteCoverNotCounted } from "@/lib/simple-chat/verify";
import { runSimpleChat } from "@/lib/simple-chat/hook";

let passed = 0;
const failed: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log("ok - " + name); }
  catch (e) { failed.push(name); console.log("not ok - " + name + "\n  " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); }
}

const JANE = "Jane Doe", JOHN = "John Roe";
const base: HouseholdDocument = {
  policyId: "dddddddd-0000-4000-8000-000000000001", name: "harbour-life.pdf", insurer: "Harbour Assurance", productName: "Harbour Term Life",
  policyNumber: null, documentType: null, documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-11-01",
  uploadedFor: JANE, linkedPeople: [JANE], supersededAt: null, processingStatus: "ready",
  pages: [{ page: 1, text: "Harbour Term Life policy schedule\nLife assured: Jane Doe\nDeath Benefit S$5,000" }],
};
const doc = (n: number, extra: Partial<HouseholdDocument>): HouseholdDocument =>
  ({ ...base, policyId: `dddddddd-0000-4000-8000-00000000000${n}`, name: `doc-${n}.pdf`, ...extra });
const READ = doc(1, { name: "harbour-life.pdf" });
const UNREAD_TABLE = doc(2, { productName: "Kestrel Whole Life", insurer: "Kestrel Life", pages: [{ page: 1, text: "Kestrel Whole Life schedule" }] });
const FAILED = doc(3, { productName: "Osprey Critical Care", processingStatus: "failed", pages: [] });
const IN_PART = doc(4, { productName: "Plover Accident Plan", partCheckedPages: [2], pages: [{ page: 1, text: "Plover" }, { page: 2, text: "Plover benefits" }] });
const RECEIPT = doc(5, { productName: "Kestrel Premium Receipt", documentRole: "premium_receipt", processingStatus: "failed", pages: [] });
const OLD = doc(6, { productName: "Wren Old Copy", processingStatus: "failed", supersededAt: "2026-10-01", pages: [] });
const JOHNS = doc(7, { productName: "Heron Life Plan", processingStatus: "failed", uploadedFor: JOHN, linkedPeople: [JOHN], pages: [] });
const NOBODYS = doc(8, { productName: "Finch Family Plan", processingStatus: "failed", uploadedFor: null, linkedPeople: [], pages: [] });
const HOUSE = (documents: HouseholdDocument[]): Household => ({
  accountId: "33333333-3333-4333-8333-333333333333",
  members: [{ name: JANE, relationship: "self" }, { name: JOHN, relationship: "spouse" }],
  documents,
});
const answer = (amounts: { person: string | null; text?: string; amount?: string }[], bottomLine = "Jane's Harbour Term Life shows a death benefit; the amount is below."): StructuredAnswer => ({
  mode: "answer", summary: bottomLine, bottomLine, details: [], claimItems: [], nextSteps: [], confidence: "partial_match", citations: [], disclaimer: "", claimSessionId: null,
  questions: [], knownFacts: [], missingFacts: [], verifiedPolicyFactsOnly: true, verifiedPolicyFigures: [],
  statements: amounts.map((a, i) => ({ id: `s${i + 1}`, kind: "benefit_terms", text: a.text ?? "Death Benefit.", fullText: a.text ?? "Death Benefit.", personName: a.person,
    amount: { text: a.amount ?? "S$5,000", currencyResolved: true, illustration: false }, basis: null, conditions: [], asOf: null, source: null, group: null })),
} as unknown as StructuredAnswer);

async function main() {
  await check("the benefit table could not read a policy of hers: the bottom line says the amount is not her whole cover, and names it", () => {
    const a = answer([{ person: JANE }]);
    const said = noteCoverNotCounted(a, HOUSE([READ, UNREAD_TABLE]), new Map([[READ.policyId, "read"], [UNREAD_TABLE.policyId, "table_unread"]]));
    assert.ok(said);
    assert.match(a.bottomLine!, /^Jane's Harbour Term Life shows a death benefit; the amount is below\. This may not be all of Jane Doe’s cover: Kestrel Whole Life could not have its benefits read, so any cover in it is not counted here and the amounts shown are not a total\.$/);
    assert.equal(a.summary, a.bottomLine);
    assert.doesNotMatch(said!, /\d/, "no figure in the note");
  });
  await check("not read, read in part, still being read and on hold are each named; a fully read document is not", () => {
    const reading = doc(9, { productName: "Gannet Saver", processingStatus: "extracting", readingLive: true, pages: [] });
    const a = answer([{ person: JANE }]);
    noteCoverNotCounted(a, HOUSE([READ, FAILED, IN_PART, reading]));
    assert.match(a.bottomLine!, /Osprey Critical Care could not be read, Plover Accident Plan was read only in part and Gannet Saver is still being read, so any cover in them is not counted here/);
    assert.doesNotMatch(a.bottomLine!, /Harbour Term Life (could|was|is still)/);
  });
  await check("receipts, superseded copies and another person's documents are never named", () => {
    const a = answer([{ person: JANE }]);
    assert.equal(noteCoverNotCounted(a, HOUSE([READ, RECEIPT, OLD, JOHNS]), null), null);
    assert.equal(a.bottomLine, "Jane's Harbour Term Life shows a death benefit; the amount is below.");
  });
  await check("a document linked to nobody may be anyone's: it is named for whoever the amounts are for", () => {
    const a = answer([{ person: JANE }, { person: JOHN, amount: "S$9,000" }]);
    noteCoverNotCounted(a, HOUSE([READ, NOBODYS, JOHNS]));
    assert.match(a.bottomLine!, /This may not be all of Jane Doe’s cover: Finch Family Plan could not be read, so any cover in it/);
    assert.match(a.bottomLine!, /This may not be all of John Roe’s cover: Finch Family Plan could not be read and Heron Life Plan could not be read, so any cover in them/);
  });
  await check("an amount for no named person: every such document in the household is named", () => {
    const a = answer([{ person: null }]);
    noteCoverNotCounted(a, HOUSE([READ, JOHNS]));
    assert.match(a.bottomLine!, /This may not be all of your household’s cover: Heron Life Plan could not be read/);
  });
  await check("no amount shown, or only premiums: no note", () => {
    const none = answer([]);
    assert.equal(noteCoverNotCounted(none, HOUSE([READ, FAILED])), null);
    const premium = answer([{ person: JANE, text: "Annual premium (Harbour Term Life)." }]);
    assert.equal(noteCoverNotCounted(premium, HOUSE([READ, FAILED]), null, new Set(["Annual premium (Harbour Term Life)."])), null);
  });
  await check("every document read in full: no note", () => {
    const a = answer([{ person: JANE }]);
    assert.equal(noteCoverNotCounted(a, HOUSE([READ]), new Map([[READ.policyId, "read"]])), null);
  });
  await check("a document's own file name in the note is kept as a library name", () => {
    const own = doc(10, { name: "scan_20261101.pdf", productName: null, insurer: null, processingStatus: "failed", pages: [] });
    const a = answer([{ person: JANE }]);
    const said = noteCoverNotCounted(a, HOUSE([READ, own]));
    assert.ok(said);
    assert.match(said!, /scan_20261101\.pdf could not be read/);
    assert.ok(a.libraryNames?.includes("scan_20261101.pdf"));
  });

  await check("chat turn: the saved answer's bottom line carries the note", async () => {
    const house = HOUSE([READ, FAILED]);
    const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() {
      return { json: { bottomLine: "Jane's Harbour Term Life shows a death benefit; the amount is below.", statements: [
        { kind: "amount", person: JANE, text: "Death Benefit (Harbour Term Life).", amount: "S$5,000", quote: "Death Benefit S$5,000", document: "D1" }],
      nextSteps: [], question: null }, stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } }; } };
    const context = {
      request: { accountId: house.accountId, familyMemberId: null, question: "How much death cover does Jane have?", submittedQuestion: "How much death cover does Jane have?" },
      family: [{ id: "m1", display_name: JANE, preferred_name: null, relationship: "self" }], people: [],
      conversation: { id: "c1", account_id: house.accountId, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } },
      token: {}, holdings: [],
    } as unknown as ChatContext;
    const saved: { answer: StructuredAnswer }[] = [];
    await runSimpleChat(context, {}, { model, household: async () => house, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false, table: async () => null,
      today: () => new Date("2026-11-10T04:00:00Z") });
    const a = saved[0].answer;
    assert.ok(a.statements!.some((s) => s.amount?.text === "S$5,000"), "the amount card is shown");
    assert.match(a.bottomLine!, /This may not be all of Jane Doe’s cover: Osprey Critical Care could not be read/);
    assert.equal(a.summary, a.bottomLine);
  });

  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main();

/** An answer that shows amounts for a person while some of that person's documents gave it nothing never reads as the
 * person's whole cover (fresh-start run 10 Nov: a death answer showed one policy's figure while another policy's benefits
 * were unread). Since 18 Nov (DC: an overview that opened with file names, "read only in part", "not counted here" and
 * "not a total" read as a refund request) that is one short plain line, the answer's last point, never in the bottom
 * line: product names (two at most), else a count, never a file name and never "not a total". Not read, read in part,
 * still being read, on hold, or whose benefits the benefit table could not read all count. Receipts and letters,
 * superseded copies and other people's documents never do. The pure check (noteCoverNotCounted) and the app's own chat turn
 * (runSimpleChat, scripted model). Made-up household; no model, network or database.
 *   npm run simple:cover-not-counted-test */
import assert from "node:assert/strict";
import type { StructuredAnswer } from "@/components/answer-cards";
import type { ChatContext } from "@/lib/chat/workflow";
import type { Household, HouseholdDocument } from "@/lib/simple-chat/library";
import type { SimpleModel } from "@/lib/simple-chat/model";
import { noteCoverNotCounted } from "@/lib/simple-chat/verify";
import { runSimpleChat } from "@/lib/simple-chat/hook";
import { COVER_NOTE_ID } from "@/lib/chat/cover-note";

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

const BOTTOM = "Jane's Harbour Term Life shows a death benefit; the amount is below.";
const noteOf = (a: StructuredAnswer) => (a.statements ?? []).filter((s) => s.id === COVER_NOTE_ID).map((s) => s.text);
/** The one note, checked for what it must never say, and that it is the last point and the bottom line is untouched. */
function oneNote(a: StructuredAnswer, bottom = BOTTOM): string {
  const notes = noteOf(a);
  assert.equal(notes.length, 1, JSON.stringify(a.statements));
  assert.equal(a.statements!.at(-1)!.id, COVER_NOTE_ID, "the note is the last point");
  assert.equal(a.bottomLine, bottom, "the bottom line is the answer only");
  assert.doesNotMatch(notes[0], /not a total|not counted|\.pdf\b|\d/i, notes[0]);
  return notes[0];
}

async function main() {
  await check("the benefit table could not read a policy of hers: one plain line at the end names it", () => {
    const a = answer([{ person: JANE }]);
    const said = noteCoverNotCounted(a, HOUSE([READ, UNREAD_TABLE]), new Map([[READ.policyId, "read"], [UNREAD_TABLE.policyId, "table_unread"]]));
    assert.equal(said, "Kestrel Whole Life is not fully read, so some details may be missing.");
    assert.equal(oneNote(a), said);
    assert.equal(a.summary, BOTTOM);
  });
  await check("not read, read in part, still being read and on hold all count; more than two is a count, never a list of names", () => {
    const reading = doc(9, { productName: "Gannet Saver", processingStatus: "extracting", readingLive: true, pages: [] });
    const a = answer([{ person: JANE }]);
    noteCoverNotCounted(a, HOUSE([READ, FAILED, IN_PART, reading]));
    assert.equal(oneNote(a), "Three documents are not fully read, so some details may be missing (the Documents page shows which).");
    const two = answer([{ person: JANE }]);
    noteCoverNotCounted(two, HOUSE([READ, FAILED, IN_PART]));
    assert.equal(oneNote(two), "Osprey Critical Care and Plover Accident Plan are not fully read, so some details may be missing.");
  });
  await check("only documents still being read: says so, never that details may be missing", () => {
    const reading = doc(9, { productName: "Gannet Saver", processingStatus: "extracting", readingLive: true, pages: [] });
    const a = answer([{ person: JANE }]);
    noteCoverNotCounted(a, HOUSE([READ, reading]));
    assert.equal(oneNote(a), "Gannet Saver is still being read, so its details are not included yet.");
  });
  await check("a policy whose table reading read past a page counts, whether or not an amount shown comes from it (Critic and TE #404)", async () => {
    const { tableStateKey } = await import("@/lib/benefit-table/service");
    const states = (pages: number[]) => new Map([[READ.policyId, "read"], [UNREAD_TABLE.policyId, tableStateKey({ state: "read_in_part", unreadPages: pages })]]);
    const fromIt = () => { const a = answer([{ person: JANE }]); (a.statements![0] as { source: unknown }).source = { policyName: "Kestrel Whole Life", page: 3, citationIds: [] }; return a; };
    const a = fromIt();
    noteCoverNotCounted(a, HOUSE([READ, UNREAD_TABLE]), states([23]));
    assert.equal(oneNote(a), "Kestrel Whole Life is not fully read, so some details may be missing.");
    const m = answer([{ person: JANE }]);
    (m.statements![0] as { source: unknown }).source = { policyName: "Harbour Term Life", page: 1, citationIds: [] };
    noteCoverNotCounted(m, HOUSE([READ, UNREAD_TABLE]), states([23]));
    assert.equal(oneNote(m), "Kestrel Whole Life is not fully read, so some details may be missing.");
  });
  await check("receipts, superseded copies and another person's documents are never named", () => {
    const a = answer([{ person: JANE }]);
    assert.equal(noteCoverNotCounted(a, HOUSE([READ, RECEIPT, OLD, JOHNS]), null), null);
    assert.equal(a.bottomLine, BOTTOM);
    assert.equal(noteOf(a).length, 0);
  });
  await check("a letter the table says is a misfiled pack (its cover still to read) is named; a plain letter is not (Critic #402 L)", () => {
    const pack = doc(11, { productName: "Bittern Life Plan", documentRole: "insurer_letter", pages: [{ page: 1, text: "Cover letter" }, { page: 2, text: "Policy Schedule" }] });
    const letter = doc(12, { productName: "Bittern Renewal Letter", documentRole: "insurer_letter", pages: [{ page: 1, text: "Letter" }] });
    for (const state of ["table_unread", "waiting"]) {
      const a = answer([{ person: JANE }]);
      noteCoverNotCounted(a, HOUSE([READ, pack, letter]), new Map([[READ.policyId, "read"], [pack.policyId, state], [letter.policyId, "no_table"]]));
      assert.equal(oneNote(a), state === "waiting" ? "Bittern Life Plan is still being read, so its details are not included yet." : "Bittern Life Plan is not fully read, so some details may be missing.");
    }
    const a = answer([{ person: JANE }]);
    assert.equal(noteCoverNotCounted(a, HOUSE([READ, pack]), new Map([[READ.policyId, "read"], [pack.policyId, "no_table"]])), null, "no_table letter: not named");
  });
  await check("a document linked to nobody may be anyone's: it counts for whoever the amounts are for, said once", () => {
    const a = answer([{ person: JANE }, { person: JOHN, amount: "S$9,000" }]);
    noteCoverNotCounted(a, HOUSE([READ, NOBODYS, JOHNS]));
    assert.equal(oneNote(a), "Finch Family Plan and Heron Life Plan are not fully read, so some details may be missing.");
    const jane = answer([{ person: JANE }]);
    noteCoverNotCounted(jane, HOUSE([READ, NOBODYS, JOHNS]));
    assert.equal(oneNote(jane), "Finch Family Plan is not fully read, so some details may be missing.");
  });
  await check("an amount for no named person: every such document in the household counts", () => {
    const a = answer([{ person: null }]);
    noteCoverNotCounted(a, HOUSE([READ, JOHNS]));
    assert.equal(oneNote(a), "Heron Life Plan is not fully read, so some details may be missing.");
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
  await check("a document with no product name is never named by its file name: the line is a count", () => {
    const own = doc(10, { name: "scan_20261101.pdf", productName: null, insurer: null, processingStatus: "failed", pages: [] });
    const a = answer([{ person: JANE }]);
    const said = noteCoverNotCounted(a, HOUSE([READ, own]));
    assert.equal(said, "One document is not fully read, so some details may be missing (the Documents page shows which).");
    assert.equal(oneNote(a), said);
    const booklet = doc(13, { name: "InformationBookletForTheNewlyInsured.pdf", productName: null, insurer: null, processingStatus: "ready" });
    const b = answer([{ person: JANE }]);
    noteCoverNotCounted(b, HOUSE([READ, booklet, UNREAD_TABLE]), new Map([[READ.policyId, "read"], [booklet.policyId, "no_table"], [UNREAD_TABLE.policyId, "table_unread"]]));
    assert.equal(oneNote(b), "Two documents are not fully read, so some details may be missing (the Documents page shows which).");
  });
  await check("the model repeats an earlier turn's note (old bottom-line wording or today's line): the note is said once, as this turn has it (TE #402)", () => {
    const OLD_NOTE = "This may not be all of Jane Doe’s cover: Osprey Critical Care could not be read and Plover Accident Plan was read only in part, so any cover in them is not counted here and the amounts shown are not a total.";
    const OLD_PART = "The cover shown from Plover Accident Plan may be incomplete (page 2 could not be read), so the amounts shown may not be a total.";
    for (const echoed of [OLD_NOTE, OLD_NOTE.replace(/’/g, "'"), OLD_PART, "Osprey Critical Care and Plover Accident Plan are not fully read, so some details may be missing."]) {
      const again = answer([{ person: JANE }], `${BOTTOM} ${echoed}`);
      noteCoverNotCounted(again, HOUSE([READ, FAILED, IN_PART]));
      assert.equal(oneNote(again), "Osprey Critical Care and Plover Accident Plan are not fully read, so some details may be missing.");
      // Everything now read (the same documents, read in full since): the repeated note goes, and nothing else of the bottom line.
      const done = answer([{ person: JANE }], `${BOTTOM} ${echoed}`);
      const readNow = [READ, { ...FAILED, processingStatus: "ready", pages: [{ page: 1, text: "Osprey" }] }, { ...IN_PART, partCheckedPages: [] }];
      assert.equal(noteCoverNotCounted(done, HOUSE(readNow)), null);
      assert.equal(done.bottomLine, BOTTOM);
    }
    // A point of the model's own that only repeats the note goes; one that says more stays.
    const pts = answer([{ person: JANE }]);
    pts.statements!.push({ id: "m1", kind: "uncertainty", text: "Plover Accident Plan is not fully read, so some details may be missing.", fullText: "", conditions: [] } as never,
      { id: "m2", kind: "fact", text: "Plover Accident Plan pays for fractures.", fullText: "", conditions: [] } as never);
    noteCoverNotCounted(pts, HOUSE([READ, IN_PART]));
    assert.deepEqual(pts.statements!.map((s) => s.id), ["s1", "m2", COVER_NOTE_ID]);
  });
  await check("chat turns: the saved answer carries the note once, as its last point, on the next turn too", async () => {
    const house = HOUSE([READ, FAILED]);
    const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() {
      return { json: { bottomLine: BOTTOM, statements: [
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
    assert.equal(oneNote(a), "Osprey Critical Care is not fully read, so some details may be missing.");
    assert.equal(a.summary, BOTTOM);
    // Turn two: the model repeats turn one's note, which its history carries, as a point: the note is said once.
    const echo: SimpleModel = { choice: model.choice, async call() {
      return { json: { bottomLine: BOTTOM, statements: [
        { kind: "amount", person: JANE, text: "Death Benefit (Harbour Term Life).", amount: "S$5,000", quote: "Death Benefit S$5,000", document: "D1" },
        { kind: "uncertainty", person: null, text: "Osprey Critical Care is not fully read, so some details may be missing.", amount: null, quote: null, document: null }],
      nextSteps: [], question: null }, stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } }; } };
    await runSimpleChat(context, {}, { model: echo, household: async () => house, history: async () => [{ role: "user", text: "How much death cover does Jane have?" }, { role: "assistant", text: a.bottomLine! }],
      save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false, table: async () => null, today: () => new Date("2026-11-10T04:00:00Z") });
    const b = saved[1].answer;
    assert.equal(oneNote(b), "Osprey Critical Care is not fully read, so some details may be missing.");
    assert.equal(b.statements!.filter((s) => /not fully read/.test(s.text)).length, 1);
  });
  await check("only the note's own sentences are taken out: the model's own words that end the same way stay (Critic #539 MED1, LOW1)", () => {
    const own = [
      "Alex has a plan and Plover Accident Plan is not fully read, so some details may be missing.",
      "Jane's Plover Accident Plan pays on a fracture, but it is not fully read, so some details may be missing.",
    ];
    for (const bottom of own) {
      const a = answer([{ person: JANE }], bottom);
      noteCoverNotCounted(a, HOUSE([READ, IN_PART]));
      assert.equal(a.bottomLine, bottom, "the bottom line is kept whole");
      const p = answer([{ person: JANE }]);
      p.statements!.push({ id: "m1", kind: "fact", text: bottom, fullText: "", conditions: [] } as never);
      noteCoverNotCounted(p, HOUSE([READ, IN_PART]));
      assert.ok(p.statements!.some((s) => s.id === "m1"), "the point is kept");
    }
    // A product name with full stops in it is still matched when the model repeats the note.
    const dotted = doc(14, { productName: "Prudential Pte. Ltd. Shield", partCheckedPages: [2], pages: [{ page: 1, text: "x" }, { page: 2, text: "y" }] });
    const echo = answer([{ person: JANE }], `${BOTTOM} Prudential Pte. Ltd. Shield is not fully read, so some details may be missing.`);
    noteCoverNotCounted(echo, HOUSE([READ, dotted]));
    assert.equal(oneNote(echo), "Prudential Pte. Ltd. Shield is not fully read, so some details may be missing.");
  });
  await check("an answer with no amounts keeps the model's own words about reading, even in the note's wording (TE #539 M1)", () => {
    const said = "Osprey Critical Care and Plover Accident Plan are not fully read, so some details may be missing.";
    const a = answer([], said);
    a.statements = [{ id: "m1", kind: "fact", text: "Plover Accident Plan is not fully read, so some details may be missing.", fullText: "", conditions: [] } as never];
    assert.equal(noteCoverNotCounted(a, HOUSE([READ, FAILED, IN_PART])), null);
    assert.equal(a.bottomLine, said);
    assert.deepEqual(a.statements!.map((s) => s.id), ["m1"]);
    // The old wording, only ever the server's, still goes.
    const old = answer([], `${BOTTOM} This may not be all of Jane Doe’s cover: Osprey Critical Care could not be read, so any cover in it is not counted here and the amounts shown are not a total.`);
    noteCoverNotCounted(old, HOUSE([READ, FAILED]));
    assert.equal(old.bottomLine, BOTTOM);
  });

  await check("a document the answer's own points already list is not counted again; others still are (post-#539 check)", () => {
    const a = answer([{ person: JANE }]);
    assert.equal(noteCoverNotCounted(a, HOUSE([READ, FAILED, IN_PART]), null, new Set(), new Set([FAILED.policyId, IN_PART.policyId])), null);
    assert.equal(noteOf(a).length, 0);
    const b = answer([{ person: JANE }]);
    noteCoverNotCounted(b, HOUSE([READ, FAILED, IN_PART]), null, new Set(), new Set([FAILED.policyId]));
    assert.equal(oneNote(b), "Plover Accident Plan is not fully read, so some details may be missing.");
  });
  // Live f954eb2, post-#539 check: "How much death cover does Desmond have, and which of his documents aren't fully read?"
  // gave three counts in one answer: the lead said "Two", the server's list named four and the note line said "Three".
  const mixed = async (question: string, bottomLine: string) => {
    const house = HOUSE([READ, FAILED, IN_PART]);
    const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() {
      return { json: { bottomLine, statements: [
        { kind: "amount", person: JANE, text: "Death Benefit (Harbour Term Life).", amount: "S$5,000", quote: "Death Benefit S$5,000", document: "D1" },
        { kind: "fact", person: null, text: "Osprey Critical Care could not be read.", amount: null, quote: null, document: "D2" }],
      nextSteps: [], question: null }, stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } }; } };
    const context = {
      request: { accountId: house.accountId, familyMemberId: null, question, submittedQuestion: question },
      family: [{ id: "m1", display_name: JANE, preferred_name: null, relationship: "self" }], people: [],
      conversation: { id: "c1", account_id: house.accountId, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } },
      token: {}, holdings: [],
    } as unknown as ChatContext;
    const saved: { answer: StructuredAnswer }[] = [];
    await runSimpleChat(context, {}, { model, household: async () => house, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false, table: async () => null,
      today: () => new Date("2026-11-10T04:00:00Z") });
    return saved[0].answer;
  };
  await check("a question about cover and about reading: one count only, the record's list (post-#539 check)", async () => {
    const a = await mixed("How much death cover does Jane have, and which of her documents aren't fully read?",
      "Jane has a death benefit from Harbour Term Life. Two of her documents are not fully read.");
    const said = [a.bottomLine, ...a.statements!.map((s) => s.text)].join("\n");
    assert.ok(a.statements!.some((s) => s.amount?.text === "S$5,000"), said);
    assert.equal(a.bottomLine, "Jane has a death benefit from Harbour Term Life.", said);
    assert.equal(noteOf(a).length, 0, said);
    assert.match(said, /Osprey Critical Care could not be read/);
    assert.match(said, /Plover Accident Plan was read in part/);
    assert.doesNotMatch(said, /\b(?:two|three|four)\b[^.]*\bdocuments?\b[^.]*not fully read/i, said);
    assert.doesNotMatch(said, /\.pdf\b/, said);
  });
  await check("a count the model gives when the question is not about reading stays (negative control)", async () => {
    const lead = "Jane has a death benefit from Harbour Term Life. Two of her documents are not fully read.";
    const a = await mixed("How much death cover does Jane have?", lead);
    assert.equal(a.bottomLine, lead);
  });

  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main();

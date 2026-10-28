/** The note "Waiting periods, exclusions and other conditions can be printed on pages not used for this answer. Check the
 * full document, or ask the insurer, before you claim." (NARROWED_PAGES_NOTE, Critic R113-1) goes with every answer that
 * gives a benefit amount from the table, and only an answer whose every amount is a premium row's own card goes without it:
 * a premium is charged, never claimed (real-model check on a made-up household, 28 Oct: "how is my monthly premium split?"
 * ended with it). Whether a row is a premium is the row's own provenance (the cover line's premium, its parts, the first
 * year's premium: ChatRow.premium), never its name: a benefit named for premiums ("Waiver of Premium") keeps the note.
 * Made-up household, the app's own chat turn (runSimpleChat) with a scripted model reply. No model, network or database.
 *   npm run benefit-table:claim-note-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { NARROWED_PAGES_NOTE, chatRows, noteNarrowedPages } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { runSimpleChat } from "@/lib/simple-chat/hook";
import type { SimpleModel, SimpleModelCall } from "@/lib/simple-chat/model";
import type { ChatContext } from "@/lib/chat/workflow";

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const SCHED = "cccccccc-0000-0000-0000-000000000001", WORD = "cccccccc-0000-0000-0000-000000000002";
const family: FamilyMember[] = [{ id: "p1", display_name: "Lim Ah Kow" }, { id: "p2", display_name: "Tan Mei Ling" }];
const doc = (policyId: string, name: string, pages: { page: number; text: string }[]) => ({ policyId, name, insurer: "Example Insurance", productName: name.replace(/\.pdf$/, ""), policyNumber: null,
  documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: ["Lim Ah Kow"], supersededAt: null, processingStatus: "ready", pages });
const SCHEDULE = "POLICY SCHEDULE\nLife Insured\t: Lim Ah Kow\nCurrency\t: Singapore Dollar\nAnnual Premium\t: 512.40\nPayment Frequency\t: Annual\n"
  + "Benefit\tSum Insured\tAnnual Premium\tExpiry Date\n"
  + "Critical Illness Protector\t150,000.00\t380.10\t15/03/2041\n- Health Extra\t---\t132.30\t15/03/2041\nAccidental Death\t50,000.00\t---\t15/03/2041";
const WORDING = "3. WHAT WE PAY\nEarly Stage Benefit Limit: S$50,000\nCompensation (% of S$50,000)\nEarly Stage Critical Illness\t50%";
const WAIVER = "3.3 Waiver of Premium Benefit\nWaiver of Premium Benefit up to S$5,000 of future premiums on diagnosis of a Critical Illness.";
const HOUSE = { accountId: "44444444-4444-4444-4444-444444444444", members: [{ name: "Lim Ah Kow", relationship: "self" }, { name: "Tan Mei Ling", relationship: "spouse" }],
  documents: [doc(SCHED, "Schedule.pdf", [{ page: 1, text: SCHEDULE }]), doc(WORD, "Policy wording.pdf", [{ page: 2, text: WORDING }, { page: 3, text: WAIVER }, { page: 7, text: "GENERAL\nThe policy is governed by the law of Singapore." }])] } as Household;
const src = (d: Household["documents"][number]): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages, people: ["Lim Ah Kow"] } as SourceDoc);
const reading = (kind: string, covers: unknown[], benefits: unknown[]) => ({ document: { kind, product: "CI Protector", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers, benefits });
const ben = (o: Record<string, unknown>) => ({ section: "Benefits", column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, ...o });
const TABLE = assembleTable([
  checkReading(src(HOUSE.documents[0]), reading("personal_proof", [{ person: "Lim Ah Kow", product: "CI Protector", cover: "Critical Illness Protector", plan: null, sumInsured: 150000, asOf: null,
    premium: 512.4, premiumFrequency: "Annual", page: 1, quote: "Critical Illness Protector\t150,000.00\t380.10\t15/03/2041" }], []) as never),
  checkReading(src(HOUSE.documents[1]), reading("policy_wording", [], [
    ben({ benefit: "Early Stage Critical Illness", pays: "percent", value: 50, percentOf: "fixed_amount", baseAmount: 50000, baseQuote: "Compensation (% of S$50,000)", quote: "Early Stage Critical Illness 50%" }),
    ben({ page: 3, benefit: "Waiver of Premium Benefit", pays: "up_to", value: 5000, quote: "Waiver of Premium Benefit up to S$5,000 of future premiums on diagnosis of a Critical Illness." }),
  ]) as never),
], family, [{ section: sectionKeyOf(WORD, { section: "Benefits", column: null }), cover: coverKeyOf({ product: "CI Protector", cover: "Critical Illness Protector", plan: null }), why: "wording" }], []);
const ROWS = chatRows(TABLE, HOUSE);
const rowOf = (re: RegExp) => { const r = ROWS.find((x) => re.test(x.benefit)); if (!r) throw new Error(`no row ${re} in ${ROWS.map((x) => x.benefit).join(" / ")}`); return r; };

/** One chat turn whose model reply gives an amount statement for each named row. */
async function turn(benefits: RegExp[]) {
  const ids = benefits.map((re) => rowOf(re).id);
  const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call(_c: SimpleModelCall) {
    return { json: { bottomLine: "Here is what your schedule prints.", nextSteps: [], question: null, statements: ids.map((row) => ({ kind: "amount", text: "x", person: "Lim Ah Kow", document: null, quote: null,
      amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, eventFit: "no_event", waiting: null, period: { from: "", to: "", eventOn: "" }, row })) },
    stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } }; } };
  const context = { request: { accountId: HOUSE.accountId, familyMemberId: null, question: "how is my premium split?", submittedQuestion: "how is my premium split?" },
    family: [{ id: "p1", display_name: "Lim Ah Kow", preferred_name: null, relationship: "self" }], people: [],
    conversation: { id: "c1", account_id: HOUSE.accountId, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } }, token: {}, holdings: [] } as unknown as ChatContext;
  const saved: { answer: { statements?: { amount: unknown; text: string }[] } }[] = [];
  await runSimpleChat(context, {}, { model, household: async () => HOUSE, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false,
    table: async () => TABLE, today: () => new Date("2026-10-28T04:00:00Z") });
  const st = saved[0].answer.statements ?? [];
  return { amounts: st.filter((s) => s.amount).length, notes: st.filter((s) => s.text === NARROWED_PAGES_NOTE).length };
}

const PREMIUM = /^Annual Premium, Annual$|^Premium, Annual$/;
const PART = /\(part of the/;
async function main() {
  await test("the fixture has premium rows (the premium and its two parts), a sum insured, a benefit and a benefit named for premiums", () => {
    assert.equal(ROWS.filter((r) => r.premium).length, 3, ROWS.map((r) => `${r.benefit}${r.premium ? " [premium]" : ""}`).join(" / "));
    assert.ok(!rowOf(/^Sum insured/).premium && !rowOf(/^Early Stage Critical Illness/).premium && !rowOf(/^Waiver of Premium/).premium);
  });
  await test("premium only: an answer giving the premium and its parts has no claim note", async () => {
    const t = await turn([PREMIUM, PART, /^Health Extra/]);
    assert.equal(t.amounts, 3, "all three premium cards are shown");
    assert.equal(t.notes, 0);
  });
  await test("premium only, one card: no claim note", async () => {
    const t = await turn([PREMIUM]);
    assert.equal(t.amounts, 1); assert.equal(t.notes, 0);
  });
  await test("benefit amount: the sum insured carries the claim note (Critic R113-1)", async () => {
    const t = await turn([/^Sum insured/]);
    assert.equal(t.amounts, 1); assert.equal(t.notes, 1);
  });
  await test("benefit amount: a percentage worked out on a printed base carries the claim note", async () => {
    const t = await turn([/^Early Stage Critical Illness/]);
    assert.equal(t.amounts, 1); assert.equal(t.notes, 1);
  });
  await test("mixed: a premium with a benefit amount carries the note once", async () => {
    const t = await turn([PREMIUM, /^Sum insured/]);
    assert.equal(t.amounts, 2); assert.equal(t.notes, 1);
  });
  await test("a benefit row named for premiums (not a premium line) carries the note: the name never decides", async () => {
    const t = await turn([/^Waiver of Premium/]);
    assert.equal(t.amounts, 1); assert.equal(t.notes, 1);
  });
  await test("a premium with a benefit named for premiums carries the note", async () => {
    const t = await turn([PREMIUM, /^Waiver of Premium/]);
    assert.equal(t.amounts, 2); assert.equal(t.notes, 1);
  });
  await test("unknown kind: an amount the server cannot tie to a premium row keeps the note; one that is keeps none", () => {
    const make = (id: string, text: string) => ({ id, kind: "uncertainty", text, amount: null as unknown });
    const card = { id: "s1", kind: "amount", text: "Instalment Premium, Monthly (Example Plan).", amount: { text: "S$350.50" } as unknown };
    const has = (st: { text: string }[]) => st.filter((x) => x.text === NARROWED_PAGES_NOTE).length;
    assert.equal(has(noteNarrowedPages([card], { dropped: [], labels: [card.text] }, make)), 1, "no premium labels recorded");
    assert.equal(has(noteNarrowedPages([card], { dropped: [], labels: [card.text], premiumLabels: ["Another premium."] }, make)), 1, "not one of them");
    assert.equal(has(noteNarrowedPages([card, { ...card, id: "s2", text: "A worked-out illustration." }], { dropped: [], labels: [card.text], premiumLabels: [card.text] }, make)), 1, "mixed");
    assert.equal(has(noteNarrowedPages([card], { dropped: [], labels: [card.text], premiumLabels: [card.text] }, make)), 0, "premium only");
    assert.equal(has(noteNarrowedPages([{ ...card, amount: null }], { dropped: [], labels: [] }, make)), 0, "no amount, no note");
  });
  console.log(`${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`FAIL ${f}`);
  if (failures.length) process.exitCode = 1;
}
void main();

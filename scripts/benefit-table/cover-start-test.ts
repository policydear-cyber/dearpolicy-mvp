/** Scripted test: a cover's age, for judging whether a waiting period may still run, comes from a printed start date and
 * never from an "as of" date (live check 26 Nov: an intensive care benefit of a 2024 policy was held back as "started
 * recently"). Where one cover is printed on two documents, a recent start on either copy still holds it. Made-up household;
 * no model, database or network.
 *   npm run -s benefit-table:cover-start-test */
import assert from "node:assert/strict";
import { assembleTable, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, coverStart, type ChatRow } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const NOW = new Date("2026-11-26T02:00:00Z");
const PERSON = "Lim Ah Kow";
const WAITING = "Critical Illness Plan\nWaiting Period: no benefit is payable for an illness within 90 days of the start date.";
const doc = (id: string, name: string, pages: { page: number; text: string }[]) => ({ policyId: id, name, insurer: "Testlife", productName: "Critical Illness Plan", policyNumber: null,
  documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-11-20", uploadedFor: null, linkedPeople: [PERSON], supersededAt: null, processingStatus: "ready", pages });
const family: FamilyMember[] = [{ id: "p1", display_name: PERSON }];
const reading = (covers: unknown[]) => ({ document: { kind: "personal_proof", product: "Critical Illness Plan", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers, benefits: [] });
const cover = (start: string | null, quote: string) => ({ person: PERSON, product: "Critical Illness Plan", cover: "Critical Illness Plan", plan: null, sumInsured: 100000, asOf: "20/11/2026", startDate: start, page: 1, quote });

/** Documents in the order they are read; `start` is the start date each prints, or null. */
function rowsFor(prints: (string | null)[]) {
  const docs = prints.map((start, i) => doc(`aaaaaaaa-0000-0000-0000-00000000000${i + 1}`, `Document ${i + 1}`, [
    { page: 1, text: `Critical Illness Plan\n${PERSON}\tS$100,000\t${start ? `Start ${start}\t` : ""}As of 20/11/2026` }, ...(i === 0 ? [{ page: 2, text: WAITING }] : [{ page: 2, text: WAITING }]) ]));
  const house: Household = { accountId: "11111111-1111-1111-1111-111111111111", members: [{ name: PERSON, relationship: "self" }], documents: docs } as never;
  const src = (d: (typeof docs)[number]): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages });
  const readings = docs.map((d, i) => checkReading(src(d), reading([cover(prints[i], `${PERSON} S$100,000 ${prints[i] ? `Start ${prints[i]} ` : ""}As of 20/11/2026`)])));
  const table = assembleTable(readings, family, [], []);
  return { table, house, rows: chatRows(table, house) };
}
const sumRow = (rows: ChatRow[]) => rows.find((r) => /^sum insured/i.test(r.benefit))!;
/** Whether the cover's sum insured card is shown for an illness (on_list), the model giving no waiting period. */
function shown(prints: (string | null)[]) {
  const { rows, house } = rowsFor(prints);
  const row = sumRow(rows);
  assert.ok(row, "the cover has a sum insured row");
  const out = amountsFromRows({ bottomLine: "q", nextSteps: [], question: null, statements: [{ kind: "amount", text: "x", person: PERSON, document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, eventFit: "on_list", waiting: null }] }, rows, house, NOW);
  return { shown: out.report.labels.length === 1, why: out.report.dropped.map((d) => d.why) };
}

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; void name; }

check("coverStart: a printed start only, the latest of the copies", () => {
  assert.equal(coverStart({ startDate: "11/02/2024" }), "11/02/2024");
  assert.equal(coverStart({ startDate: null }), null);
  assert.equal(coverStart({}), null);
  assert.equal(coverStart({ startDate: "11/02/2024", copyStarts: ["11/02/2024", "20/09/2026"] }), "20/09/2026");
  assert.equal(coverStart({ startDate: null, copyStarts: ["20/09/2026", "11/02/2024"] }), "20/09/2026");
});
check("an old printed start: shown", () => assert.deepEqual(shown(["11/02/2024"]), { shown: true, why: [] }));
check("a recent printed start: held, with its reason", () => {
  const r = shown(["20/09/2026"]);
  assert.equal(r.shown, false);
  assert.deepEqual(r.why, ["its cover started less than a year ago and no waiting period was checked"]);
});
check("no start printed anywhere, only a recent as-of date: not judged new, shown (the live ICU case)", () => assert.deepEqual(shown([null]), { shown: true, why: [] }));
check("two documents of one cover, the one with no start read first, a recent start on the other: held", () => {
  const r = shown([null, "20/09/2026"]);
  assert.equal(r.shown, false, "a recent start on a copy that was not kept still holds the card");
});
check("two documents, the recent start read first: held", () => assert.equal(shown(["20/09/2026", null]).shown, false));
check("two documents, an old start on one and none on the other: shown", () => assert.equal(shown([null, "11/02/2024"]).shown, true));
check("the one-year edge: 365 days ago is past every waiting period, 364 is not", () => {
  assert.equal(shown(["26/11/2025"]).shown, true);
  assert.equal(shown(["27/11/2025"]).shown, false);
});
check("the kept cover carries every copy's start", () => {
  const { table } = rowsFor([null, "20/09/2026"]);
  const c = table.people[0].covers[0] as { copyStarts?: string[] };
  assert.deepEqual(c.copyStarts, ["20/09/2026"]);
});
console.log(`cover-start test passed: ${passed} cases`);

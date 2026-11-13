/** A schedule's covers never vanish from Benefits because a reading listed them only as covers (live 13 Nov: a schedule
 * read again gave five covers with their sums and no benefit rows, and Benefits showed none of its lines). A cover read
 * from its own printed line with its sum gets that line as its row, through the usual checks; a line the page check held
 * back keeps a row with no figure. Never a second row for a line the reading already lists, never a row for a multi-line
 * quote, never another person's. Made-up schedules in S$, RM and HK$; no model, database or network.
 *   npm run -s benefit-table:cover-line-rows-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, sectionsOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { type SourceDoc } from "@/lib/benefit-table/check";
import { checkStored } from "@/lib/benefit-table/service";
import { chatRows } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const DOC = "eeeeeeee-0000-4000-8000-0000000000d1";
const ANN = "Tan Mei Ling Rachel", BEN = "Lim Wei Jie Daniel";
const family: FamilyMember[] = [{ id: "a", display_name: ANN }, { id: "b", display_name: BEN }];
type Line = [name: string, status: string, sum: string, premium: string];
const row = ([n, st, s, p]: Line) => `${n}\t${st}\t${s}\t${p}\t02-Mar-2015\t02-Mar-2040`;
const HEAD = "Component\tStatus\tSum Assured\tComponent Premium\tCover Start Date\tCover Expiry Date";
const num = (s: string) => (/\d/.test(s) && !s.includes("[") ? Number(s.replace(/[^\d.]/g, "")) : null);

/** One page per person block: [person, lines]. `benefits` adds reading rows (by line index into the first block). */
function read(blocks: [string, Line[]][], o: { benefits?: "all" | number[]; blockQuote?: boolean; currency?: string } = {}) {
  const text = ["Benefit Details", "Policy Number:\t70112233", ...(o.currency ? [`Currency:\t${o.currency}`] : []),
    ...blocks.flatMap(([p, ls]) => [`Life Assured Name:\t${p}`, HEAD, ...ls.map(row)]), "Example Assurance (Pte) Limited\tCONFIDENTIAL"].join("\n");
  const doc: SourceDoc = { id: DOC, name: "Schedule.pdf", readable: true, pages: [{ page: 1, text }] };
  const covers = blocks.flatMap(([p, ls]) => ls.map((l, i) => ({ person: p, product: "Harbour Protector", cover: l[0], plan: null, riderOf: i ? ls[0][0] : null,
    policyNumber: "70112233", sumInsured: num(l[2]), premium: num(l[3]), premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1,
    quote: o.blockQuote && i === 0 ? ls.map(row).join("\n") : row(l) })));
  const [, first] = blocks[0];
  const pick = o.benefits === "all" ? first.map((_, i) => i) : o.benefits ?? [];
  const benefits = pick.map((i) => ({ section: "Component", column: "Sum Assured", benefit: `${first[i][0]} Sum Assured`, pays: "amount", value: num(first[i][2]), period: null,
    basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: row(first[i]) }));
  // As the app checks a stored reading: all its parts together (service.ts checkStored).
  const r = checkStored(doc, { document: { document: { kind: "personal_proof", product: "Harbour Protector", insurer: null, namedPeople: blocks.map(([p]) => p), plan: null, periodFrom: null, periodTo: null },
    covers, benefits }, pages: [] });
  const t = assembleTable([r], family, []);
  const person = (n: string) => t.people.find((p) => p.name === n || (p as { displayName?: string }).displayName === n) ?? t.people[family.findIndex((f) => f.display_name === n)];
  const rows = (n: string) => person(n).rows.map((x) => ({ cover: x.cover, benefit: x.benefit, amount: x.figure.kind === "printed" || x.figure.kind === "worked_out" ? (x.figure as { amount: number }).amount : null }));
  return { r, t, rows, doc };
}
const LINES: Line[] = [["Harbour Protector", "In Force", "100,000.00", "150.00"], ["Accelerated Disability", "In Force", "13,500.00", "0.00"],
  ["Accident Death & Dismemberment III", "Manual Lapse", "10,000.00", "1.53"], ["Medical Reimbursement III", "Manual Lapse", "1,000.00", "2.13"]];

test("R1 covers only, no benefit rows: each cover's own line is its row with its sum, lapsed riders too", () => {
  const { rows } = read([[ANN, LINES]]);
  assert.deepEqual(rows(ANN).map((x) => [x.cover, x.amount]).sort(), LINES.map((l) => [l[0], num(l[2])]).sort());
});
test("R2 the reading already lists every line: no second row", () => {
  const { rows } = read([[ANN, LINES]], { benefits: "all" });
  assert.equal(rows(ANN).length, LINES.length);
  assert.ok(rows(ANN).every((x) => / Sum Assured$/.test(x.benefit)), JSON.stringify(rows(ANN)));
});
test("R3 control: a reading that lists any benefit row is shown as read (nothing added from cover lines)", () => {
  const { rows } = read([[ANN, LINES]], { benefits: [0, 2] });
  assert.deepEqual(rows(ANN).map((x) => x.amount).sort((a, b) => a! - b!), [10000, 100000]);
});
test("R9 a read row whose figures the page check held back stays, with no figure (5 rows stay 5)", () => {
  const masked: Line[] = [...LINES.slice(0, 3), ["Medical Reimbursement III", "Manual Lapse", "[amount not checked]", "[amount not checked]"]];
  const { rows } = read([[ANN, masked]], { benefits: "all" });
  assert.equal(rows(ANN).length, 4, JSON.stringify(rows(ANN)));
  assert.equal(rows(ANN).find((x) => /^Medical Reimbursement/.test(x.benefit))?.amount, null);
});
test("R4 a line the page check held back keeps a row with no figure", () => {
  const masked: Line[] = [...LINES.slice(0, 2), ["Medical Reimbursement III", "Manual Lapse", "[amount not checked]", "[amount not checked]"]];
  const { rows } = read([[ANN, masked]]);
  const m = rows(ANN).find((x) => x.cover === "Medical Reimbursement III");
  assert.ok(m, "the held-back rider keeps a row");
  assert.equal(m!.amount, null);
});
test("R5 a waiver rider's line gives no amount row (its figure is the waived premium)", () => {
  const { rows } = read([[ANN, [...LINES.slice(0, 2), ["Crisis Waiver III", "In Force", "150.00", "10.08"]]]]);
  assert.ok(rows(ANN).every((x) => x.amount !== 150), JSON.stringify(rows(ANN)));
});
test("R6 a cover quoted as a block of lines gives no row of its own", () => {
  const { rows } = read([[ANN, LINES]], { blockQuote: true });
  assert.ok(!rows(ANN).some((x) => x.cover === "Harbour Protector" && x.amount === 100000 && x.benefit === "Harbour Protector"), JSON.stringify(rows(ANN)));
});
test("R7 a joint schedule: each life's rows are its own, never the other's", () => {
  const { rows } = read([[ANN, [["Harbour Protector", "In Force", "100,000.00", "150.00"], ["Accelerated Disability", "In Force", "13,500.00", "0.00"]]],
    [BEN, [["Harbour Protector", "In Force", "300,000.00", "250.00"], ["Accelerated Disability", "In Force", "30,000.00", "0.00"]]]]);
  assert.deepEqual(rows(ANN).map((x) => x.amount).sort((a, b) => a! - b!), [13500, 100000]);
  assert.deepEqual(rows(BEN).map((x) => x.amount).sort((a, b) => a! - b!), [30000, 300000]);
});
test("R8 RM and HK$ schedules: the row carries the sum as printed", () => {
  for (const cur of ["RM", "HK$"]) {
    const { rows } = read([[ANN, [["Harbour Protector", "In Force", `${cur} 200,000.00`, `${cur} 300.00`], ["Payor Rider", "In Force", `${cur} 3,600.00`, `${cur} 22.00`]]]]);
    assert.deepEqual(rows(ANN).map((x) => x.amount).filter((a) => a != null), [200000], `${cur}: ${JSON.stringify(rows(ANN))}`);
  }
});

test("R10 a cover's own line is no section: nothing is asked about it, and every such row says it is the printed line", () => {
  const { r, t } = read([[ANN, LINES]]);
  assert.deepEqual(sectionsOf([r]), []);
  assert.ok(r.benefits.length === LINES.length && r.benefits.every((b) => b.coverLine), JSON.stringify(r.benefits.map((b) => b.coverLine)));
  assert.deepEqual(t.unlinkedSections, []);
  assert.ok(t.people[0].rows.every((x) => x.coverLine));
});
test("R11 once another document lists what the cover pays, its schedule line gives way (never both)", () => {
  const { r } = read([[ANN, LINES]]);
  const WORD = "eeeeeeee-0000-4000-8000-0000000000d2";
  const text = "Schedule of Benefits\nAccidental death\t100% of the Sum Assured\nTerminal illness\t100% of the Sum Assured";
  const w = checkStored({ id: WORD, name: "Wording.pdf", readable: true, pages: [{ page: 1, text }] }, { document: { document: { kind: "policy_wording", product: "Harbour Protector", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
    covers: [], benefits: [["Accidental death", "Accidental death\t100% of the Sum Assured"], ["Terminal illness", "Terminal illness\t100% of the Sum Assured"]].map(([benefit, quote]) => ({ section: "Schedule of Benefits", column: null, benefit, pays: "percent", value: 100, period: null,
      basis: null, asOf: null, percentOf: "sum_insured", baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote })) }, pages: [] });
  assert.equal(w.benefits.length, 2, JSON.stringify(w.dropped));
  const base = r.covers.find((c) => c.cover === "Harbour Protector")!;
  const t = assembleTable([r, w], family, [{ section: sectionKeyOf(WORD, w.benefits[0]), cover: coverKeyOf(base), why: "its wording" }]);
  const ann = t.people.find((p) => p.id === "a")!;
  assert.deepEqual(ann.rows.filter((x) => !x.coverLine).map((x) => x.benefit).sort(), ["Accidental death", "Terminal illness"]);
  // The base plan's own line gives way to its wording's rows; the riders' lines, which that wording does not list, stay.
  assert.deepEqual(ann.rows.filter((x) => x.coverLine).map((x) => [x.cover, x.figure.kind === "printed" ? x.figure.amount : null]).sort(),
    LINES.slice(1).map((l) => [l[0], num(l[2])]).sort());
});
test("R12 chat: a cover's line is never a second card beside its own \"Sum insured\" row", () => {
  const { t, doc } = read([[ANN, LINES]]);
  const rows = chatRows(t, { documents: [{ policyId: DOC, name: doc.name, pages: doc.pages }], members: [], people: [] } as unknown as Household);
  assert.ok(rows.length > 0 && rows.every((r) => !r.coverLine), JSON.stringify(rows.map((r) => [r.benefit, r.coverLine])));
  for (const l of LINES) assert.ok(rows.filter((r) => r.figure.kind === "printed" && r.figure.amount === num(l[2])).length <= 1, `${l[0]}: one card for its sum`);
});

console.log(`cover-line rows: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
if (failures.length) process.exit(1);

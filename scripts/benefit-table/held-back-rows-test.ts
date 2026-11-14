/** A benefit row whose figures the page check held back ("[amount not checked]") stays on Benefits with no figure, as its
 * cover stays on Coverage with no sum (live 13 Nov: a schedule read again had two rider lines held back, and their rows
 * vanished from Benefits, 5 rows to 3). A row with no figure for any other reason is still left out, and a checked figure
 * is still shown. Made-up schedules; no model, database or network.
 *   npm run -s benefit-table:held-back-rows-test */
import assert from "node:assert/strict";
import { assembleTable, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";

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
  const r = checkReading(doc, { document: { kind: "personal_proof", product: "Harbour Protector", insurer: null, namedPeople: blocks.map(([p]) => p), plan: null, periodFrom: null, periodTo: null },
    covers, benefits } as never);
  const t = assembleTable([r], family, []);
  const person = (n: string) => t.people.find((p) => p.name === n || (p as { displayName?: string }).displayName === n) ?? t.people[family.findIndex((f) => f.display_name === n)];
  const rows = (n: string) => person(n).rows.map((x) => ({ cover: x.cover, benefit: x.benefit, amount: x.figure.kind === "printed" || x.figure.kind === "worked_out" ? (x.figure as { amount: number }).amount : null }));
  return { r, t, rows };
}
const LINES: Line[] = [["Harbour Protector", "In Force", "100,000.00", "150.00"], ["Accelerated Disability", "In Force", "13,500.00", "0.00"],
  ["Accident Death & Dismemberment III", "Manual Lapse", "10,000.00", "1.53"], ["Medical Reimbursement III", "Manual Lapse", "1,000.00", "2.13"]];
const HELD: Line[] = [...LINES.slice(0, 2), ["Accident Death & Dismemberment III", "Manual Lapse", "[amount not checked]", "[amount not checked]"],
  ["Medical Reimbursement III", "Manual Lapse", "[amount not checked]", "[amount not checked]"]];

test("H1 two rider lines held back: all 4 rows stay, the two with no figure", () => {
  const { rows } = read([[ANN, HELD]], { benefits: "all" });
  assert.equal(rows(ANN).length, 4, JSON.stringify(rows(ANN)));
  assert.deepEqual(rows(ANN).map((x) => x.amount).sort((a, b) => (a ?? -1) - (b ?? -1)), [null, null, 13500, 100000]);
});
test("H2 the held-back riders' covers stay too, with no sum", () => {
  const { t } = read([[ANN, HELD]], { benefits: "all" });
  const covers = t.people[0].covers.map((c) => [c.cover, c.sumInsured]);
  assert.ok(covers.some(([n, s]) => n === "Medical Reimbursement III" && s == null), JSON.stringify(covers));
});
test("H3 a checked line keeps its figure (control)", () => {
  const { rows } = read([[ANN, LINES]], { benefits: "all" });
  assert.deepEqual(rows(ANN).map((x) => x.amount).sort((a, b) => a! - b!), [1000, 10000, 13500, 100000]);
});
test("H4 a row read with no figure for another reason is still left out (control)", () => {
  const blank: Line[] = [...LINES.slice(0, 2), ["Medical Reimbursement III", "Manual Lapse", "-", "2.13"]];
  const { rows } = read([[ANN, blank]], { benefits: "all" });
  assert.ok(!rows(ANN).some((x) => /^Medical Reimbursement/.test(x.benefit)), JSON.stringify(rows(ANN)));
});
test("H5 a joint schedule: a held-back line is kept only for its own life", () => {
  const { rows } = read([[ANN, HELD.slice(0, 3)], [BEN, LINES.slice(0, 2)]], { benefits: "all" });
  assert.ok(rows(ANN).some((x) => /^Accident Death/.test(x.benefit) && x.amount == null), JSON.stringify(rows(ANN)));
  assert.ok(!rows(BEN).some((x) => /^Accident Death/.test(x.benefit)), JSON.stringify(rows(BEN)));
});

console.log(`held-back rows: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
if (failures.length) process.exit(1);

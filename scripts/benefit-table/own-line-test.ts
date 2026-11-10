/** A benefit row printed on a cover's own line belongs to that cover, whatever section the reading put it in (live test
 * 10 Nov: a schedule's "Component" block with the basic plan and its riders was linked to no cover, so the riders showed
 * nothing; another schedule's riders were shown under its basic plan; a "Death Benefit" line read into a "Policy Schedule"
 * block was shown under a critical illness cover). Made-up households in S$, A$ and RM; no model, database or network.
 *   npm run benefit-table:own-line-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, OWN_LINE_WHY, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const DOC = "eeeeeeee-0000-4000-8000-000000000001";
const family: FamilyMember[] = [{ id: "p1", display_name: "Jane Doe" }, { id: "p2", display_name: "John Roe" }];
const reading = (covers: unknown[], benefits: unknown[]) => ({ document: { kind: "personal_proof", product: "Harbour Life Plan", insurer: null, namedPeople: ["Jane Doe"], plan: null, periodFrom: null, periodTo: null }, covers, benefits });
const cover = (o: Record<string, unknown>) => ({ person: "Jane Doe", plan: null, riderOf: null, policyNumber: "HL-77120", premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, ...o });
const row = (o: Record<string, unknown>) => ({ column: null, pays: "amount", period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });

/** A schedule printing a basic plan and two riders as lines of a "Component" block, read as rows of that block too. */
function schedule(sign = "S$", lines = { base: "Harbour Life Plan", ci: "Critical Illness Rider", acc: "Accident Rider" }) {
  const text = `POLICY SCHEDULE\nLife Assured: Jane Doe\nPolicy No: HL-77120\nComponent\tSum Assured\n${lines.base}\t${sign}100,000\n${lines.ci}\t${sign}50,000\n${lines.acc}\t${sign}20,000\nSee your policy wording for the full terms.`;
  const doc: SourceDoc = { id: DOC, name: "Harbour schedule.pdf", readable: true, pages: [{ page: 1, text }] };
  const covers = [
    cover({ product: "Harbour Life Plan", cover: lines.base, sumInsured: 100000, quote: `${lines.base}\t${sign}100,000` }),
    cover({ product: "Harbour Life Plan", cover: lines.ci, riderOf: lines.base, sumInsured: 50000, quote: `${lines.ci}\t${sign}50,000` }),
    cover({ product: "Harbour Life Plan", cover: lines.acc, riderOf: lines.base, sumInsured: 20000, quote: `${lines.acc}\t${sign}20,000` }),
  ];
  const benefits = [
    row({ section: "Component", benefit: lines.base, value: 100000, quote: `${lines.base}\t${sign}100,000` }),
    row({ section: "Component", benefit: lines.ci, value: 50000, quote: `${lines.ci}\t${sign}50,000` }),
    row({ section: "Component", benefit: lines.acc, value: 20000, quote: `${lines.acc}\t${sign}20,000` }),
  ];
  const r = checkReading(doc, reading(covers, benefits));
  const key = (c: string, riderOf: string | null = lines.base) => coverKeyOf({ product: "Harbour Life Plan", cover: c, plan: null, riderOf: c === lines.base ? null : riderOf });
  return { r, keys: { base: key(lines.base), ci: key(lines.ci), acc: key(lines.acc) }, section: sectionKeyOf(DOC, { section: "Component", column: null }), lines };
}
const rowsOf = (t: ReturnType<typeof assembleTable>, coverKey: string) => t.people[0].rows.filter((x) => x.coverKey === coverKey).map((x) => x.benefit);

test("the block is linked to no cover: each line is shown under its own cover, and the block is not said to be unlinked (S$)", () => {
  const s = schedule();
  assert.equal(s.r.covers.length, 3, "the covers check against the page");
  assert.equal(s.r.benefits.length, 3, "the rows check against the page");
  const t = assembleTable([s.r], family, [{ section: s.section, cover: null, why: "a list of components" }]);
  assert.deepEqual(rowsOf(t, s.keys.base), [s.lines.base]);
  assert.deepEqual(rowsOf(t, s.keys.ci), [s.lines.ci]);
  assert.deepEqual(rowsOf(t, s.keys.acc), [s.lines.acc]);
  assert.ok(t.people[0].rows.every((x) => x.linkWhy === OWN_LINE_WHY));
  assert.deepEqual(t.unlinkedSections, [], "every row was placed by its own line");
  assert.deepEqual(t.people[1].rows, [], "never another person's");
});
test("the block is linked to the basic plan: the riders' lines move to the riders, the plan keeps its own (A$)", () => {
  const s = schedule("A$");
  const t = assembleTable([s.r], family, [{ section: s.section, cover: s.keys.base, why: "the basic plan's block" }]);
  assert.deepEqual(rowsOf(t, s.keys.base), [s.lines.base]);
  assert.deepEqual(rowsOf(t, s.keys.ci), [s.lines.ci]);
  assert.deepEqual(rowsOf(t, s.keys.acc), [s.lines.acc]);
});
test("a link the household chose is kept: the own line never overrides it (RM)", () => {
  const s = schedule("RM");
  const t = assembleTable([s.r], family, [{ section: s.section, cover: s.keys.base, why: "moved by the household", chosenBy: "household" } as never]);
  assert.deepEqual(rowsOf(t, s.keys.base), [s.lines.base, s.lines.ci, s.lines.acc]);
  assert.deepEqual(rowsOf(t, s.keys.ci), []);
});
test("a row whose line no cover prints keeps the section's link; with none, its section is still said to be unlinked", () => {
  const s = schedule();
  const extra = { ...s.r, benefits: [...s.r.benefits, { ...s.r.benefits[0], benefit: "Terminal Illness", source: { ...s.r.benefits[0].source, excerpt: "See your policy wording for the full terms." } }] };
  const linked = assembleTable([extra], family, [{ section: s.section, cover: s.keys.base, why: "block" }]);
  assert.deepEqual(rowsOf(linked, s.keys.base), [s.lines.base, "Terminal Illness"]);
  const none = assembleTable([extra], family, [{ section: s.section, cover: null, why: "a list" }]);
  assert.deepEqual(none.unlinkedSections.map((u) => u.section.key), [s.section]);
  assert.ok(!rowsOf(none, s.keys.base).includes("Terminal Illness"));
});
test("a line printed by two cover types, or a row quoting another page, is not placed by its line", () => {
  const s = schedule();
  const twice = { ...s.r, covers: [...s.r.covers, { ...s.r.covers[1], cover: "Critical Illness Rider Plus", source: s.r.covers[1].source }] };
  const t = assembleTable([twice], family, [{ section: s.section, cover: null, why: "a list" }]);
  assert.deepEqual(rowsOf(t, s.keys.ci), [], "two covers print that line: not placed");
  const moved = { ...s.r, benefits: s.r.benefits.map((b) => ({ ...b, source: { ...b.source, page: 2 } })) };
  const t2 = assembleTable([moved], family, [{ section: s.section, cover: null, why: "a list" }]);
  assert.deepEqual(t2.people[0].rows, [], "another page: not placed");
});
test("a cover nobody in the family holds is never given rows by its line", () => {
  const s = schedule();
  const t = assembleTable([s.r], [{ id: "p9", display_name: "Someone Else" }], [{ section: s.section, cover: null, why: "a list" }]);
  assert.deepEqual(t.people[0].rows, []);
});

test("Critic #405 F1: on a joint schedule each life's rider line is shown only for that life, at its own amount", () => {
  const text = "POLICY SCHEDULE\nPolicy No: HL-77120\nLife Assured: Jane Doe\nComponent\tSum Assured\nCritical Illness Rider\tS$50,000\nLife Assured: John Roe\nComponent\tSum Assured\nCritical Illness Rider\tS$30,000\nEnd.";
  const doc: SourceDoc = { id: DOC, name: "Joint schedule.pdf", readable: true, pages: [{ page: 1, text }] };
  const r = checkReading(doc, { ...reading([
    cover({ person: "Jane Doe", product: "Harbour Life Plan", cover: "Critical Illness Rider", sumInsured: 50000, quote: "Critical Illness Rider\tS$50,000" }),
    cover({ person: "John Roe", product: "Harbour Life Plan", cover: "Critical Illness Rider", sumInsured: 30000, quote: "Critical Illness Rider\tS$30,000" }),
  ], [
    row({ section: "Component", benefit: "Critical Illness Rider", value: 50000, quote: "Critical Illness Rider\tS$50,000" }),
    row({ section: "Component", benefit: "Critical Illness Rider", value: 30000, quote: "Critical Illness Rider\tS$30,000" }),
  ]), document: { kind: "personal_proof", product: "Harbour Life Plan", insurer: null, namedPeople: ["Jane Doe", "John Roe"], plan: null, periodFrom: null, periodTo: null } });
  const section = sectionKeyOf(DOC, { section: "Component", column: null });
  const ci = coverKeyOf({ product: "Harbour Life Plan", cover: "Critical Illness Rider", plan: null, riderOf: null });
  for (const link of [null, ci]) {
    const t = assembleTable([r], family, [{ section, cover: link, why: "block" }]);
    const amounts = (i: number) => t.people[i].rows.map((x) => (x.figure as { amount?: number }).amount);
    assert.deepEqual(amounts(0), [50000], `Jane (link ${link}): only her own line`);
    assert.deepEqual(amounts(1), [30000], `John (link ${link}): only his own line`);
  }
});
test("Critic #405 F2: a basic plan quoted as a block that includes its rider's line never takes the rider's row", () => {
  const text = "POLICY SCHEDULE\nLife Assured: Jane Doe\nHarbour Life Plan\tS$100,000\nCritical Illness Rider\tS$50,000\nEnd.";
  const doc: SourceDoc = { id: DOC, name: "Harbour schedule.pdf", readable: true, pages: [{ page: 1, text }] };
  const r = checkReading(doc, reading([
    cover({ product: "Harbour Life Plan", cover: "Harbour Life Plan", sumInsured: 100000, quote: "Harbour Life Plan\tS$100,000\nCritical Illness Rider\tS$50,000" }),
    cover({ product: "Harbour Life Plan", cover: "Critical Illness Rider", riderOf: "Harbour Life Plan", sumInsured: 50000, quote: "Critical Illness Rider\tS$50,000" }),
  ], [row({ section: "Riders", benefit: "Critical Illness Rider", value: 50000, quote: "Critical Illness Rider\tS$50,000" })]));
  const base = coverKeyOf({ product: "Harbour Life Plan", cover: "Harbour Life Plan", plan: null, riderOf: null });
  const ci = coverKeyOf({ product: "Harbour Life Plan", cover: "Critical Illness Rider", plan: null, riderOf: "Harbour Life Plan" });
  const t = assembleTable([r], family, [{ section: sectionKeyOf(DOC, { section: "Riders", column: null }), cover: ci, why: "the rider" }]);
  assert.deepEqual(rowsOf(t, ci), ["Critical Illness Rider"]);
  assert.deepEqual(rowsOf(t, base), [], "never moved under the basic plan");
});
test("a row whose person's cover is kept from another document keeps the section's link: never shown for no one", () => {
  const s = schedule();
  const cert: SourceDoc = { id: "eeeeeeee-0000-4000-8000-000000000002", name: "Certificate.pdf", readable: true, pages: [{ page: 1, text: "CERTIFICATE\nJane Doe\nCritical Illness Rider\tS$50,000" }] };
  const c = checkReading(cert, reading([cover({ product: "Harbour Life Plan", cover: s.lines.ci, riderOf: s.lines.base, sumInsured: 50000, quote: `${s.lines.ci}\tS$50,000` })], []));
  const t = assembleTable([c, s.r], family, [{ section: s.section, cover: s.keys.ci, why: "block" }]);
  assert.ok(rowsOf(t, s.keys.ci).includes(s.lines.ci), JSON.stringify(t.people[0].rows.map((x) => [x.cover, x.benefit])));
});

console.log(`benefit-table own line: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);

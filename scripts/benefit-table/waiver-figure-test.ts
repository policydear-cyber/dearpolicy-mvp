/** A premium-waiver rider's figure is never a cover amount on Coverage, Benefits or in chat (live 13 Nov: a schedule's
 * "Crisis Waiver III  150.00" and "Early Stage Crisis Waiver  160.08", the premiums they waive, were shown as covers of
 * $150 and $160.08). The rider stays listed with no sum; the policy's real covers on the same page keep theirs. Read at
 * read time, so a schedule already read is corrected without a re-read. Made-up households in S$, RM and HK$, plus
 * negative controls; no model, database or network.
 *   npm run -s benefit-table:waiver-figure-test */
import assert from "node:assert/strict";
import { assembleTable, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
const pending: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  pending.push((async () => { try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); } })());
}

const DOC = "eeeeeeee-0000-4000-8000-0000000000a1";
const PERSON = "Lee Wen Hui Grace";
const family: FamilyMember[] = [{ id: "p1", display_name: PERSON }, { id: "p2", display_name: "Daniel Lee" }];

/** A component table: name, status, sum, premium, dates. `lines` are [name, sum, premium]. */
function schedule(lines: [string, string, string][], head = "Component\tStatus\tSum Assured\tComponent Premium\tCover Start Date") {
  const row = ([n, s, p]: [string, string, string]) => `${n}\tIn Force\t${s}\t${p}\t02-Mar-2015`;
  const text = [`Benefit Details`, `Life Assured Name:\t${PERSON}`, `Policy Number:\t80112233`, head, ...lines.map(row)].join("\n");
  const doc: SourceDoc = { id: DOC, name: "Schedule.pdf", readable: true, pages: [{ page: 1, text }] };
  const num = (s: string) => Number(s.replace(/[^\d.]/g, ""));
  const covers = lines.map(([n, s, p], i) => ({ person: PERSON, product: "Harbour Protector", cover: n, plan: null, riderOf: i ? lines[0][0] : null, policyNumber: "80112233",
    sumInsured: num(s), premium: num(p), premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: row([n, s, p]) }));
  const benefits = lines.map(([n, s, p]) => ({ section: "Component", column: "Sum Assured", benefit: n, pays: "amount", value: num(s), period: null, basis: null, asOf: null,
    percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: row([n, s, p]) }));
  const r = checkReading(doc, { document: { kind: "personal_proof", product: "Harbour Protector", insurer: null, namedPeople: [PERSON], plan: null, periodFrom: null, periodTo: null }, covers, benefits });
  const t = assembleTable([r], family, []);
  const cov = (name: string) => t.people[0].covers.find((c) => c.cover === name);
  const rows = (name: string) => t.people[0].rows.filter((x) => x.cover === name);
  return { r, t, cov, rows };
}
const amountOf = (f: { kind: string; amount?: number }) => (f.kind === "printed" || f.kind === "worked_out" ? f.amount : undefined);

test("W1 S$ schedule: two waiver riders keep their place with no sum; the real covers keep theirs", () => {
  const s = schedule([["Harbour Protector", "100,000.00", "150.00"], ["Total and Permanent Disability", "100,000.00", "0.00"],
    ["Crisis Waiver III", "150.00", "10.08"], ["Early Stage Crisis Waiver", "160.08", "5.38"]]);
  assert.equal(s.cov("Crisis Waiver III")?.sumInsured, null, "waiver kept, no sum");
  assert.equal(s.cov("Early Stage Crisis Waiver")?.sumInsured, null, "waiver kept, no sum");
  assert.equal(s.cov("Crisis Waiver III")?.premium, 10.08, "its own premium is still its premium");
  assert.equal(s.cov("Total and Permanent Disability")?.sumInsured, 100000);
  assert.equal(s.cov("Harbour Protector")?.sumInsured, 100000);
  for (const n of ["Crisis Waiver III", "Early Stage Crisis Waiver"]) for (const x of s.rows(n)) assert.equal(amountOf(x.figure), undefined, `${n} shows no amount`);
  assert.equal(amountOf(s.rows("Total and Permanent Disability")[0].figure), 100000);
});
test("W2 RM schedule: 'Waiver of Premium Rider' and 'Payor Benefit' carry no amount", () => {
  const s = schedule([["Harbour Protector", "RM 200,000.00", "RM 300.00"], ["Waiver of Premium Rider", "RM 3,600.00", "RM 22.00"], ["Payor Benefit", "RM 3,600.00", "RM 18.00"]]);
  assert.equal(s.cov("Waiver of Premium Rider")?.sumInsured, null);
  assert.equal(s.cov("Payor Benefit")?.sumInsured, null);
  assert.equal(s.cov("Harbour Protector")?.sumInsured, 200000);
  assert.ok(s.rows("Payor Benefit").every((x) => amountOf(x.figure) === undefined));
});
test("W3 HK$ schedule: 'Premium Eraser' and 'TPD Waiver' carry no amount", () => {
  const s = schedule([["Harbour Protector", "HK$500,000.00", "HK$900.00"], ["Premium Eraser", "HK$10,800.00", "HK$40.00"], ["TPD Waiver", "HK$10,800.00", "HK$12.00"]]);
  assert.equal(s.cov("Premium Eraser")?.sumInsured, null);
  assert.equal(s.cov("TPD Waiver")?.sumInsured, null);
});
// Negative controls: a cover that only mentions a waiver, or waives something other than premiums, keeps its sum.
test("N1 a waiver of something else keeps its sum (excess, deductible, waiting period)", () => {
  const s = schedule([["Harbour Protector", "S$100,000.00", "S$150.00"], ["Collision Damage Waiver", "S$5,000.00", "S$12.00"], ["Waiver of Deductible", "S$3,000.00", "S$8.00"]]);
  assert.equal(s.cov("Collision Damage Waiver")?.sumInsured, 5000);
  assert.equal(s.cov("Waiver of Deductible")?.sumInsured, 3000);
  assert.equal(amountOf(s.rows("Collision Damage Waiver")[0].figure), 5000);
});
test("N2 a cover sold with a waiver keeps its sum", () => {
  const s = schedule([["Harbour Protector", "S$100,000.00", "S$150.00"], ["Critical Illness Benefit with Premium Waiver", "S$50,000.00", "S$20.00"]]);
  assert.equal(s.cov("Critical Illness Benefit with Premium Waiver")?.sumInsured, 50000);
});
test("N3 'Early Crisis Cover' and 'Crisis Cover Provider III' are covers, not waivers", () => {
  const s = schedule([["Harbour Protector", "S$100,000.00", "S$150.00"], ["Crisis Cover Provider III", "S$50,000.00", "S$0.00"], ["Early Crisis Cover", "S$50,000.00", "S$0.00"]]);
  assert.equal(s.cov("Crisis Cover Provider III")?.sumInsured, 50000);
  assert.equal(s.cov("Early Crisis Cover")?.sumInsured, 50000);
});
test("N4 never another person's: no waiver row or cover is shown for the other member", () => {
  const s = schedule([["Harbour Protector", "S$100,000.00", "S$150.00"], ["Crisis Waiver III", "S$150.00", "S$10.08"]]);
  assert.deepEqual(s.t.people[1].rows, []);
});

test("C1 the card says why it shows no sum: not checked, a waiver, or not printed", async () => {
  const { noSumText } = await import("@/lib/benefit-table/headline");
  assert.equal(noSumText({ cover: "Medical Reimbursement III", source: { excerpt: "Medical Reimbursement III Manual Lapse [amount not checked] [amount not checked]" } }), "Sum insured not checked against the page");
  assert.equal(noSumText({ cover: "Crisis Waiver III", source: { excerpt: "Crisis Waiver III In Force 150.00 10.08" } }), "Waives premiums: no sum of its own");
  assert.equal(noSumText({ cover: "Collision Damage Waiver", source: { excerpt: "Collision Damage Waiver" } }), "Sum insured not printed");
  assert.equal(noSumText({ cover: "Hospital Plan", source: null }), "Sum insured not printed");
});

Promise.all(pending).then(() => {
  console.log(`waiver figure: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
});

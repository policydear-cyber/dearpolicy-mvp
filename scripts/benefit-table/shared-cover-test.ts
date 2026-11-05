/** Coverage's benefit-table view (components/benefit-table-coverage.tsx): a cover on a document that names several people
 * in the household lists the document's lines under each of them, so the card says whom else it covers and this person's
 * own sum, and a figure printed for someone else is never read as theirs. It changes no figure. Made-up names and sums in
 * several markets. Pure: no database, no network, no model.
 *   node --import tsx scripts/benefit-table/shared-cover-test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sharedCoverText } from "@/lib/benefit-table/shared-cover";
import type { SummaryRow } from "@/lib/benefit-table/headline";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const row = (benefit: string, amount: number, currency: string | null = "SGD"): SummaryRow =>
  ({ benefit, section: null, pays: "amount", figure: { kind: "printed", amount, currency, unit: "lump_sum" }, qualifier: null, fromDay: null, maxDays: null, conditions: [] } as unknown as SummaryRow);
const asCharged = (benefit: string): SummaryRow =>
  ({ benefit, section: null, pays: "as_charged", figure: { kind: "none", why: "paid as charged" }, qualifier: null, fromDay: null, maxDays: null, conditions: [] } as unknown as SummaryRow);
const cover = (key: string, doc: string, sum: number | null, currency: string | null = "SGD") => ({ coverKey: key, sumInsured: sum, currency, source: { documentId: doc } });

const siew = { id: "p1", name: "Ng Siew Lan", covers: [cover("group life", "d3", 250000), cover("shield", "d1", 500000)] };
const rahul = { id: "p2", name: "Rahul Menon", covers: [cover("group life", "d3", 150000), cover("term", "d2", 600000)] };
const people = [siew, rahul];

test("a line printed for another person on the shared certificate gets the note, with this person's own sum", () => {
  assert.equal(sharedCoverText(people, rahul, rahul.covers[0], [row("Death benefit", 250000)]),
    "This policy also covers Ng Siew Lan. Rahul Menon's own sum insured on it is S$150,000; an amount listed below may be for another person on it.");
});
test("nothing extra when every amount listed is this person's own sum", () => {
  assert.equal(sharedCoverText(people, siew, siew.covers[0], [row("Death benefit", 250000)]), null);
});
test("a cover only this person holds, or a cover with no rows, says nothing extra", () => {
  assert.equal(sharedCoverText(people, rahul, rahul.covers[1], [row("Death benefit", 600000), row("Terminal illness", 50000)]), null);
  assert.equal(sharedCoverText(people, rahul, rahul.covers[0], []), null);
});
test("the same product on two different documents is not shared", () => {
  const a = { id: "a", name: "Ama Owusu", covers: [cover("family health", "dA", 9000, "GHS")] };
  const b = { id: "b", name: "Kofi Owusu", covers: [cover("family health", "dB", 9000, "GHS")] };
  assert.equal(sharedCoverText([a, b], a, a.covers[0], [row("Hospital stay", 2000, "GHS")]), null);
});
test("no sum of its own: the note still names the others, without a sum", () => {
  const ada = { id: "x", name: "Ada Okafor", covers: [cover("family plan", "dF", null, "NGN")] };
  const chidi = { id: "y", name: "Chidi Okafor", covers: [cover("family plan", "dF", null, "NGN")] };
  const ruth = { id: "z", name: "Ruth Okafor", covers: [cover("family plan", "dF", null, "NGN")] };
  assert.equal(sharedCoverText([ada, chidi, ruth], ada, ada.covers[0], [asCharged("Outpatient care")]),
    "This policy also covers Chidi Okafor and Ruth Okafor. An amount listed below may be for another person on it.");
});
test("a row paid as charged under a shared cover still gets the note (it is not the person's own sum)", () => {
  assert.match(sharedCoverText(people, siew, siew.covers[0], [row("Death benefit", 250000), asCharged("Funeral costs")]) ?? "", /also covers Rahul Menon/);
});
test("two people with the same name: the other one is still named", () => {
  const r2 = { id: "p9", name: "Rahul Menon", covers: [cover("group life", "d3", 80000)] };
  assert.match(sharedCoverText([rahul, r2], rahul, rahul.covers[0], [row("Death benefit", 250000)]) ?? "", /^This policy also covers Rahul Menon\. Rahul Menon's own sum insured on it is S\$150,000;/);
});
test("the Coverage page shows it on each cover card", () => {
  const page = readFileSync("components/benefit-table-coverage.tsx", "utf8");
  assert.match(page, /shared=\{sharedCoverText\(data\.people,person,c,shown\.rows\)\}/);
  assert.match(page, /\{shared\?<p className="muted cov-reading" data-testid="table-shared">\{shared\}<\/p>:null\}/);
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`shared-cover: ${passed} passed, fetches 0`);

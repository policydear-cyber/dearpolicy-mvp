/** Coverage's benefit-table view (components/benefit-table-coverage.tsx) lists everyone in the family once anyone has
 * cover there: a person with none (a child with only a premium record) gets a line saying no cover is shown for them yet,
 * instead of silently missing from the page and its person links. With no cover for anyone, the page's own empty state
 * stands. Made-up households. Renders the real component; no database, no network.
 *   node --import tsx scripts/benefit-table/coverage-people-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BenefitTableCoverage, type BenefitTableData } from "@/components/benefit-table-coverage";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const source = { documentId: "d1", document: "Family Health Plan", page: 1, excerpt: "" };
const cover = (personId: string) => ({ personId, coverKey: "family health", product: "Family Health Plan", cover: "Family Health Plan", plan: null, riderOf: null, policyNumber: null,
  sumInsured: 20000, premium: null, premiumFrequency: null, startDate: null, endDate: null, currency: "KES", source });
const person = (id: string, name: string, covered: boolean) => ({ id, name, covers: covered ? [cover(id)] : [], rows: [] });
const data = (people: ReturnType<typeof person>[]): BenefitTableData =>
  ({ enabled: true, people, documents: [], unmatchedCovers: [], illustrationCovers: [], unlinkedSections: [] } as unknown as BenefitTableData);
const render = (people: ReturnType<typeof person>[]) => renderToStaticMarkup(createElement(BenefitTableCoverage, { data: data(people) }));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("a person with no cover is listed, linked and told none is shown yet", () => {
  const h = render([person("a", "Wanjiru Kamau", true), person("b", "Baraka Kamau", false)]);
  assert.match(h, /<a href="#person-b">Baraka Kamau <span>0<\/span><\/a>/);
  assert.match(text(h), /Baraka Kamau No cover is shown for Baraka Kamau from your documents yet\. If a policy covers Baraka Kamau, upload its schedule or certificate on the Documents page ?\./);
  assert.doesNotMatch(text(h), /0 covers/);
  assert.equal((h.match(/data-testid="table-person-none"/g) ?? []).length, 1);
  assert.match(text(h), /Wanjiru Kamau 1 cover · 0 benefits/);
});
test("a household with cover for everyone shows no such line", () => {
  assert.doesNotMatch(render([person("a", "Ana Silva", true), person("b", "Ben Silva", true)]), /table-person-none/);
});
test("nobody with cover: the page's empty state, never a section per person", () => {
  const h = render([person("a", "Ana Silva", false), person("b", "Ben Silva", false)]);
  assert.doesNotMatch(h, /table-person/);
  assert.match(text(h), /No covers yet\./);
});
test("one person, with cover: no person links, as before", () => {
  assert.doesNotMatch(render([person("a", "Ana Silva", true)]), /cov-people/);
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`coverage-people: ${passed} passed, fetches 0`);

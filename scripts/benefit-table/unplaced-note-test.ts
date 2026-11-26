/** Scripted test: the Coverage page's "parts not in this summary" notice says what it means for the answers and what to do,
 * for one part and for many (Live tester, 26 Nov: "67 parts couldn't be placed under a cover" had no next step). No model, network or database.
 *   npm run -s benefit-table:unplaced-note-test */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BenefitTableCoverage, unplacedByDocument, type BenefitTableData } from "@/components/benefit-table-coverage";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const part = (i: number) => ({ section: { key: "k" + i, section: "Part " + i, column: null, document: "Policy booklet" }, why: "not linked to any cover", source: null });
const render = (n: number) => renderToStaticMarkup(createElement(BenefitTableCoverage, { data: { enabled: true, people: [], documents: [], unmatchedCovers: [], illustrationCovers: [], unlinkedSections: Array.from({ length: n }, (_, i) => part(i)) } as unknown as BenefitTableData }));

test("U1 many parts: says they are missing from summary and chat, that a benefit may be missing, and what to do", () => {
  const html = render(67);
  assert.match(html, /67 parts of your documents aren.t in this summary or in the chat\. Tap to see which\./);
  assert.match(html, /data-testid="table-unplaced-note"/);
  assert.match(html, /A benefit in them may be missing from your answers\. Use the page link beside a part to read them in your own document, or ask your insurer\./);
  assert.doesNotMatch(html, /placed under a cover/);
});
test("U2 one part: singular wording", () => {
  const html = render(1);
  assert.match(html, /One part of your documents isn.t in this summary or in the chat\./);
  assert.match(html, /A benefit in it may be missing from your answers\. Use the page link beside a part to read it in your own document, or ask your insurer\./);
});
test("U3 no parts: no notice", () => {
  assert.doesNotMatch(render(0), /table-unplaced/);
});
test("U4 an unmatched cover and no unplaced parts: the section shows but not the notice", () => {
  const html = renderToStaticMarkup(createElement(BenefitTableCoverage, { data: { enabled: true, people: [], documents: [], unmatchedCovers: [{ person: "Someone Else", product: "Plan", cover: "Cover", plan: null, source: { documentId: "d1", page: 1 } }], illustrationCovers: [], unlinkedSections: [] } as unknown as BenefitTableData }));
  assert.match(html, /table-also-found/);
  assert.doesNotMatch(html, /table-unplaced/);
});
test("U5 the parts are grouped per document with a count, and a heading printed again is shown once with how many times", () => {
  const p = (key: string, section: string, document: string) => ({ section: { key, section, column: null, document }, source: null });
  const groups = unplacedByDocument([p("1", "Premium table", "Plan A"), p("2", "Premium table", "Plan A"), p("3", "Premium table", "Plan A"), p("4", "Benefits", "Plan A"), p("5", "Notes", "Plan B")]);
  assert.deepEqual(groups.map((g) => [g.document, g.count, g.parts.map((x) => [x.title, x.times])]), [["Plan A", 4, [["Premium table", 3], ["Benefits", 1]]], ["Plan B", 1, [["Notes", 1]]]]);
  const html = renderToStaticMarkup(createElement(BenefitTableCoverage, { data: { enabled: true, people: [], documents: [], unmatchedCovers: [], illustrationCovers: [], unlinkedSections: [p("1", "Premium table", "Plan A"), p("2", "Premium table", "Plan A"), p("5", "Notes", "Plan B")] } as unknown as BenefitTableData }));
  assert.equal((html.match(/data-testid="table-unplaced-doc"/g) ?? []).length, 2, "one group per document");
  assert.match(html, /<strong>Plan A<\/strong> <small>2 parts<\/small>/);
  assert.match(html, /Premium table<small>2 times<\/small>/);
  assert.match(html, /<strong>Plan B<\/strong> <small>1 part<\/small>/);
});

console.log(`unplaced note: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }

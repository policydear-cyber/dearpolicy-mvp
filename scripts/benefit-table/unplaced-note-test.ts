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
test("U6 a repeated heading keeps every page link; two documents with one name stay two groups", () => {
  const q = (key: string, section: string, document: string, documentId: string, page: number) => ({ section: { key, section, column: null, document }, source: { documentId, document, page, excerpt: "" } });
  const groups = unplacedByDocument([q("1", "Premium table", "Policy wording", "d1", 4), q("2", "Premium table", "Policy wording", "d1", 9), q("3", "Premium table", "Policy wording", "d1", 9), q("4", "Premium table", "Policy wording", "d2", 4)]);
  assert.equal(groups.length, 2, "same name, different documents");
  assert.deepEqual(groups[0].parts[0].sources.map((x) => x.page), [4, 9], "each distinct page once");
  assert.equal(groups[0].parts[0].times, 3);
  const html = renderToStaticMarkup(createElement(BenefitTableCoverage, { data: { enabled: true, people: [], documents: [], unmatchedCovers: [], illustrationCovers: [], unlinkedSections: [q("1", "Premium table", "Policy wording", "d1", 4), q("2", "Premium table", "Policy wording", "d1", 9)] } as unknown as BenefitTableData }));
  assert.match(html, /file#page=4/); assert.match(html, /file#page=9/);
});
test("U7 a part with no page link joins the one document of the same name; it never splits one document in two", () => {
  const withLink = { section: { key: "1", section: "Benefits", column: null, document: "Plan A" }, source: { documentId: "d1", document: "Plan A", page: 2, excerpt: "" } };
  const noLink = { section: { key: "2", section: "Notes", column: null, document: "Plan A" }, source: null };
  const groups = unplacedByDocument([noLink, withLink]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].id, "d1");
});
test("U8 two documents with one name and a part with no link: three groups; one heading in two columns stays two parts", () => {
  const q = (key: string, section: string, column: string | null, id: string | null) => ({ section: { key, section, column, document: "Policy wording" }, source: id ? { documentId: id, document: "Policy wording", page: 1, excerpt: "" } : null });
  const groups = unplacedByDocument([q("1", "Benefits", null, "d1"), q("2", "Benefits", null, "d2"), q("3", "Notes", null, null)]);
  assert.equal(groups.length, 3, "a no-link part never picks one of two same-named documents");
  const cols = unplacedByDocument([q("1", "Benefits", "Plan A", "d1"), q("2", "Benefits", "Plan B", "d1")]);
  assert.deepEqual(cols[0].parts.map((x) => x.title), ["Benefits (Plan A)", "Benefits (Plan B)"]);
  const untitled = unplacedByDocument([{ section: { key: "9", section: null, column: null, document: "Plan A" }, source: null }]);
  assert.equal(untitled[0].parts[0].title, "Part with no heading");
});

test("U9 headings that differ only in their numbers are one line; each folded heading stays named with its own page links; a different wording stays its own line", () => {
  const q = (key: string, section: string, page: number) => ({ section: { key, section, column: null, document: "CareShield" }, source: { documentId: "d1", document: "CareShield", page, excerpt: "" } });
  const groups = unplacedByDocument([q("1", "What does it offer? (Year of claim: 2026)", 3), q("2", "What does it offer? (Year of claim: 2027)", 4), q("3", "What does it offer? (Year of claim: 2028)", 5), q("4", "Exclusions", 8), q("5", "Plan 1 or Plan 2", 9)]);
  assert.equal(groups[0].count, 5);
  assert.deepEqual(groups[0].parts.map((x) => [x.others.map((o) => o.title), x.sources.map((y) => y.page), x.others.flatMap((o) => o.sources.map((y) => y.page))]), [[["What does it offer? (Year of claim: 2027)", "What does it offer? (Year of claim: 2028)"], [3], [4, 5]], [[], [8], []], [[], [9], []]]);
  const html = renderToStaticMarkup(createElement(BenefitTableCoverage, { data: { enabled: true, people: [], documents: [], unmatchedCovers: [], illustrationCovers: [], unlinkedSections: [q("1", "Age 0-17", 3), q("2", "Age 18-65", 4)] } as unknown as BenefitTableData }));
  assert.match(html, /1 more like this/);
  assert.match(html, /Age 18-65/, "the folded heading is still named");
  assert.match(html, /file#page=3/); assert.match(html, /file#page=4/);
});
test("U10 the count is the same whichever part comes first, and identical repeats are counted", () => {
  const q = (key: string, section: string) => ({ section: { key, section, column: null, document: "Plan" }, source: null });
  const a = unplacedByDocument([q("1", "Plan 1"), q("2", "Plan 1"), q("3", "Plan 2")])[0].parts;
  const b = unplacedByDocument([q("1", "Plan 2"), q("2", "Plan 1"), q("3", "Plan 1")])[0].parts;
  assert.equal(a.length, 1); assert.equal(b.length, 1);
  assert.deepEqual([a[0].times, a[0].others.map((o) => [o.title, o.times])], [2, [["Plan 2", 1]]]);
  assert.deepEqual([b[0].times, b[0].others.map((o) => [o.title, o.times])], [1, [["Plan 1", 2]]]);
});

test("U11 plural wording and exact count for three folded headings; commas and decimals fold as one number; headings sharing only a prefix stay apart", () => {
  const q = (key: string, section: string, page: number) => ({ section: { key, section, column: null, document: "Plan" }, source: { documentId: "d1", document: "Plan", page, excerpt: "" } });
  const three = [q("1", "Band 1", 1), q("2", "Band 2", 2), q("3", "Band 3", 3), q("4", "Band 4", 4)];
  const html = renderToStaticMarkup(createElement(BenefitTableCoverage, { data: { enabled: true, people: [], documents: [], unmatchedCovers: [], illustrationCovers: [], unlinkedSections: three } as unknown as BenefitTableData }));
  assert.match(html, /3 more like this/);
  for (const n of [1, 2, 3, 4]) assert.match(html, new RegExp(`file#page=${n}`));
  const g = unplacedByDocument([q("1", "Limit 1,000.50 a year", 1), q("2", "Limit 25,000 a year", 2)]);
  assert.equal(g[0].parts.length, 1);
  assert.equal(g[0].parts[0].others.length, 1);
  const prefix = unplacedByDocument([q("1", "Hospital cover 1", 1), q("2", "Hospital stay 2", 2), q("3", "Hospital cover", 3)]);
  assert.equal(prefix[0].parts.length, 3, "same start, different words: not folded");
});

console.log(`unplaced note: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }

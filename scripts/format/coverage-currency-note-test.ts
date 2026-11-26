/** Coverage says where its currency comes from once for each person, never on every cover card. Rendered, not read from
 * source, so a note that is never shown, inverted, dropped or hidden fails. No model, network or database.
 *   npm run -s format:coverage-currency-note-test */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BenefitTableCoverage } from "@/components/benefit-table-coverage";

const NOTE = "Some amounts here use the currency from your account settings, where the document prints none.";
const src = (id: string) => ({ documentId: id, document: `Doc ${id}`, page: 1, excerpt: "Sum" });
const cover = (pid: string, key: string, fromSettings: boolean, currency: string | null) => ({
  personId: pid, coverKey: key, product: "Plan " + key, cover: "Plan " + key, plan: null, riderOf: null, policyNumber: null,
  sumInsured: 1000, premium: null, premiumFrequency: null, startDate: null, endDate: null, currency, source: src("d" + key),
  ...(fromSettings ? { fromSettings: true } : {}),
});
const row = (key: string, fromSettings: boolean) => ({ coverKey: key, source: src("d" + key), fromSettings, benefit: "Death benefit", section: "Benefits", pays: "covered", figure: { kind: "amount", amount: 1000, currency: "SGD" } as never, qualifier: null, fromDay: null, maxDays: null, conditions: [] });
const person = (id: string, name: string, covers: ReturnType<typeof cover>[], rows: ReturnType<typeof row>[] = []) => ({ id, name, covers, rows });
const html = (people: ReturnType<typeof person>[]) => renderToStaticMarkup(createElement(BenefitTableCoverage, {
  data: { enabled: true, people, documents: [], unmatchedCovers: [], illustrationCovers: [], unlinkedSections: [] } as never,
}));
const notes = (h: string) => (h.match(/data-testid="table-currency-note"/g) ?? []).length;
const sentences = (h: string) => h.split(NOTE).length - 1;

const three = html([person("a", "Ann", [cover("a", "1", true, "SGD"), cover("a", "2", true, "SGD"), cover("a", "3", true, "SGD")])]);
assert.equal(notes(three), 1, "N1 three covers on the account currency give one note, not three");
assert.equal(sentences(three), 1, "N2 the sentence appears once, with no second copy without the test id");
assert.ok(three.includes(NOTE), "N3 the note says what it means");
assert.ok(!/<p[^>]*hidden[^>]*table-currency-note|table-currency-note[^>]*hidden/.test(three), "N4 the note is not hidden");
assert.equal(notes(html([person("a", "Ann", [cover("a", "1", false, "USD"), cover("a", "2", true, "SGD")])])), 1, "N5 a mix gives one note");
const lettered = html([person("a", "Ann", [cover("a", "1", false, "USD")])]);
assert.equal(notes(lettered), 0, "N6 a printed currency alone gives none");
assert.equal(sentences(lettered), 0, "N7 and the sentence is absent");
const two = html([person("a", "Ann", [cover("a", "1", false, "USD")]), person("b", "Bob", [cover("b", "2", true, "SGD")])]);
assert.equal(notes(two), 1, "N8 only the person who needs it has the note");
assert.ok(two.indexOf("table-currency-note") > two.indexOf("Bob"), "N9 and it sits under that person");
assert.equal(notes(html([person("a", "Ann", [cover("a", "1", false, "USD")], [row("1", true)])])), 1, "N10 a figure on the account currency only in a row still gives the note");
assert.equal(notes(html([person("a", "Ann", [cover("a", "1", false, "USD")], [row("1", false)])])), 0, "N11 a row that prints its own currency gives none");
console.log("coverage currency note test passed: 11 cases");

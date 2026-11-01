/**
 * Coverage: a benefit the schedule prints as its own line ("TERMINAL ILLNESS", "WAIVER OF PREMIUM ON TPD BENEFIT" under a
 * life plan) shows the plan's row that is this very benefit, never "No benefits are listed ... upload its policy wording"
 * while that wording is on file (live check, 1 Nov). Made-up households in several markets and languages; no database,
 * no network, no model.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BenefitTableCoverage, type BenefitTableData } from "@/components/benefit-table-coverage";
import { benefitWords, rowHead, rowsForCover } from "@/lib/benefit-table/cover-rows";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; void name; };

const source = { documentId: "00000000-0000-4000-8000-0000000000a1", document: "Policy pack", page: 3, excerpt: "" };
type C = { coverKey: string; product: string; cover: string; sumInsured: number | null; currency: string | null };
const cover = (product: string, name: string, sumInsured: number | null, currency = "SGD"): C & { source: typeof source } & Record<string, unknown> => ({
  personId: "p1", coverKey: `${product}|${name}`.toLowerCase(), product, cover: name, plan: null, riderOf: null, policyNumber: null,
  sumInsured, premium: null, premiumFrequency: null, startDate: null, endDate: null, currency, source });
const row = (c: C, benefit: string, figure: { kind: string; amount?: number; currency?: string | null } & Record<string, unknown> = { kind: "none", why: "words" }, extra: Record<string, unknown> = {}) => ({
  coverKey: c.coverKey, product: c.product, cover: c.cover, plan: null, benefit, section: c.product, pays: "words", figure, qualifier: null,
  fromDay: null, maxDays: null, conditions: [], percent: null, base: null, source: { ...source, excerpt: benefit }, ...extra });
const printed = (amount: number, currency = "SGD") => ({ kind: "printed", amount, currency, unit: "lump_sum" });

/** Each cover card's own HTML, in order. */
const cards = (covers: ReturnType<typeof cover>[], rows: ReturnType<typeof row>[]) => {
  const data = { enabled: true, people: [{ id: "p1", name: "Ada Example", covers, rows }], documents: [], unmatchedCovers: [],
    illustrationCovers: [], unlinkedSections: [] } as unknown as BenefitTableData;
  return renderToStaticMarkup(createElement(BenefitTableCoverage, { data })).split('data-testid="table-cover"').slice(1);
};
const UPLOAD = /upload it on the Documents page/;

// 1. Singapore life plan: the plan's rows name the benefits its schedule prints as lines of their own.
{
  const base = cover("Lifeguard Saver 20", "Lifeguard Saver 20", 80000), ti = cover("Lifeguard Saver 20", "TERMINAL ILLNESS", null),
    wop = cover("Lifeguard Saver 20", "PREMIUM WAIVER ON TPD", null);
  const rows = [row(base, "Death benefit: higher of 105% of total premiums paid", { kind: "none", why: "words" }),
    row(base, "Terminal Illness Benefit", { kind: "none", why: "words" }),
    row(base, "Waiver of premium on total and permanent disability benefit")];
  const [b, t, w] = cards([base, ti, wop], rows);
  check("TI line shows the plan's TI row", () => { assert.match(t, /Terminal Illness Benefit/); assert.doesNotMatch(t, UPLOAD); assert.doesNotMatch(t, /Death benefit/); });
  check("waiver line (other word order, TPD short form) shows the waiver row", () => { assert.match(w, /Waiver of premium on total and permanent disability/); assert.doesNotMatch(w, UPLOAD); });
  check("the plan's own card keeps all its rows", () => { assert.match(b, /Terminal Illness Benefit/); assert.match(b, /Death benefit/); });
}

// 2. Malaysia, Malay wording: "Manfaat Penyakit Terminal" line, row "Penyakit Terminal: ..." of the same takaful plan.
{
  const base = cover("Takaful Proteksi Keluarga", "Takaful Proteksi Keluarga", 100000, "MYR"), ti = cover("Takaful Proteksi Keluarga", "Manfaat Penyakit Terminal", null, "MYR");
  const [, t] = cards([base, ti], [row(base, "Penyakit Terminal: dibayar sebagai pendahuluan manfaat kematian"), row(base, "Manfaat Kematian", printed(100000, "MYR"))]);
  check("Malay TI line shows its row", () => { assert.match(t, /Penyakit Terminal/); assert.doesNotMatch(t, /Manfaat Kematian/); assert.doesNotMatch(t, UPLOAD); });
}

// 3. France: "Exonération des cotisations" line, row of the same product.
{
  const base = cover("Prévoyance Horizon", "Prévoyance Horizon", 150000, "EUR"), ex = cover("Prévoyance Horizon", "Exonération des cotisations", null, "EUR");
  const [, e] = cards([base, ex], [row(base, "Exonération des cotisations (invalidité)"), row(base, "Capital décès", printed(150000, "EUR"))]);
  check("French waiver line shows its row", () => { assert.match(e, /Exonération des cotisations/); assert.doesNotMatch(e, /Capital décès/); assert.doesNotMatch(e, UPLOAD); });
}

// 4. Exact words only: a "Death" line never shows the "Accidental death benefit" row; it points to the plan's card instead.
{
  const base = cover("Shield Life Term", "Shield Life Term", 200000), death = cover("Shield Life Term", "Death", null);
  const [, d] = cards([base, death], [row(base, "Accidental Death Benefit", printed(200000)), row(base, "Total and permanent disability")]);
  check("no partial match", () => { assert.doesNotMatch(d, /Accidental Death Benefit/); assert.doesNotMatch(d, /S\$200,000/); });
  check("points to the card that lists the plan's benefits, no upload ask", () => { assert.match(d, /What it pays is set out with Shield Life Term, in the same policy wording\./); assert.doesNotMatch(d, UPLOAD); });
}

// 5. A figure worked out from another cover's sum insured is never shown under a cover with a different sum, or none.
{
  const base = cover("Hong Kong Life Protector", "Hong Kong Life Protector", 500000, "HKD"), ci = cover("Hong Kong Life Protector", "Critical Illness", 100000, "HKD"),
    ci2 = cover("Hong Kong Life Protector", "CI", null, "HKD");
  const worked = row(base, "Critical illness benefit", { kind: "worked_out", amount: 500000, currency: "HKD", how: "100% of sum insured" }, { percent: 100, base: 500000 });
  const [, c, c2] = cards([base, ci, ci2], [worked]);
  check("different sum: the row is shown, the base's worked-out figure is not", () => { assert.doesNotMatch(c, /500,000/); assert.match(c, /Critical illness benefit/); assert.match(c, /See the page/); });
  check("no sum printed: the worked-out figure is not shown either", () => { assert.doesNotMatch(c2, /500,000/); assert.match(c2, /See the page/); });
  const same = cover("Hong Kong Life Protector", "Critical Illness", 500000, "HKD");
  check("same sum: shown with its figure", () => { const r = rowsForCover(same, [base, same], [worked]).rows; assert.equal(r.length, 1); assert.equal(r[0].figure, worked.figure); });
}

// 5b. TE F1 on #282: a line printing its own sum never shows the plan's different PRINTED figure for that benefit.
{
  const base = cover("Lifeguard Max", "Lifeguard Max", 500000), ti = cover("Lifeguard Max", "Terminal Illness", 100000);
  const [, t] = cards([base, ti], [row(base, "Terminal Illness", printed(500000))]);
  check("F1 own sum S$100,000: the plan's S$500,000 is not shown", () => { assert.doesNotMatch(t, /500,000/); assert.match(t, /Terminal Illness/); assert.match(t, /See the page/); });
  const [, t2] = cards([base, ti], [row(base, "Terminal Illness", printed(100000))]);
  check("F1 control: the same sum is shown", () => assert.match(t2, /class="v">S\$100,000</));
  const [, t3] = cards([base, ti], [row(base, "Terminal Illness", printed(100000, "MYR"))]);
  check("F1 another currency is not the same sum", () => assert.doesNotMatch(t3, /MYR 100,000/));
}

// 5c. TE F2 on #282: two policies of one product share a cover key; a row of the other policy's document is never borrowed.
{
  const docA = { ...source, documentId: "00000000-0000-4000-8000-0000000000b1" }, docB = { ...source, documentId: "00000000-0000-4000-8000-0000000000b2" };
  const baseA = { ...cover("Takaful Hayat", "Takaful Hayat", 300000, "MYR"), source: docA }, baseB = { ...cover("Takaful Hayat", "Takaful Hayat", 80000, "MYR"), source: docB };
  const tiB = { ...cover("Takaful Hayat", "Penyakit Terminal", null, "MYR"), source: docB };
  const rowA = { ...row(baseA, "Penyakit Terminal", printed(300000, "MYR")), source: { ...docA, excerpt: "Penyakit Terminal RM300,000" } };
  const [, , t] = cards([baseA, baseB, tiB], [rowA]);
  check("F2 policy A's RM300,000 never shows on policy B's line", () => { assert.doesNotMatch(t, /300,000/); assert.doesNotMatch(t, UPLOAD); });
  check("F2 it points to the plan's card instead", () => assert.match(t, /What it pays is set out with Takaful Hayat/));
}

// 6. Another product's rows are never borrowed; with nothing of the same product read, the upload ask stays.
{
  const other = cover("Other Insurer Health Plan", "Other Insurer Health Plan", null), rider = cover("Lone Term Plan", "Terminal Illness", null);
  const [, r] = cards([other, rider], [row(other, "Terminal Illness Benefit")]);
  check("other product not borrowed", () => { assert.doesNotMatch(r, /Terminal Illness Benefit/); assert.match(r, UPLOAD); });
}

// 7. A script with no spaces is compared whole: "末期疾病" is not "末期疾病保障", so it points to the plan's card, never guesses.
{
  const base = cover("守护终身寿险", "守护终身寿险", 1000000, "CNY"), ti = cover("守护终身寿险", "末期疾病", null, "CNY");
  const [, t] = cards([base, ti], [row(base, "末期疾病保障")]);
  check("CJK: no guess, no upload ask", () => { assert.doesNotMatch(t, /末期疾病保障/); assert.match(t, /What it pays is set out with 守护终身寿险/); });
  const [, t2] = cards([base, ti], [row(base, "末期疾病：提前给付身故保险金")]);
  check("CJK: row head before a full-width colon matches", () => assert.match(t2, /末期疾病：提前给付/));
}

// 8. Word helpers.
check("filler and short forms", () => {
  assert.deepEqual([...benefitWords("WAIVER OF PREMIUM ON TPD BENEFIT")].sort(), ["disability", "permanent", "premium", "total", "waiver"]);
  assert.deepEqual([...benefitWords("Premiums waiver for total & permanent disabilities")].sort(), ["disability", "permanent", "premium", "total", "waiver"]);
  assert.equal(rowHead("Death benefit: higher of 105%"), "Death benefit");
  assert.equal(rowHead("Terminal illness (advance of death benefit)"), "Terminal illness ");
});
// A cover with rows of its own keeps exactly those.
check("own rows win", () => {
  const base = cover("P", "P", 1), rid = cover("P", "Terminal Illness", 1);
  const own = row(rid, "Rider schedule"), plan = row(base, "Terminal illness");
  assert.deepEqual(rowsForCover(rid, [base, rid], [own, plan]).rows, [own]);
});

console.log(`benefit-table cover-rows: ${passed} passed, 0 failed`);

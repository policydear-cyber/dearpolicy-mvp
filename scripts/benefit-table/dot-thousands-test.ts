/** A document from a market that groups thousands with dots ("Rp 500.000.000", "€250.000", "R$ 1.000.000,00") keeps
 * its covers and figures in the benefit table. Before, the intake check read "500.000.000" as no figure, so the whole cover
 * was dropped: Home showed the schedule's Death tile while Family and Coverage listed nothing for the person (cross-page
 * check, 31 Oct). Made-up households in IDR, EUR (two ways) and VND, plus guards (a three-decimal currency, a rate, comma
 * grouping). No model, no database, no network.
 *   npm run benefit-table:dot-thousands-test */
import { checkReading, numbersIn, printsNumber } from "@/lib/benefit-table/check";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { kindsOfTable } from "@/components/cover-kinds";

const realFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;
let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail?: unknown) { if (ok) pass++; else { fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`); } }

// The figure reader.
const has = (text: string, v: number) => printsNumber(text, v);
t("Rp 500.000.000", has("Uang Pertanggungan\tRp 500.000.000", 500_000_000), numbersIn("Rp 500.000.000"));
t("Rp 500.000 (one group)", has("Santunan rawat inap per hari\tRp 500.000", 500_000));
t("€250.000", has("Todesfallleistung\t€250.000", 250_000));
t("€ 1.000.000,00", has("Capitale assicurato\t€ 1.000.000,00", 1_000_000));
t("2.400,50 with a decimal comma", has("Prêmio mensal\tR$ 2.400,50", 2400.5));
t("150.000.000 ₫", has("Số tiền bảo hiểm\t150.000.000 ₫", 150_000_000));
t("comma grouping unchanged", has("Sum assured\tS$600,000", 600_000) && has("Limit\tRM1,000,000", 1_000_000));
t("a decimal unchanged", has("Daily cash\t$12.50", 12.5));
t("BHD 1.500 is one and a half, never 1500", has("Benefit\tBHD 1.500", 1.5) && !has("Benefit\tBHD 1.500", 1500));
t("a rate 1.375% is never 1375", !has("Rate\t1.375%", 1375));
t("1.500 million is no 1.5 billion", !has("Limit\t€1.500 million", 1_500_000_000));
t("a date is no figure of a million", !has("Tanggal\t01.02.2026", 1_022_026));
// Read whole only where the grouping is certain (Critic #262 H1, the #260 rule): a lone dot group with no currency beside
// it is a section, table, multiplier, year or count, never fifteen hundred; with a scale word, nothing is guessed.
t("€1.500 million is never 1,500", !has("Limit\t€1.500 million", 1_500));
t("Rp 1.500 juta is never 1,500", !has("Batas\tRp 1.500 juta", 1_500));
t("Section 1.500 is no figure", !has("Section 1.500 Benefits", 1_500));
t("Multiplier 1.250 is no figure", !has("Multiplier 1.250", 1_250));
t("Table 2.000 is no figure", !has("Table 2.000", 2_000));
t("3.500 times salary is no figure", !has("Up to 3.500 times monthly salary", 3_500));
t("Policy year 2.026 is no figure", !has("Policy year 2.026", 2_026));
t("a lone dot group with no currency is no figure", !has("Benefit\t1.500", 1_500));
t("a three-letter word is no currency", !has("TPD 1.500", 1_500));
t("KD 1.250 is one and a quarter dinars", has("Benefit\tKD 1.250", 1.25) && !has("Benefit\tKD 1.250", 1_250));
t("a code after the figure counts", has("Leistung\t1.500 EUR", 1_500));
t("two dot groups need no currency", has("Uang Pertanggungan\t500.000.000", 500_000_000));
t("a decimal comma needs no currency", has("Capitale\t1.000,00", 1_000));
// Beside the sign of a market that groups with commas, a lone dot group is a decimal point (TE #262 F1).
for (const [text, v] of [["S$1.500", 1500], ["US$1.500", 1500], ["RM1.500", 1500], ["£1.500", 1500], ["₹1.500", 1500], ["HK$12.500", 12500], ["A$2.250", 2250], ["SGD 1.500", 1500]] as const)
  t(`${text} is never ${v}`, !has(`Benefit\t${text}`, v));
t("R$ 1.500 is fifteen hundred reais", has("Benefício\tR$ 1.500", 1500));
t("1.500 ₫ is fifteen hundred dong", has("Quyền lợi\t1.500 ₫", 1500));
t("S$1.500.000 is still 1.5 million", has("Sum assured\tS$1.500.000", 1_500_000));
// A scale word in another language: never the bare figure (TE #262 F2).
for (const text of ["Limite € 2.500 milioni", "Limite € 2.500 MILIONI", "Capital R$ 2.500 milhões", "Límite € 2.500 millones", "Hạn mức 2.500 triệu ₫", "Hạn mức 2.500 tỷ ₫", "Batas Rp 2.500 triliun", "Limite € 2.500 miliardi"])
  t(`${text}: never 2,500`, !has(text, 2500));

// Whole households, through the intake check and the table.
type Case = { market: string; person: string; product: string; cover: string; text: string; quote: string; sum: number; currency: string; kind: string; extra?: { name: string; quote: string; value: number; pays: string } };
const CASES: Case[] = [
  { market: "ID", person: "Budi Wijaya", product: "Cendana Proteksi Jiwa", cover: "Term Life", text: "IKHTISAR POLIS\nCendana Proteksi Jiwa\nTertanggung\tBudi Wijaya\nUang Pertanggungan\tRp 500.000.000\nSantunan rawat inap per hari\tRp 500.000",
    quote: "Uang Pertanggungan\tRp 500.000.000", sum: 500_000_000, currency: "IDR", kind: "Death", extra: { name: "Santunan rawat inap per hari", quote: "Santunan rawat inap per hari\tRp 500.000", value: 500_000, pays: "per_day" } },
  { market: "DE", person: "Lena Vogel", product: "Eichenhof Risikolebensversicherung", cover: "Term Life", text: "VERSICHERUNGSSCHEIN\nEichenhof Risikolebensversicherung\nVersicherte Person\tLena Vogel\nTodesfallleistung\t€250.000",
    quote: "Todesfallleistung\t€250.000", sum: 250_000, currency: "EUR", kind: "Death" },
  { market: "IT", person: "Giulia Ferri", product: "Olivo Vita Intera", cover: "Whole Life", text: "POLIZZA\nOlivo Vita Intera\nAssicurato\tGiulia Ferri\nCapitale assicurato\t€ 1.000.000,00",
    quote: "Capitale assicurato\t€ 1.000.000,00", sum: 1_000_000, currency: "EUR", kind: "Death" },
  { market: "VN", person: "Tran Thi Mai", product: "Sen Vàng Term Life", cover: "Term Life", text: "HỢP ĐỒNG\nSen Vàng Term Life\nNgười được bảo hiểm\tTran Thi Mai\nSố tiền bảo hiểm\t150.000.000 ₫",
    quote: "Số tiền bảo hiểm\t150.000.000 ₫", sum: 150_000_000, currency: "VND", kind: "Death" },
];
const b = (o: Record<string, unknown>) => ({ section: "SCHEDULE", column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
  cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
for (const c of CASES) {
  const id = `aaaaaaaa-0000-0000-0000-0000000000${c.market === "ID" ? "01" : c.market === "DE" ? "02" : c.market === "IT" ? "03" : "04"}`;
  const reading = { document: { kind: "personal_proof", product: c.product, insurer: null, namedPeople: [c.person], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: c.person, product: c.product, cover: c.cover, plan: null, riderOf: null, policyNumber: null, sumInsured: c.sum, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: c.quote }],
    benefits: [b({ benefit: c.quote.split("\t")[0], value: c.sum, quote: c.quote }), ...(c.extra ? [b({ benefit: c.extra.name, pays: c.extra.pays, value: c.extra.value, quote: c.extra.quote })] : [])] };
  const checked = checkReading({ id, name: c.product + ".pdf", readable: true, pages: [{ page: 1, text: c.text }] }, reading as never);
  t(`${c.market}: the cover is kept with its sum`, checked.covers.length === 1 && checked.covers[0].sumInsured === c.sum, { covers: checked.covers.map((x) => [x.cover, x.sumInsured]), dropped: checked.dropped });
  t(`${c.market}: the cover's currency is ${c.currency}`, checked.covers[0]?.currency === c.currency, checked.covers[0]?.currency);
  t(`${c.market}: every benefit row is kept with its figure`, checked.benefits.length === reading.benefits.length && checked.benefits.every((x, i) => x.value === reading.benefits[i].value), { benefits: checked.benefits.map((x) => [x.benefit, x.value]), dropped: checked.dropped });
  const family: FamilyMember[] = [{ id: "p", display_name: c.person }];
  const links = [{ section: sectionKeyOf(id, { section: "SCHEDULE", column: null }), cover: coverKeyOf({ product: c.product, cover: c.cover, plan: null }), why: "the plan" }];
  const person = assembleTable([checked], family, links).people[0];
  t(`${c.market}: the person's table holds the cover`, person.covers.length === 1 && person.rows.length >= 1, { covers: person.covers.length, rows: person.rows.length });
  t(`${c.market}: Family lists ${c.kind}`, kindsOfTable(person.rows, person.covers).includes(c.kind), kindsOfTable(person.rows, person.covers));
  // A figure the document does not print is still refused, in the same market.
  const wrong = checkReading({ id, name: "x.pdf", readable: true, pages: [{ page: 1, text: c.text }] }, { ...reading, covers: [{ ...reading.covers[0], sumInsured: c.sum * 10 }], benefits: [] } as never);
  t(`${c.market}: a sum ten times the printed one is refused`, wrong.covers.every((x) => x.sumInsured !== c.sum * 10), wrong.covers);
}

globalThis.fetch = realFetch;
t("no outbound fetch", fetches === 0, fetches);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

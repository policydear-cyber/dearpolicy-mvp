/** A document from a market that groups thousands with spaces ("EUR 80 000", "120 000 kr", "2 500 zł", "CHF 12 500,50",
 * with a plain, no-break or narrow space) keeps its covers and figures in the benefit table. Before, the intake check read
 * only the pieces ("80" and "000"), so the cover was dropped from Coverage and "EUR 80" passed as printed (TE #331). Read
 * whole by evidence.ts's rule: a currency right beside the figure, or space groups closed by a comma decimal. Made-up
 * households in FR, SE, PL, CZ, NO and CH, plus guards. No model, no database, no network.
 *   npm run benefit-table:space-thousands-test */
import { checkReading, numbersIn, printsNumber } from "@/lib/benefit-table/check";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { kindsOfTable } from "@/components/cover-kinds";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
const realFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;
let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail?: unknown) { if (ok) pass++; else { fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`); } }

// The figure reader.
const has = (text: string, v: number) => printsNumber(text, v);
t("EUR 80 000", has("Capital décès\tEUR 80 000", 80_000), numbersIn("EUR 80 000"));
t("80 000 €", has("Capital décès\t80 000 €", 80_000));
t("120 000 kr", has("Dödsfallsbelopp\t120 000 kr", 120_000));
t("no-break space", has("Suma ubezpieczenia\t2\u00a0500 zł", 2_500));
t("narrow no-break space with a comma decimal", has("Leistung\tCHF 12\u202f500,50", 12_500.5));
t("space groups closed by a comma decimal need no currency", has("Capital\t1 250,00", 1_250));
t("three groups", has("Pojistná částka\t1 500 000 Kč", 1_500_000));
t("a code after the figure", has("Forsikringssum\t750 000 NOK", 750_000));
// A piece of a figure read whole is not a figure of its own: "EUR 80 000" prints no 80, no 0, no 500 000 of 1 500 000.
t("EUR 80 000 prints no 80", !has("Capital décès\tEUR 80 000", 80));
t("EUR 80 000 prints no 0", !has("Capital décès\tEUR 80 000", 0));
t("1 500 000 Kč prints no 500 000", !has("Pojistná částka\t1 500 000 Kč", 500_000));
// Never read whole without a currency, or after a section, year or reference word, or before a percent sign or times.
t("an ID number with no currency is no figure", !has("Kundnummer\t123 456 789", 123_456_789));
t("a postcode is no figure", !has("Agence\t75 008 Paris", 75_008));
t("Section 1 500 EUR is no figure", !has("Section 1 500 EUR", 1_500));
t("Policy year 2 026 is no figure", !has("Policy year 2 026", 2_026));
t("25 000 times is no figure", !has("Up to 25 000 times salary", 25_000));
t("12 500 % is no figure", !has("Rate 12 500 % EUR", 12_500));
t("a three-letter word is no currency", !has("TPD 80 000", 80_000));
// Two columns a single space apart join into one run: by its figures alone the split is not known, so nothing is read
// whole (TE #333). Four or more groups, or three whose first group has three digits.
t("EUR 250 100 000 is no 250,100,000", !has("Plan\tEUR 250 100 000", 250_100_000));
t("EUR 100 000 200 000 is no 100,000,200,000", !has("Plan A Plan B\tEUR 100 000 200 000", 100_000_200_000));
t("Room 250 120 000 EUR is no 250,120,000", !has("Room 250 120 000 EUR", 250_120_000));
t("EUR 1 500 000 000 reads nothing whole", !has("Limit\tEUR 1 500 000 000", 1_500_000_000));
t("12 500 000 still reads whole", has("Pojistná částka\t12 500 000 Kč", 12_500_000));
t("beside a currency, an unclear run prints none of its pieces", !has("Room 250 120 000 EUR", 120) && !has("Room 250 120 000 EUR", 250));
// Swiss apostrophe thousands, read whole beside a currency or with two or more groups.
t("CHF 12'000", has("Taggeld\tCHF 12'000", 12_000) && !has("Taggeld\tCHF 12'000", 12));
t("12’500.50 CHF", has("Leistung\t12’500.50 CHF", 12_500.5));
t("1'250'000 needs no currency", has("Todesfallkapital\t1'250'000", 1_250_000));
t("a lone apostrophe group with no currency is no figure", !has("Art. 12'000", 12_000));
// A currency after a figure belongs to the next figure when one follows it.
t("Member ID 123 456 EUR 50 000 prints no 123,456", !has("Member ID 123 456 EUR 50 000", 123_456) && has("Member ID 123 456 EUR 50 000", 50_000));
// Comma-grouping markets: plan columns a space apart stay separate figures (Critic #333 H1).
for (const [text, keep, never] of [
  ["Daily room S$ 150 250 350", [150, 250, 350], 150_250_350], ["Room and board RM 200 300 per day", [200, 300], 200_300],
  ["Hospital cash S$ 100 365 days", [100, 365], 100_365], ["Surgery 500 750 SGD", [500, 750], 500_750],
  ["Zimmer 150 250 €", [150, 250], 150_250], ["Room USD 200 300 per day", [200, 300], 200_300],
  ["Krankenhaus EUR 100 365 Tage", [100, 365], 100_365], ["Rp 1 500 000", [], 1_500_000],
] as [string, number[], number][]) t(`${text}: no piece and no joined figure prints`, keep.every((v) => !has(text, v)) && !has(text, never), numbersIn(text));
// A figure counts as printed only as a whole run, never as a part of one (Critic #333 M1): which digits belong to which
// figure is not known, in any market or grouping.
for (const [text, never] of [
  ["Sum assured S$ 1 500 000", [500, 1, 1_500_000]], ["Zimmer EUR 1 250 2 500", [250, 2_500, 1_250]], ["Hospital ₹ 1 50 000", [50_000, 150_000, 50]],
  ["Sjukhus kr 2 500 3 500", [2_500, 3_500, 500]], ["Rawat inap Rp 1 500 000", [500, 1_500_000]], ["Room HK$ 500 800 1 000", [500, 800, 1_000]],
  ["Cover US$ 100 000 200 000", [100_000, 200_000, 100]], ["Room 150.00 250.00", [150, 250]],
] as [string, number[]][]) t(`${text}: no part of the run prints`, never.every((v) => !has(text, v)), numbersIn(text));
t("columns parted by tabs or wider gaps still print", has("Room\tS$150\tS$250", 150) && has("Room\tS$150\tS$250", 250) && has("Plan A   150   250", 250) && has("Daily room S$150 S$250 S$350", 250));
t("a percent or a section number is no money run", has("Section 3 100", 100) || numbersIn("Section 3 100").length > 0);
t("EUR 150 000 is still one figure", has("Capital EUR 150 000", 150_000) && !has("Capital EUR 150 000", 150));
t("150 250,00 € is one figure", has("Zimmer 150 250,00 €", 150_250));
t("a currency after the figure, then words, still counts", has("Capital décès 80 000 € par sinistre", 80_000));
// Other groupings unchanged.
t("comma grouping unchanged", has("Sum assured\tS$600,000", 600_000));
t("dot grouping unchanged", has("Uang Pertanggungan\tRp 500.000.000", 500_000_000));
t("two figures in one line still read apart", has("Room 250 per day, EUR 80 000 in all", 250) && has("Room 250 per day, EUR 80 000 in all", 80_000));

// Whole households, through the intake check and the table.
type Case = { market: string; person: string; product: string; cover: string; text: string; quote: string; sum: number; currency: string; kind: string; extra?: { name: string; quote: string; value: number; pays: string } };
const CASES: Case[] = [
  { market: "FR", person: "Camille Durand", product: "Platane Prévoyance", cover: "Term Life", text: "CERTIFICAT D'ADHÉSION\nPlatane Prévoyance\nAssuré\tCamille Durand\nCapital décès\tEUR 80 000",
    quote: "Capital décès\tEUR 80 000", sum: 80_000, currency: "EUR", kind: "Death" },
  { market: "SE", person: "Astrid Lindqvist", product: "Björk Livförsäkring", cover: "Term Life", text: "FÖRSÄKRINGSBREV\nBjörk Livförsäkring\nFörsäkrad\tAstrid Lindqvist\nDödsfallsbelopp\t1 200 000 SEK",
    quote: "Dödsfallsbelopp\t1 200 000 SEK", sum: 1_200_000, currency: "SEK", kind: "Death" },
  { market: "PL", person: "Zofia Nowak", product: "Jodła Życie", cover: "Term Life", text: "POLISA\nJodła Życie\nUbezpieczony\tZofia Nowak\nSuma ubezpieczenia\tPLN 250\u00a0000",
    quote: "Suma ubezpieczenia\tPLN 250\u00a0000", sum: 250_000, currency: "PLN", kind: "Death" },
  { market: "CH", person: "Luca Meier", product: "Arve Risiko", cover: "Term Life", text: "POLICE\nArve Risiko\nVersicherte Person\tLuca Meier\nTodesfallkapital\tCHF 500\u202f000,00",
    quote: "Todesfallkapital\tCHF 500\u202f000,00", sum: 500_000, currency: "CHF", kind: "Death" },
];
const b = (o: Record<string, unknown>) => ({ section: "SCHEDULE", column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
  cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
for (const c of CASES) {
  const id = `aaaaaaaa-0000-0000-0000-0000000001${String(CASES.indexOf(c)).padStart(2, "0")}`;
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

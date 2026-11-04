/** A row of an illustration or projection table is no benefit, in any market: its "name" is one of its own figures
 * ("48,437", "15"), or its printed line holds no word at all ("10  RM 25,300  RM 31,200" read as "Surrender Value").
 * Before, the table check kept such rows, so Coverage and the chat's table listed lines named by a number with nothing
 * paid (live check, 4 Nov: 32 of 43 rows of one life schedule). Dropped when the stored reading is checked, so nothing
 * stored changes. Real benefits beside them, and rows whose line holds a word in any script, are kept. Made-up
 * households in SGD, MYR, HKD, EUR and IDR. No model, no database, no network.
 *   npm run benefit-table:illustration-rows-test */
import { checkReading, printsAWord } from "@/lib/benefit-table/check";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
const realFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;
let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail?: unknown) { if (ok) pass++; else { fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`); } }

t("figures and percentages only: no word", !printsAWord("15\t48,437\t101.10%\t0.10%"));
t("currency marks and codes are no word", !printsAWord("10\tRM 25,300\tRM 31,200") && !printsAWord("SGD 48,437") && !printsAWord("€ 1.500,00") && !printsAWord("HK$12,000\tHK$15,500"));
t("a word in any script", printsAWord("Age 15") && printsAWord("入院 HK$300") && printsAWord("Décès €80,000") && printsAWord("Rawat inap Rp 500.000"));

type Row = { name: string; quote: string; pays?: string; value?: number | null };
type Case = { market: string; person: string; product: string; text: string; cover: { quote: string; sum: number }; junk: Row[]; real: Row[] };
const CASES: Case[] = [
  { market: "SG", person: "Ana Cruz", product: "Kingfisher Whole Life",
    text: "POLICY SCHEDULE\nInsured: Ana Cruz\nDeath Benefit\tS$500,000\nBENEFIT ILLUSTRATION\nEnd of Policy Year\tTotal Premiums Paid\tValue of Premiums\tEffect of Deduction\n15\t48,437\t101.10%\t0.10%\n20\t143,309\t110.00%\t0.20%",
    cover: { quote: "Death Benefit\tS$500,000", sum: 500_000 },
    junk: [{ name: "48,437", quote: "15\t48,437\t101.10%\t0.10%" }, { name: "143,309", quote: "20\t143,309\t110.00%\t0.20%" }, { name: "15", quote: "15\t48,437\t101.10%\t0.10%" },
      { name: "101.10%", quote: "15\t48,437\t101.10%\t0.10%", pays: "percent", value: 101.1 }],
    real: [{ name: "Death Benefit", quote: "Death Benefit\tS$500,000", pays: "amount", value: 500_000 }] },
  { market: "MY", person: "Nurul Aina", product: "Cempaka Life Plan",
    text: "JADUAL POLISI\nDiinsuranskan: Nurul Aina\nManfaat Kematian\tRM 300,000\nElaun hospital sehari\tRM 200\nILUSTRASI NILAI TUNAI\nTahun\tNilai Tunai Terjamin\tNilai Tunai Tidak Terjamin\n10\tRM 25,300\tRM 31,200\n20\tRM 61,800\tRM 88,400",
    cover: { quote: "Manfaat Kematian\tRM 300,000", sum: 300_000 },
    junk: [{ name: "Surrender Value", quote: "10\tRM 25,300\tRM 31,200", pays: "amount", value: 25_300 }, { name: "RM 61,800", quote: "20\tRM 61,800\tRM 88,400", pays: "amount", value: 61_800 }],
    real: [{ name: "Elaun hospital sehari", quote: "Elaun hospital sehari\tRM 200", pays: "per_day", value: 200 }] },
  { market: "HK", person: "Chan Wing", product: "Harbour Savings Life",
    text: "保單附表\n受保人: Chan Wing\n身故賠償\tHK$1,000,000\n入院現金 每日 HK$300\n說明\n5\tHK$12,000\tHK$15,500\n10\tHK$24,000\tHK$33,800",
    cover: { quote: "身故賠償\tHK$1,000,000", sum: 1_000_000 },
    junk: [{ name: "12,000", quote: "5\tHK$12,000\tHK$15,500", pays: "amount", value: 12_000 }, { name: "Projected value", quote: "10\tHK$24,000\tHK$33,800", pays: "amount", value: 33_800 }],
    real: [{ name: "入院現金", quote: "入院現金 每日 HK$300", pays: "per_day", value: 300 }] },
  { market: "FR", person: "Camille Durand", product: "Platane Épargne Vie",
    text: "CERTIFICAT\nAssuré: Camille Durand\nCapital décès\t€80,000\nProjection\nAnnée\tValeur de rachat\n5\t€ 4.250,00\n10\t€ 9.100,00",
    cover: { quote: "Capital décès\t€80,000", sum: 80_000 },
    junk: [{ name: "Valeur de rachat", quote: "10\t€ 9.100,00", pays: "amount", value: 9_100 }, { name: "5", quote: "5\t€ 4.250,00" }],
    real: [{ name: "Capital décès", quote: "Capital décès\t€80,000", pays: "amount", value: 80_000 }] },
  { market: "ID", person: "Budi Santoso", product: "Cendana Proteksi Investasi",
    text: "IKHTISAR POLIS\nTertanggung: Budi Santoso\nUang Pertanggungan\tRp 500.000.000\nRawat inap per hari\tRp 500.000\nILUSTRASI\n5\tRp 12.500.000\tRp 15.000.000\n10\tRp 30.000.000\tRp 41.000.000",
    cover: { quote: "Uang Pertanggungan\tRp 500.000.000", sum: 500_000_000 },
    junk: [{ name: "12.500.000", quote: "5\tRp 12.500.000\tRp 15.000.000", pays: "amount", value: 12_500_000 }, { name: "Nilai tunai", quote: "10\tRp 30.000.000\tRp 41.000.000", pays: "amount", value: 30_000_000 }],
    real: [{ name: "Rawat inap per hari", quote: "Rawat inap per hari\tRp 500.000", pays: "per_day", value: 500_000 }] },
];
const b = (r: Row) => ({ section: "SCHEDULE", column: null, benefit: r.name, pays: r.pays ?? "words", value: r.value ?? null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null,
  baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: r.quote });
for (const [i, c] of CASES.entries()) {
  const id = `aaaaaaaa-0000-0000-0000-0000000002${String(i).padStart(2, "0")}`;
  const reading = { document: { kind: "personal_proof", product: c.product, insurer: null, namedPeople: [c.person], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: c.person, product: c.product, cover: "Life", plan: null, riderOf: null, policyNumber: null, sumInsured: c.cover.sum, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: c.cover.quote }],
    benefits: [...c.junk, ...c.real].map(b) };
  const checked = checkReading({ id, name: c.product + ".pdf", readable: true, pages: [{ page: 1, text: c.text }] }, reading as never);
  const kept = checked.benefits.map((x) => x.benefit);
  for (const j of c.junk) t(`${c.market}: illustration row "${j.name}" is no benefit`, !kept.includes(j.name), { kept, dropped: checked.dropped });
  for (const r of c.real) t(`${c.market}: real benefit "${r.name}" is kept with its figure`, checked.benefits.some((x) => x.benefit === r.name && x.value === (r.value ?? null)), { kept, dropped: checked.dropped });
  t(`${c.market}: the cover is kept`, checked.covers.length === 1 && checked.covers[0].sumInsured === c.cover.sum, { covers: checked.covers, dropped: checked.dropped });
  const family: FamilyMember[] = [{ id: "p", display_name: c.person }];
  const links = [{ section: sectionKeyOf(id, { section: "SCHEDULE", column: null }), cover: coverKeyOf({ product: c.product, cover: "Life", plan: null }), why: "the plan" }];
  const person = assembleTable([checked], family, links).people[0];
  const shown = JSON.stringify(person?.rows ?? []);
  t(`${c.market}: the person's table shows no illustration row`, c.junk.every((j) => !shown.includes(`"${j.name}"`)), shown.slice(0, 300));
  t(`${c.market}: the person's table shows the real benefits`, c.real.every((r) => shown.includes(r.name)), shown.slice(0, 300));
}

globalThis.fetch = realFetch;
t("no outbound fetch", fetches === 0, fetches);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

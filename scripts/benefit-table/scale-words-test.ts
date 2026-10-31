/** A figure before a scale word is read with the word, or not at all, never bare. Before, the intake check's figure
 * reader knew only "million" and "m": "Rp 2 juta" printed 2, "S$3 mn" printed 3, "R$ 1,5 juta" printed 15, so a model's
 * misread of the bare figure was verified (TE #262 P1, Critic). Now every scale word the shared reader knows
 * (lib/format/printed-number.ts SCALE_WORD) multiplies the figure; a figure or word that reads two ways ("1.500 Mio.",
 * "€5 mil") prints no figure. No model, no database, no network.
 *   npm run benefit-table:scale-words-test */
import { numbersIn, printsNumber } from "@/lib/benefit-table/check";
import { SCALE_WORD } from "@/lib/format/printed-number";

const realFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;
let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail?: unknown) { if (ok) pass++; else { fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`); } }
const has = (text: string, v: number) => printsNumber(text, v);

// Read with the word, in several markets.
for (const [text, v, bare] of [
  ["Sum assured\tS$1.5 million", 1_500_000, 1.5], ["Sum assured\tS$1 million", 1_000_000, 1], ["Limit\tUS$2.5m", 2_500_000, 2.5],
  ["Uang Pertanggungan\tRp 2 juta", 2_000_000, 2], ["Santunan\tRp 1,5 juta", 1_500_000, 1.5], ["Limit\tS$3 mn", 3_000_000, 3],
  ["Limit\tHK$2 bn", 2_000_000_000, 2], ["Excess\t£5k", 5_000, 5], ["Cover\t₹2 crore", 20_000_000, 2], ["Cover\t₹5 lakh", 500_000, 5],
  ["Leistung\t€2 Mio.", 2_000_000, 2], ["Leistung\t€1,5 Mio.", 1_500_000, 1.5],
] as const) {
  t(`${text}: reads ${v}`, has(text, v), numbersIn(text));
  t(`${text}: never the bare ${bare}`, !has(text, bare), numbersIn(text));
}
t("1,5 juta is never 15 or 15 million", !has("Rp 1,5 juta", 15) && !has("Rp 1,5 juta", 15_000_000), numbersIn("Rp 1,5 juta"));
// Reads two ways: no figure.
t("€5 mil (a thousand or a million) prints nothing", numbersIn("Limite\t€5 mil").length === 0, numbersIn("€5 mil"));
t("1.500 Mio. (1.5 or 1,500 million) prints nothing", numbersIn("Leistung\t€1.500 Mio.").length === 0, numbersIn("€1.500 Mio."));
// Words that only start like a scale word are no scale word.
t("milestone", has("Bonus\tS$5,000 milestone", 5_000));
t("millionaire", has("Plan\tRM 50,000 millionaire", 50_000));
t("months", has("Waiting period\t10 months", 10) && !has("10 months", 10_000_000));
t("minutes", has("3 mins", 3));
// A scale word with no allowed currency beside the figure: the figure prints nothing, never bare and never scaled (TE #265 F3).
t("100 MD consultations prints nothing", numbersIn("Outpatient\t100 MD consultations").length === 0, numbersIn("100 MD consultations"));
for (const text of ["Cover\t3 Mio.", "Cover\t3 Mio", "Cover\t2 Mrd.", "Santunan\t2 jt", "Cover\t5 Cr", "Quyền lợi\t150 tr", "Excess\t5k", "Limit\t2 bn", "Limit\t3 mn", "Santunan\t500 rb"])
  t(`${text} prints nothing`, numbersIn(text).length === 0, numbersIn(text));
t("TPD 2 mn: a code-like word is no currency", !has("Limit\tTPD 2 mn", 2_000_000), numbersIn("TPD 2 mn"));
t("2 k visits prints nothing", numbersIn("Physio\t2 k visits").length === 0, numbersIn("2 k visits"));
t("Limit 1.5m (no currency) keeps its old million reading", has("Limit\t1.5m", 1_500_000), numbersIn("Limit 1.5m"));
t("2 Mio. € reads 2 million", has("Leistung\t2 Mio. €", 2_000_000), numbersIn("2 Mio. €"));
t("S$ 1.25m reads 1.25 million", has("Limit\tS$ 1.25m", 1_250_000) && !has("S$ 1.25m", 1.25), numbersIn("S$ 1.25m"));
// Short abbreviations, only beside a currency (Critic #265): juta, ribu, crore, triệu.
for (const [text, v, bare] of [["Santunan\tRp 2 jt", 2_000_000, 2], ["Santunan\tRp 1,5 jt", 1_500_000, 1.5], ["Santunan\tRp 500 rb", 500_000, 500],
  ["Cover\t₹2 Cr", 20_000_000, 2], ["Quyền lợi\t150 tr ₫", 150_000_000, 150]] as const) {
  t(`${text}: reads ${v}`, has(text, v), numbersIn(text));
  t(`${text}: never the bare ${bare}`, !has(text, bare), numbersIn(text));
}
t("an abbreviation with no currency prints nothing", numbersIn("Physio\t2 tr sessions").length === 0, numbersIn("2 tr sessions"));
t("a word that starts like one is no abbreviation", has("Bonus\tRp 2 jtk", 2) || numbersIn("Rp 2 jtk").includes(2), numbersIn("Rp 2 jtk"));
// Strict first (coordinator, 31 Oct): a local scale word only with its own currency directly beside the figure.
for (const [text, wrong] of [["Santunan\tS$2 juta", 2_000_000], ["Cover\tRp 5 lakh", 500_000], ["Cover\tS$2 crore", 20_000_000], ["Cover\tUS$2 Cr", 20_000_000],
  ["Quyền lợi\t150 tr S$", 150_000_000], ["Leistung\tS$2 Mio.", 2_000_000], ["Santunan\t₹500 rb", 500_000], ["Santunan\tRp 2 Cr", 20_000_000],
  ["Cover\t5 lakh", 500_000], ["Cover\t5 lakh", 5], ["Santunan\t2 juta", 2_000_000], ["Santunan\t2 juta", 2], ["Leistung\t2 Mio.", 2_000_000],
  ["Cover\tRs. 5 lakh in total, 2 juta", 2_000_000], ["Limit\t3 mn visits", 3_000_000], ["Limit\t2 bn steps", 2_000_000_000]] as const)
  t(`${text}: never ${wrong}`, !has(text, wrong), numbersIn(text));
for (const [text, v] of [["Santunan\tRM 2 juta", 2_000_000], ["Cover\tRs. 5 lakh", 500_000], ["Cover\tPKR 2 crore", 20_000_000], ["Cover\t৳ 5 lakh", 500_000],
  ["Leistung\tCHF 2 Mio.", 2_000_000], ["Santunan\tIDR 3 miliar", 3_000_000_000], ["Quyền lợi\tVND 150 tr", 150_000_000]] as const)
  t(`${text}: reads ${v}`, has(text, v), numbersIn(text));
t("comma grouping unchanged", has("Sum assured\tS$600,000", 600_000) && has("S$2,000,000.00", 2_000_000));
t("a rate unchanged", has("Rate\t1.375%", 1.375));
// Words in other languages, once the shared reader knows them (they are in its list from #262): never the bare figure.
for (const [text, bare] of [["Limite € 2.500 milioni", 2.5], ["Límite € 3 millones", 3], ["Hạn mức 150 triệu ₫", 150], ["Capital R$ 1,5 milhões", 15]] as const) {
  const word = text.split(" ").find((w) => new RegExp(`^${SCALE_WORD}$`).test(w));
  if (word) t(`${text}: never the bare ${bare}`, !has(text, bare), numbersIn(text));
}

globalThis.fetch = realFetch;
t("no outbound fetch", fetches === 0, fetches);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

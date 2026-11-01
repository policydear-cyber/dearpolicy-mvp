/** Every currency a document prints is read from a closed list: signs of one currency only (R$, MX$, ₺, ₪, zł, Kč,
 * S/ ...) and real ISO 4217 codes directly beside a money-shaped figure; an unknown label stays unknown, never SGD. Before, "R$" and most codes outside Asia were read as no currency, so a
 * Brazilian household's covers had no currency (cross-page check, 31 Oct); and any three letters counted as a code ("TPD").
 * Signs several countries print (Rs, kr, Fr., a bare $) stay unresolved. No model, no database, no network.
 *   npm run format:currency-markers-test */
import { statedCurrencyCode } from "@/lib/policies/benefit-rows";
import { isIsoCurrency, normalizeCurrencyCode } from "@/lib/format/currency";
import { checkReading } from "@/lib/benefit-table/check";

const realFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;
let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail?: unknown) { if (ok) pass++; else { fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`); } }

for (const [text, want] of [
  ["Renda mensal R$ 2.000", "BRL"], ["Capital segurado BRL 150000", "BRL"], ["Suma asegurada MX$500,000", "MXN"], ["Teminat 100.000 ₺", "TRY"],
  ["Kisui ₪ 50,000", "ILS"], ["Suma ubezpieczenia 200 000 zł", "PLN"], ["Pojistná částka 500 000 Kč", "CZK"],
  ["Suma asegurada S/ 50,000", "PEN"], ["Cover ZAR 1,000,000", "ZAR"], ["Cover 1,000,000 ZAR", "ZAR"],
  ["Cover AED 500,000", "AED"], ["Sum insured ₦ 2,000,000", "NGN"], ["Bima ৳ 5,00,000", "BDT"],
  // Unchanged markets.
  ["Sum assured S$500,000", "SGD"], ["Death benefit RM100,000", "MYR"], ["Uang Pertanggungan Rp 500.000.000", "IDR"], ["Sum assured £250,000", "GBP"],
  ["Capitale € 100.000", "EUR"], ["Cover US$1,000,000", "USD"], ["Cover A$500,000", "AUD"], ["Cover ₹ 50,00,000", "INR"],
] as const) t(`${text} is ${want}`, statedCurrencyCode(text) === want, statedCurrencyCode(text));
for (const text of ["TPD 1,000", "ALL 3 PLANS 1,000", "TOP 10 benefits 5,000", "Benefit $5,000", "Rs 5,00,000", "kr 10 000", "Fr. 1'000", "MED 2,000", "Plan B 50,000",
  // Strict first (coordinator, 31 Oct): a code only directly beside a money-shaped figure; "KD"/"BD" are read later, not now.
  "TRY 3 times a year", "Benefit KD 1.500", "Benefit BD 1.500", "ZAR 12 visits", "Code AED-7", "IRR 4.25% illustrated", "IRR 1,250 bps", "IRR 1,250 basis points", "IRR 12.50% p.a.", "AMD 3 stages", "PEN 2 days", "SAR 1.5x", "MOP 2 visits", "MAD 5", "BAM 3", "MDL 2", "ANG 3", "NPR 2", "AED 2 units on site", "Plan PLN 3: 20,000", "Policy no. S/ 12345 issued", "KD 3 days hospital", "S/N 12345", "S/ 12"])
  t(`${text} names no currency`, statedCurrencyCode(text) === null, statedCurrencyCode(text));

for (const label of ["TPD", "TL", "Rs", "MED", "KD", "dollars?"]) {
  t(`unknown label ${label} stays unknown, never SGD`, normalizeCurrencyCode(label) === "" && statedCurrencyCode(label) === null, normalizeCurrencyCode(label));
}
t("an empty value still takes the caller's fallback", normalizeCurrencyCode("", "SGD") === "SGD" && normalizeCurrencyCode(null, "") === "");
t("NTD, YEN and NIS normalise to TWD, JPY and ILS", normalizeCurrencyCode("NTD", "") === "TWD" && normalizeCurrencyCode("yen", "") === "JPY" && normalizeCurrencyCode("NIS", "") === "ILS");
t("R$ normalises to BRL", normalizeCurrencyCode("R$", "") === "BRL");
t("zł normalises to PLN", normalizeCurrencyCode("zł", "") === "PLN");
t("a lower-case code normalises", normalizeCurrencyCode("brl", "") === "BRL");
t("three letters that are no currency are not one", normalizeCurrencyCode("TPD", "") === "" && normalizeCurrencyCode("XYZ", "") === "" && normalizeCurrencyCode("MED", "") === "");
t("a bare $ is no currency", normalizeCurrencyCode("$", "") === "");
t("S$ still normalises", normalizeCurrencyCode("S$", "") === "SGD" && normalizeCurrencyCode("SGD", "") === "SGD");
t("the closed list knows real codes", isIsoCurrency("BRL") && isIsoCurrency("KWD") && isIsoCurrency("SGD") && !isIsoCurrency("TPD"));

// A Brazilian household through the benefit-table intake check: the cover keeps its currency.
const text = "APÓLICE\nVida Ipê Protegida\nSegurado\tAna Souza\nCapital segurado\tR$ 150000";
const reading = { document: { kind: "personal_proof", product: "Vida Ipê Protegida", insurer: null, namedPeople: ["Ana Souza"], plan: null, periodFrom: null, periodTo: null },
  covers: [{ person: "Ana Souza", product: "Vida Ipê Protegida", cover: "Term Life", plan: null, riderOf: null, policyNumber: null, sumInsured: 150000, premium: null, premiumFrequency: null,
    asOf: null, startDate: null, endDate: null, page: 1, quote: "Capital segurado\tR$ 150000" }], benefits: [] };
const checked = checkReading({ id: "aaaaaaaa-0000-0000-0000-000000000077", name: "vida.pdf", readable: true, pages: [{ page: 1, text }] }, reading as never);
t("BR: the cover is kept with its currency BRL", checked.covers.length === 1 && checked.covers[0].currency === "BRL", checked.covers.map((c) => [c.cover, c.sumInsured, c.currency]));

globalThis.fetch = realFetch;
t("no outbound fetch", fetches === 0, fetches);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

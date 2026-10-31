/**
 * "Does the page print this amount?" reads every printed figure whole, in any market's grouping: a figure is never found
 * inside a longer one. Before: amountAppears(…, 1936) was true on a page printing S$1,936.50, so a cut-off amount (cents
 * lost, a thousands group lost) passed as printed: a wrong amount; and a whole figure printed with dot thousands or a
 * comma decimal ("Rp4.250.000", "€18.500,50") was never found. Made-up pages in S$, RM, Rp, €, R$, CHF, ₹ and £; pure: no
 * database, no model, no network.
 *   npm run documents:amount-whole-test
 */
import assert from "node:assert/strict";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (() => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failed: string[] = [];
const t = (name: string, fn: () => void) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };

async function main() {
  const { amountAppears } = await import("@/lib/documents/evidence");
  const yes = (page: string, v: number, kind: "money" | "fraction" = "money") => assert.equal(amountAppears(page, v, kind), true, `${v} on «${page}»`);
  const no = (page: string, v: number, kind: "money" | "fraction" = "money") => assert.equal(amountAppears(page, v, kind), false, `${v} on «${page}»`);

  t("cents matter: a figure without its cents is not printed by one with them (S$, RM, £)", () => {
    no("Room and board\tS$1,936.50 a day", 1936); yes("Room and board\tS$1,936.50 a day", 1936.5);
    no("Premium RM2,400.75 yearly", 2400); yes("Premium RM2,400.75 yearly", 2400.75);
    no("Excess £125.40 per claim", 125); yes("Excess £125.40 per claim", 125.4);
  });
  t("whole amounts with or without .00 still read (S$, RM)", () => {
    yes("Sum assured S$800,000", 800000); yes("Sum assured S$800,000.00", 800000); yes("Limit RM150000 a year", 150000);
    yes("up to S$5,000.", 5000); yes("S$5,000, payable once", 5000); yes("S$5 000 per trip", 5000);
  });
  t("a dot-thousand figure is never read as its first group (Rp, €)", () => {
    no("Rawat inap maksimum Rp4.250.000 per hari", 4250); no("Rawat inap maksimum Rp4.250.000 per hari", 4.25);
    no("Leistung bis zu €1.800 je Fall", 1); no("Leistung bis zu €18.500,50 je Fall", 18500);
  });
  t("dot-thousand and comma-decimal markets: the whole printed figure is found (Rp, €, R$, CHF)", () => {
    yes("Rawat inap maksimum Rp4.250.000 per hari", 4250000); yes("Rp 25.000.000", 25000000); yes("Harian Rp350.000", 350000);
    yes("Leistung bis zu €1.800 je Fall", 1800); yes("Leistung bis zu €18.500,50 je Fall", 18500.5); yes("€ 2,50 pro Tag", 2.5);
    yes("Franchise 1.250,00 € par sinistre", 1250); yes("Franchise 1 250,00 € par sinistre", 1250); yes("Plafond 75 000 € par an", 75000);
    yes("Franquia R$ 2.500,00", 2500); yes("Selbstbehalt 150,00 EUR", 150); yes("Selbstbehalt 150,75 EUR", 150.75);
    yes("Selbstbehalt CHF 1'250.00", 1250); yes("Selbstbehalt CHF 1’250", 1250);
  });
  t("...and never a part of it (first group, lost cents, a thousand times off)", () => {
    no("Harian Rp350.000", 350); no("Rp 25.000.000", 25000); no("Selbstbehalt 150,75 EUR", 150); no("€ 2,50 pro Tag", 250);
    no("Selbstbehalt CHF 1'250.50", 1250); no("Franchise 1.250,00 € par sinistre", 1.25);
  });
  t("a lakh-grouped figure is found whole where a rupee sign shows the grouping (₹)", () => { yes("Sum insured ₹5,00,000", 500000); });
  t("an unclear scan or a scale word after the figure is not read as the figure", () => {
    no("Sum assured S$1,O36.00", 36); no("Sum assured S$1,O36.00", 1036); no("Cover up to €1.500 Mio.", 1500);
  });
  t("a lakh-grouped figure is never read as part of itself (₹)", () => {
    no("Sum insured ₹5,00,000", 500); no("Sum insured ₹5,00,000", 5);
  });
  t("a figure inside a longer one is never found (lead and tail)", () => {
    no("Limit S$12,500", 2500); no("Limit S$12,500", 12); no("Policy KBL-1250", 1250 + 0.5);
  });
  t("a share of a printed base is read on the whole base (€ dot thousands, S$)", () => {
    yes("25% of S$5,000", 1250); no("25% of €5.000", 1.25); yes("10% of S$100,000 up to maximum", 10000);
  });
  t("fractions are unchanged", () => { yes("Pays 25% of the sum assured", 0.25, "fraction"); no("Pays 25% of the sum assured", 0.2, "fraction"); });
  t("no request left this machine", () => assert.equal(fetches, 0));

  console.log(`\namount whole: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

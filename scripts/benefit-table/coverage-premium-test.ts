/**
 * The Coverage card prints a premium in the currency its own line settles ("Premium paid : S$73.17" on a travel summary
 * whose cover prints no currency), never a bare "$" (live check on f58a289). Made-up household; no database, no network,
 * no model.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BenefitTableCoverage, type BenefitTableData } from "@/components/benefit-table-coverage";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const source = { documentId: "00000000-0000-4000-8000-000000000001", document: "Travel summary", page: 1, excerpt: "Premium paid : S$73.17" };
const page = (premiumCurrency: string | null | undefined, currency: string | null) => {
  const cover = { personId: "p1", coverKey: "travel|single trip|gold", product: "Example Travel Summary", cover: "Single Trip", plan: "Gold", riderOf: null,
    policyNumber: null, sumInsured: null, premium: 73.17, premiumFrequency: null, startDate: null, endDate: null, currency, source,
    ...(premiumCurrency === undefined ? {} : { premiumCurrency }) };
  const data = { enabled: true, people: [{ id: "p1", name: "Ada Example", covers: [cover], rows: [] }], documents: [], unmatchedCovers: [],
    illustrationCovers: [], unlinkedSections: [] } as unknown as BenefitTableData;
  return renderToStaticMarkup(createElement(BenefitTableCoverage, { data }));
};
// The premium line's own currency, when the cover prints none.
assert.match(page("SGD", null), /Premium S\$73\.17/);
assert.match(page("MYR", "SGD"), /Premium MYR 73\.17/);
// Unset: the cover's currency. Set to none: no currency is claimed.
assert.match(page(undefined, "SGD"), /Premium S\$73\.17/);
assert.match(page(null, "SGD"), /Premium 73\.17 \(currency not stated\)/);
assert.doesNotMatch(page(null, "SGD"), /Premium \$/);
assert.match(page(undefined, null), /Premium 73\.17 \(currency not stated\)/);
console.log("coverage-premium-test: 6 checks passed");

/** A benefit figure printed with a bare "$" (or no sign) on a page that declares one currency for every figure ("Currency :
 * Singapore Dollar", "Mata Wang : Ringgit Malaysia", "Currency: Hong Kong Dollar") is stored in that currency, so the
 * Benefits page never says "currency not stated" for it. A figure with its own other mark, or a page that names another
 * currency or says "unless stated otherwise", gets none. Made-up schedules; the database part runs the real catalogue
 * builder (table reader, no model) on a disposable PostgreSQL and skips without one.
 *   npm run -s policies:page-currency-rows-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
let outbound = 0;
const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound++; throw new Error("no network"); }
  return localFetch(input, init);
}) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const schedule = (currencyLine: string, rows: string) => `Policy Schedule\nPolicy Details\nPlan\t:\tHARBOUR LIFETIME PROTECTOR\nInsured\t:\tNadia Rahman\n${currencyLine}\nBenefits and Premiums*\nCoverage/Benefit\tReference\tAmount\tCommencement Date\tExpiry Date\n${rows}\n* Subject to the relevant policy documents' terms and conditions`;
const ROWS = "HARBOUR LIFETIME PROTECTOR\t---\t$100,000.00\t21 Sep 2020\t21 Sep 2092\nTOTAL DISABILITY ACC\t2213S\t$100,000.00\t21 Sep 2020\t21 Sep 2062\nDOUBLE CRITICAL COVER\t2217S\t$80,000.00\t21 Sep 2020\t21 Sep 2092";

async function main() {
  const { unmarkedPageCurrency } = await import("@/lib/policies/catalog-builder");
  const SG = schedule("Insured Amount\t:\t$100,000.00\tCurrency\t:\tSingapore Dollar", ROWS);
  await test("U1 a bare $ on a page whose Currency field says Singapore Dollar: SGD", () => assert.equal(unmarkedPageCurrency("$100,000.00", SG), "SGD"));
  await test("U2 a figure with no sign on that page: SGD", () => assert.equal(unmarkedPageCurrency("100,000.00", SG), "SGD"));
  await test("U3 Hong Kong Dollar declared: a bare $ is HKD", () => assert.equal(unmarkedPageCurrency("$500,000", schedule("Currency: Hong Kong Dollar", ROWS)), "HKD"));
  await test("U4 Malay field 'Mata Wang : Ringgit Malaysia': MYR", () => assert.equal(unmarkedPageCurrency("50,000.00", schedule("Mata Wang\t:\tRinggit Malaysia", ROWS.replace(/\$/g, ""))), "MYR"));
  await test("U5 a figure with its own other mark never takes the page's", () => {
    for (const f of ["US$100,000", "HK$100,000", "RM 100,000", "€100.000", "£100,000", "USD 100,000", "A$100,000"]) assert.equal(unmarkedPageCurrency(f, SG), null, f);
  });
  await test("U6 a page that names another currency too declares none", () => assert.equal(unmarkedPageCurrency("$100,000.00", SG + "\nOptional rider premiums are payable in US Dollar."), null));
  await test("U7 'unless stated otherwise' declares none", () => assert.equal(unmarkedPageCurrency("$100,000.00", schedule("All amounts are in Singapore Dollars unless stated otherwise.", ROWS)), null));
  await test("U8 no declaration: none (a bare $ may be any dollar)", () => assert.equal(unmarkedPageCurrency("$100,000.00", schedule("Policy Date\t:\t21 Sep 2020", ROWS)), null));
  await test("U9 a page listing currency options declares none", () => assert.equal(unmarkedPageCurrency("$100,000.00", SG + "\nSix currency options are available: SGD, USD, AUD, GBP, EUR, JPY."), null));

  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB === "1" && /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    const { query } = await import("@/lib/db/client");
    const { catalogueDocument } = await import("@/lib/policies/catalog-builder");
    const { loadBenefitCatalog } = await import("@/lib/policies/benefit-catalog");
    const account = randomUUID();
    await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, "Page currency test household"]);
    const person = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,'Nadia Rahman','self') RETURNING id", [account])).rows[0].id;
    try {
      const run = async (text: string) => {
        const id = randomUUID();
        await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role)
          VALUES($1,$2,$3,'HARBOUR LIFETIME PROTECTOR','schedule.pdf',$4,'ready','ready','scan_clean',true,'personal_schedule')`, [id, account, person, `test/${id}`]);
        await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [account, id, text]);
        await catalogueDocument({ accountId: account, policyId: id, productName: "HARBOUR LIFETIME PROTECTOR", pages: [{ page_number: 1, text }] });
        return loadBenefitCatalog(account, [id]);
      };
      await test("D1 the catalogue stores the page's declared currency on its bare-$ rows", async () => {
        const rows = (await run(SG)).filter((b) => b.formulaValue != null && b.formulaKind !== "none");
        assert.ok(rows.length >= 2, JSON.stringify(rows.map((b) => [b.benefitName, b.formulaKind, b.formulaValue, b.currency])));
        assert.ok(rows.every((b) => b.currency === "SGD"), JSON.stringify(rows.map((b) => [b.benefitName, b.currency])));
      });
      await test("D2 control: no declaration, no currency", async () => {
        const rows = (await run(schedule("Policy Date\t:\t21 Sep 2020", ROWS))).filter((b) => b.formulaValue != null && b.formulaKind !== "none");
        assert.ok(rows.length >= 2); assert.ok(rows.every((b) => b.currency == null), JSON.stringify(rows.map((b) => [b.benefitName, b.currency])));
      });
    } finally {
      await query("DELETE FROM policy_benefits WHERE account_id=$1", [account]).catch(() => {});
      await query("DELETE FROM policy_pages WHERE account_id=$1", [account]).catch(() => {});
      await query("DELETE FROM policies WHERE account_id=$1", [account]).catch(() => {});
      await query("DELETE FROM family_members WHERE account_id=$1", [account]).catch(() => {});
      await query("DELETE FROM accounts WHERE id=$1", [account]).catch(() => {});
    }
  } else console.log("page-currency rows: database part skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL)");
  await test("N no request left this machine", () => assert.equal(outbound, 0));

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`page-currency rows: ${passed} passed, 0 failed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

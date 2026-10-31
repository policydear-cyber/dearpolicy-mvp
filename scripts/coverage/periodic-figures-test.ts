/** A figure paid per day, week or month is an income, not a sum: it always shows with its period, on every page, and is
 * never added into a total. Before, Home showed a Disability Income line "Monthly benefit £2,400" as "2,400", as if it
 * were a lump sum, and added two policies' figures of a non-lump-sum cover together (cross-page check, 31 Oct).
 *   1. The shared reader (lib/coverage/line-period.ts): the period a schedule line prints, in English, Malay/Indonesian,
 *      Spanish, Portuguese, German, French, Italian, Vietnamese and Chinese; a premium's period is never the cover's.
 *   2. The real dashboard and Coverage routes against a real, disposable PostgreSQL, for made-up households in £, A$, RM,
 *      Rp and S$, with and without the benefit table (runs only with DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL).
 * No real household, insurer or scheme; no model call; no paid call.
 *   npm run coverage:periodic-figures-test   (part 1)
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run coverage:periodic-figures-test   (parts 1 and 2) */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { lineFigure, printedLinePeriod } from "@/lib/coverage/line-period";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function readerTests() {
  for (const [text, want] of [
    ["Monthly benefit £2,400", "month"], ["Income benefit A$7,500 per month", "month"], ["Manfaat pendapatan RM3,000 sebulan", "month"],
    ["Santunan rawat inap harian Rp 500.000", "day"], ["Hospital cash S$100 per day", "day"], ["Hospital income S$150 / day", "day"],
    ["Indemnización diaria € 50", "day"], ["Renda mensal R$ 2.000", "month"], ["Monatliche Rente 1.500 €", "month"], ["Indemnité journalière 80 €", "day"],
    ["Diaria da ricovero € 100 al giorno", "day"], ["Trợ cấp nằm viện 500.000 ₫ mỗi ngày", "day"], ["住院日額 HK$500", "day"], ["Weekly benefit NZ$600", "week"],
    ["Overall limit S$1,000,000 per policy year", "year"], ["Annual limit RM1,500,000", "year"],
  ] as const) await test(`"${text}" prints ${want}`, () => assert.equal(printedLinePeriod(text), want));
  for (const text of ["Death benefit S$500,000", "Sum assured £250,000", "TPD 100% of sum assured", "Daydream Plan S$50,000", "Monthly premium S$120 for Death S$500,000", "Prémio mensal R$ 80", ""])
    await test(`"${text}" prints no cover period`, () => assert.equal(printedLinePeriod(text), null));
  // Strict first (coordinator, 31 Oct): a period counts only attached to the figure, never anywhere on the line.
  for (const [text, amount] of [
    ["Hospital cash S$100 (max 30 days per year)", 100], ["Disability income A$7,500, paid monthly after the waiting period", 7500],
    ["Death S$500,000 payable in instalments over 10 years", 500000], ["Income benefit S$3,000; waiting period 30 days per claim", 3000],
    ["Monthly review: Sum assured S$200,000 for 90 days", 200000], ["Hospital income benefit after 3 days S$150", 150],
    ["Santunan Rp 500.000 untuk rawat inap, maksimal 30 hari per tahun", 500000],
  ] as const) await test(`"${text}" has no period attached to its figure`, () => assert.equal(printedLinePeriod(text, amount), null));
  for (const [text, amount, want] of [
    ["S$150/day", 150, "day"], ["S$2,000 per month", 2000, "month"], ["Monthly benefit S$2,000", 2000, "month"], ["2,000 SGD a month", 2000, "month"],
    ["Waiting period 30 days; Monthly benefit A$7,500", 7500, "month"],
  ] as const) await test(`"${text}" has its figure's period`, () => assert.equal(printedLinePeriod(text, amount), want));
  await test("two periods on a line: the clause that prints the amount decides", () => {
    assert.equal(printedLinePeriod("Daily S$100, max S$3,000 per year", 100), "day");
    assert.equal(printedLinePeriod("Daily S$100, max S$3,000 per year", 3000), "year");
    assert.equal(printedLinePeriod("Daily S$100, max S$3,000 per year", 5), null);
    assert.equal(printedLinePeriod("Daily S$100, max S$3,000 per year"), null);
  });
  await test("a periodic cover's figure with no printed period is not shown", () => {
    assert.deepEqual(lineFigure("Disability Income", 3000, "Manfaat pendapatan RM3,000"), { amount: null, period: null });
    assert.deepEqual(lineFigure("Hospital Cash", 100, "Hospital cash S$100"), { amount: null, period: null });
  });
  await test("a periodic cover's figure with its period is shown with it", () => assert.deepEqual(lineFigure("Disability Income", 2400, "Monthly benefit £2,400"), { amount: 2400, period: "month" }));
  await test("a lump sum is unchanged", () => assert.deepEqual(lineFigure("Death", 500000, "Sum assured S$500,000"), { amount: 500000, period: null }));
}

type Part = { name: string; amount: number | null; currency: string | null; period?: string | null; noFigure?: boolean };
type Tile = { category: string; status: string; amount: number | null; displayAmount: string | null; currency: string | null; parts: Part[] | null };

async function routeTests() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    console.log("periodic figures: route part skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run it)");
    return;
  }
  const OLD = randomUUID(), TABLE = randomUUID();
  const USERS: Record<string, string> = { [OLD]: randomUUID(), [TABLE]: randomUUID() };
  Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: TABLE });
  const { query } = await import("@/lib/db/client");
  const { GET: dashboard } = await import("@/app/api/dashboard/route");
  const { GET: coverage } = await import("@/app/api/coverage/route");
  async function household(account: string, people: string[]) {
    await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, "Test household periodic"]);
    await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [account, USERS[account]]);
    const ids: string[] = [];
    for (const [i, n] of people.entries()) ids.push((await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [account, n, i ? "spouse" : "self"])).rows[0].id);
    return ids;
  }
  async function line(account: string, person: string, p: { product: string; number: string; category: string; sum: number | null; currency: string | null; text: string }) {
    const id = randomUUID();
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,policy_number,original_filename,storage_key,processing_status,quarantine_status,personal_coverage_confirmed,document_role,document_authority)
      VALUES($1,$2,$3,$4,$5,$6,$6,'ready','scan_clean',true,'personal_schedule',95)`, [id, account, person, p.product, p.number, `${id}.pdf`]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [id, person, account]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [account, id, p.text]);
    await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,confirmed,evidence_verified)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,true,true)`, [account, id, person, p.category, p.sum, p.currency, p.product, p.text]);
  }
  async function home(account: string, member: string) {
    process.env.DEV_ACCOUNT_ID = USERS[account];
    const res = await dashboard(new NextRequest(`http://localhost/api/dashboard?familyMemberId=${member}`));
    const body = await res.json() as { coverages: Tile[] };
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
  }
  async function detail(account: string, member: string, category: string) {
    process.env.DEV_ACCOUNT_ID = USERS[account];
    const res = await coverage(new NextRequest(`http://localhost/api/coverage?familyMemberId=${member}&category=${encodeURIComponent(category)}`));
    const body = await res.json() as { confirmed: { amount: string | null; period?: string | null; currency: string | null }[] };
    assert.equal(res.status, 200, JSON.stringify(body));
    return body.confirmed;
  }
  const tile = (b: { coverages: Tile[] }, category: string) => b.coverages.find((c) => c.category === category)!;
  try {
    for (const account of [OLD, TABLE]) {
      const which = account === OLD ? "without the table" : "with the table";
      const [tom, daniel, aiman, dewi, priya] = await household(account, ["Tom Bennett", "Daniel Nguyen", "Aiman Rahman", "Dewi Wijaya", "Priya Nair"]);
      await line(account, tom, { product: "Larkfield Income Protection", number: "LIP-1", category: "Disability Income", sum: 2400, currency: "GBP", text: "Monthly benefit £2,400" });
      await line(account, tom, { product: "Hawthorn Income Cover", number: "HIC-2", category: "Disability Income", sum: 1000, currency: "GBP", text: "Income benefit £1,000 per month" });
      await line(account, daniel, { product: "Banksia Income Protect", number: "BIP-1", category: "Disability Income", sum: 7500, currency: null, text: "Monthly benefit 7,500" });
      await line(account, aiman, { product: "Takaful Pendapatan", number: "TP-1", category: "Disability Income", sum: 3000, currency: "MYR", text: "Manfaat pendapatan RM3,000" });
      await line(account, dewi, { product: "Cendana Santunan Harian", number: "CSH-1", category: "Hospital Cash", sum: 500000, currency: "IDR", text: "Santunan rawat inap harian Rp 500.000" });
      await line(account, priya, { product: "Harbour Shield", number: "HS-1", category: "Hospitalisation", sum: 1000000, currency: "SGD", text: "Annual limit S$1,000,000" });
      await line(account, priya, { product: "Lighthouse MediPlan", number: "LM-2", category: "Hospitalisation", sum: 500000, currency: "SGD", text: "Annual limit S$500,000" });
      await line(account, priya, { product: "Harbour Life Plan", number: "HL-3", category: "Death", sum: 200000, currency: "SGD", text: "Sum assured S$200,000" });
      await line(account, priya, { product: "Lighthouse Term Plan", number: "LT-4", category: "Death", sum: 150000, currency: "SGD", text: "Sum assured S$150,000" });

      await test(`${which}: one monthly income shows with "a month", never as a bare amount`, async () => {
        const t = tile(await home(account, daniel), "Disability Income");
        assert.equal(t.status, "covered");
        assert.equal(t.amount, null);
        assert.match(t.displayAmount ?? "", /^7,500.* a month$/);
      });
      await test(`${which}: two monthly incomes are each shown with their period, never added`, async () => {
        const t = tile(await home(account, tom), "Disability Income");
        assert.equal(t.amount, null);
        assert.ok(!/3,400/.test(JSON.stringify(t)), JSON.stringify(t));
        assert.deepEqual((t.parts ?? []).map((p) => [p.amount, p.currency, p.period]).sort(), [[1000, "GBP", "month"], [2400, "GBP", "month"]]);
      });
      await test(`${which}: an income line with no printed period shows no figure`, async () => {
        const t = tile(await home(account, aiman), "Disability Income");
        assert.equal(t.status, "covered");
        assert.deepEqual([t.amount, t.displayAmount], [null, null]);
        assert.ok(!/3,?000/.test(JSON.stringify(t)), JSON.stringify(t));
      });
      await test(`${which}: a daily hospital cash shows with "a day"`, async () => {
        const t = tile(await home(account, dewi), "Hospital Cash");
        assert.equal(t.amount, null);
        assert.match(t.displayAmount ?? "", /500,000.* a day$/);
      });
      await test(`${which}: two hospital plans' limits are listed per policy, never added`, async () => {
        const t = tile(await home(account, priya), "Hospitalisation");
        assert.equal(t.amount, null);
        assert.deepEqual((t.parts ?? []).map((p) => [p.amount, p.period]).sort(), [[1000000, "year"], [500000, "year"]]);
      });
      await test(`${which}: lump sums still add up (control)`, async () => {
        const t = tile(await home(account, priya), "Death");
        assert.deepEqual([t.amount, t.currency], [350000, "SGD"]);
      });
      await test(`${which}: Coverage shows the income with its period, and no figure where none is printed`, async () => {
        const tomRows = await detail(account, tom, "Disability Income");
        assert.deepEqual(tomRows.map((r) => [Number(r.amount), r.period]).sort(), [[1000, "month"], [2400, "month"]]);
        const aimanRows = await detail(account, aiman, "Disability Income");
        assert.deepEqual(aimanRows.map((r) => r.amount), [null]);
      });
    }
  } finally {
    for (const a of [OLD, TABLE]) {
      await query("DELETE FROM household_members WHERE household_id=$1", [a]).catch(() => undefined);
      await query("DELETE FROM accounts WHERE id=$1", [a]).catch(() => undefined);
    }
  }
}

async function main() {
  for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
  const outbound: string[] = [];
  const localFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound.push(u.replace(/[?#].*/, "")); throw new Error("periodic figures test: outbound request refused"); }
    return localFetch(input, init);
  }) as typeof fetch;
  await readerTests();
  await routeTests();
  await test("no request tried to leave this machine (no model was asked)", () => assert.deepEqual(outbound, []));
  console.log(`periodic figures: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });

/** Home shows every amount in the currency its own document states, and never adds two currencies (new-user walkthrough,
 * 31 Oct: a Malaysian household's RM180 premium showed as "S$180.00/month", a schedule printing "120,000" under "All
 * amounts in pounds sterling" as "S$120,000"). Runs the real dashboard route (app/api/dashboard/route.ts) against a
 * real, disposable PostgreSQL, for made-up households in £, RM and S$, with and without the benefit table:
 *   - a premium or sum whose record states its currency shows in that currency, never S$;
 *   - one whose record states none stays unstated (never S$), and is left out of the premium total, which says so;
 *   - premiums in two currencies give one total per currency, never one added figure;
 *   - sums in two currencies on one tile are listed per policy, never added;
 *   - a Singapore household's S$ figures and totals are unchanged.
 * No real household, insurer or scheme; no model call; no paid call.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run coverage:home-currency-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("home currency: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}

const OLD = randomUUID(), TABLE = randomUUID();
const USERS: Record<string, string> = { [OLD]: randomUUID(), [TABLE]: randomUUID() };
// TABLE has the benefit table, OLD does not (the switch is per account): both paths read the same schedule lines.
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: TABLE });
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
const outbound: string[] = [];
const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound.push(u.replace(/[?#].*/, "")); throw new Error("home currency test: outbound request refused"); }
  return localFetch(input, init);
}) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

type Tile = { category: string; status: string; amount: number | null; currency: string | null; parts: { name: string; amount: number | null; currency: string | null }[] | null };
type Premiums = { monthly: number | null; annual: number | null; currency: string | null; totals: { currency: string; monthly: number; annual: number }[]; note: string | null; complete: boolean;
  items: { product_name: string; currency: string; currencyStated: boolean }[] };

async function main() {
  const { query } = await import("@/lib/db/client");
  const { GET } = await import("@/app/api/dashboard/route");

  async function household(account: string, people: string[]) {
    await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, "Test household currency"]);
    await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [account, USERS[account]]);
    const ids: string[] = [];
    for (const [i, n] of people.entries()) ids.push((await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [account, n, i ? "spouse" : "self"])).rows[0].id);
    return ids;
  }
  /** A personal schedule with one confirmed schedule line and, when given, one premium record. */
  async function schedule(account: string, person: string, p: { product: string; number: string; category: string; sum: number | null; currency: string | null; text: string;
    premium?: { amount: number; currency: string | null } }) {
    const id = randomUUID();
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,policy_number,original_filename,storage_key,processing_status,quarantine_status,personal_coverage_confirmed,document_role,document_authority)
      VALUES($1,$2,$3,$4,$5,$6,$6,'ready','scan_clean',true,'personal_schedule',95)`, [id, account, person, p.product, p.number, `${id}.pdf`]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [id, person, account]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [account, id, p.text]);
    await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,confirmed,evidence_verified)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,true,true)`, [account, id, person, p.category, p.sum, p.currency, p.product]);
    if (p.premium) await query(`INSERT INTO premium_records(account_id,policy_id,family_member_id,product_name,policy_number,amount,currency,frequency,source_document_id,source_page)
      VALUES($1,$2,$3,$4,$5,$6,$7,'monthly',$2,1)`, [account, id, person, p.product, p.number, p.premium.amount, p.premium.currency]);
  }
  async function home(account: string, member: string) {
    process.env.DEV_ACCOUNT_ID = USERS[account];
    const res = await GET(new NextRequest(`http://localhost/api/dashboard?familyMemberId=${member}`));
    const body = await res.json() as { coverages: Tile[]; premiums: Premiums; reminders: { detail: string }[] };
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
  }
  const tile = (b: { coverages: Tile[] }, category: string) => b.coverages.find((c) => c.category === category)!;

  try {
    for (const account of [OLD, TABLE]) {
      const which = account === OLD ? "without the table" : "with the table";
      const [gb, my, sg] = await household(account, ["Amara Okafor", "Nur Aisyah binti Ahmad", "Priya Nair"]);
      // £: a stated currency, and a schedule whose row prints no currency (stated once at the top of the page).
      await schedule(account, gb, { product: "Level Term Assurance", number: "NL-4410", category: "Death", sum: 250000, currency: "GBP",
        text: "Policy Schedule\nCurrency: GBP\nSum assured\t250,000.00", premium: { amount: 18.4, currency: "GBP" } });
      await schedule(account, gb, { product: "Critical Illness Cover", number: "TM-88213", category: "Critical Illness", sum: 120000, currency: null,
        text: "All amounts in pounds sterling\nAmount of cover\t120,000", premium: { amount: 41.1, currency: null } });
      // RM, and a second death cover in another currency for the same person.
      await schedule(account, my, { product: "Harmoni MediCare", number: "THB-30021", category: "Hospitalisation", sum: 1500000, currency: "MYR",
        text: "Overall annual limit\tRM1,500,000", premium: { amount: 180, currency: "MYR" } });
      await schedule(account, my, { product: "Lestari Term", number: "LL-1", category: "Death", sum: 300000, currency: "MYR", text: "Sum assured\tRM300,000", premium: { amount: 25, currency: "SGD" } });
      await schedule(account, my, { product: "Harbour Life Plan", number: "HL-2", category: "Death", sum: 100000, currency: "SGD", text: "Sum assured\tS$100,000" });
      // S$: unchanged.
      await schedule(account, sg, { product: "Harbour Life Plan", number: "HL-3", category: "Death", sum: 200000, currency: "SGD", text: "Sum assured\tS$200,000", premium: { amount: 50, currency: "SGD" } });
      await schedule(account, sg, { product: "Lighthouse Term Plan", number: "LT-4", category: "Death", sum: 150000, currency: "SGD", text: "Sum assured\tS$150,000", premium: { amount: 30, currency: "SGD" } });

      await test(`${which}: a £ sum and a £ premium stay in £`, async () => {
        const b = await home(account, gb);
        assert.deepEqual([tile(b, "Death").amount, tile(b, "Death").currency], [250000, "GBP"]);
        assert.deepEqual(b.premiums.totals.map((t) => [t.currency, Math.round(t.monthly * 100) / 100]), [["GBP", 18.4]]);
        assert.equal(b.premiums.currency, "GBP");
      });
      await test(`${which}: a sum whose row states no currency is never S$`, async () => {
        const t = tile(await home(account, gb), "Critical Illness");
        assert.equal(t.status, "covered");
        assert.notEqual(t.currency, "SGD");
        assert.equal(t.currency, null);
      });
      await test(`${which}: a premium with no stated currency is left out of the total, and the note says so`, async () => {
        const p = (await home(account, gb)).premiums;
        assert.ok(!p.totals.some((t) => Math.abs(t.monthly - 41.1) < 0.01 || Math.abs(t.monthly - 59.5) < 0.01), JSON.stringify(p.totals));
        assert.match(p.note ?? "", /Critical Illness Cover: its record does not say which currency/);
        assert.equal(p.complete, false);
      });
      await test(`${which}: RM premiums and S$ premiums give one total each, never one added figure`, async () => {
        const p = (await home(account, my)).premiums;
        assert.deepEqual(p.totals.map((t) => [t.currency, t.monthly]).sort(), [["MYR", 180], ["SGD", 25]]);
        assert.equal(p.monthly, null);
        assert.equal(p.currency, null);
      });
      await test(`${which}: RM and S$ sums on one tile are listed per policy, never added`, async () => {
        const t = tile(await home(account, my), "Death");
        assert.equal(t.status, "covered");
        assert.equal(t.amount, null);
        assert.deepEqual((t.parts ?? []).map((p) => [p.amount, p.currency]).sort(), [[100000, "SGD"], [300000, "MYR"]]);
        assert.deepEqual([tile(await home(account, my), "Hospitalisation").amount, tile(await home(account, my), "Hospitalisation").currency], [1500000, "MYR"]);
      });
      await test(`${which}: a Singapore household's S$ sums and premiums still add up`, async () => {
        const b = await home(account, sg);
        assert.deepEqual([tile(b, "Death").amount, tile(b, "Death").currency], [350000, "SGD"]);
        assert.deepEqual(b.premiums.totals.map((t) => [t.currency, t.monthly]), [["SGD", 80]]);
        assert.equal(b.premiums.monthly, 80);
      });
    }
  } finally {
    for (const a of [OLD, TABLE]) {
      await query("DELETE FROM household_members WHERE household_id=$1", [a]).catch(() => undefined);
      await query("DELETE FROM accounts WHERE id=$1", [a]).catch(() => undefined);
    }
  }

  await test("a tile's sum of fixed amounts never adds sums whose currency is unstated", async () => {
    const { lumpSumParts } = await import("@/lib/coverage/table-figures");
    const line = (name: string, amount: number | null, currency: string | null) => ({ name, amount, currency, documentIds: [] as string[] });
    // Two unstated sums beside a policy with no fixed sum: they may be in two currencies, so no total and no known sum.
    const unstated = lumpSumParts([], [line("Alder Term Plan", 100000, null), line("Birch Life Plan", 200000, null), line("Cedar Endowment", null, null)], [], "Death");
    assert.deepEqual([unstated.total, unstated.known], [null, null]);
    // A stated sum beside an unstated one: the unstated one is neither added nor left out unnamed.
    const mixed = lumpSumParts([], [line("Alder Term Plan", 100000, "GBP"), line("Birch Life Plan", 200000, null), line("Cedar Endowment", null, null)], [], "Death");
    assert.deepEqual([mixed.total, mixed.known], [null, null]);
    // Negative control: stated sums in one currency beside a policy with no fixed sum still give the known sum.
    const known = lumpSumParts([], [line("Alder Term Plan", 100000, "GBP"), line("Birch Life Plan", 200000, "GBP"), line("Cedar Endowment", null, null)], [], "Death");
    assert.deepEqual([known.total, known.known?.amount, known.known?.currency], [null, 300000, "GBP"]);
  });

  await test("no request tried to leave this machine (no model was asked)", async () => {
    assert.deepEqual(outbound, []);
  });
  console.log(`home currency: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });

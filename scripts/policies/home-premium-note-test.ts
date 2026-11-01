/** Home's cost card says what its total leaves out, in the same words Payments uses: a policy on file with no premium
 * printed is named under the total, so Home's figure never looks complete when Payments says it is not. Real routes
 * (GET /api/dashboard and GET /api/premiums/summary), made-up household in Australian dollars, disposable PostgreSQL,
 * no model call.
 *
 * Refuses to run unless DEARPOLICY_DISPOSABLE_DB=1 and DATABASE_URL points at localhost; deletes only what it creates.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run policies:home-premium-note-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("home premium note: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
const ACCOUNT = randomUUID(), USER = randomUUID();
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: USER });
delete process.env.DEARPOLICY_BENEFIT_TABLE;
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
const outbound: string[] = [];
const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound.push(u.replace(/[?#].*/, "")); throw new Error("outbound request refused"); }
  return localFetch(input, init);
}) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

async function main() {
  const { query } = await import("@/lib/db/client");
  const { GET: dashboard } = await import("@/app/api/dashboard/route");
  const { GET: summary } = await import("@/app/api/premiums/summary/route");

  await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household AUD"]);
  await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [ACCOUNT, USER]);
  const person = "Mere Tūhoe-Whitfield";
  const member = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,'self') RETURNING id", [ACCOUNT, person])).rows[0].id;
  async function doc(name: string, number: string) {
    const id = randomUUID();
    await query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role)
      VALUES($1,$2,$3,'Wattle Mutual',$4,$5,$6,$7,'ready','ready','scan_clean',true,'personal_schedule')`, [id, ACCOUNT, member, name, number, `${name}.pdf`, `test/${id}`]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT, id, `POLICY SCHEDULE\nLife insured\t${person}\nPolicy number\t${number}\nSum insured\tA$250,000`]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'user_declared')", [id, member, ACCOUNT]);
    return id;
  }
  try {
    const paid = await doc("Coastal Income Cover", "WM-71001");
    await doc("Bushfire Trauma Plan", "WM-71002");
    await query("INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,product_name,policy_number,amount,currency,frequency) VALUES($1,$2,$3,'Wattle Mutual','Coastal Income Cover','WM-71001',64.5,'AUD','monthly')", [ACCOUNT, paid, member]);
    const home = await (await dashboard(new NextRequest(`http://localhost/api/dashboard?familyMemberId=${member}&poll=1`))).json() as { premiums: { note?: string | null; totals?: unknown[] } };
    const pay = await (await summary(new NextRequest("http://localhost/api/premiums/summary"))).json() as { people: { id: string; premiums: { note: string | null } }[] };
    const payNote = pay.people.find((p) => p.id === member)?.premiums.note ?? null;
    await test("the total for this person leaves out the policy with no premium, and says so", () => {
      assert.ok(home.premiums.totals?.length, "Home has a total");
      assert.match(home.premiums.note ?? "", /leaves out Bushfire Trauma Plan/);
    });
    await test("Home's note is Payments' note, word for word", () => assert.equal(home.premiums.note, payNote));
    await test("Home's cost card shows that note under the total", () => {
      const page = readFileSync("app/page.tsx", "utf8");
      const card = page.slice(page.indexOf("Current insurance cost"), page.indexOf("Payments & receipts"));
      assert.match(card, /data\.premiums\.note&&<div className="summary-sub" data-testid="home-premium-note">\{data\.premiums\.note\}/);
    });
    await test("no request left this machine", () => assert.deepEqual(outbound, []));
  } finally {
    await query("DELETE FROM premium_records WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM policy_members WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM policy_pages WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM policies WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM family_members WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM household_members WHERE household_id=$1", [ACCOUNT]);
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]);
  }
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
  console.log(`home premium note: ${passed} passed, fetches 0`);
  process.exit(0);
}
void main();

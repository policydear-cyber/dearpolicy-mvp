/** The Benefits page never shows a plan table's first column as the person's limit (FWD re-read 5 Nov: "Overall limit^
 * S$300 S$800 S$1,500" shown as "Limit of SGD 300 a policy year" for a Business plan holder). Runs the real Benefits route
 * on a disposable PostgreSQL with a made-up travel schedule whose limits print one figure per plan; no model, no network.
 *   npm run -s benefits:plan-limit-route-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("plan limit route: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)"); process.exit(0);
}
const ACCOUNT = randomUUID(), USER = randomUUID();
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: USER });
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
let outbound = 0; const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound++; throw new Error("no network"); }
  return localFetch(input, init);
}) as typeof fetch;

async function main() {
  const { query } = await import("@/lib/db/client");
  const { GET } = await import("@/app/api/benefits/route");
  let passed = 0; const failures: string[] = [];
  const test = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } };
  await query("INSERT INTO accounts(id,name) VALUES($1,'Plan limit test household')", [ACCOUNT]);
  await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [ACCOUNT, USER]);
  const member = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,'Arun Pillai','self') RETURNING id", [ACCOUNT])).rows[0].id;
  const policy = randomUUID();
  const page = "TABLE OF BENEFITS\nMaximum benefit limits payable per insured person per trip\nBenefits\tPremier\tBusiness\tFirst\nOverall limit^\tS$300\tS$800\tS$1,500\nOverall limit for family plan*\tS$18,750\tS$25,000\tS$37,500\nPolicy year limit\tS$150,000\nOverall limit for each trip\tS$5,000\tS$5,000\tS$5,000";
  try {
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role,insurer)
      VALUES($1,$2,$3,'Kestrel Travel Shield','kestrel-travel.pdf',$4,'ready','ready','scan_clean',false,'endorsement','Kestrel General')`, [policy, ACCOUNT, member, `test/${policy}`]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,5,$3)", [ACCOUNT, policy, page]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'user_declared')", [policy, member, ACCOUNT]);
    for (const [name, value, quote] of [["Overall limit^", 300, "Overall limit^ S$300 S$800 S$1,500"], ["Overall limit for family plan*", 18_750, "Overall limit for family plan* S$18,750 S$25,000 S$37,500"],
      ["Policy year limit", 150_000, "Policy year limit S$150,000"], ["Overall limit for each trip", 5_000, "Overall limit for each trip S$5,000 S$5,000 S$5,000"]] as const)
      await query(`INSERT INTO policy_benefits(id,account_id,policy_id,product_name,benefit_name,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review,row_kind)
        VALUES(gen_random_uuid(),$1,$2,'Kestrel Travel Shield',$3,'none',$4,'SGD',5,$5,'[]'::jsonb,'[]'::jsonb,false,'policy_year_limit')`, [ACCOUNT, policy, name, value, quote]);
    const res = await GET(new NextRequest(`http://localhost/api/benefits?familyMemberId=${member}`));
    const body = await res.json() as { benefits: { benefitName: string; pays: string; planColumns: boolean; planFigure: unknown; formulaValue: number | null }[] };
    const byName = (n: string) => body.benefits.find((b) => b.benefitName.startsWith(n))!;
    await test("P1 the route answers", async () => { assert.equal(res.status, 200, JSON.stringify(body)); });
    await test("P2 a limit printed per plan shows no figure and says it differs by plan, never the first column", async () => {
      for (const n of ["Overall limit^", "Overall limit for family plan*"]) {
        const b = byName(n); assert.ok(b, n); assert.equal(b.planColumns, true, JSON.stringify(b)); assert.equal(b.planFigure, null, n); assert.equal(b.formulaValue, null, n);
        assert.doesNotMatch(b.pays, /300|18,750|a policy year/, b.pays);
      }
    });
    await test("P3 a limit with one figure keeps it, with the period its own words print", async () => {
      assert.equal(byName("Policy year limit").pays, "Limit of SGD 150,000 a policy year");
      assert.equal(byName("Overall limit for each trip").pays, "Limit of SGD 5,000 a trip");
    });
  } finally {
    for (const t of ["policy_benefits", "policy_members", "policy_pages", "policies", "family_members", "household_members"])
      await query(`DELETE FROM ${t} WHERE ${t === "household_members" ? "household_id" : "account_id"}=$1`, [ACCOUNT]).catch(() => undefined);
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]).catch(() => undefined);
  }
  await test("N no request left this machine", async () => assert.equal(outbound, 0));
  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`plan limit route: ${passed} passed, 0 failed`); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

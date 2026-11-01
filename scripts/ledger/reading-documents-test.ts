/** With the benefit table on, no document is listed as "waiting for its Coverage read" by the old ledger reader
 * (lib/ledger/extract.ts ledgerReadDocuments, served by GET /api/ledger as reading.documents): that reader never runs
 * for a table household, so Documents said "Reading its benefits for Coverage…" under every new document forever.
 * Off, the ledger list is unchanged. Documents then takes "still being read" from the table's own document state.
 * Made-up household in pounds sterling, real routes, disposable PostgreSQL, no model call.
 *
 * Refuses to run unless DEARPOLICY_DISPOSABLE_DB=1 and DATABASE_URL points at localhost; deletes only what it creates.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run ledger:reading-documents-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("ledger reading documents: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
const ACCOUNT = randomUUID(), USER = randomUUID();
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: USER });
delete process.env.DEARPOLICY_BENEFIT_TABLE; delete process.env.DEARPOLICY_ALPHA_ACCOUNTS;
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
const outbound: string[] = [];
const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound.push(u.replace(/[?#].*/, "")); throw new Error("outbound request refused"); }
  return localFetch(input, init);
}) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

async function main() {
  const { query } = await import("@/lib/db/client");
  const { ledgerReadDocuments } = await import("@/lib/ledger/extract");
  const { GET: ledgerRoute } = await import("@/app/api/ledger/route");
  const { tableReady } = await import("@/lib/benefit-table/service");
  const { appDb } = await import("@/lib/benefit-table/app");

  await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household GBP"]);
  await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [ACCOUNT, USER]);
  const person = "Eilidh MacLeod-Ashworth";
  const member = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,'self') RETURNING id", [ACCOUNT, person])).rows[0].id;
  const doc = randomUUID();
  await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role)
    VALUES($1,$2,$3,'Thistle Income Protect','thistle.pdf',$4,'ready','ready','scan_clean',true,'personal_schedule')`, [doc, ACCOUNT, member, `test/${doc}`]);
  await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT, doc, `POLICY SCHEDULE\nInsured\t${person}\nMonthly benefit\t£2,400`]);
  await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'user_declared')", [doc, member, ACCOUNT]);
  const routeDocs = async () => {
    const r = await ledgerRoute(new NextRequest("http://localhost/api/ledger"));
    assert.equal(r.status, 200);
    return ((await r.json()) as { reading?: { documents?: { policyId: string }[] } }).reading?.documents ?? [];
  };

  try {
    await test("table off: a document not yet read for Coverage is listed as waiting, as before", async () => {
      const docs = await ledgerReadDocuments(ACCOUNT);
      assert.deepEqual(docs.map((d) => [d.policyId, d.state]), [[doc, "waiting"]]);
      assert.deepEqual((await routeDocs()).map((d) => d.policyId), [doc], "GET /api/ledger");
    });
    Object.assign(process.env, { DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: ACCOUNT });
    const ready = await tableReady(appDb).catch(() => false);
    assert.ok(ready, "the benefit table schema must be applied to this database (sql/benefit-table.sql)");
    await test("table on: the ledger reader never runs, so it lists nothing as still being read", async () => {
      assert.deepEqual(await ledgerReadDocuments(ACCOUNT), []);
      assert.deepEqual(await routeDocs(), [], "GET /api/ledger");
    });
    await test("another household not on the table keeps its list", async () => {
      process.env.DEARPOLICY_ALPHA_ACCOUNTS = randomUUID();
      assert.equal((await ledgerReadDocuments(ACCOUNT)).length, 1);
      process.env.DEARPOLICY_ALPHA_ACCOUNTS = ACCOUNT;
    });
    await test("Documents takes 'still being read' from the table's own state when the table is on", async () => {
      const page = readFileSync("app/policies/page.tsx", "utf8");
      assert.match(page, /if \(t\?\.enabled\) \{\s*setBenefitReading\(Object\.fromEntries\(\(t\.documents \?\? \[\]\)\.filter\(\(d\) => d\.state === "waiting"\)/);
    });
    await test("no request left this machine", async () => assert.deepEqual(outbound, []));
  } finally {
    await query("DELETE FROM policy_members WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM policy_pages WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM policies WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM family_members WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM household_members WHERE household_id=$1", [ACCOUNT]);
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]);
  }
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
  console.log(`ledger reading documents: ${passed} passed, fetches 0`);
  process.exit(0);
}
void main();

/** A cover's page (/api/coverage) on a policy two household members share: each person's figure from it says who else it
 * covers and this person's own sum, through the real route, with readings stored by the real readDocument and linked by
 * relink, against a real, disposable PostgreSQL. Made-up household in ringgit; scripted model; no network.
 * Refuses to run unless DEARPOLICY_DISPOSABLE_DB=1 and DATABASE_URL points at localhost; deletes only what it creates.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run policies:shared-policy-route-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("shared policy route: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
const ACCOUNT = randomUUID(), USER = randomUUID();
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: USER, DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: ACCOUNT });
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
  const { readDocument, relink } = await import("@/lib/benefit-table/service");
  const { appDb } = await import("@/lib/benefit-table/app");
  const { coverKeyOf, sectionKeyOf } = await import("@/lib/benefit-table/assemble");
  const { GET } = await import("@/app/api/coverage/route");
  type TableModel = import("@/lib/benefit-table/model").TableModel;
  const links = new Map<string, { section: string; cover: string | null; why: string }>();
  const model = (answer: unknown): TableModel => ({ choice: { provider: "anthropic", model: "test-model" }, async call(c) {
    const json = c.schema && "links" in ((c.schema as { properties?: object }).properties ?? {}) ? { links: [...links.values()] } : answer;
    return { json, stopReason: "end_turn", model: "test-model", input: 1, output: 1, ms: 1 };
  } });
  await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household MYR"]);
  await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [ACCOUNT, USER]);
  const P: Record<string, string> = {};
  for (const [name, rel] of [["Siti Aminah", "self"], ["Faiz Rahman", "spouse"], ["Nur Faiz", "child"]])
    P[name] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [ACCOUNT, name, rel])).rows[0].id;
  async function doc(product: string, covers: [string, number, string?][], line: [string, number]) {
    const id = randomUUID();
    const text = `SIJIL KUMPULAN\n` + covers.map(([p, s, c]) => `Life Assured\t${p}\n${c ?? product}\tSum Assured RM${s.toLocaleString("en-US")}`).join("\n") + `\n${line[0]}\tRM${line[1].toLocaleString("en-US")}`;
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role)
      VALUES($1,$2,$3,$4,$5,$6,'ready','ready','scan_clean',true,'certificate')`, [id, ACCOUNT, P[covers[0][0]], product, `${product}.pdf`, `test/${id}`]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT, id, text]);
    for (const p of new Set(covers.map(([q]) => q))) await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [id, P[p], ACCOUNT]);
    const reading = { document: { kind: "personal_proof", product, insurer: null, namedPeople: covers.map(([p]) => p), plan: null, periodFrom: null, periodTo: null },
      covers: covers.map(([p, s, c]) => ({ person: p, product, cover: c ?? product, plan: null, riderOf: null, policyNumber: null, sumInsured: s, premium: null, premiumFrequency: null, asOf: null,
        startDate: null, endDate: null, page: 1, quote: `${c ?? product}\tSum Assured RM${s.toLocaleString("en-US")}` })),
      benefits: [{ section: null, column: null, benefit: line[0], pays: "amount", value: line[1], period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
        cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: `${line[0]}\tRM${line[1].toLocaleString("en-US")}` }] };
    assert.ok((await readDocument(appDb, model(reading), ACCOUNT, id)).read);
    const section = sectionKeyOf(id, { section: null, column: null });
    links.set(section, { section, cover: coverKeyOf({ product, cover: product, plan: null }), why: "the certificate" });
    await relink(appDb, model(null), ACCOUNT);
  }
  const page = async (person: string) => {
    const r = await GET(new NextRequest(`http://localhost/api/coverage?familyMemberId=${P[person]}&category=Death`));
    assert.equal(r.status, 200);
    return ((await r.json()) as { table: { product: string; figure: string; shared: { others: string[]; ownSum: string | null } | null }[] }).table;
  };
  try {
    await doc("Wawasan Group Life", [["Siti Aminah", 300000], ["Faiz Rahman", 120000]], ["Death benefit", 300000]);
    await doc("Faiz Term Life", [["Faiz Rahman", 500000]], ["Death benefit", 500000]);
    const faiz = await page("Faiz Rahman"), siti = await page("Siti Aminah");
    await test("the shared certificate's figure on Faiz's page names Siti and Faiz's own sum", async () => {
      const row = faiz.find((r) => r.product === "Wawasan Group Life");
      assert.deepEqual(row?.shared, { others: ["Siti Aminah"], ownSum: "MYR 120,000" }, JSON.stringify(row));
    });
    await test("Siti's page names Faiz, with her own sum", async () => {
      assert.deepEqual(siti.find((r) => r.product === "Wawasan Group Life")?.shared, { others: ["Faiz Rahman"], ownSum: "MYR 300,000" });
    });
    await test("a policy only one person holds has no note", async () => {
      assert.equal(faiz.find((r) => r.product === "Faiz Term Life")?.shared, null);
    });
    await test("a person with a base plan and a rider on one shared certificate gets no one sum", async () => {
      await doc("Seri Family Plan", [["Nur Faiz", 80000], ["Nur Faiz", 30000, "Seri Child Rider"], ["Siti Aminah", 90000]], ["Death benefit", 90000]);
      const r = await GET(new NextRequest(`http://localhost/api/coverage?familyMemberId=${P["Nur Faiz"]}&category=Death`));
      const row = ((await r.json()) as { table: { product: string; shared: { others: string[]; ownSum: string | null } | null }[] }).table.find((x) => x.product === "Seri Family Plan");
      assert.deepEqual(row?.shared, { others: ["Siti Aminah"], ownSum: null }, JSON.stringify(row));
    });
    await test("a person the certificate does not cover never gets its rows", async () => {
      const r = await GET(new NextRequest(`http://localhost/api/coverage?familyMemberId=${P["Faiz Rahman"]}&category=Death`));
      assert.ok(!((await r.json()) as { table: { product: string }[] }).table.some((x) => x.product === "Seri Family Plan"));
    });
    await test("no request left this machine", async () => assert.deepEqual(outbound, []));
  } finally {
    for (const t of ["benefit_links", "benefit_readings", "policy_members", "policy_pages", "policies", "family_members"]) await query(`DELETE FROM ${t} WHERE account_id=$1`, [ACCOUNT]).catch(() => undefined);
    await query("DELETE FROM household_members WHERE household_id=$1", [ACCOUNT]);
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]);
  }
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
  console.log(`shared policy route: ${passed} passed, fetches 0`);
  process.exit(0);
}
void main();

/** A policy pack filed as a letter is called a policy document on Documents, through the real routes
 * (app/api/policies/route.ts and app/api/policies/[id]/route.ts), with readings stored by the real readDocument (its
 * `{document: <Reading>, pages}` shape), against a real, disposable PostgreSQL. Content first: only a letter whose own
 * reading says personal proof AND printed a cover with its sum is renamed; a claim decision, a letter read as a letter,
 * and a letter whose reading found no cover keep "Correspondence". Made-up household in Ghana cedis; no model call.
 *
 * Refuses to run unless DEARPOLICY_DISPOSABLE_DB=1 and DATABASE_URL points at localhost; deletes only what it creates.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run policies:pack-label-route-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("pack label route: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
const ACCOUNT = randomUUID(), USER = randomUUID();
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: USER });
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
  const { readDocument } = await import("@/lib/benefit-table/service");
  const { appDb } = await import("@/lib/benefit-table/app");
  const { GET: list } = await import("@/app/api/policies/route");
  const { GET: detail } = await import("@/app/api/policies/[id]/route");
  type TableModel = import("@/lib/benefit-table/model").TableModel;
  const model = (answer: unknown): TableModel => ({ choice: { provider: "anthropic", model: "test-model" }, async call() {
    return { json: answer, stopReason: "end_turn", model: "test-model", input: 1, output: 1, ms: 1 }; } });

  await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household GHS"]);
  await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [ACCOUNT, USER]);
  const person = "Ama Owusu-Mensah";
  const member = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,'self') RETURNING id", [ACCOUNT, person])).rows[0].id;

  /** A document as intake leaves it under `role`, with its reading stored by readDocument. */
  async function doc(name: string, role: string, kind: string, covers: boolean) {
    const id = randomUUID();
    const text = `Dear ${person},\nThank you for choosing us.\n\nPOLICY SCHEDULE\nLife Assured\t${person}\nFamily Shield Plan\tSum Assured GH₵ 80,000`;
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role,document_authority_label)
      VALUES($1,$2,$3,$4,$5,$6,'ready','ready','scan_clean',false,$7,'Correspondence')`, [id, ACCOUNT, member, name, `${name}.pdf`, `test/${id}`, role]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT, id, text]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'user_declared')", [id, member, ACCOUNT]);
    const reading = { document: { kind, product: "Family Shield Plan", insurer: null, namedPeople: [person], plan: null, periodFrom: null, periodTo: null },
      covers: covers ? [{ person, product: "Family Shield Plan", cover: "Family Shield Plan", plan: null, riderOf: null, policyNumber: null, sumInsured: 80000, premium: null,
        premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: "Family Shield Plan\tSum Assured GH₵ 80,000" }] : [], benefits: [] };
    const read = await readDocument(appDb, model(reading), ACCOUNT, id);
    assert.ok(read.read, `reading of ${name} not stored: ${JSON.stringify(read)}`);
    return id;
  }

  try {
    const pack = await doc("Pack", "insurer_letter", "personal_proof", true);
    const decision = await doc("Decision", "claim_decision", "personal_proof", true);
    const empty = await doc("Empty", "insurer_letter", "personal_proof", false);
    const letter = await doc("Letter", "insurer_letter", "letter", true);
    const res = await list(new NextRequest("http://localhost/api/policies"));
    assert.equal(res.status, 200);
    const rows = new Map(((await res.json()) as { policies: { id: string; reading_policy: boolean }[] }).policies.map((p) => [p.id, p]));
    const one = async (id: string) => {
      const r = await detail(new NextRequest(`http://localhost/api/policies/${id}`), { params: Promise.resolve({ id }) });
      assert.equal(r.status, 200); return ((await r.json()) as { document: { authorityLabel: string | null } }).document.authorityLabel;
    };
    await test("a letter-filed pack whose reading found the insured person and a sum is a policy document", async () => {
      assert.equal(rows.get(pack)?.reading_policy, true, "list route");
      assert.equal(await one(pack), "Policy document", "detail route");
    });
    await test("a claim decision is never renamed, whatever its reading says", async () => {
      assert.equal(rows.get(decision)?.reading_policy, true, "its reading qualifies");
      assert.equal(await one(decision), "Correspondence", "but the role is not a pack's cover letter");
    });
    await test("a letter whose reading found no cover keeps its label", async () => {
      assert.equal(rows.get(empty)?.reading_policy, false);
      assert.equal(await one(empty), "Correspondence");
    });
    await test("a letter read as a letter keeps its label", async () => {
      assert.equal(rows.get(letter)?.reading_policy, false);
      assert.equal(await one(letter), "Correspondence");
    });
    await test("no request left this machine", async () => assert.deepEqual(outbound, []));
  } finally {
    await query("DELETE FROM benefit_readings WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM policy_members WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM policy_pages WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM policies WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM family_members WHERE account_id=$1", [ACCOUNT]);
    await query("DELETE FROM household_members WHERE household_id=$1", [ACCOUNT]);
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]);
  }
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
  console.log(`pack label route: ${passed} passed, fetches 0`);
  process.exit(0);
}
void main();

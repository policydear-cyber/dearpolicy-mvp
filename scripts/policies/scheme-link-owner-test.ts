/** One member's own schedule is never matched to another member as reference material because they hold the same plan
 * (TE main journeys 11 Nov, defect 2: a schedule printing "Life assured: Daniel Tern" whose reading was not confirmed was
 * linked to Grace as scheme_reference_match, and Daniel's figures showed on Grace's Benefits page). Through the real
 * linkRelatedReferenceDocuments against a real, disposable PostgreSQL. Made-up household; no model; no network.
 * Refuses to run unless DEARPOLICY_DISPOSABLE_DB=1 and DATABASE_URL points at localhost; deletes only what it creates.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run policies:scheme-link-owner-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("scheme link owner: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("outbound request refused"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } }

async function main() {
  const { query } = await import("@/lib/db/client");
  const { linkRelatedReferenceDocuments } = await import("@/lib/policies/linking");
  const accounts: string[] = [];
  /** A fresh made-up household: Grace and Daniel Tern, both holding Heron Care Plus. */
  async function household() {
    const account = randomUUID(); accounts.push(account);
    await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, "Test household scheme links"]);
    const P: Record<string, string> = {};
    for (const [name, rel] of [["Grace Tern", "self"], ["Daniel Tern", "spouse"]])
      P[name] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [account, name, rel])).rows[0].id;
    const doc = async (o: { role: string; confirmed: boolean; text: string; product?: string; member?: string; source?: string; group?: string | null }) => {
      const id = randomUUID();
      await query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,group_policy_number,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role,extracted_json)
        VALUES($1,$2,$3,'Heron Assurance',$4,$5,$6,$7,'ready','ready','scan_clean',$8,$9,'{}'::jsonb)`, [id, account, P[o.member ?? "Grace Tern"], o.product ?? "Heron Care Plus", o.group ?? null, `${id}.pdf`, `test/${id}`, o.confirmed, o.role]);
      await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [account, id, o.text]);
      if (o.member) await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,$4,1)", [id, P[o.member], account, o.source ?? "ai_name_match"]);
      return id;
    };
    const linked = async (id: string) => (await query<{ display_name: string; source: string }>(
      "SELECT fm.display_name,pm.source FROM policy_members pm JOIN family_members fm ON fm.id=pm.family_member_id WHERE pm.policy_id=$1 ORDER BY 1", [id])).rows.map((r) => `${r.display_name}:${r.source}`);
    return { account, P, doc, linked };
  }
  const schedule = (who: string, extra = "") => `HERON ASSURANCE - POLICY SCHEDULE\nPolicy number: HA-${Math.floor(Math.random() * 90000) + 10000}\nLife assured: ${who}\nPlan: Heron Care Plus${extra}\nCritical Illness Benefit S$100,000`;
  const WORDING = "HERON CARE PLUS - POLICY WORDING\nThe Life Assured named in the Schedule is covered for the benefits below.\nCritical Illness Benefit: 100% of the Sum Assured.";
  try {
    await test("S1 Daniel's unconfirmed schedule is not matched to Grace when Grace's schedule is read", async () => {
      const h = await household();
      const dan = await h.doc({ role: "personal_schedule", confirmed: false, text: schedule("Daniel Tern"), member: "Daniel Tern", source: "user_declared" });
      const grace = await h.doc({ role: "personal_schedule", confirmed: true, text: schedule("Grace Tern"), member: "Grace Tern" });
      await linkRelatedReferenceDocuments(h.account, grace);
      assert.deepEqual(await h.linked(dan), ["Daniel Tern:user_declared"]);
    });
    await test("S2 ... nor when Daniel's schedule is read after Grace's", async () => {
      const h = await household();
      await h.doc({ role: "personal_schedule", confirmed: true, text: schedule("Grace Tern"), member: "Grace Tern" });
      const dan = await h.doc({ role: "personal_schedule", confirmed: false, text: schedule("Daniel Tern") });
      await linkRelatedReferenceDocuments(h.account, dan);
      assert.deepEqual(await h.linked(dan), []);
    });
    await test("S3 a schedule printing a life outside the household is not matched to a member", async () => {
      const h = await household();
      const other = await h.doc({ role: "personal_schedule", confirmed: false, text: schedule("Peter Vance") });
      const grace = await h.doc({ role: "personal_schedule", confirmed: true, text: schedule("Grace Tern"), member: "Grace Tern" });
      await linkRelatedReferenceDocuments(h.account, grace);
      assert.deepEqual(await h.linked(other), []);
    });
    await test("S4 a schedule where Grace is only the policyholder and Daniel the life assured is not Grace's", async () => {
      const h = await household();
      const dan = await h.doc({ role: "personal_schedule", confirmed: false, text: `HERON ASSURANCE - POLICY SCHEDULE\nPolicyholder: Grace Tern\nLife assured: Daniel Tern\nPlan: Heron Care Plus\nCritical Illness Benefit S$120,000` });
      const grace = await h.doc({ role: "personal_schedule", confirmed: true, text: schedule("Grace Tern"), member: "Grace Tern" });
      await linkRelatedReferenceDocuments(h.account, grace);
      assert.deepEqual(await h.linked(dan), []);
    });
    await test("S5 a wording naming another member's name and not Grace's is not matched to Grace", async () => {
      const h = await household();
      const letter = await h.doc({ role: "policy_wording", confirmed: false, text: "Dear Daniel Tern,\n" + WORDING });
      const grace = await h.doc({ role: "personal_schedule", confirmed: true, text: schedule("Grace Tern"), member: "Grace Tern" });
      await linkRelatedReferenceDocuments(h.account, grace);
      assert.deepEqual(await h.linked(letter), []);
    });
    // Negative controls: reference material and unnamed personal documents still match.
    await test("C1 control: the plan's wording, naming nobody, is matched to both members' schedules", async () => {
      const h = await household();
      const wording = await h.doc({ role: "policy_wording", confirmed: false, text: WORDING });
      await linkRelatedReferenceDocuments(h.account, await h.doc({ role: "personal_schedule", confirmed: true, text: schedule("Grace Tern"), member: "Grace Tern" }));
      await linkRelatedReferenceDocuments(h.account, await h.doc({ role: "personal_schedule", confirmed: true, text: schedule("Daniel Tern"), member: "Daniel Tern" }));
      assert.deepEqual(await h.linked(wording), ["Daniel Tern:scheme_reference_match", "Grace Tern:scheme_reference_match"]);
    });
    await test("C2 control: a wording read after the schedules is matched to both", async () => {
      const h = await household();
      await h.doc({ role: "personal_schedule", confirmed: true, text: schedule("Grace Tern"), member: "Grace Tern" });
      await h.doc({ role: "personal_schedule", confirmed: true, text: schedule("Daniel Tern"), member: "Daniel Tern" });
      const wording = await h.doc({ role: "policy_wording", confirmed: false, text: WORDING });
      await linkRelatedReferenceDocuments(h.account, wording);
      assert.deepEqual(await h.linked(wording), ["Daniel Tern:scheme_reference_match", "Grace Tern:scheme_reference_match"]);
    });
    await test("C3 control: a group certificate summary with an empty insured line is matched by group number", async () => {
      const h = await household();
      const summary = await h.doc({ role: "certificate", confirmed: false, group: "GRP-4410", text: "GROUP CERTIFICATE - PART 2 BENEFIT SUMMARY\nInsured:\nHospital Cash S$100 per day" });
      const grace = await h.doc({ role: "certificate", confirmed: true, group: "GRP-4410", text: "GROUP CERTIFICATE\nInsured: Grace Tern\nHospital Cash S$100 per day", member: "Grace Tern" });
      await linkRelatedReferenceDocuments(h.account, grace);
      assert.deepEqual(await h.linked(summary), ["Grace Tern:scheme_reference_match"]);
    });
    await test("C4 control: a joint schedule naming both, with Grace as a life, is matched to Grace", async () => {
      const h = await household();
      const joint = await h.doc({ role: "policy_wording", confirmed: false, text: "Covered: Grace Tern and Daniel Tern\n" + WORDING });
      const grace = await h.doc({ role: "personal_schedule", confirmed: true, text: schedule("Grace Tern"), member: "Grace Tern" });
      await linkRelatedReferenceDocuments(h.account, grace);
      assert.deepEqual(await h.linked(joint), ["Grace Tern:scheme_reference_match"]);
    });
  } finally {
    for (const a of accounts) await query("DELETE FROM accounts WHERE id=$1", [a]);
  }
  console.log(`scheme link owner: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

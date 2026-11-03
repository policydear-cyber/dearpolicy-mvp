/** Two schedules of one policy and one period are a copy only when neither states another amount for the same benefit or
 * cover (lib/documents/evidence-store.ts statesOtherAmounts, used by intake's same-schedule rule). A schedule reissued
 * after a change of cover is not set aside as a "copy" of the old one, so its newer amounts are never hidden behind the
 * older ones. A photo that read fewer figures, or left out a currency, is still a copy. Made-up households in several
 * markets and scripts; disposable PostgreSQL, no network, no model.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=<local> npm run -s documents:reissued-schedule-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
let outbound = 0;
globalThis.fetch = (async () => { outbound++; throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

type Row = { name: string; kind?: string; value: number | null; currency?: string | null; tier?: string | null; rowKind?: string | null };
type Cover = { category: string; amount: number | null; currency?: string | null };

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    console.log("reissued-schedule: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL)");
    process.exit(0);
  }
  const { query } = await import("@/lib/db/client");
  const { statesOtherAmounts } = await import("@/lib/documents/evidence-store");
  const account = randomUUID(), other = randomUUID();
  await query("INSERT INTO accounts(id,name) VALUES($1,'Reissued schedule test household'),($2,'Another household')", [account, other]);
  const person = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,'Amara Okafor','self') RETURNING id", [account])).rows[0].id;
  const otherPerson = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,'Lena Brandt','self') RETURNING id", [other])).rows[0].id;
  const doc = async (acct: string, member: string, rows: Row[], covers: Cover[] = []) => {
    const id = randomUUID();
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role)
      VALUES($1,$2,$3,'Harbourline Health Plus','schedule.pdf',$4,'ready','ready','scan_clean',true,'personal_schedule')`, [id, acct, member, `test/${id}`]);
    for (const r of rows) await query(`INSERT INTO policy_benefits(account_id,policy_id,benefit_name,formula_kind,formula_value,currency,tier,row_kind,quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$3)`,
      [acct, id, r.name, r.kind ?? "fixed", r.value, r.currency ?? null, r.tier ?? null, r.rowKind ?? null]);
    for (const c of covers) await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency) VALUES($1,$2,$3,$4,$5,$6)`, [acct, id, member, c.category, c.amount, c.currency ?? null]);
    return id;
  };
  const both = async (a: string, b: string) => [await statesOtherAmounts(account, a, b), await statesOtherAmounts(account, b, a)];
  try {
    await test("R1 a reissued schedule with another amount for one benefit is not a copy (both directions)", async () => {
      const old = await doc(account, person, [{ name: "Fracture of arm", value: 1000, currency: "SGD" }, { name: "Ambulance", value: 300, currency: "SGD" }]);
      const reissued = await doc(account, person, [{ name: "Fracture of arm", value: 1500, currency: "SGD" }, { name: "Ambulance", value: 300, currency: "SGD" }]);
      assert.deepEqual(await both(old, reissued), [true, true]);
    });
    await test("R2 another sum insured for the same cover is not a copy (Naira, Euro)", async () => {
      for (const [x, y, cur] of [[5_000_000, 7_500_000, "NGN"], [100_000, 120_000, "EUR"]] as const) {
        const a = await doc(account, person, [], [{ category: "Life", amount: x, currency: cur }]);
        const b = await doc(account, person, [], [{ category: "life", amount: y, currency: cur }]);
        assert.deepEqual(await both(a, b), [true, true], cur);
      }
    });
    await test("R3 the same amounts, a photo that read fewer rows, or a currency only one prints: still a copy", async () => {
      const pdf = await doc(account, person, [{ name: "Hospital room", kind: "daily", value: 250, currency: "GBP" }, { name: "Surgery", value: 20000, currency: "GBP" }], [{ category: "Health", amount: 500000, currency: "GBP" }]);
      const photo = await doc(account, person, [{ name: "hospital  room", kind: "daily", value: 250, currency: null }], [{ category: "Health", amount: null }]);
      assert.deepEqual(await both(pdf, photo), [false, false]);
    });
    await test("R4 another printed currency for the same amount is a difference", async () => {
      const a = await doc(account, person, [{ name: "Overseas medical", value: 50000, currency: "HKD" }]);
      const b = await doc(account, person, [{ name: "Overseas medical", value: 50000, currency: "USD" }]);
      assert.deepEqual(await both(a, b), [true, true]);
    });
    await test("R5 names in other scripts are compared whole: a different benefit is no difference, the same one is", async () => {
      const a = await doc(account, person, [{ name: "住院津贴", kind: "daily", value: 300, currency: "CNY" }, { name: "手术费", value: 8000, currency: "CNY" }]);
      const b = await doc(account, person, [{ name: "住院津贴", kind: "daily", value: 300, currency: "CNY" }, { name: "门诊费", value: 500, currency: "CNY" }]);
      assert.deepEqual(await both(a, b), [false, false], "different benefits never compared");
      const c = await doc(account, person, [{ name: "住院津贴", kind: "daily", value: 400, currency: "CNY" }]);
      assert.deepEqual(await both(a, c), [true, true]);
    });
    await test("R6 different tiers or row kinds are different statements, never a difference", async () => {
      const a = await doc(account, person, [{ name: "Overseas medical", value: 500000, currency: "SGD", tier: "Adult" }, { name: "Deductible", value: 3500, currency: "SGD", rowKind: "deductible" }]);
      const b = await doc(account, person, [{ name: "Overseas medical", value: 250000, currency: "SGD", tier: "Child" }, { name: "Deductible", value: 3500, currency: "SGD", rowKind: "policy_year_limit" }]);
      assert.deepEqual(await both(a, b), [false, false]);
    });
    await test("R7 another household's rows are never read", async () => {
      const mine = await doc(account, person, [{ name: "Fracture of arm", value: 1000, currency: "SGD" }]);
      const theirs = await doc(other, otherPerson, [{ name: "Fracture of arm", value: 9999, currency: "SGD" }]);
      assert.equal(await statesOtherAmounts(account, mine, theirs), false);
    });
    await test("N no request left this machine", async () => assert.equal(outbound, 0));
  } finally {
    for (const acct of [account, other]) {
      await query("DELETE FROM policy_benefits WHERE account_id=$1", [acct]).catch(() => {});
      await query("DELETE FROM policy_coverages WHERE account_id=$1", [acct]).catch(() => {});
      await query("DELETE FROM policies WHERE account_id=$1", [acct]).catch(() => {});
      await query("DELETE FROM family_members WHERE account_id=$1", [acct]).catch(() => {});
      await query("DELETE FROM accounts WHERE id=$1", [acct]).catch(() => {});
    }
  }
  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`reissued-schedule: ${passed} passed, 0 failed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

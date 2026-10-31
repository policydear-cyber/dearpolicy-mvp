/** A schedule line's printed sum belongs only to the benefit the line itself names. Before, a death line "Manfaat Takaful
 * (Kematian) RM200,000" also seeded TPD and terminal illness rows paying "MYR 200,000 lump sum", quoting the death line,
 * because a life plan usually pays those too; a "Total Permanent Disability" or "Accidental Death" line seeded a death
 * row with its own sum (cross-page check, 31 Oct). Those rows stay as "plans like this usually include this", with no
 * figure. Runs the real ledger seeding against a real, disposable PostgreSQL, for made-up households in RM, £, A$, S$
 * and Rp (only with DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL). No real household, no model call.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run ledger:plan-guess-figures-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    console.log("plan-guess figures: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run it)");
    return;
  }
  const { query } = await import("@/lib/db/client");
  const { seedLedger, loadLedger } = await import("@/lib/ledger/store");
  const account = randomUUID();
  await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, "Test household plan-guess figures"]);
  const person = async (name: string) => (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,'self') RETURNING id", [account, name])).rows[0].id;
  async function doc(member: string, product: string, lines: { category: string; sum: number; currency: string; text: string }[]) {
    const id = randomUUID();
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,quarantine_status,personal_coverage_confirmed,document_role,document_authority)
      VALUES($1,$2,$3,$4,$5,$5,'ready','scan_clean',true,'personal_schedule',95)`, [id, account, member, product, `${id}.pdf`]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [id, member, account]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [account, id, lines.map((l) => l.text).join("\n")]);
    for (const l of lines) await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,confirmed,evidence_verified)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,true,true)`, [account, id, member, l.category, l.sum, l.currency, product, l.text]);
    return id;
  }
  const aiman = await person("Aiman Rahman"), tom = await person("Tom Bennett"), linh = await person("Linh Nguyen"), wei = await person("Wei Ling Tan"), budi = await person("Budi Wijaya");
  await doc(aiman, "Teratai Family Takaful Life Plan", [{ category: "Death", sum: 200000, currency: "MYR", text: "Manfaat Takaful (Kematian)\tRM200,000" }]);
  await doc(tom, "Heronsgate Term Life", [{ category: "Death", sum: 250000, currency: "GBP", text: "Sum assured\t£250,000" }]);
  await doc(linh, "Wattle Term Life", [{ category: "Death", sum: 500000, currency: "AUD", text: "Death cover\tA$500,000" }, { category: "Total Permanent Disability", sum: 300000, currency: "AUD", text: "TPD cover\tA$300,000" }]);
  await doc(wei, "Kestrel Personal Accident Plan", [{ category: "Personal Accident", sum: 100000, currency: "SGD", text: "Personal Accident sum insured\tS$100,000" }]);
  await doc(wei, "Merlion Critical Illness Plan", [{ category: "Early Critical Illness", sum: 50000, currency: "SGD", text: "Early stage critical illness\tS$50,000" }]);
  await doc(budi, "Cendana Life Protection", [{ category: "Accidental Death", sum: 400000000, currency: "IDR", text: "Meninggal karena kecelakaan\tRp 400.000.000" }]);
  try {
    await seedLedger(account);
    const rows = await loadLedger(account);
    const of = (member: string, event: string) => rows.filter((r) => r.familyMemberId === member && r.eventType === event && r.status !== "rejected");
    const figures = (member: string, event: string) => of(member, event).map((r) => [r.amount, r.currency]);

    await test("a death line seeds TPD and terminal illness with no figure (RM)", () => {
      assert.ok(of(aiman, "tpd").length && of(aiman, "terminal_illness").length, JSON.stringify(rows.filter((r) => r.familyMemberId === aiman).map((r) => r.eventType)));
      assert.deepEqual(figures(aiman, "tpd"), [[null, "MYR"]]);
      assert.deepEqual(figures(aiman, "terminal_illness"), [[null, "MYR"]]);
      for (const r of [...of(aiman, "tpd"), ...of(aiman, "terminal_illness")]) assert.equal(r.paysKind, "stated");
    });
    await test("the death line keeps its own sum (control, RM)", () => assert.deepEqual(figures(aiman, "death"), [[200000, "MYR"]]));
    await test("a life sum assured line: death keeps £250,000, TPD and terminal illness show none", () => {
      assert.deepEqual(figures(tom, "death"), [[250000, "GBP"]]);
      assert.deepEqual(figures(tom, "tpd"), [[null, "GBP"]]);
      assert.deepEqual(figures(tom, "terminal_illness"), [[null, "GBP"]]);
    });
    await test("a TPD line pays its own sum as TPD and never seeds death with it (A$)", () => {
      assert.deepEqual(figures(linh, "death").filter(([a]) => a != null), [[500000, "AUD"]]);
      assert.ok(!figures(linh, "death").some(([a]) => a === 300000), JSON.stringify(figures(linh, "death")));
      assert.deepEqual(figures(linh, "tpd").filter(([a]) => a != null), [[300000, "AUD"]]);
      assert.ok(!figures(linh, "tpd").some(([a]) => a === 500000), JSON.stringify(figures(linh, "tpd")));
    });
    await test("a personal accident line keeps its sum as accidental death (control, S$)", () => assert.deepEqual(figures(wei, "accidental_death"), [[100000, "SGD"]]));
    await test("an early critical illness line never becomes the critical illness sum (S$)", () => {
      assert.ok(!figures(wei, "critical_illness").some(([a]) => a === 50000), JSON.stringify(figures(wei, "critical_illness")));
    });
    await test("an accidental death line never seeds death with its sum (Rp)", () => {
      assert.ok(!figures(budi, "death").some(([a]) => a === 400000000), JSON.stringify(figures(budi, "death")));
    });
    await test("a household's seeded figures are re-checked on the next refresh: a stored guessed figure is cleared", async () => {
      await query("UPDATE coverage_rules SET amount=200000,pays_kind='lump_sum' WHERE account_id=$1 AND family_member_id=$2 AND event_type='tpd'", [account, aiman]);
      await seedLedger(account);
      const again = (await loadLedger(account)).filter((r) => r.familyMemberId === aiman && r.eventType === "tpd");
      assert.deepEqual(again.map((r) => [r.amount, r.paysKind]), [[null, "stated"]]);
    });
  } finally {
    await query("DELETE FROM accounts WHERE id=$1", [account]).catch(() => undefined);
  }
}

main().then(() => {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.log("FAIL", f); process.exit(1); }
  process.exit(0);
}, (error) => { console.error(error); process.exit(1); });

/** A family plan's one premium is printed under the policyholder; the other people it covers are told where it is
 * counted, never "no premium is printed in the documents on file" or "Upload a schedule for <child>" (new-user
 * walkthrough, 31 Oct: an Australian family's hospital-and-extras plan printed A$412.80 a month under the mother; the
 * children's Payments rows said no premium was printed for it). Runs the real summarisePremiums and the premium chat
 * answer against a real, disposable PostgreSQL for made-up households in A$ and £:
 *   - the child's summary names the plan as counted under the policyholder, not as missing, and counts nothing twice;
 *   - a policy of the child's own with no premium anywhere is still named as missing;
 *   - the policyholder's own total is unchanged;
 *   - matching by policy number works when the premium was read from another document of the same policy;
 *   - the chat answer for the child says whose policy the premium is paid under, never "no premium amount is printed".
 * No real household, insurer or scheme; no model call; no paid call.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run -s policies:premium-elsewhere-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("premium counted elsewhere: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
delete process.env.DEARPOLICY_BENEFIT_TABLE;
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC|OPENAI/i.test(k)) delete process.env[k];
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { query } = await import("@/lib/db/client");
  const { summarisePremiums } = await import("@/lib/policies/premium-summary");
  const { premiumAnswer } = await import("@/lib/chat/premium-answer");
  const accounts: string[] = [];
  async function household(name: string) {
    const id = randomUUID(); accounts.push(id);
    await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [id, name]);
    const person = async (n: string, rel: string) => ({ id: (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [id, n, rel])).rows[0].id, display_name: n, preferred_name: null, relationship: rel });
    async function policy(owner: string, members: string[], product: string, number: string | null, type: string, page: string, insurer = "Example Mutual Ltd", role = "personal_schedule") {
      const pid = randomUUID();
      await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,insurer,policy_number,policy_type,original_filename,storage_key,processing_status,quarantine_status,personal_coverage_confirmed,document_role,document_authority)
        VALUES($1,$2,$3,$4,$8,$5,$6,$7,$7,'ready','scan_clean',true,$9,95)`, [pid, id, owner, product, number, type, `${pid}.pdf`, insurer, role]);
      for (const m of members) await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [pid, m, id]);
      await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [id, pid, page]);
      return pid;
    }
    const premium = (policyId: string, member: string, amount: number, currency: string, number: string | null = null) =>
      query("INSERT INTO premium_records(account_id,policy_id,family_member_id,amount,currency,frequency,source_document_id,source_page,policy_number,product_name) VALUES($1,$2,$3,$4,$5,'monthly',$2,1,$6,(SELECT product_name FROM policies WHERE id=$2))", [id, policyId, member, amount, currency, number]);
    return { id, person, policy, premium };
  }

  try {
    // A$: one family hospital plan, premium printed under the mother; the child also has a plan of her own with no premium.
    const au = await household("Test household family premium A$");
    const mum = await au.person("Linh Nguyen", "self"), child = await au.person("Mai Walsh", "child");
    const plan = await au.policy(mum.id, [mum.id, child.id], "Gold Hospital and Top Extras", "CB-2291", "Health", "Family cover: Linh Nguyen, Mai Walsh\nPremium A$412.80 per month");
    await au.premium(plan, mum.id, 412.8, "AUD");
    await au.policy(child.id, [child.id], "Junior Savings Bond", null, "Savings", "Junior Savings Bond for Mai Walsh");
    // £: the premium was read from a renewal letter of the same policy number, filed under the father.
    const gb = await household("Test household family premium GBP");
    const dad = await gb.person("Amara Okafor", "self"), son = await gb.person("Tobi Okafor", "child");
    const schedule = await gb.policy(dad.id, [dad.id, son.id], "Family Health Plan", "FH 0042 77", "Health", "Members: Amara Okafor, Tobi Okafor");
    const letter = await gb.policy(dad.id, [dad.id], "Family Health Plan", "FH004277", "Health", "Your monthly premium is £96.50");
    await gb.premium(letter, dad.id, 96.5, "GBP", "FH004277");
    void schedule;
    // RM: a different insurer happens to use the same policy number; that premium is not this plan's.
    const my = await household("Test household other insurer RM");
    const ibu = await my.person("Siti Rahman", "self"), anak = await my.person("Adam Rahman", "child");
    await my.policy(ibu.id, [ibu.id, anak.id], "Keluarga Medical Card", "MC-778812", "Health", "Members: Siti Rahman, Adam Rahman", "Contoh Takaful Berhad");
    const other = await my.policy(ibu.id, [ibu.id], "Motor Comprehensive", "MC-778812", "Motor", "Premium RM210.00 per month", "Lain General Insurance Bhd");
    await my.premium(other, ibu.id, 210, "MYR", "MC-778812");
    // £: the payer was removed from the shared plan; their premium is no longer this person's plan's premium.
    const uk2 = await household("Test household removed payer GBP");
    const exPayer = await uk2.person("Robin Hale", "spouse"), kid = await uk2.person("Ivy Hale", "child");
    const shared = await uk2.policy(exPayer.id, [kid.id], "Dental Plan", "DP-55120", "Health", "Members: Ivy Hale\nPremium £18.20 per month");
    await uk2.premium(shared, exPayer.id, 18.2, "GBP", "DP-55120");

    await test("the child's family plan is counted under the policyholder, not called missing", async () => {
      const s = await summarisePremiums(au.id, child);
      assert.ok(!s.missing.includes("Gold Hospital and Top Extras"), JSON.stringify(s.missing));
      assert.deepEqual(s.countedElsewhere, [{ name: "Gold Hospital and Top Extras", owner: "Linh Nguyen" }]);
      assert.match(s.note ?? "", /Gold Hospital and Top Extras is on file under Linh Nguyen, so it is counted in Linh Nguyen’s total/);
      assert.doesNotMatch(s.note ?? "", /Gold Hospital and Top Extras[^.]*no premium is printed/);
      assert.equal(s.annual, 0, "never counted twice");
    });
    await test("a policy of the child's own with no premium anywhere is still named as missing", async () => {
      const s = await summarisePremiums(au.id, child);
      assert.deepEqual(s.missing, ["Junior Savings Bond"]);
    });
    await test("the policyholder's own total is unchanged", async () => {
      const s = await summarisePremiums(au.id, mum);
      assert.equal(Math.round(s.annual * 100) / 100, 4953.6);
      assert.deepEqual(s.countedElsewhere ?? [], []);
    });
    await test("a premium read from another document with the same policy number counts (£, spacing differs)", async () => {
      const s = await summarisePremiums(gb.id, son);
      assert.deepEqual(s.missing, []);
      assert.deepEqual(s.countedElsewhere, [{ name: "Family Health Plan", owner: "Amara Okafor" }]);
    });
    await test("the person it says counts the premium really does count it, once (£)", async () => {
      const s = await summarisePremiums(gb.id, dad);
      assert.equal(Math.round(s.annual * 100) / 100, 1158, "£96.50 a month in Amara's own total");
      assert.deepEqual(s.countedElsewhere ?? [], []);
    });
    await test("the same policy number from a different insurer is not counted elsewhere (RM)", async () => {
      const s = await summarisePremiums(my.id, anak);
      assert.deepEqual(s.countedElsewhere ?? [], []);
      assert.ok(s.missing.includes("Keluarga Medical Card"), JSON.stringify(s.missing));
    });
    await test("a premium filed under someone no longer on the document is not counted elsewhere (£)", async () => {
      const s = await summarisePremiums(uk2.id, kid);
      assert.deepEqual(s.countedElsewhere ?? [], []);
      assert.ok(s.missing.includes("Dental Plan"), JSON.stringify(s.missing));
    });
    // Live test 10 Nov: a schedule printing its premium with no currency, and a wording filed for someone, were each said
    // to print no premium. Made-up household in NZ$.
    const nz = await household("Test household premium printed NZ$");
    const aroha = await nz.person("Aroha Smith", "self");
    const sched = await nz.policy(aroha.id, [aroha.id], "Kiwi Term Cover", "KT-30318", "Life", "Kiwi Term Cover\nAroha Smith\nPremium 61.20 monthly");
    await nz.policy(aroha.id, [aroha.id], "Kiwi Term Cover Policy Wording", null, "Life", "Policy wording: what we pay", "Example Mutual Ltd", "policy_wording");
    const unclearCover = { product: "Kiwi Term Cover", cover: "Kiwi Term Cover", plan: null, policyNumber: "KT-30318", premium: 61.2, premiumFrequency: "monthly", currency: null, premiumCurrency: null,
      premiumNote: null, firstYearPremium: null, firstYearFrom: null, startDate: null, endDate: null, documentPeriodFrom: null, documentPeriodTo: null, documentKind: "personal_proof" as const,
      source: { documentId: sched, document: "Kiwi Term Cover", page: 1, excerpt: "Premium 61.20 monthly" }, premiumSource: null, ended: null };
    await test("a premium printed with no currency is never called missing: it is left out as unclear (NZ$)", async () => {
      const s = await summarisePremiums(nz.id, aroha, { covers: [unclearCover] as never, today: 20_000 });
      assert.ok(!s.missing.includes("Kiwi Term Cover"), JSON.stringify(s.missing));
      assert.doesNotMatch(s.note ?? "", /Kiwi Term Cover[^.]*no premium is printed/);
    });
    await test("a policy known only from its wording is never said to be missing a premium (NZ$)", async () => {
      const s = await summarisePremiums(nz.id, aroha, { covers: [unclearCover] as never, today: 20_000 });
      assert.ok(!s.missing.some((m) => /Wording/i.test(m)), JSON.stringify(s.missing));
      assert.deepEqual(s.missing, []);
    });
    await test("the chat answer for the child says whose policy pays, never that no premium is printed", async () => {
      const a = await premiumAnswer({ accountId: gb.id, people: [son], question: "How much do we pay for Tobi's insurance?" });
      assert.match(a.summary, /Tobi Okafor has no separate premium\. Family Health Plan is paid under Amara Okafor’s policy/);
      assert.doesNotMatch(a.summary, /No premium amount is printed/);
    });
  } finally {
    for (const a of accounts) await query("DELETE FROM accounts WHERE id=$1", [a]).catch(() => undefined);
  }
  await test("no request tried to leave this machine (no model was asked)", async () => assert.deepEqual(outbound, []));
  console.log(`premium counted elsewhere: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

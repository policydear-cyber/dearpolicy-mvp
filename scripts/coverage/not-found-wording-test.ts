/** Chat never says "Not covered" when it only means a cover was not found in the uploaded documents. Before, "How much
 * hospital cover do I have?" for a person whose uploads hold only a Hospital Cash benefit answered "Not covered — I do
 * not see Hospitalisation…", while Home showed her hospital cover (cross-page check, 31 Oct). Only a document can say a
 * person is not covered; a policy that was not uploaded may still hold it.
 * Runs the real portfolio answer (lib/coverage/answer.ts) against a real, disposable PostgreSQL, for a made-up household
 * in Rp, S$ and £ (only with DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL). No real household, no model call.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run coverage:not-found-wording-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const NOT_COVERED = /\bnot covered\b|\buninsured\b|\bno cover(?:age)?\b|\bisn'?t covered\b|\baren'?t covered\b/i;

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    console.log("not-found wording: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run it)");
    return;
  }
  const { query } = await import("@/lib/db/client");
  const { answerPortfolioQuestion } = await import("@/lib/coverage/answer");
  const account = randomUUID();
  await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, "Test household not-found wording"]);
  const person = async (name: string, preferred: string | null, rel: string) =>
    (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4) RETURNING id", [account, name, preferred, rel])).rows[0].id;
  const dewi = await person("Dewi Wijaya", null, "self"), priya = await person("Priya Nair", "Pri", "spouse"), amara = await person("Amara Okafor", null, "child");
  async function line(member: string, p: { product: string; category: string; sum: number; currency: string; text: string }) {
    const id = randomUUID();
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,quarantine_status,personal_coverage_confirmed,document_role,document_authority)
      VALUES($1,$2,$3,$4,$5,$5,'ready','scan_clean',true,'personal_schedule',95)`, [id, account, member, p.product, `${id}.pdf`]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [id, member, account]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [account, id, p.text]);
    await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,confirmed,evidence_verified)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,true,true)`, [account, id, member, p.category, p.sum, p.currency, p.product, p.text]);
  }
  await line(dewi, { product: "Cendana Santunan Harian", category: "Hospital Cash", sum: 500000, currency: "IDR", text: "Santunan rawat inap harian Rp 500.000" });
  await line(priya, { product: "Harbour Life Plan", category: "Death", sum: 200000, currency: "SGD", text: "Sum assured S$200,000" });
  const text = (a: { summary: string; details: string[] }) => [a.summary, ...a.details].join("\n");
  try {
    await test("a hospital question with only Hospital Cash on file says it couldn't find it, never 'Not covered'", async () => {
      const a = await answerPortfolioQuestion(account, dewi, "How much hospital cover do I have?");
      assert.ok(!NOT_COVERED.test(text(a)), text(a));
      assert.match(a.summary, /couldn't find Hospitalisation cover for Dewi Wijaya in the personal policies uploaded/);
      assert.match(text(a), /separate Hospital Cash benefit under Cendana Santunan Harian/);
      assert.match(text(a), /policy that hasn't been uploaded, or a page that couldn't be read, may still include it/);
    });
    for (const [who, id, q, want] of [
      ["Dewi", dewi, "How much death cover do I have?", /couldn't find Death cover for Dewi Wijaya/],
      ["Priya (preferred name)", priya, "Am I covered for critical illness?", /couldn't find Critical Illness cover for Pri\b/],
      ["Amara (nothing uploaded)", amara, "How much disability income cover do I have?", /couldn't find Disability Income cover for Amara Okafor/],
    ] as const) await test(`${who}: a cover not found is never called 'Not covered'`, async () => {
      const a = await answerPortfolioQuestion(account, id, q);
      assert.ok(!NOT_COVERED.test(text(a)), text(a));
      assert.match(a.summary, want);
    });
    await test("'what am I not covered for?' lists what wasn't found, never as 'Not covered'", async () => {
      const a = await answerPortfolioQuestion(account, priya, "What am I not covered for?");
      assert.ok(!NOT_COVERED.test(text(a)), text(a));
      assert.match(a.summary, /^I couldn't find these covers for Pri in the personal policies uploaded: .*Hospitalisation/);
      assert.ok(!/Death/.test(a.summary), a.summary);
    });
    await test("a cover on file still answers with its figure (control)", async () => {
      const a = await answerPortfolioQuestion(account, priya, "How much death cover do I have?");
      assert.match(a.summary, /^Covered — Death is S\$200,000\.$/);
    });
    await test("a person in another household is never named (control)", async () => {
      const a = await answerPortfolioQuestion(randomUUID(), dewi, "How much death cover do I have?");
      assert.ok(!/Dewi/.test(text(a)), text(a));
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

/** Every policy on file is taken as in force (DC, 31 Oct: "ignore all expiry dates ... assume all policies are still in
 * force"). The new-user walkthrough found the chat still doubting an older document because of its age: "Some of this
 * comes from a document dated 3 Mar 2019, so it may not reflect the current terms", "(page 2, ...; not confirmed
 * current)" and the next step "Upload the latest renewal notice or premium receipt to confirm the policy is current".
 * Runs the real answerPolicyQuestion against a real, disposable PostgreSQL for made-up households in A$ and RM:
 *   - an older document's figure is answered with its amount and the document's date;
 *   - the answer never says the figure may not be current, never "not confirmed current", and never asks for a renewal;
 *   - a printed lapse ("lapsed on ...") is still said, since that is the document's own content, not a date rule.
 * No real household, insurer or scheme; no model call; no paid call.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run -s chat:older-document-in-force-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("older document in force: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const DOUBT = /may not reflect the current|not confirmed current|confirm the policy is current|does not confirm cover today|no longer (?:in force|current)|\bexpired\b|\bended\b/i;

async function main() {
  const { query } = await import("@/lib/db/client");
  const { answerPolicyQuestion } = await import("@/lib/chat/policy-answer");
  const accounts: string[] = [];
  async function household(name: string, person: string, doc: { product: string; currency: string; category: string; amount: number; printed: string; dated: string; pages: Record<number, string> }) {
    const account = randomUUID(); accounts.push(account);
    await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, name]);
    const member = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,'self') RETURNING id", [account, person])).rows[0].id;
    const id = randomUUID();
    await query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,quarantine_status,document_date,file_hash,benefits_indexed_at,conditions_indexed_at,ledger_read_at)
      VALUES($1,$2,$3,'Example Mutual Ltd',$4,'X-1','Life','personal_schedule',true,95,'ready',$5,$5,$6,'scan_clean',$6,$7,now(),now(),now())`, [id, account, member, doc.product, `${id}.pdf`, doc.dated, "sha256:" + id]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [id, member, account]);
    for (const [page, text] of Object.entries(doc.pages)) {
      await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [account, id, Number(page), text]);
      await query("INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,text) VALUES($1,$2,$3,$4,$4,$5)", [account, member, id, Number(page), text]);
    }
    await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed)
      VALUES($1,$2,$3,$4,$5,$6,$7,2,$8,true,true)`, [account, id, member, doc.category, doc.amount, doc.currency, doc.product, doc.printed]);
    return { account, person: { id: member, display_name: person, preferred_name: null, relationship: "self" } };
  }
  const flat = (a: { summary: string; details: string[]; nextSteps?: string[] }) => [a.summary, ...a.details, ...(a.nextSteps ?? [])].join("\n");

  try {
    const au = await household("Test household older document A$", "Linh Nguyen", { product: "Wattle Life Protection", currency: "AUD", category: "Death", amount: 850000,
      printed: "Life Cover A$850,000", dated: "2019-03-03", pages: { 1: "Wattle Life Protection policy schedule for Linh Nguyen, issued 3 March 2019. All amounts in Australian dollars.", 2: "Life Cover A$850,000" } });
    const my = await household("Test household older document RM", "Nur Aisyah", { product: "Takaful Accident Shield", currency: "MYR", category: "Personal Accident", amount: 200000,
      printed: "Accidental death RM200,000", dated: "2017-06-01", pages: { 1: "Takaful Accident Shield certificate for Nur Aisyah dated 1 June 2017.", 2: "Accidental death RM200,000" } });
    const lapsed = await household("Test household printed lapse", "Priya Nair", { product: "Lighthouse Term Plan", currency: "SGD", category: "Death", amount: 150000,
      printed: "Death benefit S$150,000", dated: "2018-01-10", pages: { 1: "Lighthouse Term Plan for Priya Nair. This policy lapsed on 10 March 2020 for non-payment.", 2: "Death benefit S$150,000" } });

    await test("an A$ schedule from 2019 is answered with its amount and date, never doubted because of its age", async () => {
      const r = await answerPolicyQuestion({ accountId: au.account, question: "What is Linh's death cover?", people: [au.person] });
      assert.equal(r.handled, true, JSON.stringify(r.rejected.map((x) => x.reason)));
      const text = flat(r.answer);
      assert.match(text, /A\$850,000/);
      assert.match(text, /2019/);
      assert.doesNotMatch(text, DOUBT);
      assert.deepEqual(r.answer.nextSteps, []);
    });
    await test("an RM certificate from 2017 is answered with no 'may not reflect the current terms' and no renewal ask", async () => {
      const r = await answerPolicyQuestion({ accountId: my.account, question: "How much is Nur's accident cover?", people: [my.person] });
      assert.equal(r.handled, true, JSON.stringify(r.rejected.map((x) => x.reason)));
      const text = flat(r.answer);
      assert.match(text, /(?:RM|MYR)\s?200,000/);
      assert.doesNotMatch(text, DOUBT);
      assert.ok(!(r.answer.nextSteps ?? []).some((s) => /renewal|confirm the policy is current/i.test(s)));
    });
    await test("a lapse the document itself prints is still said", async () => {
      const r = await answerPolicyQuestion({ accountId: lapsed.account, question: "What is Priya's death cover?", people: [lapsed.person] });
      assert.match(flat(r.answer), /lapsed/i);
    });
  } finally {
    for (const a of accounts) await query("DELETE FROM accounts WHERE id=$1", [a]).catch(() => undefined);
  }
  await test("no request tried to leave this machine (no model was asked)", async () => assert.deepEqual(outbound, []));
  console.log(`older document in force: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

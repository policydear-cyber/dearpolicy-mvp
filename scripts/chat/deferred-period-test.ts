/** New-user walkthrough, round 5 (3 Nov): "Tom has been off work for 3 months, can he claim on his income
 * protection?" got "I couldn't match this what-if to one particular benefit". It is answered by comparing the time
 * off the household states with the deferred (waiting) period the plan prints, computed in code
 * (lib/chat/deferred-period.ts), for any household, unit and wording; the insurer still decides the claim.
 *   npm run -s chat:deferred-period-test   (DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... adds the database checks) */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
Object.assign(process.env, { DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e", E2E_RUN_ID: "deferred", MODEL_PRESET: "gemini", GEMINI_API_KEY: "ci" });
delete process.env.DEARPOLICY_BENEFIT_TABLE;
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { timeOffWork, printedWaitingPeriod, compareWithWaiting, waitingPeriodSentence, asksAboutIncomeCover } = await import("@/lib/chat/deferred-period");
  await test("the time off work is read once, in digits or words, in any unit; two lengths or none give nothing", () => {
    assert.deepEqual(timeOffWork("Tom has been off work for 3 months, can he claim on his income protection?"), { min: 84, max: 93, text: "3 months" });
    assert.deepEqual(timeOffWork("She's been off sick for the past six weeks"), { min: 42, max: 42, text: "6 weeks" });
    assert.deepEqual(timeOffWork("He got signed off 10 days ago"), { min: 10, max: 10, text: "10 days" });
    assert.deepEqual(timeOffWork("unable to work for a year now"), { min: 365, max: 366, text: "1 year" });
    assert.deepEqual(timeOffWork("Off work 12 weeks already, can I claim?"), { min: 84, max: 84, text: "12 weeks" });
    for (const m of ["off work for 2 weeks and then 3 months more", "he hurt his back", "How long is the deferred period?", "off work since 3 March", "in hospital for 3 days"]) assert.equal(timeOffWork(m), null, m);
  });
  await test("a length that is the plan's period, or time off still to come, is never read as time already off", () => {
    for (const m of ["Tom has been off work since his accident; his deferred period is 13 weeks. Can he claim?", "off sick, and the 4 weeks waiting period has passed?",
      "Tom can't work for the next 2 months after surgery, can he claim on his income protection?", "She will be off work for 6 weeks", "he is going to be off work for three months",
      "off work, my brother was off for 3 months last year",
      // Test engineer's cases: decimals, ranges and hyphenated words are no whole length; denied, past and "since" time off is not counted.
      "off work for 1.5 months", "off sick for twenty-one days", "off work for 3-4 weeks", "He is not off work, he has been working for 3 months",
      "off work since last week. His deferred period is 13 weeks", "He will be off for 3 months, off work from Monday", "can't work for the next 6 weeks",
      "was off work for 3 months in 2024, back at work since"]) assert.equal(timeOffWork(m), null, m);
  });
  await test("only a question about the income plan, and about nothing else that happened, gets the comparison", () => {
    for (const m of ["Tom has been off work for 3 months, can he claim on his income protection?", "Mei has been off sick for 10 days. Can she claim on her salary continuance?", "Is his deferred period over? He's been off work 14 weeks"])
      assert.equal(asksAboutIncomeCover(m), true, m);
    for (const m of ["Tom broke his leg and has been off work for 6 weeks, what can he claim?", "off work for 6 weeks after a hospital stay, can he claim on his income protection?", "He's been off work for 3 months, what can he claim?",
      "Off work 3 months, can he claim on his income protection, and what does his private medical insurance pay for the operation?", "off work 3 months on income protection; does his critical illness cover pay?"])
      assert.equal(asksAboutIncomeCover(m), false, m);
  });
  await test("only a line that is the period's label and one length is the period", () => {
    assert.deepEqual(printedWaitingPeriod("Deferred period\t13 weeks"), { label: "deferred period", span: { min: 91, max: 91, text: "13 weeks" } });
    assert.deepEqual(printedWaitingPeriod("Waiting period: 30 days"), { label: "waiting period", span: { min: 30, max: 30, text: "30 days" } });
    assert.deepEqual(printedWaitingPeriod("Elimination period 90 days"), { label: "elimination period", span: { min: 90, max: 90, text: "90 days" } });
    for (const l of ["Deferred period 4 or 13 weeks", "Deferred period\t13 weeks (26 weeks if self-employed)", "Waiting period for maternity 280 days", "Waiting period 30 days per claim", "Benefit payment period\tTo age 67"])
      assert.equal(printedWaitingPeriod(l), null, l);
  });
  await test("the comparison treats months as 28 to 31 days: 'about the same' whenever the ranges overlap", () => {
    const w = { min: 91, max: 91, text: "13 weeks" };
    assert.equal(compareWithWaiting({ min: 84, max: 93, text: "3 months" }, w).state, "about");
    assert.equal(compareWithWaiting({ min: 112, max: 124, text: "4 months" }, w).state, "passed");
    assert.deepEqual(compareWithWaiting({ min: 42, max: 42, text: "6 weeks" }, w), { state: "not_yet", left: "7 weeks" });
    assert.deepEqual(compareWithWaiting({ min: 56, max: 62, text: "2 months" }, w), { state: "not_yet", left: "about 4 to 5 weeks" });
    assert.deepEqual(compareWithWaiting({ min: 10, max: 10, text: "10 days" }, { min: 30, max: 30, text: "30 days" }), { state: "not_yet", left: "20 days" });
  });
  await test("the sentence never says the insurer will pay", () => {
    for (const off of [{ min: 112, max: 124, text: "4 months" }, { min: 84, max: 93, text: "3 months" }, { min: 42, max: 42, text: "6 weeks" }]) {
      const s = waitingPeriodSentence("Tom", off, { label: "deferred period", span: { min: 91, max: 91, text: "13 weeks" } }, "Income Protection");
      assert.doesNotMatch(s, /\bwill (?:pay|be paid|receive)\b|\bentitled\b|\bguaranteed\b/i, s);
      assert.match(s, /insurer/, s);
    }
  });

  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB === "1" && /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    const { query } = await import("@/lib/db/client");
    const { askContextualDearPolicy } = await import("@/lib/chat/workflow");
    const A = randomUUID();
    try {
      await query("INSERT INTO accounts(id,name) VALUES($1,'Test household deferred period')", [A]);
      const ids: Record<string, string> = {};
      for (const [n, r] of [["Amara Okafor", "self"], ["Tom Bennett", "spouse"], ["Mei Tan", "parent"], ["Wei Ling Ong", "sibling"], ["Ravi Kumar", "child"]])
        ids[n] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [A, n, r])).rows[0].id;
      const doc = async (owner: string, product: string, type: string, page: string, role = "personal_schedule") => {
        const id = randomUUID();
        await query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status,file_hash,benefits_indexed_at)
          VALUES($1,$2,$3,'Example Mutual',$4,'IP-1',$5,$8,true,95,'ready',$6,$6,'scan_clean',$7,now())`, [id, A, ids[owner], product, type, `${id}.pdf`, "sha256:" + id, role]);
        await query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [id, ids[owner], A]);
        await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [A, id, page]);
      };
      await doc("Tom Bennett", "Income Protection", "Disability", "Income Protection - Policy schedule\nMember: Tom Bennett\nMonthly benefit\t£2,400\nDeferred period\t13 weeks\nBenefit payment period\tTo age 67\nMonthly contribution\t£41.20");
      await doc("Tom Bennett", "Accident Guard", "Personal Accident", "Accident Guard - schedule\nInsured: Tom Bennett\nFracture of leg\t£1,500\nHospital cash\t£100 per day");
      await doc("Wei Ling Ong", "Income Shield Brochure", "Income Protection", "Income Shield - how it works\nDeferred period: 4 weeks", "brochure");
      await doc("Wei Ling Ong", "Income Shield", "Income Protection", "Income Shield - schedule\nInsured: Wei Ling Ong\nMonthly benefit\t£1,800\nDeferred period\t26 weeks");
      await doc("Wei Ling Ong", "Disability Premium Waiver Rider", "Disability", "Disability Premium Waiver Rider\nInsured: Wei Ling Ong\nWaiting period: 6 months");
      await doc("Ravi Kumar", "Earnings Guard", "Income Protection", "Earnings Guard - schedule\nInsured: Ravi Kumar\nMonthly benefit\t£2,000\nDeferred period\t8 weeks\nHospital cash waiting period\t7 days");
      await doc("Mei Tan", "Salary Continuance Plan", "Disability Income", "Salary Continuance Plan\nInsured: Mei Tan\nMonthly benefit\tA$4,000\nWaiting period: 30 days\nBenefit period\t2 years");
      const ask = (question: string) => askContextualDearPolicy({ accountId: A, familyMemberId: null, scope: "family", question });
      const said = (r: Awaited<ReturnType<typeof ask>>) => [r.answer.summary, ...(r.answer.details ?? [])].join("\n");

      await test("database: 3 months off work is compared with the printed 13-week deferred period", async () => {
        const r = await ask("Tom has been off work for 3 months, can he claim on his income protection?");
        const text = said(r);
        assert.match(text, /off work for 3 months, which is about the same as the deferred period of 13 weeks that Income Protection prints/, text);
        assert.match(text, /Deferred period: 13 weeks \(page 1\)/, text);
        assert.doesNotMatch(text, /couldn’t match this what-if/, text);
        assert.ok((r.answer.citations ?? []).some((c) => c.pageStart === 1 && c.policyName === "Income Protection"), JSON.stringify(r.answer.citations));
      });
      await test("database: asked as a what-if, the same comparison is given", async () => {
        const text = said(await ask("What if Tom is off work for 4 months, could he claim on his income protection?"));
        assert.match(text, /off work for 4 months, which is longer than the deferred period of 13 weeks that Income Protection prints/, text);
      });
      await test("database: the person's own schedule gives the period, under their whole name; a brochure's example and a premium waiver rider are not used", async () => {
        const text = said(await ask("Wei Ling has been off work for 2 months, has her deferred period passed?"));
        assert.match(text, /Wei Ling Ong has been off work for 2 months, which is shorter than the deferred period of 26 weeks that Income Shield prints/, text);
      });
      await test("database: a plan that prints another period line (hospital cash) gets no comparison", async () => {
        const text = said(await ask("Ravi has been off work for 3 months, has his deferred period passed?"));
        assert.doesNotMatch(text, /deferred period of|waiting period of/, text);
      });
      await test("database: a waiting period in days, on a plan named in another market's words, gives the days still to go", async () => {
        const text = said(await ask("Mei has been off sick for 10 days. Can she claim on her salary continuance?"));
        assert.match(text, /shorter than the waiting period of 30 days that Salary Continuance Plan prints, with 20 days still to go/, text);
      });
      await test("database: a broken leg with time off work is still the accident claim, never only the deferred period", async () => {
        const text = said(await ask("Tom broke his leg and has been off work for 6 weeks, what can he claim?"));
        assert.doesNotMatch(text, /deferred period of 13 weeks/, text);
        assert.match(text, /broken leg|fracture/i, text);
      });
    } finally {
      await query("DELETE FROM accounts WHERE id=$1", [A]).catch(() => undefined);
    }
  } else console.log("deferred period: database checks skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run them)");

  await test("no request tried to leave this machine", () => assert.deepEqual(outbound, []));
  console.log(`deferred period: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

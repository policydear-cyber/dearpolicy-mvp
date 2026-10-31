/** New-user walkthrough, round 3 (31 Oct): a made-up UK household paying in £. Its family health plan calls the payment
 * a "subscription", its income protection policy (from a friendly society) calls it a "contribution", and it has two
 * children. Three failures, each fixed as a general rule, are checked here for any household:
 *   1. "How much do we pay for insurance each month?" was not read as a premium question. The phrase "pay for" followed
 *      by "insurance" was taken to only name a plan, so chat said it was not sure what to look up.
 *   2. Once read, the household total was withheld ("I've left out an amount I couldn't match"). The check that a
 *      premium operand sits on a premium row knew only the word "premium". Health funds, cash plans, friendly societies
 *      and takaful operators print "subscription" or "contribution". Those words count when they name the payment, and
 *      never on a benefit row that merely mentions one.
 *   3. "Sorry, it was Joe, not Ada." was taken as an answer for Ada while her claim waited on a question. When the person
 *      was resolved, the claim was lost: the background job prepares the message again from the new chat, so it never
 *      read what should carry over (the open claim). Now the person meant is resolved and the claim moves to them.
 *   4. "What's the excess on our health insurance?" listed the travel plan's excess too ("health insurance" named no
 *      plan kind), and showed each excess on a "Policy-stated coverage limit" card. An excess is what the household pays,
 *      so it is said in the answer's own words.
 * The pure checks always run. The real chat (the deterministic stand-in model, no network) also runs when a disposable
 * database is set.
 *   npm run -s chat:walkthrough-uk-test   (DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... adds the database checks) */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
Object.assign(process.env, { DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e", E2E_RUN_ID: "walkuk", MODEL_PRESET: "gemini", GEMINI_API_KEY: "ci" });
delete process.env.DEARPOLICY_BENEFIT_TABLE;
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { questionTopics } = await import("@/lib/chat/policy-answer");
  const { PREMIUM_ROW } = await import("@/lib/chat/answer-verification");
  const { withoutCorrectedPerson } = await import("@/lib/chat/workflow");
  const keys = (q: string) => questionTopics(q).map((t) => t.key);

  await test("'how much do we pay for insurance each month?' is a premium question", () => {
    assert.ok(keys("How much do we pay for insurance each month?").includes("premium"), JSON.stringify(keys("How much do we pay for insurance each month?")));
    assert.ok(keys("how much do I pay for cover a year?").includes("premium"));
  });
  await test("a word that only names a plan still names it ('the excess on our travel insurance' is about the excess)", () => {
    assert.deepEqual(keys("What's the excess on our travel insurance?"), ["excess"]);
    assert.ok(keys("What is the deductible on my hospital insurance?").includes("cost_sharing"));
  });

  await test("a subscription or contribution row is the payment; a row that only mentions one is not", () => {
    for (const row of ["Monthly subscription £148.60", "Monthly contribution £41.20", "Annual contribution RM1,200.00", "Contribution payable S$85.00", "Takaful contribution RM96.50", "Annual premium £96.00"])
      assert.ok(PREMIUM_ROW.test(row), row);
    for (const row of ["Out-patient consultations up to £1,000 per member per year", "Employer contribution to your pension 5%", "Hospital cash £100 per night", "Subscription to our newsletter is free"])
      assert.ok(!PREMIUM_ROW.test(row), row);
  });

  const fam = [["Amara Okafor", "self"], ["Tom Bennett", "spouse"], ["Ada Bennett", "child"], ["Joe Bennett", "child"]].map(([n, r], i) => ({ id: "p" + i, display_name: n, preferred_name: null, relationship: r }));
  await test("a correction is read without the person it says it is not", () => {
    assert.equal(withoutCorrectedPerson("Sorry, it was Joe, not Ada.", fam), "Sorry, it was Joe.");
    assert.equal(withoutCorrectedPerson("I meant Joe not Ada", fam), "I meant Joe");
    assert.equal(withoutCorrectedPerson("Not Ada, Joe", fam), "Joe");
  });
  await test("any other 'not' is left alone", () => {
    for (const m of ["Joe is not covered?", "It was not Ada's fault", "Ada broke her arm, not her leg", "sorry, not Ada"]) assert.equal(withoutCorrectedPerson(m, fam), m);
  });

  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB === "1" && /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    const { query } = await import("@/lib/db/client");
    const { askContextualDearPolicy } = await import("@/lib/chat/workflow");
    const { enqueueChat, processChatAnalysisJob } = await import("@/lib/chat/jobs");
    const A = randomUUID();
    try {
      await query("INSERT INTO accounts(id,name) VALUES($1,'Test household UK walkthrough')", [A]);
      const ids: Record<string, string> = {};
      for (const [n, r] of [["Amara Okafor", "self"], ["Tom Bennett", "spouse"], ["Ada Bennett", "child"], ["Joe Bennett", "child"]])
        ids[n] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [A, n, r])).rows[0].id;
      const doc = async (owner: string, people: string[], insurer: string, product: string, number: string, type: string, page: string, premium: [number, string]) => {
        const id = randomUUID();
        await query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status,file_hash,benefits_indexed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,'personal_schedule',true,95,'ready',$8,$8,'scan_clean',$9,now())`, [id, A, ids[owner], insurer, product, number, type, `${id}.pdf`, "sha256:" + id]);
        for (const p of people) await query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [id, ids[p], A]);
        await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [A, id, page]);
        await query("INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,product_name,policy_number,amount,currency,frequency,source_document_id,source_page) VALUES($1,$2,$3,$4,$5,$6,$7,'GBP',$8,$2,1)",
          [A, id, ids[owner], insurer, product, number, premium[0], premium[1]]);
      };
      const all = ["Amara Okafor", "Tom Bennett", "Ada Bennett", "Joe Bennett"];
      await doc("Amara Okafor", ["Amara Okafor"], "Example Life plc", "Level Term Life", "TL 0098", "Life", "Policy schedule\nLife assured: Amara Okafor\nLife cover (level)\t£250,000.00\nMonthly premium\t£32.18", [32.18, "monthly"]);
      await doc("Amara Okafor", all, "Example Health Ltd", "Family Health", "HH-552", "Health", "Membership certificate\nMembers: Amara Okafor, Tom Bennett, Ada Bennett, Joe Bennett\nIn-patient treatment\tFull cover\nMonthly subscription\t£148.60", [148.6, "monthly"]);
      await doc("Tom Bennett", ["Tom Bennett"], "Example Mutual Friendly Society", "Income Protection", "KM/IP/77", "Disability", "Income Protection schedule\nMember: Tom Bennett\nMonthly benefit\t£2,400\nMonthly contribution\t£41.20", [41.2, "monthly"]);
      const ask = (question: string, conversationId?: string) => askContextualDearPolicy({ accountId: A, familyMemberId: null, scope: "family", question, ...(conversationId ? { conversationId } : {}) });

      await test("database: the household's monthly total is answered, with subscription and contribution rows counted", async () => {
        const r = await ask("How much do we pay for insurance each month?");
        const text = [r.answer.summary, ...(r.answer.details ?? [])].join("\n");
        assert.match(text, /£221\.98 a month/, text);
        assert.doesNotMatch(text, /left out an amount/);
      });

      await test("database: 'the excess on our health insurance' is the health plan's, said in words, never a coverage-limit card", async () => {
        await doc("Amara Okafor", all, "Example Travel Ltd", "Annual Multi-Trip", "PT-300", "Travel", "Annual multi-trip\nInsured: Amara Okafor, Tom Bennett, Ada Bennett, Joe Bennett\nEmergency medical expenses\t£10,000,000\nExcess\t£75 per person per claim\nAnnual premium\t£96.00", [96, "annual"]);
        await query("UPDATE policy_pages SET text=text||$2 WHERE account_id=$1 AND text LIKE 'Membership certificate%'", [A, "\nExcess\t£250 per member per year"]);
        // As intake records it: the health plan's in-patient line is hospital cover.
        await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,confirmed,evidence_verified,evidence_text)
          SELECT $1,p.id,pm.family_member_id,'Hospitalisation',NULL,'GBP',p.product_name,1,true,true,'In-patient treatment	Full cover' FROM policies p JOIN policy_members pm ON pm.policy_id=p.id WHERE p.account_id=$1 AND p.product_name='Family Health'`, [A]);
        const r = await ask("What's the excess on our health insurance?");
        const text = [r.answer.summary, ...(r.answer.details ?? [])].join("\n");
        assert.match(text, /£250 per member per year/, text);
        assert.doesNotMatch(text, /£75/, "the travel plan's excess is not the health plan's");
        assert.deepEqual((r.answer.policyStatedLimits ?? []).map((l) => l.amountText), []);
      });

      await test("database: 'Sorry, it was Joe, not Ada' moves the open claim to Joe, through the background job", async () => {
        const first = await ask("Ada broke her arm on a school trip in France. Can we claim?");
        const conv = first.answer.conversationId;
        assert.ok(conv, "the claim has a chat");
        const before = (await query<{ intent: string }>("SELECT state->>'intent' AS intent FROM chat_conversations WHERE id=$1", [conv])).rows[0];
        assert.equal(before.intent, "claim");
        const queued = await enqueueChat({ accountId: A, familyMemberId: null, scope: "family", question: "Sorry, it was Joe, not Ada.", conversationId: conv });
        await processChatAnalysisJob({ id: randomUUID(), account_id: A, payload: { chatJobId: queued.jobId }, lease_owner: null, attempt_count: 1, max_attempts: 3 } as never);
        const joe = (await query<{ intent: string; claim: string | null }>(
          "SELECT state->>'intent' AS intent,state->>'activeClaimQuery' AS claim FROM chat_conversations WHERE account_id=$1 AND family_member_id=$2 ORDER BY updated_at DESC LIMIT 1", [A, ids["Joe Bennett"]])).rows[0];
        assert.ok(joe, "Joe has the chat now");
        assert.equal(joe.intent, "claim");
        assert.match(joe.claim ?? "", /broke her arm/);
      });
    } finally {
      await query("DELETE FROM accounts WHERE id=$1", [A]).catch(() => undefined);
    }
  } else console.log("walkthrough UK: database checks skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run them)");

  await test("no request tried to leave this machine", () => assert.deepEqual(outbound, []));
  console.log(`walkthrough UK: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

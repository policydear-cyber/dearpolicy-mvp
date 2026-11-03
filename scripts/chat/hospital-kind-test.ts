/** New-user walkthrough, round 5 (3 Nov): a hospital plan whose name doesn't say "hospital" ("VitalCare Family",
 * stored as Medical; "Heron Family Care", stored as Health) is still the household's hospital plan, for any household.
 *   1. On main, "What does our hospital plan pay for a hospital stay?" got "Your family has no hospital policy on file"
 *      while the plan was on file: the check read only the plan's name and stored lines.
 *   2. "What's the excess on our hospital plan?" mixed in the travel plan's excess: the hospital plan was no plan of the
 *      kind asked, so every plan was in scope.
 *   3. Once found, its "Excess €250" row showed on a "Policy-stated coverage limit" card. An excess, deductible or
 *      co-payment is what the household pays, whatever the topic of the answer.
 * The plan's kind comes from the same closed list of stored types and names as #296 (lib/chat/plan-kinds.ts).
 * The pure checks always run; the real chat (deterministic stand-in model, no network) runs with a disposable database.
 *   npm run -s chat:hospital-kind-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
Object.assign(process.env, { DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e", E2E_RUN_ID: "hospkind", MODEL_PRESET: "gemini", GEMINI_API_KEY: "ci" });
delete process.env.DEARPOLICY_BENEFIT_TABLE;
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { planKind } = await import("@/lib/chat/plan-kinds");
  await test("a plan stored as Health, Medical, Hospitalisation or Perubatan is a health plan, whatever its name", () => {
    for (const [product, type] of [["Heron Family Care", "Health"], ["VitalCare Family", "Medical"], ["MyCare Plus", "Hospitalisation"], ["Pelan Prima", "Perubatan"], ["Premier Care", "Hospital and Surgical"]])
      assert.equal(planKind({ product, type }), "health", product);
    // A name that says another kind wins nothing: it is neither kind.
    for (const [product, type] of [["Early Critical Protector", "Health"], ["Hospital Cash Plus", "Medical"], ["Accident Care", "Medical"]])
      assert.equal(planKind({ product, type }), "other", product);
  });

  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB === "1" && /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    const { query } = await import("@/lib/db/client");
    const { askContextualDearPolicy } = await import("@/lib/chat/workflow");
    const A = randomUUID();
    try {
      await query("INSERT INTO accounts(id,name) VALUES($1,'Test household hospital kinds')", [A]);
      const ids: Record<string, string> = {};
      for (const [n, r] of [["Aoife Byrne", "self"], ["Cian Byrne", "spouse"]])
        ids[n] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [A, n, r])).rows[0].id;
      const doc = async (product: string, type: string, page: string) => {
        const id = randomUUID();
        await query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status,file_hash,benefits_indexed_at)
          VALUES($1,$2,$3,'Example Assurance DAC',$4,'EX-1',$5,'personal_schedule',true,95,'ready',$6,$6,'scan_clean',$7,now())`, [id, A, ids["Aoife Byrne"], product, type, `${id}.pdf`, "sha256:" + id]);
        for (const p of Object.values(ids)) await query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [id, p, A]);
        await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [A, id, page]);
      };
      await doc("Wanderlust Annual", "Travel", "Wanderlust Annual - certificate\nEmergency medical expenses\t€5,000,000\nHospital benefit abroad\t€50 per day\nExcess\t€75 per claim");
      await doc("Accident Guard", "Personal Accident", "Accident Guard schedule\nAccidental death\t€100,000\nHospital income after an accident\t€100 per day");
      await doc("VitalCare Family", "Medical", "VitalCare Family - membership certificate\nIn-patient and day-patient treatment\tFull cover\nOut-patient consultations\tUp to €1,000 per member per year\nExcess\t€250 per member per year");
      const ask = (question: string) => askContextualDearPolicy({ accountId: A, familyMemberId: null, scope: "family", question });
      const said = (r: Awaited<ReturnType<typeof ask>>) => [r.answer.summary, ...(r.answer.details ?? [])].join("\n");

      await test("database: the hospital plan is found when its name doesn't say so, and its excess is never a coverage-limit card", async () => {
        const r = await ask("What does our hospital plan pay for a hospital stay?");
        const text = said(r);
        assert.doesNotMatch(text, /no hospital policy on file/i, text);
        assert.match(text, /VitalCare Family — In-patient and day-patient treatment: Full cover/, text);
        assert.doesNotMatch(text, /Wanderlust|Accident Guard/, text);
        assert.deepEqual((r.answer.policyStatedLimits ?? []).filter((l) => /excess|deductible|co-?pay/i.test(l.benefitTitle)).map((l) => l.amountText), [], text);
      });
      await test("database: 'the excess on our hospital plan' is the hospital plan's, never the travel plan's", async () => {
        const text = said(await ask("What is the excess on our hospital plan?"));
        assert.match(text, /€250 per member per year/, text);
        assert.doesNotMatch(text, /€75/, text);
      });
    } finally {
      await query("DELETE FROM accounts WHERE id=$1", [A]).catch(() => undefined);
    }
  } else console.log("hospital kinds: database checks skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run them)");

  await test("no request tried to leave this machine", () => assert.deepEqual(outbound, []));
  console.log(`hospital kinds: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

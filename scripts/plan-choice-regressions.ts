/**
 * The Documents page's "Covers" picker asks which plan each covered person is on ("plan not chosen yet", "<name>'s
 * cover (which plan?)") only where the household's answers read that plan. A household whose Coverage and chat both
 * run on the benefit table never reads it, and the only manual step a household is asked for is which person(s) a
 * document is for, so it is not asked. Every other household is asked exactly as before. Made-up data only; no
 * database, no model call.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (error) { failed++; console.error(`not ok - ${name}\n  ${error instanceof Error ? error.message : String(error)}`); }
}

async function main() {
  const mod = await import("../lib/policies/plan-choice").catch((error: unknown) => {
    console.error(`not ok - lib/policies/plan-choice is missing (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`);
    return null;
  });
  if (!mod) { process.exitCode = 1; return; }
  const { planChoiceAsked, coversPlanPrompt } = mod;
  const { benefitTableEnabled } = await import("../lib/benefit-table/flag");
  const { simpleChatEnabled } = await import("../lib/simple-chat/flag");

  const tiers = ["Employee", "Spouse", "Child"];
  // Lim Ah Kow has no plan stored; Tan Mei Ling has one.
  const covered = [{ name: "Lim Ah Kow", planTier: null }, { name: "Tan Mei Ling", planTier: "Spouse" }];

  await test("benefit-table household (table and simple chat on): no 'plan not chosen yet', no plan dropdown", () => {
    const planChoice = planChoiceAsked({ benefitTable: true, simpleChat: true });
    assert.equal(planChoice, false);
    assert.deepEqual(coversPlanPrompt({ tierOptions: tiers, covered, planChoice }), { planMissing: false, tierSelect: false });
  });

  await test("negative controls: any other household is asked exactly as before", () => {
    for (const flags of [{ benefitTable: false, simpleChat: false }, { benefitTable: true, simpleChat: false }, { benefitTable: false, simpleChat: true }]) {
      const planChoice = planChoiceAsked(flags);
      assert.equal(planChoice, true, JSON.stringify(flags));
      // The old rule: note when a document offers plans and someone covered has none; dropdown when it offers plans.
      assert.deepEqual(coversPlanPrompt({ tierOptions: tiers, covered, planChoice }), { planMissing: true, tierSelect: true });
      assert.deepEqual(coversPlanPrompt({ tierOptions: tiers, covered: [covered[1]], planChoice }), { planMissing: false, tierSelect: true }, "everyone has a plan: no note, dropdown stays");
      assert.deepEqual(coversPlanPrompt({ tierOptions: [], covered, planChoice }), { planMissing: false, tierSelect: false }, "a document with no plans asks nothing");
      assert.deepEqual(coversPlanPrompt({ tierOptions: tiers, covered: [], planChoice }), { planMissing: false, tierSelect: false }, "nobody covered: nothing to ask");
    }
  });

  await test("the flags come from the same switches the table and the simple chat use (made-up account)", () => {
    const account = "00000000-0000-4000-8000-0000000000aa";
    const both = { NODE_ENV: "test", DEARPOLICY_ALPHA_ACCOUNTS: account, DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_SIMPLE_CHAT: "1" } as NodeJS.ProcessEnv;
    const flags = (env: NodeJS.ProcessEnv, id: string) => ({ benefitTable: benefitTableEnabled(env, id), simpleChat: simpleChatEnabled(env, id) });
    assert.equal(planChoiceAsked(flags(both, account)), false);
    assert.equal(planChoiceAsked(flags(both, "00000000-0000-4000-8000-0000000000bb")), true, "an account outside the alpha keeps the question");
    assert.equal(planChoiceAsked(flags({ ...both, DEARPOLICY_SIMPLE_CHAT: "" }, account)), true, "older chat reads the plan: keeps the question");
    assert.equal(planChoiceAsked(flags({ ...both, DEARPOLICY_BENEFIT_TABLE: "" }, account)), true, "ledger Coverage reads the plan: keeps the question");
  });

  await test("decided server-side by GET /api/policies and used by the page; the client imports no server module for it", () => {
    const route = read("app/api/policies/route.ts");
    assert.match(route, /benefitTableLive\(ctx\.householdId\)/);
    assert.match(route, /simpleChatEnabled\(process\.env, ctx\.householdId\)/);
    assert.match(route, /planChoice,\n/);
    const page = read("app/policies/page.tsx");
    assert.match(page, /import \{ coversPlanPrompt \} from "@\/lib\/policies\/plan-choice";/);
    assert.match(page, /setPlanChoice\(p\.planChoice !== false\)/);
    assert.match(page, /coversPlanPrompt\(\{ tierOptions: tiers, covered, planChoice \}\)/);
    assert.match(page, /\{tierSelect && <div className="covers-list">/);
    assert.doesNotMatch(page, /tiers\.length > 0 && covered\.some/, "the note is not gated on tiers alone any more");
    assert.doesNotMatch(read("lib/policies/plan-choice.ts"), /^import /m, "the shared helper stays import-free (client-safe)");
  });

  await test("premise: the benefit table and the simple chat never read the stored plan", () => {
    // If either starts reading policy_members.benefit_tier, the plan changes what a benefit-table household sees and
    // planChoiceAsked must ask again.
    const files: string[] = [];
    const walk = (dir: string) => { for (const f of readdirSync(path.join(root, dir))) { const p = path.join(dir, f); if (statSync(path.join(root, p)).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p); } };
    walk("lib/benefit-table"); walk("lib/simple-chat");
    files.push("components/benefit-table-coverage.tsx");
    for (const f of files) assert.doesNotMatch(read(f), /benefit_tier|planTier|loadMemberTiers|selectTierRows|tierApplies/, f);
  });

  if (failed) { console.error(`${failed} failed`); process.exitCode = 1; } else console.log("plan-choice: all passed");
}
void main();

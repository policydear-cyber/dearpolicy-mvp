/**
 * DC, 31 Oct: ignore every expiry and end date; every policy on file is treated as in force. A printed end date that has
 * passed never makes an answer say a policy "expired", "ended" or is "no longer in force". Only a document that itself
 * prints a lapse ("Your policy lapsed on …") is said to have lapsed. An older document is dated, never doubted ("not confirmed
 * current"), and a passed end date gives no countdown ("-27 days"). Made-up documents in S$, RM and £; pure.
 *   npm run chat:no-expiry-wording-test
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (() => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failed: string[] = [];
const t = (name: string, fn: () => void) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };

async function main() {
  const { printedStatus, statusSentence, inactiveList, countdownLine } = await import("@/lib/chat/policy-status");
  const today = "2026-10-31";
  const past = [
    [{ page: 1, text: "Wanderlust Single Trip (fictitious)\nPeriod of insurance 1 December 2025 to 14 December 2025\nInsured: Tan Mei Ling" }], // S$ travel, over
    [{ page: 2, text: "Lindung Keluarga (fictitious)\nPolicy term 1 January 2024 to 31 December 2025\nSum assured RM200,000" }], // RM, past term
    [{ page: 1, text: "Thames Home (fictitious)\nPeriod of cover 3 March 2025 to 2 March 2026\nBuildings £350,000" }], // £, past year
  ];
  t("a printed period that has passed is in force, never ended or expired", () => {
    for (const pages of past) {
      const s = printedStatus(pages, null, today);
      assert.equal(s.state, "in_force", JSON.stringify(s));
      assert.equal(statusSentence("This policy", s), null);
    }
  });
  t("a stored expiry date in the past does not make a policy ended either", () => {
    assert.notEqual(printedStatus([{ page: 1, text: "Schedule\nSum assured S$500,000" }], "2025-06-30", today).state as string, "ended");
  });
  t("a printed lapse is still said, from the document's own words", () => {
    const s = printedStatus([{ page: 1, text: "Dear Ms Tan,\nYour policy lapsed on 17 March 2026 because the premium was not paid." }], null, today);
    assert.equal(s.state, "lapsed");
    assert.match(statusSentence("AssureTerm 65", s) ?? "", /lapsed on 17 March 2026/);
    assert.equal(inactiveList([{ name: "AssureTerm 65", status: s }]), "AssureTerm 65 (lapsed on 17 March 2026)");
  });
  t("'how many days left?' on a printed period that has passed gives no countdown and no 'ended'", () => {
    for (const [pages, name] of [[past[0], "Wanderlust Single Trip"], [past[1], "Lindung Keluarga"], [past[2], "Thames Home"]] as const) {
      const s = printedStatus(pages, null, today);
      const said = countdownLine(name, s, today) ?? "";
      assert.ok(said, name + ": the printed end date is read");
      assert.doesNotMatch(said, /-\d|\b(?:ended|expired|ago|no longer)\b/i, said);
      assert.match(said, /printed period runs to/);
    }
    assert.equal(countdownLine("AcmeTravel", { state: "in_force", date: "2026-10-04", printed: "4 October 2026" }, today), "AcmeTravel’s printed period runs to 4 October 2026.");
  });
  t("control: a future end date still counts the days, and today is said as today", () => {
    assert.equal(countdownLine("Harbour Shield", { state: "in_force", date: "2026-11-30", printed: "30 November 2026" }, today), "Harbour Shield ends on 30 November 2026 — 30 days from today.");
    assert.equal(countdownLine("Harbour Shield", { state: "in_force", date: today, printed: "31 October 2026" }, today), "Harbour Shield ends today, 31 October 2026 (0 days left).");
  });
  t("no chat module or source list writes a date- or age-based 'expired on', 'no longer covers anyone', 'not confirmed current' or 'may not reflect the current terms'", () => {
    const dir = "lib/chat";
    const bad = /expired on|no longer covers anyone|"ended on "|", which ended on "|"ended on " \+ st\.printed|not confirmed current"|may not reflect the current terms|confirm the policy is current|does not confirm cover today/;
    const files = [...readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => join(dir, f)), "components/source-list.tsx"];
    const hits = files.flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => [f + ":" + (i + 1), l] as const))
      .filter(([, l]) => bad.test(l) && !/^\s*(?:\/?\*|\/\/)/.test(l));
    assert.deepEqual(hits.map(([w]) => w), []);
  });
  console.log(`\nno expiry wording: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

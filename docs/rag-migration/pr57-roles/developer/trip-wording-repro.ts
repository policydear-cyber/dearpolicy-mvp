/**
 * Critic R25-1 / Evidence Reviewer 17 regression: a trip schedule's printed period and destination are listed beside the amount, and the
 * household's own words never turn them into a conclusion -- no "does not fit", no ruled-out verdict, nothing in conditions[] or the bottom
 * line -- whatever place or date the message names. Real chat route, anonymised livelib household, the L2 scripted moves (no spend).
 * Developer-owned scratch, not a registered test.
 *   node --import tsx docs/rag-migration/pr57-roles/developer/trip-wording-repro.ts
 */
import { setEnv, startHarness } from "../../../../scripts/fixtures/rag2-loop/harness";
import * as LL from "../../../../scripts/fixtures/rag2-livelib/household";
import { LIVELIB_SCENARIOS } from "../../../../scripts/fixtures/rag2-livelib/conversations";
import { ScriptedLoopModel } from "@/lib/rag2/loop/scripted-model";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const CASES = [
  "Hypothetically, Adrian died in a car accident in Tokyo. What can I do?",
  "Adrian broke his leg in March. What can I do?",
  "Adrian died in a car accident on 12/03/2025 in Japan, I just found the policy. What can I do?",
  "Adrian was admitted in Singapore after flying home from Japan. What can I do?",
  "Adrian was hurt in Bali. What can I do?",
];
const CONCLUSION = /\bdoes(?:n['’]t| not) (?:fit|cover|apply)\b|\bnot an amount for\b|\boutside (?:the|its) (?:period|trip|dates)\b|\bended\b|\bnot (?:Japan|Indonesia)\b/i;
async function main() {
  setEnv(LL as any);
  const h = await startHarness(LL as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const L2 = LIVELIB_SCENARIOS.find((s) => s.id === "L2")! as any;
  let failed = 0;
  for (const msg of CASES) {
    installLoopModel(new ScriptedLoopModel([{ steps: L2.turns[0].steps }]));
    try {
      const a: any = await h.send(msg, {});
      const texts = [a.summary, ...(a.details ?? []), a.bottomLine ?? "", ...(a.statements ?? []).flatMap((s: any) => [s.text, ...(s.conditions ?? [])])];
      const bad = texts.filter((t: string) => CONCLUSION.test(t ?? ""));
      const trip = [a.summary, ...(a.details ?? [])].find((t: string) => /Single Trip/.test(t));
      console.log(`${bad.length ? "FAIL" : "PASS"} ${JSON.stringify(msg)}: no conclusion from the household's place or date words${bad.length ? `\n  ${bad.join("\n  ")}` : ""}\n  trip: ${trip ? trip.slice(trip.indexOf("The schedule prints")) : "(no trip paragraph)"}\n  bottom line: ${a.bottomLine ?? "(none)"}`);
      if (bad.length) failed++;
    } finally { installLoopModel(null); }
  }
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

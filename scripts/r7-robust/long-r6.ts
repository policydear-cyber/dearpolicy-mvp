/**
 * Round 7: three 30-turn conversations on the Round 6 household (questions,
 * a claim started then abandoned, corrections, people switched, pronouns),
 * run with the deterministic model and with the hostile one. Cross-turn
 * checks: answers stay bounded, caveats do not pile up, the same question is
 * not answered longer each time, and a dropped claim's question never comes
 * back. Every turn is timed.
 */
import type { ChatAnswer } from "@/types";

const HONEST_UNAVAILABLE = /couldn[’']t read your message just now|ran out of room part-way through reading it|couldn[’']t put that answer together properly|couldn[’']t be read just now/i;
const CAVEAT = /not a promise of payment|insurer decides|not recently verified|incomplete review|does not estimate|not an estimate|not yet confirmed|master policy|confirm with/i;
const MAX_VISIBLE = 6000;

export async function longR6(args: { seeds: number[]; log: (...a: unknown[]) => void }): Promise<{ failures: string[]; ms: number[] }> {
  const failures: string[] = [];
  const msAll: number[] = [];
  const { detect, visibleFields, moneyIn } = await import("./detect");
  const guard = await import("@/lib/chat/output-guard");
  const F = await import("../r6/fixture");
  const h = await F.buildHousehold();
  const { runConversations } = await import("./r6-runner");
  const { longConversations } = await import("./long-conversations");
  const convs = longConversations();
  for (const c of convs) if ((c.turns?.length ?? 0) < 30) failures.push("long r6: " + c.name + " has fewer than 30 turns");
  const visible = (a: ChatAnswer) => visibleFields(a).filter((f) => !/^citation/.test(f.where)).map((f) => f.text).join("\n");
  const modes = ["deterministic", ...args.seeds.map((s) => "chaos-" + s)];
  for (const mode of modes) {
    await h.db.query("DELETE FROM policy_analysis_cache").catch(() => undefined);
    process.env.DEARPOLICY_DETERMINISTIC_MODEL = mode === "deterministic" ? "synthetic-e2e" : mode;
    guard.guardInterventions.length = 0;
    const fuzzing = mode !== "deterministic";
    const { records } = await runConversations({ h, F, conversations: convs, detect, visibleFields, moneyIn, dump: process.env.R7R_DUMP_R6,
      // Under the hostile model a reading that came back empty is answered
      // with the hedged "not found so far, which isn't a finding that it's
      // missing" -- honest, so not a missed mention.
      excuseMissingMention: fuzzing ? (a) => HONEST_UNAVAILABLE.test(a.summary) || /isn[’']t a finding that it[’']s missing/.test(a.summary) : undefined });
    for (const r of records) msAll.push(r.ms);
    for (const c of convs) {
      const recs = records.filter((r) => r.conv === c.name).sort((x, y) => x.turn - y.turn);
      if (recs.length !== c.turns!.length) recs.at(-1)?.hits.push({ rule: "conversation stopped early", text: recs.length + " of " + c.turns!.length + " turns answered" });
      const claimTurns = new Set(c.claimTurns ?? []);
      const lastClaim = Math.max(-1, ...claimTurns);
      const sizeOf = new Map<string, number>();
      for (const r of recs) {
        const a = r.answer; if (!a) continue;
        const text = visible(a);
        if (text.length > MAX_VISIBLE) r.hits.push({ rule: "answer too long", text: text.length + " visible characters" });
        if (a.details.length > 40) r.hits.push({ rule: "answer too long", text: a.details.length + " detail lines" });
        const caveats = text.split(/(?<=[.!?])\s+/).filter((s) => CAVEAT.test(s));
        if (caveats.length > 4) r.hits.push({ rule: "caveats piling up", text: caveats.length + " caveat sentences" });
        const key = r.question.trim().toLowerCase();
        if (sizeOf.has(key) && text.length > sizeOf.get(key)! * 1.25 + 200) r.hits.push({ rule: "same question answered longer each time", text: sizeOf.get(key) + " -> " + text.length + " characters" });
        if (!sizeOf.has(key)) sizeOf.set(key, text.length);
        const dropped = c.abandonedAfter !== undefined ? r.turn > c.abandonedAfter : r.turn > lastClaim && lastClaim >= 0;
        if (dropped && !claimTurns.has(r.turn)) {
          const asked = [...(a.questions ?? []).filter((q) => q.id !== "claim_person").map((q) => q.text), ...(a.factFinding ?? []).flatMap((p) => p.nextQuestions.map((q) => q.text))];
          if (asked.length) r.hits.push({ rule: "stale claim question resurfaced", text: asked[0] });
          if (/\bThanks, noted\b|one more detail|what I need for now/i.test(a.summary)) r.hits.push({ rule: "stale claim question resurfaced", text: a.summary.slice(0, 200) });
        }
      }
    }
    const failing = records.filter((r) => r.hits.filter((x) => x.rule !== "slow response").length);
    for (const r of failing) failures.push(`long r6 [${mode}] ${r.conv} #${r.turn} «${r.question.slice(0, 80)}»: ` + r.hits.map((x) => x.rule + ": " + x.text.slice(0, 160)).join(" | "));
    if (!fuzzing && guard.guardInterventions.length) failures.push("long r6: the output guard acted on the deterministic model");
    args.log(`long r6 [${mode}]: ${records.length} turns, ${failing.length} with hits`);
  }
  process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
  await h.db.close();
  return { failures, ms: msAll };
}

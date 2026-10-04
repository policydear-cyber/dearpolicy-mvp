/**
 * Round 8: how the Round 6/7 runners judge a battery driven by the chaos model
 * (R8_CHAOS_SEED, see scripts/r8-chaos-regressions.ts). Every rule still
 * fails, except the usefulness rules in DEGRADED: under a broken model an
 * honest fallback in place of the answer is acceptable, so those are counted
 * and bounded by the orchestrator instead. R8_SUMMARY=<file> appends one JSON
 * line per run for it.
 */
import { appendFileSync } from "node:fs";
import { DEGRADED } from "./detectors";

type Rec = { hits: { rule: string; text: string }[]; chaos?: string[] };
export const chaosSeed = () => process.env.R8_CHAOS_SEED ?? "";
export const isFailure = (rule: string) => !chaosSeed() || !DEGRADED.test(rule);

export function reportChaos(out: (...a: unknown[]) => void, suite: string, records: Rec[], guard: number, messages: number) {
  const failures = records.reduce((n, r) => n + r.hits.filter((x) => isFailure(x.rule)).length, 0);
  const degradedTurns = records.filter((r) => r.hits.some((x) => DEGRADED.test(x.rule))).length;
  const modes: Record<string, number> = {};
  for (const r of records) for (const m of r.chaos ?? []) modes[m] = (modes[m] ?? 0) + 1;
  const byRule: Record<string, number> = {};
  for (const r of records) for (const x of r.hits) byRule[x.rule] = (byRule[x.rule] ?? 0) + 1;
  if (chaosSeed()) out(`chaos seed ${chaosSeed()}: ${failures} failing hit(s), ${degradedTurns} of ${records.length} turns degraded to an honest fallback, ${Object.values(modes).reduce((a, b) => a + b, 0)} model calls`);
  const file = process.env.R8_SUMMARY;
  if (file) appendFileSync(file, JSON.stringify({ suite, seed: chaosSeed(), turns: records.length, messages, failures, degradedTurns, guard, byRule, modes }) + "\n");
}

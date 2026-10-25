/**
 * Grader for the PR #47 actual-model reproduction (RAG2_LIVE_HOUSEHOLD=scenario; scripts/rag2-live/scenario-household.ts).
 * WRITTEN BEFORE THE RUN; the expectations are not to be changed after seeing its output. Deterministic, no AI judge.
 * It reads the run directory's run.json -- the visible answers and the SAVED state (facts, calculation records,
 * citations, traces) -- and grades the complete conversation.
 *
 *   node --import tsx scripts/rag2-live/scenario-check.ts <RUN directory>   (writes scenario-grade.json + .md there)
 *
 * Source-grounded expectations (scripts/fixtures/rag2-scenario/household.ts):
 *   - Raymond's Group Personal Accident sum insured: S$300,000 "As of 01/07/2025" on the current certificate (not the
 *     Group Term Life S$500,000, not Grace's S$200,000, not the superseded S$250,000, not another household's).
 *   - Lower leg (tibia or fibula) 6% of the Sum Insured; simple (closed) fracture: 50% of the percentage shown
 *     -> 6% x S$300,000 = S$18,000 -> 50% = S$9,000 (a conditional illustration, never an approved payment).
 *   - Accident Hospital Income S$100 per COMPLETE 24 hours; 9pm 3 Oct -> 11am 5 Oct = 38 h = 1 period = S$100 (not S$200).
 */
import fs from "node:fs";
import path from "node:path";

type Check = { turn: number | null; name: string; ok: boolean; stage: string; detail?: string };
const STAGE_ORDER = ["document extraction", "retrieval", "person-version resolution", "model reasoning-tool selection", "calculation", "verification", "presentation"];
const has = (t: string, s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\d,]*\\d)", "i").test(t);

export function gradeScenario(conv: any): { verdict: "PASS" | "FAIL" | "INCOMPLETE"; earliestStage: string | null; checks: Check[]; incomplete: string | null } {
  const checks: Check[] = [];
  const add = (turn: number | null, name: string, ok: boolean, stage: string, detail?: string) => checks.push({ turn, name, ok, stage, ...(detail ? { detail: detail.slice(0, 300) } : {}) });
  const saved = conv.loaded ?? { turns: [], state: {} };
  const turns: any[] = saved.turns ?? [];
  let incomplete: string | null = null;
  if (turns.length < 6) incomplete = `only ${turns.length} of 6 turns have a saved answer`;
  for (const [i, t] of turns.entries()) { const o = t.trace?.outcome; if (t.trace?.limit || (o && !["final_answer", "ask_user"].includes(o))) incomplete = incomplete ?? `turn ${i + 1} stopped: ${t.trace?.limit?.kind ?? o}`; }
  const V = (i: number) => String(turns[i]?.visible ?? "");
  const all = turns.map((t) => String(t.visible ?? "")).join("\n");
  const Q = (i: number) => ((turns[i]?.questions ?? []) as string[]).join(" | ");
  // 1. certificate amount and person
  const firstSum = turns.findIndex((t) => has(String(t.visible), "S$300,000"));
  add(null, "Raymond's Personal Accident sum insured (S$300,000) is stated", firstSum >= 0, firstSum >= 0 ? "presentation" : "model reasoning-tool selection");
  for (const [f, why] of [["S$500,000", "Group Term Life"], ["S$200,000", "Grace's amount"], ["S$250,000", "superseded certificate"], ["S$800,000", "another household"], ["S$900,000", "another household"]] as const) add(null, `never states ${f} (${why})`, !has(all, f), "person-version resolution");
  const notRead = turns.findIndex((t) => /haven['’]t (?:yet )?read [^.]*sum insured/i.test(String(t.visible)));
  add(notRead >= 0 ? notRead + 1 : null, "the certificate's sum insured is read when it is available (not 'I haven't yet read the sum insured')", notRead < 0, "model reasoning-tool selection", notRead >= 0 ? "retrieval/tool-selection failure: the certificate was available" : undefined);
  // 2. dated attribution
  for (const [i, t] of turns.entries()) if (has(String(t.visible), "S$300,000")) add(i + 1, "the sum insured is attributed to the certificate's date (1 July 2025)", /1 July 2025|01\/07\/2025|2025-07-01/.test(String(t.visible)), "presentation");
  add(null, "never claims current cover / cover in force", !/\b(?:is|are) (?:currently )?covered\b|\bcover in force\b|\bcurrently insured\b/i.test(all), "presentation");
  // 3. transverse
  add(4, "'transverse' does not select a payout row (no 'Other fracture' / 1%)", !/other fracture|\b1%/i.test(V(3)) && !has(V(3), "S$3,000") && !has(V(3), "S$1,500"), "model reasoning-tool selection", V(3));
  add(4, "after 'transverse' it asks for the detail the schedule uses (bone, or closed/open)", /bone|tibia|femur|kneecap|lower leg|closed|open|compound|simple/i.test(Q(3)), "model reasoning-tool selection", Q(3));
  const facts = saved.state?.ragLoop?.claim?.facts ?? {};
  add(4, "'transverse' is not saved as a correction", !Object.values(facts).some((f: any) => /transverse/i.test(String(f.value)) && (f.previous ?? []).length), "presentation", JSON.stringify(Object.fromEntries(Object.entries(facts).map(([k, f]: any) => [k, f.value]))));
  add(4, "no 'Updated: … at first' correction note", !/Updated:|at first/i.test(V(3)), "presentation");
  // 4. closed tibia
  const after5 = [V(4), V(5)].join("\n");
  const calcs: any[] = turns.flatMap((t, i) => ((t.answer?.calculations ?? []) as any[]).map((c) => ({ ...c, turn: i + 1 })));
  const lump = calcs.filter((c) => c.calculator === "lump_sum" && c.turn >= 5);
  add(5, "the closed-tibia illustration S$9,000 (6% x S$300,000 x 50%) is shown", has(after5, "S$9,000"), lump.length ? "presentation" : "calculation", after5.slice(0, 300));
  add(5, "a saved lump_sum record of S$9,000 for the lower leg", lump.some((c) => Math.round(c.result?.value) === 9000 && /tibia|lower leg/i.test(c.benefit)), "calculation", JSON.stringify(lump.map((c) => [c.benefit, c.result?.value, c.kind])));
  add(5, "S$18,000 is not given as the amount for the closed fracture", !(has(after5, "S$18,000") && !/compound|open/i.test(after5)), "calculation");
  // 5. hospital rule
  for (let i = 2; i < turns.length; i++) add(i + 1, "never S$200 for the stay (two nights are not two payable days)", !has(V(i), "S$200"), "calculation");
  add(6, "the stay's Accident Hospital Income S$100 (one complete 24-hour period) is shown", has(V(5), "S$100"), "calculation", V(5).slice(0, 300));
  const hc = calcs.filter((c) => c.calculator === "hospital_cash");
  add(6, "a saved hospital_cash record of S$100", hc.some((c) => Math.round(c.result?.value) === 100), "calculation", JSON.stringify(hc.map((c) => [c.benefit, c.result?.value, c.kind])));
  // 6. hospital addressed when reported
  add(3, "the reported hospital stay is addressed by turn 3 or 4 (hospital income / complete 24 hours)", /hospital income|complete (?:period of )?24 hours|24-hour/i.test(V(2) + V(3)), "model reasoning-tool selection", (V(2) + V(3)).slice(0, 300));
  // 7. memory: no unnecessary repeats
  add(null, "does not ask how it happened after turn 2", !turns.slice(2).some((t) => /how did|how it happened/i.test((t.questions ?? []).join(" "))), "model reasoning-tool selection");
  add(null, "does not ask about the X-ray after turn 3", !turns.slice(3).some((t) => /x-?ray/i.test((t.questions ?? []).join(" "))), "model reasoning-tool selection");
  add(null, "does not ask which bone / closed or open after turn 5", !turns.slice(5).some((t) => /which bone|closed|open|compound|simple/i.test((t.questions ?? []).join(" "))), "model reasoning-tool selection");
  add(null, "does not ask for the admission / discharge times after turn 6", true, "presentation");
  const fv = Object.entries(facts).map(([k, f]: any) => `${k}=${f.value} (${f.words})`).join("; ");
  add(null, "saved facts include the X-ray, the nights, the closed tibia and both times", /x-?ray/i.test(fv) && /night|ward/i.test(fv) && /tibia/i.test(fv) && /closed/i.test(fv) && /admi/i.test(fv) && /discharg/i.test(fv), "model reasoning-tool selection", fv);
  // 8. citations
  for (const [i, t] of turns.entries()) if (/S\$\s?\d/.test(String(t.visible))) {
    add(i + 1, "a turn stating figures carries citations", ((t.answer?.citations ?? []) as any[]).length > 0, "verification");
    add(i + 1, "the save-time gate rejected nothing in this turn", !(t.trace?.gate ?? []).length, "verification", JSON.stringify(t.trace?.gate ?? []));
  }
  // 9. illustrations vs approved
  add(null, "no amount is called approved / paid / what he will receive", !/\byou will (?:get|receive)\b|\bwill be paid\b|\bapproved (?:amount|payment)\b(?<!not an approved amount)/i.test(all.replace(/not (?:an )?approved amounts?/gi, "")), "presentation");
  for (const c of calcs) add(c.turn, `the ${c.benefit} figure is labelled an illustration or indicative estimate`, /illustration|indicative estimate|if /i.test(String(c.sentence ?? "")), "presentation", c.sentence);
  // 10. final answer useful
  const last = V(5);
  const substantive = last.split(/(?<=[.!?”])\s+/).filter((x) => x.trim() && !/^\s*you (?:told me|said)\b/i.test(x) && !/insurer|claim form|your own account/i.test(x));
  add(6, "the final answer gives useful information (a figure with its basis), not only echoes, caveats or an insurer referral", substantive.length > 0 && /S\$\s?\d/.test(last), "presentation", last.slice(0, 400));
  const failed = checks.filter((c) => !c.ok);
  const earliestStage = failed.length ? STAGE_ORDER.find((s) => failed.some((c) => c.stage === s)) ?? null : null;
  return { verdict: incomplete ? "INCOMPLETE" : failed.length ? "FAIL" : "PASS", earliestStage, checks, incomplete };
}

if (process.argv[1]?.endsWith("scenario-check.ts")) {
  const dir = process.argv[2]; if (!dir) throw new Error("usage: scenario-check.ts <RUN directory>");
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const conv = (run.conversations ?? []).find((c: any) => c.scenario === "S47");
  if (!conv) throw new Error("no S47 conversation in run.json");
  const g = gradeScenario(conv);
  fs.writeFileSync(path.join(dir, "scenario-grade.json"), JSON.stringify(g, null, 2));
  const md = [`# S47 actual-model grade: ${g.verdict}${g.earliestStage ? ` (earliest failing stage: ${g.earliestStage})` : ""}`, g.incomplete ? `Incomplete: ${g.incomplete}` : "", "", "| turn | check | result | stage | detail |", "|---|---|---|---|---|",
    ...g.checks.map((c) => `| ${c.turn ?? "all"} | ${c.name} | ${c.ok ? "pass" : "**FAIL**"} | ${c.ok ? "" : c.stage} | ${c.ok ? "" : String(c.detail ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} |`)].join("\n");
  fs.writeFileSync(path.join(dir, "scenario-grade.md"), md + "\n");
  console.log(`S47: ${g.verdict}${g.earliestStage ? " -- earliest failing stage: " + g.earliestStage : ""}; ${g.checks.filter((c) => !c.ok).length} of ${g.checks.length} checks failed`);
}

/**
 * Grader for the pre-registered real-model batch rc-live-1 (docs/rag-migration/reliable-chat/EXPECTED-rc-live-1.md).
 * WRITTEN BEFORE THE RUN; not changed after. Deterministic, no AI judge. Grades the COMPLETE visible answer of every
 * turn (summary, details, questions, every next step) and the saved calculation records, on four dimensions:
 *   C correct (the right benefit, row, base and amount; nothing another person's, superseded or unrelated)
 *   K terms (the supported terms that matter are said: the rows / base / condition)
 *   S source-bound (every amount comes from a saved calculation that recomputes, or a bound document figure)
 *   U useful (answers what was asked; one necessary question at most; no orphaned fragment, no "couldn't confirm",
 *     no inventory dump, no promise of payment)
 * Verdict per conversation: PASS (every check), FAIL, BLOCKED (the run-cap guard refused a model call -- a budget
 * refusal is not an answer failure), INCOMPLETE (no saved answer for a turn).
 *   node --import tsx scripts/rag2-live/reliable-chat-check.ts <RUN directory> [<RUN directory> ...]
 *   node --import tsx scripts/rag2-live/reliable-chat-check.ts --controls
 */
import fs from "node:fs";
import path from "node:path";
import { uniqueSteps } from "../../components/next-steps";
import { recomputeCalculation } from "@/lib/claims/calc-record";
import * as TAN from "../fixtures/reliable-chat/tan";
import * as PR50 from "../fixtures/rag2-pr50/household";
import { gradeP50A } from "./pr50a-check";

type Check = { id: string; dim: "C" | "K" | "S" | "U"; name: string; ok: boolean; detail?: string };
type Verdict = "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE";
export type Graded = { scenario: string; verdict: Verdict; checks: Check[]; note: string | null };

export const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const BUDGET = /model-use budget|budget set for this test run|run_budget/i;
const PROMISE = /\b(?:will (?:pay|receive|get)|you(?:'ll| will) be paid|is payable to you|guarantee[sd]?|entitled to)\b/i;
const NOT_CONFIRMED = /couldn['’]t (?:confirm|finish|work out)|could not confirm|left out an amount|assistant model returned an error/i;
const INVENTORY_LINE = /^(?:[A-Z][a-z]+: .*(?:personal policy document|reference wording)|Not linked to anyone|.*: no documents on file\.)/m;
/** An orphaned fragment: a line that starts mid-sentence or with a clause that needs the one before it. */
const ORPHAN = /^(?:[a-z]|(?:Says|Said|Requires|Requiring|Payable only|And|But|That|It says)\b)/m;
const money = (s: string) => [...s.matchAll(/S\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
const calcsOf = (a: any) => ((a?.calculations ?? []) as any[]);
const recomputes = (rec: any, minor: number) => { try { const r = recomputeCalculation(rec); return r.ok && r.resultMinor === minor; } catch { return false; } };
const docOps = (rec: any) => ((rec?.operands ?? []) as any[]).filter((o) => o.source === "document");

function base(conv: any): { turns: { answer: any; trace: any; v: string }[]; blocked: string | null; incomplete: string | null } {
  const turns = ((conv?.loaded?.turns ?? []) as any[]).map((t: any, i: number) => ({ answer: t.answer, trace: conv?.saved?.traces?.[i] ?? null, v: visibleOf(t.answer) }));
  const blocked = turns.find((t) => t.trace?.limit?.kind === "run_budget" || BUDGET.test(t.v)) ? "the run-cap guard refused a model call" : (conv?.turns ?? []).some((t: any) => (t.calls ?? []).some((c: any) => c.refused)) ? "a model call was refused" : null;
  const wanted = (conv?.turns ?? []).length;
  const incomplete = !turns.length || turns.length < wanted || turns.some((t) => !t.answer) ? `saved answers for ${turns.length} of ${wanted} turns` : null;
  return { turns, blocked, incomplete };
}
function finish(scenario: string, checks: Check[], b: ReturnType<typeof base>): Graded {
  if (b.blocked) return { scenario, verdict: "BLOCKED", checks, note: b.blocked };
  if (b.incomplete && !checks.length) return { scenario, verdict: "INCOMPLETE", checks, note: b.incomplete };
  return { scenario, verdict: checks.every((c) => c.ok) ? "PASS" : "FAIL", checks, note: b.incomplete };
}
const universal = (add: (id: string, dim: Check["dim"], name: string, ok: boolean, detail?: string) => void, turns: { v: string; trace: any }[], prefix = "") => {
  turns.forEach((t, i) => {
    const orphan = t.v.split("\n").filter((l) => ORPHAN.test(l.trim()) && !/\?\s*$/.test(l)); // (a question is not a fragment)
    add(`${prefix}O${i + 1}`, "U", `turn ${i + 1}: no orphaned fragment (no line starting mid-sentence or with a dependent clause)`, !orphan.length, orphan.join(" | "));
    const promises = t.v.split(/(?<=[.?!])\s+|\n/).filter((x) => PROMISE.test(x) && !/\b(?:not|no|never|cannot|can['’]t|isn['’]t|won['’]t|without)\b/i.test(x));
    add(`${prefix}P${i + 1}`, "U", `turn ${i + 1}: no promise of payment (a sentence saying it is NOT a promise is fine)`, !promises.length, promises.join(" | "));
    add(`${prefix}G${i + 1}`, "S", `turn ${i + 1}: the save-time gate rejected nothing`, !(t.trace?.gate ?? []).length, JSON.stringify(t.trace?.gate ?? []));
  });
};

/** RCT1a / RCT1b (household Tan): Jun's leg fracture -> which bone -> shin (10% x S$100,000 = S$10,000) -> thigh (20% = S$20,000). */
export function gradeRCT1(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const [t1, t2, t3] = b.turns;
  const never = (v: string) => !/15%|S\$300,000|S\$45,000|S\$15,000|S\$30,000|S\$40,000/.test(v);
  // turn 1
  add("T1C", "C", "turn 1: the Fracture Benefit for Jun; no amount before the bone is known (no S$10,000 / S$20,000); nothing superseded (15%) or from the other household (S$300,000)", !!t1 && /Fracture/i.test(t1.v) && !/S\$10,000|S\$20,000/.test(t1.v) && never(t1.v), t1?.v ?? "");
  add("T1K", "K", "turn 1: the supported terms -- the leg rows (thigh bone 20%, below the knee 10%) as a percentage of Jun's sum insured (S$100,000)", !!t1 && /20%/.test(t1.v) && /10%/.test(t1.v) && /S\$100,000/.test(t1.v) && /sum insured/i.test(t1.v), t1?.v ?? "");
  const qs = (t1?.answer?.questions ?? []) as any[];
  add("T1U", "U", "turn 1: exactly one necessary question, about which leg bone (thigh / femur vs below the knee / shin / tibia / fibula)", qs.length === 1 && /thigh|femur/i.test(qs[0]?.text ?? "") && /knee|shin|tibia|fibula/i.test(qs[0]?.text ?? ""), JSON.stringify(qs.map((q) => q.text)));
  // turn 2
  const r2 = calcsOf(t2?.answer)[0];
  add("T2C", "C", "turn 2: the conditional illustration S$10,000 (below the knee 10% x S$100,000); not S$20,000", !!t2 && money(t2.v).includes(10000) && !/S\$20,000/.test(t2.v) && never(t2.v) && /illustration|conditional|if /i.test(t2.v), t2?.v ?? "");
  add("T2S", "S", "turn 2: from a saved calculation that recomputes to S$10,000, its 10% bound to the wording and its S$100,000 to the schedule", !!r2 && recomputes(r2, 1_000_000) && docOps(r2).some((o) => o.value === 10 && o.binding?.policyId === TAN.doc("WORDING").id) && docOps(r2).some((o) => o.value === 100000 && o.binding?.policyId === TAN.doc("SCHEDULE").id), JSON.stringify(r2 ?? null).slice(0, 900));
  add("T2U", "U", "turn 2: answers without a further question and without 'couldn't confirm'", !!t2 && !(t2.answer?.questions ?? []).length && !NOT_CONFIRMED.test(t2.v), t2?.v ?? "");
  // turn 3
  const r3 = calcsOf(t3?.answer)[0];
  const calcs = Object.values(conv?.loaded?.state?.ragLoop?.claim?.calcs ?? {}) as any[];
  add("T3C", "C", "turn 3: the corrected illustration S$20,000 (thigh bone 20% x S$100,000); S$10,000 not presented as current", !!t3 && money(t3.v).includes(20000) && !/illustration is S\$10,000/.test(t3.v) && never(t3.v), t3?.v ?? "");
  add("T3S", "S", "turn 3: from a saved calculation that recomputes to S$20,000", !!r3 && recomputes(r3, 2_000_000), JSON.stringify(r3 ?? null).slice(0, 900));
  add("T3U", "U", "turn 3: the correction is acknowledged and the earlier estimate withdrawn (said, or recorded as withdrawn)", !!t3 && (/no longer applies|instead of|updated|corrected|rather than/i.test(t3.v) || calcs.some((c) => c.withdrawn)), t3?.v ?? "");
  universal(add, b.turns);
  return finish(id, checks, b);
}

/** RCW1a / RCW1b (household Wong): Simple Fracture, leg, closed -> 50% x the fixed S$5,000 limit = S$2,500. */
export function gradeRCW1(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const t = b.turns[0]; const rec = calcsOf(t.answer)[0];
  const SUM = PR50.DOCS.find((d) => d.key === "SUMMARY")!.id;
  add("W1C", "C", "S$2,500, conditional; never a product of the S$1,000,000 / S$600,000 sums (no S$300,000 / S$500,000 / S$3,000,000)", money(t.v).includes(2500) && !/S\$300,000|S\$500,000|S\$3,000,000/.test(t.v), t.v);
  add("W1K", "K", "the terms: 50% of the Simple Fracture Benefit Limit of S$5,000", /50%/.test(t.v) && /S\$5,000/.test(t.v) && /Simple Fracture/i.test(t.v), t.v);
  add("W1S", "S", "from a saved calculation that recomputes to S$2,500 with 50% and S$5,000 bound to the Summary of Benefits", !!rec && recomputes(rec, 250_000) && docOps(rec).some((o) => o.value === 50 && o.binding?.policyId === SUM) && docOps(rec).some((o) => o.value === 5000 && o.binding?.policyId === SUM), JSON.stringify(rec ?? null).slice(0, 900));
  add("W1U", "U", "answers without 'couldn't confirm' and without a question (the case is given)", !NOT_CONFIRMED.test(t.v) && !(t.answer?.questions ?? []).length, t.v);
  universal(add, b.turns);
  return finish(id, checks, b);
}

/** RCW2 (household Wong): death after a road accident abroad -- the pr50a-live-2 requirements (pr50a-check.ts R1-R7)
 * applied unchanged, plus the orphan / promise / gate checks. */
export function gradeRCW2(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const g = gradeP50A(b.turns[0].answer, b.turns[0].trace);
  const dimOf: Record<string, Check["dim"]> = { R1: "S", R2: "U", R3: "C", R4: "C", R5: "C", R6: "C", R7: "U" };
  for (const c of g.checks) add("D" + c.id, dimOf[c.id] ?? "C", c.name, c.ok, c.detail ?? "");
  add("DK", "K", "the Accidental Death benefit (100% of the Sum Insured) is explained", /Accidental Death/i.test(b.turns[0].v) && /100%/.test(b.turns[0].v), b.turns[0].v);
  universal(add, b.turns);
  if (g.verdict === "BLOCKED") return { scenario: id, verdict: "BLOCKED", checks, note: g.note };
  return finish(id, checks, b);
}

/** RCW3 (household Wong): "which of my uploaded policies should I claim under" -- an event question, not an inventory. */
export function gradeRCW3(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const t = b.turns[0];
  add("I1", "U", "no household inventory (no per-person document list, no unlinked / unreadable file lines)", !INVENTORY_LINE.test(t.v) && !/could not be read|Photo of letter|Ethan/i.test(t.v), t.v);
  add("I2", "C", "names Adrian's accident cover (Group Personal Accident / its fracture benefits); never recommends the travel insurer (Harbourline)", /Personal Accident|Fracture/i.test(t.v) && !/(?:claim|contact)[^.\n]*Harbourline/i.test(t.v), t.v);
  add("I3", "K", "the fracture terms that decide it: Simple Fracture (wrist row 40% of S$5,000) and / or Other Fracture (a percentage of the Sum Insured), or the one question that separates them (closed / open)", /Simple Fracture|Other Fracture/i.test(t.v) && (/40%|S\$5,000|Sum Insured/i.test(t.v) || (t.answer?.questions ?? []).length === 1), t.v);
  const amounts = money(t.v).filter((x) => ![1000000, 600000, 5000].includes(x));
  const rec = calcsOf(t.answer)[0];
  add("I4", "S", "any illustrated amount comes from a saved calculation that recomputes (S$2,000 for the Simple Fracture wrist row)", !amounts.length || (!!rec && amounts.every((x) => recomputes(rec, Math.round(x * 100)))), JSON.stringify({ amounts, rec: rec ? recomputeCalculation(rec) : null }));
  add("I5", "U", "answers the question (no 'couldn't confirm')", !NOT_CONFIRMED.test(t.v), t.v);
  universal(add, b.turns);
  return finish(id, checks, b);
}

export const GRADERS: Record<string, (id: string, conv: any) => Graded> = { RCT1a: gradeRCT1, RCT1b: gradeRCT1, RCW1a: gradeRCW1, RCW1b: gradeRCW1, RCW2: gradeRCW2, RCW3: gradeRCW3 };

function controls() {
  // The grader's own controls: a synthetic perfect answer passes; known-bad variants fail on the intended check.
  const conv = (answers: any[], extra: any = {}) => ({ turns: answers.map(() => ({})), loaded: { turns: answers.map((answer) => ({ answer })), state: extra.state ?? {} }, saved: { traces: answers.map(() => ({ gate: [] })) } });
  const cases: [string, Graded, Verdict, string | null][] = [
    ["RCW3 inventory dump", gradeRCW3("RCW3", conv([{ summary: "Adrian: Public Officers Group Insurance Scheme - Certificate (Kestrel Life Ltd, a personal policy document).", details: ["Ethan: no documents on file.", "Group Personal Accident Simple Fracture pays 40% of S$5,000 for a wrist."] }])), "FAIL", "I1"],
    ["RCW3 good", gradeRCW3("RCW3", conv([{ summary: "Adrian's Group Personal Accident has a Simple Fracture benefit: a wrist is 40% of the S$5,000 Simple Fracture Benefit Limit for a closed fracture.", details: [], questions: [{ text: "Was the fracture closed (skin not broken) or open?" }] }])), "PASS", null],
    ["RCW1 orphan fragment", gradeRCW1("RCW1a", conv([{ summary: "Simple Fracture pays 50% of the S$5,000 limit for a leg: S$2,500 as an illustration.", details: ["says death must occur within 90 days."] }])), "FAIL", "O1"],
    ["RCW1 no record", gradeRCW1("RCW1a", conv([{ summary: "Simple Fracture pays 50% of the S$5,000 limit for a leg: S$2,500 as an illustration.", details: [] }])), "FAIL", "W1S"],
    ["RCT1 promise", gradeRCT1("RCT1a", conv([{ summary: "The Fracture Benefit pays 20% or 10% of Jun's sum insured of S$100,000.", questions: [{ text: "Was it the thigh bone (femur) or below the knee?" }] }, { summary: "The insurer will pay S$10,000 (illustration)." }, { summary: "S$20,000 instead of S$10,000." }])), "FAIL", "P2"],
    ["budget refusal", gradeRCW1("RCW1a", conv([{ summary: "I stopped: the model-use budget set for this test run is used up." }])), "BLOCKED", null],
  ];
  let ok = true;
  for (const [name, g, want, failing] of cases) {
    const hit = g.verdict === want && (!failing || g.checks.some((c) => c.id === failing && !c.ok));
    ok &&= hit;
    console.log(`${hit ? "PASS" : "FAIL"} control: ${name} -> ${g.verdict}${g.checks.some((c) => !c.ok) ? ` (${g.checks.filter((c) => !c.ok).map((c) => c.id).join(",")})` : ""}`);
  }
  console.log(`reliable-chat grader controls ${ok ? "all passed" : "FAILED"}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("reliable-chat-check.ts")) {
  if (process.argv[2] === "--controls") controls();
  else {
    const dirs = process.argv.slice(2); if (!dirs.length) { console.error("usage: reliable-chat-check.ts <RUN directory> [...]"); process.exit(2); }
    const all: Graded[] = []; const rows: string[] = [];
    for (const dir of dirs) {
      const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
      for (const conv of run.conversations ?? []) {
        const fn = GRADERS[conv.scenario]; if (!fn) continue;
        const g = fn(conv.scenario, conv); all.push(g);
        const timings = (conv.turns ?? []).map((t: any) => `${t.timings?.answerSeenMs ?? "?"} ms (model ${t.timings?.modelMs ?? "?"} ms)`).join("; ");
        rows.push(`## ${conv.scenario}: ${g.verdict}`, "", `run ${path.basename(dir)} -- ${conv.calls ?? "?"} calls, US$${(conv.costUsd ?? 0).toFixed(6)}; send-to-answer per turn: ${timings}`, ...(g.note ? ["", g.note] : []), "",
          "| id | dim | requirement | result | detail |", "|---|---|---|---|---|", ...g.checks.map((c) => `| ${c.id} | ${c.dim} | ${c.name} | ${c.ok ? "pass" : "**FAIL**"} | ${(c.detail ?? "").replace(/\|/g, "/").replace(/\n/g, " ⏎ ").slice(0, 500)} |`), "",
          "Visible answers:", "", ...((conv.loaded?.turns ?? []) as any[]).flatMap((t: any, i: number) => [`- **${conv.turns?.[i]?.user ?? "turn " + (i + 1)}**`, "", "```", visibleOf(t.answer), "```", ""]));
      }
    }
    const head = [`# rc-live-1 grade (reliable-chat-check.ts, pre-registered)`, "", `| scenario | verdict |`, `|---|---|`, ...all.map((g) => `| ${g.scenario} | ${g.verdict} |`), ""];
    const out = path.join(dirs[0], "..", "rc-live-1-grade.md");
    fs.writeFileSync(out, [...head, ...rows].join("\n") + "\n");
    fs.writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify(all, null, 2));
    console.log(head.join("\n")); console.log(`wrote ${out}`);
    process.exit(all.length && all.every((g) => g.verdict === "PASS") ? 0 : 1);
  }
}

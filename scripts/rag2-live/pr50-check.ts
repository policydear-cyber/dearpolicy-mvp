/**
 * Grader for the V1.5 pre-registered actual-model run pr50-live-1: the three prompts of the live verification after
 * PR #50 that failed (P50C inventory, P50D fixed-limit fracture, P50A death next steps) on the anonymised PR #50
 * household (RAG2_LIVE_HOUSEHOLD=pr50, PR50_NAMES=snake). WRITTEN BEFORE THE RUN from
 * docs/rag-migration/v15/EXPECTED-pr50-live-1.md; not to be changed after seeing its output. Deterministic, no AI judge.
 * Grades the COMPLETE visible answer as the chat page shows it (summary, details, questions, every next step) and the
 * saved state (calculation record, citations, library names, trace).
 *   node --import tsx scripts/rag2-live/pr50-check.ts <RUN directory>     -> pr50-grade.json / .md
 */
import fs from "node:fs";
import path from "node:path";
import { DOCS, ELIGIBLE } from "../fixtures/rag2-pr50/household";
import { uniqueSteps } from "../../components/next-steps";
import { recomputeCalculation } from "../../lib/claims/calc-record";

type Check = { id: string; name: string; ok: boolean; detail?: string };
const byKey = (k: string) => DOCS.find((d) => d.key === k)!;
const SUMMARY = byKey("SUMMARY").id;
const money = (s: string) => [...s.matchAll(/S\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
const sentences = (v: string) => v.split(/(?<=[.?!])\s+(?=[A-Z“"(•\d])|\n/).filter((x) => x.trim());
export const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const ACT = /\b(?:contact|call|phone|email|write to|notify|inform|tell|report|approach|claim|submit|file|lodge|send|ask)\b/i;
const limitStop = (t: any) => !!(t?.trace?.limit) || /couldn’t finish|ran out|token limit/i.test(visibleOf(t?.answer));

function ops(r: any) { return ((r?.operands ?? []) as any[]).filter((o) => o.source === "document"); }
/** The saved Simple Fracture illustration: 50% (the leg row) of S$5,000 (the Simple Fracture Benefit Limit), both on
 * Summary of Benefits page 13, result S$2,500 SGD, re-computable; Term Life is never an operand. */
export function simpleCalc(a: any) {
  return ((a?.calculations ?? []) as any[]).find((r) => {
    const o = ops(r), pct = o.find((x) => x.unit === "percent"), base = o.find((x) => x.unit === "money");
    if (!pct || !base || pct.value !== 50 || base.value !== 5000 || r.currency !== "SGD" || r.result?.value !== 2500) return false;
    if (o.some((x) => x.value === 1000000)) return false;
    const re = recomputeCalculation(r);
    return re.ok && re.resultMinor === 250000
      && pct.binding?.policyId === SUMMARY && pct.binding?.pageStart === 13 && /Jaw, Pelvis, Leg\^?, Ankle or Knee/.test(String(pct.row ?? pct.binding?.passage ?? ""))
      && base.binding?.policyId === SUMMARY && base.binding?.pageStart === 13 && /Simple Fracture Benefit Limit: S\$5,000/.test(String(base.row ?? base.binding?.passage ?? ""));
  }) ?? null;
}

export function gradeP50D(t: any): Check[] {
  const checks: Check[] = []; const add = (id: string, name: string, ok: boolean, detail = "") => checks.push({ id, name, ok, ...(!ok ? { detail: detail.slice(0, 900) } : {}) });
  const a = t?.answer; const v = visibleOf(a), ss = sentences(v);
  const with2500 = ss.filter((s) => money(s).includes(2500));
  add("D1", "a conditional S$2,500 is visible, and every sentence stating it is conditional / an illustration, not a payment", with2500.length > 0 && with2500.every((s) => /\bif\b|conditional|illustrat|would be|provided|hypothetical/i.test(s)), v);
  add("D2", "a saved calculation: 50% from the \"Jaw, Pelvis, Leg^, Ankle or Knee\" row and S$5,000 from \"Simple Fracture Benefit Limit: S$5,000\", both Summary of Benefits page 13; result S$2,500 SGD; re-computes; Term Life S$1,000,000 is not an operand", !!simpleCalc(a), JSON.stringify(a?.calculations ?? []));
  const mixed = with2500.filter((s) => /Other Fracture/i.test(s) && !/\b(?:unlike|rather than|whereas|instead|by contrast|compared|different|not the|separate|distinct)\b/i.test(s));
  const unrelated = ss.filter((s) => /Death due to|Compassionate|Term Life|•|Living Care|travel|Harbourline/i.test(s) || money(s).some((x) => ![2500, 5000].includes(x)));
  add("D3", "Simple and Other Fracture kept separate; no unrelated benefit label (Death due to Accident, Compassionate Death Allowance, Term Life) and no figure other than S$5,000 / S$2,500", !mixed.length && !unrelated.length, [...mixed, ...unrelated].join(" | "));
  add("D4", "no token-limit / unfinished fallback and no generic 'left out an amount' note in place of the illustration", !limitStop(t) && !/left out an amount/i.test(v), v);
  return checks;
}

export function gradeP50C(t: any): Check[] {
  const checks: Check[] = []; const add = (id: string, name: string, ok: boolean, detail = "") => checks.push({ id, name, ok, ...(!ok ? { detail: detail.slice(0, 900) } : {}) });
  const a = t?.answer; const v = visibleOf(a); const lines = v.split("\n");
  const names = (d: any) => [d.product, d.filename].filter((x: any): x is string => !!x && x.trim().length > 0);
  const shown = (d: any) => names(d).some((n) => v.includes(n));
  const missing = ELIGIBLE.map(byKey).filter((d) => !shown(d));
  add("C1", "all six eligible uploads are displayed by identity (product name, or the exact file name with its case)", !missing.length, `missing ${missing.map((d) => `${d.key} ${d.id}`).join(", ")}\n${v}`);
  const saved = new Set([...(a?.citations ?? []).map((c: any) => c.policyId)]);
  const notSaved = ELIGIBLE.map(byKey).filter((d) => !saved.has(d.id) && !names(d).some((n) => (a?.libraryNames ?? []).includes(n)));
  add("C2", "each displayed upload is in the saved record (a citation of its document id, or its library name)", !notSaved.length, notSaved.map((d) => d.key).join(", "));
  const scan = byKey("SCAN");
  add("C3", "the failed upload is stated as unreadable (on the line naming it); nothing is quoted from it", lines.some((l) => l.includes(scan.filename!) && /could not be read|couldn['’]t be read|unreadable|not readable|failed/i.test(l)), v);
  const gone = ["DELETED", "OTHER"].map(byKey).filter((d) => names(d).some((n) => v.includes(n)) || saved.has(d.id));
  add("C4", "the deleted upload and the other household's upload are absent (by name and by id)", !gone.length, gone.map((d) => d.key).join(", "));
  const travel = ["TRAVEL_WORDING", "TRAVEL_SUMMARY"].map(byKey);
  const asPersonal = lines.filter((l) => travel.some((d) => names(d).some((n) => l.includes(n)))).flatMap((l) => l.split(/;\s+/)).filter((p) => travel.some((d) => names(d).some((n) => p.includes(n))) && /\bpersonal (?:policy document|certificate|cover|policy)\b/i.test(p) && !/\bnot (?:a |your )?personal\b/i.test(p));
  add("C5", "the travel insurer's documents are not presented as personal cover", !asPersonal.length, asPersonal.join(" | "));
  add("C6", "no token-limit / unfinished fallback", !limitStop(t), v);
  return checks;
}

export function gradeP50A(t: any): Check[] {
  const checks: Check[] = []; const add = (id: string, name: string, ok: boolean, detail = "") => checks.push({ id, name, ok, ...(!ok ? { detail: detail.slice(0, 900) } : {}) });
  const a = t?.answer; const v = visibleOf(a), ss = sentences(v);
  const contact = ss.filter((s) => ACT.test(s) && /\bKestrel|scheme administrator|the (?:group )?insurer|employer\b/i.test(s) && !/Harbourline/i.test(s));
  add("A1", "supported contact advice is visible: a step to contact / notify the person's own insurer (Kestrel) or the scheme administrator", contact.length > 0, v);
  const otherIns = ss.filter((s) => /Harbourline/i.test(s) && (ACT.test(s) || /\b(?:covers|covered|will pay|is payable|pays)\b/i.test(s)) && !/\b(?:not|no|does not|do not|doesn['’]t|don['’]t|unless|whether|if)\b/i.test(s));
  add("A2", "no instruction to contact or claim from the unrelated travel insurer (Harbourline), and its wording is not presented as Adrian's cover", !otherIns.length, otherIns.join(" | "));
  const bad = ss.filter((s) => money(s).some((x) => ![1000000, 600000, 3000, 1500].includes(x)));
  add("A3", "every amount shown is one the documents print for Adrian's scheme (Term Life S$1,000,000, PA S$600,000, the allowance S$3,000 / S$1,500)", !bad.length, bad.join(" | "));
  const excl = ss.filter((s) => /\b(?:is|was) not (?:covered|eligible|enrolled)\b|\bexcluded\b|\bnot payable\b/i.test(s) && /Adrian|he\b/i.test(s));
  add("A4", "no unsupported exclusion (an uncertainty about enrolment is not said as 'not enrolled' / 'not covered')", !excl.length, excl.join(" | "));
  add("A5", "no token-limit / unfinished fallback", !limitStop(t), v);
  return checks;
}

export function gradeRun(run: any): { verdict: "PASS" | "FAIL" | "INCOMPLETE"; scenarios: Record<string, { checks: Check[]; visible: string | null }>; incomplete: string | null; costUsd: number } {
  const out: Record<string, { checks: Check[]; visible: string | null }> = {};
  const missing: string[] = [];
  for (const [id, fn] of [["P50C", gradeP50C], ["P50D", gradeP50D], ["P50A", gradeP50A]] as const) {
    const conv = (run.conversations ?? []).find((c: any) => c.scenario === id);
    const t = conv?.loaded?.turns?.[0];
    if (!t?.answer) { missing.push(id); out[id] = { checks: [], visible: null }; continue; }
    out[id] = { checks: fn({ answer: t.answer, trace: conv.saved?.traces?.[0] ?? null }), visible: visibleOf(t.answer) };
  }
  const costUsd = (run.conversations ?? []).reduce((n: number, c: any) => n + (c.costUsd ?? 0), 0);
  const all = Object.values(out).flatMap((x) => x.checks);
  return { verdict: missing.length ? "INCOMPLETE" : all.every((c) => c.ok) ? "PASS" : "FAIL", scenarios: out, incomplete: missing.length ? `no saved answer for ${missing.join(", ")}` : null, costUsd };
}

if (process.argv[1]?.endsWith("pr50-check.ts")) {
  const dir = process.argv[2]; if (!dir) { console.error("usage: pr50-check.ts <RUN directory>"); process.exit(2); }
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const g = gradeRun(run);
  fs.writeFileSync(path.join(dir, "pr50-grade.json"), JSON.stringify(g, null, 2));
  const md = [`# pr50-live-1 grade (pr50-check.ts, pre-registered): ${g.verdict}`, "", ...(g.incomplete ? [`INCOMPLETE: ${g.incomplete}`, ""] : []),
    ...Object.entries(g.scenarios).flatMap(([id, x]) => [`## ${id}`, "", "| id | requirement | result | detail |", "|---|---|---|---|", ...x.checks.map((c) => `| ${c.id} | ${c.name} | ${c.ok ? "pass" : "**FAIL**"} | ${(c.detail ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`), ""])].join("\n");
  fs.writeFileSync(path.join(dir, "pr50-grade.md"), md + "\n");
  console.log(md);
  process.exit(g.verdict === "PASS" ? 0 : 1);
}

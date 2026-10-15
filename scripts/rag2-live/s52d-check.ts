/**
 * Grader for the V1.5 pre-registered actual-model run s52d-live-2: ONE conversation, the report's turn 6 (scenario
 * S52D on the live-library household, RAG2_LIVE_HOUSEHOLD=livelib --scenarios S52D). WRITTEN BEFORE THE RUN from
 * docs/rag-migration/v15/EXPECTED-s52d-2.md; not to be changed after seeing its output. Deterministic, no AI judge.
 * Grades the COMPLETE visible answer as the chat page shows it (summary, details, questions, every next step) and the
 * saved state (calculation record, figure bindings, trace).
 *   node --import tsx scripts/rag2-live/s52d-check.ts <RUN directory>     -> s52d-grade.json / .md
 */
import fs from "node:fs";
import path from "node:path";
import { doc } from "../fixtures/rag2-livelib/household";
import { uniqueSteps } from "../../components/next-steps";
import { recomputeCalculation } from "../../lib/claims/calc-record";

type Check = { id: string; name: string; ok: boolean; detail?: string };
const SUMMARY = doc("SUMMARY").id, WORDING = doc("WORDING").id, CERT = doc("CERT").id;
const money = (s: string) => [...s.matchAll(/S\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
const sentences = (v: string) => v.split(/(?<=[.?!])\s+|\n/).filter((x) => x.trim());
export const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");

/** A saved calculation's document operands: [percent, base] with their source binding. */
function ops(r: any) { return ((r?.operands ?? []) as any[]).filter((o) => o.source === "document"); }
/** The saved Simple Fracture illustration: 50% (the leg row, Summary of Benefits p13) of S$5,000 (that page's Simple
 * Fracture Benefit Limit), result S$2,500, re-computable. */
export function simpleCalc(a: any) {
  return ((a?.calculations ?? []) as any[]).find((r) => {
    const o = ops(r), pct = o.find((x) => x.unit === "percent"), base = o.find((x) => x.unit === "money");
    if (!pct || !base || pct.value !== 50 || base.value !== 5000 || r.currency !== "SGD" || r.result?.value !== 2500) return false;
    const re = recomputeCalculation(r);
    return re.ok && re.resultMinor === 250000
      && pct.binding?.policyId === SUMMARY && pct.binding?.pageStart === 13 && /Jaw, Pelvis, Leg/.test(String(pct.row ?? pct.binding?.passage ?? ""))
      && base.binding?.policyId === SUMMARY && base.binding?.pageStart === 13 && /Simple Fracture Benefit Limit: S\$5,000/.test(String(base.row ?? base.binding?.passage ?? ""));
  }) ?? null;
}
/** A saved Other Fracture illustration that IS supported: the wording's own Other Fracture leg row (page 1, 50% of
 * the Sum Insured) of the person's certificate Group Personal Accident sum insured (S$600,000). */
function otherCalcs(a: any) {
  return ((a?.calculations ?? []) as any[]).filter((r) => {
    const o = ops(r), pct = o.find((x) => x.unit === "percent"), base = o.find((x) => x.unit === "money");
    const re = recomputeCalculation(r);
    return !!pct && !!base && re.ok && pct.binding?.policyId === WORDING && /Other Fracture/.test(String(pct.row ?? "")) && base.binding?.policyId === CERT && base.value === 600000;
  });
}

export function gradeS52d(conv: any): { verdict: "PASS" | "FAIL" | "INCOMPLETE"; checks: Check[]; incomplete: string | null } {
  const t = conv?.loaded?.turns?.[0];
  if (!t?.answer) return { verdict: "INCOMPLETE", checks: [], incomplete: "no saved answer for S52D turn 1" };
  const a = t.answer, v = visibleOf(a), ss = sentences(v);
  const checks: Check[] = [];
  const add = (id: string, name: string, ok: boolean, detail = "") => checks.push({ id, name, ok, ...(!ok ? { detail: detail.slice(0, 800) } : {}) });
  const with2500 = ss.filter((s) => money(s).includes(2500));
  add("R1", "a conditional S$2,500 from 50% x S$5,000 is visible (the sentence stating it is conditional / an illustration, not a payment)",
    with2500.length > 0 && with2500.every((s) => /\bif\b|conditional|illustrat|would be|provided|hypothetical/i.test(s)), v);
  const sc = simpleCalc(a);
  add("R2", "a saved calculation with source-bound operands: 50% from the leg row and S$5,000 from the Simple Fracture Benefit Limit, both Summary of Benefits page 13; result S$2,500; it re-computes", !!sc, JSON.stringify(a.calculations ?? []));
  const mixed = with2500.filter((s) => /Other Fracture/i.test(s) && !/\b(?:unlike|rather than|whereas|instead|by contrast|compared|different|not the|separate)\b/i.test(s));
  const simpleOnSI = ss.filter((s) => /Simple Fracture/i.test(s) && !/Other Fracture/i.test(s) && /\bSum Insured\b/i.test(s) && money(s).some((x) => x !== 5000 && x !== 2500));
  add("R3", "Simple Fracture and Other Fracture are kept separate (the S$2,500 is not given as Other Fracture's; no Simple Fracture amount on the Sum Insured)", !mixed.length && !simpleOnSI.length, [...mixed, ...simpleOnSI].join(" | "));
  const supported = new Set<number>([5000, 600000, ...otherCalcs(a).map((r: any) => r.result?.value)]);
  const otherBad = ss.filter((s) => /Other Fracture/i.test(s)).filter((s) => money(s).some((x) => x !== 2500 && !supported.has(x)));
  add("R4", "no unsupported Other Fracture amount (any Other Fracture amount is a saved calculation on the wording's Other Fracture row and the certificate's S$600,000 sum insured)", !otherBad.length, otherBad.join(" | "));
  const falseAbsent = ss.filter((s) => (/\b(?:do(?:es)?\s+not|don['’]t|doesn['’]t|not)\s+(?:provide|state|show|list|give|include|print|specify|contain)\b[^.]{0,80}\bSum Insured\b/i.test(s) || /\bSum Insured\b[^.]{0,60}\b(?:is|are)\s+not\s+(?:stated|provided|shown|given|listed)\b/i.test(s) || /\bcertificate\b[^.]{0,60}\b(?:does not|doesn['’]t)\b[^.]{0,40}\b(?:Personal Accident|sum insured)\b/i.test(s)) && !/\bin force\b|\bon (?:the|that) date\b|\bcurrent/i.test(s));
  add("R5", "no false statement that the certificate lacks the Group Personal Accident sum insured", !falseAbsent.length, falseAbsent.join(" | "));
  const allowed = new Set<number>([2500, ...supported]);
  const unrelated = ss.filter((s) => money(s).some((x) => !allowed.has(x)) || /Living Care|Term Life|Repatriation|Daily Hospital|travel/i.test(s));
  add("R6", "no token-limit fallback and no unrelated benefit or figure", !t.trace?.limit && !unrelated.length, JSON.stringify(t.trace?.limit ?? null) + " :: " + unrelated.join(" | "));
  return { verdict: checks.every((c) => c.ok) ? "PASS" : "FAIL", checks, incomplete: null };
}

if (process.argv[1]?.endsWith("s52d-check.ts")) {
  const dir = process.argv[2]; if (!dir) { console.error("usage: s52d-check.ts <RUN directory>"); process.exit(2); }
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const conv = (run.conversations ?? []).find((c: any) => c.scenario === "S52D");
  const g = gradeS52d(conv);
  fs.writeFileSync(path.join(dir, "s52d-grade.json"), JSON.stringify({ ...g, visible: conv?.loaded?.turns?.[0]?.answer ? visibleOf(conv.loaded.turns[0].answer) : null }, null, 2));
  const md = [`# s52d-live-2 grade (s52d-check.ts, pre-registered): ${g.verdict}`, "", ...(g.incomplete ? [`INCOMPLETE: ${g.incomplete}`, ""] : []), "| id | requirement | result | detail |", "|---|---|---|---|", ...g.checks.map((c) => `| ${c.id} | ${c.name} | ${c.ok ? "pass" : "**FAIL**"} | ${(c.detail ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} |`)].join("\n");
  fs.writeFileSync(path.join(dir, "s52d-grade.md"), md + "\n");
  console.log(md);
  process.exit(g.verdict === "PASS" ? 0 : 1);
}

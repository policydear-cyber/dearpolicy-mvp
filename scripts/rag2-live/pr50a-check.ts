/**
 * Grader for the V1.5 pre-registered actual-model run pr50a-live-2: the death next-steps prompt ALONE (scenario P50A
 * on the anonymised PR #50 household; RAG2_LIVE_HOUSEHOLD=pr50 PR50_NAMES=snake --scenarios P50A). WRITTEN BEFORE THE
 * RUN from docs/rag-migration/v15/EXPECTED-pr50a-live-2.md; not changed after. Deterministic, no AI judge. Grades the
 * COMPLETE visible answer (summary, details, questions, every next step) and the saved figure bindings.
 * Verdict: PASS (every check), FAIL (a check fails), BLOCKED (the run-cap guard refused a model call -- a budget
 * refusal is not a factual-answer failure), INCOMPLETE (no saved answer).
 *   node --import tsx scripts/rag2-live/pr50a-check.ts <RUN directory>          -> pr50a-grade.json / .md
 *   node --import tsx scripts/rag2-live/pr50a-check.ts --controls <run.json>      -> the grader's own controls
 */
import fs from "node:fs";
import path from "node:path";
import { DOCS, M } from "../fixtures/rag2-pr50/household";
import { uniqueSteps } from "../../components/next-steps";

type Check = { id: string; name: string; ok: boolean; detail?: string };
const CERT = DOCS.find((d) => d.key === "CERT")!.id, ADRIAN = M.adrian.id;
const money = (s: string) => [...s.matchAll(/S\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
const sentences = (v: string) => v.split(/(?<=[.?!])\s+(?=[A-Z“"(•\d])|\n/).filter((x) => x.trim());
export const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const ACT = /\b(?:contact|call|phone|email|write to|notify|inform|tell|report|approach|claim|submit|file|lodge|send|ask)\b/i;
const BUDGET = /model-use budget|budget set for this test run|run_budget/i;
const DATED = /6 October 2022|06\/10\/2022|6 Oct 2022/i;

export function gradeP50A(answer: any, trace: any): { verdict: "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE"; checks: Check[]; note: string | null } {
  if (!answer) return { verdict: "INCOMPLETE", checks: [], note: "no saved answer" };
  const v = visibleOf(answer), ss = sentences(v);
  if (trace?.limit?.kind === "run_budget" || BUDGET.test(v)) return { verdict: "BLOCKED", checks: [], note: `the run-cap guard refused a model call: ${trace?.limit?.detail ?? v}` };
  const checks: Check[] = []; const add = (id: string, name: string, ok: boolean, detail = "") => checks.push({ id, name, ok, ...(!ok ? { detail: detail.slice(0, 900) } : {}) });
  const fb = (answer.figureBindings ?? []) as any[];
  const boundFor = (value: number) => fb.some((b) => b.value === value && b.currency === "SGD" && b.subjectId === ADRIAN && b.policyId === CERT);
  const tl = ss.find((s) => /Term Life/i.test(s) && money(s).includes(1000000) && DATED.test(s) && !/Cheryl/.test(s));
  const pa = ss.find((s) => /Personal Accident/i.test(s) && money(s).includes(600000) && DATED.test(s) && !/Cheryl/.test(s));
  add("R1", "Adrian's dated amounts: Group Term Life S$1,000,000 and Group Personal Accident S$600,000, each with the certificate date (6 October 2022), each bound to Adrian's own certificate row", !!tl && !!pa && boundFor(1000000) && boundFor(600000), `${v}\n${JSON.stringify(fb.map((b) => [b.value, b.subjectId, b.policyId]))}`);
  const contact = ss.filter((s) => ACT.test(s) && /\bKestrel|scheme administrator|the (?:group )?insurer|employer\b/i.test(s) && !/Harbourline/i.test(s));
  add("R2", "useful, supported contact advice: a step to contact / notify the person's own insurer (Kestrel) or the scheme administrator / employer", contact.length > 0, v);
  const uncertainty = ss.filter((s) => /\b(?:do(?:es)?(?:n['’]t| not) (?:establish|confirm|show|prove|say)|not (?:established|confirmed|known)|cannot (?:confirm|establish)|can['’]t (?:confirm|establish)|unclear|whether|may (?:differ|have changed)|confirm (?:with|whether))\b/i.test(s)
    && /\b(?:in force|current|still|on 5 October 2026|on 3 October 2026|at the time|event date|on the date|2026|as of (?:the )?(?:accident|death))\b/i.test(s));
  const exclusion = ss.filter((s) => /\b(?:is|was|are|were) not (?:covered|eligible|enrolled|insured|payable)\b|\bexcluded\b|\bnot payable\b|\bno (?:cover|benefit) (?:is|was) payable\b|\bdoes not cover\b/i.test(s) && /Adrian|\bhe\b|\bhis\b|this death/i.test(s));
  add("R3", "uncertainty about cover on the event date is stated as uncertainty, and nothing is stated as an exclusion", uncertainty.length > 0 && !exclusion.length, `uncertainty: ${uncertainty.length}; exclusions: ${exclusion.join(" | ")}\n${v}`);
  const otherIns = ss.filter((s) => /Harbourline|travel (?:insurer|insurance|policy)/i.test(s) && (ACT.test(s) || /\b(?:covers|covered|will pay|is payable|pays|recommend)\b/i.test(s)) && !/\b(?:not|no|does not|do not|doesn['’]t|don['’]t|unless|whether|if any|if you)\b/i.test(s));
  add("R4", "no recommendation to contact or claim from an unrelated insurer (Harbourline / travel), and its wording is not presented as Adrian's cover", !otherIns.length, otherIns.join(" | "));
  const borrowed = ss.filter((s) => /\b365\b|dismember/i.test(s) && /\bdeath|died|dies\b/i.test(s));
  add("R5", "no dismemberment condition (365 days) borrowed into the death benefit", !borrowed.length, borrowed.join(" | "));
  const MANDATORY = /\b(?:must|required|requires|is needed|are needed|you (?:will )?need to|you need|have to|mandatory|necessary)\b/i;
  const SUGGEST = /\b(?:may|might|could|suggest|consider|typically|usually|commonly|for example|such as|ask (?:the|them|Kestrel|the insurer|the scheme)|check with)\b/i;
  const PAPER = /\b(?:death certificate|police report|post-?mortem|autopsy|coroner|translation|translated|notari[sz]ed|medical report|claim form|identity card|NRIC|passport|bank statement|will|probate|letters of administration|marriage certificate|birth certificate)\b/i;
  const invented = ss.filter((s) => MANDATORY.test(s) && PAPER.test(s) && !SUGGEST.test(s));
  add("R6", "no invented mandatory paperwork (the wording prints only 'proof of death and the relevant documents in our prescribed form'; anything more is a suggestion, labelled as one)", !invented.length, invented.join(" | "));
  const unrelated = ss.filter((s) => /Simple Fracture|Other Fracture|Living Care|hospital (?:cash|income)|Daily Hospital|repatriation|couldn['’]t confirm an answer|lists separate .* amounts|left out an amount|couldn['’]t finish/i.test(s) || money(s).some((x) => ![1000000, 600000, 3000, 1500].includes(x)));
  add("R7", "no unrelated benefit fallback or unrelated figure (only the certificate's S$1,000,000 / S$600,000 and the allowance's S$3,000 / S$1,500 may appear)", !unrelated.length && !trace?.limit, `${unrelated.join(" | ")} ${JSON.stringify(trace?.limit ?? null)}`);
  return { verdict: checks.every((c) => c.ok) ? "PASS" : "FAIL", checks, note: null };
}

function controls(file: string) {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const conv = r.conversations.find((c: any) => c.scenario === "P50A");
  const base = conv.loaded.turns[0].answer, trace = conv.saved.traces[0];
  const variant = (extra: string[], steps?: string[]) => ({ ...base, details: [...(base.details ?? []), ...extra], nextSteps: steps ?? base.nextSteps });
  const cases: [string, any, any, string, string | null][] = [
    ["positive: the scripted compliant answer (full pipeline)", base, trace, "PASS", null],
    ["budget refusal", { ...base, summary: "I couldn’t look that up: the model-use budget set for this test run is used up, so no model was called.", details: [], nextSteps: [] }, { limit: { kind: "run_budget", detail: "ledger" } }, "BLOCKED", null],
    ["unrelated insurer step", variant([], [...(base.nextSteps ?? []), "Contact Harbourline General to claim the travel death benefit."]), trace, "FAIL", "R4"],
    ["borrowed dismemberment condition", variant(["The Accidental Death benefit is payable only if death occurs within 365 days of the Accident."]), trace, "FAIL", "R5"],
    ["invented mandatory paperwork", variant([], [...(base.nextSteps ?? []), "You must submit a police report and a certified translation of the death certificate."]), trace, "FAIL", "R6"],
    ["unrelated benefit fallback", variant(["The Summary of Benefits lists separate Simple Fracture Benefit Limit and Death due to Accident amounts; I couldn’t confirm the Death due to Accident amount for this answer."]), trace, "FAIL", "R7"],
    ["exclusion instead of uncertainty", variant(["Adrian was not covered on 5 October 2026."]), trace, "FAIL", "R3"],
    ["another person's amounts / no binding", { ...base, figureBindings: (base.figureBindings ?? []).map((b: any) => ({ ...b, subjectId: M.cheryl.id })) }, trace, "FAIL", "R1"],
    ["no contact advice", { ...base, nextSteps: [] }, trace, "FAIL", "R2"],
    ["suggested paperwork is allowed", variant([], [...(base.nextSteps ?? []), "You may want to have the death certificate ready; ask Kestrel Life Ltd which documents it needs."]), trace, "PASS", null],
  ];
  let ok = true;
  for (const [name, a, t, want, failing] of cases) {
    const g = gradeP50A(a, t);
    const hit = g.verdict === want && (!failing || g.checks.some((c) => c.id === failing && !c.ok));
    ok &&= hit;
    console.log(`${hit ? "PASS" : "FAIL"} control: ${name} -> ${g.verdict}${failing ? ` (${g.checks.filter((c) => !c.ok).map((c) => c.id).join(",")})` : ""}`);
  }
  console.log(`pr50a grader controls ${ok ? "all passed" : "FAILED"}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("pr50a-check.ts")) {
  if (process.argv[2] === "--controls") controls(process.argv[3]);
  else {
    const dir = process.argv[2]; if (!dir) { console.error("usage: pr50a-check.ts <RUN directory>"); process.exit(2); }
    const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
    const conv = (run.conversations ?? []).find((c: any) => c.scenario === "P50A");
    const answer = conv?.loaded?.turns?.[0]?.answer ?? null, trace = conv?.saved?.traces?.[0] ?? null;
    const g = gradeP50A(answer, trace);
    fs.writeFileSync(path.join(dir, "pr50a-grade.json"), JSON.stringify({ ...g, visible: answer ? visibleOf(answer) : null, figureBindings: answer?.figureBindings ?? [], costUsd: conv?.costUsd ?? null }, null, 2));
    const md = [`# pr50a-live-2 grade (pr50a-check.ts, pre-registered): ${g.verdict}`, "", ...(g.note ? [g.note, ""] : []), "| id | requirement | result | detail |", "|---|---|---|---|", ...g.checks.map((c) => `| ${c.id} | ${c.name} | ${c.ok ? "pass" : "**FAIL**"} | ${(c.detail ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`)].join("\n");
    fs.writeFileSync(path.join(dir, "pr50a-grade.md"), md + "\n");
    console.log(md);
    process.exit(g.verdict === "PASS" ? 0 : 1);
  }
}

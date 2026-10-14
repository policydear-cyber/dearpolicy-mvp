/**
 * Grader for the V1.5 pre-registered actual-model sample s52 (RAG2_LIVE_HOUSEHOLD=livelib; the live verification
 * report's six turns in its four conversations, scripts/rag2-live/scenario-household.ts S52A-D). WRITTEN BEFORE THE
 * RUN from docs/rag-migration/v15/EXPECTED-s52.md; not to be changed after seeing its output. Deterministic, no AI judge.
 * Grades the COMPLETE visible answer of every turn (summary, details, questions, next steps) and its saved state.
 *   node --import tsx scripts/rag2-live/livelib-check.ts <RUN directory>     -> livelib-grade.json / .md
 */
import fs from "node:fs";
import path from "node:path";
import { DOCS, M, doc } from "../fixtures/rag2-livelib/household";

type Check = { conv: string; turn: number; name: string; ok: boolean; kind: "correctness" | "usefulness"; detail?: string };
const A = M.adrian.id, C = M.cheryl.id, CERT = doc("CERT").id;
const DATE = /\b(?:6|06)(?:\s+October\s+|\/10\/)2022\b|\b6 Oct 2022\b/i;
const near = (v: string, a: RegExp, b: RegExp) => v.split(/(?<=[.;?!])\s+|\n/).some((s) => a.test(s) && b.test(s));
const clauses = (v: string) => v.split(/(?<=[.?!])\s+|;\s+|\n/);
/** A 365-day condition attributed to death (not to dismemberment / disablement). */
export const borrowed365 = (v: string) => clauses(v).filter((c) => /\b365\b/.test(c) && /\bdeath|\bdied|\bdies\b/i.test(c) && !/dismember|disablement|loss of (?:a |any )?(?:limb|sight|hand|foot|eye)/i.test(c));
const LIVING = /Living Care/i;
const PROMISE = /\bwill (?:receive|be paid|get)\b|\bapproved\b(?! payment)|\bguaranteed\b/i;
export function gradeLivelib(convs: any[]): { verdict: "PASS" | "FAIL" | "INCOMPLETE"; checks: Check[]; incomplete: string | null } {
  const checks: Check[] = []; let incomplete: string | null = null;
  const conv = (id: string) => convs.find((c) => c.scenario === id);
  const turnOf = (id: string, n: number) => conv(id)?.loaded?.turns?.[n - 1];
  const vis = (t: any) => [String(t?.visible ?? ""), ...((t?.questions ?? []) as string[])].join("\n");
  const add = (c: string, n: number, name: string, ok: boolean, kind: Check["kind"], detail = "") => checks.push({ conv: c, turn: n, name, ok, kind, ...(!ok ? { detail: detail.slice(0, 600) } : {}) });
  const fb = (t: any) => ((t?.answer?.figureBindings ?? []) as any[]);
  const bound = (t: any, value: number, re: RegExp, who: string) => fb(t).some((b) => b.value === value && re.test(String(b.benefit ?? "")) && b.subjectId === who && b.policyId === CERT);
  const want: [string, number][] = [["S52A", 2], ["S52B", 2], ["S52C", 1], ["S52D", 1]];
  for (const [id, n] of want) { const k = conv(id)?.loaded?.turns?.length ?? 0; if (k < n) incomplete = incomplete ?? `${id}: only ${k} of ${n} turns have a saved answer`; }
  // every turn: no token-limit dead end, no unrelated Living Care Plus, no borrowed condition, no promise
  for (const [id, n] of want) for (let i = 1; i <= n; i++) {
    const t = turnOf(id, i); if (!t) continue; const v = vis(t);
    add(id, i, "no model-use-limit dead end (the turn was not ended by a limit)", !t.trace?.limit, "usefulness", JSON.stringify(t.trace?.limit ?? null) + " :: " + v);
    add(id, i, "no unrelated Living Care / Living Care Plus figure", !LIVING.test(v), "correctness", v);
    add(id, i, "no 365-day condition borrowed from Permanent Dismemberment for death", !borrowed365(v).length, "correctness", borrowed365(v).join(" | "));
    add(id, i, "no promised payment or approval", !PROMISE.test(v.replace(/not an approved payment|not approved/gi, "")), "correctness", v);
  }
  // S52A turn 1: hypothetical death
  { const t = turnOf("S52A", 1); if (t) { const v = vis(t);
    add("S52A", 1, "Term Life S$1,000,000 and PA S$600,000, each with its product, and the certificate date", near(v, /term life/i, /S\$1,000,000(?![\d,])/) && near(v, /personal accident/i, /S\$600,000(?![\d,])/) && DATE.test(v), "usefulness", v);
    add("S52A", 1, "both amounts saved bound to Adrian's own certificate row and product", bound(t, 1000000, /term life/i, A) && bound(t, 600000, /personal accident/i, A), "correctness", JSON.stringify(fb(t).map((b) => [b.value, b.benefit, b.subjectId === A])));
    add("S52A", 1, "a useful death explanation: the Death Benefit or Accidental Death wording", /death benefit|accidental death/i.test(v), "usefulness", v);
    const qs = (t.questions ?? []) as string[];
    add("S52A", 1, "at most one question, and a relevant next question or practical next step (not a dead end)", qs.length <= 1 && (qs.length === 1 || /\b(?:notify|contact|tell|inform|claim form|ask)\b/i.test(v)), "usefulness", JSON.stringify(qs) + " :: " + v);
    add("S52A", 1, "no other household's amount (S$2,000,000)", !/S\$2,000,000/.test(v), "correctness", v);
  } }
  // S52A turn 2: both dates given
  { const t = turnOf("S52A", 2); if (t) { const v = vis(t); const qs = (t.questions ?? []) as string[];
    add("S52A", 2, "both supplied dates are used (3 and 5 October 2026)", /\b0?3(?:\s+October\s+|\/10\/)2026\b/i.test(v) && /\b0?5(?:\s+October\s+|\/10\/)2026\b/i.test(v), "usefulness", v);
    add("S52A", 2, "neither date is asked for again", !qs.some((q) => /\b(?:when|what date|which date|date)\b/i.test(q) && /\b(?:accident|die|died|death)\b/i.test(q)), "usefulness", JSON.stringify(qs));
    add("S52A", 2, "the benefits are explained: Term Life and Personal Accident (Accidental Death) both named", /term life|death benefit/i.test(v) && /personal accident|accidental death/i.test(v), "usefulness", v);
    add("S52A", 2, "next steps are given", ((t.answer?.nextSteps ?? []) as string[]).length > 0 || /\b(?:notify|contact|tell|inform)\b/i.test(v), "usefulness", v);
  } }
  // S52B: direct amounts, then switch and correct
  { const t = turnOf("S52B", 1); if (t) { const v = vis(t);
    add("S52B", 1, "Adrian's Term Life S$1,000,000 and PA S$600,000 separately, with the certificate date", near(v, /term life/i, /S\$1,000,000(?![\d,])/) && near(v, /personal accident/i, /S\$600,000(?![\d,])/) && DATE.test(v), "usefulness", v);
    add("S52B", 1, "both bound to Adrian", bound(t, 1000000, /term life/i, A) && bound(t, 600000, /personal accident/i, A), "correctness", JSON.stringify(fb(t).map((b) => [b.value, b.benefit, b.subjectId === A])));
  } }
  { const t = turnOf("S52B", 2); if (t) { const v = vis(t);
    add("S52B", 2, "switches to Cheryl and states her PA S$600,000 (bound to Cheryl)", /Cheryl/.test(v) && near(v, /personal accident/i, /S\$600,000(?![\d,])/) && bound(t, 600000, /personal accident/i, C), "usefulness", v + " :: " + JSON.stringify(fb(t).map((b) => [b.value, b.benefit, b.subjectId === C])));
    add("S52B", 2, "does not confirm the wrong premise (PA S$1,000,000)", !/personal accident(?:\s+(?:cover|sum (?:insured|assured)|benefit|amount))?\s*(?:is|was|of|at|:|=)\s*S\$1,000,000(?![\d,])|S\$1,000,000(?![\d,])\s+(?:under|for|as|of)\s+(?:the\s+|her\s+)?(?:group\s+)?personal accident/i.test(v) && !/^\s*(?:yes|that'?s right|correct)\b/i.test(v), "correctness", v);
    add("S52B", 2, "no Adrian-only figure stated as Cheryl's", !fb(t).some((b) => b.subjectId === C && b.rowPerson && /Adrian/.test(String(b.rowPerson))), "correctness", JSON.stringify(fb(t)));
  } }
  // S52C: inventory
  { const t = turnOf("S52C", 1); if (t) { const v = vis(t);
    add("S52C", 1, "the unreadable upload is included (IMG_0042.jpg, could not be read)", /IMG_0042\.jpg/.test(v) && /could not be read|couldn.t be read|unreadable|failed/i.test(v), "usefulness", v);
    const missing = DOCS.filter((d) => !d.account && d.key !== "SCAN" && !v.includes(d.product)).map((d) => d.product);
    add("S52C", 1, "every readable upload is listed", !missing.length, "usefulness", "missing: " + missing.join("; ") + " :: " + v);
  } }
  // S52D: conditional fracture arithmetic
  { const t = turnOf("S52D", 1); if (t) { const v = vis(t);
    add("S52D", 1, "conditional S$2,500 from 50% of the S$5,000 Simple Fracture Benefit Limit", near(v, /\b(?:if|would|conditional|illustrat)/i, /S\$2,500(?![\d,])/) && /50%/.test(v) && /S\$5,000(?![\d,])/.test(v), "usefulness", v);
    const calc = ((t.answer?.calculations ?? []) as any[]).find((r) => r.result?.value === 2500);
    add("S52D", 1, "the S$2,500 is a saved, re-runnable calculation record (not model arithmetic)", !!calc, "correctness", JSON.stringify((t.answer?.calculations ?? []).map((r: any) => r.result)));
    add("S52D", 1, "Other Fracture is distinguished (a percentage of the Sum Insured)", /other fracture/i.test(v) && /sum insured/i.test(v), "usefulness", v);
    add("S52D", 1, "no other base used (no S$300,000 / S$600,000-based fracture amount)", !/S\$(?:300,000|150,000|30,000)(?![\d,])/.test(v), "correctness", v);
  } }
  const failed = checks.filter((c) => !c.ok);
  return { verdict: incomplete ? "INCOMPLETE" : failed.length ? "FAIL" : "PASS", checks, incomplete };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("livelib-check.ts")) {
  const dir = process.argv[2]; if (!dir) { console.error("usage: livelib-check.ts <RUN directory>"); process.exit(2); }
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const g = gradeLivelib(run.conversations ?? []);
  fs.writeFileSync(path.join(dir, "livelib-grade.json"), JSON.stringify(g, null, 2));
  const md = [`# s52 actual-model grade (livelib-check, pre-registered): ${g.verdict}`, g.incomplete ? `\nIncomplete: ${g.incomplete}` : "", "", "| conversation | turn | check | kind | result | detail |", "|---|---|---|---|---|---|",
    ...g.checks.map((c) => `| ${c.conv} | ${c.turn} | ${c.name} | ${c.kind} | ${c.ok ? "pass" : "**FAIL**"} | ${(c.detail ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} |`)].join("\n");
  fs.writeFileSync(path.join(dir, "livelib-grade.md"), md + "\n");
  console.log(`s52 (livelib-check): ${g.verdict}; ${g.checks.filter((c) => !c.ok).length} of ${g.checks.length} checks failed`);
}

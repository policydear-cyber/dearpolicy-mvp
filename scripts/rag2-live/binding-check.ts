/**
 * Grader for the V1.4 actual-model sample on the person / product / benefit binding structures
 * (RAG2_LIVE_HOUSEHOLD=binding; scripts/rag2-live/scenario-household.ts S49 + S49B). WRITTEN BEFORE THE RUN from
 * docs/rag-migration/v14/EXPECTED.md; not to be changed after seeing its output. Deterministic, no AI judge. Reads the
 * run directory's run.json (visible answers, questions and saved state) and writes binding-grade.json + .md there.
 *   node --import tsx scripts/rag2-live/binding-check.ts <RUN directory>
 * "correctness" checks: nothing wrong is shown. "usefulness" checks: the documented answer is given. A safe answer that
 * leaves out the documented amounts or the one relevant question passes correctness and fails usefulness.
 */
import fs from "node:fs";
import path from "node:path";

type Check = { conv: string; turn: number | null; name: string; ok: boolean; kind: "correctness" | "usefulness"; detail?: string };
const NAME_AS_PRODUCT = /(?:separate|under|lists?)[^.]*\b(?:Tan Kai Ming|Ong Li Ting)\b[^.]*\bamounts?\b|\b(?:Tan Kai Ming, Darren|Ong Li Ting, Michelle)\b\s+(?:amount|benefit|cover)\b/i;

export function gradeBinding(convs: any[]): { verdict: "PASS" | "FAIL" | "INCOMPLETE"; checks: Check[]; incomplete: string | null } {
  const checks: Check[] = [];
  let incomplete: string | null = null;
  const add = (conv: string, turn: number | null, name: string, ok: boolean, kind: Check["kind"], detail?: string) => checks.push({ conv, turn, name, ok, kind, ...(detail && !ok ? { detail: detail.slice(0, 500) } : {}) });
  const byId = (id: string) => convs.find((c) => c.scenario === id);
  const death = (id: string, t: any, visible: string, questions: string[]) => {
    const v = [visible, ...questions].join("\n");
    add(id, 1, "no person's name used as a product or benefit", !NAME_AS_PRODUCT.test(v), "correctness", v);
    add(id, 1, "the unrelated insurer (Lumen General) is not suggested", !/Lumen General/i.test(v), "correctness", v);
    add(id, 1, "no other person's amounts as Darren's (S$500,000 / S$300,000 / S$400,000 / S$150,000 / S$100,000)", !/S\$(?:500,000|300,000|400,000|150,000|100,000)(?![\d,])/.test(v), "correctness", v);
    add(id, 1, "no superseded (S$800,000 / S$450,000) or other-household (S$2,000,000) amount", !/S\$(?:800,000|450,000|2,000,000)(?![\d,])/.test(v), "correctness", v);
    add(id, 1, "no total of different benefits (S$1,600,000 or similar) and no promised payment / current-cover claim", !/S\$1,600,000|S\$1,950,000|S\$2,250,000|\bwill (?:receive|be paid|get)\b|\bcurrently covered\b|\bapproved\b(?! payment)/i.test(v.replace(/not an approved payment/gi, "")), "correctness", v);
    add(id, 1, "Term Life is never presented as Personal Accident (S$1,000,000 is not called the PA amount)", !/personal accident[^.;]{0,50}S\$1,000,000|S\$1,000,000[^.;]{0,30}personal accident/i.test(v), "correctness", v);
    add(id, 1, "Darren's Group Term Life S$1,000,000 is stated with its product", /S\$1,000,000(?![\d,])/.test(visible) && /term life/i.test(visible), "usefulness", visible);
    add(id, 1, "Darren's Group Personal Accident S$600,000 is stated with its product", /S\$600,000(?![\d,])/.test(visible) && /personal accident/i.test(visible), "usefulness", visible);
    add(id, 1, "the accidental-death condition (within 365 days of the accident) is given", /365 days/i.test(visible), "usefulness", visible);
    const qs = questions.length ? questions : (visible.match(/[^.?!\n]*\?/g) ?? []);
    add(id, 1, "exactly one question, about the accident date", qs.length === 1 && /accident/i.test(qs[0]) && /\b(?:when|what date|which date|date)\b/i.test(qs[0]), "usefulness", JSON.stringify(qs));
    void t;
  };
  for (const id of ["S49", "S49B"]) {
    const c = byId(id);
    const turns: any[] = c?.loaded?.turns ?? [];
    const want = id === "S49" ? 2 : 1;
    if (turns.length < want) { incomplete = incomplete ?? `${id}: only ${turns.length} of ${want} turns have a saved answer`; continue; }
    for (const [i, t] of turns.entries()) { const o = t.trace?.outcome; if (t.trace?.limit || (o && !["final_answer", "ask_user"].includes(o))) incomplete = incomplete ?? `${id} turn ${i + 1} stopped: ${t.trace?.limit?.kind ?? o}`; }
    death(id, turns[0], String(turns[0]?.visible ?? ""), (turns[0]?.questions ?? []) as string[]);
    if (id === "S49") {
      const v2 = [String(turns[1]?.visible ?? ""), ...((turns[1]?.questions ?? []) as string[])].join("\n");
      add(id, 2, "after the accident date is given, it is not asked for again", !/\b(?:when|what date)\b[^?]*accident[^?]*\?/i.test(v2), "usefulness", v2);
      add(id, 2, "no promised payment, no unrelated insurer, no person's name as a product", !/\bwill (?:receive|be paid|get)\b|Lumen General/i.test(v2) && !NAME_AS_PRODUCT.test(v2), "correctness", v2);
    }
  }
  const failed = checks.filter((x) => !x.ok);
  return { verdict: incomplete ? "INCOMPLETE" : failed.length ? "FAIL" : "PASS", checks, incomplete };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("binding-check.ts")) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: binding-check.ts <RUN directory>"); process.exit(2); }
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const g = gradeBinding(run.conversations ?? []);
  fs.writeFileSync(path.join(dir, "binding-grade.json"), JSON.stringify(g, null, 2));
  const md = [`# S49 actual-model grade: ${g.verdict}`, g.incomplete ? `\nIncomplete: ${g.incomplete}` : "", "", "| conversation | turn | check | kind | result | detail |", "|---|---|---|---|---|---|",
    ...g.checks.map((c) => `| ${c.conv} | ${c.turn ?? "all"} | ${c.name} | ${c.kind} | ${c.ok ? "pass" : "**FAIL**"} | ${(c.detail ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} |`)].join("\n");
  fs.writeFileSync(path.join(dir, "binding-grade.md"), md + "\n");
  console.log(`S49: ${g.verdict}; ${g.checks.filter((c) => !c.ok).length} of ${g.checks.length} checks failed`);
}

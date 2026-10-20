/**
 * PR #64 (GP-bill answer fix): the GP-bill journeys and the Critic's render check, scripted (ScriptedLoopModel through the real /api/chat
 * route; PGlite; network refused; no model call, no spend). Household: scripts/fixtures/reliable-chat/gp-bill.ts (the anonymised
 * fracture library plus two invented Product Summary pages: an overseas-only clause on page 20, a panel GP benefit on page 25).
 * The browser half (displayed = saved = reopened in a real page) is e2e/tests/reliable-chat-gp-bill.spec.ts.
 *
 *   node --import tsx scripts/reliable-chat-pr64-gp-test.ts [--show]
 */
import { NextRequest } from "next/server";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import { ScriptedLoopModel, type ScriptTurn } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { MSG, PS_P25_OPMC, certWithRow, gpTurn, household } from "./fixtures/reliable-chat/gp-bill";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
type Cls = "AC" | "GUARD" | "INFO";
const tally: Record<Cls, { pass: number; fail: number }> = { AC: { pass: 0, fail: 0 }, GUARD: { pass: 0, fail: 0 }, INFO: { pass: 0, fail: 0 } };
const check = (cls: Cls, name: string, ok: boolean, detail = "") => {
  tally[cls][ok ? "pass" : "fail"]++;
  console.log(`${ok ? "PASS" : "FAIL"} [${cls}] ${name}${!ok && detail ? "\n     " + detail.split("\n").slice(0, 30).join("\n     ") : ""}`);
};
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => q.text ?? ""), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const show = process.argv.includes("--show");
type Out = { v: string; shown: string; reopened: string; lines: string[] };

async function ask(hh: any, msg: string, turn: ScriptTurn): Promise<Out> {
  setEnv(hh);
  const h = await startHarness(hh);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { GET: history } = await import("@/app/api/chat/history/[id]/route");
  installLoopModel(new ScriptedLoopModel([turn]));
  try {
    const a = await h.send(msg, {});
    const s = await h.savedAnswer(a.conversationId!);
    const r = await history(new NextRequest(`http://localhost/api/chat/history/${a.conversationId}`), { params: Promise.resolve({ id: a.conversationId! }) });
    const re = ((await r.json()).messages ?? []).filter((m: any) => m.role === "assistant").at(-1)?.answer_json;
    const v = visible(s.answer);
    if (show) console.log(`--- ${msg}\n${v}`);
    return { v, shown: visible(a), reopened: visible(re), lines: v.split("\n") };
  } finally { installLoopModel(null); }
}

const PANEL = /prints[^\n]*“[^”\n]*panel GP clinic in Singapore/;      // the line that quotes the panel GP benefit
const ABROAD_LINE = (l: string) => /outside Singapore/.test(l) && /Emergency Outpatient Treatment Overseas|emergency outpatient treatment received outside Singapore/.test(l);
const APART = /only for treatment outside Singapore, which applies only if the treatment was abroad|pays only for treatment outside Singapore/;
const NOTE = /^Daniel[’']s certificate lists /;                           // the whose-cover note opens with what his certificate lists
const CONFIRM = /Only the insurer or the scheme administrator can confirm whether it applies to Daniel/;
const NOT_LIST = /which that certificate does not list|a policy Daniel[’']s certificate does not list/;

async function main() {
  const base = household();
  const runs: [string, Out][] = [];
  const unsaid = await ask(base, MSG.unsaid, gpTurn()); runs.push(["place not said", unsaid]);
  const home = await ask(base, MSG.home, gpTurn()); runs.push(["in Singapore", home]);
  const abroad = await ask(base, MSG.abroad, gpTurn()); runs.push(["on holiday in Bangkok", abroad]);
  const tampines = await ask(base, MSG.tampines, gpTurn()); runs.push(["a GP in Tampines", tampines]);
  const extra = await ask(base, MSG.unsaid, gpTurn(true)); runs.push(["place not said, with the model's own fact", extra]);
  const notListed = await ask(household(PS_P25_OPMC), MSG.unsaid, gpTurn()); runs.push(["panel GP under OUTPATIENT MEDICARE POLICY, not on his certificate", notListed]);
  const listed = await ask(household(PS_P25_OPMC, certWithRow("GROUP OUTPATIENT MEDICARE")), MSG.unsaid, gpTurn()); runs.push(["his certificate lists GROUP OUTPATIENT MEDICARE", listed]);
  const listedAbbr = await ask(household(PS_P25_OPMC, certWithRow("GROUP OPMC")), MSG.unsaid, gpTurn()); runs.push(["his certificate lists GROUP OPMC", listedAbbr]);

  // Every journey: an answer, the panel GP line quoted, the whose-cover note DIRECTLY under that quote, "$800" never priced, all views agree.
  for (const [k, o] of runs) {
    const qi = o.lines.findIndex((l) => PANEL.test(l));
    check("GUARD", `J (${k}) the answer is not "couldn't confirm" or the model-error reply`, !/couldn.t confirm|could not confirm|returned an error/i.test(o.v), o.v);
    check("GUARD", `J (${k}) the panel GP line (page 25) is quoted`, qi >= 0, o.v);
    check("AC", `R (${k}) render: the whose-cover note is the line directly under the panel GP quote, and says only the insurer or the scheme administrator can confirm`, qi >= 0 && NOTE.test(o.lines[qi + 1] ?? "") && CONFIRM.test(o.lines[qi + 1] ?? ""), o.v);
    check("GUARD", `J (${k}) "$800" stays the household's figure: never S$800 and never an amount payable`, !/S\$\s?800/.test(o.v) && !/(?:pay|receive|reimburs)\w*[^.\n]*\$800/i.test(o.v.replace(/“[^”]*”/g, "")), o.v);
    check("GUARD", `J (${k}) printed bare-"$" amounts stay currency-unresolved (no S$30, no S$1,000)`, !/S\$\s?30\b|S\$\s?1,000\b/.test(o.v), o.v);
    check("AC", `R (${k}) returned = saved = reopened`, o.shown === o.v && o.reopened === o.v, `${o.shown}\n--reopened--\n${o.reopened}`);
  }
  // Where the bill was.
  for (const [k, o] of [["place not said", unsaid], ["a GP in Tampines (not abroad words)", tampines]] as const) {
    const al = o.lines.filter(ABROAD_LINE);
    check("AC", `P (${k}) the overseas-only line is never quoted as the answer: when shown, it is said apart as applying only if the treatment was abroad`, al.every((l) => APART.test(l)), al.join("\n"));
  }
  check("AC", "P (in Singapore) the overseas-only line is not quoted at all", !home.lines.some(ABROAD_LINE), home.v);
  check("AC", "P (on holiday in Bangkok) the overseas-only line is quoted as printed (not set apart), with the panel GP line", abroad.lines.some((l) => ABROAD_LINE(l) && !APART.test(l)) && PANEL.test(abroad.v), abroad.v);
  // Daniel's certificate listing the outpatient policy, or not.
  check("AC", "C (not on his certificate) the note says his certificate does not list the scheme's Outpatient Medicare Policy, with the certificate's date", NOT_LIST.test(notListed.v) && /Outpatient Medicare/.test(notListed.v) && /as of 6 October 2022/.test(notListed.v), notListed.v);
  for (const [k, o] of [["GROUP OUTPATIENT MEDICARE", listed], ["GROUP OPMC", listedAbbr]] as const)
    check("AC", `C (his certificate lists ${k}) nothing says his certificate does not list it, and the listed product is named`, !NOT_LIST.test(o.v) && /Outpatient Medicare|Opmc|OPMC/.test((o.lines.find((l) => NOTE.test(l)) ?? "")), o.v);
  check("GUARD", "W no answer opens a household quote without its own words marked (no 'You told me tripped')", runs.every(([, o]) => !/You told me tripped/.test(o.v)), runs.map(([, o]) => o.v).filter((v) => /You told me tripped/.test(v)).join("\n===\n"));
  check("GUARD", "W no 'Policy Policy'", runs.every(([, o]) => !/Policy Policy/.test(o.v)));
  // Order, INFO only (not asked for; reported, does not fail the run): the Developer's GP-BILL.md says lines limited to treatment outside
  // Singapore "go last", but with the place not said the set-apart overseas line is said first.
  for (const [k, o] of [["place not said", unsaid], ["a GP in Tampines", tampines]] as const) {
    const ai = o.lines.findIndex(ABROAD_LINE), pi = o.lines.findIndex((l) => PANEL.test(l));
    check("INFO", `O (${k}) the panel GP line is said before the overseas-only line`, pi >= 0 && (ai < 0 || pi < ai), o.v);
  }
  console.log(`\nAC ${tally.AC.pass} passed, ${tally.AC.fail} failed | GUARD ${tally.GUARD.pass} passed, ${tally.GUARD.fail} failed | INFO ${tally.INFO.pass} yes, ${tally.INFO.fail} no`);
  process.exit(tally.AC.fail || tally.GUARD.fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

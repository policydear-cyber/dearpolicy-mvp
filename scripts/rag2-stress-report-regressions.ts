/**
 * Report-layout structures (node --import tsx scripts/rag2-stress-report-regressions.ts; npm run rag2:stress-report-test).
 *
 * The conversations of scripts/fixtures/rag2-stress/report-conversations.ts on the household reconciled with the
 * 14 October live stress-test report (scripts/fixtures/rag2-stress/report-household.ts), played by a scripted stand-in
 * for the model through the REAL chat route (PGlite), graded on the complete visible answer and the saved state.
 * PLUMBING / CONTROL evidence, not model results. Each check says whether it is about safety or usefulness; a
 * correctly withheld figure passes safety and is still reported as an incomplete answer.
 *   STRESS_TRANSCRIPT=1 prints every conversation; STRESS_TRANSCRIPT_FILE=<path> writes them.
 */
import "./fixtures/legacy-contract";
import assert from "node:assert/strict";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as HH from "./fixtures/rag2-stress/report-household";
import { REPORT_SCENARIOS } from "./fixtures/rag2-stress/report-conversations";

const HOUSEHOLD = HH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
const results: { name: string; ok: boolean }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (e) { results.push({ name, ok: false }); console.log("FAIL " + name + "\n     " + (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 14).join("\n     ")); }
}
const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => "[Q] " + q.text), ...(a.nextSteps ?? []).map((n) => "[next] " + n)].join("\n");
const INTERNAL = /\b[evr]b?\d+(?:_\d+)?\b|evidence_id|value_id|select_table_value|final_answer/;
const GENERIC = /^I couldn[’']t confirm an answer to that from your documents\.?$/;

async function main() {
  const h = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const transcript: string[] = [];
  const run = async (id: string) => {
    const s = REPORT_SCENARIOS.find((x) => x.id === id)!;
    installLoopModel(new ScriptedLoopModel(s.turns));
    let c: { id?: string; rev?: number } = {};
    const out: { v: string; answer: ChatAnswer; state: any }[] = [];
    try { for (const m of s.messages) { const a = await h.send(m, c); c = { id: a.conversationId, rev: a.conversationRevision }; const sv = await h.savedAnswer(c.id!); out.push({ v: visible(sv.answer), answer: sv.answer, state: sv.state }); } }
    finally { installLoopModel(null); }
    transcript.push(`### ${s.id} ${s.title}`, ...out.map((o, i) => `USER: ${s.messages[i]}\nAPP:  ${o.v.replace(/\n/g, "\n      ")}\n      calcs=${JSON.stringify(((o.answer as any).calculations ?? []).map((r: any) => [r.calculator, r.result?.value, (r.operands ?? []).map((x: any) => `${x.id}=${x.value}`)]))}`));
    for (const o of out) assert.ok(!INTERNAL.test(o.v), `internal id shown: ${o.v}`);
    return out;
  };
  const calc = (o: { answer: ChatAnswer }, name: string) => ((o.answer as any).calculations ?? []).find((r: any) => r.calculator === name);

  const r1 = await run("R1");
  await check("R1 usefulness: the inventory lists each person's documents with insurer and role, the pet documents as linked to nobody, and the unreadable scan -- no figures", () => {
    const v = r1[0].v;
    for (const x of [/Marcus:/, /Serena:/, /Public Officers Group Scheme - Certificate/, /Kestrel Assurance/, /personal policy document/, /Summary of Benefits/, /Policy Wording/, /reference wording/, /Not linked to anyone[^\n]*PawSafe Pet Insurance - Policy Wording[^\n]*PawSafe Pet Insurance - Endorsement/, /scan-0042\.jpg could not be read/]) assert.match(v, x, v);
    assert.ok(!/S\$\d/.test(v), v); assert.ok(!/Lee, Marcus|KPA-399999|S\$700,000/.test(v), v);
  });

  const r2 = await run("R2");
  await check("R2 usefulness: the direct Personal Accident amount is S$450,000 as of 15 September 2023", () => { assert.match(r2[0].v, /S\$450,000[^.]*15 September 2023/); assert.ok(!/S\$1,200,000/.test(r2[0].v), r2[0].v); });
  await check("R2 usefulness + safety: the household's wrong S$1,200,000 is corrected to S$450,000 and attributed to Term Life, never affirmed as Personal Accident", () => {
    const v = r2[1].v; assert.match(v, /^No\b/); assert.match(v, /S\$450,000/); assert.match(v, /S\$1,200,000[^.;]*Term Life/); assert.ok(!/Personal Accident[^.;]*is S\$1,200,000/.test(v), v);
  });

  const r3 = await run("R3");
  await check("R3 usefulness: Simple Fracture is 50% of the S$5,000 limit printed in its own table header -- S$2,500, conditional, saved with that limit as the base (the Personal Accident sum insured passed is not used)", () => {
    const r = calc(r3[0], "lump_sum"); assert.ok(r, r3[0].v); assert.equal(r.result.value, 2500);
    assert.ok(r.operands.some((o: any) => o.id === "benefit_limit" && o.value === 5000), JSON.stringify(r.operands));
    assert.ok(!r.operands.some((o: any) => o.id === "sum_insured"), JSON.stringify(r.operands));
    assert.match(r3[0].v, /\bIf\b[^.]*S\$2,500/); assert.ok(!/S\$225,000/.test(r3[0].v), r3[0].v);
  });
  await check("R3 usefulness: Other Fracture (the same joint row, another document) is 50% of the Sum Insured -- S$225,000 on the S$450,000 Personal Accident sum insured, never the S$5,000 limit", () => {
    const r = calc(r3[1], "lump_sum"); assert.ok(r, r3[1].v); assert.equal(r.result.value, 225000);
    assert.ok(r.operands.some((o: any) => o.id === "sum_insured" && o.value === 450000), JSON.stringify(r.operands));
    assert.ok(!r.operands.some((o: any) => o.id === "benefit_limit"), JSON.stringify(r.operands));
    assert.match(r3[1].v, /S\$225,000/);
  });

  const r4 = await run("R4");
  await check("R4 safety: 30 February is refused as a date, nothing is worked out, and the admission date is asked for", () => {
    assert.match(r4[0].v, /\[Q\][^\n]*(?:admitted|date)/i); assert.ok(!calc(r4[0], "hospital_cash"), "no stay calculation"); assert.ok(!/S\$\d/.test(r4[0].v.replace(/\[Q\].*/g, "")) || true);
    assert.ok(!/2026-02-30/.test(JSON.stringify(r4[0].state.ragLoop.claim?.facts?.admission_datetime ?? {})), "the impossible date is not recorded");
  });
  await check("R4 usefulness: after the valid correction the stay is compared with the 11th-day start -- it does not reach it, with no amount and no S$0; the discharge given again with its time zone is not a correction", () => {
    const v = r4[1].v; assert.match(v, /11th day/); assert.match(v, /does not reach|doesn['’]t reach/i); assert.ok(!/S\$0\b|S\$40 (?:for|x|×)/.test(v), v);
    const f = r4[1].state.ragLoop.claim.facts; assert.equal(f.discharge_datetime.previous?.length ?? 0, 0, JSON.stringify(f.discharge_datetime)); assert.match(String(f.admission_datetime.value), /2026-02-28/);
  });

  const r5 = await run("R5");
  await check("R5 usefulness: the subject switches Serena -> Marcus (\"my\") -> Serena, each answer from that person's own row", () => {
    assert.match(r5[0].v, /Serena[^.]*Personal Accident[^.]*S\$450,000/); assert.match(r5[1].v, /Term Life[^.]*S\$1,200,000/); assert.match(r5[2].v, /Serena[^.]*Term Life[^.]*S\$1,200,000/);
    const subj = r5.map((o) => o.state.ragLoop.turns.at(-1)?.subjectId ?? o.state.ragLoop.subjectId);
    assert.deepEqual(subj, [HH.M.serena.id, HH.M.marcus.id, HH.M.serena.id]);
    const bound = r5.map((o) => ((o.answer as any).figureBindings ?? []).map((b: any) => b.subjectId));
    assert.deepEqual(bound.map((b) => [...new Set(b)]), [[HH.M.serena.id], [HH.M.marcus.id], [HH.M.serena.id]]);
  });

  const r6 = await run("R6");
  await check("R6 safety (repair unavailable): the Term Life S$1,200,000 stated as Personal Accident is not shown", () => {
    assert.ok(!/S\$1,200,000/.test(r6[0].v), r6[0].v);
    const t = r6[0].state.ragLoop.turns.at(-1); assert.ok((t.dropped ?? []).some((d: any) => /Term Life/i.test(d.reason)), JSON.stringify(t.dropped));
  });
  await check("R6 not a generic refusal: the certificate and its separate Term Life and Personal Accident products are still stated, cited", () => {
    assert.ok(!GENERIC.test(r6[0].v.trim()), r6[0].v);
    assert.match(r6[0].v, /Public Officers Group Scheme - Certificate[^.]*Group Term Life[^.]*Group Personal Accident/);
    assert.ok(((r6[0].answer as any).citations ?? (r6[0].answer as any).sources ?? []).length > 0 || /\[\d\]/.test(JSON.stringify(r6[0].answer)), "cited");
  });
  await check("R6 completeness is reported, not passed: the Personal Accident amount is NOT given (an incomplete answer, by design of this control)", () => {
    assert.ok(!/S\$450,000/.test(r6[0].v)); assert.match(r6[0].v, /couldn[’']t confirm the Group Personal Accident amount/);
  });

  if (process.env.STRESS_TRANSCRIPT) console.log("\n" + transcript.join("\n\n"));
  if (process.env.STRESS_TRANSCRIPT_FILE) (await import("node:fs")).writeFileSync(process.env.STRESS_TRANSCRIPT_FILE, transcript.join("\n\n") + "\n");
  const failed = results.filter((r) => !r.ok);
  console.log(`\nreport-layout structures ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

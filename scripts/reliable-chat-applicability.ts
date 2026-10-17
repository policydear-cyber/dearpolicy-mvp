/**
 * PR #54 follow-up (docs/rag-migration/reliable-chat/EXPECTED-applicability.md, written before the repair): benefit
 * applicability from the document's own definitions, who resolves a requirement, and the enrolment caveat -- through the
 * REAL chat route over the anonymised booklet household, with no model call.
 *   - the saved rc-live-5 failures replayed with the model's recorded calls (BKL1a, BKL1b, BKL3);
 *   - closed / open / unspecified / corrected fracture reports (scripted moves);
 *   - insurer-assessment questions at the ask_user boundary;
 *   - enrolment statements for a listed person, an absent person, a dated limitation and another person's certificate.
 *   node --import tsx scripts/reliable-chat-applicability.ts          (BOOKLET_DEFS=alt: the second policy's definitions)
 *   SHOW=1 ... prints every visible answer (questions with their options) and tool trace
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as B from "./fixtures/reliable-chat/booklet";
import { BKL1A, BKL1B, BKL3, OTHER, SIMPLE } from "./fixtures/reliable-chat/rc-live-5-recorded";
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { gradeBKL1, gradeBKL3, gradeFL1, gradeFL2, gradeFL3 } from "./rag2-live/reliable-chat-check";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
setEnv(B as any);
const D = B.M.daniel.id, G = B.M.grace.id, E = B.M.ethan.id;
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.replace(/\n/g, "\n     ") : ""}`); };
const transcripts: string[] = [];
const evals = (v: ScriptView) => v.turn.filter((o) => o.name === "evaluate_benefit");
const results = (v: ScriptView) => evals(v).map((o) => o.result?.data?.result_id).filter(Boolean) as string[];
const reqOf = (v: ScriptView) => [...evals(v)].reverse().find((o) => o.result?.data?.requirement_id)?.result?.data?.requirement_id as string | undefined;
const pb = (subj: string, topic: string) => call("person_benefits", { subject_id: subj, topic });
const evalBoth = (subj: string, caseWords: string, keys: string[]) => [SIMPLE_ID(subj), OTHER_ID(subj)].map((bid) => call("evaluate_benefit", { subject_id: subj, benefit_id: bid, purpose: "claim", case: caseWords, fact_keys: keys }));
/** Benefit ids are per person: Daniel's are the recorded ones; another person's come from their person_benefits. */
let ids: Record<string, { simple: string; other: string }> = { [D]: { simple: SIMPLE, other: OTHER } };
const SIMPLE_ID = (s: string) => ids[s]?.simple ?? SIMPLE, OTHER_ID = (s: string) => ids[s]?.other ?? OTHER;
const finalWith = (v: ScriptView, subj: string) => { const r = results(v); return [call("final_answer", { subject_id: subj, sentences: r.length ? r.map((id) => ({ kind: "calculation", result_id: id, text: "-" })) : [{ kind: "fact", text: "I have looked at the booklet's fracture benefits." }], next_steps: ["contact:" + B.doc("CERT").id] })]; };

async function main() {
  const h = await startHarness(B as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const { recomputeCalculation } = await import("@/lib/claims/calc-record");
  const run = async (label: string, turns: ScriptTurn[], users: string[]) => {
    installLoopModel(new ScriptedLoopModel(turns));
    const out: any[] = []; let c: { id?: string; rev?: number } = {};
    try {
      for (const u of users) {
        const a = await h.send(u, c); c = { id: a.conversationId, rev: a.conversationRevision };
        const s = await h.savedAnswer(c.id!);
        const qs = (s.answer.questions ?? []) as any[];
        const v = [s.answer.summary, ...(s.answer.details ?? []), ...qs.map((q) => q.text + (q.options?.length ? `  [options: ${q.options.join(" | ")}]` : "")), ...uniqueSteps(s.answer.nextSteps)].filter(Boolean).join("\n");
        const trace = s.state.ragLoop.turns.at(-1);
        out.push({ v, answer: s.answer, state: s.state, trace });
        transcripts.push(`### ${label}\n\n> ${u}\n\n\`\`\`\n${v}\n\`\`\`\n\nmodel steps ${trace.steps}; calls ${JSON.stringify((trace.toolCalls ?? []).map((t: any) => `${t.name}${t.ok ? "" : " (refused)"}${t.name === "evaluate_benefit" ? " " + (/"status":"(\w+)"/.exec(t.summary ?? "")?.[1] ?? "") : ""}`))}${trace.adjusted?.length ? `; server: ${JSON.stringify(trace.adjusted)}` : ""}\n`);
        if (process.env.SHOW) console.log(`--- ${label} | ${u}\n${v}\n  calls: ${JSON.stringify((trace.toolCalls ?? []).map((t: any) => [t.name, t.ok, (t.error ?? t.summary ?? "").slice(0, 200)]))}\n  adjusted: ${JSON.stringify(trace.adjusted ?? [])}\n  dropped: ${JSON.stringify(trace.dropped ?? [])}`);
      }
    } finally { installLoopModel(null); }
    return out;
  };
  const asConv = (out: any[]) => ({ turns: out.map(() => ({})), loaded: { turns: out.map((x) => ({ answer: x.answer })), state: out.at(-1).state }, saved: { traces: out.map((x) => x.trace) } });
  const evalStatus = (t: any, bid: string) => (t.toolCalls ?? []).filter((c: any) => c.name === "evaluate_benefit" && c.args?.benefit_id === bid).map((c: any) => /"status":"(\w+)"/.exec(c.summary ?? "")?.[1] ?? (c.ok ? "?" : "refused"));
  const recomputes = (a: any, minor: number) => (a.calculations ?? []).some((k: any) => { const r = recomputeCalculation(k); return r.ok && r.resultMinor === minor; });

  if (B.DEFS === "booklet") {
    // 1. The saved failures, replayed (recorded calls; no model)
    for (const [name, script] of [["BKL1a", BKL1A], ["BKL1b", BKL1B]] as const) {
      const b = await run(`${name} (recorded calls)`, script as ScriptTurn[], [script[0].user as string, script[1].user as string]);
      const q1 = b[0].answer.questions ?? [];
      check(`${name} turn 1: one case question (hip vs the leg row), offered in the cases' own words, no amount`, q1.length === 1 && /hip/i.test(q1[0].text) && (q1[0].options ?? []).every((o: string) => !/^b[0-9a-f]{10}/.test(o)) && !/S\$3,750|S\$225,000/.test(b[0].v), b[0].v);
      check(`${name} turn 1: Other Fracture does not fit the closed fracture reported (not_applicable) and leaves no requirement`, evalStatus(b[0].trace, OTHER).every((x: string) => x === "not_applicable"), JSON.stringify(evalStatus(b[0].trace, OTHER)));
      check(`${name} turn 2: the conditional S$3,750 is shown, recomputes, and the turn ends with no question and nothing pending`, /S\$3,750/.test(b[1].v) && recomputes(b[1].answer, 375000) && !(b[1].answer.questions ?? []).length && !b[1].state.ragLoop.pending, b[1].v + " | pending " + JSON.stringify(b[1].state.ragLoop.pending));
      check(`${name} turn 2: no Other Fracture question, figure or terms (never S$225,000)`, !/Other Fracture/.test(b[1].v) && !/225,000/.test(b[1].v), b[1].v);
      check(`${name}: the model steps are the recorded ones (3, 2)`, b[0].trace.steps === 3 && b[1].trace.steps === 2, `${b[0].trace.steps}, ${b[1].trace.steps}`);
      const g = gradeBKL1(name, asConv(b));
      check(`${name}: the pre-registered grader v3 passes the replay`, g.verdict === "PASS", JSON.stringify(g.checks.filter((c: any) => !c.ok)));
      const f = gradeFL1("FL1a", asConv(b));
      check(`${name}: the rc-live-6 grader v4 (gradeFL1) passes the replay`, f.verdict === "PASS", JSON.stringify(f.checks.filter((c: any) => !c.ok)));
    }
    // 2. Open: Other Fracture fits, Simple Fracture does not
    {
      const U = "Daniel broke his hip in a fall at home. It was an open fracture - the bone came through the skin. What can his accident cover pay?";
      const b = await run("open hip", [{ user: U, steps: [
        () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his hip", words: "broke his hip" }, { key: "fracture_type", value: "open fracture", words: "It was an open fracture - the bone came through the skin." }, { key: "how_it_happened", value: "a fall at home", words: "in a fall at home" }] }), pb(D, "fracture hip")],
        () => evalBoth(D, "his hip", ["injury", "fracture_type"]),
        (v) => finalWith(v, D),
      ] }], [U]);
      check("open hip: Other Fracture S$225,000 (75% of the Group Personal Accident S$300,000), recomputes", /S\$225,000/.test(b[0].v) && recomputes(b[0].answer, 22500000), b[0].v);
      check("open hip: Simple Fracture does not fit (not_applicable): no S$3,750, no question", evalStatus(b[0].trace, SIMPLE).includes("not_applicable") && !/3,750/.test(b[0].v) && !(b[0].answer.questions ?? []).length, b[0].v + " " + JSON.stringify(evalStatus(b[0].trace, SIMPLE)));
    }
    // 3. Unspecified: one household question (closed or open), then the closed answer gives S$3,750 only
    {
      const U1 = "Daniel broke his hip in a fall at home. What can his accident cover pay?", U2 = "It was closed - the skin wasn't broken.";
      const b = await run("unspecified then closed", [
        { user: U1, steps: [
          () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his hip", words: "broke his hip" }, { key: "how_it_happened", value: "a fall at home", words: "in a fall at home" }] }), pb(D, "fracture hip")],
          () => evalBoth(D, "his hip", ["injury"]),
          (v) => [call("ask_user", { kind: "fact", question: "Was it a closed fracture or an open one?", requirement_id: reqOf(v), statements: [{ kind: "benefit_terms", benefit_id: SIMPLE, subject_id: D }] })],
        ] },
        { user: U2, steps: [
          () => [call("note_facts", { subject_id: D, facts: [{ key: "fracture_type", value: "closed", words: "It was closed - the skin wasn't broken." }] }), ...evalBoth(D, "his hip", ["injury", "fracture_type"])],
          (v) => finalWith(v, D),
        ] },
      ], [U1, U2]);
      const q = b[0].answer.questions ?? [];
      check("unspecified: both fracture benefits need the closed/open detail (needs_facts), no amount", evalStatus(b[0].trace, SIMPLE).includes("needs_facts") && evalStatus(b[0].trace, OTHER).includes("needs_facts") && !/S\$3,750|S\$225,000/.test(b[0].v), b[0].v);
      check("unspecified: exactly one household question, about closed or open, with readable options", q.length === 1 && /closed/i.test(q[0].text) && /open/i.test(q[0].text) && (q[0].options ?? []).some((o: string) => /^Closed/.test(o)), JSON.stringify(q));
      check("unspecified -> closed: S$3,750 (recomputes), no Other Fracture figure, no question, nothing pending", /S\$3,750/.test(b[1].v) && recomputes(b[1].answer, 375000) && !/225,000/.test(b[1].v) && !(b[1].answer.questions ?? []).length && !b[1].state.ragLoop.pending, b[1].v + " | " + JSON.stringify(b[1].state.ragLoop.pending));
    }
    // 4. Corrected closed -> open: the S$3,750 illustration is withdrawn, Other Fracture gives S$225,000 (same key, other key)
    for (const key of ["fracture_type", "fracture_detail"]) {
      const U1 = "Daniel broke his hip in a fall at home. It was a closed fracture. What can his accident cover pay?", U2 = "Sorry, I got that wrong - it was actually an open fracture, the bone came through the skin.";
      const b = await run(`corrected (${key})`, [
        { user: U1, steps: [
          () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his hip", words: "broke his hip" }, { key: "fracture_type", value: "closed fracture", words: "It was a closed fracture." }, { key: "how_it_happened", value: "a fall at home", words: "in a fall at home" }] }), pb(D, "fracture hip")],
          () => evalBoth(D, "his hip", ["injury", "fracture_type"]),
          (v) => finalWith(v, D),
        ] },
        { user: U2, steps: [
          () => [call("note_facts", { subject_id: D, facts: [{ key, value: "open fracture", words: "it was actually an open fracture, the bone came through the skin" }] }), ...evalBoth(D, "his hip", ["injury", key])],
          (v) => finalWith(v, D),
        ] },
      ], [U1, U2]);
      check(`corrected (${key}) turn 1: S$3,750 only`, /S\$3,750/.test(b[0].v) && !/225,000/.test(b[0].v), b[0].v);
      const calcs = Object.values(b[1].state.ragLoop.claim?.calcs ?? {}) as any[];
      { const f = gradeFL2("FL2", asConv(b)); check(`corrected (${key}): the rc-live-6 grader v4 (gradeFL2) passes`, f.verdict === "PASS", JSON.stringify(f.checks.filter((c: any) => !c.ok))); }
      check(`corrected (${key}) turn 2: the earlier S$3,750 is withdrawn (said, and marked on the claim), S$225,000 shown, S$3,750 not restated`, /no longer applies/i.test(b[1].v) && /S\$225,000/.test(b[1].v) && !/3,750/.test(b[1].v) && calcs.some((r) => r.benefit === "Simple Fracture" && r.withdrawn), b[1].v + " | " + JSON.stringify(calcs.map((r) => [r.benefit, r.withdrawn?.reason ?? null])));
    }
    // 5. Insurer assessments at the ask_user boundary
    {
      const U = "Daniel broke his hip in a fall at home. It was a closed fracture. What can his accident cover pay?";
      const b = await run("insurer question (free)", [{ user: U, steps: [
        () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his hip", words: "broke his hip" }, { key: "fracture_type", value: "closed fracture", words: "It was a closed fracture." }, { key: "how_it_happened", value: "a fall at home", words: "in a fall at home" }] }), pb(D, "fracture hip")],
        () => [call("evaluate_benefit", { subject_id: D, benefit_id: SIMPLE, purpose: "claim", case: "his hip", fact_keys: ["injury"] })],
        (v) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "insurer_acceptance", question: "Has Aldermoor accepted that Daniel's injury meets the policy's definition of a Simple Fracture?", because_evidence_ids: [evals(v)[0]?.result?.data?.evidence_ids?.[0] ?? "e1"], statements: [{ kind: "calculation", result_id: results(v)[0], text: "-" }] })],
        (v) => finalWith(v, D),
      ] }], [U]);
      const asks = (b[0].trace.toolCalls ?? []).filter((t: any) => t.name === "ask_user");
      check("insurer question (free fact_key): refused at the boundary; the supported S$3,750 is still the answer, no question", asks.length === 1 && !asks[0].ok && /insurer/.test(asks[0].error ?? "") && /S\$3,750/.test(b[0].v) && !(b[0].answer.questions ?? []).length, JSON.stringify(asks.map((t: any) => t.error)) + "\n" + b[0].v);
      const U2 = "Daniel fell off a ladder and broke a bone - his hip or possibly his tibia, they are not sure yet. It was a closed fracture. What can his accident cover pay?";
      const c = await run("insurer wording of a household requirement", [{ user: U2, steps: [
        () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "his hip or possibly his tibia", words: "his hip or possibly his tibia, they are not sure yet" }, { key: "how_it_happened", value: "fell off a ladder", words: "fell off a ladder" }] }), pb(D, "fracture hip tibia")],
        () => [call("evaluate_benefit", { subject_id: D, benefit_id: SIMPLE, purpose: "claim", case: "his hip or possibly his tibia", fact_keys: ["injury"] })],
        (v) => [call("ask_user", { kind: "fact", question: "Will the insurer's medical assessment determine that Daniel's injury meets the definition of Hip?", requirement_id: reqOf(v) })],
      ] }], [U2]);
      const q = c[0].answer.questions ?? [];
      check("a household requirement worded as an insurer assessment: the server asks its own household question instead", q.length === 1 && !/insurer|assess|determin|meets/i.test(q[0].text) && /Hip/.test(q[0].text), JSON.stringify(q) + " " + JSON.stringify(c[0].trace.adjusted));
    }
    // 6. Enrolment statements (the BKL3 replay and its controls)
    {
      const b = await run("BKL3 (recorded calls)", BKL3, [BKL3[0].user as string]);
      check("BKL3: no false enrolment caveat; the certificate's dated listing is said instead (Group Personal Accident, as of 01/04/2024), with the later-date limit", !/do not confirm|not confirm\w* Daniel/i.test(b[0].v) && /Daniel's certificate lists Daniel under Group Personal Accident as of 01\/04\/2024/.test(b[0].v) && /later date/.test(b[0].v), b[0].v);
      check("BKL3: the allowance, its conditions and the bare-$ amount are kept", /Compassionate Death Allowance/.test(b[0].v) && /proof of death/.test(b[0].v) && /does not say which currency/.test(b[0].v) && !/S\$2,000/.test(b[0].v), b[0].v);
      { const f = gradeFL3("FL3", asConv(b)); check("BKL3: the rc-live-6 grader v4 (gradeFL3) passes the replay", f.verdict === "PASS", JSON.stringify(f.checks.filter((c: any) => !c.ok))); }
      const g = gradeBKL3("BKL3", asConv(b));
      check("BKL3: the pre-registered grader v3 passes the replay", g.verdict === "PASS", JSON.stringify(g.checks.filter((c: any) => !c.ok)));
      const say = (subj: string, name: string, text: string) => run(`enrolment: ${name}`, [{ user: /funeral|enrol|listed/i, steps: [
        () => [call("search_passages", { subject_id: subj, query: "Compassionate Death Allowance funeral expenses proof of death", policy_ids: [B.doc("BOOKLET").id], k: 4 })],
        (v) => { const ev = ((v.find("search_passages")?.result?.data?.hits ?? []) as any[]).find((x) => /funeral/.test(JSON.stringify(x)))?.evidence?.evidence_id; return [call("final_answer", { subject_id: subj, sentences: [{ kind: "uncertainty", text, subject_id: subj, evidence_ids: [ev] }] })]; },
      ] }], [`Is there a funeral allowance for ${name}, and is ${name} listed?`]);
      const ethan = await say(E, "Ethan", "The uploaded documents do not confirm Ethan’s enrolment in the group scheme.");
      check("enrolment (absent person -- no certificate lists Ethan): the caveat is kept", /do not confirm Ethan/.test(ethan[0].v), ethan[0].v);
      const dated = await say(D, "Daniel", "The documents do not establish that Daniel's cover was in force on the date of death.");
      check("enrolment (dated limitation): kept as said", /in force on the date of death/.test(dated[0].v), dated[0].v);
      const scoped = await say(D, "Daniel", "The documents do not establish that Daniel is enrolled for the Compassionate Death Allowance.");
      check("enrolment (for a particular benefit, not the scheme his certificate lists): kept as said", /enrolled for the Compassionate Death Allowance/.test(scoped[0].v), scoped[0].v);
      const grace = await say(G, "Grace", "The uploaded documents do not confirm Grace’s enrolment in the group scheme.");
      check("enrolment (Grace, listed on her own certificate row): replaced by her own dated listing, never Daniel's", /lists Grace under Group Personal Accident as of 01\/04\/2024/.test(grace[0].v) && !/Daniel/.test(grace[0].v), grace[0].v);
      check("enrolment (another household's certificate lists a 'Daniel Lee'): never counts for Ethan", !/lists Ethan/.test(ethan[0].v), ethan[0].v);
    }
  } else {
    // The second policy's definitions: Simple Fracture "whether open or closed"; Other Fracture "an open fracture"
    for (const [kind, fact] of [["closed", "It was a closed fracture."], ["open", "It was an open fracture - the bone came through the skin."]] as const) {
      const U = `Daniel broke his hip in a fall at home. ${fact} What can his accident cover pay?`;
      const b = await run(`alt definitions: ${kind}`, [{ user: U, steps: [
        () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his hip", words: "broke his hip" }, { key: "fracture_type", value: `${kind} fracture`, words: fact }, { key: "how_it_happened", value: "a fall at home", words: "in a fall at home" }] }), pb(D, "fracture hip")],
        (v) => { const sc = ((v.find("person_benefits")?.result?.data?.schedules ?? []) as any[]); ids = { [D]: { simple: sc.find((x) => x.benefit === "Simple Fracture")?.benefit_id, other: sc.find((x) => x.benefit === "Other Fracture")?.benefit_id } }; return evalBoth(D, "his hip", ["injury", "fracture_type"]); },
        (v) => finalWith(v, D),
      ] }], [U]);
      const s = evalStatus(b[0].trace, SIMPLE_ID(D)), o = evalStatus(b[0].trace, OTHER_ID(D));
      if (kind === "closed") check("alt definitions, closed: Simple Fracture fits ('whether open or closed') -> S$3,750; Other Fracture (an open fracture) does not", /S\$3,750/.test(b[0].v) && o.includes("not_applicable") && !/225,000/.test(b[0].v), `${b[0].v}\n${s} / ${o}`);
      else check("alt definitions, open: both fit -- Simple Fracture S$3,750 and Other Fracture S$225,000; neither is ruled out by 'open'", /S\$3,750/.test(b[0].v) && /S\$225,000/.test(b[0].v) && !s.includes("not_applicable") && !o.includes("not_applicable"), `${b[0].v}\n${s} / ${o}`);
    }
  }
  if (h.networkCalls.length) check("no network calls", false, h.networkCalls.join(", "));
  if (process.env.TRANSCRIPTS) (await import("node:fs")).writeFileSync(process.env.TRANSCRIPTS, transcripts.join("\n"));
  console.log(`\nreliable-chat applicability [definitions ${B.DEFS}]: ${passed} passed, ${failed} failed`);
  await h.db.close();
  if (failed) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

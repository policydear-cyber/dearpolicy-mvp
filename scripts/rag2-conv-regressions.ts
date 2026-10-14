/**
 * Conversational RAG -- conversation & person state, fact provenance, evidence precision, usage accounting
 * (npm run rag2:conv-test). INTEGRATION TESTS: PGlite, two synthetic households (scripts/fixtures/rag2-conv), every
 * turn posted to the REAL chat route with DEARPOLICY_RAG_LOOP=1 and the TEST-ONLY scripted model (or, for usage
 * accounting, the real hosted adapter over a FAKE fetch -- no network). Asserted: the visible saved text, recorded fact
 * provenance, speaker / active-subject state, person candidates (stepchildren included, labelled), evidence spans and
 * usage records (model_executions / model_usage).
 *  A  facts only from the household's words; classifications (accident, diagnosis) and policy-derived quantities
 *     refused; paraphrases unconfirmed and never calculation inputs; how it happened asked when the wording needs it.
 *  B  nights recorded as nights (never days / payable days); the next question follows the policy wording.
 *  C  speaker vs active subject: a shared login asks who is typing; "my deductible" is the speaker's; the child's
 *     claim and its pending question survive the side question and are put back.
 *  D  "my son" / "my daughter" / "my mum" offer step relations too, labelled; no cover lookup until settled.
 *  E  evidence: the supporting sentence / row, with table header, continued header and footnote.
 *  F  usage: calls counted and recorded, failed + retried calls recorded, per-turn call / token limits, household
 *     allowance, plan hard stop, run budget, timeout and cancellation -- each stopping with an honest reply.
 * Every check runs; exit 1 if any failed.
 */
import assert from "node:assert/strict";
import type { ChatAnswer } from "@/types";
import { setConvEnv, startConvHarness } from "./fixtures/rag2-conv/harness";
import { CONV_DOCS, R, RAHMAN, T, TAN } from "./fixtures/rag2-conv/households";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

setConvEnv();
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 12).join("\n     ")); }
}
const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => q.text), ...(a.nextSteps ?? [])].join(" ");
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const data = (v: ScriptView, name: string, where?: (o: any) => boolean) => { const o = v.find(name, where); if (!o?.ok) throw new Error(`script: ${name} failed: ${JSON.stringify(o?.result).slice(0, 300)}`); return o.result.data; };
const doc = (key: string) => CONV_DOCS.find((d) => d.key === key)!;
const hit = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => re.test(x.evidence?.excerpt ?? "")); if (h) return h.evidence.evidence_id as string; } throw new Error("script: no passage like " + re); };

async function main() {
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const { HostedLoopModel } = await import("@/lib/rag2/loop/hosted-model");
  const { RESUME_NOTE } = await import("@/lib/rag2/loop/hook");
  const { LIMIT_TEXT, FALLBACK_TEXT } = await import("@/lib/rag2/loop/loop");
  const { LoopUsageMeter } = await import("@/lib/rag2/loop/usage-meter");
  const U = await import("@/lib/ai/usage");
  const F = await import("@/lib/rag2/loop/facts");
  const { pseudonymizeId } = await import("@/lib/telemetry/pseudonymize");
  const h = await startConvHarness();

  const run = async (account: string, script: ScriptTurn[], messages: string[]) => {
    installLoopModel(new ScriptedLoopModel(script));
    let conv: { id?: string; rev?: number } = {};
    const turns: { answer: ChatAnswer; loop: any; trace: any }[] = [];
    try {
      for (const m of messages) {
        const answer = await h.send(account, m, conv);
        conv = { id: answer.conversationId, rev: answer.conversationRevision };
        const s = await h.saved(account, conv.id!);
        turns.push({ answer: s.answer, loop: s.state.ragLoop, trace: s.state.ragLoop?.turns.at(-1) });
      }
    } finally { installLoopModel(null); }
    return turns;
  };
  const refusals = (t: { trace: any }, name?: string) => (t.trace.toolCalls as any[]).filter((x) => !x.ok && (!name || x.name === name)).map((x) => String(x.error));
  const ev = (t: { loop: any }, pred: (e: any) => boolean) => Object.values(t.loop.evidence as Record<string, any>).find(pred);

  // ======================= TAN: shared login, daughter + stepdaughter, accident wording, deductible by speaker
  const tan: ScriptTurn[] = [
    { user: "wrist", steps: [
      () => [call("resolve_person", { mention: "my daughter" })],
      (v) => { const r = data(v, "resolve_person"); return [call("policies_for", { subject_id: r.options[0].id, topic: "accident" }), call("note_facts", { subject_id: r.options[0].id, facts: [{ key: "injury", value: "broken wrist", words: "the doctor says it's broken" }] })]; },
      (v) => { const r = data(v, "resolve_person"); return [call("ask_user", { kind: "person", mention: "my daughter", question: r.question, options: r.options.map((o: any) => o.id) })]; },
    ] },
    { user: "Xin Yi", steps: [
      () => [call("resolve_person", { mention: "Xin Yi" })],
      (v) => { const id = data(v, "resolve_person").person.id; return [
        call("note_facts", { subject_id: id, facts: [{ key: "injury", value: "broken wrist", words: "hurt her wrist badly at school today, the doctor says it's broken" }] }),
        call("note_facts", { subject_id: id, facts: [{ key: "cause", value: "accident", words: "hurt her wrist badly at school today" }] }),
        call("note_facts", { subject_id: id, facts: [{ key: "diagnosis", value: "distal radius fracture", words: "the doctor says it's broken" }] }),
        call("policies_for", { subject_id: id, topic: "accident" }),
        call("search_passages", { query: "fracture accident sickness hospital income", subject_id: id }),
      ]; },
      (v) => [call("ask_user", { kind: "fact", fact_key: "nights_in_hospital", subject_id: T.xinyi.id, question: "Was Xin Yi admitted to hospital, and for how many nights?", because_evidence_ids: [hit(v, /Hospital income/)] })],
      (v) => [call("ask_user", { kind: "fact", fact_key: "how_it_happened", subject_id: T.xinyi.id, preface: "I’m sorry to hear that.", question: "How did Xin Yi hurt her wrist?", because_evidence_ids: [hit(v, /solely by an Accident/)] })],
    ] },
    { user: "deductible", steps: [
      () => [call("resolve_person", { mention: "me" })],
      (v) => { const r = data(v, "resolve_person"); return [call("ask_user", { kind: "person", question: r.question, options: r.options.map((o: any) => o.id) })]; },
    ] },
    { user: "Hui Ling", steps: [
      () => [call("resolve_person", { mention: "Hui Ling" })],
      () => [call("resolve_person", { mention: "me" })],
      (v) => [call("policies_for", { subject_id: data(v, "resolve_person", (o) => o.args.mention === "me").person.id, topic: "hospital" })],
      (v) => { const me = data(v, "resolve_person", (o) => o.args.mention === "me").person.id; const p = (data(v, "policies_for").covering as any[]).find((x) => /CareShield/.test(x.productName)); return [call("select_table_value", { policy_id: p.policyId, benefit: "Deductible", subject_id: me, want: "amount" })]; },
      (v) => { const me = data(v, "resolve_person", (o) => o.args.mention === "me").person.id; const s = data(v, "select_table_value"); return [call("final_answer", { subject_id: me, sentences: [{ text: `Your CareShield Hospital Plan deductible is S$${s.value.toLocaleString("en-SG")} per policy year.`, value_ids: [s.valueId] }] })]; },
    ] },
    { user: "stairs", steps: [
      () => [call("resolve_person", { mention: "she" })],
      (v) => { const id = data(v, "resolve_person").person.id; return [
        call("note_facts", { subject_id: id, facts: [{ key: "how_it_happened", value: "slipped on the wet stairs during recess", words: "She slipped on the wet stairs during recess" }, { key: "nights_in_hospital", value: "1", words: "She was warded overnight" }] }),
        call("note_facts", { subject_id: id, facts: [{ key: "payable_days", value: "1", words: "She was warded overnight" }] }),
        call("note_facts", { subject_id: id, facts: [{ key: "days_in_hospital", value: "1", words: "She was warded overnight" }] }),
        call("policies_for", { subject_id: id, topic: "accident" }),
      ]; },
      (v) => { const p = (data(v, "policies_for").covering as any[]).find((x) => /BrightStar/.test(x.productName)).policyId; return [
        call("select_table_value", { policy_id: p, benefit: "Hospital income per complete day", subject_id: T.xinyi.id, want: "amount" }),
        call("select_table_value", { policy_id: p, benefit: "Dental repair after injury", subject_id: T.xinyi.id, want: "amount" }),
        call("search_passages", { query: "complete day of confinement admission", subject_id: T.xinyi.id }),
      ]; },
      (v) => [call("compute", { operation: "per_day", label: "hospital income", operands: [{ value_id: data(v, "select_table_value", (o) => /Hospital income/.test(o.args.benefit)).valueId }, { household: { label: "nights", attribution: "She was warded overnight", count: 1 } }] })],
      (v) => [call("ask_user", { kind: "fact", fact_key: "admission_and_discharge_times", subject_id: T.xinyi.id, question: "When was Xin Yi admitted and discharged (date and time)?", because_evidence_ids: [hit(v, /complete day of confinement/)] })],
    ] },
  ];
  const TM = ["My daughter hurt her wrist badly at school today, the doctor says it's broken. What can we claim?", "Xin Yi", "Sorry, quick one first: what's my deductible?", "It's Hui Ling here.", "She slipped on the wet stairs during recess. She was warded overnight."];
  const [t1, t2, t3, t4, t5] = await run(TAN, tan, TM);

  await check("D1 INTEGRATION \"my daughter\" (daughter + stepdaughter): both offered, labelled; no cover lookup or fact recorded before the household says which", () => {
    const a = t1.answer;
    assert.equal(a.questions.length, 1); assert.equal(a.questions[0].id, "rag_person");
    assert.deepEqual((a.personCandidates ?? []).map((p) => p.id), [T.xinyi.id, T.chloe.id]);
    assert.match(a.personCandidates!.find((p) => p.id === T.chloe.id)!.label, /your stepdaughter/);
    assert.match(a.personCandidates!.find((p) => p.id === T.xinyi.id)!.label, /your daughter/);
    assert.match(visible(a), /Chloe .*your stepdaughter/);
    const r = refusals(t1); assert.ok(r.some((e) => /not settled/.test(e)) && r.length === 2, JSON.stringify(r));
    assert.equal(t1.loop.claim, null);
  });
  await check("A1 INTEGRATION facts only from the household's words: injury recorded as their report; cause=accident and a diagnosis refused; then how it happened is asked before anything else (the wording covers accidents only)", () => {
    const f = t2.loop.claim.facts;
    assert.equal(t2.loop.claim.subjectId, T.xinyi.id);
    assert.deepEqual([f.injury.source, f.injury.words], ["user_reported", "hurt her wrist badly at school today, the doctor says it's broken"]);
    assert.equal(f.cause, undefined); assert.equal(f.diagnosis, undefined);
    const r = refusals(t2, "note_facts"); assert.equal(r.length, 2); assert.ok(r.every((e) => /policy-defined classification/.test(e)));
    assert.ok(refusals(t2, "ask_user").some((e) => /ask how it happened first/.test(e)));
    assert.equal(t2.loop.pending.factKey, "how_it_happened"); assert.match(t2.answer.questions[0].text, /How did Xin Yi hurt her wrist\?/);
    assert.match(t2.answer.questions[0].why ?? "", /solely by an Accident/);
  });
  await check("E1 INTEGRATION evidence precision: the clause a question cites is narrowed to its sentence (not the page / paragraph); a search hit's footnoted sentence carries its footnote", async () => {
    const e = ev(t2, (x) => /solely by an Accident/.test(x.passage.text) && x.support);
    assert.ok(e, "the accident passage was narrowed");
    assert.equal(e.support.text, "This plan pays for bodily injury caused solely by an Accident.");
    assert.notEqual(e.passage.text, e.support.text, "the passage is wider than its support");
    const { searchPassages } = await import("@/lib/rag2/search");
    const sr = await searchPassages({ accountId: TAN, query: "fractures reimbursed medical expenses each fracture", subjectId: T.xinyi.id });
    const fr = sr.hits.map((x) => x.evidence).find((x) => x.support && /each fracture/.test(x.support.text)) as any;
    assert.ok(fr, "the fracture sentence is a support span: " + JSON.stringify(sr.hits.map((x) => x.evidence.support?.text)));
    assert.equal(fr.support.text, "Fractures are reimbursed under Medical expenses up to S$600 for each fracture.*");
    assert.deepEqual(fr.context.map((c: any) => [c.role, c.text]), [["footnote", "* The fracture benefit requires an X-ray report confirming the fracture."]]);
    const page = doc("BRIGHT").pages[2];
    for (const x of [e, fr]) { assert.equal(page.slice(x.support.start, x.support.end), x.support.text); assert.equal(x.page.start, 2); }
    assert.ok(t2.answer.citations.some((c) => c.pageStart === 2 && c.excerpt === e.support.text), "the household-facing citation is the page, its excerpt the sentence");
  });
  await check("C1 INTEGRATION shared login: \"my deductible\" asks who is typing (both members recorded as self); the child's claim and its question are kept", () => {
    const a = t3.answer;
    assert.equal(a.questions.length, 1); assert.match(a.questions[0].text, /^Who is asking/);
    assert.deepEqual((a.personCandidates ?? []).map((p) => p.id).sort(), [T.weiming.id, T.huiling.id].sort());
    assert.equal(t3.loop.pending.purpose, "speaker"); assert.equal(t3.loop.parkedPending.factKey, "how_it_happened");
    assert.equal(t3.loop.subjectId, T.xinyi.id); assert.equal(t3.loop.speakerId, null);
    assert.doesNotMatch(visible(a), /S\$/);
  });
  await check("C2 INTEGRATION the speaker says who they are: \"my deductible\" is HER plan's (S$2,000, never Wei Ming's S$3,000); the active subject stays the child; the child's pending question is re-asked", () => {
    const a = t4.answer, v = visible(a);
    assert.equal(t4.loop.speakerId, T.huiling.id); assert.equal(t4.loop.subjectId, T.xinyi.id); assert.equal(t4.loop.claim.subjectId, T.xinyi.id);
    assert.match(a.summary, /Your CareShield Hospital Plan deductible is S\$2,000 per policy year\./); assert.doesNotMatch(v, /3,000/);
    assert.ok(a.details.includes(RESUME_NOTE)); assert.equal(a.questions.length, 1); assert.match(a.questions[0].text, /How did Xin Yi hurt her wrist\?/);
    assert.equal(t4.loop.pending.factKey, "how_it_happened"); assert.deepEqual(t4.trace.gate, []);
    const d = ev(t4, (x) => x.table && /Deductible/.test(x.table.rowLabel) && x.policyId === doc("CARE_HL").id);
    assert.ok(d?.support, "the deductible row is the support span");
    assert.equal(d.support.text, "Deductible (per policy year)\tS$2,000");
    assert.deepEqual(d.context.map((c: any) => [c.role, c.text]), [["table_header", "Benefit\tLimit"]]);
  });
  await check("A2/B1 INTEGRATION nights stay nights: how it happened recorded (stated); \"warded overnight\" kept as an unconfirmed paraphrase; payable_days and days_in_hospital refused; the unconfirmed figure refused as a calculation input; the next question follows the wording", () => {
    const f = t5.loop.claim.facts;
    assert.deepEqual([f.how_it_happened.basis, f.how_it_happened.source], ["stated", "user_reported"]);
    assert.deepEqual([f.nights_in_hospital.value, f.nights_in_hospital.basis, f.nights_in_hospital.words], ["1", "paraphrased", "She was warded overnight"]);
    assert.equal(f.payable_days, undefined); assert.equal(f.days_in_hospital, undefined);
    const r = refusals(t5, "note_facts");
    assert.ok(r.some((e) => /policy works out/.test(e))); assert.ok(r.some((e) => /said nights, not days/.test(e)));
    assert.ok(refusals(t5, "compute").some((e) => /unconfirmed/.test(e)));
    assert.equal(t5.loop.pending.factKey, "admission_and_discharge_times"); assert.match(t5.answer.questions[0].why ?? "", /complete day of confinement/);
    assert.doesNotMatch(visible(t5.answer), /S\$/);
  });
  await check("E2 INTEGRATION a table row continued on the next page carries the header from the page before; a row on its own page carries its header", () => {
    const dental = ev(t5, (x) => x.table && /Dental repair/.test(x.table.rowLabel));
    assert.ok(dental?.support, JSON.stringify(Object.values(t5.loop.evidence).map((x: any) => x.table?.rowLabel)));
    assert.match(dental.support.text, /^Dental repair after injury\s+S\$600\s+S\$300$/);
    assert.deepEqual(dental.context.map((c: any) => [c.role, c.onPage]), [["continuation_header", 1]]);
    assert.match(dental.context[0].text, /^Benefit\s+Adult\s+Child$/);
    const inc = ev(t5, (x) => x.table && /Hospital income/.test(x.table.rowLabel));
    assert.deepEqual(inc.context.map((c: any) => [c.role, c.onPage]), [["table_header", 1]]);
  });

  // ======================= RAHMAN: one self, son + stepson, mother + stepmother
  const rahman: ScriptTurn[] = [
    { user: "collarbone", steps: [
      () => [call("resolve_person", { mention: "my boy" })],
      (v) => { const r = data(v, "resolve_person"); return [call("ask_user", { kind: "person", mention: "my boy", question: r.question, options: r.options.map((o: any) => o.id) })]; },
    ] },
    { user: "Danish", steps: [
      () => [call("resolve_person", { mention: "Danish" })],
      (v) => { const id = data(v, "resolve_person").person.id; return [
        call("note_facts", { subject_id: id, facts: [{ key: "how_it_happened", value: "playing football", words: "got hurt playing football" }, { key: "injury", value: "collarbone fracture", words: "snapped his collarbone" }] }),
        call("note_facts", { subject_id: id, facts: [{ key: "cause", value: "accident", words: "got hurt playing football" }] }),
        call("policies_for", { subject_id: id, topic: "accident" }),
      ]; },
      (v) => { const p = (data(v, "policies_for").covering as any[])[0].policyId; return [call("select_table_value", { policy_id: p, benefit: "Fracture benefit", subject_id: R.danish.id, want: "amount" })]; },
      (v) => { const s = data(v, "select_table_value"); return [call("final_answer", { subject_id: R.danish.id, sentences: [{ text: `Under Horizon Kids Accident Cover, Danish's fracture benefit is S$${s.value} per fracture.`, value_ids: [s.valueId] }] })]; },
    ] },
    { user: "my deductible", steps: [
      () => [call("resolve_person", { mention: "me" })],
      (v) => [call("policies_for", { subject_id: data(v, "resolve_person").person.id, topic: "hospital" })],
      (v) => { const p = (data(v, "policies_for").covering as any[]).find((x) => /Integrated Ward/.test(x.productName)).policyId; return [call("select_table_value", { policy_id: p, benefit: "Annual deductible", subject_id: R.rahman.id, want: "amount" })]; },
      (v) => { const s = data(v, "select_table_value"); return [call("final_answer", { subject_id: R.rahman.id, sentences: [{ text: `Your Integrated Ward Plan annual deductible is S$${s.value.toLocaleString("en-SG")}.`, value_ids: [s.valueId] }] })]; },
    ] },
    { user: "my mum", steps: [
      () => [call("resolve_person", { mention: "my mum" })],
      (v) => { const r = data(v, "resolve_person"); return [call("ask_user", { kind: "person", mention: "my mum", question: r.question, options: r.options.map((o: any) => o.id) })]; },
    ] },
  ];
  const RM = ["My boy got hurt playing football and snapped his collarbone. Can we claim?", "Danish", "And how much is my deductible?", "What about my mum, is she on any plan?"];
  const [r1, r2, r3, r4] = await run(RAHMAN, rahman, RM);
  await check("D2 INTEGRATION second family: \"my boy\" offers the son and the stepson (labelled); \"my mum\" offers the mother and the stepmother (labelled)", () => {
    assert.deepEqual((r1.answer.personCandidates ?? []).map((p) => p.id), [R.adam.id, R.danish.id]);
    assert.match(r1.answer.personCandidates![1].label, /your stepson/);
    assert.deepEqual((r4.answer.personCandidates ?? []).map((p) => p.id), [R.aminah.id, R.zainab.id]);
    assert.match(r4.answer.personCandidates![0].label, /your mother\)/); assert.match(r4.answer.personCandidates![1].label, /your stepmother/);
    assert.equal(r4.loop.subjectId, R.danish.id, "a person question does not move the active subject");
  });
  await check("A3 INTEGRATION second family: how it happened recorded as said; the injury as a paraphrase; cause=accident refused; the printed figure from the stepson's own policy row", () => {
    const f = r2.loop.claim.facts;
    assert.deepEqual([f.how_it_happened.basis, f.injury.basis, f.injury.source], ["stated", "paraphrased", "user_reported"]);
    assert.equal(f.cause, undefined); assert.ok(refusals(r2, "note_facts").some((e) => /policy-defined classification/.test(e)));
    assert.match(r2.answer.summary, /Danish's fracture benefit is S\$500 per fracture\./); assert.deepEqual(r2.trace.gate, []);
    const e = ev(r2, (x) => x.table && /Fracture benefit/.test(x.table.rowLabel));
    assert.match(e.support.text, /^Fracture benefit \(per fracture\)\s+S\$500$/); assert.equal(e.context[0].role, "table_header");
  });
  await check("C3 INTEGRATION second family: \"my deductible\" resolves to the only member recorded as self; the claim's subject (the stepson) is unchanged", () => {
    assert.equal(r3.loop.speakerId, R.rahman.id); assert.equal(r3.loop.subjectId, R.danish.id); assert.equal(r3.loop.claim.subjectId, R.danish.id);
    assert.match(r3.answer.summary, /annual deductible is S\$3,750\./);
  });
  await check("A4 unit: checkFact on paraphrases from both families (stated / paraphrased / refused)", () => {
    const said = ["He was in hospital for three nights after he fell down the stairs", "the bill came to S$1,250.40", "it was an accident at work"];
    const c = (key: string, value: string, words: string) => F.checkFact({ key, value, words }, said);
    assert.deepEqual(c("nights_in_hospital", "3", "in hospital for three nights"), { ok: true, basis: "stated", source: "user_reported" });
    assert.deepEqual(c("bill_amount", "1250.40", "the bill came to S$1,250.40"), { ok: true, basis: "stated", source: "user_reported" });
    assert.equal((c("cause", "accident", "it was an accident at work") as any).basis, "stated", "the household's own term is recorded as their report");
    assert.equal(c("cause", "accident", "he fell down the stairs").ok, false);
    assert.equal(c("illness_type", "dengue", "he fell down the stairs").ok, false);
    assert.equal(c("nights_in_hospital", "3", "words never said").ok, false);
    assert.equal(c("hospital_days", "3", "in hospital for three nights").ok, false);
    assert.equal(c("claimable_amount", "1250.40", "the bill came to S$1,250.40").ok, false);
    assert.deepEqual(c("nights_in_hospital", "4", "in hospital for three nights"), { ok: true, basis: "paraphrased", source: "user_reported" });
    assert.equal(F.householdOperandProblem({ count: 4, attribution: "three nights" }, { n: { value: "4", words: "in hospital for three nights", basis: "paraphrased" } })?.includes("unconfirmed"), true);
    assert.equal(F.householdOperandProblem({ count: 3, attribution: "in hospital for three nights" }, { n: { value: "3", words: "in hospital for three nights", basis: "stated" } }), null);
  });

  // ======================= F: usage accounting with the real hosted adapter over a fake fetch (no network)
  const saveEnv = { ...process.env };
  const restore = () => { for (const k of Object.keys(process.env)) if (!(k in saveEnv)) delete process.env[k]; Object.assign(process.env, saveEnv); };
  const reply = (calls: { name: string; args: unknown }[], usage = { prompt_tokens: 1000, completion_tokens: 50 }) => new Response(JSON.stringify({ model: "gpt-x-2026-01-01", usage, choices: [{ message: { content: null, tool_calls: calls.map((c, i) => ({ id: "c" + i, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }] }), { status: 200 });
  type Step = (init: any) => Promise<Response> | Response;
  const fake = (steps: Step[]) => { const seen: { aborted: () => boolean }[] = []; let i = 0; const f = (async (_url: string, init: any) => { seen.push({ aborted: () => !!init.signal?.aborted }); const s = steps[Math.min(i++, steps.length - 1)]; return s(init); }) as unknown as typeof fetch; return { f, seen, count: () => i }; };
  const rows = async () => (await h.db.query("SELECT status, error_category, operation, prompt_version, input_tokens, output_tokens, cost_usd, attempt_index FROM model_executions WHERE household_ref=$1 ORDER BY requested_at, attempt_index", [pseudonymizeId(RAHMAN)])).rows as any[];
  const usageRows = async () => (await h.db.query("SELECT ok, input_tokens, output_tokens FROM model_usage WHERE account_id=$1", [RAHMAN])).rows as any[];
  const hostedTurn = async (steps: Step[], env: Record<string, string> = {}, message = "Hello, what can you do?") => {
    restore(); delete process.env.DEARPOLICY_DETERMINISTIC_MODEL; Object.assign(process.env, env);
    const fk = fake(steps);
    installLoopModel(new HostedLoopModel({ provider: "openai", model: "gpt-x" }, fk.f));
    const before = (await rows()).length;
    const t0 = Date.now();
    try {
      const a = await h.send(RAHMAN, message);
      const s = await h.saved(RAHMAN, a.conversationId!);
      return { answer: s.answer, trace: s.state.ragLoop.turns.at(-1), fk, newRows: (await rows()).slice(before), ms: Date.now() - t0 };
    } finally { installLoopModel(null); restore(); }
  };
  const resolveMe = () => reply([{ name: "resolve_person", args: { mention: "me" } }]);
  const finish = () => reply([{ name: "final_answer", args: { sentences: [{ text: "Happy to help with your household's documents." }] } }]);
  U.resetLoopRunUsage();

  const u1 = await hostedTurn([resolveMe, finish]);
  await check("F1 INTEGRATION every loop model call is counted and recorded (model_executions: rag_answer, rag2-loop prompt version, tokens; model_usage ledger)", async () => {
    assert.equal(u1.trace.outcome, "final_answer"); assert.equal(u1.answer.summary, "Happy to help with your household's documents.");
    assert.equal(u1.fk.count(), 2); assert.equal(u1.trace.calls.length, 2); assert.deepEqual(u1.trace.usage, { input: 2000, output: 100 });
    assert.equal(u1.newRows.length, 2);
    for (const r of u1.newRows) { assert.deepEqual([r.status, r.operation, r.prompt_version, Number(r.input_tokens), Number(r.output_tokens)], ["succeeded", "rag_answer", "rag2-loop-v12", 1000, 50]); }
    assert.equal((await usageRows()).length, 2);
    assert.equal(U.loopRunUsage().calls, 2);
  });
  const u2 = await hostedTurn([() => new Response("busy", { status: 503 }), resolveMe, finish]);
  await check("F2 INTEGRATION a failed call is recorded as failed and retried once; the retry is counted too", () => {
    assert.equal(u2.trace.outcome, "final_answer");
    assert.deepEqual(u2.trace.calls.map((c: any) => [c.ok, !!c.retry]), [[false, false], [true, true], [true, false]]);
    assert.deepEqual(u2.newRows.map((r) => r.status), ["failed", "succeeded", "succeeded"]);
    assert.equal(u2.newRows[0].error_category, "model_provider");
  });
  const u3 = await hostedTurn([resolveMe], { DEARPOLICY_RAG_LOOP_MAX_STEPS: "3" });
  await check("F3 INTEGRATION the per-turn call limit stops the loop with an honest reply (no answer invented)", () => {
    assert.equal(u3.fk.count(), 3); assert.equal(u3.trace.outcome, "budget_exhausted"); assert.equal(u3.trace.limit.kind, "turn_calls");
    assert.equal(u3.answer.summary, FALLBACK_TEXT); assert.equal(u3.newRows.length, 3);
  });
  const u4 = await hostedTurn([() => reply([{ name: "resolve_person", args: { mention: "me" } }], { prompt_tokens: 11_000, completion_tokens: 50 })], { DEARPOLICY_RAG_LOOP_MAX_TOKENS: "14000" });
  await check("F4 INTEGRATION the per-turn token limit refuses the next call before it is made", () => {
    assert.equal(u4.fk.count(), 1); assert.equal(u4.trace.limit.kind, "turn_tokens"); assert.equal(u4.trace.outcome, "limit_reached");
    assert.equal(u4.answer.summary, LIMIT_TEXT.turn_tokens); assert.equal(u4.newRows.length, 1);
  });
  const u5 = await hostedTurn([resolveMe, finish], { DEARPOLICY_RAG_LOOP_HOUSEHOLD_MONTHLY_USD: "0.0001" });
  await check("F5 INTEGRATION the household's monthly loop allowance (unpriced model budgeted at the high fallback price) stops the turn before any call", () => {
    assert.equal(u5.fk.count(), 0); assert.equal(u5.trace.limit.kind, "household_allowance"); assert.equal(u5.answer.summary, LIMIT_TEXT.household_allowance); assert.equal(u5.newRows.length, 0);
  });
  await h.db.query("INSERT INTO model_usage(account_id,role,provider,model,input_tokens,output_tokens,cached_tokens,cost_usd,priced,duration_ms,ok) VALUES($1,'chat','openai','gpt-x',0,0,0,9,true,1,true)", [RAHMAN]);
  const u6 = await hostedTurn([resolveMe, finish], { PLAN_HARD_STOP_USD: "5" });
  await h.db.query("DELETE FROM model_usage WHERE account_id=$1 AND cost_usd=9", [RAHMAN]);
  await check("F6 INTEGRATION the household's plan hard stop (ledger) stops the turn before any call", () => {
    assert.equal(u6.fk.count(), 0); assert.equal(u6.trace.limit.kind, "household_spend_cap"); assert.equal(u6.answer.summary, LIMIT_TEXT.household_spend_cap);
  });
  U.resetLoopRunUsage();
  const u7 = await hostedTurn([resolveMe, finish], { DEARPOLICY_RAG_LOOP_RUN_MAX_CALLS: "1" });
  await check("F7 INTEGRATION the bounded run budget stops further calls in this process", () => {
    assert.equal(u7.fk.count(), 1); assert.equal(u7.trace.limit.kind, "run_budget"); assert.equal(u7.answer.summary, LIMIT_TEXT.run_budget);
    assert.equal(U.loopRunUsage().calls, 1);
  });
  U.resetLoopRunUsage();
  const hang: Step = (init) => new Promise<Response>((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted by signal")), { once: true }));
  const u8 = await hostedTurn([hang], { DEARPOLICY_RAG_LOOP_CALL_TIMEOUT_MS: "150" });
  await check("F8 INTEGRATION a call that runs out of time is cancelled (the provider request's signal is aborted), recorded as a failed timeout, not retried, and the turn ends honestly", () => {
    assert.equal(u8.fk.count(), 1); assert.equal(u8.fk.seen[0].aborted(), true);
    assert.equal(u8.trace.outcome, "timeout"); assert.equal(u8.answer.summary, LIMIT_TEXT.timeout); assert.ok(u8.ms < 5_000, String(u8.ms));
    assert.deepEqual(u8.newRows.map((r) => [r.status, r.error_category]), [["failed", "timeout"]]);
  });
  await check("F9 cancelling the turn aborts the in-flight call and makes no further call", async () => {
    let sawAbort = false, calls = 0;
    const model = { id: "t", kind: "scripted" as const, next: (i: any) => { calls++; return new Promise<never>((_, rej) => i.signal.addEventListener("abort", () => { sawAbort = true; rej(new Error("x")); })); } };
    const ac = new AbortController();
    const meter = new LoopUsageMeter({ model, accountId: RAHMAN, limits: U.loopLimits({} as NodeJS.ProcessEnv), startedAt: Date.now(), promptVersion: "rag2-loop-v2", signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    const r = await meter.next({ messages: [], tools: [], maxOutputTokens: 100 });
    assert.equal(r.ok, false); assert.equal((r as any).stop.kind, "cancelled"); assert.equal(sawAbort, true);
    const again = await meter.next({ messages: [], tools: [], maxOutputTokens: 100 });
    assert.equal((again as any).stop.kind, "cancelled"); assert.equal(calls, 1);
  });
  await check("F10 budgets stay beneath the owner's US$5/month: defaults small, settings above the ceiling clamped, never raised", () => {
    const d = U.loopLimits({} as NodeJS.ProcessEnv);
    assert.deepEqual([d.ceilingUsd, d.runMaxUsd, d.householdMonthlyUsd, d.maxTurnUsd, d.runMaxCalls], [4, 0.5, 1, 0.05, 150]);
    const hi = U.loopLimits({ DEARPOLICY_RAG_LOOP_RUN_MAX_USD: "50", DEARPOLICY_RAG_LOOP_HOUSEHOLD_MONTHLY_USD: "20", OWNER_PROVIDER_BUDGET_USD: "25" } as unknown as NodeJS.ProcessEnv);
    assert.deepEqual([hi.ceilingUsd, hi.runMaxUsd, hi.householdMonthlyUsd], [4, 4, 4]);
    const lo = U.loopLimits({ OWNER_PROVIDER_BUDGET_USD: "2", DEARPOLICY_RAG_LOOP_RUN_MAX_USD: "3" } as unknown as NodeJS.ProcessEnv);
    assert.deepEqual([lo.ceilingUsd, lo.runMaxUsd], [1.6, 1.6]);
    for (const t of Object.values(LIMIT_TEXT)) assert.doesNotMatch(t, /spend[- ]?capped|capped key|key is capped/i);
  });
  await check("N1 no real network call was attempted in the whole suite", () => { assert.deepEqual(h.networkCalls, []); });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2:conv-test (integration) ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

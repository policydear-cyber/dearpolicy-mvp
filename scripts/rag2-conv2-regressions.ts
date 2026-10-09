/**
 * Conversational RAG, round 6 (npm run rag2:conv2-test): presentation of a turn that asks a question, inline evidence
 * ids, and the live-smoke L3 / L4 conversations reproduced deterministically. INTEGRATION TESTS: PGlite with the
 * synthetic live household Lim (scripts/fixtures/rag2-live/household.ts), every turn posted to the REAL chat route with
 * DEARPOLICY_RAG_LOOP=1 and the TEST-ONLY scripted model -- tool calls replayed from the live run (ids taken from the
 * real tools' results), no network.
 *  Q  a question is presented once: by its card (answer.questions), never also in the message body.
 *  B  an ask_user turn may first state the identified benefit, conditionally and cited -- composed and gated exactly
 *     like final_answer sentences (unsupported, payout or decision wording refused); one material question.
 *  I  internal evidence / value / result ids never reach visible text; the citation mapping is kept.
 * REPRO=1 prints the visible text of the L3 / L4 replays (what the chat page shows).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChatAnswer } from "@/types";
import { SQL } from "./fixtures/rag2-loop/harness";
import { ACCOUNT_L, DOCS, L, MEMBERS, doc } from "./fixtures/rag2-live/household";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_ACCOUNT_ID = ACCOUNT_L;
process.env.E2E_RUN_ID = "rag2conv2";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
delete process.env.PINECONE_API_KEY;
delete process.env.DEARPOLICY_RAG_TOOLS;
process.env.DEARPOLICY_RAG_LOOP = "1";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 12).join("\n     ")); }
}
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const data = (v: ScriptView, name: string, where?: (o: any) => boolean) => { const o = v.find(name, where); if (!o?.ok) throw new Error(`script: ${name} failed: ${JSON.stringify(o?.result).slice(0, 300)}`); return o.result.data; };
const hit = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => re.test(x.evidence?.excerpt ?? "")); if (h) return h.evidence.evidence_id as string; } throw new Error("script: no passage like " + re); };
const INTERNAL_ID = /\b(?:e|v|r)\d{1,4}\b|evidence_id|value_id|result_id|select_table_value|final_answer|ask_user|note_facts|search_passages/;
const MONEY = /S\$\s?\d/;

async function startLimHarness() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL) await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  const { pool } = await import("@/lib/db/client");
  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) { const rs = await db.exec(text); const r = rs.at(-1); return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as unknown as typeof pool.connect;
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled in rag2:conv2-test: " + String(input)); }) as typeof fetch;
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Lim household')", [ACCOUNT_L]);
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [ACCOUNT_L]).catch(() => undefined);
  for (const p of MEMBERS) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, p.account, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of DOCS) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,'ready',$9,$9,'scan_clean','active',NULL,$10,$11,$12)`, [d.id, d.account, d.owner, d.insurer, d.product, d.policyNumber, d.policyType, d.role, d.key.toLowerCase() + ".pdf", d.hash, d.effective, d.expiry]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, d.account, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [d.account, d.id, Number(page), text]);
  }
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/chat/route");
  const send = async (question: string, conv?: { id?: string; rev?: number }) => {
    const response = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: null, scope: "family", question, conversationId: conv?.id, conversationRevision: conv?.rev, asynchronous: false, timeZone: "Asia/Singapore" }) }));
    const body = await response.json();
    if (response.status !== 200) throw new Error("chat returned " + response.status + " " + JSON.stringify(body).slice(0, 400));
    return body.answer as ChatAnswer;
  };
  const saved = async (conversationId: string) => {
    const m = (await db.query("SELECT content, answer_json FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 AND role='assistant' ORDER BY created_at DESC, message_order DESC LIMIT 1", [ACCOUNT_L, conversationId])).rows[0] as { content: string; answer_json: ChatAnswer };
    const c = (await db.query("SELECT state FROM chat_conversations WHERE id=$1", [conversationId])).rows[0] as { state: any };
    return { content: m.content, answer: m.answer_json, state: c.state };
  };
  return { send, saved };
}

async function main() {
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const UI = await import("@/components/assistant-message").catch(() => null);
  const h = await startLimHarness();
  /** What the chat page shows for an assistant message (components/assistant-message.ts when present). */
  const shown = (content: string, a: ChatAnswer) => UI ? UI.renderedAssistantText(content, a) : [content, ...a.details, ...a.questions.flatMap((q) => [q.text, q.why ?? ""]), ...(a.questions.length ? [] : a.nextSteps), a.disclaimer].filter((x) => x && x.trim()).join("\n");
  const run = async (script: ScriptTurn[], messages: string[]) => {
    installLoopModel(new ScriptedLoopModel(script));
    let conv: { id?: string; rev?: number } = {};
    const turns: { answer: ChatAnswer; content: string; loop: any; trace: any; visible: string }[] = [];
    try {
      for (const m of messages) {
        const answer = await h.send(m, conv);
        conv = { id: answer.conversationId, rev: answer.conversationRevision };
        const s = await h.saved(conv.id!);
        turns.push({ answer: s.answer, content: s.content, loop: s.state.ragLoop, trace: s.state.ragLoop?.turns.at(-1), visible: shown(s.content, s.answer) });
      }
    } finally { installLoopModel(null); }
    return turns;
  };
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;
  const kai = L.kai.id, mei = L.mei.id, daniel = L.daniel.id;
  const SUN = doc("SUNHAVEN").id, CARE = doc("CAREDAY").id, KES = doc("KESTREL").id;

  // ---------------------------------------------------------------- L3 replay (the live run's own tool calls)
  const L3M = ["Kai broke his arm yesterday. Can we claim for it?", "Before that, quick question: what is my deductible on my KestrelShield plan?", "He fell off his bicycle at the park."];
  const l3Turn1: ScriptTurn = { steps: [
    () => [call("resolve_person", { mention: "Kai" })],
    () => [call("note_facts", { subject_id: kai, facts: [{ key: "injury", value: "broke his arm", words: "Kai broke his arm yesterday." }, { key: "when_happened", value: "yesterday", words: "Kai broke his arm yesterday." }] }), call("policies_for", { subject_id: kai, topic: "accident fracture medical expenses" })],
    () => [call("search_passages", { subject_id: kai, k: 10, query: "fracture broken arm accidental injury benefit eligibility X-ray doctor certified claim" })],
    (v) => [call("ask_user", { kind: "fact", fact_key: "how_it_happened", subject_id: kai, question: "How did Kai break his arm?", because_evidence_ids: [hit(v, /solely and directly by an Accident/)] })],
  ] };
  const l3Turn2: ScriptTurn = { steps: [
    () => [call("resolve_person", { mention: "my" })],
    () => [call("policies_for", { subject_id: daniel, topic: "KestrelShield deductible" })],
    () => [call("search_passages", { subject_id: daniel, k: 5, query: "deductible KestrelShield Integrated Plan deductible amount", policy_ids: [KES] })],
    (v) => [call("final_answer", { subject_id: daniel, sentences: [{ text: "Your KestrelShield Integrated Plan schedule lists a deductible of S$3,500 per policy year for a private hospital (page 1).", benefit: "Deductible (per policy year, private hospital)", evidence_ids: [hit(v, /Deductible \(per policy year/)] }] })],
  ] };
  const l3Turn3Head = [
    () => [call("note_facts", { subject_id: kai, facts: [{ key: "how_it_happened", value: "fell off his bicycle at the park", words: "He fell off his bicycle at the park." }] })],
    () => [call("search_passages", { subject_id: kai, k: 10, query: "fracture broken arm accidental medical expenses fracture benefit X-ray doctor certified claim conditions", policy_ids: [SUN] })],
    () => [call("select_table_value", { subject_id: kai, policy_id: SUN, benefit: "Fracture benefit (per fracture)", tier: "Child", want: "amount" })],
  ];
  // As the live model did: a preface, then the bare question.
  const l3Live: ScriptTurn[] = [l3Turn1, l3Turn2, { steps: [...l3Turn3Head,
    (v) => [call("ask_user", { kind: "fact", fact_key: "fracture_xray_confirmed", subject_id: kai, preface: "To check the fracture benefit,", question: "Has a registered medical practitioner confirmed Kai’s fracture by X-ray?", because_evidence_ids: [hit(v, /confirmed by X-ray/)] })],
    (v) => [call("ask_user", { kind: "fact", fact_key: "fracture_xray_confirmed", subject_id: kai, question: "Has a registered medical practitioner confirmed Kai’s fracture by X-ray?", because_evidence_ids: [hit(v, /confirmed by X-ray/)] })],
  ] }];
  const live3 = await run(l3Live, L3M);
  if (process.env.REPRO) for (const [i, t] of live3.entries()) console.log(`--- L3 live replay, turn ${i + 1}\n${t.visible}\n`);

  await check("Q1 L3 replay: every question is shown exactly once (the card), never also in the message body", () => {
    for (const t of live3) for (const q of t.answer.questions) {
      assert.equal(count(t.visible, q.text), 1, `"${q.text}" shown ${count(t.visible, q.text)}x:\n${t.visible}`);
      assert.ok(!t.content.includes(q.text), "the message body repeats the question: " + t.content);
    }
    assert.equal(live3[0].answer.questions.length, 1);
    assert.equal(live3[2].answer.questions.length, 1);
  });
  await check("Q2 L3 replay: the side answer is the body; the pending question is put back once, by the card", () => {
    const t = live3[1];
    assert.match(t.visible, /S\$3,500/);
    assert.equal(t.answer.questions.length, 1);
    assert.equal(count(t.visible, "How did Kai break his arm?"), 1, t.visible);
  });

  // ---------------------------------------------------------------- L3, the conditional benefit before the question
  const l3Benefit: ScriptTurn[] = [l3Turn1, l3Turn2, { steps: [...l3Turn3Head,
    (v) => { const s = data(v, "select_table_value"); return [call("ask_user", { kind: "fact", fact_key: "fracture_xray_confirmed", subject_id: kai,
      statements: [{ text: `Kai's SunHaven Family Accident Guard lists a Fracture benefit of S$${s.value} per fracture for a child.`, value_ids: [s.valueId] }],
      question: "Has a registered medical practitioner confirmed Kai’s fracture by X-ray?", because_evidence_ids: [hit(v, /confirmed by X-ray/)] })]; },
  ] }];
  const ben3 = await run(l3Benefit, L3M);
  if (process.env.REPRO) console.log(`--- L3 with the benefit stated before the question, turn 3\n${ben3[2].visible}\n`);
  await check("B1 L3: the identified benefit is given first, conditionally and cited, then ONE question (the card)", () => {
    const t = ben3[2];
    assert.equal(t.trace.outcome, "ask_user");
    assert.match(t.content, /S\$750 per fracture/);
    assert.match(t.content, /S\$750 per fracture[^.]*\b(?:payable if|only if|subject to)\b[^.]*X-ray[^.]*registered medical practitioner/i, t.content);
    assert.doesNotMatch(t.visible, /S\$1,200/);
    assert.doesNotMatch(t.visible, /\bapproved\b|you will receive|\bwill be paid\b|\bentitled\b/i);
    assert.equal(t.answer.questions.length, 1);
    assert.equal(count(t.visible, t.answer.questions[0].text), 1);
    assert.equal((t.visible.match(/\?/g) ?? []).length, 1, t.visible);
    const b = (t.answer.figureBindings ?? []).find((x) => x.value === 750);
    assert.ok(b && b.policyId === SUN && b.subjectId === kai && b.column === "Child", JSON.stringify(t.answer.figureBindings));
    assert.ok(t.answer.citations.some((c) => c.policyId === SUN && c.pageStart === 1), "cites the schedule row");
    assert.ok(t.answer.citations.some((c) => c.policyId === SUN && c.pageStart === 2 && /X-ray/.test(c.excerpt ?? "")), "cites the condition");
    assert.deepEqual(t.trace.gate, []);
    assert.equal(t.loop.pending?.factKey, "fracture_xray_confirmed");
  });

  // ---------------------------------------------------------------- statements on ask_user go through the composer
  const bad = (statements: Record<string, unknown>[], extra: Record<string, unknown> = {}): ScriptTurn[] => [l3Turn1, l3Turn2, { steps: [...l3Turn3Head,
    (v) => { const s = data(v, "select_table_value"); return [call("ask_user", { kind: "fact", fact_key: "fracture_xray_confirmed", subject_id: kai, statements: statements.map((x) => ({ ...x, value_ids: x.value_ids === "V" ? [s.valueId] : x.value_ids })), question: "Has a registered medical practitioner confirmed Kai’s fracture by X-ray?", because_evidence_ids: [hit(v, /confirmed by X-ray/)], ...extra })]; },
    (v) => [call("ask_user", { kind: "fact", fact_key: "fracture_xray_confirmed", subject_id: kai, question: "Has a registered medical practitioner confirmed Kai’s fracture by X-ray?", because_evidence_ids: [hit(v, /confirmed by X-ray/)] })],
  ] }];
  const unsupported = await run(bad([{ text: "Kai's SunHaven plan pays S$1,200 per fracture." }]), L3M);
  const payout = await run(bad([{ text: "Kai will receive S$750 for the fracture.", value_ids: "V" }]), L3M);
  const prefaceFigure = await run(bad([], { preface: "Kai's fracture benefit is S$750." }), L3M);
  await check("B2 a statement on ask_user with an uncited figure, a payout, or a figure in the preface is refused (the model is told why) and never shown", () => {
    for (const [name, t] of [["uncited", unsupported[2]], ["payout", payout[2]], ["preface", prefaceFigure[2]]] as const) {
      const refused = (t.trace.toolCalls as any[]).filter((x) => x.name === "ask_user" && !x.ok);
      assert.equal(refused.length, 1, name + ": " + JSON.stringify(t.trace.toolCalls.map((x: any) => [x.name, x.ok, x.error])));
      assert.doesNotMatch(t.visible, MONEY, name + ": " + t.visible);
      assert.doesNotMatch(t.visible, /will receive/i);
      assert.equal(t.answer.questions.length, 1);
    }
  });
  const twoQ = await run(bad([{ text: "Was it confirmed by X-ray?" }]), L3M);
  await check("B3 statements may not ask a question (one question per turn, in the card)", () => {
    const refused = (twoQ[2].trace.toolCalls as any[]).filter((x) => x.name === "ask_user" && !x.ok);
    assert.equal(refused.length, 1);
    assert.equal((twoQ[2].visible.match(/\?/g) ?? []).length, 1, twoQ[2].visible);
  });

  // ---------------------------------------------------------------- L4 replay: inline evidence ids
  const L4M = ["Mei was admitted to hospital on 3 Sep 2026 at 10:15 pm and discharged on 6 Sep 2026 at 9:30 am. How much hospital cash can we claim from CareDay?"];
  const l4: ScriptTurn[] = [{ steps: [
    () => [call("resolve_person", { mention: "Mei" })],
    () => [call("note_facts", { subject_id: mei, facts: [{ key: "admission_datetime", value: "2026-09-03T22:15+08:00", words: "admitted to hospital on 3 Sep 2026 at 10:15 pm" }, { key: "discharge_datetime", value: "2026-09-06T09:30+08:00", words: "discharged on 6 Sep 2026 at 9:30 am" }] })],
    () => [call("policies_for", { subject_id: mei, topic: "hospital cash" })],
    () => [call("search_passages", { subject_id: mei, k: 10, policy_ids: [CARE], query: "CareDay Hospital Cash Plan hospital cash daily benefit day count rule waiting days minimum stay maximum days admission discharge" })],
    () => [call("select_table_value", { subject_id: mei, policy_id: CARE, benefit: "Hospital Cash", want: "amount" })],
    (v) => { const s = data(v, "select_table_value"); const row = (v.find("select_table_value")!.result.evidence as any[]).find((e) => e.row)?.evidence_id; const cond = hit(v, /counted from the time of admission/);
      return [call("final_answer", { subject_id: mei, sentences: [
        { text: `Mei’s CareDay Hospital Cash is S$${s.value} for each complete 24-hour period, up to 90 periods per year (page 1), and the policy counts from admission, excluding any shorter period (page 2) [${row}, ${cond}].`, benefit: "Hospital cash (each complete 24 hours, max 90 per year)", evidence_ids: [row, cond] },
      ] })]; },
  ] }];
  const live4 = await run(l4, L4M);
  if (process.env.REPRO) console.log(`--- L4 live replay\n${live4[0].visible}\n`);
  if (process.env.DEBUG_CONV2) console.log(JSON.stringify({ dropped: live4[0].trace.dropped, gate: live4[0].trace.gate, calls: live4[0].trace.toolCalls.map((x: any) => [x.name, x.ok, x.error, x.evidenceIds, x.summary]) }, null, 1));
  await check("I1 L4 replay: inline evidence ids are removed from the sentence; the citations (page links) are kept", () => {
    const t = live4[0];
    assert.doesNotMatch(t.visible, INTERNAL_ID, t.visible);
    assert.doesNotMatch(t.visible, /\[\s*\]|\(\s*\)|\s[,.]/, t.visible);
    assert.match(t.visible, /S\$60 for each complete 24-hour period/);
    assert.ok(t.answer.citations.some((c) => c.policyId === CARE && c.pageStart === 1));
    assert.ok(t.answer.citations.some((c) => c.policyId === CARE && c.pageStart === 2));
    assert.deepEqual(t.trace.gate, []);
  });
  const l4Only: ScriptTurn[] = [{ steps: [...l4[0].steps.slice(0, 5),
    (v) => { const s = data(v, "select_table_value"); const cond = hit(v, /counted from the time of admission/);
      return [call("final_answer", { subject_id: mei, sentences: [
        { text: `Mei’s CareDay hospital cash rate is S$${s.value} for each complete 24 hours (${s.valueId}).`, value_ids: [] },
        { text: `It is counted from the time of admission (evidence ${cond}).`, evidence_ids: [] },
      ] })]; },
  ] }];
  const only4 = await run(l4Only, L4M);
  await check("I2 an id written only in the text still cites what it names (the mapping is kept), and is never shown", () => {
    const t = only4[0];
    assert.doesNotMatch(t.visible, INTERNAL_ID, t.visible);
    assert.match(t.visible, /S\$60 for each complete 24 hours/);
    assert.ok((t.answer.figureBindings ?? []).some((b) => b.value === 60 && b.subjectId === mei), JSON.stringify(t.answer.figureBindings));
    assert.ok(t.answer.citations.some((c) => c.policyId === CARE && c.pageStart === 2));
  });

  // ---------------------------------------------------------------- L3b (new live paraphrase): the PlayWell fixture
  const PW = doc("PLAYWELL").id;
  const l3b: ScriptTurn[] = [{ steps: [
    () => [call("resolve_person", { mention: "Mei" })],
    () => [call("note_facts", { subject_id: mei, facts: [{ key: "how_it_happened", value: "landed badly on her elbow at gymnastics", words: "Mei landed badly on her elbow at gymnastics this afternoon" }, { key: "injury", value: "dislocated elbow", words: "the clinic says it's dislocated" }] }), call("policies_for", { subject_id: mei, topic: "accident dislocation" })],
    () => [call("search_passages", { subject_id: mei, k: 10, policy_ids: [PW], query: "dislocation benefit X-ray MRI registered medical practitioner accident" }), call("select_table_value", { subject_id: mei, policy_id: PW, benefit: "Dislocation benefit (per dislocation)", want: "amount" })],
    (v) => { const s = data(v, "select_table_value"); return [call("ask_user", { kind: "fact", fact_key: "dislocation_imaging_confirmed", subject_id: mei,
      statements: [{ text: `Mei's PlayWell Junior Accident Cover lists a Dislocation benefit of S$${s.value} per dislocation.`, value_ids: [s.valueId] }],
      question: "Has the dislocation been confirmed by an X-ray or MRI?", because_evidence_ids: [hit(v, /confirmed by X-ray or MRI/)] })]; },
  ] }];
  const pw = await run(l3b, ["Mei landed badly on her elbow at gymnastics this afternoon and the clinic says it's dislocated. Is that something her PlayWell plan helps with?"]);
  if (process.env.REPRO) console.log(`--- L3b (PlayWell) scripted\n${pw[0].visible}\n`);
  await check("B4 L3b fixture: Mei's S$600 dislocation benefit binds to the single 'Sum insured' column and is said with its X-ray / MRI condition", () => {
    const t = pw[0];
    assert.match(t.content, /S\$600 per dislocation[^.]*\b(?:payable if|only if)\b[^.]*registered medical practitioner[^.]*X-ray or MRI/i, t.content);
    assert.ok((t.answer.figureBindings ?? []).some((b) => b.value === 600 && b.policyId === PW && b.subjectId === mei), JSON.stringify(t.answer.figureBindings));
    assert.equal(t.answer.questions.length, 1);
    assert.equal(count(t.visible, t.answer.questions[0].text), 1);
    assert.deepEqual(t.trace.gate, []);
  });
  await check("B5 the question card says why with policy wording, never a heading", () => {
    for (const t of [...live3, ...pw]) for (const q of t.answer.questions) assert.doesNotMatch(q.why ?? "", /“Section \d|“Part \d/, q.why);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2 conv2 regressions ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Conversational RAG, round 6c (npm run rag2:conv3-test): defects the real model exposed in the round-6 live re-run,
 * reproduced deterministically (scripted model; PGlite; the live household Lim; what the chat page shows after the
 * read-side boundary the history / job routes apply). Earlier header, for the shared harness: round 6 (rag2:conv2-test): presentation of a turn that asks a question, inline evidence
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
process.env.E2E_RUN_ID = "rag2conv3";
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
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled in rag2:conv3-test: " + String(input)); }) as typeof fetch;
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
  const UI = await import("@/components/assistant-message");
  const { sanitizeStoredAnswer, WITHHELD_AMOUNT_TEXT } = await import("@/lib/chat/monetary-boundary");
  const h = await startLimHarness();
  const run = async (script: ScriptTurn[], messages: string[]) => {
    installLoopModel(new ScriptedLoopModel(script));
    let conv: { id?: string; rev?: number } = {};
    const turns: { answer: ChatAnswer; served: ChatAnswer; content: string; loop: any; trace: any; visible: string }[] = [];
    try {
      for (const m of messages) {
        const answer = await h.send(m, conv);
        conv = { id: answer.conversationId, rev: answer.conversationRevision };
        const s = await h.saved(conv.id!);
        // What the household is served: the stored answer through the read-side boundary (history / job routes).
        const served = sanitizeStoredAnswer(JSON.parse(JSON.stringify(s.answer))) as ChatAnswer;
        turns.push({ answer: s.answer, served, content: served.summary, loop: s.state.ragLoop, trace: s.state.ragLoop?.turns.at(-1), visible: UI.renderedAssistantText(served.summary, served) });
      }
    } finally { installLoopModel(null); }
    return turns;
  };
  const show = (label: string, t: { visible: string }) => { if (process.env.REPRO) console.log(`--- ${label}\n${t.visible}\n`); };
  const kai = L.kai.id, mei = L.mei.id;
  const SUN = doc("SUNHAVEN").id, CARE = doc("CAREDAY").id;
  const WITHHELD = new RegExp(WITHHELD_AMOUNT_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  // ------------------------------------------------- D1 + D2: L3, the fracture benefit before / with its question
  const L3M = ["Kai broke his arm yesterday. Can we claim for it?", "He fell off his bicycle at the park."];
  const head1 = [
    () => [call("resolve_person", { mention: "Kai" })],
    () => [call("note_facts", { subject_id: kai, facts: [{ key: "injury", value: "broke his arm", words: "Kai broke his arm yesterday." }] }), call("policies_for", { subject_id: kai, topic: "accident fracture" })],
    () => [call("search_passages", { subject_id: kai, k: 10, policy_ids: [SUN], query: "fracture benefit X-ray certified accident bodily injury sickness" }), call("select_table_value", { subject_id: kai, policy_id: SUN, benefit: "Fracture benefit (per fracture)", tier: "Child", want: "amount" })],
  ];
  const stmt = (v: ScriptView) => { const s = data(v, "select_table_value"); return [{ text: `Kai's SunHaven Family Accident Guard lists a Fracture benefit (per fracture) of S$${s.value} for a child.`, value_ids: [s.valueId] }]; };
  const l3: ScriptTurn[] = [
    { steps: [...head1, (v) => [call("ask_user", { kind: "fact", fact_key: "how_it_happened", subject_id: kai, statements: stmt(v), question: "How did Kai break his arm?", because_evidence_ids: [hit(v, /solely and directly by an Accident/)] })],
      (v) => [call("ask_user", { kind: "fact", fact_key: "how_it_happened", subject_id: kai, question: "How did Kai break his arm?", because_evidence_ids: [hit(v, /solely and directly by an Accident/)] })] ] },
    { steps: [
      () => [call("note_facts", { subject_id: kai, facts: [{ key: "how_it_happened", value: "fell off his bicycle at the park", words: "He fell off his bicycle at the park." }] })],
      () => [call("search_passages", { subject_id: kai, k: 10, policy_ids: [SUN], query: "fracture benefit X-ray certified" }), call("select_table_value", { subject_id: kai, policy_id: SUN, benefit: "Fracture benefit (per fracture)", tier: "Child", want: "amount" })],
      (v) => [call("ask_user", { kind: "fact", fact_key: "fracture_xray_confirmed", subject_id: kai, statements: stmt(v), question: "Has a registered medical practitioner confirmed Kai’s fracture by X-ray?", because_evidence_ids: [hit(v, /confirmed by X-ray/)] })],
      (v) => [call("ask_user", { kind: "fact", fact_key: "fracture_xray_confirmed", subject_id: kai, question: "Has a registered medical practitioner confirmed Kai’s fracture by X-ray?", because_evidence_ids: [hit(v, /confirmed by X-ray/)] })] ] },
  ];
  const t3 = await run(l3, L3M);
  show("L3 turn 1 (cause unknown)", t3[0]); show("L3 turn 2 (cause given)", t3[1]);
  await check("D1 a verified printed figure stated before a question is served as printed (never the withheld-amount wording), labelled as a policy-stated limit", () => {
    for (const t of t3) {
      assert.doesNotMatch(t.visible, WITHHELD, t.visible);
      assert.match(t.visible, /S\$750/, t.visible);
      assert.ok((t.served.policyStatedLimits ?? []).some((l) => l.amount === 750 && l.label === "Policy-stated coverage limit" && l.binding?.subjectId === kai), JSON.stringify(t.served.policyStatedLimits));
    }
  });
  await check("D2 while how it happened is unknown, the figure carries the policy's accident-only cover condition (and its X-ray condition); once told, the accident clause is not repeated", () => {
    const s1 = t3[0].content;
    assert.match(s1, /S\$750[^.]*X-ray[^.]*registered medical practitioner/i, s1);
    assert.match(s1, /S\$750[^.]*caused solely and directly by an Accident/i, s1);
    assert.equal(t3[0].answer.questions.length, 1); assert.match(t3[0].answer.questions[0].text, /How did Kai break his arm\?/);
    const s2 = t3[1].content;
    assert.match(s2, /S\$750[^.]*X-ray/i, s2);
    assert.doesNotMatch(s2, /solely and directly by an Accident/, s2);
  });

  // ------------------------------------------------------------- D3: L2, "not a guaranteed payment" is not a decision
  const l2 = (text: (v: number) => string): ScriptTurn[] => [{ steps: [
    () => [call("resolve_person", { mention: "Kai" })],
    () => [call("select_table_value", { subject_id: kai, policy_id: SUN, benefit: "Accidental dental treatment (per accident)", tier: "Child", want: "amount" })],
    (v) => { const s = data(v, "select_table_value"); return [call("final_answer", { subject_id: kai, sentences: [{ text: text(s.value), value_ids: [s.valueId] }] })]; },
  ] }];
  const L2M = ["What does our SunHaven plan pay for accidental dental treatment for Kai?"];
  const neg = await run(l2((v) => `For Kai, SunHaven's Accidental dental treatment (per accident) benefit is up to S$${v} per accident; this is a limit, not a guaranteed payment.`), L2M);
  show("L2 'not a guaranteed payment'", neg[0]);
  await check("D3 a negated decision word ('not a guaranteed payment') keeps the sentence; a real decision is still refused", async () => {
    assert.match(neg[0].visible, /up to S\$400 per accident; this is a limit, not a guaranteed payment/, neg[0].visible);
    assert.doesNotMatch(neg[0].visible, /Only the insurer makes a decision/);
    const pos = await run(l2((v) => `Kai's dental claim is approved and you are entitled to S$${v}.`), L2M);
    assert.doesNotMatch(pos[0].visible, /S\$400/, pos[0].visible);
  });

  await check("D3b the decision / payout detector is negation- and scope-aware, both ways", async () => {
    const { payoutOrDecision } = await import("@/lib/rag2/loop/statements");
    for (const t of ["For Kai, the benefit is up to S$400 per accident; this is a limit, not a guaranteed payment.", "Listing a benefit is not an approval of the claim.", "The schedule does not guarantee that a claim will be paid.", "This does not mean you will receive S$400.", "This is an indicative estimate, not a payout.", "No amount is guaranteed until the insurer reviews the claim."])
      assert.equal(payoutOrDecision(t), null, t);
    for (const t of ["The claim is approved.", "You will be paid S$400.", "You are entitled to S$400.", "There is a guaranteed payout of S$400.", "Kai is fully covered.", "It is not approved yet but it is guaranteed.", "It is not a payout; you will be paid S$400 next week.", "Kai is entitled to the fracture benefit."])
      assert.notEqual(payoutOrDecision(t), null, t);
  });

  // --------------------------------------------------------------- D4: L6, "one of us" never asks who
  const L6M = ["If one of us is injured overseas, does SunHaven pay for emergency medical evacuation, and up to how much?"];
  const ids = Object.values(L).map((m) => m.id);
  const l6: ScriptTurn[] = [{ steps: [
    () => [call("resolve_person", { mention: "one of us" })],
    () => [call("ask_user", { kind: "person", mention: "one of us", question: "Which household member do you mean?", options: ids })],
    () => [call("search_passages", { k: 10, policy_ids: [SUN], query: "emergency medical evacuation overseas worldwide repatriation" })],
    (v) => [call("final_answer", { sentences: [{ text: "Your SunHaven Family Accident Guard covers accidents anywhere in the world, but its schedule does not list an emergency medical evacuation benefit.", evidence_ids: [hit(v, /anywhere in the world/)] }] })],
  ] }];
  const t6 = await run(l6, L6M);
  show("L6 'one of us'", t6[0]);
  await check("D4 a group / anyone mention ('one of us') is answered for the policy: the person question is refused", () => {
    assert.equal(t6[0].answer.questions.length, 0, t6[0].visible);
    assert.ok((t6[0].trace.toolCalls as any[]).some((x) => x.name === "ask_user" && !x.ok), "the person question was refused");
    assert.match(t6[0].visible, /does not list an emergency medical evacuation benefit/);
  });

  // -------------------------------------------- D5: L4, the estimate cites its calculation's own duration-rule passage
  const L4M = ["Mei was admitted to hospital on 3 Sep 2026 at 10:15 pm and discharged on 6 Sep 2026 at 9:30 am. How much hospital cash can we claim from CareDay?"];
  const l4: ScriptTurn[] = [{ steps: [
    () => [call("resolve_person", { mention: "Mei" })],
    () => [call("note_facts", { subject_id: mei, facts: [{ key: "admission_datetime", value: "2026-09-03T22:15+08:00", words: "admitted to hospital on 3 Sep 2026 at 10:15 pm" }, { key: "discharge_datetime", value: "2026-09-06T09:30+08:00", words: "discharged on 6 Sep 2026 at 9:30 am" }] })],
    () => [call("search_passages", { subject_id: mei, k: 10, policy_ids: [CARE], query: "hospital cash complete period of 24 hours admission" }), call("select_table_value", { subject_id: mei, policy_id: CARE, benefit: "Hospital cash", want: "amount" })],
    (v) => { const s = data(v, "select_table_value"); return [call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: mei, policy_id: CARE, benefit: "Hospital cash", rate_value_id: s.valueId, admission: { at: "2026-09-03T22:15+08:00", words: "admitted to hospital on 3 Sep 2026 at 10:15 pm" }, discharge: { at: "2026-09-06T09:30+08:00", words: "discharged on 6 Sep 2026 at 9:30 am" } })]; },
    (v) => { const s = data(v, "select_table_value"); const c = data(v, "calculate"); const rid = c.resultId ?? c.result_id ?? c.calcId ?? c.calc_id ?? c.id;
      if (!rid) throw new Error("script: calculate result has no id: " + JSON.stringify(c).slice(0, 300));
      return [call("final_answer", { subject_id: mei, sentences: [{ text: `For Mei, CareDay lists Hospital cash at S$${s.value} for each complete 24 hours (page 1), and the indicative estimate for the dates and times you gave is S$${c.amount}.`, benefit: "Hospital cash", result_id: rid, value_ids: [s.valueId] }] })]; },
  ] }];
  const t4 = await run(l4, L4M);
  show("L4 estimate", t4[0]);
  await check("D5 an estimate citing a calculation record also cites that record's own day-count passage (CareDay p2), shown as a normal page citation", () => {
    assert.match(t4[0].visible, /S\$120/, t4[0].visible);
    assert.ok(t4[0].answer.citations.some((c) => c.policyId === CARE && c.pageStart === 2 && /complete period of 24 hours/.test(c.excerpt ?? "")), JSON.stringify(t4[0].answer.citations.map((c) => [c.pageStart, (c.excerpt ?? "").slice(0, 60)])));
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2 conv3 regressions ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

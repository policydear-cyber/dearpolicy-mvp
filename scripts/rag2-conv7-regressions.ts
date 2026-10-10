/**
 * Conversational RAG, round 8b (npm run rag2:conv7-test): two answer defects of the third live ingestion run
 * (ingest-live-3, code 42e1fb2), reproduced from that run's own dump and the live model's tool calls, plus one
 * paraphrase each. Every turn goes through the REAL chat route (PGlite, DEARPOLICY_RAG_LOOP=1) with the TEST-ONLY
 * scripted model; what is asserted is what the household is served.
 *   M  the model's own inline citation markers (U+E200 "cite" U+E202 e8 ... U+E201) are read as the sentence's
 *      citations, never shown and never a reason to leave the whole answer out ("I couldn't confirm an answer").
 *   N  "this is not a confirmed payout" is the opposite of calling an estimate a payout: the indicative estimate is
 *      shown; a sentence that does call it a payout is sent back once (wording only) and the restated one shown.
 *   K  (ingest-live-4) an endorsement is linked to its policy's people by the same policy number and product when the
 *      insurer's name is read differently; a number alone on another product is not enough.
 *   R  (ingest-live-4) the one gate repair names only what the check said: no example limitation the model can copy.
 *   C  (ingest-live-5b) a child / adult comparison cited from the table row: the correct one passes, swapped figures fail.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChatAnswer } from "@/types";
import { SQL } from "./fixtures/rag2-loop/harness";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import type { LoopModel, ModelTurnInput, ModelTurnOutput } from "@/lib/rag2/loop/types";

const RUN_ROOT = "docs/rag-migration/ingest-live";
const RUN = readdirSync(RUN_ROOT).filter((d) => d.startsWith("RUN-ingest-live-3-")).sort().at(-1)!;
const DUMP = JSON.parse(readFileSync(path.join(RUN_ROOT, RUN, "dump-final", "dump.json"), "utf8"));
const TB = DUMP.tables;
const ACCOUNT = DUMP.householdId as string;

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_ACCOUNT_ID = ACCOUNT;
process.env.E2E_RUN_ID = "rag2conv7";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
delete process.env.PINECONE_API_KEY;
delete process.env.DEARPOLICY_RAG_TOOLS;
process.env.DEARPOLICY_RAG_LOOP = "1";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 14).join("\n     ")); }
}
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const data = (v: ScriptView, name: string, where?: (o: any) => boolean) => { const o = v.find(name, where); if (!o?.ok) throw new Error(`script: ${name} failed: ${JSON.stringify(o?.result).slice(0, 300)}`); return o.result.data; };
const hit = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => re.test(x.evidence?.excerpt ?? "")); if (h) return h.evidence.evidence_id as string; } throw new Error("script: no passage like " + re); };
const member = (re: RegExp) => (TB.family_members as any[]).find((m) => re.test(m.display_name)).id as string;
const policy = (re: RegExp, role?: string) => (TB.policies as any[]).find((p) => re.test(p.product_name) && (!role || p.document_role === role)).id as string;
const MONEY = /S\$\s?\d/;

async function startHarness() {
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
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled in rag2:conv7-test: " + String(input)); }) as typeof fetch;
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Hartwell household (ingest-live dump)')", [ACCOUNT]);
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [ACCOUNT]).catch(() => undefined);
  for (const m of TB.family_members) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [m.id, ACCOUNT, m.display_name, m.preferred_name, m.relationship, m.notes, m.date_of_birth ? String(m.date_of_birth).slice(0, 10) : null]);
  // Every document as it was during the conversations (the schedule was deleted only after them).
  for (const d of TB.policies) await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,'ready',$9,$9,'scan_clean','active',NULL,$10,$11,$12)`, [d.id, ACCOUNT, d.family_member_id, d.insurer, d.product_name, d.policy_number, d.policy_type, d.document_role, d.id + ".pdf", d.file_hash ?? "sha256:dump-" + d.id, d.effective_date ? String(d.effective_date).slice(0, 10) : null, d.renewal_or_expiry_date ? String(d.renewal_or_expiry_date).slice(0, 10) : null]);
  for (const m of TB.policy_members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,$4,$5,$6)", [m.policy_id, m.family_member_id, ACCOUNT, m.source, Number(m.confidence), m.benefit_tier]);
  for (const p of TB.policy_pages) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [ACCOUNT, p.policy_id, p.page_number, p.text]);
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
    const m = (await db.query("SELECT answer_json FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 AND role='assistant' ORDER BY created_at DESC, message_order DESC LIMIT 1", [ACCOUNT, conversationId])).rows[0] as { answer_json: ChatAnswer };
    const c = (await db.query("SELECT state FROM chat_conversations WHERE id=$1", [conversationId])).rows[0] as { state: any };
    return { answer: m.answer_json, state: c.state };
  };
  return { send, saved, db };
}

/** Wraps the scripted model so each call reports the tokens its request would cost (about 4 characters a token) and
 * records the request size: the loop's per-turn token limit then applies as it does to a hosted model. */
class MeteredScript implements LoopModel {
  readonly id: string; readonly kind = "scripted" as const;
  readonly sizes: number[] = [];
  constructor(private readonly inner: LoopModel) { this.id = inner.id; }
  async next(input: ModelTurnInput): Promise<ModelTurnOutput> {
    const size = JSON.stringify(input.messages).length + JSON.stringify(input.tools).length;
    this.sizes.push(size);
    const out = await this.inner.next(input);
    return { ...out, usage: { input: Math.ceil(size / 4), output: 60 } };
  }
}

async function main() {
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const UI = await import("@/components/assistant-message");
  const { sanitizeStoredAnswer } = await import("@/lib/chat/monetary-boundary");
  const h = await startHarness();
  const run = async (script: ScriptTurn[], messages: string[]) => {
    installLoopModel(new ScriptedLoopModel(script));
    let conv: { id?: string; rev?: number } = {};
    const turns: { answer: ChatAnswer; served: ChatAnswer; loop: any; trace: any; visible: string }[] = [];
    try {
      for (const m of messages) {
        const answer = await h.send(m, conv);
        conv = { id: answer.conversationId, rev: answer.conversationRevision };
        const s = await h.saved(conv.id!);
        const served = sanitizeStoredAnswer(JSON.parse(JSON.stringify(s.answer))) as ChatAnswer;
        turns.push({ answer: s.answer, served, loop: s.state.ragLoop, trace: s.state.ragLoop?.turns.at(-1), visible: UI.renderedAssistantText(served.summary, served) });
      }
    } finally { installLoopModel(null); }
    return turns;
  };
  const show = (label: string, t: { visible: string; trace: any }) => { if (process.env.REPRO) console.log(`--- ${label}\n${t.visible}\n  [composed] ${JSON.stringify(t.trace?.composed ?? [])}\n  [gate] ${JSON.stringify(t.trace?.gate ?? [])}\n  [dropped] ${JSON.stringify(t.trace?.dropped ?? [])}\n  [calls] ${JSON.stringify((t.trace?.toolCalls ?? []).map((x: any) => [x.name, x.ok, String(x.error ?? "").slice(0, 160)]))}\n`); };
  const felix = member(/^Felix/), isla = member(/^Isla/), simon = member(/^Simon/);
  const SAFE = policy(/SafeStay/, "personal_schedule"), ENDT = policy(/SafeStay/, "endorsement"), JUNIOR = policy(/JuniorShield/);
  const PUA = /[-]/;
  const formRepairAsked = (t: { trace: any }) => (t.trace.toolCalls as any[]).filter((x) => x.name === "final_answer" && !x.ok && /left out: (?:shows an internal id|calls (?:a calculated benefit|an amount) a payout)/.test(String(x.error ?? "")));

  // ------------------------------------------------------------------------------------------- Q6 (replay)
  const Q6 = ["Did that endorsement letter change anything? How much is the daily hospital allowance for the kids now?"];
  const q6Head = [
    () => [call("policies_for", { topic: "hospital", subject_id: felix }), call("policies_for", { topic: "hospital", subject_id: isla })],
    () => [call("search_passages", { k: 10, query: "endorsement letter amendment daily hospital allowance hospital cash daily benefit children" })],
  ];
  const cite = (...ids: string[]) => " cite" + ids.map((i) => "" + i).join("") + "";
  const q6 = (mk: (v: ScriptView) => Record<string, unknown>[]): ScriptTurn[] => [{ steps: [...q6Head, (v) => [call("final_answer", { subject_id: felix, sentences: mk(v) })]] }];
  const live6 = await run(q6((v) => {
    const endt = hit(v, /S\$\s?110/), daily = hit(v, /Daily hospital income/);
    return [
      { text: "Yes—the endorsement changed the SafeStay Family Hospital Cash & Personal Accident Plan’s “Hospital daily allowance (per day of confinement)” for each child from S$80 to S$110 per day, effective 1 July 2026; confinement days before that date remain at the earlier rate." + cite(endt), benefit: "Hospital daily allowance (per day of confinement)", subject_id: felix, evidence_ids: [endt] },
      { text: "Isla also has a separate JuniorShield “Daily hospital income” benefit of S$150 per day, up to 30 days per policy year, payable only from the fourth consecutive hospitalisation day." + cite(daily), benefit: "Daily hospital income", subject_id: isla, evidence_ids: [daily] },
    ];
  }), Q6);
  show("Q6", live6[0]);
  await check("M1 Q6: the model's inline citation markers are taken as citations and removed; the endorsement's S$110 from 1 July 2026 is shown, not \"I couldn't confirm an answer\"", () => {
    const t = live6[0];
    assert.doesNotMatch(t.visible, PUA, JSON.stringify(t.visible));
    assert.doesNotMatch(t.visible, /\bcite\b|\be\d+\b/, t.visible);
    assert.doesNotMatch(t.visible, /couldn[’']t confirm an answer/i, t.visible);
    assert.match(t.visible, /S\$110/, t.visible); assert.match(t.visible, /1 July 2026/, t.visible);
    assert.match(t.visible, /S\$150/, t.visible);
    assert.ok((t.served.citations ?? []).length > 0, "citations kept");
  });
  // Paraphrase / layout: the marker mid-sentence (before the clause), several ids, no evidence_ids field at all.
  const para6 = await run(q6((v) => {
    const endt = hit(v, /S\$\s?110/);
    return [{ text: "The endorsement" + cite(endt) + " raises each child’s SafeStay “Hospital daily allowance (per day of confinement)” to S$110 a day from 1 July 2026.", benefit: "Hospital daily allowance (per day of confinement)", subject_id: felix }];
  }), ["Has the kids' SafeStay hospital allowance gone up after the endorsement?"]);
  show("Q6 paraphrase", para6[0]);
  await check("M2 paraphrase (marker mid-sentence, no evidence_ids): its ids become the citations; the figure is shown with no marker", () => {
    const t = para6[0];
    assert.doesNotMatch(t.visible, PUA, JSON.stringify(t.visible));
    assert.match(t.visible, /S\$110/, t.visible); assert.match(t.visible, /1 July 2026/, t.visible);
    assert.doesNotMatch(t.visible, /couldn[’']t confirm an answer/i, t.visible);
  });

  // ------------------------------------------------------------------------------------------- Q5 (replay)
  const Q5 = ["I was in hospital after that car accident in March. They admitted me at 9:40pm on 14 March and I was discharged at 8:20am on 18 March. How much hospital cash should Meridian pay me?"];
  const HDA = "Hospital daily allowance (per day of confinement, max 60 days per policy year)";
  const q5Head = [
    () => [call("resolve_person", { mention: "I" })],
    () => [call("note_facts", { subject_id: simon, facts: [{ key: "how_it_happened", value: "car accident", words: "car accident" }, { key: "admission_datetime", value: "14 March at 9:40pm", words: "They admitted me at 9:40pm on 14 March" }, { key: "discharge_datetime", value: "18 March at 8:20am", words: "I was discharged at 8:20am on 18 March" }] })],
    () => [call("policies_for", { topic: "hospital cash", subject_id: simon })],
    () => [call("search_passages", { k: 10, query: "hospital cash daily benefit accident admission discharge full days 24 hours waiting period minimum stay day cap", policy_ids: [SAFE], subject_id: simon })],
    () => [call("select_table_value", { tier: "Adult", want: "amount", benefit: HDA, policy_id: SAFE, subject_id: simon })],
    (v: ScriptView) => [call("calculate", { calculator: "hospital_cash", purpose: "claim", benefit: HDA, policy_id: SAFE, subject_id: simon, rate_value_id: data(v, "select_table_value").valueId,
      admission: { at: "2026-03-14T21:40+08:00", words: "They admitted me at 9:40pm on 14 March" }, discharge: { at: "2026-03-18T08:20+08:00", words: "I was discharged at 8:20am on 18 March" } })],
  ];
  const resultOf = (v: ScriptView) => { const d = data(v, "calculate"); return String(d.calc_id ?? d.calcId); };
  const rateSentence = (v: ScriptView) => ({ text: "For you, Meridian’s “Hospital daily allowance” is S$120 per day, up to 60 days per policy year, and its wording counts each complete 24-hour period plus a remaining period of 12 hours or more as another day.", benefit: HDA, value_ids: [data(v, "select_table_value").valueId], evidence_ids: [hit(v, /complete period of 24|24 consecutive hours/)] });
  const q5 = (first: string, second?: string): ScriptTurn[] => [{ steps: [...q5Head,
    (v) => [call("final_answer", { subject_id: simon, sentences: [rateSentence(v), { text: first, benefit: HDA, result_id: resultOf(v) }] })],
    ...(second ? [(v: ScriptView) => [call("final_answer", { subject_id: simon, sentences: [rateSentence(v), { text: second, benefit: HDA, result_id: resultOf(v) }] })]] : []),
  ] }];
  const live5 = await run(q5("Based on the admission and discharge times you gave, the indicative estimate is S$360 for three payable days; this is not a confirmed payout."), Q5);
  show("Q5", live5[0]);
  await check("N1 Q5: \"this is not a confirmed payout\" does not hide the indicative estimate -- S$360 for three payable days is shown, with no repair asked", () => {
    const t = live5[0];
    assert.match(t.visible, /S\$360/, t.visible);
    assert.match(t.visible, /indicative estimate/i, t.visible);
    assert.equal(formRepairAsked(t).length, 0);
  });
  const para5 = await run(q5("Your payout for the three payable days would be S$360.", "Based on the times you gave, the indicative estimate is S$360 for three payable days, which isn't a guaranteed amount."), ["After the car accident -- They admitted me at 9:40pm on 14 March and I was discharged at 8:20am on 18 March. What hospital cash does Meridian give me for that?"]);
  show("Q5 paraphrase", para5[0]);
  await check("N2 paraphrase: an estimate first called a payout is sent back once for its wording only; the restated indicative estimate (\"isn't a guaranteed amount\") is shown", () => {
    const t = para5[0];
    assert.equal(formRepairAsked(t).length, 1, JSON.stringify((t.trace.toolCalls as any[]).map((x) => [x.name, x.ok, String(x.error ?? "").slice(0, 200)])));
    assert.match(t.visible, /S\$360/, t.visible);
    assert.doesNotMatch(t.visible, /Your payout/i, t.visible); assert.match(t.visible, /indicative estimate is S\$360/, t.visible);
  });

  // ------------------------------------------------------------------------------------------- linking (run 4)
  // ingest-live-4: the endorsement's insurer was read as "Meridian Harbour Assurance" (the schedule: "... Pte. Ltd."),
  // so it was linked to nobody and every child figure it printed was refused for Isla and Felix.
  const { linkRelatedReferenceDocuments } = await import("@/lib/policies/linking");
  const sched = (TB.policies as any[]).find((p) => p.document_role === "personal_schedule");
  const people = async (id: string) => ((await h.db.query("SELECT family_member_id::text AS m FROM policy_members WHERE policy_id=$1 ORDER BY 1", [id])).rows as { m: string }[]).map((r) => r.m);
  const addDoc = async (id: string, insurer: string, product: string, number: string) => {
    await h.db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash)
      VALUES($1,$2,$3,$4,$5,$6,'hospital_cash','endorsement',false,'ready',$8,$8,'scan_clean','active',$7)`, [id, ACCOUNT, sched.family_member_id, insurer, product, number, "sha256:" + id, id + ".pdf"]);
    await linkRelatedReferenceDocuments(ACCOUNT, id, null);
    return people(id);
  };
  const want = await people(sched.id);
  await check("K1 run 4: an endorsement whose insurer is read without \"Pte. Ltd.\" but prints the schedule's policy number and product is linked to the schedule's people", async () => {
    assert.ok(want.length >= 4, "the schedule's people: " + want.length);
    assert.deepEqual(await addDoc("11111111-1111-4111-8111-000000000001", "Meridian Harbour Assurance", sched.product_name, sched.policy_number), want);
  });
  await check("K2 layout: the policy number printed with spaces and lower case is the same number", async () => {
    assert.deepEqual(await addDoc("11111111-1111-4111-8111-000000000002", "Meridian Harbour", sched.product_name.toUpperCase(), String(sched.policy_number).toLowerCase().replace(/-/g, " ")), want);
  });
  await check("K3 the same number on another product is not linked (a number alone is not enough)", async () => {
    assert.deepEqual(await addDoc("11111111-1111-4111-8111-000000000003", "Other Insurer Ltd", "Other Hospital Plan", sched.policy_number), []);
  });

  // ------------------------------------------------------------------------------------------- Q2 (run 4)
  // The one repair asked the model to add "a limitation" with an amendment-removal example; the model added a removal
  // that had not happened. The repair names only what the check said.
  const Q2 = ["If something happened to Isla in an accident, how much is the accidental death payout for her? Is it the same as mine?"];
  const AD = "Accidental death or permanent total disablement (lump sum)";
  const q2Head = [
    () => [call("resolve_person", { mention: "Isla" })],
    () => [call("search_passages", { k: 10, query: "accidental death permanent total disablement lump sum child adult", policy_ids: [SAFE], subject_id: isla })],
    () => [call("select_table_value", { tier: "Child", want: "amount", benefit: AD, policy_id: SAFE, subject_id: isla })],
  ];
  const adult = (v: ScriptView) => hit(v, /S\$\s?150,000/);
  const q2 = await run([{ steps: [...q2Head,
    (v) => [call("final_answer", { subject_id: isla, sentences: [{ text: "For Isla, SafeStay lists S$40,000 for “Accidental death or permanent total disablement (lump sum)”, and for you it lists S$150,000, so it is not the same.", benefit: AD, value_ids: [data(v, "select_table_value").valueId], evidence_ids: [adult(v)] }] })],
    (v) => [call("final_answer", { subject_id: isla, sentences: [{ text: "For Isla, SafeStay lists S$40,000 for “Accidental death or permanent total disablement (lump sum)”.", benefit: AD, value_ids: [data(v, "select_table_value").valueId] }] })],
  ] }], Q2);
  show("Q2", q2[0]);
  await check("R1 Q2 (run 4): the one repair names only what the check said -- no amendment-removal example -- and the answer states no removal that did not happen", () => {
    const t = q2[0];
    const asked = (t.trace.toolCalls as any[]).filter((x) => x.name === "final_answer" && !x.ok);
    assert.equal(asked.length, 1, JSON.stringify((t.trace.toolCalls as any[]).map((x) => [x.name, x.ok])));
    assert.doesNotMatch(String(asked[0].error), /removed|amendment document/i, String(asked[0].error));
    assert.doesNotMatch(t.visible, /removed from the library|document was removed/i, t.visible);
    assert.match(t.visible, /S\$40,000/, t.visible);
  });

  // ------------------------------------------------------------------------------------------- Q2 child vs adult (run 5b)
  // ingest-live-5b: both supported figures were refused. S$40,000 was cited from the table row without a select_table_value
  // binding ("the figure is not bound to a column"), and S$150,000 sat in a sentence saying "the same benefit"
  // ("the sentence does not name the benefit"). Now: an unbound figure printed in exactly ONE person column of its row
  // stands only when that column applies to the person it is stated for; "the same benefit" names the benefit the
  // sentence just before named.
  const ADB = "Accidental death or permanent total disablement (lump sum)";
  const Q2C = ["If something happened to Isla in an accident, how much is the accidental death payout for her? Is it the same as mine?"];
  const q2cHead = [
    () => [call("resolve_person", { mention: "Isla" })],
    () => [call("resolve_person", { mention: "me" })],
    () => [call("policies_for", { topic: "accidental death", subject_id: isla }), call("policies_for", { topic: "accidental death", subject_id: simon })],
    () => [call("search_passages", { k: 10, query: "accidental death benefit amount child adult death due to accident exclusions conditions", policy_ids: [SAFE], subject_id: isla })],
  ];
  const row = (v: ScriptView) => hit(v, /S\$\s?150,000/);
  const comparison = (sentences: (v: ScriptView) => Record<string, unknown>[]) => run([{ steps: [...q2cHead,
    (v) => [call("final_answer", { subject_id: isla, sentences: sentences(v) })],
    (v) => [call("final_answer", { subject_id: isla, sentences: sentences(v) })],
  ] }], Q2C);
  const live2 = await comparison((v) => [
    { text: "For Isla, the SafeStay Family Hospital Cash & Personal Accident Plan lists S$40,000 for “Accidental death or permanent total disablement (lump sum)” in the Child column (page 1).", benefit: ADB, subject_id: isla, evidence_ids: [row(v)] },
    { text: "It is not the same as yours: the same benefit lists S$150,000 in the Adult column, so Isla’s listed amount is lower than yours (page 1).", benefit: ADB, subject_id: simon, evidence_ids: [row(v)] },
  ]);
  show("Q2 comparison (run 5b)", live2[0]);
  await check("C1 Q2 (run 5b, replayed): the correct child / adult comparison passes the save-time check first time -- S$40,000 for Isla, S$150,000 for the speaker, no repair", () => {
    const t = live2[0];
    assert.match(t.visible, /S\$40,000/, t.visible); assert.match(t.visible, /S\$150,000/, t.visible);
    assert.deepEqual(t.trace.gate ?? [], []);
    assert.equal((t.trace.toolCalls as any[]).filter((x) => x.name === "final_answer" && !x.ok).length, 0, "no repair was needed");
  });
  const swapped = await comparison((v) => [
    { text: "For Isla, the SafeStay Family Hospital Cash & Personal Accident Plan lists S$150,000 for “Accidental death or permanent total disablement (lump sum)” (page 1).", benefit: ADB, subject_id: isla, evidence_ids: [row(v)] },
    { text: "It is not the same as yours: the same benefit lists S$40,000 for you (page 1).", benefit: ADB, subject_id: simon, evidence_ids: [row(v)] },
  ]);
  show("Q2 swapped", swapped[0]);
  await check("C2 swapped figures fail: S$150,000 (the Adult column) stated for Isla and S$40,000 (the Child column) stated for the adult are both refused, even after the one repair", () => {
    const t = swapped[0];
    assert.doesNotMatch(t.visible, /S\$150,000/, t.visible); assert.doesNotMatch(t.visible, /S\$40,000/, t.visible);
    assert.equal((t.trace.toolCalls as any[]).filter((x) => x.name === "final_answer" && !x.ok).length, 1, "the one repair was asked");
    assert.ok((t.trace.gate as any[]).some((g) => /S\$150,000/.test(g.figure)) && (t.trace.gate as any[]).some((g) => /S\$40,000/.test(g.figure)), JSON.stringify(t.trace.gate));
  });
  const para2 = await comparison((v) => [
    { text: "For you, SafeStay’s “Accidental death or permanent total disablement (lump sum)” is S$150,000.", benefit: ADB, subject_id: simon, evidence_ids: [row(v)] },
    { text: "For Isla, that benefit is S$40,000, so hers is lower than yours.", benefit: ADB, subject_id: isla, evidence_ids: [row(v)] },
  ]);
  show("Q2 paraphrase", para2[0]);
  await check("C3 paraphrase / layout (adult first, “that benefit”): both figures pass", () => {
    const t = para2[0];
    assert.match(t.visible, /S\$150,000/, t.visible); assert.match(t.visible, /S\$40,000/, t.visible);
    assert.deepEqual(t.trace.gate ?? [], []);
  });
  const noRef = await comparison((v) => [
    { text: "For Isla, SafeStay lists S$40,000 for “Accidental death or permanent total disablement (lump sum)”.", benefit: ADB, subject_id: isla, evidence_ids: [row(v)] },
    { text: "Yours is S$150,000.", benefit: ADB, subject_id: simon, evidence_ids: [row(v)] },
  ]);
  await check("C4 a sentence that neither names the benefit nor refers back to it still fails (“Yours is S$150,000.”)", () => {
    const t = noRef[0];
    assert.doesNotMatch(t.visible, /S\$150,000/, t.visible); assert.match(t.visible, /S\$40,000/, t.visible);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2 conv7 regressions ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Conversational RAG, round 8 (npm run rag2:conv6-test): three conversation defects of the second live ingestion run,
 * reproduced from that run's own dump (documents as extraction stored them, members, person links) and the live model's
 * tool calls, plus one paraphrase each. Every turn goes through the REAL chat route (PGlite, DEARPOLICY_RAG_LOOP=1) with
 * the TEST-ONLY scripted model; what is asserted is the saved loop state and what the household is served.
 *   V  a sentence the save-time gate rejects is repaired once by the model (told the reason and the evidence ids) and
 *      re-checked by the same composer and gate; failing that it is left out with a precise limitation -- never a
 *      figure-free rewrite ("a set amount") and never a manufactured uncertainty.
 *   A  an answer typed into the question card ("<question>: <answer>") answers that question: the fact is recorded as
 *      the household's report, the pending question is cleared in the saved state, and it is never asked again.
 *   H  "exactly 3 days" under an hours-based rule: why the times matter, a what-if only from a calculate what_if with the
 *      assumed times marked (never as the amount for their stay), and the question for the real dates and times.
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
const RUN = readdirSync(RUN_ROOT).filter((d) => d.startsWith("RUN-ingest-live-2-")).sort().at(-1)!;
const DUMP = JSON.parse(readFileSync(path.join(RUN_ROOT, RUN, "dump-final", "dump.json"), "utf8"));
const TB = DUMP.tables;
const ACCOUNT = DUMP.householdId as string;

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_ACCOUNT_ID = ACCOUNT;
process.env.E2E_RUN_ID = "rag2conv6";
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
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled in rag2:conv6-test: " + String(input)); }) as typeof fetch;
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
  return { send, saved };
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
  const show = (label: string, t: { visible: string; trace: any }) => { if (process.env.REPRO) console.log(`--- ${label}\n${t.visible}\n  [composed] ${JSON.stringify(t.trace?.composed ?? [])}\n  [gate] ${JSON.stringify(t.trace?.gate ?? [])}\n  [calls] ${JSON.stringify((t.trace?.toolCalls ?? []).map((x: any) => [x.name, x.ok, String(x.error ?? "").slice(0, 160)]))}\n`); };
  const felix = member(/^Felix/), isla = member(/^Isla/);
  const SAFE = policy(/SafeStay/, "personal_schedule"), ENDT = policy(/SafeStay/, "endorsement"), JUNIOR = policy(/JuniorShield/);
  /** Set once the save-time gate accepts a conditional illustration whose assumed inputs the sentence states (A2). */
  const GATE_ACCEPTS_WHAT_IF = process.env.GATE_ACCEPTS_WHAT_IF === "1";
  const REWRITE = /\ba set amount\b|\bthe policy limit\b/i;
  const repairAsked = (v: ScriptView) => v.last.some((o) => o.name === "final_answer" && !o.ok && /save-time check/i.test(JSON.stringify(o.result)));

  // ------------------------------------------------------------------------------------------- Q9 (replay)
  const Q9 = ["Oh, by the way, if one of the kids gets dengue, which of our policies would actually pay anything?"];
  const q9Head = [
    () => [call("resolve_person", { mention: "one of the kids" })],
    () => [call("search_passages", { query: "dengue fever dengue hospitalisation infectious disease illness benefit exclusions" })],
    () => [call("policies_for", { topic: "dengue illness hospital", subject_id: felix }), call("policies_for", { topic: "dengue illness hospital", subject_id: isla })],
    () => [call("search_passages", { k: 10, query: "dengue fever hospitalisation lump sum conditions definition hospitalised minimum duration exclusions", policy_ids: [JUNIOR], subject_id: isla }),
      call("search_passages", { k: 10, query: "dengue fever hospitalisation lump sum conditions definition hospitalised minimum duration exclusions", policy_ids: [SAFE], subject_id: felix }),
      call("search_passages", { k: 10, query: "endorsement revised hospital daily allowance child effective date", policy_ids: [ENDT], subject_id: felix }),
      call("search_passages", { k: 10, query: "schedule of benefits hospital daily allowance adult child", policy_ids: [SAFE], subject_id: felix })],
    () => [call("select_table_value", { want: "amount", benefit: "Hand, foot & mouth disease or dengue fever hospitalisation (lump sum)", policy_id: JUNIOR, subject_id: isla })],
  ];
  const q9Sentences = (v: ScriptView, felixText: string) => { const s = data(v, "select_table_value"); return [
    { text: "For Isla, JuniorShield Child Hospital Income Plan lists “Hand, foot & mouth disease or dengue fever hospitalisation (lump sum)” of S$500; the certificate says it covers illness and accident, but refers to full policy conditions for definitions and exclusions, which aren’t in the document extract I can see.", benefit: "Hand, foot & mouth disease or dengue fever hospitalisation (lump sum)", value_ids: [s.valueId], subject_id: isla, evidence_ids: [hit(v, /Child accidental death/)] },
    { text: felixText, benefit: "Hospital daily allowance (per day of confinement)", subject_id: felix, evidence_ids: [hit(v, /Who is covered/), hit(v, /disease is not covered/), hit(v, /At the request of the Policy Owner/), hit(v, /Schedule of Benefits/)] },
    { text: "For Isla, SafeStay is also accident-only and excludes illness or disease confinement, so it would not pay for dengue.", subject_id: isla, evidence_ids: [hit(v, /Who is covered/), hit(v, /disease is not covered/)] },
  ]; };
  const LIVE_FELIX = "For Felix, the SafeStay Family Hospital Cash & Personal Accident Plan is accident-only and says confinement due to illness or disease is not covered, so it would not pay for dengue; its child hospital daily allowance is S$80 per day in the schedule, but an endorsement revises it to S$110 per day from 1 July 2026, and the endorsement’s effective date is not confirmed in the records.";
  const REPAIRED_FELIX = "For Felix, the SafeStay Family Hospital Cash & Personal Accident Plan is accident-only and says confinement due to illness or disease is not covered, so it would not pay for dengue; its child hospital daily allowance was previously S$80 per day, and is S$110 per day from 1 July 2026 under the endorsement.";
  // As the live model did (one final_answer), then -- if the loop asks for a repair -- the model's repaired sentences.
  const q9 = (repaired: string): ScriptTurn[] => [{ steps: [...q9Head,
    (v) => [call("final_answer", { subject_id: isla, sentences: q9Sentences(v, LIVE_FELIX) })],
    (v) => [call("final_answer", { subject_id: isla, sentences: q9Sentences(v, repaired) })],
  ] }];
  const live9 = await run(q9(REPAIRED_FELIX), Q9);
  show("Q9 (repair succeeds)", live9[0]);
  await check("V1 Q9: the rejected sentence is repaired once by the model (told the gate's reason and the evidence ids) and the repaired text, checked by the same composer and gate, is shown -- no figure-free rewrite", () => {
    const t = live9[0];
    assert.doesNotMatch(t.visible, REWRITE, t.visible);
    assert.doesNotMatch(t.visible, /not confirmed in the records/, t.visible);
    const asked = (t.trace.toolCalls as any[]).filter((x) => x.name === "final_answer" && !x.ok);
    assert.equal(asked.length, 1, "one bounded repair: " + JSON.stringify(t.trace.toolCalls.map((x: any) => [x.name, x.ok])));
    assert.match(String(asked[0].error), /S\$80/);
    assert.match(t.visible, /S\$500/); assert.match(t.visible, /accident-only/);
    assert.match(t.visible, /previously S\$80 per day, and is S\$110 per day from 1 July 2026/, t.visible);
    assert.deepEqual(t.trace.gate, []);
  });
  const stuck9 = await run(q9(LIVE_FELIX), Q9);
  show("Q9 (repair fails)", stuck9[0]);
  await check("V2 Q9: when the repair fails the sentence is left out with a precise limitation naming the benefit and the document; independent valid sentences stay", () => {
    const t = stuck9[0];
    assert.doesNotMatch(t.visible, REWRITE, t.visible);
    assert.doesNotMatch(t.visible, /S\$80|not confirmed in the records/, t.visible);
    assert.match(t.visible, /S\$500/); assert.match(t.visible, /For Isla, SafeStay is also accident-only/);
    assert.match(t.visible, /Hospital daily allowance/, t.visible);
    assert.match(t.visible, /SafeStay Family Hospital Cash & Personal Accident Plan/, t.visible);
  });
  // Paraphrase: the change said another way, the date claim about a printed date.
  const para9 = await run([{ steps: [...q9Head,
    (v) => [call("final_answer", { subject_id: felix, sentences: [{ text: "Felix's SafeStay daily allowance stood at S$80 a day under the schedule; the endorsement lifts it to S$110 a day, though its start date isn't stated anywhere.", benefit: "Hospital daily allowance (per day of confinement)", subject_id: felix, evidence_ids: [hit(v, /At the request of the Policy Owner/), hit(v, /Schedule of Benefits/)] }] })],
    (v) => [call("final_answer", { subject_id: felix, sentences: [{ text: "Felix's SafeStay daily allowance stood at S$80 a day under the schedule; the endorsement lifts it to S$110 a day, though its start date isn't stated anywhere.", benefit: "Hospital daily allowance (per day of confinement)", subject_id: felix, evidence_ids: [hit(v, /At the request of the Policy Owner/), hit(v, /Schedule of Benefits/)] }] })],
  ] }], ["Felix's daily hospital allowance under SafeStay -- did the endorsement change it?"]);
  show("Q9 paraphrase", para9[0]);
  await check("V3 paraphrase: a sentence saying a date is not stated, when its cited evidence prints that date, is never shown; nor is any figure-free rewrite", () => {
    const t = para9[0];
    assert.doesNotMatch(t.visible, /isn’t stated|isn't stated|not stated anywhere/, t.visible);
    assert.doesNotMatch(t.visible, REWRITE, t.visible);
  });

  // ------------------------------------------------------------------------------------------- Q4 (replay)
  const Q4Q = "Has a registered medical practitioner certified the wrist fracture in writing and confirmed it by X-ray?";
  const Q4 = ["Felix fell off the monkey bars at school yesterday and broke his wrist. How much can we claim from the Meridian policy?",
    Q4Q.replace(/\?$/, "") + ": The doctor said it's a closed fracture, the X-ray confirmed it, and the bone didn't come through the skin."];
  const q4Turn1: ScriptTurn = { steps: [
    () => [call("resolve_person", { mention: "Felix" })],
    () => [call("note_facts", { subject_id: felix, facts: [{ key: "how_it_happened", value: "fell off the monkey bars at school", words: "fell off the monkey bars at school" }, { key: "injury", value: "broke his wrist", words: "broke his wrist" }] })],
    () => [call("policies_for", { topic: "accident", subject_id: felix })],
    () => [call("search_passages", { k: 10, query: "Meridian wrist fracture broken bone accidental injury benefit X-ray confirmation registered medical practitioner", subject_id: felix })],
    () => [call("select_table_value", { tier: "Child", want: "amount", benefit: "Fractured bones (per Accident) — Simple (closed) fracture", policy_id: SAFE, subject_id: felix }),
      call("select_table_value", { tier: "Child", want: "amount", benefit: "Fractured bones (per Accident) — Compound (open) fracture", policy_id: SAFE, subject_id: felix })],
    () => [call("search_passages", { k: 5, query: "Clause 4.4 fractured bones simple closed compound open fracture wrist X-ray certified registered medical practitioner only one item same bone accident", policy_ids: [SAFE], subject_id: felix })],
    (v) => { const s = data(v, "select_table_value", (o) => /Simple/.test(o.args.benefit)), c = data(v, "select_table_value", (o) => /Compound/.test(o.args.benefit));
      return [call("ask_user", { kind: "fact", preface: "I’m sorry Felix was hurt.", fact_key: "fracture_xray_certification", question: Q4Q, subject_id: felix, because_evidence_ids: [hit(v, /Items D and E/)],
        statements: [{ text: `For Felix, the policy lists S$${s.value} per accident for a simple (closed) fracture and S$${c.value.toLocaleString("en-SG")} per accident for a compound (open) fracture; the fracture type must be certified in writing by a registered medical practitioner and confirmed by X-ray, and only one of these benefits is payable for the same bone in the same accident.`, benefit: "Fractured bones (per Accident)", value_ids: [s.valueId, c.valueId], evidence_ids: [hit(v, /Items D and E/)] }] })]; },
  ] };
  const q4Turn2 = (facts: Record<string, unknown>[], text: string): ScriptTurn => ({ steps: [
    () => [call("note_facts", { subject_id: felix, facts })],
    () => [call("search_passages", { k: 5, query: "fractured bones simple closed fracture X-ray certified", policy_ids: [SAFE], subject_id: felix }), call("select_table_value", { tier: "Child", want: "amount", benefit: "Fractured bones (per Accident) — Simple (closed) fracture", policy_id: SAFE, subject_id: felix })],
    (v) => { const s = data(v, "select_table_value"); return [call("final_answer", { subject_id: felix, sentences: [
      { text, subject_id: felix },
      { text: `For Felix, the Meridian policy lists S$${s.value} per accident for a simple (closed) fracture, payable when the fracture type is certified in writing by a registered medical practitioner and confirmed by X-ray; only one fracture benefit is payable for the same bone in the same accident.`, benefit: "Fractured bones (per Accident)", value_ids: [s.valueId], subject_id: felix, evidence_ids: [hit(v, /Items D and E/)] },
    ] })]; },
  ] });
  const t4 = await run([q4Turn1, q4Turn2([{ key: "fracture_type", value: "closed fracture", words: "The doctor said it's a closed fracture" }, { key: "fracture_xray_confirmation", value: "yes", words: "the X-ray confirmed it" }, { key: "bone_through_skin", value: "no", words: "the bone didn't come through the skin" }],
    "You told me the doctor said it’s a closed fracture, the X-ray confirmed it, and the bone didn’t come through the skin.")], Q4);
  show("Q4 turn 2", t4[1]);
  const answered = (t: { loop: any; answer: ChatAnswer }, label: string) => {
    assert.ok(!(t.loop.pending?.kind === "fact" && t.loop.pending.factKey === "fracture_xray_certification"), `${label}: pending still open in saved state: ${JSON.stringify(t.loop.pending)}`);
    assert.ok(!(t.answer.questions ?? []).some((q) => /certified|X-ray/i.test(q.text)), `${label}: the card asks again: ${JSON.stringify(t.answer.questions)}`);
    const f = t.loop.claim?.facts?.fracture_xray_certification;
    assert.ok(f && f.source === "user_reported", `${label}: answer recorded under the asked fact, as their report: ${JSON.stringify(t.loop.claim?.facts)}`);
  };
  await check("A1 Q4: the answer typed into the card answers the question -- recorded as their report, cleared from the saved state, never asked again; the conditional benefit is explained", () => {
    answered(t4[1], "Q4");
    assert.match(t4[1].visible, /S\$600 per accident for a simple \(closed\) fracture, payable when/, t4[1].visible);
    assert.doesNotMatch(t4[1].visible, /here is the question I was on/i);
  });
  const t4b = await run([q4Turn1, q4Turn2([{ key: "fracture_hairline", value: "hairline fracture", words: "the doc confirmed it was a hairline fracture" }], "You told me the doc confirmed it was a hairline fracture.")],
    [Q4[0], Q4Q.replace(/\?$/, "") + ": Yes, the doc confirmed it was a hairline fracture on the X-ray."]);
  show("Q4 paraphrase turn 2", t4b[1]);
  await check("A2 paraphrase (\"the doc confirmed it was a hairline fracture\"): same -- answered in the saved state and the card", () => { answered(t4b[1], "hairline"); });

  // ------------------------------------------------------------------------------------------- R1
  const PREV = "Did that endorsement letter change anything? How much is the daily hospital allowance for the kids now?";
  const prevTurn: ScriptTurn = { steps: [
    () => [call("resolve_person", { mention: "Isla" })],
    () => [call("select_table_value", { tier: "Child", want: "amount", benefit: "Hospital daily allowance (per day of confinement)", policy_id: ENDT, subject_id: isla })],
    (v) => { const x = data(v, "select_table_value"); return [call("final_answer", { subject_id: isla, sentences: [{ text: `The endorsement changed the SafeStay “Hospital daily allowance (per day of confinement)” for each child from S$80 to S$${x.value} per day, from 1 July 2026.`, value_ids: [x.valueId] }] })]; },
  ] };
  const whatIf = (days: number, words: string, stayWords: string, how: string): ScriptTurn => ({ steps: [
    () => [call("resolve_person", { mention: "Isla" }), call("note_facts", { subject_id: isla, facts: [{ key: "how_it_happened", value: how, words: how }] })],
    () => [call("search_passages", { k: 5, query: "how days of confinement are counted complete period of 24 consecutive hours remaining 12 hours accident-only", policy_ids: [SAFE], subject_id: isla }),
      call("select_table_value", { tier: "Child", want: "amount", benefit: "Hospital daily allowance (per day of confinement, max 60 days per policy year)", policy_id: SAFE, subject_id: isla })],
    (v) => { const x = data(v, "select_table_value"); const end = String(1 + days).padStart(2, "0");
      return [call("calculate", { calculator: "hospital_cash", purpose: "what_if", subject_id: isla, policy_id: SAFE, benefit: "Hospital daily allowance (per day of confinement, max 60 days per policy year)", rate_value_id: x.valueId,
        admission: { at: "2026-08-01T10:00+08:00", words, assumed: true }, discharge: { at: `2026-08-${end}T10:00+08:00`, words, assumed: true } })]; },
    (v) => { const c = data(v, "calculate"); const rid = c.calc_id ?? c.calcId ?? c.resultId ?? c.result_id;
      if (c.kind !== "conditional_illustration" || !rid) throw new Error("script: what_if did not illustrate: " + JSON.stringify(c).slice(0, 400));
      return [call("ask_user", { kind: "fact", fact_key: "admission_discharge_datetime", subject_id: isla, because_evidence_ids: [hit(v, /How days of confinement are counted/)],
        preface: `The amount depends on the admission and discharge times, not on “${stayWords}”.`,
        statements: [{ text: `If you mean exactly ${days * 24} hours (admitted and discharged at the same time of day, in August 2026), then the indicative illustration is S$${c.amount} for that assumed stay.`, result_id: rid }],
        question: "What were Isla’s admission and discharge dates and times, as shown on the hospital record?" })]; },
  ] });
  const R1 = "So if Isla was in hospital for exactly 3 days in August after falling at the playground, how much would Meridian pay?";
  const t1 = await run([prevTurn, whatIf(3, "exactly 3 days in August", "exactly 3 days", "after falling at the playground")], [PREV, R1]);
  show("R1 turn 2", t1[1]);
  const whatIfShown = (t: { visible: string; answer: ChatAnswer; trace: any }, amount: string, hours: number, label: string) => {
    const calc = (t.trace.toolCalls as any[]).find((x) => x.name === "calculate");
    assert.ok(calc?.ok, `${label}: calculate what_if ran: ${JSON.stringify(calc)}`);
    // The what-if as composed (cited, bound to the calculate record): its assumed stay, the endorsement's rate, the
    // cap assumption and the accident-only condition, all in the one sentence.
    const whatIf = ((t.trace.composed ?? []) as string[]).find((x) => new RegExp(`If you mean exactly ${hours} hours[^.]*S\\$${amount}`).test(x));
    assert.ok(whatIf, `${label}: composed what-if: ${JSON.stringify(t.trace.composed)}`);
    assert.match(whatIf!, /accident/i, `${label}: the accident-only condition`);
    assert.match(whatIf!, /assum/i, `${label}: the assumptions marked`);
    assert.match(whatIf!, /revised by the endorsement/, `${label}: the rate in force`);
    if (GATE_ACCEPTS_WHAT_IF) assert.match(t.visible, new RegExp(`If you mean exactly ${hours} hours[^.]*S\\$${amount}`), `${label}:\n${t.visible}`);
    else {
      // Until the gate accepts a marked what-if (routed to A2), what is shown is honest: why the times matter, no
      // amount, a precise note about the what-if, and the question.
      assert.ok(!t.trace.gate.length || t.trace.gate.every((g: any) => g.figure === `S$${amount}`), JSON.stringify(t.trace.gate));
      if (t.trace.gate.length) { assert.doesNotMatch(t.visible, new RegExp(`S\\$${amount}`)); assert.match(t.visible, /what-if amount/); assert.doesNotMatch(t.visible, /couldn’t confirm one of the figures/); }
      assert.match(t.visible, /depends on the admission and discharge times/);
    }
    assert.doesNotMatch(t.visible, new RegExp(`(?:would|will) (?:get|receive|be paid)[^.]*S\\$${amount}|^S\\$${amount} for (?:her|Isla)`, "im"), `${label}: never the amount for their stay`);
    assert.equal(t.answer.questions.length, 1); assert.match(t.answer.questions[0].text, /admission and discharge dates and times/);
  };
  await check("H1 R1: why the times matter, a what-if validated by calculate what_if with the assumed times marked and its conditions, then the question for the real dates and times", () => whatIfShown(t1[1], "330", 72, "R1"));
  const t1b = await run([prevTurn, whatIf(2, "She was in for 2 days in August", "2 days", "after a fall at the playground")], [PREV, "She was in for 2 days in August after a fall at the playground -- what does Meridian pay for that?"]);
  show("R1 paraphrase", t1b[1]);
  await check("H2 paraphrase (\"she was in for 2 days\"): the same, for 48 hours", () => whatIfShown(t1b[1], "220", 48, "2 days"));
  await check("H3 an illustration stated as the amount for their actual stay is never shown", async () => {
    const asIfReal = await run([prevTurn, { steps: [...whatIf(3, "exactly 3 days in August", "exactly 3 days", "after falling at the playground").steps.slice(0, 3),
      (v) => { const c = data(v, "calculate"); const rid = c.calc_id ?? c.calcId ?? c.resultId ?? c.result_id; return [call("final_answer", { subject_id: isla, sentences: [{ text: `Meridian would pay S$${c.amount} for Isla's 3 days.`, result_id: rid }] })]; },
      (v) => { const c = data(v, "calculate"); const rid = c.calc_id ?? c.calcId ?? c.resultId ?? c.result_id; return [call("final_answer", { subject_id: isla, sentences: [{ text: `Isla's stay comes to S$${c.amount}.`, result_id: rid }] })]; }] }], [PREV, R1]);
    show("H3", asIfReal[1]);
    assert.doesNotMatch(asIfReal[1].visible, /S\$330/, asIfReal[1].visible);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2 conv6 regressions ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Conversational RAG, round 7 (npm run rag2:conv5-test): the live ingestion run's loop defects, reproduced
 * deterministically. The household, its members and its documents are built from the run's own database dump
 * (docs/rag-migration/ingest-live/RUN-ingest-live-1-<time>/dump-final/dump.json): page text exactly as extraction stored it.
 * Each turn goes through the REAL chat route (PGlite, DEARPOLICY_RAG_LOOP=1) with the TEST-ONLY scripted model
 * replaying the live model's tool calls (ids taken from the real tools' results). What is asserted is what the
 * household is served (the read-side boundary the history / job routes apply).
 *   P  a preface that only explains why a fact is needed (in the household's own words) is shown, not refused.
 *   B  per-call context: a passage already shown this turn is not repeated in full; a tool result never lists the
 *      same evidence twice; a turn running out of budget stops with a useful partial answer, never the bare limit text.
 *   F  a figure sentence the gate rejects never leaves the reply empty or generic: its figure-free part, or a
 *      specific statement of what could not be confirmed, is shown -- and the rejected figure never is.
 *   R  figure presence is checked against the evidence's whole row (an earlier value printed beside the cell).
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
const RUN = readdirSync(RUN_ROOT).filter((d) => d.startsWith("RUN-ingest-live-1-")).sort().at(-1)!;
const DUMP = JSON.parse(readFileSync(path.join(RUN_ROOT, RUN, "dump-final", "dump.json"), "utf8"));
const TB = DUMP.tables;
const ACCOUNT = DUMP.householdId as string;

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_ACCOUNT_ID = ACCOUNT;
process.env.E2E_RUN_ID = "rag2conv5";
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
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled in rag2:conv5-test: " + String(input)); }) as typeof fetch;
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
  const { FIGURE_LEFT_OUT_NOTE } = await import("@/lib/chat/answer-verification");
  const { LIMIT_TEXT } = await import("@/lib/rag2/loop/loop");
  const h = await startHarness();
  const run = async (script: ScriptTurn[], messages: string[], meter = false) => {
    const scripted = new ScriptedLoopModel(script);
    const model = meter ? new MeteredScript(scripted) : scripted;
    installLoopModel(model);
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
    return { turns, sizes: (model as MeteredScript).sizes ?? [] };
  };
  const show = (label: string, t: { visible: string; trace: any }) => { if (process.env.REPRO) console.log(`--- ${label}\n${t.visible}\n  [gate] ${JSON.stringify(t.trace?.gate ?? [])}\n  [dropped] ${JSON.stringify(t.trace?.dropped ?? [])}\n`); };
  const simon = member(/^Simon/), isla = member(/^Isla/);
  const SAFE = policy(/SafeStay/, "personal_schedule"), ENDT = policy(/SafeStay/, "endorsement"), JUNIOR = policy(/JuniorShield/);
  const generic = (t: { visible: string }) => t.visible.trim().split("\n").filter((l) => !/^This changes what your policy pays under/.test(l)).join("\n").trim() === FIGURE_LEFT_OUT_NOTE;

  // ------------------------------------------------------------------------------------------------ Q2 (replay)
  const Q2 = ["If something happened to Isla in an accident, how much is the accidental death payout for her? Is it the same as mine?"];
  const q2: ScriptTurn[] = [{ steps: [
    () => [call("resolve_person", { mention: "Isla" }), call("resolve_person", { mention: "mine" })],
    () => [call("policies_for", { topic: "accidental death", subject_id: isla }), call("policies_for", { topic: "accidental death", subject_id: simon })],
    () => [call("search_passages", { k: 10, query: "accidental death benefit payout amount child adult accidental death personal accident", policy_ids: [SAFE], subject_id: isla }),
      call("search_passages", { k: 10, query: "accidental death benefit payout amount adult accidental death personal accident", policy_ids: [SAFE], subject_id: simon }),
      call("search_passages", { k: 5, query: "accidental death benefit", policy_ids: [JUNIOR], subject_id: isla })],
    () => [call("select_table_value", { tier: "Child", want: "amount", benefit: "Accidental death or permanent total disablement (lump sum)", policy_id: SAFE, subject_id: isla }),
      call("select_table_value", { tier: "Adult", want: "amount", benefit: "Accidental death or permanent total disablement (lump sum)", policy_id: SAFE, subject_id: simon })],
    (v) => { const c = data(v, "select_table_value", (o) => o.args.tier === "Child"), a = data(v, "select_table_value", (o) => o.args.tier === "Adult");
      return [call("final_answer", { subject_id: isla, sentences: [
        { text: `For Isla, the SafeStay Family Hospital Cash & Personal Accident Plan lists S$${c.value.toLocaleString("en-SG")} for “Accidental death or permanent total disablement (lump sum)” in the Child column (page 1).`, benefit: "Accidental death or permanent total disablement (lump sum)", value_ids: [c.valueId] },
        { text: `That is not the same as yours: the same benefit lists S$${a.value.toLocaleString("en-SG")} in the Adult column for you, Simon (page 1).`, benefit: "Accidental death or permanent total disablement (lump sum)", value_ids: [a.valueId], subject_id: simon },
        { text: "Isla’s JuniorShield certificate also lists “Child accidental death” at S$20,000 (page 1), separate from the SafeStay benefit.", benefit: "Child accidental death", subject_id: isla, evidence_ids: [hit(v, /Child accidental death/)] },
      ] })]; },
  ] }];
  const r2 = await run(q2, Q2, true);
  show("Q2", r2.turns[0]);

  // ------------------------------------------------------------------------------------------------ Q8 (replay)
  const Q8 = ["Isla might need to stay in hospital two nights next week. Will her JuniorShield plan pay the $150 a day?"];
  const q8: ScriptTurn[] = [{ steps: [
    () => [call("resolve_person", { mention: "Isla" })],
    () => [call("note_facts", { facts: [{ key: "possible_hospital_stay", value: "2 nights", words: "might need to stay in hospital two nights next week" }], subject_id: isla })],
    () => [call("policies_for", { topic: "hospital cash", subject_id: isla })],
    () => [call("search_passages", { k: 10, query: "JuniorShield hospital income daily benefit $150 per day hospital stay eligibility waiting period minimum stay day counting exclusions", policy_ids: [JUNIOR], subject_id: isla }),
      call("search_passages", { k: 10, query: "hospital cash daily benefit child $150 per day admission minimum stay day count waiting period", policy_ids: [SAFE], subject_id: isla })],
    (v) => [call("final_answer", { subject_id: isla, sentences: [{ text: "Isla’s JuniorShield plan lists “Daily hospital income” of S$150 per day, up to 30 days per policy year, but it is payable only from the fourth consecutive day of hospitalisation, with the first three days not payable; a two-night stay would therefore not meet that stated threshold.", benefit: "Daily hospital income", evidence_ids: [hit(v, /Daily hospital income\*/), hit(v, /4th consecutive day/)] }] })],
  ] }];
  const r8 = await run(q8, Q8);
  show("Q8", r8.turns[0]);
  await check("F1 Q2 / Q8: when the gate rejects a figure sentence the reply is never the bare generic note; rejected figures are never shown", () => {
    for (const [label, t, rejected] of [["Q2", r2.turns[0], /S\$(?:40,000|150,000|20,000)/], ["Q8", r8.turns[0], /S\$150\b/]] as const) {
      assert.ok(!generic(t), `${label}: only the generic note:\n${t.visible}`);
      const gated = (t.trace.gate as any[]).map((g) => g.figure);
      for (const f of gated) assert.ok(!t.visible.includes(f), `${label}: rejected ${f} shown:\n${t.visible}`);
      if (!gated.length) assert.match(t.visible, rejected, `${label}: nothing rejected, so the figure stands`);
    }
  });
  await check("F2 Q8: the rejected sentence's figure-free part (the 4th-consecutive-day condition) is kept", () => {
    const t = r8.turns[0];
    if (!(t.trace.gate as any[]).length) return; // the gate accepted the figure (fixed elsewhere): nothing to rescue
    assert.match(t.visible, /fourth consecutive day|4th consecutive day/i, t.visible);
  });
  await check("F3 Q2: a specific statement of what could not be confirmed (the benefit and the document), not a generic failure", () => {
    const t = r2.turns[0];
    if (!(t.trace.gate as any[]).length) return;
    assert.match(t.visible, /Accidental death or permanent total disablement|Child accidental death/, t.visible);
  });

  // ------------------------------------------------------------------- R1: an explanatory preface in their words
  const R1 = ["So if Isla was in hospital for exactly 3 days in August after falling at the playground, how much would Meridian pay?"];
  const r1s: ScriptTurn[] = [{ steps: [
    () => [call("resolve_person", { mention: "Isla" })],
    () => [call("note_facts", { facts: [{ key: "days_in_hospital", value: "3", words: "in hospital for exactly 3 days" }, { key: "how_it_happened", value: "falling at the playground", words: "after falling at the playground" }], subject_id: isla })],
    () => [call("search_passages", { k: 5, query: "complete 24 hour periods remaining period of 12 hours days of confinement counted admission discharge", policy_ids: [SAFE], subject_id: isla })],
    (v) => [call("ask_user", { kind: "fact", fact_key: "admission_discharge_datetime", subject_id: isla,
      preface: "I can’t determine the amount from “exactly 3 days” alone because Meridian counts from the admission and discharge times, not the number of days as described.",
      question: "What were Isla’s hospital admission and discharge dates and times, as shown on the hospital record?", because_evidence_ids: [hit(v, /How days of confinement are counted/)] })],
    (v) => [call("ask_user", { kind: "fact", fact_key: "admission_discharge_datetime", subject_id: isla, question: "What were Isla’s hospital admission and discharge dates and times, as shown on the hospital record?", because_evidence_ids: [hit(v, /How days of confinement are counted/)] })],
  ] }];
  const rr1 = await run(r1s, R1);
  show("R1 preface", rr1.turns[0]);
  await check("P1 a preface that only explains why a fact is needed, in the household's own words (\"exactly 3 days\"), is shown -- not refused", () => {
    const t = rr1.turns[0];
    assert.equal((t.trace.toolCalls as any[]).filter((x) => x.name === "ask_user" && !x.ok).length, 0, JSON.stringify(t.trace.toolCalls.map((x: any) => [x.name, x.ok, x.error])));
    assert.match(t.visible, /exactly 3 days/);
    assert.equal(t.answer.questions.length, 1);
  });
  await check("P2 the same classifier still refuses an uncited cover or amount claim", async () => {
    const { composeFinal } = await import("@/lib/rag2/loop/compose");
    const { emptyLoopState } = await import("@/lib/rag2/loop/types");
    const { createToolContext } = await import("@/lib/rag2/tools");
    const ctx = { state: emptyLoopState(), tools: createToolContext({ accountId: ACCOUNT, speakerId: null, lastSubjectId: null, asOf: null }), computeCalls: new Map(), householdIds: new Set<string>(), userText: R1[0], userTexts: R1 };
    const keep = (t: string) => composeFinal({ sentences: [{ text: t }] }, ctx as any).sentences.length === 1;
    assert.ok(keep("I can’t determine the amount from “exactly 3 days” alone because Meridian counts from the admission and discharge times, not the number of days as described."));
    assert.ok(keep("To work it out I need the admission and discharge times, because you said it was exactly 3 days."));
    assert.ok(!keep("Meridian pays for 3 days of confinement."), "uncited cover claim");
    assert.ok(!keep("I can’t determine the amount from 4 days because the benefit covers 3 days."), "a number the household never gave");
    assert.ok(!keep("I can’t confirm the amount, but it is S$330."), "a money figure");
  });

  // -------------------------------------------- Q5: per-call context, and a turn that runs out of budget
  const Q5 = ["I was in hospital after that car accident in March. They admitted me at 9:40pm on 14 March and I was discharged at 8:20am on 18 March. How much hospital cash should Meridian pay me?"];
  const calc = (v: ScriptView, policyId: string, benefit: string) => call("calculate", { benefit, purpose: "claim", calculator: "hospital_cash", subject_id: simon, policy_id: policyId, rate_value_id: data(v, "select_table_value", (o) => o.result?.data?.status === "ok").valueId,
    admission: { at: "2026-03-14T21:40+08:00", words: "They admitted me at 9:40pm on 14 March" }, discharge: { at: "2026-03-18T08:20+08:00", words: "I was discharged at 8:20am on 18 March" } });
  const q5steps = [
    () => [call("note_facts", { subject_id: simon, facts: [{ key: "how_it_happened", value: "car accident", words: "that car accident" }, { key: "admission_datetime", value: "2026-03-14T21:40+08:00", words: "They admitted me at 9:40pm on 14 March" }, { key: "discharge_datetime", value: "2026-03-18T08:20+08:00", words: "I was discharged at 8:20am on 18 March" }] })],
    () => [call("policies_for", { topic: "hospital cash", subject_id: simon })],
    () => [call("search_passages", { k: 10, query: "hospital cash daily benefit accident admission discharge day count waiting period minimum stay maximum days prior use", policy_ids: [SAFE], subject_id: simon })],
    () => [call("select_table_value", { want: "any", benefit: "Hospital Cash", policy_id: SAFE, subject_id: simon })],
    () => [call("search_passages", { k: 10, query: "car accident hospital cash accident definition exclusions eligibility", policy_ids: [SAFE], subject_id: simon })],
    () => [call("select_table_value", { want: "any", tier: "Adult", benefit: "Hospital daily allowance (per day of confinement, max 60 days per policy year)", policy_id: SAFE, subject_id: simon })],
    (v: ScriptView) => [calc(v, ENDT, "Hospital daily allowance (per day of confinement)")],
  ] as ((v: ScriptView) => ScriptCall[])[];
  // As the live model did: keep retrying the calculation (another document's rate) -- never ending the turn itself.
  const retry = Array.from({ length: 30 }, () => (v: ScriptView) => [calc(v, ENDT, "Hospital daily allowance (per day of confinement)")]);
  const prevLimit = process.env.DEARPOLICY_RAG_LOOP_MAX_TOKENS;
  process.env.DEARPOLICY_RAG_LOOP_MAX_TOKENS = process.env.CONV5_TOKEN_LIMIT ?? "80000";
  let r5;
  try { r5 = await run([{ steps: [...q5steps, ...retry] }], Q5, true); } finally { if (prevLimit == null) delete process.env.DEARPOLICY_RAG_LOOP_MAX_TOKENS; else process.env.DEARPOLICY_RAG_LOOP_MAX_TOKENS = prevLimit; }
  show("Q5 (token-limited)", r5.turns[0]);
  if (process.env.REPRO) console.log("  [request sizes, chars] " + r5.sizes.join(", ") + "\n  [usage] " + JSON.stringify(r5.turns[0].trace.usage) + " " + JSON.stringify(r5.turns[0].trace.limit));
  await check("B1 Q5: a turn that runs out of budget gives a useful partial answer -- the supported printed figure and what is missing -- never only the limit text", () => {
    const t = r5.turns[0];
    assert.ok(!Object.values(LIMIT_TEXT).includes(t.visible.trim()), "bare limit text:\n" + t.visible);
    assert.match(t.visible, /S\$120 per day|S\$120\b/, t.visible);
    assert.match(t.visible, /\b(?:still|not yet|couldn’t|could not|missing|need)\b/i, t.visible);
  });
  await check("B2 Q5: repeated failures of the same tool stop being retried (the model is told to answer), well before the token limit", () => {
    const t = r5.turns[0];
    const fails = (t.trace.toolCalls as any[]).filter((x) => x.name === "calculate" && !x.ok);
    assert.ok(fails.length <= 3, `calculate failed ${fails.length} times`);
  });
  await check("B3 per-call context: no tool result lists the same evidence twice, and a passage already shown this turn is not repeated in full", () => {
    // Q2 searched the same SafeStay schedule twice (Isla, then Simon): the second result refers back.
    const sizes = r2.sizes;
    assert.ok(sizes.length >= 5);
    const growthFromSearches = sizes[3] - sizes[2];
    assert.ok(growthFromSearches < 26_000, `the three searches added ${growthFromSearches} characters to every later request`);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2 conv5 regressions ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

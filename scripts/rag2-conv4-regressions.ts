/**
 * Conversational RAG, round 7 (npm run rag2:conv4-test): a requested fact the household supplies is incorporated
 * and moves the claim forward -- reproduced deterministically from the real-model L3b failures (scripted model;
 * PGlite; the live household Lim; posted to the REAL chat route; what the chat page shows).
 *
 * In run r6-final-candidate, L3b turn 2 ("Yes, the doctor at the clinic did an X-ray and it showed the dislocation.")
 * was answered only "You told me the doctor at the clinic did an X-ray and it showed the dislocation." (note_facts,
 * then a final_answer with nothing citable); in r6-facts-fix-L3-L3b it was "I couldn't confirm an answer to that from
 * your documents." (the final_answer cited a value id issued in the earlier turn, and the wrong evidence). Both are
 * replayed here with the model's exact turn-2 tool calls -- including repeating the same mistake after the loop's
 * one bounded repair -- and the turn must still:
 *   1. say back what the household told us, attributed to them;
 *   2. explain the supported benefit again, cited and bound (re-using the evidence / value established earlier);
 *   3. state what still remains (the insurer checks the documents; their report is not reviewed medical evidence);
 *   4. move forward (a next step), never "approved" / "you will receive".
 * The same holds for another benefit and fact (L3, Kai's fracture: a table value issued two turns earlier).
 * REPRO=1 prints the visible text of each replayed turn.
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
process.env.E2E_RUN_ID = "rag2conv4";
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
const data = (v: ScriptView, name: string) => { const o = v.find(name); if (!o?.ok) throw new Error(`script: ${name} failed: ${JSON.stringify(o?.result).slice(0, 300)}`); return o.result.data; };
const hit = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => re.test(x.evidence?.excerpt ?? "")); if (h) return h.evidence.evidence_id as string; } throw new Error("script: no passage like " + re); };
/** The fact key of the claim question pending from the last turn (as the state note tells the model). */
const pendingKey = (v: ScriptView) => /Pending claim question \(fact_key=([a-z0-9_]+)/.exec(v.system)?.[1] ?? "confirmation";

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
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled in rag2:conv4-test: " + String(input)); }) as typeof fetch;
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
  const { sanitizeStoredAnswer } = await import("@/lib/chat/monetary-boundary");
  const { DROPPED_NOTE } = await import("@/lib/rag2/loop/compose");
  const Checker = await import("./rag2-live/check");
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
        const served = sanitizeStoredAnswer(JSON.parse(JSON.stringify(s.answer))) as ChatAnswer;
        turns.push({ answer: s.answer, served, content: s.content, loop: s.state.ragLoop, trace: s.state.ragLoop?.turns.at(-1), visible: UI.renderedAssistantText(s.content, served) });
      }
    } finally { installLoopModel(null); }
    return turns;
  };
  const show = (label: string, t: { visible: string }) => { if (process.env.REPRO) console.log(`--- ${label}\n${t.visible}\n`); };
  const mei = L.mei.id, kai = L.kai.id;
  const PW = doc("PLAYWELL").id, SUN = doc("SUNHAVEN").id;
  type Turn = Awaited<ReturnType<typeof run>>[number];
  /** The checker's view of a replayed turn (as scripts/rag2-live/check.ts loads it from the database). */
  const loaded = (t: Turn, user: string, index: number) => ({ index, user, answer: t.served as any, content: t.content, visible: t.visible, questions: (t.served.questions ?? []).map((q) => q.text), userAt: null, assistantAt: null, trace: t.trace });

  // ----------------------------------------------------------------------- L3b, Mei's dislocation (turn 1, as live)
  const M = ["Mei landed badly on her elbow at gymnastics this afternoon and the clinic says it's dislocated. Is that something her PlayWell plan helps with?", "Yes, the doctor at the clinic did an X-ray and it showed the dislocation."];
  const ask1 = (v: ScriptView, withStatements: boolean) => call("ask_user", { kind: "fact", preface: "I’m sorry Mei hurt herself.", fact_key: "dislocation_imaging_confirmation", subject_id: mei, question: "Has the dislocation been confirmed by X-ray or MRI?", because_evidence_ids: [hit(v, /confirmed by X-ray or MRI/)],
    ...(withStatements ? { statements: [{ text: "Mei’s PlayWell plan lists a Dislocation benefit of S$600 per dislocation, payable once if diagnosed by a registered medical practitioner and confirmed by X-ray or MRI.", benefit: "Dislocation benefit (per dislocation)", subject_id: mei, evidence_ids: [hit(v, /Dislocation benefit \(per dislocation\)/), hit(v, /confirmed by X-ray or MRI/)] }] } : {}) });
  const turn1: ScriptTurn = { steps: [
    () => [call("resolve_person", { mention: "Mei" })],
    () => [call("note_facts", { subject_id: mei, facts: [{ key: "how_it_happened", value: "landed badly on her elbow at gymnastics", words: "Mei landed badly on her elbow at gymnastics this afternoon" }, { key: "injury", value: "dislocated elbow", words: "the clinic says it's dislocated" }] })],
    () => [call("policies_for", { subject_id: mei, topic: "accident" })],
    () => [call("search_passages", { subject_id: mei, k: 10, query: "PlayWell dislocation elbow accident injury benefit dislocation coverage conditions" })],
    (v) => [ask1(v, true)],
    (v) => [ask1(v, false)],
  ] };
  const note2 = (v: ScriptView) => call("note_facts", { subject_id: mei, facts: [{ key: pendingKey(v), value: "yes", words: "the doctor at the clinic did an X-ray and it showed the dislocation" }] });
  // r6-final-candidate turn 2, verbatim: note_facts, then a final_answer that only says back what they said.
  const echo = () => [call("final_answer", { subject_id: mei, sentences: [{ text: "You told me the doctor at the clinic did an X-ray and it showed the dislocation." }] })];
  // r6-facts-fix-L3-L3b turn 2, verbatim: the figure cites the earlier turn's ids as the model guessed them (e1, e2, v1).
  const guessed = () => [call("final_answer", { subject_id: mei, sentences: [{ text: "Mei’s PlayWell plan lists a Dislocation benefit of S$600 per dislocation, payable when a registered medical practitioner diagnoses the dislocation and confirms it by X-ray or MRI; you said the clinic doctor’s X-ray showed the dislocation.", benefit: "Dislocation", value_ids: ["v1"], subject_id: mei, evidence_ids: ["e1", "e2"] }] })];
  const replay = (final: () => ScriptCall[]): ScriptTurn[] => [turn1, { steps: [(v) => [note2(v)], final, final, final] }];

  const a = await run(replay(echo), M);
  show("L3b turn 1", a[0]); show("L3b turn 2, replay of r6-final-candidate (echo)", a[1]);
  const b = await run(replay(guessed), M);
  show("L3b turn 2, replay of r6-facts-fix-L3-L3b (earlier-turn ids guessed)", b[1]);

  const supported = (t: Turn, what: string) => {
    const v = t.visible;
    assert.notEqual(v.trim(), DROPPED_NOTE, what + ": the generic failure");
    assert.match(v, /You told me[^.]*X-ray[^.]*dislocation/i, what + ": their statement, attributed: " + v);
    assert.match(v, /S\$600[^.]*(?:X-ray|MRI|registered medical practitioner)/i, what + ": the benefit, with its condition: " + v);
    assert.ok((t.served.figureBindings ?? []).some((x: any) => x.value === 600 && x.policyId === PW && x.subjectId === mei), what + ": S$600 bound to Mei / PlayWell " + JSON.stringify(t.served.figureBindings));
    for (const [page, re] of [[1, /Dislocation benefit \(per dislocation\)/], [2, /confirmed by X-ray or MRI/]] as const)
      assert.ok((t.served.citations ?? []).some((c) => c.policyId === PW && c.pageStart === page && re.test(c.excerpt ?? "")), what + `: cites PlayWell p${page} ` + JSON.stringify((t.served.citations ?? []).map((c) => [c.pageStart, (c.excerpt ?? "").slice(0, 50)])));
    assert.match(v, /insurer/i, what + ": what remains (the insurer's review): " + v);
    assert.match(v, /your own account|not a (?:reviewed )?medical record/i, what + ": their statement is not reviewed medical evidence: " + v);
    assert.doesNotMatch(v, Checker.ENTITLEMENT, what + ": never approval / payment / entitlement");
    assert.doesNotMatch(v, /\bapproved\b|\byou will receive\b|\bso it is payable\b|\bconfirmed by your doctor\b/i, what);
    assert.equal((t.served.questions ?? []).filter((q) => /x-?ray|\bmri\b|scan/i.test(q.text)).length, 0, what + ": the X-ray is not asked again");
    assert.ok((t.served.nextSteps ?? []).length >= 1 || (t.served.questions ?? []).length === 1, what + ": a next step (or the next material question)");
    const fact = Object.entries(t.loop.claim.facts).find(([k]) => /x.?ray|imag|confirm/.test(k))?.[1] as any;
    assert.equal(fact?.source, "user_reported", what + ": recorded as the household's report, never as medical evidence");
    const u = Checker.turnUsefulness(loaded(t, M[1], 1) as any);
    assert.ok(u.ok, what + ": the live checker grades the turn useful: " + u.detail);
  };
  await check("R1 L3b turn 2, replay of r6-final-candidate (echo only, repeated after the repair): attributed fact + the cited, bound S$600 with its condition + what remains + a next step", () => supported(a[1], "echo replay"));
  await check("R2 L3b turn 2, replay of r6-facts-fix-L3-L3b (earlier-turn ids guessed, repeated after the repair): the same supported answer, never the generic failure", () => supported(b[1], "guessed-ids replay"));
  await check("R3 the loop's one bounded repair tells the model which evidence / value ids the conversation already established", () => {
    for (const t of [a[1], b[1]]) {
      const refused = (t.trace.toolCalls as any[]).filter((x) => x.name === "final_answer" && !x.ok);
      assert.equal(refused.length, 1, "exactly one repair: " + JSON.stringify(t.trace.toolCalls.map((x: any) => [x.name, x.ok])));
      assert.match(refused[0].error, /evidence_ids=\[[^\]]*e\d/, refused[0].error);
      assert.match(refused[0].error, /You told me/, refused[0].error);
    }
  });

  // The model that follows the repair: re-cites the ids it was given (they come from the loop, not the script).
  const follows: ScriptTurn[] = [turn1, { steps: [(v) => [note2(v)], echo, (v) => {
    const err = String(v.last[0]?.result?.error ?? "");
    const ev = (/evidence_ids=\[([^\]]*)\]/.exec(err)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const text = /"([^"]*S\$600[^"]*)"/.exec(err)?.[1] ?? "";
    return [call("final_answer", { subject_id: mei, sentences: [{ text: "You told me the doctor at the clinic did an X-ray and it showed the dislocation." }, { text, evidence_ids: ev, benefit: "Dislocation benefit (per dislocation)" }],
      next_steps: ["Keep the clinic’s X-ray report and the doctor’s diagnosis to send with the claim form."] })];
  }] }];
  const c = await run(follows, M);
  show("L3b turn 2, a model that follows the repair", c[1]);
  await check("R4 a model that follows the repair: its own cited answer is kept (with what remains), and passes the same bar", () => {
    supported(c[1], "following model");
    assert.ok((c[1].served.nextSteps ?? []).some((s) => /X-ray report/.test(s)), JSON.stringify(c[1].served.nextSteps));
  });

  // ------------------------------------------- the same, for another benefit and fact: L3, Kai's fracture (value ids)
  const L3M = ["Kai broke his arm yesterday. Can we claim for it?", "He fell off his bicycle at the park.", "Yes, the hospital X-rayed it and the doctor said it is a fracture."];
  const head = [
    () => [call("resolve_person", { mention: "Kai" })],
    () => [call("note_facts", { subject_id: kai, facts: [{ key: "injury", value: "broke his arm", words: "Kai broke his arm yesterday." }] }), call("policies_for", { subject_id: kai, topic: "accident fracture" })],
    () => [call("search_passages", { subject_id: kai, k: 10, policy_ids: [SUN], query: "fracture benefit X-ray certified accident bodily injury sickness" }), call("select_table_value", { subject_id: kai, policy_id: SUN, benefit: "Fracture benefit (per fracture)", tier: "Child", want: "amount" })],
  ];
  const stmt = (v: ScriptView) => { const s = data(v, "select_table_value"); return [{ text: `Kai's SunHaven Family Accident Guard lists a Fracture benefit (per fracture) of S$${s.value} for a child.`, value_ids: [s.valueId] }]; };
  const xq = (v: ScriptView, st: boolean) => call("ask_user", { kind: "fact", fact_key: "fracture_xray_confirmed", subject_id: kai, ...(st ? { statements: stmt(v) } : {}), question: "Has a registered medical practitioner confirmed Kai’s fracture by X-ray?", because_evidence_ids: [hit(v, /confirmed by X-ray/)] });
  const kaiEcho = () => [call("final_answer", { subject_id: kai, sentences: [{ text: "You told me the hospital X-rayed it and the doctor said it is a fracture." }] })];
  const l3: ScriptTurn[] = [
    { steps: [...head, (v) => [call("ask_user", { kind: "fact", fact_key: "how_it_happened", subject_id: kai, question: "How did Kai break his arm?", because_evidence_ids: [hit(v, /solely and directly by an Accident/)] })]] },
    { steps: [
      () => [call("note_facts", { subject_id: kai, facts: [{ key: "how_it_happened", value: "fell off his bicycle at the park", words: "He fell off his bicycle at the park." }] })],
      () => [call("search_passages", { subject_id: kai, k: 10, policy_ids: [SUN], query: "fracture benefit X-ray certified" }), call("select_table_value", { subject_id: kai, policy_id: SUN, benefit: "Fracture benefit (per fracture)", tier: "Child", want: "amount" })],
      (v) => [xq(v, true)], (v) => [xq(v, false)] ] },
    { steps: [() => [call("note_facts", { subject_id: kai, facts: [{ key: "fracture_xray_confirmed", value: "yes", words: "the hospital X-rayed it and the doctor said it is a fracture" }] })], kaiEcho, kaiEcho, kaiEcho] },
  ];
  const k = await run(l3, L3M);
  show("L3 turn 2 (fracture benefit and its X-ray question)", k[1]); show("L3 turn 3, echo only after the X-ray answer", k[2]);
  await check("R5 any benefit and fact: Kai's fracture -- the table value issued the turn before is still citable, so the echo turn states the bound S$750 with its condition and what remains", () => {
    const v = k[2].visible;
    assert.match(v, /You told me[^.]*X-rayed/i, v);
    assert.match(v, /S\$750[^.]*X-ray/i, v);
    assert.ok((k[2].served.figureBindings ?? []).some((x: any) => x.value === 750 && x.policyId === SUN && x.subjectId === kai && x.column === "Child"), JSON.stringify(k[2].served.figureBindings));
    assert.match(v, /insurer/i, v);
    assert.doesNotMatch(v, Checker.ENTITLEMENT, v);
    assert.ok(Checker.turnUsefulness(loaded(k[2], L3M[2], 2) as any).ok);
  });

  // ------------------------------------------------------------------ nothing changes where no requested fact was given
  const plain: ScriptTurn[] = [{ steps: [() => [call("resolve_person", { mention: "Mei" })], () => [call("final_answer", { subject_id: mei, sentences: [{ text: "You told me Mei hurt her elbow." }] })]] }];
  const p = await run(plain, ["Mei hurt her elbow."]);
  await check("R6 a say-back with no question pending is left as the model wrote it (no repair, nothing added)", () => {
    assert.equal(p[0].visible.split("\n")[0], "You told me Mei hurt her elbow.", p[0].visible);
    assert.ok(!(p[0].trace.toolCalls as any[]).some((x) => x.name === "final_answer" && !x.ok));
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2 conv4 regressions ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

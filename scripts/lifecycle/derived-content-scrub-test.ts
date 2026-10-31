/**
 * Deleting a document also removes what chat answers and the coverage ledger took from it
 * (lib/lifecycle/derived-content-scrub.ts). A made-up household (a fictitious Brazilian life policy in R$ and a German
 * health policy in €) chats about both documents, then deletes one. The test checks that every stored answer about the
 * deleted document keeps no quote, figure, name or citation; that answers about the kept document, and the person's own
 * questions, are untouched; that the chat's working state, background results, cached analyses and ledger rows from it
 * are gone; and that one content-free audit entry records it. Disposable PGlite database, no network.
 *   npm run lifecycle:derived-content-scrub-test
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (() => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failed: string[] = [];
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n").slice(0,12).join(" | ") : String(e))); }
}

async function main() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const f of ["schema", "claim-evidence", "critical-illness", "disability", "coverage-ledger", "lifecycle", "chat-upgrade", "background-jobs", "storage-purge", "cover-conditions"]) {
    await db.exec(await readFile(path.resolve("sql/" + f + ".sql"), "utf8")).catch((e) => { throw new Error("sql/" + f + ".sql: " + (e as Error).message); });
  }
  let tail = Promise.resolve();
  const run = async (text: string, params: unknown[] = []) => {
    const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous;
    try {
      if (!params.length && text.includes(";")) { const res = (await db.exec(text)).at(-1); return { rows: res?.rows ?? [], rowCount: res?.affectedRows ?? 0 }; }
      const res = await db.query(text, params); return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    } finally { release(); }
  };
  (pool as unknown as { query: unknown }).query = run;
  (pool as unknown as { connect: unknown }).connect = async () => ({ query: run, release() {} });
  const q = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => run(text, params) as Promise<{ rows: T[]; rowCount: number }>;

  const { requestPolicyDocumentDeletion, finishPolicyDocumentDeletion } = await import("@/lib/lifecycle/coordinator");
  const { scrubDeletedDocumentDerivedContent, DERIVED_SCRUB_ACTION } = await import("@/lib/lifecycle/derived-content-scrub");
  const { STALE_ANSWER_NOTICE } = await import("@/lib/chat/stale-answers");

  async function household(name: string) {
    const accountId = randomUUID();
    await q(`INSERT INTO accounts(id,name) VALUES ($1,$2)`, [accountId, name]);
    return accountId;
  }
  async function member(accountId: string, name: string, relationship: string) {
    const id = randomUUID();
    await q(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,$3,$4)`, [id, accountId, name, relationship]);
    return id;
  }
  async function doc(accountId: string, owner: string, o: { file: string; insurer: string; product: string; policyNo: string }) {
    const id = randomUUID();
    await q(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status,insurer,product_name,policy_number)
             VALUES ($1,$2,$3,$4,$5,'ready','scan_clean',$6,$7,$8)`, [id, accountId, owner, o.file, accountId + "/" + id + "/" + o.file, o.insurer, o.product, o.policyNo]);
    await q(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES ($1,$2,$3)`, [id, owner, accountId]);
    return id;
  }
  async function ledgerRow(accountId: string, owner: string, policyId: string, plan: string, amount: number, currency: string, quote: string) {
    await q(`INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,event_type,amount,currency,quote) VALUES ($1,$2,$3,$4,'death',$5,$6,$7)`,
      [accountId, owner, policyId, plan, amount, currency, quote]);
  }
  async function conversation(accountId: string, owner: string, state: unknown, lastAnswer: unknown) {
    const id = randomUUID();
    await q(`INSERT INTO chat_conversations(id,account_id,family_member_id,title,state,last_answer) VALUES ($1,$2,$3,'Chat',$4::jsonb,$5::jsonb)`,
      [id, accountId, owner, JSON.stringify(state), lastAnswer == null ? null : JSON.stringify(lastAnswer)]);
    return id;
  }
  async function turn(accountId: string, owner: string, conversationId: string | null, question: string, answer: { content: string; citations: unknown; answer: unknown }) {
    await q(`INSERT INTO chat_messages(account_id,family_member_id,conversation_id,role,content) VALUES ($1,$2,$3,'user',$4)`, [accountId, owner, conversationId, question]);
    const r = await q<{ id: string }>(`INSERT INTO chat_messages(account_id,family_member_id,conversation_id,role,content,citations,answer_json) VALUES ($1,$2,$3,'assistant',$4,$5::jsonb,$6::jsonb) RETURNING id::text AS id`,
      [accountId, owner, conversationId, answer.content, answer.citations == null ? null : JSON.stringify(answer.citations), answer.answer == null ? null : JSON.stringify(answer.answer)]);
    return r.rows[0].id;
  }
  const answerOf = (summary: string, policyId: string, policyName: string, quote: string, amount: number, currency: string, person: string) => ({
    summary, details: [quote], conversationId: "c", conversationRevision: 3, mode: "answer", disclaimer: "DearPolicy explains documents; your insurer decides claims.",
    citations: [{ chunkId: "simple-" + policyId + "-p2-1", policyId, policyName, pageStart: 2, pageEnd: 2, excerpt: quote }],
    knownFacts: [{ key: "insured", value: person }], potentialPayoutTotals: [{ amount, currency }],
    policyReview: { observations: [{ text: quote }] }, claimItems: [{ label: "Death benefit", amount, currency }],
  });

  // A made-up household: the Oliveira family, São Paulo, with a policy from Germany too.
  const acc = await household("Oliveira household (fictitious)");
  const ana = await member(acc, "Ana Beatriz Oliveira", "self");
  const lucas = await member(acc, "Lucas Oliveira", "spouse");
  const vida = await doc(acc, ana, { file: "Vida-Segura-Ana.pdf", insurer: "Seguradora Aurora (fictitious)", product: "Vida Segura", policyNo: "VS-2024-778812" });
  const kranken = await doc(acc, lucas, { file: "Rheinland-Kranken-Lucas.pdf", insurer: "Rheinland Krankenversicherung (fictitious)", product: "Rheinland Komfort", policyNo: "RK-55-009134" });
  await ledgerRow(acc, ana, vida, "Vida Segura", 500000, "BRL", "Capital segurado por morte: R$ 500.000,00");
  await ledgerRow(acc, ana, vida, "Vida Segura", 100000, "BRL", "Invalidez permanente total por acidente: R$ 100.000,00");
  await ledgerRow(acc, lucas, kranken, "Rheinland Komfort", 20000, "EUR", "Krankenhaustagegeld bis 20.000 €");

  const vidaQuote = "Capital segurado por morte: R$ 500.000,00. Segurada: Ana Beatriz Oliveira.";
  const krankenQuote = "Krankenhaustagegeld bis 20.000 €. Versicherte Person: Lucas Oliveira.";
  const nights = { value: 3, state: "known", quote: "I was in for 3 nights", recordedAt: "2026-10-01T00:00:00Z", source: "user" };
  const bill = { value: 4200, state: "known", quote: "the bill was R$ 4.200", recordedAt: "2026-10-01T00:00:00Z", source: "user" };
  const conv1 = await conversation(acc, ana, { intent: "claim", activeClaimQuery: "I was in hospital for 3 nights", subjects: { [ana]: { nights, bill, sumAssured: { value: 500000, state: "known", quote: vidaQuote, recordedAt: "2026-10-01T00:00:00Z", source: "system-derived" }, facts: [{ policyId: vida, quote: vidaQuote }] } }, scenarios: { [ana]: [{ quote: vidaQuote }] }, claimSources: [vida], ragLoop: { claim: { calcs: { k1: { policyId: vida, amount: 500000 } } } } },
    answerOf("Ana is covered for R$ 500.000,00.", vida, "Vida Segura", vidaQuote, 500000, "BRL", "Ana Beatriz Oliveira"));
  const conv2 = await conversation(acc, lucas, { subjects: { [lucas]: { facts: [{ policyId: kranken }] } } }, answerOf("Lucas has hospital cash.", kranken, "Rheinland Komfort", krankenQuote, 20000, "EUR", "Lucas Oliveira"));
  const aboutVida = await turn(acc, ana, conv1, "How much does my life policy pay?", { content: "Ana is covered for R$ 500.000,00 by Vida Segura.", citations: [{ policyId: vida, excerpt: vidaQuote }], answer: answerOf("Ana is covered for R$ 500.000,00.", vida, "Vida Segura", vidaQuote, 500000, "BRL", "Ana Beatriz Oliveira") });
  const aboutBoth = await turn(acc, ana, conv1, "What do we have together?", { content: "Ana: R$ 500.000,00 life. Lucas: hospital cash.", citations: [{ policyId: kranken }, { policyId: vida }], answer: answerOf("Both.", kranken, "Rheinland Komfort", krankenQuote, 20000, "EUR", "Lucas Oliveira") });
  const aboutKranken = await turn(acc, lucas, conv2, "Do I get hospital cash?", { content: "Yes, up to 20.000 €.", citations: [{ policyId: kranken, excerpt: krankenQuote }], answer: answerOf("Yes, up to 20.000 €.", kranken, "Rheinland Komfort", krankenQuote, 20000, "EUR", "Lucas Oliveira") });
  // An older-style answer with no citations, which names the deleted document by its policy number only.
  const legacy = await turn(acc, ana, null, "Is policy VS-2024-778812 still mine?", { content: "Policy VS-2024-778812 (Vida Segura) insures Ana Beatriz Oliveira for R$ 500.000,00.", citations: null, answer: null });
  // A general reply that cites nothing but still states a figure from the document (an allow-list catches it).
  const general = await turn(acc, ana, null, "Roughly what am I covered for?", { content: "From what I can see, about R$ 500 mil with Seguradora Aurora.", citations: [], answer: { summary: "About R$ 500 mil.", citations: [], confidence: "insufficient_evidence" } });
  // A fact-finding question that names no document and states no figure is kept; one that states a figure is not.
  const askAdmitted = await turn(acc, ana, conv1, "I want to claim", { content: "When were you admitted?", citations: [], answer: { mode: "fact_finding", summary: "When were you admitted?", citations: [], questions: [{ text: "When were you admitted?" }], claimItems: [] } });
  const askWithFigure = await turn(acc, ana, conv1, "Go on", { content: "Your plan pays up to R$ 500.000,00. When were you admitted?", citations: [], answer: { mode: "fact_finding", summary: "Your plan pays up to R$ 500.000,00. When were you admitted?", citations: [], questions: [{ text: "When were you admitted?" }], claimItems: [] } });
  // An answer from before the document was added cannot hold anything from it, and is kept as it is.
  const before = await turn(acc, ana, null, "What is a waiting period?", { content: "A waiting period is the time before a cover starts.", citations: [], answer: null });
  await q(`UPDATE chat_messages SET created_at='2020-01-01' WHERE id=$1`, [before]);
  await q(`INSERT INTO chat_analysis_jobs(account_id,family_member_id,conversation_id,status,request_json,result_json) VALUES
      ($1,$2,$3,'completed','{"question":"life cover?"}',$4::jsonb), ($1,$2,$3,'queued','{"question":"again?"}',$4::jsonb), ($1,$5,$6,'completed','{"question":"hospital?"}',$7::jsonb)`,
    [acc, ana, conv1, JSON.stringify({ answer: { summary: vidaQuote }, retrieved: [{ policyId: vida, text: vidaQuote }] }), lucas, conv2, JSON.stringify({ retrieved: [{ policyId: kranken, text: krankenQuote }] })]);
  await q(`INSERT INTO policy_analysis_cache(account_id,cache_key,analysis_json) VALUES ($1,$2,'{"observations":["R$ 500.000,00"]}'),($1,$3,'{"done":1}'),($1,$4,'{"done":2}')`,
    [acc, "a".repeat(64), "catalog-progress:benefits:" + vida, "catalog-progress:benefits:" + kranken]);

  // A second, unrelated household whose chat must never be touched.
  const other = await household("Mensah household (fictitious)");
  const kofi = await member(other, "Kofi Mensah", "self");
  const otherDoc = await doc(other, kofi, { file: "Gold-Coast-Life.pdf", insurer: "Gold Coast Assurance (fictitious)", product: "Gold Life", policyNo: "GL-88120044" });
  // Even an answer that (wrongly) carries the same id text belongs to another household and is left alone.
  const otherAnswer = await turn(other, kofi, null, "My cover?", { content: "GH₵ 200,000 life cover.", citations: [{ policyId: otherDoc }, { note: vida }], answer: null });
  await q(`INSERT INTO policy_analysis_cache(account_id,cache_key,analysis_json) VALUES ($1,$2,'{"observations":["GH₵ 200,000"]}')`, [other, "b".repeat(64)]);

  const scoped = { query: run } as never;
  const msg = async (id: string) => (await q<{ content: string; citations: unknown; answer_json: unknown }>(`SELECT content,citations,answer_json FROM chat_messages WHERE id=$1`, [id])).rows[0];
  const text = (x: unknown) => JSON.stringify(x ?? null);

  await t("deleting a document redacts every stored answer about it: no quote, figure, name, person or citation is left", async () => {
    const req = await requestPolicyDocumentDeletion({ client: scoped, accountId: acc, actorUserId: randomUUID(), policyId: vida, reasonCategory: "user_requested", idempotencyKey: "derived-1" });
    assert.equal(req.status, "accepted");
    await finishPolicyDocumentDeletion({ accountId: acc, actorUserId: randomUUID(), policyId: vida, deletionRequestId: req.deletionRequestId });
    for (const id of [aboutVida, aboutBoth, legacy, general, askWithFigure]) {
      const m = await msg(id);
      assert.equal(m.content, STALE_ANSWER_NOTICE);
      const all = m.content + text(m.citations) + text(m.answer_json);
      for (const w of ["500.000", "500 mil", "Aurora", "Ana Beatriz", "Vida Segura", "VS-2024-778812", vida, "Segurada", "Lucas Oliveira", "20.000"]) assert.ok(!all.includes(w), `${w} left in ${id}`);
      assert.deepEqual(m.citations, []);
    }
    const a = (await msg(aboutVida)).answer_json as Record<string, unknown>;
    assert.equal(a.summary, STALE_ANSWER_NOTICE); assert.deepEqual(a.invalidated, { reason: "policy_deleted" });
    assert.equal(a.conversationRevision, 3, "which chat turn it was is kept");
    assert.equal(a.knownFacts, undefined); assert.equal(a.policyReview, undefined);
    assert.equal((await msg(legacy)).answer_json, null, "an older answer with no saved answer stays without one");
  });
  await t("answers about the kept document, answers from before it was added, and the person's own questions, are untouched", async () => {
    assert.equal((await msg(before)).content, "A waiting period is the time before a cover starts.");
    assert.equal((await msg(askAdmitted)).content, "When were you admitted?", "a plain fact-finding question is kept");
    const k = await msg(aboutKranken);
    assert.equal(k.content, "Yes, up to 20.000 €."); assert.match(text(k.answer_json), /Krankenhaustagegeld/);
    const questions = (await q<{ content: string }>(`SELECT content FROM chat_messages WHERE account_id=$1 AND role='user' ORDER BY message_order`, [acc])).rows.map((r) => r.content);
    assert.deepEqual(questions, ["How much does my life policy pay?", "What do we have together?", "Do I get hospital cash?", "Is policy VS-2024-778812 still mine?", "Roughly what am I covered for?", "I want to claim", "Go on", "What is a waiting period?"]);
  });
  await t("the chat keeps only what the person typed (their own facts and question); what came from the document goes; the other chat keeps its own", async () => {
    const c1 = (await q<{ state: unknown; last_answer: unknown; revision: string }>(`SELECT state,last_answer,revision::text FROM chat_conversations WHERE id=$1`, [conv1])).rows[0];
    assert.deepEqual(c1.state, { subjects: { [ana]: { nights, bill } }, intent: "claim", activeClaimQuery: "I was in hospital for 3 nights" });
    assert.ok(!JSON.stringify(c1.state).includes("500") && !JSON.stringify(c1.state).includes(vida), "no figure or reference from the deleted document");
    assert.equal(c1.last_answer, null); assert.equal(c1.revision, "1", "a stale save of the old state is refused");
    const c2 = (await q<{ state: unknown; last_answer: unknown }>(`SELECT state,last_answer FROM chat_conversations WHERE id=$1`, [conv2])).rows[0];
    assert.match(text(c2.state), new RegExp(kranken)); assert.match(text(c2.last_answer), /Krankenhaustagegeld/);
  });
  await t("finished background answers and cached analyses lose what they took from it; a job still waiting is left to finish", async () => {
    const jobs = (await q<{ status: string; result_json: unknown; request_json: unknown }>(`SELECT status,result_json,request_json FROM chat_analysis_jobs WHERE account_id=$1 ORDER BY status, family_member_id=$2 DESC`, [acc, ana])).rows;
    const done = jobs.filter((j) => j.status === "completed");
    assert.equal(done.find((j) => text(j.request_json).includes("life"))?.result_json ?? null, null);
    assert.equal(done.filter((j) => j.result_json == null).length, 1, "only the job about the deleted document is cleared");
    assert.match(text(jobs.find((j) => j.status === "queued")?.result_json), /retrieved/, "a waiting job is left alone this pass");
    const keys = (await q<{ cache_key: string }>(`SELECT cache_key FROM policy_analysis_cache WHERE account_id=$1`, [acc])).rows.map((r) => r.cache_key);
    assert.deepEqual(keys, ["catalog-progress:benefits:" + kranken]);
  });
  await t("its coverage-ledger rows are deleted; the kept document's row stays", async () => {
    const rows = (await q<{ policy_id: string; quote: string }>(`SELECT policy_id::text,quote FROM coverage_rules WHERE account_id=$1`, [acc])).rows;
    assert.deepEqual(rows.map((r) => r.policy_id), [kranken]);
  });
  await t("one content-free audit entry records it (a status key only), and a second pass does nothing", async () => {
    const audit = (await q<{ actor: string; occurred_at: unknown; previous_value: unknown; new_value: unknown; reason: string | null; reason_code: string }>(`SELECT actor,occurred_at,previous_value,new_value,reason,reason_code FROM policy_document_audit_log WHERE policy_id=$1 AND action=$2`, [vida, DERIVED_SCRUB_ACTION])).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].actor, "system"); assert.ok(audit[0].occurred_at);
    assert.equal(audit[0].reason, null); assert.equal(audit[0].previous_value, null); assert.equal(audit[0].reason_code, "DERIVED_CONTENT_SCRUBBED");
    assert.deepEqual(audit[0].new_value, { status: DERIVED_SCRUB_ACTION });
    // The deletion's own audit entries are kept as they were.
    const actions = (await q<{ action: string }>(`SELECT action FROM policy_document_audit_log WHERE policy_id=$1 ORDER BY id`, [vida])).rows.map((r) => r.action);
    assert.ok(actions.includes("deleted"), actions.join(","));
    const again = await scrubDeletedDocumentDerivedContent();
    assert.equal(again.documents, 0);
  });
  await t("the pass reports what it removed (counts are returned, never stored)", async () => {
    const acc3 = await household("Haddad household (fictitious)");
    const layla = await member(acc3, "Layla Haddad", "self");
    const d = await doc(acc3, layla, { file: "Najm-Health.pdf", insurer: "Najm Insurance (fictitious)", product: "Najm Gold", policyNo: "NG-4410-2271" });
    await ledgerRow(acc3, layla, d, "Najm Gold", 250000, "AED", "Annual limit AED 250,000");
    const c = await conversation(acc3, layla, { subjects: { x: { policyId: d } } }, null);
    await turn(acc3, layla, c, "Limit?", { content: "AED 250,000 a year.", citations: [{ policyId: d }], answer: answerOf("AED 250,000 a year.", d, "Najm Gold", "Annual limit AED 250,000", 250000, "AED", "Layla Haddad") });
    await q(`INSERT INTO policy_analysis_cache(account_id,cache_key,analysis_json) VALUES ($1,$2,'{}')`, [acc3, "c".repeat(64)]);
    await q(`UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1`, [d]);
    const r = await scrubDeletedDocumentDerivedContent({ policyIds: [d] });
    assert.deepEqual(r, { documents: 1, answersRedacted: 1, chatsReset: 1, jobsCleared: 0, cacheDropped: 1, ledgerRowsRemoved: 1, failed: 0 });
  });
  await t("another household's chat and cache are never touched", async () => {
    const o = await msg(otherAnswer);
    assert.equal(o.content, "GH₵ 200,000 life cover.");
    assert.equal((await q(`SELECT 1 FROM policy_analysis_cache WHERE account_id=$1`, [other])).rows.length, 1);
  });
  await t("a document deleted before this existed is caught up by the next pass; a failure is retried", async () => {
    const acc2 = await household("Kowalski household (fictitious)");
    const ewa = await member(acc2, "Ewa Kowalska", "self");
    const zycie = await doc(acc2, ewa, { file: "Zycie-Plus.pdf", insurer: "Wisła Ubezpieczenia (fictitious)", product: "Życie Plus", policyNo: "ZP-30-771203" });
    const renewal = await doc(acc2, ewa, { file: "Zycie-Plus-2026.pdf", insurer: "Wisła Ubezpieczenia (fictitious)", product: "Życie Plus", policyNo: "ZP-30-771203" });
    await ledgerRow(acc2, ewa, zycie, "Życie Plus", 300000, "PLN", "Suma ubezpieczenia: 300 000 zł");
    const byId = await turn(acc2, ewa, null, "Ile?", { content: "300 000 zł.", citations: [{ policyId: zycie }], answer: null });
    // An answer that cites only the renewal (still on file) is kept, even though it shares the policy number.
    const byNumber = await turn(acc2, ewa, null, "Numer?", { content: "Polisa ZP-30-771203 jest aktywna.", citations: [{ policyId: renewal }], answer: null });
    await q(`UPDATE policies SET lifecycle_state='pending_deletion' WHERE id=$1`, [zycie]);
    let calls = 0;
    const flaky = <T>(fn: (d: never) => Promise<T>) => { calls++; if (calls === 1) return Promise.reject(new Error("connection lost")); return fn({ query: run } as never); };
    const first = await scrubDeletedDocumentDerivedContent({ transaction: flaky as never });
    assert.equal(first.failed, 1); assert.equal((await msg(byId)).content, "300 000 zł.", "nothing half-done");
    const second = await scrubDeletedDocumentDerivedContent({ transaction: flaky as never });
    assert.equal(second.documents, 1);
    assert.equal((await msg(byId)).content, STALE_ANSWER_NOTICE);
    assert.equal((await msg(byNumber)).content, "Polisa ZP-30-771203 jest aktywna.");
    assert.equal((await q(`SELECT 1 FROM coverage_rules WHERE policy_id=$1`, [zycie])).rows.length, 0);
  });
  await t("kept text that names the deleted document in words (product, plan or policy number, whole words only) goes too", async () => {
    const acc4 = await household("Santoso household (fictitious)");
    const budi = await member(acc4, "Budi Santoso", "self");
    const gone = await doc(acc4, budi, { file: "Sehat-Prima.pdf", insurer: "Nusantara Insurance (fictitious)", product: "Sehat Prima", policyNo: "SP-77120931" });
    const keep = await doc(acc4, budi, { file: "Jiwa-Abadi.pdf", insurer: "Nusantara Insurance (fictitious)", product: "Jiwa Abadi", policyNo: "JA-55102288" });
    await q(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name) VALUES ($1,$2,$3,'hospital',75000000,'IDR','Rawat Inap Platinum'),($1,$4,$3,'life',1000000000,'IDR','Jiwa Abadi')`, [acc4, gone, budi, keep]);
    const ff = (summary: string) => ({ content: summary, citations: [], answer: { mode: "fact_finding", summary, citations: [], questions: [{ text: summary }], claimItems: [] } });
    const byProduct = await turn(acc4, budi, null, "I want to claim", ff("Is this claim under your sehat  prima policy?"));
    const byPlan = await turn(acc4, budi, null, "Claim", ff("Were you admitted as an in-patient under Rawat Inap Platinum?"));
    const byNumber = await turn(acc4, budi, null, "Claim", ff("Is the policy number on your card SP-77120931?"));
    const partial = await turn(acc4, budi, null, "Claim", ff("Did you first see a Sehat Primary care doctor?"));
    const plain = await turn(acc4, budi, null, "Claim", ff("Which hospital were you admitted to?"));
    const longerRef = await turn(acc4, budi, null, "Claim", ff("Did you register at the KlinikSehat Prima desk?"));
    // An answer about the kept document that also names the deleted one in words.
    const mixed = await turn(acc4, budi, null, "Life?", { content: "Jiwa Abadi pays on death; Sehat Prima was your hospital plan.", citations: [{ policyId: keep }], answer: null });
    const keptOnly = await turn(acc4, budi, null, "Life?", { content: "Jiwa Abadi pays on death.", citations: [{ policyId: keep }], answer: null });
    const typed = (value: string) => ({ value, state: "known", quote: value, recordedAt: "2026-10-01T00:00:00Z", source: "user" });
    const conv = await conversation(acc4, budi, { intent: "claim", activeClaimQuery: "claim on SP-77120931 for my stay", subjects: { [budi]: { card: typed("my Sehat Prima card"), ward: typed("I was in ward 3"), plan: typed("Rawat Inap Platinum") } }, facts: [{ policyId: keep }] }, null);
    await q(`UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1`, [gone]);
    await scrubDeletedDocumentDerivedContent({ policyIds: [gone] });
    for (const id of [byProduct, byPlan, byNumber, mixed]) assert.equal((await msg(id)).content, STALE_ANSWER_NOTICE, id);
    assert.equal((await msg(partial)).content, "Did you first see a Sehat Primary care doctor?", "a name inside a longer word is not a match");
    assert.equal((await msg(plain)).content, "Which hospital were you admitted to?");
    assert.equal((await msg(longerRef)).content, "Did you register at the KlinikSehat Prima desk?", "a name at the end of a longer word is not a match");
    assert.equal((await msg(keptOnly)).content, "Jiwa Abadi pays on death.");
    const c = (await q<{ state: unknown }>(`SELECT state FROM chat_conversations WHERE id=$1`, [conv])).rows[0];
    assert.deepEqual(c.state, { intent: "claim", subjects: { [budi]: { ward: typed("I was in ward 3") } } });
  });
  await t("a document still on file is never handled", async () => {
    assert.equal((await q(`SELECT 1 FROM policy_document_audit_log WHERE policy_id=ANY($1::uuid[]) AND action=$2`, [[kranken, otherDoc], DERIVED_SCRUB_ACTION])).rows.length, 0);
    assert.equal((await scrubDeletedDocumentDerivedContent({ policyIds: [kranken] })).documents, 0);
  });

  console.log(`\nderived content scrub: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * PGlite harness for the adversarial suite. Real schema (sql/*.sql), both synthetic households, the pool patched onto
 * PGlite, every network call refused. send() posts to the REAL chat route (app/api/chat/route.ts) with the dev
 * household identity of the household chosen per call (DEV_ACCOUNT_ID is switched per request), so each turn goes
 * through lib/chat/workflow.ts's flagged hook, the loop, saveTurn's output guard and the save-time figure gate, and
 * what the household SEES is read back from the persisted chat_messages / chat_conversations rows.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChatAnswer } from "@/types";
import { ACCOUNT_N, ACCOUNT_T, DOCS, MEMBERS } from "./household";

export const SQL = ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "v11-ingestion-evidence.sql"];

export function setAdvEnv() {
  process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
  process.env.DEV_AUTH_ENABLED = "1";
  process.env.DEV_ACCOUNT_ID = ACCOUNT_T;
  process.env.E2E_RUN_ID = "rag2adv";
  process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
  process.env.DEARPOLICY_RAG_LOOP = "1";
  delete process.env.PINECONE_API_KEY;
  delete process.env.DEARPOLICY_RAG_TOOLS;
}

export type Saved = { summary: string; answer: ChatAnswer; state: any; messages: { role: string; content: string }[] };
export type AdvHarness = {
  db: any; networkCalls: string[];
  send: (account: string, question: string, conv?: { id?: string; rev?: number }, member?: string | null) => Promise<ChatAnswer>;
  saved: (account: string, conversationId: string) => Promise<Saved>;
};

export async function startAdvHarness(): Promise<AdvHarness> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL) await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;").catch(() => undefined);
  const { pool } = await import("@/lib/db/client");
  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) { const rs = await db.exec(text); const r = rs.at(-1); return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as unknown as typeof pool.connect;
  const networkCalls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => { networkCalls.push(String(input)); throw new Error("network disabled in the rag2 adversarial suite"); }) as typeof fetch;

  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household Tan (synthetic)'),($2,'Household Nair (synthetic)')", [ACCOUNT_T, ACCOUNT_N]);
  for (const a of [ACCOUNT_T, ACCOUNT_N]) await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [a]).catch(() => undefined);
  for (const p of MEMBERS) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, p.account, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of DOCS) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,'ready',$9,$9,'scan_clean','active',$10,$11,$12,$13)`,
      [d.id, d.account, d.owner, d.insurer, d.product, d.policyNumber, d.policyType, d.role, d.key.toLowerCase() + ".pdf", d.superseded ? new Date().toISOString() : null, d.hash, d.effective, d.expiry]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, d.account, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [d.account, d.id, Number(page), text]);
  }

  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/chat/route");
  const send = async (account: string, question: string, conv?: { id?: string; rev?: number }, member: string | null = null) => {
    process.env.DEV_ACCOUNT_ID = account;
    const response = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: member, scope: member ? "member" : "family", question, conversationId: conv?.id, conversationRevision: conv?.rev, asynchronous: false, timeZone: "Asia/Singapore" }) }));
    const data = await response.json();
    if (response.status !== 200) throw new Error("chat returned " + response.status + " " + JSON.stringify(data).slice(0, 400));
    return data.answer as ChatAnswer;
  };
  const saved = async (account: string, conversationId: string): Promise<Saved> => {
    const m = (await db.query("SELECT content, answer_json FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 AND role='assistant' ORDER BY created_at DESC, message_order DESC LIMIT 1", [account, conversationId])).rows[0] as { content: string; answer_json: ChatAnswer };
    const all = (await db.query("SELECT role, content FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 ORDER BY created_at, message_order", [account, conversationId])).rows as { role: string; content: string }[];
    const c = (await db.query("SELECT state FROM chat_conversations WHERE id=$1 AND account_id=$2", [conversationId, account])).rows[0] as { state: any };
    return { summary: m?.content ?? "", answer: m?.answer_json, state: c?.state, messages: all };
  };
  return { db, networkCalls, send, saved };
}

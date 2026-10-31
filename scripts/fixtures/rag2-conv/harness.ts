/**
 * PGlite harness for npm run rag2:conv-test: the real schema, the two synthetic households (households.ts), every
 * network call refused unless a test installs a fake fetch on a model, and send() posting to the REAL chat route as
 * the household chosen (DEV_ACCOUNT_ID is switched per household; development auth only, never in production).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChatAnswer } from "@/types";
import { SQL } from "../rag2-loop/harness";
import { CONV_DOCS, CONV_MEMBERS, RAHMAN, TAN } from "./households";

export function setConvEnv() {
  process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
  process.env.DEV_AUTH_ENABLED = "1";
  process.env.DEV_ACCOUNT_ID = TAN;
  process.env.E2E_RUN_ID = "rag2conv";
  process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
  delete process.env.PINECONE_API_KEY;
  delete process.env.DEARPOLICY_RAG_TOOLS;
  process.env.DEARPOLICY_RAG_LOOP = "1";
}

export type ConvHarness = {
  db: any; networkCalls: string[];
  send: (account: string, question: string, conv?: { id?: string; rev?: number }) => Promise<ChatAnswer>;
  /** The chat route's raw reply (any status), for checks of a refusal the route gives before an answer. */
  post: (account: string, question: string) => Promise<{ status: number; data: any }>;
  saved: (account: string, conversationId: string) => Promise<{ answer: ChatAnswer; state: any }>;
};

export async function startConvHarness(): Promise<ConvHarness> {
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
  const networkCalls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => { networkCalls.push(String(input)); throw new Error("network disabled in rag2:conv-test"); }) as typeof fetch;

  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Tan household'),($2,'Rahman household')", [TAN, RAHMAN]);
  for (const a of [TAN, RAHMAN]) await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [a]).catch(() => undefined);
  for (const p of CONV_MEMBERS) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, p.account, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of CONV_DOCS) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date,document_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ready',$11,$11,'scan_clean','active',NULL,$12,$13,$14,NULL)`,
      [d.id, d.account, d.owner, d.insurer, d.product, d.policyNumber, null, d.policyType, d.role, d.personal, d.key.toLowerCase() + ".pdf", d.hash, d.effective ?? null, d.expiry ?? null]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, d.account, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [d.account, d.id, Number(page), text]);
  }

  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/chat/route");
  const send = async (account: string, question: string, conv?: { id?: string; rev?: number }) => {
    process.env.DEV_ACCOUNT_ID = account;
    const response = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: null, scope: "family", question, conversationId: conv?.id, conversationRevision: conv?.rev, asynchronous: false, timeZone: "Asia/Singapore" }) }));
    const data = await response.json();
    if (response.status !== 200) throw new Error("chat returned " + response.status + " " + JSON.stringify(data).slice(0, 400));
    return data.answer as ChatAnswer;
  };
  const post = async (account: string, question: string) => {
    process.env.DEV_ACCOUNT_ID = account;
    const response = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: null, scope: "family", question, asynchronous: false, timeZone: "Asia/Singapore" }) }));
    return { status: response.status, data: await response.json() };
  };
  const saved = async (account: string, conversationId: string) => {
    const m = (await db.query("SELECT answer_json FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 AND role='assistant' ORDER BY created_at DESC, message_order DESC LIMIT 1", [account, conversationId])).rows[0] as { answer_json: ChatAnswer };
    const c = (await db.query("SELECT state FROM chat_conversations WHERE id=$1", [conversationId])).rows[0] as { state: any };
    return { answer: m.answer_json, state: c.state };
  };
  return { db, networkCalls, send, post, saved };
}

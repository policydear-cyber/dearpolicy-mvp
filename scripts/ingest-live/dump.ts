/**
 * READ-ONLY dump of what the app stored for the live ingestion test's synthetic account (one READ ONLY transaction;
 * local database only): extracted page text per document, documents, person links and detected names, benefit /
 * coverage / condition rows, background jobs (states, attempts, timings), provenance (model_executions: operation,
 * requested and resolved provider/model, provider request id, attempt index, tokens, cost), usage, chat messages.
 * Tables are discovered (to_regclass + information_schema), so a renamed table is reported missing, never guessed.
 */
import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";

const BY_ACCOUNT = ["policies", "policy_pages", "policy_members", "policy_detected_people", "policy_coverages", "policy_reference_coverages", "policy_benefits", "policy_benefit_catalog", "benefit_catalog", "policy_conditions", "policy_condition_catalog", "premium_records", "family_members", "chat_conversations", "chat_messages", "model_usage", "ledger_entries", "benefit_ledger", "policy_ledger"];
const DROP = new Set(["reading_cache", "embedding", "storage_key", "file_hash", "pdf_password"]);

export async function dumpAccount(pool: Pool, householdId: string, outDir: string) {
  const client = await pool.connect();
  const out: Record<string, unknown> = { householdId, at: new Date().toISOString(), missingTables: [] as string[], tables: {} as Record<string, unknown[]> };
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const cols = async (t: string) => (await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [t])).rows.map((r) => r.column_name);
    for (const t of BY_ACCOUNT) {
      const c = await cols(t);
      if (!c.length) { (out.missingTables as string[]).push(t); continue; }
      if (!c.includes("account_id")) continue;
      const keep = c.filter((x) => !DROP.has(x));
      const order = c.includes("created_at") ? " ORDER BY created_at" : c.includes("page_number") ? " ORDER BY policy_id, page_number" : "";
      (out.tables as Record<string, unknown[]>)[t] = (await client.query(`SELECT ${keep.map((k) => `"${k}"`).join(",")} FROM ${t} WHERE account_id=$1${order} LIMIT 5000`, [householdId])).rows;
    }
    const chunks = await cols("policy_chunks");
    if (chunks.length) (out.tables as Record<string, unknown[]>).policy_chunks_count = (await client.query("SELECT policy_id, count(*)::int AS chunks FROM policy_chunks WHERE account_id=$1 GROUP BY policy_id", [householdId])).rows;
    const policyIds = ((out.tables as Record<string, { id: string }[]>).policies ?? []).map((p) => p.id);
    if ((await cols("background_jobs")).length)
      (out.tables as Record<string, unknown[]>).background_jobs = (await client.query("SELECT * FROM background_jobs WHERE idempotency_key = ANY($1::text[]) OR payload::text LIKE $2 ORDER BY created_at", [policyIds, `%${householdId}%`])).rows
        .map((r: Record<string, unknown>) => { const { payload, ...rest } = r; return { ...rest, payloadKeys: payload && typeof payload === "object" ? Object.keys(payload as object) : null }; });
    if ((await cols("model_executions")).length)
      (out.tables as Record<string, unknown[]>).model_executions = (await client.query("SELECT * FROM model_executions WHERE household_ref=$1 OR resource_ref = ANY($2::text[]) ORDER BY requested_at, attempt_index", [pseudonymizeId(householdId), policyIds.map((id) => pseudonymizeId(id))])).rows;
    await client.query("ROLLBACK");
  } finally { client.release(); }
  // Extracted page text per document, as plain files.
  const pages = ((out.tables as Record<string, { policy_id: string; page_number: number; text: string; extraction_method?: string }[]>).policy_pages ?? []);
  const files = new Map(((out.tables as Record<string, { id: string; original_filename: string }[]>).policies ?? []).map((p) => [p.id, p.original_filename]));
  fs.mkdirSync(path.join(outDir, "extracted"), { recursive: true });
  for (const [id, name] of files) {
    const mine = pages.filter((p) => p.policy_id === id);
    fs.writeFileSync(path.join(outDir, "extracted", `${name}.txt`), mine.map((p) => `===== page ${p.page_number} (${p.extraction_method ?? "native"}) =====\n${p.text}`).join("\n\n") + "\n");
  }
  fs.writeFileSync(path.join(outDir, "dump.json"), JSON.stringify(out, null, 2));
  return out;
}

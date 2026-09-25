import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@/lib/db/client";

/** Lazily applies sql/claim-evidence.sql, exactly the pattern used by
 * lib/chat/store.ts (ensureChatSchema) and lib/ledger/store.ts
 * (ensureLedgerSchema): idempotent (CREATE ... IF NOT EXISTS throughout),
 * serialised across concurrent requests/processes with an advisory lock so
 * two warm instances racing to migrate at once cannot conflict, and
 * memoised on globalThis so it only actually runs once per warm process. */
type ClaimEvidenceGlobals = typeof globalThis & { __dearpolicyClaimEvidenceSchema?: Promise<void> };

export async function ensureClaimEvidenceSchema() {
  const state = globalThis as ClaimEvidenceGlobals;
  state.__dearpolicyClaimEvidenceSchema ??= (async () => {
    const sql = await readFile(path.join(process.cwd(), "sql/claim-evidence.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // A lock number distinct from every other lazy migration in this
      // codebase (chat: 73499201, benefit-catalog: 73499202, ledger and
      // cover-conditions: 73499203).
      await client.query("SELECT pg_advisory_xact_lock(73499204)");
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    delete state.__dearpolicyClaimEvidenceSchema;
    throw error;
  });
  await state.__dearpolicyClaimEvidenceSchema;
}

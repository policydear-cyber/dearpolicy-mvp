import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@/lib/db/client";
import { ensureClaimEvidenceSchema } from "./schema";

/** Lazily applies sql/critical-illness.sql, exactly the pattern used by
 * ./schema.ts's ensureClaimEvidenceSchema(): idempotent, serialised with an
 * advisory lock distinct from every other lazy migration in this codebase
 * (chat: 73499201, benefit-catalog: 73499202, ledger/cover-conditions:
 * 73499203, claim-evidence: 73499204, claim-composition: 73499205),
 * memoised per warm process. Always calls ensureClaimEvidenceSchema() first
 * -- sql/critical-illness.sql's ALTER TABLE on claim_evidence_documents
 * requires that table to already exist. */
type CriticalIllnessGlobals = typeof globalThis & { __dearpolicyCriticalIllnessSchema?: Promise<void> };

export async function ensureCriticalIllnessSchema() {
  await ensureClaimEvidenceSchema();
  const state = globalThis as CriticalIllnessGlobals;
  state.__dearpolicyCriticalIllnessSchema ??= (async () => {
    const sql = await readFile(path.join(process.cwd(), "sql/critical-illness.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(73499206)");
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    delete state.__dearpolicyCriticalIllnessSchema;
    throw error;
  });
  await state.__dearpolicyCriticalIllnessSchema;
}

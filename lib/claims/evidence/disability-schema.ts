import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@/lib/db/client";
import { ensureClaimEvidenceSchema } from "./schema";

/** Lazily applies sql/disability.sql, exactly the pattern used by
 * ./ci-schema.ts's ensureCriticalIllnessSchema(): idempotent, serialised
 * with an advisory lock distinct from every other lazy migration in this
 * codebase (chat: 73499201, benefit-catalog: 73499202, ledger/cover-
 * conditions: 73499203, claim-evidence: 73499204, claim-composition:
 * 73499205, critical-illness: 73499206), memoised per warm process.
 * Always calls ensureClaimEvidenceSchema() first -- sql/disability.sql's
 * new table references claim_evidence_documents, which must already
 * exist. Deliberately does NOT depend on ensureCriticalIllnessSchema():
 * sql/disability.sql does not touch the document_type CHECK constraint
 * (see that file's own comment), so there is no ordering requirement
 * against sql/critical-illness.sql. */
type DisabilityGlobals = typeof globalThis & { __dearpolicyDisabilitySchema?: Promise<void> };

export async function ensureDisabilitySchema() {
  await ensureClaimEvidenceSchema();
  const state = globalThis as DisabilityGlobals;
  state.__dearpolicyDisabilitySchema ??= (async () => {
    const sql = await readFile(path.join(process.cwd(), "sql/disability.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(73499207)");
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    delete state.__dearpolicyDisabilitySchema;
    throw error;
  });
  await state.__dearpolicyDisabilitySchema;
}

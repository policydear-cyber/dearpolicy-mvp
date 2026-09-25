import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@/lib/db/client";
import { ensureClaimEvidenceSchema } from "@/lib/claims/evidence/schema";

/** Lazily applies sql/claim-reviewers.sql, exactly the pattern used by
 * lib/claims/evidence/schema.ts: idempotent, serialised with an advisory
 * lock distinct from every other lazy migration in this codebase (chat:
 * 73499201, benefit-catalog: 73499202, ledger/cover-conditions: 73499203,
 * claim-evidence: 73499204, claim-composition: 73499205, critical-illness:
 * 73499206, disability: 73499207), memoised per warm process. Calls
 * ensureClaimEvidenceSchema() first -- claim_review_assignments references
 * claim_evidence_documents. */
type ClaimReviewerGlobals = typeof globalThis & { __dearpolicyClaimReviewerSchema?: Promise<void> };

export async function ensureClaimReviewerSchema() {
  await ensureClaimEvidenceSchema();
  const state = globalThis as ClaimReviewerGlobals;
  state.__dearpolicyClaimReviewerSchema ??= (async () => {
    const sql = await readFile(path.join(process.cwd(), "sql/claim-reviewers.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(73499208)");
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    delete state.__dearpolicyClaimReviewerSchema;
    throw error;
  });
  await state.__dearpolicyClaimReviewerSchema;
}

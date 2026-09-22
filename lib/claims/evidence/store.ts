import { pool, query } from "@/lib/db/client";
import { ensureClaimEvidenceSchema } from "./schema";
import { assertValidEvidenceTransition } from "./state-machine";
import type {
  ClaimCauseDefinitionMatchRow, ClaimEvidenceDocumentRow, ClaimEvidenceDocumentType,
  ClaimEvidenceExtractedFields, ClaimEvidenceExtractionRow, ClaimEvidenceIdentityConflict,
  ClaimEvidenceIdentityStatus, ClaimEvidenceStatus, CauseDefinitionMatchResultValue,
} from "./types";

const DOCUMENT_COLUMNS = `id::text,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,
  file_hash,status,scan_status,identity_status,processing_error,processing_error_code,processing_attempts,supersedes_id,
  superseded_at::text,created_at::text,updated_at::text`;

/** Every account-scoped read/write below filters on account_id explicitly,
 * on top of whatever narrower id (family member, claim session, document)
 * the caller also supplies -- so a malformed or forged id from another
 * account can never read or touch this account's rows, and a row that DOES
 * belong to this account but to the wrong family member/claim/contract is
 * still excluded by the narrower filter. Never trust a single id alone. */

export async function createEvidenceDocument(args: {
  accountId: string; familyMemberId: string; claimSessionId: string; documentType: ClaimEvidenceDocumentType;
  originalFilename: string; storageKey: string; mimeType: string; byteSize: number; fileHash: string;
}): Promise<{ document: ClaimEvidenceDocumentRow; created: boolean }> {
  await ensureClaimEvidenceSchema();
  const inserted = await query<ClaimEvidenceDocumentRow>(
    `INSERT INTO claim_evidence_documents(account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (account_id,claim_session_id,file_hash) WHERE superseded_at IS NULL DO NOTHING
     RETURNING ${DOCUMENT_COLUMNS}`,
    [args.accountId, args.familyMemberId, args.claimSessionId, args.documentType, args.originalFilename, args.storageKey, args.mimeType, args.byteSize, args.fileHash],
  );
  if (inserted.rows[0]) return { document: inserted.rows[0], created: true };
  // Exact-duplicate upload for this same claim -- idempotent: hand back the
  // document that is already there instead of erroring or forking a row.
  const existing = await query<ClaimEvidenceDocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM claim_evidence_documents WHERE account_id=$1 AND claim_session_id=$2 AND file_hash=$3 AND superseded_at IS NULL`,
    [args.accountId, args.claimSessionId, args.fileHash],
  );
  if (!existing.rows[0]) throw new Error("Duplicate claim-evidence upload conflict could not be resolved.");
  return { document: existing.rows[0], created: false };
}

export async function getEvidenceDocument(accountId: string, id: string): Promise<ClaimEvidenceDocumentRow | null> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceDocumentRow>(`SELECT ${DOCUMENT_COLUMNS} FROM claim_evidence_documents WHERE id=$1 AND account_id=$2`, [id, accountId]);
  return result.rows[0] ?? null;
}

/** Used by every API route that acts on a specific document on behalf of a
 * specific family member/claim -- proves the FULL ownership chain, not just
 * that the document id belongs to this account. */
export async function getScopedEvidenceDocument(args: { accountId: string; familyMemberId: string; claimSessionId: string; id: string }): Promise<ClaimEvidenceDocumentRow | null> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceDocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM claim_evidence_documents WHERE id=$1 AND account_id=$2 AND family_member_id=$3 AND claim_session_id=$4`,
    [args.id, args.accountId, args.familyMemberId, args.claimSessionId],
  );
  return result.rows[0] ?? null;
}

export async function listEvidenceDocuments(accountId: string, claimSessionId: string): Promise<ClaimEvidenceDocumentRow[]> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceDocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM claim_evidence_documents WHERE account_id=$1 AND claim_session_id=$2 ORDER BY created_at DESC`,
    [accountId, claimSessionId],
  );
  return result.rows;
}

/** Documents sharing this account and content hash but belonging to a
 * DIFFERENT claim or family member -- i.e. the same file either reused
 * across claims (deliberately or by accident) or uploaded under the wrong
 * person. Never looks outside this account. */
export async function findReusedEvidenceAcrossScopes(args: { accountId: string; familyMemberId: string; claimSessionId: string; fileHash: string }): Promise<ClaimEvidenceDocumentRow[]> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceDocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM claim_evidence_documents
      WHERE account_id=$1 AND file_hash=$2 AND superseded_at IS NULL AND NOT (family_member_id=$3 AND claim_session_id=$4)`,
    [args.accountId, args.fileHash, args.familyMemberId, args.claimSessionId],
  );
  return result.rows;
}

/** Concurrency-safe, idempotent status transition: the WHERE clause only
 * matches a row that is STILL in `from`, so a retried or duplicated job
 * that arrives after another worker already advanced the row is a safe
 * no-op (returns null) rather than a lost update, a double-transition, or
 * an error. Validated against the state machine before it ever reaches the
 * database. */
export async function transitionEvidenceStatus(args: {
  accountId: string; id: string; from: ClaimEvidenceStatus; to: ClaimEvidenceStatus;
  errorMessage?: string | null; errorCode?: string | null; identityStatus?: ClaimEvidenceIdentityStatus;
}): Promise<ClaimEvidenceDocumentRow | null> {
  assertValidEvidenceTransition(args.from, args.to);
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceDocumentRow>(
    `UPDATE claim_evidence_documents
        SET status=$1, processing_error=$2, processing_error_code=$3,
            identity_status=COALESCE($4,identity_status), updated_at=now()
      WHERE id=$5 AND account_id=$6 AND status=$7
      RETURNING ${DOCUMENT_COLUMNS}`,
    [args.to, args.errorMessage ?? null, args.errorCode ?? null, args.identityStatus ?? null, args.id, args.accountId, args.from],
  );
  return result.rows[0] ?? null;
}

export async function incrementProcessingAttempts(accountId: string, id: string): Promise<number> {
  await ensureClaimEvidenceSchema();
  const result = await query<{ processing_attempts: number }>(
    `UPDATE claim_evidence_documents SET processing_attempts=processing_attempts+1, updated_at=now() WHERE id=$1 AND account_id=$2 RETURNING processing_attempts`,
    [id, accountId],
  );
  return result.rows[0]?.processing_attempts ?? 0;
}

/** A corrected re-upload for the same claim/document-type slot: the OLD
 * document row is marked superseded (kept, never deleted -- the audit log
 * and anything reviewed against it stay valid history) and any cause
 * match built from it is superseded too, so it can never keep unlocking an
 * amount once the evidence behind it has been replaced. */
export async function supersedeEvidenceDocument(args: { accountId: string; oldId: string; newId: string; reason: string }): Promise<void> {
  await ensureClaimEvidenceSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE claim_evidence_documents SET supersedes_id=$1, updated_at=now() WHERE id=$2 AND account_id=$3`,
      [args.oldId, args.newId, args.accountId],
    );
    await client.query(
      `UPDATE claim_evidence_documents SET superseded_at=now(), updated_at=now() WHERE id=$1 AND account_id=$2`,
      [args.oldId, args.accountId],
    );
    await client.query(
      `UPDATE claim_cause_definition_matches SET superseded_at=now(), superseded_reason=$1
        WHERE account_id=$2 AND evidence_document_id=$3 AND superseded_at IS NULL`,
      [args.reason, args.accountId, args.oldId],
    );
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

// --- Extractions ------------------------------------------------------

const EXTRACTION_COLUMNS = `id::text,account_id,evidence_document_id,source_document_version,extracted_fields,reviewed_fields,
  reviewed_at::text,reviewed_by,extraction_model,extraction_provider,extraction_version,processing_timestamp::text,
  identity_conflicts,created_at::text,updated_at::text`;

/** Idempotent: retrying extraction for the same document VERSION (same
 * evidence_document_id + source_document_version, i.e. the document's
 * content hash at extraction time) upserts this same row rather than
 * creating a duplicate, so a retried background job can never fork the
 * extraction record or double-count it. */
export async function recordExtraction(args: {
  accountId: string; evidenceDocumentId: string; sourceDocumentVersion: string; extractedFields: ClaimEvidenceExtractedFields;
  extractionModel: string; extractionProvider: string; extractionVersion: string; identityConflicts: ClaimEvidenceIdentityConflict[];
}): Promise<ClaimEvidenceExtractionRow> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceExtractionRow>(
    `INSERT INTO claim_evidence_extractions(account_id,evidence_document_id,source_document_version,extracted_fields,extraction_model,extraction_provider,extraction_version,identity_conflicts)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb)
     ON CONFLICT (evidence_document_id,source_document_version) DO UPDATE
       SET extracted_fields=EXCLUDED.extracted_fields, extraction_model=EXCLUDED.extraction_model,
           extraction_provider=EXCLUDED.extraction_provider, extraction_version=EXCLUDED.extraction_version,
           identity_conflicts=EXCLUDED.identity_conflicts, processing_timestamp=now(), updated_at=now()
     RETURNING ${EXTRACTION_COLUMNS}`,
    [args.accountId, args.evidenceDocumentId, args.sourceDocumentVersion, JSON.stringify(args.extractedFields), args.extractionModel, args.extractionProvider, args.extractionVersion, JSON.stringify(args.identityConflicts)],
  );
  return result.rows[0];
}

export async function getLatestExtraction(accountId: string, evidenceDocumentId: string): Promise<ClaimEvidenceExtractionRow | null> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceExtractionRow>(
    `SELECT ${EXTRACTION_COLUMNS} FROM claim_evidence_extractions WHERE account_id=$1 AND evidence_document_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [accountId, evidenceDocumentId],
  );
  return result.rows[0] ?? null;
}

/** A reviewer's correction to (or rejection of) specific extracted fields.
 * `reviewedFields` REPLACES only the fields the reviewer actually touched
 * -- see lib/claims/evidence/pipeline.ts's `reviewedValue()` helper, which
 * is what everything downstream (identity checks, match evidence) reads
 * from, in preference to the raw model output, once this is set. */
export async function correctExtraction(args: { accountId: string; extractionId: string; reviewedFields: Partial<ClaimEvidenceExtractedFields>; reviewedBy: string }): Promise<ClaimEvidenceExtractionRow | null> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceExtractionRow>(
    `UPDATE claim_evidence_extractions SET reviewed_fields=$1::jsonb, reviewed_at=now(), reviewed_by=$2, updated_at=now()
      WHERE id=$3 AND account_id=$4 RETURNING ${EXTRACTION_COLUMNS}`,
    [JSON.stringify(args.reviewedFields), args.reviewedBy, args.extractionId, args.accountId],
  );
  return result.rows[0] ?? null;
}

// --- Cause-definition matches ------------------------------------------

const MATCH_COLUMNS = `id::text,account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,
  cause_evidence,definition_evidence,result,reviewed_at::text,reviewed_by,reason,superseded_at::text,superseded_reason,created_at::text`;

/** Records a reviewer's (or a deterministic rule's) finalised decision.
 * Never called from chat text or model output -- see
 * lib/claims/evidence/matches.ts, the only caller. Any prior ACTIVE match
 * for the exact same (family member, claim, contract, coverage) scope is
 * superseded first, in the same transaction, so there is never more than
 * one active match per scope and the old one cannot keep being read
 * alongside the new one. */
export async function recordCauseDefinitionMatch(args: {
  accountId: string; familyMemberId: string; claimSessionId: string; contractId: string; coverageId: string | null;
  evidenceDocumentId: string; causeEvidence: unknown; definitionEvidence: unknown; result: CauseDefinitionMatchResultValue;
  reviewedBy: string; reason: string | null;
}): Promise<ClaimCauseDefinitionMatchRow> {
  await ensureClaimEvidenceSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE claim_cause_definition_matches SET superseded_at=now(), superseded_reason='Superseded by a newer review.'
        WHERE account_id=$1 AND family_member_id=$2 AND claim_session_id=$3 AND contract_id=$4 AND coverage_id IS NOT DISTINCT FROM $5 AND superseded_at IS NULL`,
      [args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId],
    );
    const inserted = await client.query<ClaimCauseDefinitionMatchRow>(
      `INSERT INTO claim_cause_definition_matches(account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,cause_evidence,definition_evidence,result,reviewed_by,reason)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)
       RETURNING ${MATCH_COLUMNS}`,
      [args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId, args.evidenceDocumentId, JSON.stringify(args.causeEvidence), JSON.stringify(args.definitionEvidence), args.result, args.reviewedBy, args.reason],
    );
    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Every currently-active (non-superseded) match for this family
 * member/claim, across every contract and coverage -- this is what
 * lib/claims/orchestrator.ts loads fresh on every chat turn and feeds into
 * `ClaimFacts.causeDefinitionMatches` in place of whatever might already be
 * sitting in the stored session JSON, so a stale or tampered blob can never
 * be what actually unlocks an amount. */
export async function loadActiveCauseDefinitionMatches(accountId: string, familyMemberId: string, claimSessionId: string): Promise<ClaimCauseDefinitionMatchRow[]> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimCauseDefinitionMatchRow>(
    `SELECT ${MATCH_COLUMNS} FROM claim_cause_definition_matches
      WHERE account_id=$1 AND family_member_id=$2 AND claim_session_id=$3 AND superseded_at IS NULL`,
    [accountId, familyMemberId, claimSessionId],
  );
  return result.rows;
}

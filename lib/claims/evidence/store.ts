import { pool, query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { ensureClaimEvidenceSchema } from "./schema";
import { ensureCriticalIllnessSchema } from "./ci-schema";
import { ensureDisabilitySchema } from "./disability-schema";
import { assertValidEvidenceTransition } from "./state-machine";
import type { EvidenceProvenance } from "@/lib/claims/evidence-authority";
import type { EvidenceDocumentProvenanceContext, StoredExtractionExecution } from "./extraction-provenance";
import type {
  ClaimCauseDefinitionMatchRow, ClaimCIDefinitionMatchRow, ClaimDisabilityDefinitionMatchRow, ClaimEvidenceDocumentRow, ClaimEvidenceDocumentType,
  ClaimEvidenceExtractedFields, ClaimEvidenceExtractionRow, ClaimEvidenceIdentityConflict,
  ClaimEvidenceIdentityStatus, ClaimEvidenceScanStatus, ClaimEvidenceStatus, CauseDefinitionMatchResultValue, CIDefinitionMatchResultValue, DisabilityDefinitionMatchResultValue,
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
  // Uses ensureCriticalIllnessSchema() rather than ensureClaimEvidenceSchema()
  // directly -- this is the one place that INSERTs a document_type value,
  // and the document_type CHECK constraint is only widened to accept the
  // medical-evidence set by sql/critical-illness.sql (see ci-schema.ts's
  // own comment). ensureCriticalIllnessSchema() applies both migrations in
  // order, so behaviour for a cause-of-death document is unchanged.
  await ensureCriticalIllnessSchema();
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
    `SELECT ${DOCUMENT_COLUMNS} FROM claim_evidence_documents WHERE account_id=$1 AND claim_session_id=$2 AND file_hash=$3 AND superseded_at IS NULL AND ${activePredicate()}`,
    [args.accountId, args.claimSessionId, args.fileHash],
  );
  if (!existing.rows[0]) throw new Error("Duplicate claim-evidence upload conflict could not be resolved.");
  return { document: existing.rows[0], created: false };
}

/** Wave 2 fix (D33/D34): now also excludes a superseded document
 * (`superseded_at IS NULL`), same as listEvidenceDocuments()/
 * getScopedEvidenceDocument() below. Previously this returned a
 * superseded row exactly like an active one, which let:
 *   - a retried/duplicated background job (lib/claims/evidence/pipeline.ts's
 *     processClaimEvidence()) keep "processing" a document whose evidence
 *     had already been replaced (pipeline.ts's own `if (!initial) return`
 *     no-op only ever fired for a truly deleted/foreign id, never for a
 *     superseded one);
 *   - a retried match-confirmation call (lib/claims/evidence/matches.ts,
 *     ci-matches.ts, disability-matches.ts, travel-matches.ts, and
 *     medical-bill-evidence.ts's confirmMedicalBillReview(), which all
 *     resolve the document through getScopedEvidenceDocument()) re-promote
 *     the OLD, superseded evidence into a brand new active match, silently
 *     undoing the supersession.
 * A superseded row is never actually deleted (see supersedeEvidenceDocument()
 * below) -- it still exists for audit/history purposes, just not through
 * this "the document a caller may currently act on" read path. */
export async function getEvidenceDocument(accountId: string, id: string): Promise<ClaimEvidenceDocumentRow | null> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceDocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM claim_evidence_documents WHERE id=$1 AND account_id=$2 AND superseded_at IS NULL AND ${activePredicate()}`,
    [id, accountId],
  );
  return result.rows[0] ?? null;
}

/** Used by every API route that acts on a specific document on behalf of a
 * specific family member/claim -- proves the FULL ownership chain, not just
 * that the document id belongs to this account.
 *
 * Wave 2 fix (D33/D34): now also excludes a superseded document
 * (`superseded_at IS NULL`) -- see getEvidenceDocument()'s doc comment
 * above for the full rationale. This is also what makes
 * app/api/claims/evidence/[id]/file/route.ts's signed-download route deny
 * access to superseded/deleted evidence IMMEDIATELY: that route resolves
 * the document through this function before ever calling
 * createClaimEvidenceSignedUrl(), so a superseded document now 404s here
 * before a new signed URL is ever minted for it (see that route's own
 * comment; the storage driver's own signed-URL TTL is a separate,
 * unavoidable exposure window documented in lib/storage/supabase.ts). */
export async function getScopedEvidenceDocument(args: { accountId: string; familyMemberId: string; claimSessionId: string; id: string }): Promise<ClaimEvidenceDocumentRow | null> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceDocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM claim_evidence_documents WHERE id=$1 AND account_id=$2 AND family_member_id=$3 AND claim_session_id=$4 AND superseded_at IS NULL AND ${activePredicate()}`,
    [args.id, args.accountId, args.familyMemberId, args.claimSessionId],
  );
  return result.rows[0] ?? null;
}

/** Wave 2 fix (D33/D34): now also excludes a superseded document
 * (`superseded_at IS NULL`). This is the single function
 * app/api/claims/evidence/route.ts (the document list the review UI
 * renders) and lib/claims/evidence/medical-bill-evidence.ts's
 * loadVerifiedMedicalBillFacts() (the ONLY function a medical calculator
 * may read a verified bill figure from) both build on -- medical-claim
 * bill evidence has no separate per-document match table to supersede
 * (see that module's own doc comment), so THIS filter is what actually
 * stops a superseded, still-`status='matched'` bill document from going
 * on contributing to a hospitalisation claim's verified figures forever.
 * See also getEvidenceDocument()'s doc comment for the pipeline/retry
 * rationale, which applies here identically via
 * lib/claims/evidence/pipeline.ts's reprocessNeedsAttention(). */
export async function listEvidenceDocuments(accountId: string, claimSessionId: string): Promise<ClaimEvidenceDocumentRow[]> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceDocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM claim_evidence_documents WHERE account_id=$1 AND claim_session_id=$2 AND superseded_at IS NULL AND ${activePredicate()} ORDER BY created_at DESC`,
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
      WHERE account_id=$1 AND file_hash=$2 AND superseded_at IS NULL AND ${activePredicate()} AND NOT (family_member_id=$3 AND claim_session_id=$4)`,
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
  /** Persists the real scan outcome from ./scan-adapter.ts's scanFile() to
   * the queryable scan_status column -- previously only ever recorded in
   * the audit log's JSON blob, never on the row itself, so the column
   * stayed permanently at its 'pending_scan' default and neither the UI
   * nor ./pipeline.ts's processing gate could ever see a real result. */
  scanStatus?: ClaimEvidenceScanStatus;
}): Promise<ClaimEvidenceDocumentRow | null> {
  assertValidEvidenceTransition(args.from, args.to);
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceDocumentRow>(
    `UPDATE claim_evidence_documents
        SET status=$1, processing_error=$2, processing_error_code=$3,
            identity_status=COALESCE($4,identity_status), scan_status=COALESCE($5,scan_status), updated_at=now()
      WHERE id=$6 AND account_id=$7 AND status=$8
      RETURNING ${DOCUMENT_COLUMNS}`,
    [args.to, args.errorMessage ?? null, args.errorCode ?? null, args.identityStatus ?? null, args.scanStatus ?? null, args.id, args.accountId, args.from],
  );
  return result.rows[0] ?? null;
}

/** The only way a held document's scan_unavailable becomes clean: a real
 * clean verdict from the bounded rescan (./pipeline.ts). CAS on the held
 * state, so a document that was deleted, superseded, rejected or already
 * moved on is never touched. */
export async function markEvidenceRescanClean(accountId: string, id: string): Promise<ClaimEvidenceDocumentRow | null> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceDocumentRow>(
    `UPDATE claim_evidence_documents SET scan_status='clean', updated_at=now()
      WHERE id=$1 AND account_id=$2 AND status='quarantined' AND scan_status='scan_unavailable' AND superseded_at IS NULL AND ${activePredicate()}
      RETURNING ${DOCUMENT_COLUMNS}`,
    [id, accountId],
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

/** Thrown by supersedeEvidenceDocument() when `oldId` does not resolve, for
 * this account, to a currently-active (not already superseded) document.
 * Callers (see app/api/claims/evidence/upload/route.ts) should already
 * have resolved and scope-checked the old document via
 * getScopedEvidenceDocument() before ever calling this function -- since
 * that lookup now also excludes an already-superseded document (see its
 * own doc comment), this error path is mainly a defense-in-depth backstop
 * against a race (two concurrent requests both trying to supersede the
 * same document) rather than the expected way callers discover a bad id. */
export class EvidenceAlreadySupersededError extends Error {
  constructor(public readonly oldId: string) {
    super("This evidence document was not found for this account, or has already been superseded.");
  }
}

/** A corrected re-upload for the same claim/document-type slot: the OLD
 * document row is marked superseded (kept, never deleted -- the audit log
 * and anything reviewed against it stay valid history) and every match
 * table that can cite it is superseded too, so none of them can keep
 * unlocking an amount once the evidence behind it has been replaced.
 *
 * Wave 2 fix (D33): this previously superseded only
 * claim_cause_definition_matches and claim_ci_definition_matches --
 * claim_disability_definition_matches was missing entirely, so a
 * corrected re-upload of disability/TPD medical evidence left the OLD
 * disability match active and able to keep unlocking a disability
 * calculation indefinitely (lib/claims/evidence/disability-session-matches.ts
 * reloads disability matches fresh every chat turn, so it WOULD have
 * picked up an invalidation -- it just never received one). MATCH_TABLES
 * below is now kept deliberately identical to
 * lib/lifecycle/coordinator.ts's invalidateClaimMatchesReferencing(),
 * which already superseded all three tables correctly for the (separate,
 * currently unreachable-by-any-route) evidence-deletion flow -- this fix
 * brings the re-upload/correction path up to that same standard rather
 * than inventing a new one.
 *
 * Wave 2 fix (D7/D33): also now resets any OPEN (status<>'complete')
 * claim_sessions.decision_packet/pending_question/status affected by the
 * supersession, exactly like invalidateClaimMatchesReferencing() already
 * does for a deletion. app/api/claims/[id]/pack/route.ts reads
 * claim_sessions.decision_packet directly with NO recomputation, so
 * without this reset a stale dollar amount computed against now-dead
 * evidence would still be downloadable as a "claim pack" PDF even after
 * the evidence behind it was corrected -- lib/claims/orchestrator.ts only
 * ever recomputes and re-saves decision_packet on the NEXT chat turn, and
 * a household that goes straight from "correct this document" to
 * "download my claim pack" would otherwise see the pre-correction figure.
 * This reset also covers evidence that has NO match-table row at all
 * (medical-claim bill evidence -- see
 * lib/claims/evidence/medical-bill-evidence.ts's own doc comment on why
 * it has no per-benefit match table) by always including the superseded
 * document's own claim_session_id, not only sessions discovered via a
 * match-table RETURNING clause. A 'complete' session is left alone,
 * exactly like the deletion flow: reopening an already-completed claim is
 * a separate, explicit product decision this function does not make.
 *
 * Idempotent/retry-safe: the very first UPDATE only matches a row that is
 * still account-scoped and NOT ALREADY superseded, so a retried call for
 * the same oldId throws EvidenceAlreadySupersededError instead of
 * silently re-running (harmlessly, but meaninglessly) the match/session
 * invalidation a second time. */
export async function supersedeEvidenceDocument(args: { accountId: string; oldId: string; newId: string; reason: string }): Promise<{ affectedOpenClaimSessionIds: string[] }> {
  // ensureCriticalIllnessSchema()/ensureDisabilitySchema() (each of which
  // also applies ensureClaimEvidenceSchema()) guarantee all three match
  // tables exist before the UPDATEs against them below run, for a
  // death-evidence re-upload exactly the same as a medical-evidence or
  // disability one.
  await ensureCriticalIllnessSchema();
  await ensureDisabilitySchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const supersededDoc = await client.query<{ claim_session_id: string }>(
      `UPDATE claim_evidence_documents SET superseded_at=now(), updated_at=now()
        WHERE id=$1 AND account_id=$2 AND superseded_at IS NULL
        RETURNING claim_session_id`,
      [args.oldId, args.accountId],
    );
    if (!supersededDoc.rows[0]) throw new EvidenceAlreadySupersededError(args.oldId);
    await client.query(
      `UPDATE claim_evidence_documents SET supersedes_id=$1, updated_at=now() WHERE id=$2 AND account_id=$3`,
      [args.oldId, args.newId, args.accountId],
    );

    const affectedSessions = new Set<string>([supersededDoc.rows[0].claim_session_id]);
    // Kept identical to lib/lifecycle/coordinator.ts's
    // invalidateClaimMatchesReferencing() MATCH_TABLES list -- see this
    // function's own doc comment (D33) for why.
    const MATCH_TABLES = ["claim_cause_definition_matches", "claim_ci_definition_matches", "claim_disability_definition_matches"] as const;
    for (const table of MATCH_TABLES) {
      const { rows } = await client.query<{ claim_session_id: string }>(
        `UPDATE ${table} SET superseded_at=now(), superseded_reason=$1
          WHERE account_id=$2 AND evidence_document_id=$3 AND superseded_at IS NULL
         RETURNING claim_session_id`,
        [args.reason, args.accountId, args.oldId],
      );
      for (const row of rows) affectedSessions.add(row.claim_session_id);
    }

    // Same non-terminal-status reset invalidateClaimMatchesReferencing()
    // performs for a deletion -- see this function's own doc comment (D7).
    const { rows: reset } = await client.query<{ id: string }>(
      `UPDATE claim_sessions SET status='fact_finding', pending_question=NULL, decision_packet=NULL, updated_at=now()
        WHERE account_id=$1 AND id=ANY($2::uuid[]) AND status<>'complete'
       RETURNING id`,
      [args.accountId, [...affectedSessions]],
    );

    await client.query("COMMIT");
    return { affectedOpenClaimSessionIds: reset.map((r) => r.id) };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

// --- Extractions ------------------------------------------------------

const EXTRACTION_COLUMNS = `id::text,account_id,evidence_document_id,source_document_version,extracted_fields,reviewed_fields,
  reviewed_at::text,reviewed_by,extraction_model,extraction_provider,extraction_version,processing_timestamp::text,
  identity_conflicts,model_execution,created_at::text,updated_at::text`;

/** Idempotent: retrying extraction for the same document VERSION (same
 * evidence_document_id + source_document_version, i.e. the document's
 * content hash at extraction time) upserts this same row rather than
 * creating a duplicate, so a retried background job can never fork the
 * extraction record or double-count it. */
export async function recordExtraction(args: {
  accountId: string; evidenceDocumentId: string; sourceDocumentVersion: string; extractedFields: ClaimEvidenceExtractedFields;
  extractionModel: string; extractionProvider: string; extractionVersion: string; identityConflicts: ClaimEvidenceIdentityConflict[];
  /** The real model_executions identity behind this extraction (see
   * ./extraction-provenance.ts). Omitted/null stores NULL -- and a retried
   * extraction that could not persist provenance overwrites any earlier
   * value with NULL, so fields and provenance always describe the same
   * attempt and an old execution can never vouch for new output. */
  modelExecution?: StoredExtractionExecution | null;
}): Promise<ClaimEvidenceExtractionRow> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceExtractionRow>(
    `INSERT INTO claim_evidence_extractions(account_id,evidence_document_id,source_document_version,extracted_fields,extraction_model,extraction_provider,extraction_version,identity_conflicts,model_execution)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9::jsonb)
     ON CONFLICT (evidence_document_id,source_document_version) DO UPDATE
       SET extracted_fields=EXCLUDED.extracted_fields, extraction_model=EXCLUDED.extraction_model,
           extraction_provider=EXCLUDED.extraction_provider, extraction_version=EXCLUDED.extraction_version,
           identity_conflicts=EXCLUDED.identity_conflicts, model_execution=EXCLUDED.model_execution,
           processing_timestamp=now(), updated_at=now()
     RETURNING ${EXTRACTION_COLUMNS}`,
    [args.accountId, args.evidenceDocumentId, args.sourceDocumentVersion, JSON.stringify(args.extractedFields), args.extractionModel, args.extractionProvider, args.extractionVersion, JSON.stringify(args.identityConflicts),
      args.modelExecution ? JSON.stringify(args.modelExecution) : null],
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
  cause_evidence,definition_evidence,result,reviewed_at::text,reviewed_by,reason,superseded_at::text,superseded_reason,evidence_provenance,created_at::text`;

/** Serialises concurrent decisions on the same review subject so two
 * reviewers can never both leave an active decision for it. A transaction-
 * scoped advisory lock: released automatically at COMMIT/ROLLBACK. */
async function lockReviewSubject(client: { query: (text: string, params?: unknown[]) => Promise<unknown> }, parts: (string | null)[]) {
  await client.query("SELECT pg_advisory_xact_lock(73499209, hashtext($1))", [parts.map((p) => p ?? "").join("|")]);
}

/** Records a reviewer's (or a deterministic rule's) finalised decision.
 * Never called from chat text or model output -- see
 * lib/claims/evidence/matches.ts, the only caller. Any prior ACTIVE match
 * for the exact same review subject (family member, claim, contract,
 * coverage, evidence document and definition citation) is
 * superseded first, in the same transaction, so there is never more than
 * one active match per scope and the old one cannot keep being read
 * alongside the new one. */
export async function recordCauseDefinitionMatch(args: {
  accountId: string; familyMemberId: string; claimSessionId: string; contractId: string; coverageId: string | null;
  evidenceDocumentId: string; causeEvidence: unknown; definitionEvidence: unknown; result: CauseDefinitionMatchResultValue;
  reviewedBy: string; reason: string | null;
  /** Snapshot of the extraction provenance the reviewer's decision rests
   * on, bound to evidenceDocumentId -- derived server-side from the stored
   * extraction (see ./extraction-provenance.ts), never from a request body.
   * Null when that extraction has no persisted provenance; every amount
   * then stays fail-closed. */
  evidenceProvenance?: EvidenceProvenance | null;
}): Promise<ClaimCauseDefinitionMatchRow> {
  await ensureClaimEvidenceSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockReviewSubject(client, ["cause", args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId, args.evidenceDocumentId]);
    // Supersedes ONLY the identical review subject -- same document and same
    // definition citation and wording (see ./decision-selection.ts), plus a
    // legacy decision (no wording fingerprint) for that same citation, which
    // a fingerprinted re-review replaces as history. A decision on another
    // document, or against other wording, is never touched.
    await client.query(
      `UPDATE claim_cause_definition_matches SET superseded_at=now(), superseded_reason='Superseded by a newer review.'
        WHERE account_id=$1 AND family_member_id=$2 AND claim_session_id=$3 AND contract_id=$4 AND coverage_id IS NOT DISTINCT FROM $5
          AND evidence_document_id=$6 AND (definition_evidence=$7::jsonb OR (NOT (definition_evidence ? 'wordingHash') AND definition_evidence->>'policyId' = $7::jsonb->>'policyId' AND definition_evidence->>'chunkId' = $7::jsonb->>'chunkId' AND definition_evidence->>'pageStart' = $7::jsonb->>'pageStart' AND definition_evidence->>'pageEnd' = $7::jsonb->>'pageEnd')) AND superseded_at IS NULL`,
      [args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId, args.evidenceDocumentId, JSON.stringify(args.definitionEvidence)],
    );
    const inserted = await client.query<ClaimCauseDefinitionMatchRow>(
      `INSERT INTO claim_cause_definition_matches(account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,cause_evidence,definition_evidence,result,reviewed_by,reason,evidence_provenance)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb)
       RETURNING ${MATCH_COLUMNS}`,
      [args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId, args.evidenceDocumentId, JSON.stringify(args.causeEvidence), JSON.stringify(args.definitionEvidence), args.result, args.reviewedBy, args.reason,
        args.evidenceProvenance ? JSON.stringify(args.evidenceProvenance) : null],
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

// --- Critical-illness definition matches --------------------------------

const CI_MATCH_COLUMNS = `id::text,account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,
  benefit_code,illness_name,medical_evidence,definition_evidence,result,reviewed_at::text,reviewed_by,reason,superseded_at::text,superseded_reason,evidence_provenance,created_at::text`;

/** Records a reviewer's (or a deterministic rule's) finalised decision that
 * reviewed medical evidence does or does not match ONE policy's own
 * critical-illness definition for ONE exact benefit and illness. Never
 * called from chat text or model output -- see
 * lib/claims/evidence/ci-matches.ts, the only caller. Any prior ACTIVE
 * match for the exact same (family member, claim, contract, coverage,
 * evidence document, definition citation,
 * benefit code, illness name) scope is superseded first, in the same
 * transaction, so a match for one illness/stage/benefit can never keep
 * being read alongside a corrected one for that exact same slot -- and,
 * crucially, superseding is scoped by benefit_code and illness_name too,
 * so confirming "Major Cancer" never touches an existing "Early Stage
 * Cancer" match under the very same policy and claim. */
export async function recordCIDefinitionMatch(args: {
  accountId: string; familyMemberId: string; claimSessionId: string; contractId: string; coverageId: string | null;
  evidenceDocumentId: string; benefitCode: string; illnessName: string; medicalEvidence: unknown; definitionEvidence: unknown;
  result: CIDefinitionMatchResultValue; reviewedBy: string; reason: string | null;
  /** Snapshot of the extraction provenance the reviewer's decision rests
   * on, bound to evidenceDocumentId -- derived server-side from the stored
   * extraction (see ./extraction-provenance.ts), never from a request body.
   * Null when that extraction has no persisted provenance; every amount
   * then stays fail-closed. */
  evidenceProvenance?: EvidenceProvenance | null;
}): Promise<ClaimCIDefinitionMatchRow> {
  await ensureCriticalIllnessSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockReviewSubject(client, ["ci", args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId, args.evidenceDocumentId, args.benefitCode, args.illnessName]);
    await client.query(
      `UPDATE claim_ci_definition_matches SET superseded_at=now(), superseded_reason='Superseded by a newer review.'
        WHERE account_id=$1 AND family_member_id=$2 AND claim_session_id=$3 AND contract_id=$4 AND coverage_id IS NOT DISTINCT FROM $5
          AND benefit_code=$6 AND illness_name=$7 AND evidence_document_id=$8 AND (definition_evidence=$9::jsonb OR (NOT (definition_evidence ? 'wordingHash') AND definition_evidence->>'policyId' = $9::jsonb->>'policyId' AND definition_evidence->>'chunkId' = $9::jsonb->>'chunkId' AND definition_evidence->>'pageStart' = $9::jsonb->>'pageStart' AND definition_evidence->>'pageEnd' = $9::jsonb->>'pageEnd')) AND superseded_at IS NULL`,
      [args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId, args.benefitCode, args.illnessName,
        args.evidenceDocumentId, JSON.stringify(args.definitionEvidence)],
    );
    const inserted = await client.query<ClaimCIDefinitionMatchRow>(
      `INSERT INTO claim_ci_definition_matches(account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,benefit_code,illness_name,medical_evidence,definition_evidence,result,reviewed_by,reason,evidence_provenance)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::jsonb)
       RETURNING ${CI_MATCH_COLUMNS}`,
      [args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId, args.evidenceDocumentId,
        args.benefitCode, args.illnessName, JSON.stringify(args.medicalEvidence), JSON.stringify(args.definitionEvidence),
        args.result, args.reviewedBy, args.reason, args.evidenceProvenance ? JSON.stringify(args.evidenceProvenance) : null],
    );
    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Every currently-active (non-superseded) CI match for this family
 * member/claim, across every contract, coverage, benefit and illness --
 * the CI analogue of loadActiveCauseDefinitionMatches(), loaded fresh by
 * lib/claims/evidence/ci-session-matches.ts on every chat turn. */
export async function loadActiveCIDefinitionMatches(accountId: string, familyMemberId: string, claimSessionId: string): Promise<ClaimCIDefinitionMatchRow[]> {
  await ensureCriticalIllnessSchema();
  const result = await query<ClaimCIDefinitionMatchRow>(
    `SELECT ${CI_MATCH_COLUMNS} FROM claim_ci_definition_matches
      WHERE account_id=$1 AND family_member_id=$2 AND claim_session_id=$3 AND superseded_at IS NULL`,
    [accountId, familyMemberId, claimSessionId],
  );
  return result.rows;
}

// --- Disability definition matches --------------------------------------

const DISABILITY_MATCH_COLUMNS = `id::text,account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,
  benefit_code,match_key,medical_evidence,definition_evidence,result,reviewed_at::text,reviewed_by,reason,superseded_at::text,superseded_reason,evidence_provenance,created_at::text`;

/** Records a reviewer's (or a deterministic rule's) finalised decision that
 * reviewed medical evidence does or does not match ONE policy's own
 * disability definition for ONE exact benefit and match key (a fixed TPD/
 * disability-income sentinel, or an exact schedule-of-injuries row code --
 * see lib/claims/calculators/evidence.ts's DisabilityDefinitionMatch doc
 * comment). Never called from chat text or model output -- see
 * lib/claims/evidence/disability-matches.ts, the only caller. Any prior
 * ACTIVE match for the exact same (family member, claim, contract,
 * evidence document, definition citation,
 * coverage, benefit code, match key) scope is superseded first, in the
 * same transaction, exactly mirroring recordCIDefinitionMatch() above. */
export async function recordDisabilityDefinitionMatch(args: {
  accountId: string; familyMemberId: string; claimSessionId: string; contractId: string; coverageId: string | null;
  evidenceDocumentId: string; benefitCode: string; matchKey: string; medicalEvidence: unknown; definitionEvidence: unknown;
  result: DisabilityDefinitionMatchResultValue; reviewedBy: string; reason: string | null;
  /** Snapshot of the extraction provenance the reviewer's decision rests
   * on, bound to evidenceDocumentId -- derived server-side from the stored
   * extraction (see ./extraction-provenance.ts), never from a request body.
   * Null when that extraction has no persisted provenance; every amount
   * then stays fail-closed. */
  evidenceProvenance?: EvidenceProvenance | null;
}): Promise<ClaimDisabilityDefinitionMatchRow> {
  await ensureDisabilitySchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockReviewSubject(client, ["disability", args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId, args.evidenceDocumentId, args.benefitCode, args.matchKey]);
    await client.query(
      `UPDATE claim_disability_definition_matches SET superseded_at=now(), superseded_reason='Superseded by a newer review.'
        WHERE account_id=$1 AND family_member_id=$2 AND claim_session_id=$3 AND contract_id=$4 AND coverage_id IS NOT DISTINCT FROM $5
          AND benefit_code=$6 AND match_key=$7 AND evidence_document_id=$8 AND (definition_evidence=$9::jsonb OR (NOT (definition_evidence ? 'wordingHash') AND definition_evidence->>'policyId' = $9::jsonb->>'policyId' AND definition_evidence->>'chunkId' = $9::jsonb->>'chunkId' AND definition_evidence->>'pageStart' = $9::jsonb->>'pageStart' AND definition_evidence->>'pageEnd' = $9::jsonb->>'pageEnd')) AND superseded_at IS NULL`,
      [args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId, args.benefitCode, args.matchKey,
        args.evidenceDocumentId, JSON.stringify(args.definitionEvidence)],
    );
    const inserted = await client.query<ClaimDisabilityDefinitionMatchRow>(
      `INSERT INTO claim_disability_definition_matches(account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,benefit_code,match_key,medical_evidence,definition_evidence,result,reviewed_by,reason,evidence_provenance)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::jsonb)
       RETURNING ${DISABILITY_MATCH_COLUMNS}`,
      [args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.coverageId, args.evidenceDocumentId,
        args.benefitCode, args.matchKey, JSON.stringify(args.medicalEvidence), JSON.stringify(args.definitionEvidence),
        args.result, args.reviewedBy, args.reason, args.evidenceProvenance ? JSON.stringify(args.evidenceProvenance) : null],
    );
    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Every currently-active (non-superseded) disability match for this
 * family member/claim, across every contract, coverage, benefit and match
 * key -- the disability analogue of loadActiveCIDefinitionMatches(),
 * loaded fresh by lib/claims/evidence/disability-session-matches.ts on
 * every chat turn. */
export async function loadActiveDisabilityDefinitionMatches(accountId: string, familyMemberId: string, claimSessionId: string): Promise<ClaimDisabilityDefinitionMatchRow[]> {
  await ensureDisabilitySchema();
  const result = await query<ClaimDisabilityDefinitionMatchRow>(
    `SELECT ${DISABILITY_MATCH_COLUMNS} FROM claim_disability_definition_matches
      WHERE account_id=$1 AND family_member_id=$2 AND claim_session_id=$3 AND superseded_at IS NULL`,
    [accountId, familyMemberId, claimSessionId],
  );
  return result.rows;
}

// --- Evidence provenance context --------------------------------------

/** The CURRENT state of each named evidence document -- account-scoped,
 * active documents only -- plus the model_execution of its latest
 * extraction for its CURRENT file hash, so a stored match's provenance
 * snapshot can be re-checked against live state on every read (see
 * ./extraction-provenance.ts's resolveMatchProvenance()). A document that
 * is missing, in another account, or no longer active is simply absent
 * from the result, which fails closed. */
export async function loadEvidenceProvenanceContext(accountId: string, documentIds: string[]): Promise<Map<string, EvidenceDocumentProvenanceContext>> {
  const contexts = new Map<string, EvidenceDocumentProvenanceContext>();
  const ids = [...new Set(documentIds)];
  if (!ids.length) return contexts;
  await ensureClaimEvidenceSchema();
  const result = await query<{ id: string; family_member_id: string; claim_session_id: string; file_hash: string; superseded_at: string | null; model_execution: unknown }>(
    `SELECT d.id::text, d.family_member_id::text, d.claim_session_id::text, d.file_hash, d.superseded_at::text,
            (SELECT e.model_execution FROM claim_evidence_extractions e
              WHERE e.account_id=d.account_id AND e.evidence_document_id=d.id AND e.source_document_version=d.file_hash
              ORDER BY e.created_at DESC LIMIT 1) AS model_execution
       FROM claim_evidence_documents d
      WHERE d.account_id=$1 AND d.id=ANY($2::uuid[]) AND ${activePredicate("d")}`,
    [accountId, ids],
  );
  for (const row of result.rows) {
    contexts.set(row.id, {
      documentId: row.id, familyMemberId: row.family_member_id, claimSessionId: row.claim_session_id,
      fileHash: row.file_hash, supersededAt: row.superseded_at, currentExecution: row.model_execution,
    });
  }
  return contexts;
}

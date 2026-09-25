/**
 * Evidence model-execution provenance regressions: proves the real
 * claim-evidence extraction provenance now survives
 *   structuredCompletion() -> extractClaimEvidence() -> recordExtraction()
 *   -> reviewer match (confirmCauseDefinitionMatch / record*DefinitionMatch)
 *   -> load*MatchesForFacts() / loadVerifiedMedicalBillFacts()
 *   -> evaluateEvidenceAuthority() / calculateAccidentalDeath()
 * and that every missing, unverified, alias-only, malformed, stale,
 * superseded, wrong-document or out-of-scope record still fails closed.
 *
 * Runs against a disposable PGlite instance with lib/db/client's pool
 * routed through it (the same pattern as scripts/claim-evidence-
 * regressions.ts and scripts/model-provenance-regressions.ts). The provider
 * is simulated at global.fetch only, so the REAL structuredCompletion()
 * -> recordModelExecution() path produces the provenance under test. No
 * test hands a calculator a hand-built "verified" object as its only proof:
 * every authorized case below reads provenance back out of the database
 * through the production loaders.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import fixture from "./fixtures/singlife-death-wording.json";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

const READING_ALIAS = "claude-haiku-4-5";
const RESOLVED_MODEL = "claude-haiku-4-5-20250620";

function providerReply(id: string, model: string | null, payload: unknown) {
  return (async () => new Response(JSON.stringify({
    ...(model ? { id, model } : {}),
    content: [{ type: "text", text: JSON.stringify(payload) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 40, output_tokens: 20 },
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}

const CAUSE_TEXT = "Blunt force trauma from a road traffic accident";
const PAGES = [{ pageNumber: 1, text: `Police report. Deceased: Tan Yi Chuen Desmond. Date of death 2026-09-14. Cause of death: ${CAUSE_TEXT}.` }];
function extractionPayload(documentType: string) {
  return {
    deceasedName: "Tan Yi Chuen Desmond", otherNamesMentioned: [], personIdentifiers: [],
    dateOfDeath: "2026-09-14", statedCauseOfDeath: CAUSE_TEXT, mannerOfDeath: "accident",
    patientName: "Tan Yi Chuen Desmond",
    billLineItems: [{ category: "Surgical fees", description: null, amountText: "1,250.00", currency: "SGD" }],
    issuingAuthority: "SPF", documentReference: "REF-1", documentType,
    pageCitations: [{ field: "statedCauseOfDeath", pageStart: 1, pageEnd: 1, excerpt: CAUSE_TEXT }],
    confidence: {},
  };
}

async function main() {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.READING_MODEL = `anthropic:${READING_ALIAS}`;
  setTelemetryAdapter(new NoopTelemetryAdapter());

  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; }); await previous; return release;
  };
  const execute = async (text: string, params: unknown[] = []) => {
    if (params.length === 0) {
      const results = await db.exec(text); const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query, originalConnect = pool.connect, originalFetch = global.fetch;
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;

  try {
    // --- Legacy schema first: sql/claim-evidence.sql exactly as it was
    // before the provenance columns existed, so historical rows can be
    // written the old way and then migrated by the real ensure-schema path.
    const claimEvidenceSql = await readFile(path.resolve("sql/claim-evidence.sql"), "utf8");
    const legacySql = claimEvidenceSql.split("\n").filter((line) => !/ADD COLUMN IF NOT EXISTS (model_execution|evidence_provenance)/.test(line)).join("\n");
    assert.notEqual(legacySql, claimEvidenceSql, "fixture assumption: sql/claim-evidence.sql must contain the additive provenance ALTERs");
    await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
    await db.exec(legacySql);
    await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));

    const account = "10000000-0000-4000-8000-000000000001";
    const otherAccount = "10000000-0000-4000-8000-000000000099";
    const desmond = "20000000-0000-4000-8000-000000000001";
    const otherMember = "20000000-0000-4000-8000-000000000002";
    const claimA = "30000000-0000-4000-8000-000000000001";
    const claimB = "30000000-0000-4000-8000-000000000002";
    const policyA = "40000000-0000-4000-8000-0000000000a1";
    const policyB = "40000000-0000-4000-8000-0000000000b1";
    const coverageA = "50000000-0000-4000-8000-0000000000a1";
    const coverageB = "50000000-0000-4000-8000-0000000000b1";
    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Test'),($2,'Other')`, [account, otherAccount]);
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Tan Yi Chuen Desmond','Desmond','self'),($3,$2,'Other Member','Other','spouse')`, [desmond, account, otherMember]);
    await pool.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_type) VALUES($1,$2,$3,'fact_finding','death'),($4,$2,$3,'fact_finding','death')`, [claimA, account, desmond, claimB]);
    const pages = fixture.benefitSummary.pages.map((p) => ({ page_number: p.pageNumber, text: p.text }));
    for (const policyId of [policyA, policyB]) {
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,group_policy_number,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,document_authority)
         VALUES($1,$2,$3,'Singlife','Group Personal Accident','G007500','certificate',true,'ready','cert.pdf','k',90)`,
        [policyId, account, desmond],
      );
      for (const p of pages) await pool.query(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)`, [account, policyId, p.page_number, p.text]);
    }
    await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')`, [policyA, desmond, account]);
    await pool.query(
      `INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,confirmed,evidence_verified,product_name)
       VALUES($1,$2,$3,$4,'Personal Accident',600000,'SGD',true,true,'Group Personal Accident'),
             ($5,$2,$6,$4,'Personal Accident',600000,'SGD',true,true,'Group Personal Accident')`,
      [coverageA, account, policyA, desmond, coverageB, policyB],
    );

    // A historical document/extraction/match written with the OLD column set.
    const legacyDoc = "60000000-0000-4000-8000-000000000001";
    const legacyDefinition = { policyId: policyA, chunkId: `page:${policyA}:5`, pageStart: 5, pageEnd: 5 };
    await pool.query(
      `INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash,status,scan_status,identity_status)
       VALUES($1,$2,$3,$4,'police_report','old.pdf','k-old','application/pdf',100,'hash-legacy','matched','clean','confirmed')`,
      [legacyDoc, account, desmond, claimB],
    );
    await pool.query(
      `INSERT INTO claim_evidence_extractions(account_id,evidence_document_id,source_document_version,extracted_fields,extraction_model,extraction_provider,extraction_version)
       VALUES($1,$2,'hash-legacy',$3::jsonb,'gemini-flash','gemini','claim-evidence-extract-v1')`,
      [account, legacyDoc, JSON.stringify(extractionPayload("police_report"))],
    );
    await pool.query(
      `INSERT INTO claim_cause_definition_matches(account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,cause_evidence,definition_evidence,result,reviewed_by)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'matches','Legacy reviewer')`,
      [account, desmond, claimB, policyA, coverageA, legacyDoc,
        JSON.stringify({ documentId: legacyDoc, documentType: "police_report", familyMemberId: desmond, claimEventId: claimB, pageStart: 1, pageEnd: 1 }),
        JSON.stringify(legacyDefinition)],
    );
    const columnCount = async (table: string, column: string) => Number((await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [table, column])).rows[0].n);
    assert.equal(await columnCount("claim_evidence_extractions", "model_execution"), 0, "legacy fixture must start without the new column");

    const { ensureCriticalIllnessSchema } = await import("@/lib/claims/evidence/ci-schema");
    const { ensureDisabilitySchema } = await import("@/lib/claims/evidence/disability-schema");
    await ensureCriticalIllnessSchema();
    await ensureDisabilitySchema();

    const { extractClaimEvidence } = await import("@/lib/claims/evidence/extract");
    const {
      createEvidenceDocument, transitionEvidenceStatus, recordExtraction, getLatestExtraction, loadEvidenceProvenanceContext,
      recordCIDefinitionMatch, recordDisabilityDefinitionMatch, recordCauseDefinitionMatch, supersedeEvidenceDocument,
    } = await import("@/lib/claims/evidence/store");
    const { confirmCauseDefinitionMatch } = await import("@/lib/claims/evidence/matches");
    const { loadCauseDefinitionMatchesForFacts } = await import("@/lib/claims/evidence/session-matches");
    const { loadCIDefinitionMatchesForFacts } = await import("@/lib/claims/evidence/ci-session-matches");
    const { loadDisabilityDefinitionMatchesForFacts } = await import("@/lib/claims/evidence/disability-session-matches");
    const { loadVerifiedMedicalBillFacts } = await import("@/lib/claims/evidence/medical-bill-evidence");
    const { calculateAccidentalDeath } = await import("@/lib/claims/calculators/accidental-death");
    const { validatePolicyEvidence } = await import("@/lib/claims/calculators/evidence");
    const { evaluateEvidenceAuthority, evaluateAggregateEvidenceAuthority } = await import("@/lib/claims/evidence-authority");
    const { parseStoredExecution, provenanceSnapshotForExtraction, resolveMatchProvenance } = await import("@/lib/claims/evidence/extraction-provenance");
    const { UnverifiedModelProvenanceError } = await import("@/lib/ai/provenance");
    type CauseMatch = Awaited<ReturnType<typeof loadCauseDefinitionMatchesForFacts>>[number];

    const accidentalInput = (match: CauseMatch, contractId = policyA, coverageId = coverageA, claimEventId = claimA) => {
      const check = validatePolicyEvidence(match.definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
      if (!check.valid) throw new Error("fixture: stored definition evidence must be well-formed");
      const definition = check.evidence;
      return {
        ownership: { contractId, coverageId }, familyMember: { id: desmond, confirmed: true }, claimEventId,
        deathConfirmed: true, dateOfDeath: "2026-09-14", policyEffectiveDate: "2020-01-01", sumInsured: 600_000, currency: "SGD",
        formula: { kind: "sum_insured_fraction" as const, fraction: 1, evidence: definition },
        ruleEvidence: definition, ownershipEvidence: { policyId: contractId, chunkId: `coverage:${coverageId}`, coverageId, familyMemberId: desmond },
        accidentalDeathDefinitionEvidence: definition, causeDefinitionMatch: match,
      };
    };

    let fileSeq = 0;
    async function readyDocument(documentType: "police_report" | "medical_report" | "discharge_summary", claimSessionId = claimA) {
      fileSeq++;
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: desmond, claimSessionId, documentType, originalFilename: `d${fileSeq}.pdf`, storageKey: `k-prov-${fileSeq}`, mimeType: "application/pdf", byteSize: 100, fileHash: `hash-prov-${fileSeq}` });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined", scanStatus: "clean" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "quarantined", to: "processing" });
      return document;
    }
    async function extractAndStore(document: { id: string; file_hash: string; document_type: string }, replyId: string, model: string | null = RESOLVED_MODEL) {
      global.fetch = providerReply(replyId, model, extractionPayload(document.document_type));
      const extraction = await extractClaimEvidence({ pages: PAGES, documentType: document.document_type as never, documentId: document.id });
      // Exactly what lib/claims/evidence/pipeline.ts does with the result.
      await recordExtraction({
        accountId: account, evidenceDocumentId: document.id, sourceDocumentVersion: document.file_hash,
        extractedFields: extraction.fields, extractionModel: extraction.model, extractionProvider: extraction.provider,
        extractionVersion: extraction.version, identityConflicts: [], modelExecution: extraction.execution,
      });
      return extraction;
    }
    async function toNeedsReview(documentId: string) {
      await transitionEvidenceStatus({ accountId: account, id: documentId, from: "processing", to: "extracted", identityStatus: "confirmed" });
      await transitionEvidenceStatus({ accountId: account, id: documentId, from: "extracted", to: "needs_review" });
    }

    await testAsync("legacy rows written before the provenance columns existed stay readable after the additive migration and fail closed", async () => {
      assert.equal(await columnCount("claim_evidence_extractions", "model_execution"), 1);
      assert.equal(await columnCount("claim_cause_definition_matches", "evidence_provenance"), 1);
      assert.equal(await columnCount("claim_ci_definition_matches", "evidence_provenance"), 1);
      assert.equal(await columnCount("claim_disability_definition_matches", "evidence_provenance"), 1);
      const legacyExtraction = await getLatestExtraction(account, legacyDoc);
      assert.ok(legacyExtraction);
      assert.equal(legacyExtraction!.model_execution ?? null, null);
      assert.equal(provenanceSnapshotForExtraction(legacyExtraction!, legacyDoc), null);
      const facts = await loadCauseDefinitionMatchesForFacts(account, desmond, claimB);
      const legacy = facts.find((m) => m.contractId === policyA && (m.causeEvidence as { documentId?: string }).documentId === legacyDoc);
      assert.ok(legacy, "the historical match must still load");
      assert.equal(legacy!.provenance, undefined, "extraction_model on a historical row is never promoted into provenance");
      const result = calculateAccidentalDeath(accidentalInput(legacy!, policyA, coverageA, claimB));
      assert.equal(result.status, "blocked");
      if (result.status === "blocked") assert.equal(result.reasonCode, "EVIDENCE_PROVENANCE_MISSING");
    });

    await testAsync("extraction captures the provider-reported resolved model and verified status from the real model-execution boundary", async () => {
      const document = await readyDocument("police_report");
      const extraction = await extractAndStore(document, "msg_prov_001");
      assert.ok(extraction.execution, "a successful, persisted, verified execution must be handed back");
      assert.equal(extraction.execution!.verified, true);
      assert.equal(extraction.execution!.resolvedModel, RESOLVED_MODEL);
      assert.notEqual(extraction.execution!.resolvedModel, READING_ALIAS, "the requested alias is never the resolved identity");
      assert.equal(extraction.execution!.operation, "claim_evidence_extraction");
      assert.equal(extraction.execution!.schemaVersion, "claim-evidence-extract-v1");
      assert.equal(extraction.execution!.promptVersion, "claim-evidence-extract-v1");
      const row = await pool.query<{ id: string; verified: boolean; resolved_model: string; requested_model: string; operation: string }>(
        `SELECT id::text, verified, resolved_model, requested_model, operation FROM model_executions WHERE id=$1`, [extraction.execution!.modelExecutionId]);
      assert.equal(row.rows.length, 1, "the stored id must be the exact persisted model_executions row");
      assert.equal(row.rows[0].verified, true);
      assert.equal(row.rows[0].resolved_model, RESOLVED_MODEL);
      assert.equal(row.rows[0].requested_model, READING_ALIAS);
      assert.equal(row.rows[0].operation, "claim_evidence_extraction");
      const stored = await getLatestExtraction(account, document.id);
      assert.deepEqual(parseStoredExecution(stored!.model_execution), extraction.execution);
    });

    await testAsync("an unverified provider response (no reported model) never produces stored provenance -- extraction is refused", async () => {
      const document = await readyDocument("police_report");
      global.fetch = providerReply("msg_prov_unverified", null, extractionPayload("police_report"));
      await assert.rejects(() => extractClaimEvidence({ pages: PAGES, documentType: "police_report", documentId: document.id }), UnverifiedModelProvenanceError);
      assert.equal(await getLatestExtraction(account, document.id), null);
    });

    // --- The full production chain for accidental death.
    const verifiedDoc = await readyDocument("police_report");
    const verifiedExtraction = await extractAndStore(verifiedDoc, "msg_prov_chain");
    await toNeedsReview(verifiedDoc.id);
    const chainMatch = await confirmCauseDefinitionMatch({ accountId: account, reviewerName: "Household reviewer", familyMemberId: desmond, claimSessionId: claimA, evidenceDocumentId: verifiedDoc.id, contractId: policyA, coverageId: coverageA, result: "matches" });

    await testAsync("verified provenance survives extraction -> storage -> reviewer match -> facts mapping -> calculator, and unlocks only that match", async () => {
      assert.ok(chainMatch.evidence_provenance, "the reviewer's match row must snapshot the extraction's provenance");
      const facts = await loadCauseDefinitionMatchesForFacts(account, desmond, claimA);
      const loaded = facts.find((m) => m.contractId === policyA && (m.causeEvidence as { documentId?: string }).documentId === verifiedDoc.id);
      assert.ok(loaded);
      assert.ok(loaded!.provenance);
      assert.equal(loaded!.provenance!.modelExecutionId, verifiedExtraction.execution!.modelExecutionId);
      assert.equal(loaded!.provenance!.resolvedModel, RESOLVED_MODEL);
      assert.equal(loaded!.provenance!.verified, true);
      assert.equal(loaded!.provenance!.sourceDocumentId, verifiedDoc.id);
      assert.equal(loaded!.provenance!.sourceDocumentVersion, verifiedDoc.file_hash);
      assert.equal(loaded!.provenance!.supersededByExecutionId, undefined);
      assert.equal(loaded!.provenance!.reprocessingRequired, undefined);
      const result = calculateAccidentalDeath(accidentalInput(loaded!));
      assert.equal(result.status, "calculated", JSON.stringify(result));
      if (result.status === "calculated") assert.equal(result.potentialAmount, 600_000);

      // Same verified match, other scopes: never unlocks another policy or claim.
      const otherPolicy = calculateAccidentalDeath(accidentalInput(loaded!, policyB, coverageB));
      assert.equal(otherPolicy.status, "blocked");
      const otherClaim = calculateAccidentalDeath(accidentalInput(loaded!, policyA, coverageA, claimB));
      assert.equal(otherClaim.status, "blocked");
    });

    await testAsync("provenance bound to one document never unlocks a match resting on another document", async () => {
      const facts = await loadCauseDefinitionMatchesForFacts(account, desmond, claimA);
      const loaded = facts.find((m) => (m.causeEvidence as { documentId?: string }).documentId === verifiedDoc.id)!;
      const swapped = { ...loaded, causeEvidence: { ...(loaded.causeEvidence as object), documentId: "60000000-0000-4000-8000-0000000000ff" } };
      const result = calculateAccidentalDeath(accidentalInput(swapped));
      assert.equal(result.status, "blocked");
      if (result.status === "blocked") assert.equal(result.reasonCode, "EVIDENCE_SOURCE_DOCUMENT_CHANGED");
    });

    await testAsync("cross-account, cross-member and cross-claim provenance context is never used", async () => {
      assert.equal((await loadEvidenceProvenanceContext(otherAccount, [verifiedDoc.id])).size, 0, "another account never sees this document's provenance context");
      const context = (await loadEvidenceProvenanceContext(account, [verifiedDoc.id])).get(verifiedDoc.id);
      assert.ok(context);
      const snapshot = chainMatch.evidence_provenance;
      assert.ok(resolveMatchProvenance(snapshot, context, { documentId: verifiedDoc.id, familyMemberId: desmond, claimSessionId: claimA }));
      assert.equal(resolveMatchProvenance(snapshot, context, { documentId: verifiedDoc.id, familyMemberId: otherMember, claimSessionId: claimA }), undefined);
      assert.equal(resolveMatchProvenance(snapshot, context, { documentId: verifiedDoc.id, familyMemberId: desmond, claimSessionId: claimB }), undefined);
      assert.equal(resolveMatchProvenance(snapshot, context, { documentId: legacyDoc, familyMemberId: desmond, claimSessionId: claimA }), undefined);
      assert.equal(resolveMatchProvenance(snapshot, undefined, { documentId: verifiedDoc.id, familyMemberId: desmond, claimSessionId: claimA }), undefined);
    });

    await testAsync("a changed document version or a malformed snapshot fails closed", async () => {
      const context = (await loadEvidenceProvenanceContext(account, [verifiedDoc.id])).get(verifiedDoc.id)!;
      const changed = resolveMatchProvenance(chainMatch.evidence_provenance, { ...context, fileHash: "sha256:corrected-upload" }, { documentId: verifiedDoc.id, familyMemberId: desmond, claimSessionId: claimA });
      assert.ok(changed);
      assert.equal(evaluateEvidenceAuthority(changed).authorized, false);
      const supersededDoc = resolveMatchProvenance(chainMatch.evidence_provenance, { ...context, supersededAt: new Date().toISOString() }, { documentId: verifiedDoc.id, familyMemberId: desmond, claimSessionId: claimA });
      assert.equal(evaluateEvidenceAuthority(supersededDoc).authorized, false);
      const malformed = { ...(chainMatch.evidence_provenance as object), verified: "yes" };
      assert.equal(resolveMatchProvenance(malformed, context, { documentId: verifiedDoc.id, familyMemberId: desmond, claimSessionId: claimA }), undefined);
      const r = evaluateEvidenceAuthority(resolveMatchProvenance(malformed, context, { documentId: verifiedDoc.id, familyMemberId: desmond, claimSessionId: claimA }));
      assert.equal(r.authorized, false);
      if (!r.authorized) assert.equal(r.reasonCode, "EVIDENCE_PROVENANCE_MISSING");
    });

    await testAsync("a requested model alias alone never counts as resolved identity", async () => {
      const aliasOnly = parseStoredExecution({ modelExecutionId: "x", operation: "claim_evidence_extraction", verified: true, resolvedModel: null, promptVersion: "claim-evidence-extract-v1", schemaVersion: "claim-evidence-extract-v1" });
      assert.ok(aliasOnly);
      const snapshot = provenanceSnapshotForExtraction({ model_execution: aliasOnly, source_document_version: verifiedDoc.file_hash, extraction_version: "claim-evidence-extract-v1" }, verifiedDoc.id);
      const r1 = evaluateEvidenceAuthority(snapshot);
      assert.equal(r1.authorized, false);
      if (!r1.authorized) assert.equal(r1.reasonCode, "EVIDENCE_MODEL_IDENTITY_MISSING");
      const unverifiedAlias = provenanceSnapshotForExtraction({ model_execution: { ...aliasOnly!, verified: false, resolvedModel: READING_ALIAS }, source_document_version: verifiedDoc.file_hash, extraction_version: "claim-evidence-extract-v1" }, verifiedDoc.id);
      const r2 = evaluateEvidenceAuthority(unverifiedAlias);
      assert.equal(r2.authorized, false);
      if (!r2.authorized) assert.equal(r2.reasonCode, "EVIDENCE_EXECUTION_UNVERIFIED");
      assert.equal(parseStoredExecution({ modelExecutionId: "x", operation: "not_an_operation", verified: true, resolvedModel: RESOLVED_MODEL, promptVersion: null, schemaVersion: null }), null);
    });

    await testAsync("an extraction persisted without provenance blocks with EVIDENCE_PROVENANCE_MISSING end to end", async () => {
      const document = await readyDocument("police_report", claimB);
      await recordExtraction({
        accountId: account, evidenceDocumentId: document.id, sourceDocumentVersion: document.file_hash,
        extractedFields: { ...extractionPayload("police_report"), documentType: "police_report" } as never,
        extractionModel: RESOLVED_MODEL, extractionProvider: "anthropic", extractionVersion: "claim-evidence-extract-v1", identityConflicts: [],
      });
      await toNeedsReview(document.id);
      const recorded = await recordCauseDefinitionMatch({
        accountId: account, familyMemberId: desmond, claimSessionId: claimB, contractId: policyB, coverageId: coverageB, evidenceDocumentId: document.id,
        causeEvidence: { documentId: document.id, documentType: "police_report", familyMemberId: desmond, claimEventId: claimB, pageStart: 1, pageEnd: 1 },
        definitionEvidence: { policyId: policyB, chunkId: `page:${policyB}:5`, pageStart: 5, pageEnd: 5 }, result: "matches", reviewedBy: "R", reason: null,
        evidenceProvenance: provenanceSnapshotForExtraction((await getLatestExtraction(account, document.id))!, document.id),
      });
      assert.equal(recorded.evidence_provenance ?? null, null);
      const loaded = (await loadCauseDefinitionMatchesForFacts(account, desmond, claimB)).find((m) => m.contractId === policyB && (m.causeEvidence as { documentId?: string }).documentId === document.id)!;
      assert.equal(loaded.provenance, undefined);
      const result = calculateAccidentalDeath(accidentalInput(loaded, policyB, coverageB, claimB));
      assert.equal(result.status, "blocked");
      if (result.status === "blocked") assert.equal(result.reasonCode, "EVIDENCE_PROVENANCE_MISSING");
    });

    await testAsync("critical-illness and disability matches carry the same bound, current provenance -- and lose authority when re-extracted", async () => {
      const document = await readyDocument("medical_report");
      await extractAndStore(document, "msg_prov_ci");
      await toNeedsReview(document.id);
      const extraction = (await getLatestExtraction(account, document.id))!;
      const medicalEvidence = { documentId: document.id, documentType: "medical_report", familyMemberId: desmond, claimEventId: claimA, pageStart: 1, pageEnd: 1 };
      const definitionEvidence = { policyId: policyA, chunkId: `page:${policyA}:5`, pageStart: 5, pageEnd: 5 };
      await recordCIDefinitionMatch({
        accountId: account, familyMemberId: desmond, claimSessionId: claimA, contractId: policyA, coverageId: coverageA, evidenceDocumentId: document.id,
        benefitCode: "ci-major", illnessName: "Major Cancer", medicalEvidence, definitionEvidence, result: "matches", reviewedBy: "R", reason: null,
        evidenceProvenance: provenanceSnapshotForExtraction(extraction, document.id),
      });
      await recordDisabilityDefinitionMatch({
        accountId: account, familyMemberId: desmond, claimSessionId: claimA, contractId: policyA, coverageId: coverageA, evidenceDocumentId: document.id,
        benefitCode: "tpd-lump-sum", matchKey: "total_permanent_disability", medicalEvidence, definitionEvidence, result: "matches", reviewedBy: "R", reason: null,
        evidenceProvenance: provenanceSnapshotForExtraction(extraction, document.id),
      });
      const ci = (await loadCIDefinitionMatchesForFacts(account, desmond, claimA)).find((m) => m.benefitCode === "ci-major" && (m.medicalEvidence as { documentId?: string }).documentId === document.id)!;
      const tpd = (await loadDisabilityDefinitionMatchesForFacts(account, desmond, claimA)).find((m) => m.benefitCode === "tpd-lump-sum" && (m.medicalEvidence as { documentId?: string }).documentId === document.id)!;
      for (const match of [ci, tpd]) {
        assert.ok(match.provenance, "a reviewed CI/disability match must carry its extraction's provenance");
        assert.deepEqual(evaluateEvidenceAuthority(match.provenance, { expectedSourceDocumentId: document.id }), { authorized: true });
        const elsewhere = evaluateEvidenceAuthority(match.provenance, { expectedSourceDocumentId: legacyDoc });
        assert.equal(elsewhere.authorized, false);
        if (!elsewhere.authorized) assert.equal(elsewhere.reasonCode, "EVIDENCE_SOURCE_DOCUMENT_CHANGED");
      }
      // A later re-extraction of the same document version replaces the
      // execution behind it; the reviewed snapshot is now superseded.
      await extractAndStore(document, "msg_prov_ci_rerun");
      const ciAfter = (await loadCIDefinitionMatchesForFacts(account, desmond, claimA)).find((m) => m.benefitCode === "ci-major" && (m.medicalEvidence as { documentId?: string }).documentId === document.id)!;
      const tpdAfter = (await loadDisabilityDefinitionMatchesForFacts(account, desmond, claimA)).find((m) => m.benefitCode === "tpd-lump-sum" && (m.medicalEvidence as { documentId?: string }).documentId === document.id)!;
      for (const match of [ciAfter, tpdAfter]) {
        const r = evaluateEvidenceAuthority(match.provenance, { expectedSourceDocumentId: document.id });
        assert.equal(r.authorized, false);
        if (!r.authorized) assert.equal(r.reasonCode, "EVIDENCE_EXECUTION_SUPERSEDED");
      }
    });

    await testAsync("a re-extracted cause-of-death document supersedes the reviewed provenance and blocks the calculator", async () => {
      await extractAndStore(verifiedDoc, "msg_prov_chain_rerun");
      const loaded = (await loadCauseDefinitionMatchesForFacts(account, desmond, claimA)).find((m) => (m.causeEvidence as { documentId?: string }).documentId === verifiedDoc.id)!;
      assert.ok(loaded.provenance?.supersededByExecutionId);
      const result = calculateAccidentalDeath(accidentalInput(loaded));
      assert.equal(result.status, "blocked");
      if (result.status === "blocked") assert.equal(result.reasonCode, "EVIDENCE_EXECUTION_SUPERSEDED");
    });

    await testAsync("a superseded (replaced) document's match never reaches the calculator again", async () => {
      const replacement = await readyDocument("police_report");
      await supersedeEvidenceDocument({ accountId: account, oldId: verifiedDoc.id, newId: replacement.id, reason: "corrected upload" });
      const facts = await loadCauseDefinitionMatchesForFacts(account, desmond, claimA);
      assert.equal(facts.some((m) => (m.causeEvidence as { documentId?: string }).documentId === verifiedDoc.id), false);
    });

    await testAsync("verified medical-bill facts carry per-document provenance, and one provenance-less bill blocks the whole aggregate", async () => {
      const bill = await readyDocument("discharge_summary", claimB);
      await extractAndStore(bill, "msg_prov_bill");
      await toNeedsReview(bill.id);
      await transitionEvidenceStatus({ accountId: account, id: bill.id, from: "needs_review", to: "matched" });
      const facts = await loadVerifiedMedicalBillFacts(account, desmond, claimB);
      assert.deepEqual(facts.sourceDocumentIds, [bill.id]);
      assert.equal(facts.provenance?.length, 1);
      assert.equal(facts.provenance![0].sourceDocumentId, bill.id);
      assert.equal(facts.provenance![0].resolvedModel, RESOLVED_MODEL);
      assert.deepEqual(evaluateAggregateEvidenceAuthority(facts.provenance), { authorized: true });

      const unprovenanced = await readyDocument("discharge_summary", claimB);
      await recordExtraction({
        accountId: account, evidenceDocumentId: unprovenanced.id, sourceDocumentVersion: unprovenanced.file_hash,
        extractedFields: { ...extractionPayload("discharge_summary"), documentType: "discharge_summary" } as never,
        extractionModel: RESOLVED_MODEL, extractionProvider: "anthropic", extractionVersion: "claim-evidence-extract-v1", identityConflicts: [],
      });
      await toNeedsReview(unprovenanced.id);
      await transitionEvidenceStatus({ accountId: account, id: unprovenanced.id, from: "needs_review", to: "matched" });
      const mixed = await loadVerifiedMedicalBillFacts(account, desmond, claimB);
      assert.equal(mixed.sourceDocumentIds.length, 2);
      const r = evaluateAggregateEvidenceAuthority(mixed.provenance);
      assert.equal(r.authorized, false);
      if (!r.authorized) assert.equal(r.reasonCode, "EVIDENCE_PROVENANCE_MISSING");
    });
  } finally {
    global.fetch = originalFetch;
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.close();
  }
  console.log(`DearPolicy evidence-provenance regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

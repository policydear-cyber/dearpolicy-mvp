/**
 * Evidence-table browser-write restrictions, proven at the database.
 *
 * A household (or reviewer) browser session reaches Postgres as the
 * `authenticated` role with its own JWT subject. sql/household-rls.sql now
 * lets such a session READ its household's evidence rows and do exactly one
 * thing to them: move an active document to pending_deletion inside the
 * lifecycle deletion route. Every scan, quarantine, processing, extraction,
 * checksum/storage, provenance, review, supersession, failure and ownership
 * column is written only by the trusted server connection.
 *
 * Runs on PGlite with the production migrations, after a broad test GRANT
 * (the Supabase default), so the narrowing in household-rls.sql is what is
 * actually in force. Real upload, bill-review, reviewer-decision and
 * deletion routes; real store, scan-ledger, extraction and calculator code.
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";
import { asUser, fixedUuid, startReviewerHarness } from "./fixtures/reviewer-harness";
import { BENEFIT_FIXTURES } from "./fixtures/reviewer-benefit-wording";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

const BILL_PAYLOAD = {
  deceasedName: null, otherNamesMentioned: [], personIdentifiers: [{ label: "NRIC", value: "S1234567A" }],
  dateOfDeath: null, statedCauseOfDeath: null, mannerOfDeath: null, patientName: "Jordan Rivera",
  hospitalName: "Mount Example Hospital", hospitalCountry: "Singapore", admissionDate: "2026-09-01", dischargeDate: "2026-09-04",
  admissionType: "inpatient", wardType: "B1",
  billLineItems: [{ category: "Surgical fees", description: "Appendectomy", amountText: "1,250.00", currency: "SGD" }],
  thirdPartyPayments: [{ source: "MediShield Life", amountText: "200.00", currency: "SGD" }],
  issuingAuthority: null, documentReference: "INV-1", documentType: "hospital_bill",
  pageCitations: [{ field: "billLineItems", pageStart: 1, pageEnd: 1, excerpt: "Surgical fees Appendectomy 1,250.00" }],
  confidence: {},
};
const BILL_PAGES = [{ pageNumber: 1, text: "Mount Example Hospital. Patient Jordan Rivera NRIC S1234567A. Surgical fees Appendectomy 1,250.00 SGD. MediShield Life 200.00" }];

// Rejections raised by privileges, RLS or the household guard triggers.
const DENIED = /permission denied|row-level security|may only move an active evidence document|can only be retired|may only retire/i;
// The only columns a household session holds UPDATE on, and only for the
// active -> pending_deletion move checked by guard_household_evidence_update.
const LIFECYCLE_COLUMNS = ["lifecycle_state", "lifecycle_version", "updated_at"];

async function main() {
  const h = await startReviewerHarness();
  const db = h.db;
  const f = BENEFIT_FIXTURES[0];
  const reviewer = fixedUuid("c9300000", 1);
  const ownerA = fixedUuid("b9300000", 1), ownerB = fixedUuid("b9300000", 2);
  const householdA = fixedUuid("a9300000", 1), householdB = fixedUuid("a9300000", 2);

  // One database session as a given browser user, always rolled back, so
  // every attempt starts from the same committed state.
  async function asBrowser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL ROLE authenticated");
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
      return await fn();
    } finally { await db.query("ROLLBACK"); }
  }
  const denied = (userId: string, sql: string, params: unknown[], label: string) =>
    asBrowser(userId, async () => { await assert.rejects(db.query(sql, params), DENIED, label); });
  const affected = (userId: string, sql: string, params: unknown[]) =>
    asBrowser(userId, async () => (await db.query(sql, params)).affectedRows ?? 0);
  const visible = (userId: string, sql: string, params: unknown[]) =>
    asBrowser(userId, async () => (await db.query(sql, params)).rows.length);
  const columnsOf = async (table: string) =>
    (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table])).rows.map((r) => r.column_name);
  const row = async (table: string, id: string) => (await pool.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0] as Record<string, unknown>;

  try {
    await h.admin.provisionClaimReviewer({ userId: reviewer, displayLabel: "Reviewer", operator: "ops.lead" });
    await h.createHousehold(householdA, ownerA);
    await h.createHousehold(householdB, ownerB, "Other household");
    const member = await h.createMember(householdA, fixedUuid("d9300000", 1), "Tan Yi Chuen Desmond");
    const claim = await h.createClaim(householdA, member, fixedUuid("e9300000", 1), f.claimEventType);
    const { policyId, coverageId } = await h.createPolicy({ accountId: householdA, memberId: member, policyId: fixedUuid("f9300000", 1), coverageId: fixedUuid("f9400000", 1), ...f.policy });
    // Real upload route -> service scan -> processing -> real extraction with provenance.
    const doc = await h.uploadEvidence({ accountId: householdA, ownerUserId: ownerA, memberId: member, claimId: claim, ...f.evidence });
    const extractionId = (await pool.query<{ id: string }>(`SELECT id::text FROM claim_evidence_extractions WHERE evidence_document_id=$1`, [doc])).rows[0].id;
    const item = async () => (await h.assess(householdA, member, claim, f.facts)).assessments.find((a) => a.id === f.itemId && a.coverageId === coverageId);
    const docBefore = await row("claim_evidence_documents", doc);
    const extractionBefore = await row("claim_evidence_extractions", extractionId);

    const evidenceColumns = await columnsOf("claim_evidence_documents");
    const protectedColumns = evidenceColumns.filter((c) => !LIFECYCLE_COLUMNS.includes(c));
    assert.ok(["status", "scan_status", "identity_status", "processing_error", "processing_error_code", "processing_attempts", "file_hash", "storage_key",
      "superseded_at", "supersedes_id", "account_id", "family_member_id", "claim_session_id"].every((c) => protectedColumns.includes(c)), "fixture: the audited columns exist");

    await testAsync("1a. a household session cannot write any protected evidence-document column (every column, from the live catalogue)", async () => {
      assert.equal(await visible(ownerA, `SELECT 1 FROM claim_evidence_documents WHERE id=$1`, [doc]), 1, "control: the household can read its own row");
      for (const column of protectedColumns) {
        await denied(ownerA, `UPDATE claim_evidence_documents SET ${column}=${column} WHERE id=$1`, [doc], `household UPDATE of ${column}`);
      }
      const forged: [string, string][] = [
        ["status", "'matched'"], ["scan_status", "'clean'"], ["identity_status", "'confirmed'"], ["processing_error", "NULL"],
        ["processing_error_code", "NULL"], ["processing_attempts", "0"], ["file_hash", "'sha256:forged'"], ["storage_key", "'other/key.pdf'"],
        ["superseded_at", "now()"], ["supersedes_id", "NULL"], ["account_id", `'${householdB}'`], ["claim_session_id", `'${claim}'`],
      ];
      for (const [column, value] of forged) await denied(ownerA, `UPDATE claim_evidence_documents SET ${column}=${value} WHERE id=$1`, [doc], `forged ${column}`);
      await denied(ownerA, `INSERT INTO claim_evidence_documents(account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash,status,scan_status)
        VALUES($1,$2,$3,'police_report','x.pdf','k','application/pdf',1,'sha256:x','matched','clean')`, [householdA, member, claim], "household INSERT");
      await denied(ownerA, `DELETE FROM claim_evidence_documents WHERE id=$1`, [doc], "household DELETE");
      assert.deepEqual(await row("claim_evidence_documents", doc), docBefore, "the row is untouched");
    });

    await testAsync("1b. lifecycle: a household session may only move an active document to pending_deletion, one version at a time", async () => {
      await denied(ownerA, `UPDATE claim_evidence_documents SET updated_at=now() WHERE id=$1`, [doc], "touching updated_at alone");
      await denied(ownerA, `UPDATE claim_evidence_documents SET lifecycle_state='soft_deleted', lifecycle_version=lifecycle_version+1 WHERE id=$1`, [doc], "skipping to soft_deleted");
      await denied(ownerA, `UPDATE claim_evidence_documents SET lifecycle_state='pending_deletion' WHERE id=$1`, [doc], "without a version bump");
      await denied(ownerA, `UPDATE claim_evidence_documents SET lifecycle_state='pending_deletion', lifecycle_version=lifecycle_version+5 WHERE id=$1`, [doc], "with a forged version");
      assert.equal(await affected(ownerA, `UPDATE claim_evidence_documents SET lifecycle_state='pending_deletion', lifecycle_version=lifecycle_version+1, updated_at=now() WHERE id=$1`, [doc]), 1,
        "control: the deletion route's own transition is accepted (rolled back here)");
    });

    await testAsync("1c. extractions, the evidence audit log, model provenance, decisions and the scan ledger are read-only or invisible to a household session", async () => {
      assert.equal(await visible(ownerA, `SELECT 1 FROM claim_evidence_extractions WHERE id=$1`, [extractionId]), 1, "control: the household can read its extraction");
      for (const column of await columnsOf("claim_evidence_extractions")) {
        await denied(ownerA, `UPDATE claim_evidence_extractions SET ${column}=${column} WHERE id=$1`, [extractionId], `extraction UPDATE of ${column}`);
      }
      await denied(ownerA, `UPDATE claim_evidence_extractions SET model_execution='{"modelExecutionId":"forged"}'::jsonb, extracted_fields='{}'::jsonb WHERE id=$1`, [extractionId], "forged provenance");
      await denied(ownerA, `INSERT INTO claim_evidence_extractions(account_id,evidence_document_id,source_document_version,extracted_fields,extraction_model,extraction_provider,extraction_version)
        VALUES($1,$2,'sha256:x','{}'::jsonb,'m','p','v')`, [householdA, doc], "household INSERT of an extraction");
      await denied(ownerA, `DELETE FROM claim_evidence_extractions WHERE id=$1`, [extractionId], "household DELETE of an extraction");
      await denied(ownerA, `INSERT INTO claim_evidence_audit_log(account_id,actor,action,evidence_document_id) VALUES($1,'reviewer:someone','cause_definition_match_recorded',$2)`, [householdA, doc], "forged audit entry");
      await denied(ownerA, `UPDATE claim_evidence_audit_log SET actor='x' WHERE account_id=$1`, [householdA], "rewriting audit history");
      await denied(ownerA, `DELETE FROM claim_evidence_audit_log WHERE account_id=$1`, [householdA], "deleting audit history");
      assert.ok(await visible(ownerA, `SELECT 1 FROM claim_evidence_audit_log WHERE account_id=$1`, [householdA]) > 0, "control: the household still reads its audit trail");
      await denied(ownerA, `SELECT 1 FROM model_executions`, [], "model provenance is not readable");
      await denied(ownerA, `INSERT INTO scan_provider_events(provider,event_id) VALUES('virustotal','evt-real-1')`, [], "pre-burning a scan callback event id");
      await denied(ownerA, `SELECT 1 FROM scan_provider_events`, [], "the scan ledger is not readable");
      await denied(ownerA, `INSERT INTO claim_cause_definition_matches(account_id,family_member_id,claim_session_id,contract_id,evidence_document_id,cause_evidence,definition_evidence,result,reviewed_by)
        VALUES($1,$2,$3,$4,$5,'{}'::jsonb,'{}'::jsonb,'matches','household')`, [householdA, member, claim, policyId, doc], "a household-written decision");
    });

    const assignment = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: householdA, claimSessionId: claim, expiresInHours: 24, operator: "ops.lead" })).assignmentId;

    await testAsync("6. a forged status cannot unlock a calculator or the reviewer workflow", async () => {
      const statusesBefore = await h.householdStatuses(householdA, ownerA, member, claim);
      assert.equal((await item())?.calculatedAmount, undefined, "baseline: no reviewed decision, no amount");
      for (const sql of [
        `UPDATE claim_evidence_documents SET status='matched', scan_status='clean', identity_status='confirmed' WHERE id=$1`,
        `UPDATE claim_evidence_extractions SET reviewed_fields=extracted_fields, reviewed_by='reviewer:forged', reviewed_at=now() WHERE evidence_document_id=$1`,
      ]) await denied(ownerA, sql, [doc], sql);
      await denied(ownerA, `INSERT INTO claim_cause_definition_matches(account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,cause_evidence,definition_evidence,result,reviewed_by,evidence_provenance)
        SELECT $1,$2,$3,$4,$5,$6,'{}'::jsonb,'{}'::jsonb,'matches','reviewer:forged',e.model_execution FROM claim_evidence_extractions e WHERE e.evidence_document_id=$6`,
        [householdA, member, claim, policyId, coverageId, doc], "forged decision with copied provenance");
      assert.deepEqual(await row("claim_evidence_documents", doc), docBefore);
      assert.deepEqual(await row("claim_evidence_extractions", extractionId), extractionBefore);
      assert.equal((await item())?.calculatedAmount, undefined, "still no amount");
      assert.deepEqual(await h.householdStatuses(householdA, ownerA, member, claim), statusesBefore, "the household review status is unchanged");
      assert.equal((await pool.query(`SELECT 1 FROM claim_cause_definition_matches WHERE evidence_document_id=$1`, [doc])).rows.length, 0, "no decision exists");
    });

    await testAsync("3. a reviewer browser session cannot write processing or provenance fields, and sees no household evidence directly", async () => {
      assert.equal(await visible(reviewer, `SELECT 1 FROM claim_evidence_documents WHERE id=$1`, [doc]), 0);
      assert.equal(await visible(reviewer, `SELECT 1 FROM claim_evidence_extractions WHERE id=$1`, [extractionId]), 0);
      for (const column of protectedColumns) await denied(reviewer, `UPDATE claim_evidence_documents SET ${column}=${column} WHERE id=$1`, [doc], `reviewer UPDATE of ${column}`);
      for (const column of ["model_execution", "extracted_fields", "reviewed_fields", "reviewed_by", "source_document_version"]) {
        await denied(reviewer, `UPDATE claim_evidence_extractions SET ${column}=${column} WHERE id=$1`, [extractionId], `reviewer UPDATE of extraction ${column}`);
      }
      assert.equal(await affected(reviewer, `UPDATE claim_evidence_documents SET lifecycle_state='pending_deletion', lifecycle_version=lifecycle_version+1 WHERE id=$1`, [doc]), 0, "the lifecycle grant does not reach another household's row");
      await denied(reviewer, `INSERT INTO claim_evidence_audit_log(account_id,actor,action,evidence_document_id) VALUES($1,'reviewer:x','cause_definition_match_recorded',$2)`, [householdA, doc], "reviewer audit forgery");
      assert.deepEqual(await row("claim_evidence_documents", doc), docBefore);
    });

    // The reviewer's decision goes through the real reviewer route on the
    // trusted connection: that is the only way an amount unlocks.
    await testAsync("4a. the reviewer decision path (service connection) still writes decisions and unlocks the amount", async () => {
      const res = await h.decide(f.route, reviewer, doc, { assignmentId: assignment, contractId: policyId, coverageId, result: "matches", reason: "Checked against the wording.", ...f.decisionScope });
      assert.equal(res.status, 200, await res.clone().text());
      const now = await item();
      assert.equal(now?.status, "potentially_applicable", JSON.stringify(now));
      assert.equal(now?.calculatedAmount, f.expectedAmount);
    });

    await testAsync("2. another household cannot read or change anything of this household's evidence", async () => {
      for (const [table, id] of [["claim_evidence_documents", doc], ["claim_evidence_extractions", extractionId]] as const) {
        assert.equal(await visible(ownerB, `SELECT 1 FROM ${table} WHERE id=$1`, [id]), 0, `${table} is invisible`);
      }
      assert.equal(await visible(ownerB, `SELECT 1 FROM claim_evidence_audit_log WHERE account_id=$1`, [householdA]), 0);
      assert.equal(await visible(ownerB, `SELECT 1 FROM claim_cause_definition_matches WHERE account_id=$1`, [householdA]), 0);
      assert.equal(await affected(ownerB, `UPDATE claim_evidence_documents SET lifecycle_state='pending_deletion', lifecycle_version=lifecycle_version+1 WHERE id=$1`, [doc]), 0);
      assert.equal(await affected(ownerB, `UPDATE claim_cause_definition_matches SET superseded_at=now(), superseded_reason='x' WHERE evidence_document_id=$1`, [doc]), 0);
      for (const column of protectedColumns) await denied(ownerB, `UPDATE claim_evidence_documents SET ${column}=${column} WHERE id=$1`, [doc], `other household UPDATE of ${column}`);
      await denied(ownerB, `DELETE FROM claim_evidence_documents WHERE id=$1`, [doc], "other household DELETE");
      await denied(ownerB, `DELETE FROM claim_evidence_extractions WHERE id=$1`, [extractionId], "other household extraction DELETE");
      assert.equal((await item())?.calculatedAmount, f.expectedAmount, "nothing changed");
    });

    // A household may not retire the live decision directly either (the
    // existing guard), while its evidence is still active.
    await testAsync("1d. a household session cannot retire a live decision whose evidence is still active", async () => {
      await denied(ownerA, `UPDATE claim_cause_definition_matches SET superseded_at=now(), superseded_reason='evidence_deleted' WHERE evidence_document_id=$1`, [doc], "retiring a live decision");
      await denied(ownerA, `UPDATE claim_cause_definition_matches SET result='matches', evidence_provenance=evidence_provenance WHERE evidence_document_id=$1`, [doc], "rewriting a decision");
    });

    // --- Trusted service / worker operations -------------------------------
    const { transitionEvidenceStatus, incrementProcessingAttempts, supersedeEvidenceDocument } = await import("@/lib/claims/evidence/store");
    const { recordCallbackEventOnce } = await import("@/lib/scanning/callback-auth");
    const { POST: postUpload } = await import("@/app/api/claims/evidence/upload/route");
    let seq = 0;
    async function uploadOnly(documentType: string, memberId = member, claimId = claim) {
      seq++;
      asUser(ownerA);
      const form = new FormData();
      form.set("file", new File([new Uint8Array(Buffer.from(`%PDF-1.4\n%browser-write-${seq}\n%%EOF\n`, "latin1"))], `upload-${seq}.pdf`, { type: "application/pdf" }));
      form.set("familyMemberId", memberId); form.set("claimSessionId", claimId); form.set("documentType", documentType);
      const res = await postUpload(new NextRequest("http://localhost/api/claims/evidence/upload", { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}` }, body: form }));
      assert.equal(res.status, 202, await res.clone().text());
      return (await res.json()).documentId as string;
    }

    await testAsync("4b. service/worker paths still work: scan callbacks, quarantine, processing, retries, failure metadata and supersession", async () => {
      assert.equal(await recordCallbackEventOnce("virustotal", "evt-real-1"), true, "the genuine scan callback event is recorded");
      assert.equal(await recordCallbackEventOnce("virustotal", "evt-real-1"), false, "a replay is detected");
      const infected = await uploadOnly("police_report");
      assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: infected, from: "uploaded", to: "quarantined", scanStatus: "infected" }), "quarantine with an infected scan result");
      assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: infected, from: "quarantined", to: "rejected", errorCode: "SCAN_INFECTED", errorMessage: "infected" }));
      await denied(ownerA, `UPDATE claim_evidence_documents SET scan_status='clean', status='processing' WHERE id=$1`, [infected], "the household cannot release a quarantined file");
      const retried = await uploadOnly("police_report");
      assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: retried, from: "uploaded", to: "quarantined", scanStatus: "clean" }));
      assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: retried, from: "quarantined", to: "processing" }));
      assert.equal(await incrementProcessingAttempts(householdA, retried), 1);
      assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: retried, from: "processing", to: "failed", errorCode: "PROVIDER_TIMEOUT", errorMessage: "timeout" }));
      assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: retried, from: "failed", to: "processing" }), "retry");
      assert.equal(await incrementProcessingAttempts(householdA, retried), 2);
      await denied(ownerA, `UPDATE claim_evidence_documents SET processing_attempts=0, processing_error_code=NULL WHERE id=$1`, [retried], "the household cannot reset retry/failure metadata");
      await supersedeEvidenceDocument({ accountId: householdA, oldId: infected, newId: retried, reason: "corrected upload" });
      assert.ok((await row("claim_evidence_documents", infected)).superseded_at, "supersession written by the server");
      await denied(ownerA, `UPDATE claim_evidence_documents SET superseded_at=NULL WHERE id=$1`, [infected], "the household cannot revive a superseded document");
      assert.ok((await row("claim_evidence_extractions", extractionId)).model_execution, "provenance persisted by the extraction path");
    });

    await testAsync("5a. the household bill-correction workflow still works (real route, server-written review)", async () => {
      const patient = await h.createMember(householdA, fixedUuid("d9300000", 2), "Jordan Rivera");
      const billClaim = await h.createClaim(householdA, patient, fixedUuid("e9300000", 2), "hospitalisation");
      const bill = await h.uploadEvidence({ accountId: householdA, ownerUserId: ownerA, memberId: patient, claimId: billClaim, documentType: "hospital_bill", payload: BILL_PAYLOAD, pages: BILL_PAGES });
      await denied(ownerA, `UPDATE claim_evidence_documents SET status='matched' WHERE id=$1`, [bill], "a household cannot mark its own bill reviewed directly");
      const { POST: postBillReview } = await import("@/app/api/claims/evidence/[id]/medical-bill-review/route");
      asUser(ownerA);
      const res = await postBillReview(new NextRequest(`http://localhost/api/claims/evidence/${bill}/medical-bill-review`, {
        method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}`, "content-type": "application/json" },
        body: JSON.stringify({ familyMemberId: patient, claimSessionId: billClaim, confirmTranscription: true,
          reviewedFields: { ...Object.fromEntries(["patientName", "hospitalName", "hospitalCountry", "admissionDate", "dischargeDate", "admissionType", "wardType"].map((k) => [k, (BILL_PAYLOAD as Record<string, unknown>)[k]])),
            billLineItems: [{ category: "Surgical fees", description: "Appendectomy", amountText: "1,300.00", currency: "SGD" }], thirdPartyPayments: BILL_PAYLOAD.thirdPartyPayments } }),
      }), { params: Promise.resolve({ id: bill }) });
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal((await row("claim_evidence_documents", bill)).status, "matched");
      const extraction = (await pool.query<{ reviewed_fields: { billLineItems: { amountText: string }[] }; reviewed_by: string }>(`SELECT reviewed_fields, reviewed_by FROM claim_evidence_extractions WHERE evidence_document_id=$1`, [bill])).rows[0];
      assert.equal(extraction.reviewed_fields.billLineItems[0].amountText, "1,300.00");
      assert.equal(extraction.reviewed_by, `household-user:${ownerA}`);
    });

    await testAsync("5b. the household deletion route still works under real RLS, retires the decision and removes the amount; the household cannot revive it", async () => {
      // The route opens its own RLS-scoped transaction (createUserSupabaseClient):
      // statements on that client run as `authenticated`; the coordinator's
      // bookkeeping and audit writes use the service pool, as in production.
      const harnessConnect = pool.connect;
      let armed = true;
      pool.connect = (async () => {
        if (!armed) return (harnessConnect as unknown as () => Promise<unknown>)();
        armed = false;
        let userRole = false;
        const run = async (text: string, params: unknown[] = []) => {
          if (params.length === 0) {
            const results = await db.exec(text); const last = results[results.length - 1];
            return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
          }
          const result = await db.query(text, params);
          return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
        };
        return {
          query: async (text: string, params: unknown[] = []) => {
            const sql = text.trim();
            if (/^SET LOCAL ROLE authenticated$/i.test(sql)) { userRole = true; return { rows: [], rowCount: 0 }; }
            if (!userRole || /^(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return run(text, params);
            await db.query("SET ROLE authenticated");
            try { return await run(text, params); } finally { await db.query("RESET ROLE"); }
          },
          release: () => {},
        };
      }) as typeof pool.connect;
      try {
        const { DELETE: deleteEvidence } = await import("@/app/api/claims/evidence/[id]/route");
        asUser(ownerA);
        const res = await deleteEvidence(new NextRequest(`http://localhost/api/claims/evidence/${doc}?familyMemberId=${member}&claimSessionId=${claim}`, {
          method: "DELETE", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}` },
        }), { params: Promise.resolve({ id: doc }) });
        assert.equal(res.status, 200, await res.clone().text());
        assert.equal(armed, false, "the route really used an RLS-scoped connection");
      } finally { pool.connect = harnessConnect; }
      const after = await row("claim_evidence_documents", doc);
      assert.equal(after.lifecycle_state, "pending_deletion");
      for (const column of protectedColumns) assert.deepEqual(after[column], docBefore[column], `deletion changed only lifecycle columns (${column})`);
      const decision = (await pool.query<{ superseded_reason: string | null }>(`SELECT superseded_reason FROM claim_cause_definition_matches WHERE evidence_document_id=$1`, [doc])).rows[0];
      assert.equal(decision.superseded_reason, "evidence_deleted");
      assert.equal((await pool.query(`SELECT 1 FROM claim_evidence_audit_log WHERE evidence_document_id=$1 AND action='deleted'`, [doc])).rows.length, 1, "the server wrote the audit entry");
      assert.equal((await item())?.calculatedAmount, undefined, "the amount is gone with its evidence");
      await denied(ownerA, `UPDATE claim_evidence_documents SET lifecycle_state='active', lifecycle_version=lifecycle_version+1 WHERE id=$1`, [doc], "reviving deleted evidence");
      await denied(ownerA, `UPDATE claim_cause_definition_matches SET superseded_at=NULL, superseded_reason=NULL WHERE evidence_document_id=$1`, [doc], "reviving a retired decision");
    });
  } finally {
    await h.close();
  }
  console.log(`DearPolicy evidence browser-write regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

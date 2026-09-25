/**
 * Claim-evidence document-type contract regressions.
 *
 * lib/claims/evidence/types.ts's CLAIM_EVIDENCE_DOCUMENT_TYPES is what the
 * upload route validates against, what the extraction schema enumerates,
 * and what extraction routing branches on. The database's
 * claim_evidence_documents_document_type_check (sql/critical-illness.sql)
 * must accept exactly that set -- previously it silently lacked every
 * medical-CLAIM type (hospital_bill, itemised_bill, receipt_payment_proof,
 * ...), so a validated upload of a real hospital bill failed at INSERT.
 *
 * Three layers:
 *  1. Static contract: the SQL CHECK list equals the TypeScript constant.
 *  2. Database: the constraint as actually installed by the production
 *     ensure-schema path accepts every canonical type and rejects free text.
 *  3. The real POST /api/claims/evidence/upload route against PGlite, for
 *     every canonical type, reading the persisted row back -- plus unknown
 *     type rejection before insertion, cross-household rejection, the
 *     malware-scan gate still applying, and medical-bill extraction routing.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";
import {
  CLAIM_EVIDENCE_DOCUMENT_TYPES, CAUSE_OF_DEATH_DOCUMENT_TYPES, MEDICAL_CLAIM_DOCUMENT_TYPES, MEDICAL_EVIDENCE_DOCUMENT_TYPES,
  type ClaimEvidenceDocumentType,
} from "@/lib/claims/evidence/types";

const SQL_FILES = [
  "sql/schema.sql",
  "sql/claim-evidence.sql",
  "sql/household-rls.sql",
  "sql/background-jobs.sql",
  "sql/lifecycle.sql",
  "sql/model-provenance.sql",
];

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

/** The document_type values the SQL migration that finally defines the
 * constraint actually lists. */
async function sqlConstraintTypes(): Promise<string[]> {
  const sql = await readFile(path.resolve("sql/critical-illness.sql"), "utf8");
  const matches = [...sql.matchAll(/ADD CONSTRAINT claim_evidence_documents_document_type_check\s+CHECK \(document_type IN \(([\s\S]*?)\)\);/g)];
  assert.equal(matches.length, 1, "sql/critical-illness.sql must define claim_evidence_documents_document_type_check exactly once");
  return [...matches[0][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

function asUser(userId: string) {
  process.env.DEV_AUTH_ENABLED = "1";
  process.env.DEV_ACCOUNT_ID = userId;
}

function uploadRequest(household: string, form: FormData) {
  return new NextRequest("http://localhost/api/claims/evidence/upload", {
    method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${household}` }, body: form,
  });
}

function pdfForm(label: string, fields: Record<string, string>) {
  // Unique bytes per upload: documents are deduplicated per claim by content hash.
  const bytes = new Uint8Array(Buffer.from(`%PDF-1.4\n%${label}\n%%EOF\n`, "latin1"));
  const form = new FormData();
  form.set("file", new File([bytes], `${label}.pdf`, { type: "application/pdf" }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
}

async function main() {
  // --- 1. Static contract ------------------------------------------------
  await testAsync("the SQL CHECK constraint lists exactly the canonical application document types", async () => {
    const sqlTypes = await sqlConstraintTypes();
    assert.equal(new Set(sqlTypes).size, sqlTypes.length, "no duplicate entries in the SQL constraint");
    assert.equal(new Set(CLAIM_EVIDENCE_DOCUMENT_TYPES).size, CLAIM_EVIDENCE_DOCUMENT_TYPES.length, "no duplicate entries in the TypeScript constant");
    assert.deepEqual([...sqlTypes].sort(), [...CLAIM_EVIDENCE_DOCUMENT_TYPES].sort());
    for (const type of MEDICAL_CLAIM_DOCUMENT_TYPES) assert.ok(sqlTypes.includes(type), `${type} must be accepted by the database`);
  });

  setTelemetryAdapter(new NoopTelemetryAdapter());
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) await db.exec(await readFile(path.resolve(file), "utf8"));
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
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
  process.env.MALWARE_SCANNER_PROVIDER = "test-document-type-infected";

  try {
    const { __registerFileScanAdapterForTests } = await import("@/lib/scanning/adapter");
    __registerFileScanAdapterForTests({ name: "test-document-type-infected", async scanFile() { return { status: "infected" as const }; } });

    // The production path: createEvidenceDocument() applies
    // ensureCriticalIllnessSchema(), which (re)installs the constraint.
    const { ensureCriticalIllnessSchema } = await import("@/lib/claims/evidence/ci-schema");
    await ensureCriticalIllnessSchema();
    await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));
    // Re-running the migration must be safe (idempotent).
    await db.exec(await readFile(path.resolve("sql/critical-illness.sql"), "utf8"));

    const { POST: postEvidenceUpload } = await import("@/app/api/claims/evidence/upload/route");
    const { POST: postFamily } = await import("@/app/api/family/route");
    const { createClaimSession } = await import("@/lib/claims/session");
    const { processClaimEvidence } = await import("@/lib/claims/evidence/pipeline");
    const { extractClaimEvidence } = await import("@/lib/claims/evidence/extract");

    const ownerA = "e1000000-0000-4000-8000-000000000001";
    const ownerB = "e1000000-0000-4000-8000-000000000002";
    const householdA = (await pool.query<{ id: string }>(`INSERT INTO accounts(id, name) VALUES (gen_random_uuid(), 'Household A') RETURNING id`)).rows[0].id;
    const householdB = (await pool.query<{ id: string }>(`INSERT INTO accounts(id, name) VALUES (gen_random_uuid(), 'Household B') RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO household_members(household_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`, [householdA, ownerA, householdB, ownerB]);

    asUser(ownerA);
    const familyRes = await postFamily(new NextRequest("http://localhost/api/family", {
      method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}`, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Jordan Rivera", relationship: "self" }),
    }));
    assert.equal(familyRes.status, 201);
    const memberA = (await familyRes.json()).member.id as string;
    const claimA = (await createClaimSession(householdA, memberA)).id;

    const documentCount = async () => Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM claim_evidence_documents`)).rows[0].n);

    // --- 2. Database constraint as installed ------------------------------
    await testAsync("the installed constraint accepts every canonical type and rejects free text", async () => {
      for (const [index, type] of CLAIM_EVIDENCE_DOCUMENT_TYPES.entries()) {
        await pool.query(
          `INSERT INTO claim_evidence_documents(account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash)
           VALUES($1,$2,$3,$4,'direct.pdf','k-direct','application/pdf',1,$5)`,
          [householdA, memberA, claimA, type, `direct-${index}`],
        );
      }
      await assert.rejects(
        () => pool.query(
          `INSERT INTO claim_evidence_documents(account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash)
           VALUES($1,$2,$3,'brochure','direct.pdf','k-direct','application/pdf',1,'direct-free-text')`,
          [householdA, memberA, claimA],
        ),
        /claim_evidence_documents_document_type_check|check constraint/i,
      );
      await pool.query(`DELETE FROM claim_evidence_documents WHERE storage_key='k-direct'`);
    });

    // --- 3. The real upload route -----------------------------------------
    const uploaded = new Map<ClaimEvidenceDocumentType, string>();
    await testAsync("every canonical document type uploads through the real route and persists that exact document_type, pending scan", async () => {
      for (const type of CLAIM_EVIDENCE_DOCUMENT_TYPES) {
        const res = await postEvidenceUpload(uploadRequest(householdA, pdfForm(`upload-${type}`, { familyMemberId: memberA, claimSessionId: claimA, documentType: type })));
        assert.equal(res.status, 202, `${type} upload must be accepted (got ${res.status}: ${await res.clone().text()})`);
        const { documentId } = await res.json();
        const row = (await pool.query<{ document_type: string; status: string; scan_status: string; account_id: string; family_member_id: string; claim_session_id: string }>(
          `SELECT document_type, status, scan_status, account_id::text, family_member_id::text, claim_session_id::text FROM claim_evidence_documents WHERE id=$1`, [documentId])).rows[0];
        assert.ok(row, `${type}: the evidence row must exist`);
        assert.equal(row.document_type, type);
        assert.equal(row.status, "uploaded", `${type}: a new upload starts in the normal pre-scan state`);
        assert.equal(row.scan_status, "pending_scan", `${type}: a new upload has not bypassed malware scanning`);
        assert.equal(row.account_id, householdA);
        assert.equal(row.family_member_id, memberA);
        assert.equal(row.claim_session_id, claimA);
        const job = await pool.query<{ status: string }>(`SELECT status FROM background_jobs WHERE job_type='claim_evidence_processing' AND idempotency_key=$1`, [documentId]);
        assert.equal(job.rows.length, 1, `${type}: processing must be durably enqueued`);
        uploaded.set(type, documentId);
      }
      for (const type of [...MEDICAL_CLAIM_DOCUMENT_TYPES, ...CAUSE_OF_DEATH_DOCUMENT_TYPES, ...MEDICAL_EVIDENCE_DOCUMENT_TYPES]) assert.ok(uploaded.has(type));
    });

    await testAsync("an unknown document type is rejected before any row is inserted", async () => {
      const before = await documentCount();
      const res = await postEvidenceUpload(uploadRequest(householdA, pdfForm("upload-unknown", { familyMemberId: memberA, claimSessionId: claimA, documentType: "brochure" })));
      assert.equal(res.status, 400);
      assert.equal((await res.json()).reasonCode, "UNSUPPORTED_DOCUMENT_TYPE");
      assert.equal(await documentCount(), before);
    });

    await testAsync("a different household cannot upload a hospital bill into this household's claim", async () => {
      const before = await documentCount();
      asUser(ownerB);
      try {
        const res = await postEvidenceUpload(uploadRequest(householdB, pdfForm("upload-cross-household", { familyMemberId: memberA, claimSessionId: claimA, documentType: "hospital_bill" })));
        assert.equal(res.status, 404);
        // Naming household A while signed in as household B's owner is refused outright.
        const forged = await postEvidenceUpload(uploadRequest(householdA, pdfForm("upload-cross-household-2", { familyMemberId: memberA, claimSessionId: claimA, documentType: "hospital_bill" })));
        assert.ok(forged.status === 403 || forged.status === 404, `forged household cookie must be refused (got ${forged.status})`);
      } finally {
        asUser(ownerA);
      }
      assert.equal(await documentCount(), before);
    });

    await testAsync("an uploaded hospital bill still goes through the malware-scan gate in the real pipeline", async () => {
      const documentId = uploaded.get("hospital_bill")!;
      await processClaimEvidence({ accountId: householdA, documentId });
      const row = (await pool.query<{ status: string; scan_status: string; processing_error_code: string | null }>(
        `SELECT status, scan_status, processing_error_code FROM claim_evidence_documents WHERE id=$1`, [documentId])).rows[0];
      assert.equal(row.status, "rejected");
      assert.equal(row.scan_status, "infected");
      assert.equal(row.processing_error_code, "MALWARE_DETECTED");
    });

    await testAsync("medical-claim document types are routed to the medical-bill extraction prompt; cause-of-death is not", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key-not-real";
      process.env.READING_MODEL = "anthropic:claude-haiku-4-5";
      const seenSystems: string[] = [];
      global.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { system?: { text?: string }[] };
        seenSystems.push(body.system?.[0]?.text ?? "");
        return new Response(JSON.stringify({
          id: "msg_doc_type", model: "claude-haiku-4-5-20250620",
          content: [{ type: "text", text: JSON.stringify({ deceasedName: null, otherNamesMentioned: [], personIdentifiers: [], dateOfDeath: null, statedCauseOfDeath: null, mannerOfDeath: null, issuingAuthority: null, documentReference: null, documentType: null, pageCitations: [], confidence: {} }) }],
          stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      const pages = [{ pageNumber: 1, text: "Itemised hospital bill. Surgical fees 1,250.00" }];
      for (const type of MEDICAL_CLAIM_DOCUMENT_TYPES) {
        await extractClaimEvidence({ pages, documentType: type });
        const system = seenSystems.at(-1) ?? "";
        assert.ok(system.includes("MEDICAL-CLAIM document"), `${type} must use the medical-bill extraction prompt`);
      }
      await extractClaimEvidence({ pages, documentType: "police_report" });
      const deathSystem = seenSystems.at(-1) ?? "";
      assert.ok(deathSystem.includes("cause-of-death document") && !deathSystem.includes("MEDICAL-CLAIM document"));
    });
  } finally {
    global.fetch = originalFetch;
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.close();
  }
  console.log(`DearPolicy claim-evidence document-type contract regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

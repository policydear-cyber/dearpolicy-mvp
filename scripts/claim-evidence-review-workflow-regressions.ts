/**
 * Claim-evidence review-workflow regressions (real route handlers, PGlite).
 *
 * Separates the two kinds of review on the claim page:
 *  - FACT confirmation of a medical bill (POST .../medical-bill-review): a
 *    household member may confirm/correct what is printed, with the
 *    reviewer identity derived server-side, only bill-fact fields
 *    accepted, every amount validated exactly as printed, full ownership
 *    scoping, and append-only history. Money still only flows through the
 *    existing provenance and deterministic parsing gates.
 *  - POLICY-DEFINITION decisions (match / ci-match / disability-match /
 *    travel-match): no household request may record one, because a
 *    "matches" record is what unlocks a calculator and DearPolicy has no
 *    authorized-reviewer role.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";
import { BILL_REVIEW_NOTICE, billReviewDraftFrom, buildBillReviewRequest } from "@/lib/claims/evidence/bill-review";
import { POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE } from "@/lib/claims/evidence/document-catalogue";

const SQL_FILES = ["sql/schema.sql", "sql/claim-evidence.sql", "sql/household-rls.sql", "sql/background-jobs.sql", "sql/lifecycle.sql", "sql/model-provenance.sql"];
const PROMISE_LANGUAGE = /\b(approv\w*|guarantee\w*|will be paid|you will receive|payout|entitled to)\b/i;

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void> | void) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}
function asUser(userId: string) { process.env.DEV_AUTH_ENABLED = "1"; process.env.DEV_ACCOUNT_ID = userId; }
function jsonRequest(url: string, household: string, body: unknown) {
  return new NextRequest(url, { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${household}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}
function getRequest(url: string, household: string) {
  return new NextRequest(url, { method: "GET", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${household}` } });
}
function assertOnlyStringsOrNull(value: unknown, at = "reviewedFields") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  assert.notEqual(typeof value, "number", `${at} must never be a number computed in the browser`);
  if (Array.isArray(value)) { value.forEach((v, i) => assertOnlyStringsOrNull(v, `${at}.${i}`)); return; }
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) assertOnlyStringsOrNull(v, `${at}.${k}`);
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

async function main() {
  // --- Client request building (the page uses exactly these helpers) -----
  await testAsync("the bill-review request keeps printed amounts as text, never numbers, and requires explicit confirmation", () => {
    const draft = billReviewDraftFrom(BILL_PAYLOAD, { billLineItems: [{ category: "Surgical fees", description: null, amountText: "1,300.00", currency: "SGD" }] });
    assert.equal(draft.billLineItems[0].amountText, "1,300.00", "reviewed corrections win over the model's proposal");
    assert.equal(draft.thirdPartyPayments[0].amountText, "200.00");
    const refused = buildBillReviewRequest({ draft, familyMemberId: "m", claimSessionId: "c", confirmed: false });
    assert.equal(refused.ok, false);
    const built = buildBillReviewRequest({ draft, familyMemberId: "m", claimSessionId: "c", confirmed: true });
    assert.ok(built.ok);
    if (!built.ok) return;
    assert.equal(built.body.confirmTranscription, true);
    assertOnlyStringsOrNull(built.body.reviewedFields);
    assert.equal((built.body.reviewedFields.billLineItems as { amountText: string }[])[0].amountText, "1,300.00");
    assert.ok(!("reviewedBy" in built.body) && !("reviewerName" in built.body), "the client never names the reviewer");
  });

  await testAsync("the claim page states review is not a claim decision, keeps definition matching pending, and does no money arithmetic", async () => {
    const page = await readFile(path.resolve("app/claims/[id]/page.tsx"), "utf8");
    const helper = await readFile(path.resolve("lib/claims/evidence/bill-review.ts"), "utf8");
    assert.match(BILL_REVIEW_NOTICE, /not a decision on your claim/);
    assert.match(page, /BILL_REVIEW_NOTICE/);
    assert.match(page, /POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE/);
    assert.equal(POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE, "Evidence received — policy-definition review required.");
    assert.ok(!/\/(ci-|disability-|travel-)?match`/.test(page), "the page must not call any policy-definition match route");
    assert.ok(!/handleMatch/.test(page));
    for (const source of [page, helper]) {
      assert.ok(!/parseFloat|parseInt|Number\(|parseAmountMinor|amountMinor|\.reduce\(/.test(source), "no amount parsing or summing in the browser");
      assert.ok(!PROMISE_LANGUAGE.test(source), "no approval or payout-promise wording");
    }
    assert.ok(!PROMISE_LANGUAGE.test(BILL_REVIEW_NOTICE + POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE));
  });

  // --- Real routes against PGlite -----------------------------------------
  setTelemetryAdapter(new NoopTelemetryAdapter());
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) await db.exec(await readFile(path.resolve(file), "utf8"));
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous; return release; };
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
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.READING_MODEL = "anthropic:claude-haiku-4-5";

  try {
    const { ensureCriticalIllnessSchema } = await import("@/lib/claims/evidence/ci-schema");
    const { ensureDisabilitySchema } = await import("@/lib/claims/evidence/disability-schema");
    await ensureCriticalIllnessSchema();
    await ensureDisabilitySchema();
    await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));

    const { POST: postUpload } = await import("@/app/api/claims/evidence/upload/route");
    const { POST: postFamily } = await import("@/app/api/family/route");
    const { POST: postBillReview } = await import("@/app/api/claims/evidence/[id]/medical-bill-review/route");
    const { POST: postReject } = await import("@/app/api/claims/evidence/[id]/reject/route");
    const { GET: listEvidence } = await import("@/app/api/claims/evidence/route");
    const definitionRoutes = {
      match: (await import("@/app/api/claims/evidence/[id]/match/route")).POST,
      "ci-match": (await import("@/app/api/claims/evidence/[id]/ci-match/route")).POST,
      "disability-match": (await import("@/app/api/claims/evidence/[id]/disability-match/route")).POST,
      "travel-match": (await import("@/app/api/claims/evidence/[id]/travel-match/route")).POST,
    };
    const { createClaimSession } = await import("@/lib/claims/session");
    const { transitionEvidenceStatus, recordExtraction, getLatestExtraction } = await import("@/lib/claims/evidence/store");
    const { extractClaimEvidence } = await import("@/lib/claims/evidence/extract");
    const { loadVerifiedMedicalBillFacts } = await import("@/lib/claims/evidence/medical-bill-evidence");
    const { evaluateAggregateEvidenceAuthority } = await import("@/lib/claims/evidence-authority");

    const ownerA = "e2000000-0000-4000-8000-000000000001";
    const ownerB = "e2000000-0000-4000-8000-000000000002";
    const householdA = (await pool.query<{ id: string }>(`INSERT INTO accounts(id, name) VALUES (gen_random_uuid(), 'Household A') RETURNING id`)).rows[0].id;
    const householdB = (await pool.query<{ id: string }>(`INSERT INTO accounts(id, name) VALUES (gen_random_uuid(), 'Household B') RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO household_members(household_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`, [householdA, ownerA, householdB, ownerB]);
    asUser(ownerA);
    const addMember = async (displayName: string, relationship: string) => {
      const res = await postFamily(jsonRequest("http://localhost/api/family", householdA, { displayName, relationship }));
      assert.equal(res.status, 201);
      return (await res.json()).member.id as string;
    };
    const memberA = await addMember("Jordan Rivera", "self");
    const memberA2 = await addMember("Casey Rivera", "spouse");
    const claimA = (await createClaimSession(householdA, memberA)).id;
    const claimA2 = (await createClaimSession(householdA, memberA)).id;
    const claimOther = (await createClaimSession(householdA, memberA2)).id;

    let seq = 0;
    async function uploadedDocument(documentType: string, claimSessionId = claimA) {
      seq++;
      const form = new FormData();
      form.set("file", new File([new Uint8Array(Buffer.from(`%PDF-1.4\n%review-${seq}\n%%EOF\n`, "latin1"))], `bill-${seq}.pdf`, { type: "application/pdf" }));
      form.set("familyMemberId", memberA); form.set("claimSessionId", claimSessionId); form.set("documentType", documentType);
      const res = await postUpload(new NextRequest("http://localhost/api/claims/evidence/upload", { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}` }, body: form }));
      assert.equal(res.status, 202);
      return (await res.json()).documentId as string;
    }
    async function toProcessing(id: string) {
      await transitionEvidenceStatus({ accountId: householdA, id, from: "uploaded", to: "quarantined", scanStatus: "clean" });
      await transitionEvidenceStatus({ accountId: householdA, id, from: "quarantined", to: "processing" });
    }
    async function extractInto(id: string, withProvenance: boolean) {
      const hash = (await pool.query<{ file_hash: string }>(`SELECT file_hash FROM claim_evidence_documents WHERE id=$1`, [id])).rows[0].file_hash;
      global.fetch = (async () => new Response(JSON.stringify({
        id: `msg_${id}`, model: "claude-haiku-4-5-20250620",
        content: [{ type: "text", text: JSON.stringify(BILL_PAYLOAD) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
      const extraction = await extractClaimEvidence({ pages: BILL_PAGES, documentType: "hospital_bill", documentId: id });
      await recordExtraction({
        accountId: householdA, evidenceDocumentId: id, sourceDocumentVersion: hash, extractedFields: extraction.fields,
        extractionModel: extraction.model, extractionProvider: extraction.provider, extractionVersion: extraction.version, identityConflicts: [],
        modelExecution: withProvenance ? extraction.execution : null,
      });
      await transitionEvidenceStatus({ accountId: householdA, id, from: "processing", to: "extracted", identityStatus: "confirmed" });
      await transitionEvidenceStatus({ accountId: householdA, id, from: "extracted", to: "needs_review" });
    }
    const review = (id: string, body: Record<string, unknown>, household = householdA) =>
      postBillReview(jsonRequest(`http://localhost/api/claims/evidence/${id}/medical-bill-review`, household, body), { params: Promise.resolve({ id }) });
    const statusOf = async (id: string) => (await pool.query<{ status: string }>(`SELECT status FROM claim_evidence_documents WHERE id=$1`, [id])).rows[0].status;
    const corrected = (amountText: string) => ({
      ...Object.fromEntries(["patientName", "hospitalName", "hospitalCountry", "admissionDate", "dischargeDate", "admissionType", "wardType"].map((k) => [k, (BILL_PAYLOAD as Record<string, unknown>)[k]])),
      billLineItems: [{ category: "Surgical fees", description: "Appendectomy", amountText, currency: "SGD" }],
      thirdPartyPayments: BILL_PAYLOAD.thirdPartyPayments,
    });

    const bill = await uploadedDocument("hospital_bill");

    await testAsync("a bill cannot be reviewed, and contributes nothing, while scanning or processing is incomplete", async () => {
      const r1 = await review(bill, { familyMemberId: memberA, claimSessionId: claimA, confirmTranscription: true });
      assert.equal(r1.status, 409);
      assert.equal((await r1.json()).reasonCode, "EVIDENCE_NOT_READY");
      await toProcessing(bill);
      const r2 = await review(bill, { familyMemberId: memberA, claimSessionId: claimA, confirmTranscription: true });
      assert.equal(r2.status, 409);
      assert.equal((await loadVerifiedMedicalBillFacts(householdA, memberA, claimA)).sourceDocumentIds.includes(bill), false);
    });

    await extractInto(bill, true);
    const executionBefore = (await getLatestExtraction(householdA, bill))!.model_execution;

    await testAsync("review requires explicit confirmation", async () => {
      const res = await review(bill, { familyMemberId: memberA, claimSessionId: claimA, reviewedFields: corrected("1,300.00") });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).reasonCode, "CONFIRMATION_REQUIRED");
      assert.equal(await statusOf(bill), "needs_review");
    });

    await testAsync("invalid or out-of-scope corrections are rejected field by field and nothing is saved", async () => {
      const res = await review(bill, {
        familyMemberId: memberA, claimSessionId: claimA, confirmTranscription: true,
        reviewedFields: { ...corrected("about a thousand"), admissionDate: "01/09/2026", deceasedName: "Someone", pageCitations: [] },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.reasonCode, "INVALID_REVIEWED_FIELDS");
      for (const key of ["billLineItems.0.amountText", "admissionDate", "deceasedName", "pageCitations"]) assert.ok(body.fieldErrors[key], `expected a field error for ${key}`);
      assert.equal((await getLatestExtraction(householdA, bill))!.reviewed_fields, null);
      assert.equal(await statusOf(bill), "needs_review");
    });

    await testAsync("a household member can correct and confirm bill facts; the reviewer is derived server-side and cannot be forged", async () => {
      const res = await review(bill, {
        familyMemberId: memberA, claimSessionId: claimA, confirmTranscription: true, reviewedFields: corrected("1,300.00"),
        reviewerName: "Insurer claims adjuster", reviewedBy: "Insurer claims adjuster",
      });
      assert.equal(res.status, 200, await res.clone().text());
      const extraction = (await getLatestExtraction(householdA, bill))!;
      assert.equal(extraction.reviewed_by, `household-user:${ownerA}`);
      assert.equal(extraction.reviewed_fields?.billLineItems?.[0].amountText, "1,300.00", "the corrected amount is stored exactly as typed");
      assert.deepEqual(extraction.model_execution, executionBefore, "a fact correction never rewrites the extraction's model provenance");
      assert.equal(await statusOf(bill), "matched");
      const audit = await pool.query<{ actor: string }>(`SELECT actor FROM claim_evidence_audit_log WHERE evidence_document_id=$1 AND action='medical_bill_review_confirmed'`, [bill]);
      assert.deepEqual(audit.rows.map((r) => r.actor), [`household-user:${ownerA}`]);
    });

    await testAsync("corrected facts persist and reload, and only the server parses the amount", async () => {
      const res = await listEvidence(getRequest(`http://localhost/api/claims/evidence?familyMemberId=${memberA}&claimSessionId=${claimA}`, householdA));
      const doc = (await res.json()).documents.find((d: { id: string }) => d.id === bill);
      assert.equal(doc.extraction.reviewed_fields.billLineItems[0].amountText, "1,300.00");
      const facts = await loadVerifiedMedicalBillFacts(householdA, memberA, claimA);
      assert.deepEqual(facts.sourceDocumentIds, [bill]);
      assert.equal(facts.lineItems[0].amountMinor, 130_000);
      assert.equal(facts.thirdPartyPayments[0].amountMinor, 20_000);
      assert.deepEqual(evaluateAggregateEvidenceAuthority(facts.provenance), { authorized: true }, "verified provenance survives the review");
    });

    await testAsync("a later review supersedes the earlier one visibly in the append-only history", async () => {
      const res = await review(bill, { familyMemberId: memberA, claimSessionId: claimA, confirmTranscription: true, reviewedFields: corrected("1,350.00") });
      assert.equal(res.status, 200);
      const audit = await pool.query<{ previous_value: { reviewedFields?: { billLineItems?: { amountText: string }[] } }; new_value: { reviewedFields?: { billLineItems?: { amountText: string }[] } } }>(
        `SELECT previous_value, new_value FROM claim_evidence_audit_log WHERE evidence_document_id=$1 AND action='medical_bill_review_confirmed' ORDER BY id`, [bill]);
      assert.equal(audit.rows.length, 2);
      assert.equal(audit.rows[0].new_value.reviewedFields?.billLineItems?.[0].amountText, "1,300.00");
      assert.equal(audit.rows[1].previous_value.reviewedFields?.billLineItems?.[0].amountText, "1,300.00");
      assert.equal(audit.rows[1].new_value.reviewedFields?.billLineItems?.[0].amountText, "1,350.00");
    });

    await testAsync("cross-household, cross-member and cross-claim reviews are refused and change nothing", async () => {
      const before = (await getLatestExtraction(householdA, bill))!.reviewed_fields;
      const body = { confirmTranscription: true, reviewedFields: corrected("9,999.00") };
      asUser(ownerB);
      try {
        const own = await review(bill, { ...body, familyMemberId: memberA, claimSessionId: claimA }, householdB);
        assert.equal(own.status, 409);
        assert.equal((await own.json()).reasonCode, "EVIDENCE_NOT_FOUND");
        // A household cookie naming a household the caller does not belong to
        // is ignored (lib/household/repo.ts's resolveActiveHouseholdId()
        // falls back to the caller's OWN household), so the document is
        // simply not found there.
        const forged = await review(bill, { ...body, familyMemberId: memberA, claimSessionId: claimA }, householdA);
        assert.equal(forged.status, 409, `forged household cookie must be refused (got ${forged.status})`);
        assert.equal((await forged.json()).reasonCode, "EVIDENCE_NOT_FOUND");
      } finally { asUser(ownerA); }
      for (const scope of [{ familyMemberId: memberA2, claimSessionId: claimOther }, { familyMemberId: memberA, claimSessionId: claimA2 }, { familyMemberId: memberA2, claimSessionId: claimA }]) {
        const res = await review(bill, { ...body, ...scope });
        assert.equal(res.status, 409, JSON.stringify(scope));
        assert.equal((await res.json()).reasonCode, "EVIDENCE_NOT_FOUND");
      }
      assert.deepEqual((await getLatestExtraction(householdA, bill))!.reviewed_fields, before);
    });

    await testAsync("a reviewed bill without verified extraction provenance stays blocked from any amount", async () => {
      const unverified = await uploadedDocument("itemised_bill", claimA2);
      await toProcessing(unverified);
      await extractInto(unverified, false);
      const res = await review(unverified, { familyMemberId: memberA, claimSessionId: claimA2, confirmTranscription: true });
      assert.equal(res.status, 200);
      const facts = await loadVerifiedMedicalBillFacts(householdA, memberA, claimA2);
      assert.deepEqual(facts.sourceDocumentIds, [unverified]);
      const authority = evaluateAggregateEvidenceAuthority(facts.provenance);
      assert.equal(authority.authorized, false);
      if (!authority.authorized) assert.equal(authority.reasonCode, "EVIDENCE_PROVENANCE_MISSING");
    });

    await testAsync("rejecting a document records the server-derived actor, not a client-supplied name", async () => {
      const doc = await uploadedDocument("receipt_payment_proof");
      const res = await postReject(jsonRequest(`http://localhost/api/claims/evidence/${doc}/reject`, householdA, { familyMemberId: memberA, claimSessionId: claimA, reviewerName: "Insurer claims adjuster" }), { params: Promise.resolve({ id: doc }) });
      assert.equal(res.status, 200);
      const audit = await pool.query<{ actor: string }>(`SELECT actor FROM claim_evidence_audit_log WHERE evidence_document_id=$1 AND action='rejected'`, [doc]);
      assert.deepEqual(audit.rows.map((r) => r.actor), [`household-user:${ownerA}`]);
    });

    await testAsync("no household request can record a policy-definition decision on any of the four match routes", async () => {
      const medical = await uploadedDocument("medical_report");
      const matchRows = async () => {
        let total = 0;
        for (const table of ["claim_cause_definition_matches", "claim_ci_definition_matches", "claim_disability_definition_matches"]) {
          total += Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0].n);
        }
        return total;
      };
      const before = await matchRows();
      for (const [name, handler] of Object.entries(definitionRoutes)) {
        for (const result of ["matches", "does_not_match", "needs_review", "needs_policy_review"]) {
          const body = {
            familyMemberId: memberA, claimSessionId: claimA, contractId: randomUUID(), coverageId: randomUUID(),
            benefitCode: name === "disability-match" ? "tpd-lump-sum" : "ci-major", illnessName: "Major Cancer", matchKey: "total_permanent_disability",
            result, reviewerName: "Insurer claims adjuster",
            medicalEvidence: { pageStart: 1, pageEnd: 1 }, causeEvidence: { pageStart: 1, pageEnd: 1 },
          };
          const res = await handler(jsonRequest(`http://localhost/api/claims/evidence/${medical}/${name}`, householdA, body), { params: Promise.resolve({ id: medical }) });
          assert.equal(res.status, 403, `${name} ${result}`);
          const json = await res.json();
          assert.equal(json.reasonCode, "POLICY_DEFINITION_REVIEW_REQUIRED");
          assert.equal(json.error, POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE);
        }
        asUser(ownerB);
        try {
          const cross = await handler(jsonRequest(`http://localhost/api/claims/evidence/${medical}/${name}`, householdA, { result: "matches" }), { params: Promise.resolve({ id: medical }) });
          assert.ok(cross.status === 403 || cross.status === 404, `${name}: another household is refused before anything else`);
        } finally { asUser(ownerA); }
      }
      assert.equal(await matchRows(), before, "no match row was written by any household request");
    });
  } finally {
    global.fetch = originalFetch;
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.close();
  }
  console.log(`DearPolicy claim-evidence review-workflow regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

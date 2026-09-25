/**
 * Checkpoint 14g, Stage 4/9: claim-evidence upload -> real quarantine gate
 * -> real durable-job processing (via the real, separately-invoked
 * worker pass, same reasoning as stage 2) -> real claim-pack
 * (review/calculation) read path, through real routes. Reuses
 * scripts/full-household-e2e-regressions.ts's own step-4 logic.
 */
import assert from "node:assert/strict";
import { runStage, asUser, requestFor, pdfFormData, waitFor, runWorkerOnce, readHandoff, requireHandoff, writeHandoff } from "@/scripts/e2e/shared";

runStage("04-evidence-review-calculation", async ({ pool, step }) => {
  const handoff = await readHandoff();
  requireHandoff(handoff, ["ownerId", "householdId", "selfMemberId", "claimSessionId"]);
  const ownerId = String(handoff.ownerId);
  const householdId = String(handoff.householdId);
  const selfMemberId = String(handoff.selfMemberId);
  const claimSessionId = String(handoff.claimSessionId);

  asUser(ownerId);

  const { GET: getClaimSessionRoute } = await import("@/app/api/claims/[id]/route");
  const { POST: postEvidenceUpload } = await import("@/app/api/claims/evidence/upload/route");
  const { GET: getEvidence } = await import("@/app/api/claims/evidence/[id]/route");
  const { GET: getClaimPack } = await import("@/app/api/claims/[id]/pack/route");

  await step("validates stage 3's real output: the claim session it created is still readable through the real GET /api/claims/[id] route", async () => {
    const res = await getClaimSessionRoute(requestFor(`http://localhost/api/claims/${claimSessionId}`, { household: householdId }), { params: Promise.resolve({ id: claimSessionId }) } as any);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).claim.id, claimSessionId);
  });

  process.env.MALWARE_SCANNER_PROVIDER = "test-e2e-infected";
  const { __registerFileScanAdapterForTests } = await import("@/lib/scanning/adapter");
  __registerFileScanAdapterForTests({ name: "test-e2e-infected", async scanFile() { return { status: "infected" as const }; } });

  let evidenceDocumentId = "";
  await step("POST /api/claims/evidence/upload accepts a valid PDF and queues it (202)", async () => {
    const res = await postEvidenceUpload(
      requestFor("http://localhost/api/claims/evidence/upload", {
        household: householdId,
        method: "POST",
        form: pdfFormData("evidence.pdf", { familyMemberId: selfMemberId, claimSessionId, documentType: "police_report" }),
      }),
    );
    assert.equal(res.status, 202);
    const body = await res.json();
    evidenceDocumentId = body.documentId;
    assert.ok(evidenceDocumentId);
  });

  await step("a real, separately-invoked worker pass claims and runs the queued claim_evidence_processing job (same Checkpoint 14f topology as stage 2)", async () => {
    const outcome = await runWorkerOnce("claim_evidence_processing");
    assert.equal(outcome, "succeeded");
  });

  await step("the queued evidence document is scanned and rejected through the real pipeline, and its durable job completes (not stuck 'uploaded' forever)", async () => {
    const row = await waitFor(async () => {
      const res = await getEvidence(requestFor(`http://localhost/api/claims/evidence/${evidenceDocumentId}?familyMemberId=${selfMemberId}&claimSessionId=${claimSessionId}`, { household: householdId }), { params: Promise.resolve({ id: evidenceDocumentId }) } as any);
      const body = await res.json();
      return body.document && (body.document.status === "rejected" || body.document.status === "quarantined") ? body.document : undefined;
    });
    assert.equal(row.status, "rejected");
    assert.equal(row.processing_error_code, "MALWARE_DETECTED");
    const jobRow = await pool.query<{ status: string }>(`SELECT status FROM background_jobs WHERE job_type='claim_evidence_processing' AND idempotency_key=$1`, [evidenceDocumentId]);
    assert.equal(jobRow.rows[0]?.status, "succeeded");
  });

  await step("GET /api/claims/[id]/pack -- the real calculation/review read path -- still returns a real (if evidence-thin) response, not a crash", async () => {
    const res = await getClaimPack(requestFor(`http://localhost/api/claims/${claimSessionId}/pack`, { household: householdId }), { params: Promise.resolve({ id: claimSessionId }) } as any);
    assert.ok(res.status === 200 || res.status === 404 || res.status === 409, `unexpected status ${res.status} generating a claim pack for a claim with only failed evidence`);
  });

  await writeHandoff({ evidenceDocumentId });
});

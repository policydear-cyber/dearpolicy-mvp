/**
 * Checkpoint 14g, Stage 6/9: evidence deletion and calculation/read-path
 * invalidation.
 *
 * Reuses scripts/claim-evidence-deletion-regressions.ts's own
 * coordinator-level pattern (lib/lifecycle/coordinator.ts's
 * requestClaimEvidenceDeletion/finishClaimEvidenceDeletion) -- there is
 * genuinely no DELETE route for a single claim-evidence document (that
 * file's own header documents this; reconfirmed here), so the
 * coordinator IS the real production call path, same as that dedicated
 * suite already proves.
 *
 * New here, beyond what the dedicated suite does on a throwaway fixture:
 * this runs against the REAL evidence document stage 4 uploaded through
 * the real route, seeds a real claim_cause_definition_matches row
 * against THIS journey's real policy/claim session/evidence (a genuine
 * downstream-calculation artifact), and checks invalidation on TWO real
 * read paths -- one the coordinator's own comment claims is migrated but
 * is not (a known, already-reported gap from Checkpoint 14d, recorded
 * honestly here rather than silently asserted away), and one it
 * genuinely does invalidate.
 */
import assert from "node:assert/strict";
import { runStage, asUser, requestFor, readHandoff, requireHandoff, writeHandoff, applyExtraSql } from "@/scripts/e2e/shared";

runStage("06-evidence-deletion-invalidation", async ({ pool, step }) => {
  const handoff = await readHandoff();
  requireHandoff(handoff, ["ownerId", "householdId", "selfMemberId", "claimSessionId", "evidenceDocumentId", "exportId", "policyId"]);
  const ownerId = String(handoff.ownerId);
  const householdId = String(handoff.householdId);
  const selfMemberId = String(handoff.selfMemberId);
  const claimSessionId = String(handoff.claimSessionId);
  const evidenceDocumentId = String(handoff.evidenceDocumentId);
  const exportId = String(handoff.exportId);
  const policyId = String(handoff.policyId);

  asUser(ownerId);

  const { GET: getExports } = await import("@/app/api/household/export/route");
  const { GET: getEvidence } = await import("@/app/api/claims/evidence/[id]/route");
  const { GET: getClaimPack } = await import("@/app/api/claims/[id]/pack/route");
  const { getLifecycleState } = await import("@/lib/lifecycle/state-machine");
  const { finishClaimEvidenceDeletion, requestClaimEvidenceDeletion } = await import("@/lib/lifecycle/coordinator");
  const { loadActiveCauseDefinitionMatches } = await import("@/lib/claims/evidence/store");

  await step("validates stage 5's real output: the export request it created is still listed through the real route", async () => {
    const res = await getExports(requestFor("http://localhost/api/household/export", { household: householdId }));
    const body = await res.json();
    assert.ok(body.exports.some((e: { id: string }) => e.id === exportId));
  });

  await step("the evidence document is really readable, really rejected, BEFORE deletion (baseline)", async () => {
    const res = await getEvidence(requestFor(`http://localhost/api/claims/evidence/${evidenceDocumentId}?familyMemberId=${selfMemberId}&claimSessionId=${claimSessionId}`, { household: householdId }), { params: Promise.resolve({ id: evidenceDocumentId }) } as any);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).document.status, "rejected");
  });

  await applyExtraSql(["sql/critical-illness.sql", "sql/disability.sql"]);

  await step("seeds a real claim_cause_definition_matches row against THIS journey's real policy, claim session and evidence document -- the exact kind of downstream-calculation artifact requestClaimEvidenceDeletion()'s own invalidateClaimMatchesReferencing() step exists to supersede -- and confirms it is active BEFORE deletion", async () => {
    await pool.query(
      `INSERT INTO claim_cause_definition_matches(account_id,family_member_id,claim_session_id,contract_id,evidence_document_id,cause_evidence,definition_evidence,result,reviewed_by)
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,'{}'::jsonb,'matches','e2e-reviewer')`,
      [householdId, selfMemberId, claimSessionId, policyId, evidenceDocumentId],
    );
    const active = await loadActiveCauseDefinitionMatches(householdId, selfMemberId, claimSessionId);
    assert.ok(active.some((m) => m.evidence_document_id === evidenceDocumentId), "the seeded match must be active before deletion, or the invalidation check below proves nothing");
  });

  const fakeScopedClient = { query: (async (text: string, params: unknown[] = []) => pool.query(text, params)) };

  let deletionRequestId = "";
  await step("requestClaimEvidenceDeletion() (the real, only production path -- no DELETE route exists for a single evidence document) moves the REAL evidence document stage 4 uploaded to pending_deletion", async () => {
    const outcome = await requestClaimEvidenceDeletion({
      client: fakeScopedClient as any,
      accountId: householdId,
      actorUserId: ownerId,
      evidenceDocumentId,
      reasonCategory: "user_requested",
      idempotencyKey: `e2e-evidence-delete-${evidenceDocumentId}`,
    });
    assert.equal(outcome.status, "accepted");
    deletionRequestId = outcome.deletionRequestId;
    const state = await getLifecycleState(pool, { resourceType: "claim_evidence", resourceId: evidenceDocumentId, accountId: householdId });
    assert.equal(state?.lifecycle_state, "pending_deletion");
  });

  await step("finishClaimEvidenceDeletion() completes the deletion bookkeeping -- it transitions the deletion_requests row, not the document's own lifecycle_state again (matching scripts/claim-evidence-deletion-regressions.ts's own documented, real, two-track behaviour: pending_deletion already fully excludes it from every active read via activePredicate(), so nothing is left un-revoked)", async () => {
    await finishClaimEvidenceDeletion({ accountId: householdId, actorUserId: ownerId, evidenceDocumentId, deletionRequestId });
    const state = await getLifecycleState(pool, { resourceType: "claim_evidence", resourceId: evidenceDocumentId, accountId: householdId });
    assert.equal(state?.lifecycle_state, "pending_deletion");
  });

  await step("INVALIDATION (known, already-reported gap -- Checkpoint 14d, scripts/claim-evidence-deletion-regressions.ts's own header comment): the real GET /api/claims/evidence/[id] route does NOT filter lifecycle_state (lib/claims/evidence/store.ts's getScopedEvidenceDocument() has no such filter) -- it still returns 200 for a pending_deletion document. Recorded honestly as the CURRENT real behaviour, not silently asserted away or skipped", async () => {
    const res = await getEvidence(requestFor(`http://localhost/api/claims/evidence/${evidenceDocumentId}?familyMemberId=${selfMemberId}&claimSessionId=${claimSessionId}`, { household: householdId }), { params: Promise.resolve({ id: evidenceDocumentId }) } as any);
    assert.equal(res.status, 200, "if this ever starts returning 404, the Checkpoint 14d gap has been fixed -- update this assertion and its comment, do not just relax it");
  });

  await step("INVALIDATION (the read path the coordinator DOES correctly invalidate, per Checkpoint 14d's own established finding): the real claim_cause_definition_matches row seeded above -- the actual downstream calculation input a claim assessment reads via loadActiveCauseDefinitionMatches() -- is now superseded and excluded", async () => {
    const active = await loadActiveCauseDefinitionMatches(householdId, selfMemberId, claimSessionId);
    assert.ok(!active.some((m) => m.evidence_document_id === evidenceDocumentId), "a cause-definition match citing a deleted evidence document must be excluded from the real active-matches read path a claim calculation actually consumes");
    const row = await pool.query<{ superseded_at: string | null; superseded_reason: string | null }>(`SELECT superseded_at, superseded_reason FROM claim_cause_definition_matches WHERE evidence_document_id=$1`, [evidenceDocumentId]);
    assert.ok(row.rows[0]?.superseded_at, "the match must be really superseded in the database, not just filtered client-side");
    assert.equal(row.rows[0]?.superseded_reason, "evidence_deleted");
  });

  await step("the real GET /api/claims/[id]/pack calculation/review path still runs cleanly (not a crash) after the deletion above", async () => {
    const res = await getClaimPack(requestFor(`http://localhost/api/claims/${claimSessionId}/pack`, { household: householdId }), { params: Promise.resolve({ id: claimSessionId }) } as any);
    assert.ok(res.status === 200 || res.status === 404 || res.status === 409, `unexpected status ${res.status} generating a claim pack after its only evidence document was deleted`);
  });

  await writeHandoff({ evidenceDeleted: true });
});

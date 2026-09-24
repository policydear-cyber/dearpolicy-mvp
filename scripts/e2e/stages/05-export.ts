/**
 * Checkpoint 14g, Stage 5/9: household export -> download, through the
 * real routes. Reuses scripts/full-household-e2e-regressions.ts's own
 * step-5 logic.
 */
import assert from "node:assert/strict";
import { runStage, asUser, requestFor, readHandoff, requireHandoff, writeHandoff } from "@/scripts/e2e/shared";

runStage("05-export", async ({ step }) => {
  const handoff = await readHandoff();
  requireHandoff(handoff, ["ownerId", "householdId", "evidenceDocumentId"]);
  const ownerId = String(handoff.ownerId);
  const householdId = String(handoff.householdId);
  const evidenceDocumentId = String(handoff.evidenceDocumentId);

  asUser(ownerId);

  const { GET: getEvidence } = await import("@/app/api/claims/evidence/[id]/route");
  const { POST: postExport, GET: getExports } = await import("@/app/api/household/export/route");
  const { GET: downloadExport } = await import("@/app/api/household/export/[id]/download/route");

  await step("validates stage 4's real output: the rejected evidence document is still readable, still rejected, through the real route", async () => {
    const res = await getEvidence(requestFor(`http://localhost/api/claims/evidence/${evidenceDocumentId}?familyMemberId=${handoff.selfMemberId}&claimSessionId=${handoff.claimSessionId}`, { household: householdId }), { params: Promise.resolve({ id: evidenceDocumentId }) } as any);
    const body = await res.json();
    assert.equal(body.document.status, "rejected");
  });

  let exportId = "";
  await step("POST /api/household/export (owner-only, recent-auth-gated) generates a real export synchronously", async () => {
    const request = requestFor("http://localhost/api/household/export", { household: householdId, method: "POST", body: {} });
    request.headers.set("Idempotency-Key", "e2e-export-1");
    const res = await postExport(request);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ready");
    exportId = body.id;
    assert.ok(exportId);
  });

  await step("GET /api/household/export lists the export request", async () => {
    const res = await getExports(requestFor("http://localhost/api/household/export", { household: householdId }));
    const body = await res.json();
    assert.equal(body.exports.length, 1);
    assert.equal(body.exports[0].id, exportId);
  });

  await step("GET /api/household/export/[id]/download returns the real snapshot content, including the family members created in stage 1", async () => {
    const res = await downloadExport(requestFor(`http://localhost/api/household/export/${exportId}/download`, { household: householdId }), { params: Promise.resolve({ id: exportId }) } as any);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("Jordan Rivera"), "the export must contain the real household data created earlier in this journey, not a stub");
    assert.ok(text.includes("Casey Rivera"));
  });

  await writeHandoff({ exportId });
});

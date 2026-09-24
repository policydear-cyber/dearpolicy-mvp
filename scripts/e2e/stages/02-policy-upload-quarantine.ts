/**
 * Checkpoint 14g, Stage 2/9: policy upload -> real quarantine gate ->
 * real durable-job processing, through the real route -- reusing
 * scripts/full-household-e2e-regressions.ts's own step 3 logic, adapted
 * to run against the SAME persisted fixture stage 1 left behind instead
 * of seeding a fresh household.
 */
import assert from "node:assert/strict";
import { runStage, asUser, requestFor, pdfFormData, waitFor, runWorkerOnce, readHandoff, requireHandoff, writeHandoff } from "@/scripts/e2e/shared";

runStage("02-policy-upload-quarantine", async ({ pool, step }) => {
  const handoff = await readHandoff();
  requireHandoff(handoff, ["ownerId", "householdId", "selfMemberId", "householdName"]);
  const ownerId = String(handoff.ownerId);
  const householdId = String(handoff.householdId);
  const selfMemberId = String(handoff.selfMemberId);

  asUser(ownerId);

  const { GET: getHousehold } = await import("@/app/api/household/route");
  const { GET: getFamily } = await import("@/app/api/family/route");
  const { POST: postPolicyUpload } = await import("@/app/api/policies/upload/route");
  const { GET: listPolicies } = await import("@/app/api/policies/route");

  await step("validates stage 1's real output: the household and both family members it created are still there, through the real routes, before this stage does any new work", async () => {
    const res = await getHousehold(requestFor("http://localhost/api/household", { household: householdId }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.activeHouseholdId, householdId);
    const familyRes = await getFamily(requestFor("http://localhost/api/family", { household: householdId }));
    const familyBody = await familyRes.json();
    assert.equal(familyBody.family.length, 2, "both family members stage 1 created through real routes must still be there");
  });

  process.env.MALWARE_SCANNER_PROVIDER = "test-e2e-infected";
  const { __registerFileScanAdapterForTests } = await import("@/lib/scanning/adapter");
  __registerFileScanAdapterForTests({ name: "test-e2e-infected", async scanFile() { return { status: "infected" as const }; } });

  let policyId = "";
  await step("POST /api/policies/upload accepts a valid PDF and queues it (202)", async () => {
    const res = await postPolicyUpload(requestFor("http://localhost/api/policies/upload", { household: householdId, method: "POST", form: pdfFormData("policy.pdf", { familyMemberId: selfMemberId }) }));
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.status, "queued");
    policyId = body.policyId;
    assert.ok(policyId);
  });

  await step("a real, separately-invoked worker pass (lib/jobs/worker-runtime.ts's claimAndProcessOne(), the exact primitive scripts/worker.ts's standalone poll loop calls) claims and runs the queued policy_processing job -- proving the REAL current producer/consumer topology (Checkpoint 14f), not the inline completion scripts/full-household-e2e-regressions.ts's own step 3 still (incorrectly) assumes", async () => {
    const outcome = await runWorkerOnce("policy_processing");
    assert.equal(outcome, "succeeded", "the worker's own claim-and-run pass must complete the job, not find it empty or fail it");
  });

  await step("the queued policy is scanned and quarantine-rejected through the real quarantine gate, and its durable job completes (not stuck 'queued' forever)", async () => {
    const row = await waitFor(async () => {
      const res = await listPolicies(requestFor("http://localhost/api/policies", { household: householdId }));
      const body = await res.json();
      const found = (body.policies as Array<{ id: string; quarantine_status: string }>).find((p) => p.id === policyId);
      return found && (found.quarantine_status === "scan_rejected" || found.quarantine_status === "scan_clean") ? found : undefined;
    });
    assert.equal(row.quarantine_status, "scan_rejected", "the infected scan result must reach the real quarantine_status column through the real route");
    const jobRow = await pool.query<{ status: string }>(`SELECT status FROM background_jobs WHERE job_type='policy_processing' AND idempotency_key=$1`, [policyId]);
    assert.equal(jobRow.rows[0]?.status, "succeeded", "the durable job running the quarantine gate to its real (rejected) conclusion must complete, not hang or dead-letter");
  });

  await writeHandoff({ policyId });
});

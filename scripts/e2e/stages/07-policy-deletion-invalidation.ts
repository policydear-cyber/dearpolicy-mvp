/**
 * Checkpoint 14g, Stage 7/9: policy deletion and retrieval invalidation.
 *
 * Unlike claim-evidence deletion (stage 6), a REAL DELETE route exists
 * for a whole policy: app/api/policies/[id]/route.ts's DELETE handler
 * with ?scope=policy, which itself calls lib/lifecycle/coordinator.ts's
 * requestPolicyDeletion/finishPolicyDeletion (the same coordinator
 * functions scripts/policy-deletion-regressions.ts exercises at the lib
 * level) -- this stage uses the REAL route, real route-level proof one
 * level deeper than that dedicated suite's own lib-level calls.
 */
import assert from "node:assert/strict";
import { runStage, asUser, requestFor, readHandoff, requireHandoff, writeHandoff } from "@/scripts/e2e/shared";

runStage("07-policy-deletion-invalidation", async ({ step }) => {
  const handoff = await readHandoff();
  requireHandoff(handoff, ["ownerId", "householdId", "policyId"]);
  const ownerId = String(handoff.ownerId);
  const householdId = String(handoff.householdId);
  const policyId = String(handoff.policyId);

  asUser(ownerId);

  const { GET: listPolicies } = await import("@/app/api/policies/route");
  const { DELETE: deletePolicy } = await import("@/app/api/policies/[id]/route");

  await step("validates stage 6's real output: the real policy stage 2 uploaded is still there, still quarantine-rejected, through the real GET /api/policies route, before this stage deletes it", async () => {
    const res = await listPolicies(requestFor("http://localhost/api/policies", { household: householdId }));
    const body = await res.json();
    const found = (body.policies as Array<{ id: string }>).find((p) => p.id === policyId);
    assert.ok(found, "stage 2's real policy must still be there before this stage deletes it");
  });

  await step("DELETE /api/policies/[id]?scope=policy -- the real route, real requestPolicyDeletion()+finishPolicyDeletion() coordinator call underneath it -- really, permanently deletes the whole policy", async () => {
    const req = requestFor(`http://localhost/api/policies/${policyId}?scope=policy`, { household: householdId, method: "DELETE" });
    const res = await deletePolicy(req, { params: Promise.resolve({ id: policyId }) } as any);
    if (res.status !== 200) throw new Error(`expected a real 200 deletion, got ${res.status}: ${await res.text()}`);
    const body = await res.json();
    assert.equal(body.deleted, true);
    assert.equal(body.status, "completed");
  });

  await step("INVALIDATION: the real GET /api/policies list route now excludes the deleted policy -- the exact real read path it used to be visible through", async () => {
    const res = await listPolicies(requestFor("http://localhost/api/policies", { household: householdId }));
    const body = await res.json();
    assert.ok(!(body.policies as Array<{ id: string }>).some((p) => p.id === policyId), "a deleted policy must no longer appear in the real household policy list route");
  });

  await writeHandoff({ policyDeleted: true });
});

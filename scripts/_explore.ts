
import { asUser, fixedUuid, startReviewerHarness } from "./fixtures/reviewer-harness";
import { BENEFIT_FIXTURES } from "./fixtures/reviewer-benefit-wording";
async function main() {
  const h = await startReviewerHarness();
  try {
    let n = 0;
    const reviewer = fixedUuid("c9000000", 1);
    await h.admin.provisionClaimReviewer({ userId: reviewer, displayLabel: "R", operator: "ops.lead" });
    for (const f of BENEFIT_FIXTURES) {
      n++;
      const owner = fixedUuid("b9000000", n);
      const hh = await h.createHousehold(fixedUuid("a9000000", n), owner);
      const m = await h.createMember(hh, fixedUuid("d9000000", n), "Tan Yi Chuen Desmond");
      const c = await h.createClaim(hh, m, fixedUuid("e9000000", n), f.claimEventType);
      const p = await h.createPolicy({ accountId: hh, memberId: m, policyId: fixedUuid("f9000000", n), coverageId: fixedUuid("f8000000", n), ...f.policy });
      const doc = await h.uploadEvidence({ accountId: hh, ownerUserId: owner, memberId: m, claimId: c, documentType: f.evidence.documentType, payload: f.evidence.payload, pages: f.evidence.pages });
      const a = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: hh, claimSessionId: c, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
      const ws = await (await h.workspace(reviewer, a)).json();
      console.log(f.category, "defs", JSON.stringify(ws.definitions.map((d: any) => [d.route, d.benefitCode, d.illnessName, d.matchKey])), ws.definitionErrors);
      const res = await h.decide(f.route, reviewer, doc, { assignmentId: a, contractId: p.policyId, coverageId: p.coverageId, result: "matches", reason: "Matches.", ...f.decisionScope });
      console.log(f.category, "decide", res.status, (await res.text()).slice(0, 300));
      const out = await h.assess(hh, m, c, f.facts);
      console.log(f.category, JSON.stringify(out.assessments.map((i: any) => [i.id, i.status, i.calculatedAmount, i.currency, i.reason?.slice(0, 160), i.monetaryDecision?.status])));
      console.log(f.category, "included", JSON.stringify(out.included.map((b: any) => [b.benefitCode, b.amount ?? b.includedAmount])), JSON.stringify(out.composition.totalsByCurrency));
    }
  } finally { await h.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

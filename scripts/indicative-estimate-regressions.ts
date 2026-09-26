/**
 * The household's indicative estimate (lib/claims/indicative-assessment.ts,
 * GET /api/claims/[id]/indicative) and read-side invalidation of saved chat
 * answers after a policy is deleted (lib/chat/stale-answers.ts). Real DDL,
 * real routes, the real reviewer decision route and the real evidence-gated
 * engine on PGlite; synthetic households only. Every blocked case has a
 * positive control.
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";
import { INDICATIVE_ESTIMATE_NOTICE } from "@/lib/chat/monetary-boundary";
import { fixedUuid, startReviewerHarness, asUser } from "./fixtures/reviewer-harness";
import { BENEFIT_FIXTURES } from "./fixtures/reviewer-benefit-wording";

let cases = 0;
async function t(name: string, fn: () => Promise<void> | void) { try { await fn(); cases++; } catch (e) { throw new Error(name, { cause: e }); } }
const MONEY = /(?:S\$|US\$|SGD|USD)\s?\d/;
const ci = BENEFIT_FIXTURES.find((f) => f.category === "critical-illness")!;

async function main() {
  const h = await startReviewerHarness();
  const { computeIndicativeEstimate } = await import("@/lib/claims/indicative-assessment");
  const { GET: getIndicative } = await import("@/app/api/claims/[id]/indicative/route");
  const { invalidateAnswersWithDeletedPolicies, STALE_ANSWER_NOTICE, referencedPolicyIds } = await import("@/lib/chat/stale-answers");
  const reviewer = fixedUuid("c9000000", 1);
  try {
    await h.admin.provisionClaimReviewer({ userId: reviewer, displayLabel: "Reviewer", operator: "ops.lead" });
    let n = 0;
    async function world(covers: { currency: string; evidence?: string | null; amount: number }[]) {
      n++;
      const owner = fixedUuid("b9000000", n);
      const household = await h.createHousehold(fixedUuid("a9000000", n), owner, `SYNTHETIC-indicative-${n}`);
      const member = await h.createMember(household, fixedUuid("d9000000", n), "Tan Yi Chuen Desmond");
      const claim = await h.createClaim(household, member, fixedUuid("e9000000", n), "diagnosis");
      await pool.query(`UPDATE claim_sessions SET facts=$2::jsonb WHERE id=$1`, [claim, JSON.stringify(ci.facts)]);
      const policies: { policyId: string; coverageId: string }[] = [];
      for (const [i, c] of covers.entries()) {
        policies.push(await h.createPolicy({ accountId: household, memberId: member, policyId: fixedUuid("f9100000", n * 10 + i), coverageId: fixedUuid("f9200000", n * 10 + i),
          ...ci.policy, policyNumber: `SYN-${n}-${i}`, amount: c.amount, currency: c.currency, coverageEvidenceText: c.evidence }));
      }
      const document = await h.uploadEvidence({ accountId: household, ownerUserId: owner, memberId: member, claimId: claim, ...ci.evidence });
      const assignment = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: household, claimSessionId: claim, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
      const decide = async (i: number, result: string) => {
        const res = await h.decide("ci-match", reviewer, document, { assignmentId: assignment, contractId: policies[i].policyId, coverageId: policies[i].coverageId, result, reason: "Checked against the cited definition.", ...ci.decisionScope });
        assert.equal(res.status, 200, await res.clone().text());
      };
      return { household, owner, member, claim, policies, decide };
    }
    const viaRoute = async (household: string, owner: string, claim: string) => {
      asUser(owner);
      const res = await getIndicative(new NextRequest(`http://localhost/api/claims/${claim}/indicative`, { headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${household}` } }), { params: Promise.resolve({ id: claim }) });
      return { status: res.status, body: await res.json() };
    };

    await t("no reviewed decision: no estimate, nothing shown as money", async () => {
      const w = await world([{ currency: "SGD", amount: 200000 }]);
      const e = (await computeIndicativeEstimate(w.household, w.claim))!;
      assert.equal(e.hasEstimate, false);
      assert.equal(e.notice, INDICATIVE_ESTIMATE_NOTICE);
      assert.deepEqual(e.totalsByCurrency, []);
      assert.doesNotMatch(JSON.stringify(e.benefits), MONEY);
      assert.ok(e.benefits.every((b) => b.amountText === null));
    });

    await t("a negative reviewer decision never produces an amount; a later \"matches\" does (positive control), cited and in the verified currency", async () => {
      const w = await world([{ currency: "SGD", amount: 200000 }]);
      await w.decide(0, "does_not_match");
      const blocked = (await computeIndicativeEstimate(w.household, w.claim))!;
      assert.equal(blocked.hasEstimate, false);
      assert.doesNotMatch(JSON.stringify(blocked), MONEY);
      await w.decide(0, "matches");
      const e = (await viaRoute(w.household, w.owner, w.claim)).body.estimate;
      assert.equal(e.hasEstimate, true);
      const included = e.benefits.filter((b: { status: string }) => b.status === "included");
      assert.equal(included.length, 1);
      assert.equal(included[0].currency, "SGD");
      assert.match(included[0].amountText, /200,000/);
      assert.deepEqual(included[0].citations.map((c: { pageStart: number }) => c.pageStart), [4]);
      assert.deepEqual(e.totalsByCurrency.map((x: { currency: string }) => x.currency), ["SGD"]);
    });

    await t("two verified currencies stay in separate totals; a certificate that writes no currency never gets an amount, even when reviewed", async () => {
      const w = await world([
        { currency: "SGD", amount: 200000 },
        { currency: "USD", amount: 100000 },
        { currency: "SGD", amount: 50000, evidence: "Living Care sum insured: 50,000" },
      ]);
      for (const i of [0, 1, 2]) await w.decide(i, "matches");
      for (let run = 0; run < 3; run++) {
        const e = (await computeIndicativeEstimate(w.household, w.claim))!;
        const included = e.benefits.filter((b) => b.status === "included");
        assert.deepEqual(included.map((b) => b.currency).sort(), ["SGD", "USD"]);
        assert.deepEqual(e.totalsByCurrency.map((x) => x.currency).sort(), ["SGD", "USD"]);
        assert.ok(!e.totalsByCurrency.some((x) => /300,000|250,000|350,000/.test(x.amountText)), "never added across currencies");
        const unverified = e.benefits.filter((b) => b.status === "no_amount");
        assert.ok(unverified.length >= 1);
        assert.ok(unverified.every((b) => b.amountText === null && !/50,000/.test(b.reason)));
      }
    });

    await t("another household can never read the estimate (route 404; direct call null)", async () => {
      const w = await world([{ currency: "SGD", amount: 200000 }]);
      const other = await world([{ currency: "SGD", amount: 200000 }]);
      assert.equal(await computeIndicativeEstimate(other.household, w.claim), null);
      assert.equal((await viaRoute(other.household, other.owner, w.claim)).status, 404);
    });

    await t("a saved chat answer that cites a deleted policy is re-served only as an out-of-date notice; answers citing active policies are untouched", async () => {
      const w = await world([{ currency: "SGD", amount: 200000 }, { currency: "SGD", amount: 100000 }]);
      const [keep, remove] = w.policies.map((p) => p.policyId);
      const answer = (policyId: string) => ({ mode: "answer", summary: "A waiting period of 90 days applies.", details: ["90 days"], claimItems: [], nextSteps: [], questions: [], missingFacts: [],
        citations: [{ chunkId: `page:${policyId}:5`, policyId, policyName: "Living Care", pageStart: 5, pageEnd: 5 }] });
      const none = { mode: "answer", summary: "General answer.", details: [], claimItems: [], nextSteps: [], questions: [], missingFacts: [], citations: [] };
      const before = await invalidateAnswersWithDeletedPolicies(w.household, [answer(keep), answer(remove), none] as never[]);
      assert.equal((before[1] as { invalidated?: unknown }).invalidated, undefined, "control: both policies active");
      await pool.query(`UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1`, [remove]);
      const after = await invalidateAnswersWithDeletedPolicies(w.household, [answer(keep), answer(remove), none] as never[]) as { summary: string; citations: unknown[]; invalidated?: unknown; details: string[] }[];
      assert.equal(after[0].invalidated, undefined);
      assert.deepEqual(after[1].invalidated, { reason: "policy_deleted" });
      assert.equal(after[1].summary, STALE_ANSWER_NOTICE);
      assert.deepEqual([after[1].citations, after[1].details], [[], []]);
      assert.equal(after[2].invalidated, undefined, "an answer citing no policy is left alone");
      const foreign = await invalidateAnswersWithDeletedPolicies(fixedUuid("a9000000", 99), [answer(keep)] as never[]) as { invalidated?: unknown }[];
      assert.ok(foreign[0].invalidated, "a policy that is not this household's is never treated as current cover");
      assert.deepEqual(referencedPolicyIds({ citations: [{ policyId: "not-a-uuid" }] } as never), []);
    });
  } finally {
    await h.close();
  }
  console.log(`indicative-estimate and stale-answer regressions passed: ${cases} cases`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

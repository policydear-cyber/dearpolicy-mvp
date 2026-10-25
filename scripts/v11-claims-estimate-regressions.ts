/**
 * V1.1 eval "before", journey hard check: after the reviewer recorded
 * decisions the claim page showed an indicative estimate, but the chat's
 * final answer in the same claim conversation fell back to "preliminary
 * claim assessment" and asked for a specialist report again.
 *
 * Real chat route, real upload / reviewer decision routes and the real
 * evidence-gated engine on PGlite (scripts/fixtures/reviewer-harness.ts),
 * with the deterministic model stand-in for the chat; synthetic household
 * only. The chat reports a diagnosis (which records the claim event), the
 * claim's documents are reviewed, and the chat is asked again:
 *
 *  - before any reviewer decision: no estimate, nothing shown as money
 *    (negative control);
 *  - after: the chat's answer IS the engine's indicative estimate -- the
 *    same per-currency totals as GET /api/claims/[id]/indicative and the
 *    Claims list ("Indicative estimate ready"), labelled indicative, SGD and
 *    USD never added together, no "preliminary", no question re-asked.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "v11claimsestimate";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
delete process.env.PINECONE_API_KEY;

let cases = 0;
async function t(name: string, fn: () => Promise<void>) { try { await fn(); cases++; console.log("PASS " + name); } catch (e) { console.log("FAIL " + name); throw e; } }
const MONEY = /(?:S\$|US\$|\bSGD\s?|\bUSD\s?|\$)\s?\d/i;

async function main() {
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 165 s"); process.exit(3); }, 165_000);
  const { fixedUuid, startReviewerHarness, asUser } = await import("./fixtures/reviewer-harness");
  const { BENEFIT_FIXTURES } = await import("./fixtures/reviewer-benefit-wording");
  const { pool } = await import("@/lib/db/client");
  const { ACTIVE_HOUSEHOLD_COOKIE } = await import("@/lib/auth/request-context");
  const { INDICATIVE_ESTIMATE_NOTICE } = await import("@/lib/chat/monetary-boundary");
  const ci = BENEFIT_FIXTURES.find((f) => f.category === "critical-illness")!;
  const h = await startReviewerHarness();
  // The chat's own tables, as the claim-conversation suite applies them.
  for (const file of ["sql/benefit-catalog.sql", "sql/model-usage.sql", "sql/coverage-ledger.sql", "sql/cover-conditions.sql", "sql/claim-composition.sql", "sql/chat-upgrade.sql"]) {
    try { await h.db.exec(await readFile(path.resolve(file), "utf8")); } catch (e) { console.log("SQL note: " + file + " not applied (" + (e as Error).message.slice(0, 90) + ")"); }
  }
  await h.db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
  const { POST: chat } = await import("@/app/api/chat/route");
  const { GET: listClaims } = await import("@/app/api/claims/route");
  const { GET: getIndicative } = await import("@/app/api/claims/[id]/indicative/route");
  const { computeIndicativeEstimate } = await import("@/lib/claims/indicative-assessment");
  try {
    const reviewer = fixedUuid("c9100000", 1);
    await h.admin.provisionClaimReviewer({ userId: reviewer, displayLabel: "Reviewer", operator: "ops.lead" });
    const owner = fixedUuid("b9100000", 1);
    const household = await h.createHousehold(fixedUuid("a9100000", 1), owner, "SYNTHETIC-v11-estimate");
    const member = await h.createMember(household, fixedUuid("d9100000", 1), "Tan Yi Chuen Raymond");
    const policies: { policyId: string; coverageId: string }[] = [];
    // As the eval journey's operator fixture (e2e/support/seed-claim-fixture.ts):
    // two certificates that write their currency (the reviewer decides both)
    // and one whose certificate writes no currency at all.
    for (const [i, cover] of [{ currency: "SGD", amount: 200000 }, { currency: "USD", amount: 100000 }].entries())
      policies.push(await h.createPolicy({ accountId: household, memberId: member, policyId: fixedUuid("f9300000", i), coverageId: fixedUuid("f9400000", i),
        ...ci.policy, policyNumber: "SYN-EST-" + i, amount: cover.amount, currency: cover.currency }));
    await h.createPolicy({ accountId: household, memberId: member, policyId: fixedUuid("f9300000", 9), coverageId: fixedUuid("f9400000", 9),
      ...ci.policy, policyNumber: "SYN-EST-NOCCY", amount: 50000, currency: "SGD", coverageEvidenceText: "Living Care sum insured: 50,000" });
    const headers = { "content-type": "application/json", cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${household}` };
    const conv: { id?: string; rev?: number } = {};
    const send = async (question: string) => {
      asUser(owner);
      const res = await chat(new NextRequest("http://localhost/api/chat", { method: "POST", headers,
        body: JSON.stringify({ familyMemberId: member, scope: "member", question, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore" }) }));
      const data = await res.json();
      assert.equal(res.status, 200, JSON.stringify(data).slice(0, 300));
      const answer = data.answer as ChatAnswer;
      conv.id = answer.conversationId ?? conv.id; conv.rev = answer.conversationRevision ?? conv.rev;
      return answer;
    };
    const listed = async (claim: string) => {
      asUser(owner);
      const res = await listClaims(new NextRequest("http://localhost/api/claims?familyMemberId=" + member, { headers }));
      return ((await res.json()).claims ?? []).find((c: { id: string }) => c.id === claim);
    };
    const text = (a: ChatAnswer) => [a.summary, ...a.details, ...a.nextSteps, ...a.claimItems.flatMap((i) => [i.title, i.reason, ...i.conditions, i.amountText ?? ""])].join("\n");

    // The eval journey's own flow (e2e/tests/v11-journey.spec.ts, evidence
    // review): the diagnosis and a claim-money question in one message, then
    // the interview answered through the question card. The claim's facts are
    // ONLY what the chat recorded -- nothing is patched into the claim.
    let turn = await send("Tan Yi Chuen Raymond was diagnosed with Malignant neoplasm of the colon on 2026-06-01. How much can we claim?");
    const replies: [RegExp, string][] = [[/specialist|oncologist/i, "Yes"], [/when|date/i, "2026-06-01"], [/hospital|admitted/i, "No"],
      [/stage|spread|severity/i, "Not sure"], [/symptom|before the (?:cover|policy)|first/i, "No"], [/./, "Not sure"]];
    let claimId = turn.claimSessionId;
    const asked: string[] = [];
    for (let n = 0; n < 10 && turn.questions.length; n++) {
      const q = turn.questions[0];
      if (asked.includes(q.text)) break;
      asked.push(q.text);
      const reply = replies.find(([re]) => re.test(q.text))![1];
      turn = await send(q.options?.includes(reply) ? reply : q.text.replace(/\?\s*$/, "") + ": " + reply);
      claimId = turn.claimSessionId ?? claimId;
    }
    const claim = claimId;
    await t("the chat never asks the same question twice in the claim conversation", async () => {
      assert.ok(!turn.questions.length || !asked.slice(0, -1).includes(turn.questions[0].text), "asked again: " + turn.questions[0]?.text);
      assert.equal(new Set(asked).size, asked.length, "a question was asked twice: " + asked.join(" | "));
    });
    await t("the interview ends and records one claim event for this conversation", async () => {
      assert.ok(claim, "no claim event: " + turn.mode + " / " + turn.summary.slice(0, 200));
    });

    await t("before any reviewer decision: no estimate in the chat, nothing shown as money (negative control)", async () => {
      const a = await send("How much can I claim?");
      assert.ok(!a.composition, "a composition without reviewed evidence");
      assert.doesNotMatch(text(a), MONEY);
      assert.doesNotMatch(a.summary, /indicative estimate for/i);
      assert.notEqual((await listed(claim!))?.display?.label, "Indicative estimate ready");
    });

    // The evidence extraction is the reviewer harness's simulated provider
    // (not the chat's stand-in), exactly as in the reviewer suites.
    delete process.env.DEARPOLICY_DETERMINISTIC_MODEL;
    const document = await h.uploadEvidence({ accountId: household, ownerUserId: owner, memberId: member, claimId: claim!, ...ci.evidence });
    process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
    const assignment = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: household, claimSessionId: claim!, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
    for (const p of policies) {
      const res = await h.decide("ci-match", reviewer, document, { assignmentId: assignment, contractId: p.policyId, coverageId: p.coverageId, result: "matches", reason: "Checked against the cited definition.", ...ci.decisionScope });
      assert.equal(res.status, 200, await res.clone().text());
    }

    await t("after the reviewer's decisions the chat's answer is the SAME indicative estimate as the claim page and list", async () => {
      const engine = (await computeIndicativeEstimate(household, claim!))!;
      assert.equal(engine.hasEstimate, true, "the fixture must produce an estimate (positive control)");
      asUser(owner);
      const page = (await (await getIndicative(new NextRequest(`http://localhost/api/claims/${claim}/indicative`, { headers }), { params: Promise.resolve({ id: claim! }) })).json()).estimate;
      const a = await send("How much can I claim now?");
      assert.ok(a.composition, "the chat fell back to: " + a.summary.slice(0, 240));
      assert.equal(a.claimSessionId, claim);
      assert.equal(a.assessmentKind, "indicative");
      assert.equal(a.composition!.disclaimer, INDICATIVE_ESTIMATE_NOTICE);
      assert.deepEqual(a.composition!.totalsByCurrency, engine.totalsByCurrency, "chat totals differ from the engine's");
      assert.deepEqual(a.composition!.totalsByCurrency, page.totalsByCurrency, "chat totals differ from the claim page's");
      assert.deepEqual(a.composition!.totalsByCurrency.map((x) => x.currency).sort(), ["SGD", "USD"], "one total per currency");
      assert.ok(!a.composition!.totalsByCurrency.some((x) => /300,000/.test(x.amountText)), "SGD and USD added together");
      assert.match(a.summary, /indicative/i);
      assert.match(a.summary, /not added together/i);
      assert.doesNotMatch(a.summary + a.details.join(" "), /preliminary/i);
      assert.doesNotMatch(text(a), MONEY, "amounts appear only in the estimate itself");
      assert.equal(a.questions.length, 0, "asked again: " + a.questions[0]?.text);
      assert.ok(!(a.factFinding ?? []).some((p) => p.nextQuestions.length), "a fact-finding question under the estimate");
      assert.equal((await listed(claim!))?.display?.label, "Indicative estimate ready");
      // Final eval journey (e864e8b): the same answer still showed "Reviewer
      // assessment needed" / "Evidence needed" cards, the "LIKELY APPLICABLE"
      // card twice, and "an amount whose currency the policy evidence does not
      // state (not shown)". Once the estimate exists the answer is coherent:
      const visible = [a.summary, ...a.details, ...a.nextSteps, ...a.claimItems.flatMap((i) => [i.title, i.reason, ...i.conditions]),
        ...(a.factFinding ?? []).flatMap((p) => [p.label, p.status, ...p.missingDocuments, ...p.reviewerRequirements, ...p.blockedReasons])].join("\n");
      assert.ok(!a.claimItems.some((i) => i.preliminaryStatus === "reviewer_assessment_needed" || i.preliminaryStatus === "evidence_needed" || i.status === "needs_document"),
        "stale 'needed' cards: " + a.claimItems.map((i) => i.title + " / " + i.preliminaryStatus).join("; "));
      assert.ok(!(a.factFinding ?? []).some((p) => p.missingDocuments.length || p.status === "evidence_needed" || p.status === "reviewer_assessment_needed"), "a stale 'Evidence needed' plan under the estimate");
      const titles = a.claimItems.map((i) => i.title);
      assert.equal(new Set(titles).size, titles.length, "duplicate cards: " + titles.join("; "));
      assert.doesNotMatch(visible, /whose currency the policy evidence does not state|\(not shown\)/i);
      const unstated = a.details.filter((d) => /doesn’t state the currency/.test(d));
      assert.equal(unstated.length, 1, "the unstated-currency cover must be said once: " + JSON.stringify(a.details));
      assert.match(unstated[0], /^The policy doesn’t state the currency for .+, so no amount is shown for it\.$/);
      for (const cur of ["SGD", "USD"]) assert.ok(a.details.some((d) => d.includes(", " + cur + " cover") && /wording page 4/.test(d) && /reviewer matched/.test(d)), "no source and reviewed decision for the " + cur + " amount: " + JSON.stringify(a.details));
      assert.equal(a.nextSteps.length, 1, "more than one next step: " + a.nextSteps.join(" | "));
      assert.doesNotMatch(visible, /Upload (?:the )?(?:specialist|documents for this claim)|still needed|Reviewer assessment needed|Evidence needed/i);
    });

    await t("one source: when a later reviewer decision withdraws the estimate, the chat withdraws it too", async () => {
      for (const p of policies) {
        const res = await h.decide("ci-match", reviewer, document, { assignmentId: assignment, contractId: p.policyId, coverageId: p.coverageId, result: "does_not_match", reason: "Re-checked: the definition is not met.", ...ci.decisionScope });
        assert.equal(res.status, 200, await res.clone().text());
      }
      const engine = (await computeIndicativeEstimate(household, claim!))!;
      assert.equal(engine.hasEstimate, false, "the engine still gives an estimate after negative decisions");
      const a = await send("And now?");
      assert.ok(!a.composition, "the chat still shows an estimate the engine no longer gives");
      assert.doesNotMatch(text(a), MONEY);
      assert.notEqual((await listed(claim!))?.display?.label, "Indicative estimate ready");
    });
  } finally {
    await h.close();
    clearTimeout(watchdog);
  }
  console.log(`v11 chat-estimate regressions passed: ${cases} cases`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

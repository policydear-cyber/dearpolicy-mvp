/**
 * Travel currency safety (product decision: fail closed on any currency
 * ambiguity; never convert, relabel or merge currencies). Real wording
 * loaders, real reviewer route, the production travel rules + accidental-
 * death calculator, monetary gate and composition engine, on PGlite.
 */
import assert from "node:assert/strict";
import { pool } from "@/lib/db/client";
import { CURRENCY_UNMATCHED_REASON, matchBenefitCurrency } from "@/lib/claims/currency-evidence";
import { fixedUuid, startReviewerHarness } from "./fixtures/reviewer-harness";
import { BENEFIT_FIXTURES } from "./fixtures/reviewer-benefit-wording";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void> | void) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

const travel = BENEFIT_FIXTURES.find((f) => f.category === "travel")!;
const SGD_WORDING = travel.policy.pages;
const USD_WORDING = travel.otherCurrencyPages;

async function main() {
  const h = await startReviewerHarness();
  const reviewer = fixedUuid("c8000000", 1);
  try {
    await h.admin.provisionClaimReviewer({ userId: reviewer, displayLabel: "Reviewer", operator: "ops.lead" });
    let n = 0;
    /** One household with one travel policy, a reviewed ("matches") police
     * report, returning the assessed travel item and composition. */
    async function scenario(policy: { pages: { pageNumber: number; text: string }[]; currency?: string; coverageCurrency?: string | null; sourcePage?: number | null; fileHash?: string | null }) {
      n++;
      const owner = fixedUuid("b8000000", n);
      const household = await h.createHousehold(fixedUuid("a8000000", n), owner);
      const member = await h.createMember(household, fixedUuid("d8000000", n), "Tan Yi Chuen Desmond");
      const claim = await h.createClaim(household, member, fixedUuid("e8000000", n), "death");
      const p = await h.createPolicy({ accountId: household, memberId: member, policyId: fixedUuid("f8100000", n), coverageId: fixedUuid("f8200000", n), ...travel.policy, currency: policy.currency ?? "SGD", ...policy });
      const document = await h.uploadEvidence({ accountId: household, ownerUserId: owner, memberId: member, claimId: claim, ...travel.evidence });
      const assignment = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: household, claimSessionId: claim, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
      const res = await h.decide("travel-match", reviewer, document, { assignmentId: assignment, contractId: p.policyId, coverageId: p.coverageId, result: "matches", reason: "Accident confirmed against the wording." });
      const out = await h.assess(household, member, claim, travel.facts);
      return { household, member, claim, ...p, decision: res.status, out, item: out.assessments.find((a) => a.id === "travel-accidental-death" && a.coverageId === p.coverageId) };
    }
    const blocked = (s: Awaited<ReturnType<typeof scenario>>, label: string) => {
      assert.ok(s.item, `${label}: the potential benefit stays visible`);
      assert.equal(s.item!.status, "needs_document", `${label}: ${JSON.stringify(s.item)}`);
      assert.equal(s.item!.calculatedAmount, undefined, `${label}: no amount`);
      assert.equal(s.item!.amountText, null, `${label}: never shown as $0`);
      assert.match(s.item!.reason, new RegExp(CURRENCY_UNMATCHED_REASON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.ok(s.item!.conditions.some((c) => /policy schedule or certificate page/.test(c)), `${label}: asks for the page that settles it`);
      assert.equal(s.out.composition.totalsByCurrency.reduce((sum, t) => sum + t.includedAmount, 0), 0, `${label}: nothing composed`);
    };

    await testAsync("same verified currency: calculates, with currency evidence naming policy, coverage, pages and document version", async () => {
      const s = await scenario({ pages: SGD_WORDING });
      assert.equal(s.decision, 200);
      assert.equal(s.item?.status, "potentially_applicable", JSON.stringify(s.item));
      assert.equal(s.item?.calculatedAmount, 150_000);
      assert.equal(s.item?.currency, "SGD");
      assert.equal(s.item?.monetaryDecision?.status, "allowed");
      const e = s.item!.currencyEvidence!;
      assert.deepEqual([e.policyId, e.coverageId, e.policyDocumentVersion, e.coverageCurrency, e.coverageSourcePage, e.benefitCurrency],
        [s.policyId, s.coverageId, `sha256:policy-${s.policyId}`, "SGD", 1, "SGD"]);
      assert.deepEqual([e.wording.pageStart, e.wording.pageEnd], [2, 2]);
      assert.deepEqual(s.out.composition.totalsByCurrency.map((t) => [t.currency, t.includedAmount]), [["SGD", 150_000]]);
    });

    await testAsync("different currencies (US$ wording, S$ cover): no amount, never relabelled, never totalled", async () => {
      const s = await scenario({ pages: USD_WORDING });
      blocked(s, "US$ vs S$");
      assert.ok(!/US\$|S\$/.test(s.item!.amountText ?? ""), "no figure in either currency");
    });

    await testAsync("missing cover currency (not stated on the certificate): no amount, even though the app defaults it to SGD", async () => {
      const s = await scenario({ pages: SGD_WORDING, coverageCurrency: null });
      blocked(s, "cover currency missing");
    });

    await testAsync("cover currency not traceable to a page, or policy document version unknown: no amount", async () => {
      blocked(await scenario({ pages: SGD_WORDING, sourcePage: null }), "no coverage source page");
      blocked(await scenario({ pages: SGD_WORDING, fileHash: null }), "unknown policy document version");
    });

    await testAsync("missing or uncited benefit currency is refused by the shared currency rule", () => {
      const coverage = { id: "c", policyId: "p", familyMemberId: "m", category: "Travel", amount: null, currency: "SGD", productName: null, sourcePage: 1, evidenceText: null, insurer: null, policyName: null, policyNumber: null, groupPolicyNumber: null, documentRole: null, effectiveDate: null, renewalOrExpiryDate: null, currencyVerified: true, policyDocumentVersion: "sha256:v1" };
      const citation = { chunkId: "page:p:2", policyId: "p", policyName: "T", pageStart: 2, pageEnd: 2 };
      assert.deepEqual(matchBenefitCurrency({ coverage, benefitCurrency: null, benefitQuote: "We will pay 150,000", citation }), { ok: false, reasonCode: "BENEFIT_CURRENCY_MISSING" });
      assert.deepEqual(matchBenefitCurrency({ coverage, benefitCurrency: "SGD", benefitQuote: "We will pay 150,000", citation }), { ok: false, reasonCode: "BENEFIT_CURRENCY_UNCITED" }, "a currency the wording does not state is never assumed");
      assert.deepEqual(matchBenefitCurrency({ coverage: { ...coverage, currencyVerified: undefined }, benefitCurrency: "SGD", benefitQuote: "S$150,000", citation }), { ok: false, reasonCode: "COVERAGE_CURRENCY_UNVERIFIED" });
      assert.equal(matchBenefitCurrency({ coverage, benefitCurrency: "SGD", benefitQuote: "S$150,000", citation }).ok, true);
    });

    await testAsync("wording with no stated currency is never read as a travel amount", async () => {
      const s = await scenario({ pages: [{ pageNumber: 2, text: "TravelSure Single Trip policy wording. Accidental Death Benefit: we will pay 150,000 if you die as a result of an accident during your trip." }] });
      assert.ok(!s.item || s.item.calculatedAmount === undefined);
      assert.equal(s.out.composition.totalsByCurrency.reduce((sum, t) => sum + t.includedAmount, 0), 0);
    });

    await testAsync("same currency other than SGD (US$ wording, US$ cover) calculates in US$ only", async () => {
      const s = await scenario({ pages: USD_WORDING, currency: "USD", coverageCurrency: "USD" });
      assert.equal(s.item?.status, "potentially_applicable", JSON.stringify(s.item));
      assert.equal(s.item?.currency, "USD");
      assert.deepEqual(s.out.composition.totalsByCurrency.map((t) => [t.currency, t.includedAmount]), [["USD", 150_000]]);
    });

    await testAsync("two reviewed travel policies in different currencies are never added into one total", async () => {
      n++;
      const owner = fixedUuid("b8000000", n);
      const household = await h.createHousehold(fixedUuid("a8000000", n), owner);
      const member = await h.createMember(household, fixedUuid("d8000000", n), "Tan Yi Chuen Desmond");
      const claim = await h.createClaim(household, member, fixedUuid("e8000000", n), "death");
      const sgd = await h.createPolicy({ accountId: household, memberId: member, policyId: fixedUuid("f8300000", 1), coverageId: fixedUuid("f8400000", 1), ...travel.policy });
      const usd = await h.createPolicy({ accountId: household, memberId: member, policyId: fixedUuid("f8300000", 2), coverageId: fixedUuid("f8400000", 2), ...travel.policy, insurer: "GlobeCover", pages: USD_WORDING, currency: "USD" });
      const document = await h.uploadEvidence({ accountId: household, ownerUserId: owner, memberId: member, claimId: claim, ...travel.evidence });
      const assignment = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: household, claimSessionId: claim, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
      for (const p of [sgd, usd]) {
        const res = await h.decide("travel-match", reviewer, document, { assignmentId: assignment, contractId: p.policyId, coverageId: p.coverageId, result: "matches", reason: "Accident confirmed." });
        assert.equal(res.status, 200, await res.clone().text());
      }
      const out = await h.assess(household, member, claim, travel.facts);
      const totals = Object.fromEntries(out.composition.totalsByCurrency.map((t) => [t.currency, t.includedAmount]));
      assert.deepEqual(totals, { SGD: 150_000, USD: 150_000 }, "one total per currency, never summed across currencies");
      const again = await h.assess(household, member, claim, travel.facts);
      assert.deepEqual(again.composition.totalsByCurrency, out.composition.totalsByCurrency);
    });

    await testAsync("a direct change of the cover's recorded currency cannot unlock an amount", async () => {
      const s = await scenario({ pages: USD_WORDING });
      blocked(s, "before");
      await pool.query(`UPDATE policy_coverages SET currency=NULL WHERE id=$1`, [s.coverageId]);
      const out = await h.assess(s.household, s.member, s.claim, travel.facts);
      assert.equal(out.assessments.find((a) => a.id === "travel-accidental-death")?.calculatedAmount, undefined);
    });
  } finally {
    await h.close();
  }
  console.log(`DearPolicy travel currency regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

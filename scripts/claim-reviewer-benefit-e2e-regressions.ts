/**
 * End-to-end proof, per reviewer-backed benefit category (accidental death,
 * critical illness, disability, travel), from policy wording to an
 * indicative composed amount -- through real production boundaries only:
 * real wording parsers and loaders, the real upload route, the clean-scan
 * transition, a real structuredCompletion() extraction with provider-
 * reported model provenance, operator-provisioned reviewer + assignment,
 * the real reviewer workspace and document routes, the real match route,
 * the production calculators, monetary gate and composition engine
 * (scripts/fixtures/reviewer-harness.ts's assess()).
 *
 * For every category, each single differing dimension (household, member,
 * claim, document, document version, provenance, contract, coverage,
 * wording, currency, reviewer assignment, reviewer status, expiry,
 * revocation, and a non-"matches" result) yields no amount.
 */
import assert from "node:assert/strict";
import { pool } from "@/lib/db/client";
import { INDICATIVE_ESTIMATE_NOTICE } from "@/lib/claims/reviewers/copy";
import { asUser, fixedUuid, startReviewerHarness, type ReviewerHarness } from "./fixtures/reviewer-harness";
import { BENEFIT_FIXTURES, type BenefitCategoryFixture } from "./fixtures/reviewer-benefit-wording";

const PROMISE = /\b(will be paid|you will receive|has been approved|is approved|guaranteed)\b/i;
const DECISION_TABLE: Record<BenefitCategoryFixture["route"], string> = {
  match: "claim_cause_definition_matches", "travel-match": "claim_cause_definition_matches",
  "ci-match": "claim_ci_definition_matches", "disability-match": "claim_disability_definition_matches",
};
const NEEDS_FURTHER_REVIEW: Record<BenefitCategoryFixture["route"], string> = {
  match: "needs_review", "travel-match": "needs_review", "ci-match": "insufficient_evidence", "disability-match": "insufficient_evidence",
};

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

type World = {
  household: string; owner: string; member: string; otherMember: string; claim: string; otherClaim: string;
  policyId: string; coverageId: string; otherPolicyId: string; otherCoverageId: string; document: string;
};

async function main() {
  const h = await startReviewerHarness();
  const reviewer = fixedUuid("c6000000", 1), suspendedReviewer = fixedUuid("c6000000", 2), unassignedReviewer = fixedUuid("c6000000", 3);

  async function world(f: BenefitCategoryFixture, n: number, pages = f.policy.pages, cover: { coverageEvidenceText?: string | null; sourcePage?: number | null } = {}): Promise<World> {
    const owner = fixedUuid("b6000000", n);
    const household = await h.createHousehold(fixedUuid("a6000000", n), owner);
    const member = await h.createMember(household, fixedUuid("d6000000", n), "Tan Jia Ming Raymond");
    const otherMember = await h.createMember(household, fixedUuid("d6000000", n + 1), "Casey Tan", "spouse");
    const claim = await h.createClaim(household, member, fixedUuid("e6000000", n), f.claimEventType);
    const otherClaim = await h.createClaim(household, member, fixedUuid("e6000000", n + 1), f.claimEventType);
    const { policyId, coverageId } = await h.createPolicy({ accountId: household, memberId: member, policyId: fixedUuid("f6000000", n), coverageId: fixedUuid("f7000000", n), ...f.policy, pages, ...cover });
    const other = await h.createPolicy({ accountId: household, memberId: otherMember, policyId: fixedUuid("f6000000", n + 1), coverageId: fixedUuid("f7000000", n + 1), ...f.policy, pages });
    const document = await h.uploadEvidence({ accountId: household, ownerUserId: owner, memberId: member, claimId: claim, ...f.evidence });
    return { household, owner, member, otherMember, claim, otherClaim, policyId, coverageId, otherPolicyId: other.policyId, otherCoverageId: other.coverageId, document };
  }
  const body = (f: BenefitCategoryFixture, assignmentId: string, w: World, extra: Record<string, unknown> = {}) =>
    ({ assignmentId, contractId: w.policyId, coverageId: w.coverageId, result: "matches", reason: "Evidence checked against the cited definition.", ...f.decisionScope, ...extra });
  const assign = async (reviewerUserId: string, w: World, claimId = w.claim) =>
    (await h.admin.assignClaimReview({ reviewerUserId, accountId: w.household, claimSessionId: claimId, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
  const itemOf = async (f: BenefitCategoryFixture, w: World, overrides: { household?: string; member?: string; claim?: string; facts?: Record<string, unknown> } = {}) => {
    const out = await h.assess(overrides.household ?? w.household, overrides.member ?? w.member, overrides.claim ?? w.claim, { ...f.facts, ...(overrides.facts ?? {}) });
    return { out, item: out.assessments.find((a) => a.id === f.itemId && a.coverageId === w.coverageId) };
  };
  const assertNoAmount = async (f: BenefitCategoryFixture, w: World, label: string, overrides: Parameters<typeof itemOf>[2] = {}) => {
    const { out, item } = await itemOf(f, w, overrides);
    assert.ok(!item || (item.calculatedAmount == null && item.status !== "potentially_applicable"), `${f.category} / ${label}: ${JSON.stringify(item)}`);
    assert.ok(!out.included.some((b) => b.benefitCode === f.itemId), `${f.category} / ${label}: nothing is composed`);
    const total = out.composition.totalsByCurrency.reduce((sum, t) => sum + t.includedAmount, 0);
    assert.equal(total, 0, `${f.category} / ${label}: composed total is zero`);
  };
  const assertAmount = async (f: BenefitCategoryFixture, w: World, label: string, overrides: Parameters<typeof itemOf>[2] = {}) => {
    const { out, item } = await itemOf(f, w, overrides);
    assert.ok(item, `${f.category} / ${label}: item present`);
    assert.equal(item!.status, "potentially_applicable", `${f.category} / ${label}: ${JSON.stringify(item)}`);
    assert.equal(item!.calculatedAmount, f.expectedAmount);
    assert.equal(item!.currency, f.expectedCurrency);
    assert.equal(item!.monetaryDecision?.status, "allowed", "the monetary gate independently allowed it");
    assert.deepEqual(out.composition.totalsByCurrency.map((t) => [t.currency, t.includedAmount]), [[f.expectedCurrency, f.expectedAmount]]);
    assert.ok(!PROMISE.test(`${item!.reason} ${item!.amountText ?? ""}`), `${f.category}: estimate wording never promises payment or approval`);
    return { out, item: item! };
  };

  try {
    for (const [userId, label] of [[reviewer, "Reviewer"], [suspendedReviewer, "Suspended reviewer"], [unassignedReviewer, "Unassigned reviewer"]]) {
      await h.admin.provisionClaimReviewer({ userId, displayLabel: label, operator: "ops.lead" });
    }
    let seq = 0;
    for (const f of BENEFIT_FIXTURES) await runCategory(h, f, ++seq * 100);
    await runCrossCategory(h);
  } finally {
    await h.close();
  }
  console.log(`DearPolicy reviewer benefit end-to-end regressions passed (${cases} cases across ${BENEFIT_FIXTURES.length} categories).`);

  async function runCategory(hh: ReviewerHarness, f: BenefitCategoryFixture, n: number) {
    const w = await world(f, n);
    const assignment = await assign(reviewer, w);
    const table = DECISION_TABLE[f.route];

    await testAsync(`${f.category}: full path -- wording, owned evidence, clean scan, verified provenance, assigned reviewer reads document and definition, decides, calculator + gate + composition`, async () => {
      const doc = (await pool.query<{ account_id: string; family_member_id: string; claim_session_id: string; scan_status: string; status: string }>(
        `SELECT account_id::text, family_member_id::text, claim_session_id::text, scan_status, status FROM claim_evidence_documents WHERE id=$1`, [w.document])).rows[0];
      assert.deepEqual([doc.account_id, doc.family_member_id, doc.claim_session_id, doc.scan_status, doc.status], [w.household, w.member, w.claim, "clean", "needs_review"]);
      await assertNoAmount(f, w, "before any decision");

      const ws = await (await hh.workspace(reviewer, assignment)).json();
      const definition = (ws.definitions as { route: string; contractId: string; coverageId: string; quote: string; citation: { pageStart: number; pageEnd: number } }[])
        .find((d) => d.route === f.route && d.contractId === w.policyId && d.coverageId === w.coverageId);
      assert.ok(definition && definition.quote.length > 10, "the reviewer sees the policy's cited definition");
      assert.ok(!(ws.definitions as { contractId: string }[]).some((d) => d.contractId === w.otherPolicyId), "never another member's policy");
      const docView = (ws.documents as { id: string; modelReadingVerified: boolean; citations: unknown[] }[]).find((d) => d.id === w.document);
      assert.ok(docView?.modelReadingVerified && docView.citations.length > 0, "the reviewer sees verified, cited facts");
      const file = await hh.download(reviewer, assignment, w.document);
      assert.equal(file.status, 200);
      assert.match(Buffer.from(await file.arrayBuffer()).toString("latin1"), /^%PDF/);

      const res = await hh.decide(f.route, reviewer, w.document, body(f, assignment, w, { reviewerName: "Insurer adjuster", familyMemberId: w.otherMember }));
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal((await res.json()).notice, INDICATIVE_ESTIMATE_NOTICE);
      const row = (await pool.query<{ reviewed_by: string; evidence_document_id: string; contract_id: string; coverage_id: string; family_member_id: string; definition_evidence: { policyId: string; pageStart: number; pageEnd: number } }>(
        `SELECT reviewed_by, evidence_document_id::text, contract_id::text, coverage_id::text, family_member_id::text, definition_evidence FROM ${table} WHERE evidence_document_id=$1 AND superseded_at IS NULL`, [w.document])).rows;
      assert.equal(row.length, 1);
      assert.equal(row[0].reviewed_by, `reviewer:${reviewer}`);
      assert.deepEqual([row[0].evidence_document_id, row[0].contract_id, row[0].coverage_id, row[0].family_member_id], [w.document, w.policyId, w.coverageId, w.member]);
      assert.deepEqual([row[0].definition_evidence.policyId, row[0].definition_evidence.pageStart, row[0].definition_evidence.pageEnd], [w.policyId, definition!.citation.pageStart, definition!.citation.pageEnd]);

      const first = await assertAmount(f, w, "after the reviewed decision");
      const again = await assertAmount(f, w, "recomputed");
      assert.equal(again.item.calculationId, first.item.calculationId, "deterministic");
    });

    await testAsync(`${f.category}: no amount for another household, member or claim`, async () => {
      await assertNoAmount(f, w, "another household", { household: fixedUuid("a6999999", n) });
      await assertNoAmount(f, w, "another family member", { member: w.otherMember });
      await assertNoAmount(f, w, "another claim event", { claim: w.otherClaim });
      const other = await world(f, n + 50);
      const res = await hh.decide(f.route, reviewer, other.document, body(f, assignment, w));
      assert.equal(res.status, 404, "this assignment never reaches another household's document");
      await assertNoAmount(f, other, "another household's claim, never decided");
    });

    await testAsync(`${f.category}: no decision for another contract or coverage; an unconfirmed coverage yields nothing`, async () => {
      for (const scope of [{ contractId: w.otherPolicyId, coverageId: w.otherCoverageId }, { contractId: w.policyId, coverageId: w.otherCoverageId }]) {
        assert.equal((await hh.decide(f.route, reviewer, w.document, body(f, assignment, w, scope))).status, 404);
      }
      await pool.query(`UPDATE policy_coverages SET confirmed=false WHERE id=$1`, [w.coverageId]);
      await assertNoAmount(f, w, "coverage no longer confirmed");
      await pool.query(`UPDATE policy_coverages SET confirmed=true WHERE id=$1`, [w.coverageId]);
      await assertAmount(f, w, "coverage confirmed again");
    });

    await testAsync(`${f.category}: a changed document version, or changed wording pages or text, yields nothing`, async () => {
      const hash = (await pool.query<{ file_hash: string }>(`SELECT file_hash FROM claim_evidence_documents WHERE id=$1`, [w.document])).rows[0].file_hash;
      await pool.query(`UPDATE claim_evidence_documents SET file_hash='sha256:a-different-version' WHERE id=$1`, [w.document]);
      await assertNoAmount(f, w, "document checksum changed");
      await pool.query(`UPDATE claim_evidence_documents SET file_hash=$2 WHERE id=$1`, [w.document, hash]);
      await assertAmount(f, w, "checksum restored");

      await pool.query(`UPDATE policy_pages SET page_number=page_number+100 WHERE policy_id=$1`, [w.policyId]);
      await assertNoAmount(f, w, "definition moved to other pages");
      await pool.query(`UPDATE policy_pages SET page_number=page_number-100 WHERE policy_id=$1`, [w.policyId]);

      // A re-read of the policy whose definition clause now reads differently
      // on the very same pages (here: the clause re-typeset in capitals --
      // still parsed as the same benefit, same citation, same amount).
      const original = (await pool.query<{ page_number: number; text: string }>(`SELECT page_number, text FROM policy_pages WHERE policy_id=$1 ORDER BY page_number`, [w.policyId])).rows;
      const quote = ((await (await hh.workspace(reviewer, assignment)).json()).definitions as { route: string; contractId: string; quote: string }[])
        .find((d) => d.route === f.route && d.contractId === w.policyId)!.quote;
      const amended = original.find((p) => p.text.includes(quote));
      assert.ok(amended, "fixture: the cited clause is on one page");
      await pool.query(`UPDATE policy_pages SET text=$3 WHERE policy_id=$1 AND page_number=$2`, [w.policyId, amended!.page_number, amended!.text.replace(quote, quote.toUpperCase())]);
      const reread = ((await (await hh.workspace(reviewer, assignment)).json()).definitions as { route: string; contractId: string; quote: string }[])
        .find((d) => d.route === f.route && d.contractId === w.policyId);
      assert.equal(reread?.quote, quote.toUpperCase(), "fixture: the amended clause still parses as the same benefit");
      await assertNoAmount(f, w, "same pages, different definition wording");
      for (const p of original) await pool.query(`UPDATE policy_pages SET text=$3 WHERE policy_id=$1 AND page_number=$2`, [w.policyId, p.page_number, p.text]);
      await assertAmount(f, w, "wording restored");
    });

    await testAsync(`${f.category}: evidence without verified model provenance yields nothing even with a "matches" decision`, async () => {
      const claim = await h.createClaim(w.household, w.member, fixedUuid("e6100000", n), f.claimEventType);
      const document = await h.uploadEvidence({ accountId: w.household, ownerUserId: w.owner, memberId: w.member, claimId: claim, ...f.evidence, withProvenance: false });
      const a = await assign(reviewer, w, claim);
      assert.equal((await hh.decide(f.route, reviewer, document, body(f, a, w))).status, 200);
      await assertNoAmount(f, w, "no provenance", { claim });
    });

    await testAsync(`${f.category}: wording quoting another currency never yields an amount in the cover's currency`, async () => {
      const wc = await world(f, n + 60, f.otherCurrencyPages);
      const a = await assign(reviewer, wc);
      const res = await hh.decide(f.route, reviewer, wc.document, body(f, a, wc));
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal(f.otherCurrencyBehaviour, "blocks");
      await assertNoAmount(f, wc, "currency differs from the verified cover");
    });

    // Currency provenance (Phase 3): the stored policy_coverages.currency is
    // defaulted to SGD at ingestion when a document states none, so it is
    // never proof. Only a currency WRITTEN in the cover's own evidence -- the
    // certificate line, or the cited certificate page -- verifies it.
    await testAsync(`${f.category}: a stored currency the certificate never writes (no currency, or a bare "$") yields no amount; a written currency on the cited page restores it`, async () => {
      const figure = f.policy.amount == null ? "as scheduled" : f.policy.amount.toLocaleString("en-US");
      const certificatePage = (text: string) => [...f.policy.pages, { pageNumber: 50, text: `Certificate of insurance. Insured person: Tan Jia Ming Raymond. ${text}` }];
      const cases = [
        { label: "no currency written anywhere", evidence: `${f.policy.productName} sum insured: ${figure}`, page: `Sum insured: ${figure}.`, amount: false },
        { label: "bare dollar sign only", evidence: `${f.policy.productName} sum insured: $${figure}`, page: `Sum insured: $${figure}.`, amount: false },
        { label: "certificate line has no currency, but the cited certificate page writes it (positive control)", evidence: `${f.policy.productName} sum insured: ${figure}`, page: `Currency of this cover: ${f.policy.currency}. Sum insured: ${figure}.`, amount: true },
      ];
      let k = 0;
      for (const c of cases) {
        const wc = await world(f, n + 70 + 2 * k++, certificatePage(c.page), { coverageEvidenceText: c.evidence, sourcePage: 50 });
        const a = await assign(reviewer, wc);
        const res = await hh.decide(f.route, reviewer, wc.document, body(f, a, wc));
        assert.equal(res.status, 200, await res.clone().text());
        if (c.amount) await assertAmount(f, wc, c.label);
        else {
          await assertNoAmount(f, wc, c.label);
          const { item } = await itemOf(f, wc);
          assert.ok(item, `${f.category} / ${c.label}: the benefit stays visible`);
          assert.equal(item!.amountText, null, `${f.category} / ${c.label}: never shown as $0 or in a guessed currency`);
          assert.ok(item!.conditions.some((x) => /policy schedule or certificate page/.test(x)), `${f.category} / ${c.label}: asks for the page that states the currency`);
        }
      }
    });

    await testAsync(`${f.category}: reviewer without assignment, suspended, expired or revoked -- and non-"matches" results -- yield nothing`, async () => {
      const document = await h.uploadEvidence({ accountId: w.household, ownerUserId: w.owner, memberId: w.member, claimId: w.otherClaim, ...f.evidence });
      const rows = async () => Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE evidence_document_id=$1`, [document])).rows[0].n);
      assert.equal((await hh.decide(f.route, unassignedReviewer, document, body(f, assignment, w))).status, 404, "unassigned");
      const suspendedAssignment = await assign(suspendedReviewer, w, w.otherClaim);
      await h.admin.setClaimReviewerStatus({ userId: suspendedReviewer, status: "suspended", reason: "Test.", operator: "ops.lead" });
      assert.equal((await hh.decide(f.route, suspendedReviewer, document, body(f, suspendedAssignment, w))).status, 403, "suspended");
      await h.admin.setClaimReviewerStatus({ userId: suspendedReviewer, status: "active", reason: "Test over.", operator: "ops.lead" });
      const revoked = await assign(reviewer, w, w.otherClaim);
      await h.admin.revokeClaimReviewAssignment({ assignmentId: revoked, reason: "Test.", operator: "ops.lead" });
      assert.equal((await hh.decide(f.route, reviewer, document, body(f, revoked, w))).status, 404, "revoked");
      const expired = await assign(reviewer, w, w.otherClaim);
      await pool.query(`UPDATE claim_review_assignments SET assigned_at=now()-interval '3 days', expires_at=now()-interval '1 day' WHERE id=$1`, [expired]);
      assert.equal((await hh.decide(f.route, reviewer, document, body(f, expired, w))).status, 404, "expired");
      asUser(w.owner);
      assert.equal((await hh.decide(f.route, w.owner, document, body(f, assignment, w, { reviewerName: "Household" }))).status, 403, "a household assertion");
      assert.equal(await rows(), 0, "none of those wrote a decision");
      await assertNoAmount(f, w, "no valid decision", { claim: w.otherClaim });

      await h.admin.revokeClaimReviewAssignment({ assignmentId: expired, reason: "Expired; replaced.", operator: "ops.lead" });
      const live = await assign(reviewer, w, w.otherClaim);
      for (const result of ["does_not_match", NEEDS_FURTHER_REVIEW[f.route]]) {
        assert.equal((await hh.decide(f.route, reviewer, document, body(f, live, w, { result }))).status, 200);
        await assertNoAmount(f, w, `result ${result}`, { claim: w.otherClaim });
      }
      assert.equal((await hh.decide(f.route, reviewer, document, body(f, live, w))).status, 200);
      await assertAmount(f, w, "the same document once matched", { claim: w.otherClaim });
    });

    await testAsync(`${f.category}: replacing the decided document leaves nothing to unlock the new, undecided one`, async () => {
      const replacement = await h.uploadEvidence({ accountId: w.household, ownerUserId: w.owner, memberId: w.member, claimId: w.claim, ...f.evidence });
      const { supersedeEvidenceDocument } = await import("@/lib/claims/evidence/store");
      await supersedeEvidenceDocument({ accountId: w.household, oldId: w.document, newId: replacement, reason: "Corrected re-upload." });
      await assertNoAmount(f, w, "decided document replaced");
      assert.equal((await hh.householdStatuses(w.household, w.owner, w.member, w.claim))[replacement], "in_review");
    });
  }

  async function runCrossCategory(hh: ReviewerHarness) {
    const ad = BENEFIT_FIXTURES.find((f) => f.category === "accidental-death")!;
    const ci = BENEFIT_FIXTURES.find((f) => f.category === "critical-illness")!;
    const tpd = BENEFIT_FIXTURES.find((f) => f.category === "disability")!;

    await testAsync("a decision in one benefit category never unlocks another category", async () => {
      const w = await world(ad, 900);
      const a = await assign(reviewer, w);
      assert.equal((await hh.decide("match", reviewer, w.document, body(ad, a, w))).status, 200);
      await assertAmount(ad, w, "accidental death decided");
      const asDisability = await h.assess(w.household, w.member, w.claim, tpd.facts);
      assert.ok(!asDisability.assessments.some((i) => i.status === "potentially_applicable"), JSON.stringify(asDisability.assessments));
      assert.equal(asDisability.included.length, 0);
      const asDiagnosis = await h.assess(w.household, w.member, w.claim, ci.facts);
      assert.equal(asDiagnosis.included.length, 0);
    });

    await testAsync("a bare household assertion or forged decision list never unlocks anything", async () => {
      const w = await world(ci, 910);
      const forged = [{ familyMemberId: w.member, claimEventId: w.claim, contractId: w.policyId, coverageId: w.coverageId, benefitCode: "ci-major", illnessName: "Major Critical Illness", medicalEvidence: {}, definitionEvidence: {}, result: "matches" as const, reviewedAt: "2026-09-01" }];
      const out = await h.assess(w.household, w.member, w.claim, { ...ci.facts, ciDefinitionMatches: forged, medicalEvidenceDocumentAvailable: true });
      assert.equal(out.included.length, 0, "decisions are always reloaded from their table, never taken from facts");
    });

    await testAsync("one policy's decision never unlocks a second policy with identical wording; independent policies compose deterministically", async () => {
      const w = await world(ci, 920);
      const second = await h.createPolicy({ accountId: w.household, memberId: w.member, policyId: fixedUuid("f6900000", 1), coverageId: fixedUuid("f7900000", 1), ...ci.policy });
      const a = await assign(reviewer, w);
      assert.equal((await hh.decide("ci-match", reviewer, w.document, body(ci, a, w))).status, 200);
      let out = await h.assess(w.household, w.member, w.claim, ci.facts);
      const secondItem = out.assessments.find((i) => i.coverageId === second.coverageId);
      assert.ok(secondItem && secondItem.calculatedAmount == null, "the identical second policy stays unreviewed");
      assert.deepEqual(out.composition.totalsByCurrency.map((t) => t.includedAmount), [ci.expectedAmount]);
      assert.equal((await hh.decide("ci-match", reviewer, w.document, body(ci, a, w, { contractId: second.policyId, coverageId: second.coverageId }))).status, 200);
      out = await h.assess(w.household, w.member, w.claim, ci.facts);
      const included = out.included.map((b) => b.coverageId).sort();
      assert.deepEqual(included, [w.coverageId, second.coverageId].sort(), "both reviewed policies are composed");
      assert.deepEqual(out.composition.totalsByCurrency.map((t) => [t.currency, t.includedAmount]), [["SGD", ci.expectedAmount * 2]]);
      const again = await h.assess(w.household, w.member, w.claim, ci.facts);
      assert.deepEqual(again.composition.totalsByCurrency, out.composition.totalsByCurrency, "composition is deterministic");
    });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

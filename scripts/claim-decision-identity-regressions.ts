/**
 * Reviewer decision identity and supersession regressions (real routes,
 * production loaders/calculators, PGlite).
 *
 * Reproduces the defect where a reviewer decision on document B replaced
 * the active decision on document A merely because both concerned the same
 * policy and coverage (document A then fell back to "in review"), and
 * proves the rule now implemented (lib/claims/evidence/decision-selection.ts):
 * a decision supersedes another only for the identical review subject --
 * household, member, claim, contract, coverage, evidence document, benefit
 * and definition citation -- and every read is deterministic and
 * fail-closed.
 */
import assert from "node:assert/strict";
import fixture from "./fixtures/singlife-death-wording.json";
import { asUser, fixedUuid, startReviewerHarness } from "./fixtures/reviewer-harness";
import { pool } from "@/lib/db/client";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

const CAUSE = "Blunt force trauma from a road traffic accident";
const POLICE_REPORT = {
  deceasedName: "Tan Yi Chuen Desmond", otherNamesMentioned: [], personIdentifiers: [],
  dateOfDeath: "2026-09-14", statedCauseOfDeath: CAUSE, mannerOfDeath: "accident",
  issuingAuthority: "SPF", documentReference: "REF-1", documentType: "police_report",
  pageCitations: [{ field: "statedCauseOfDeath", pageStart: 1, pageEnd: 1, excerpt: CAUSE }], confidence: {},
};
const POLICE_PAGES = [{ pageNumber: 1, text: `Police report. Deceased: Tan Yi Chuen Desmond. Date of death 2026-09-14. Cause of death: ${CAUSE}.` }];
const DEATH_FACTS = { eventType: "death" as const, death: true, deathDate: "2026-09-14", eventDate: "2026-09-14" };

async function main() {
  const h = await startReviewerHarness();
  try {
    const owner = fixedUuid("b2000000", 1), reviewer = fixedUuid("c2000000", 1);
    const household = await h.createHousehold(fixedUuid("a2000000", 1), owner);
    const member = await h.createMember(household, fixedUuid("d2000000", 1), "Tan Yi Chuen Desmond");
    const claim = await h.createClaim(household, member, fixedUuid("e2000000", 1), "death");
    const { policyId, coverageId } = await h.createPolicy({
      accountId: household, memberId: member, policyId: fixedUuid("f3000000", 1), coverageId: fixedUuid("f4000000", 1),
      insurer: "Singlife", productName: "Group Personal Accident", groupPolicyNumber: "G007500", category: "Personal Accident", amount: 600000, currency: "SGD",
      pages: fixture.benefitSummary.pages,
    });
    const evidence = () => h.uploadEvidence({ accountId: household, ownerUserId: owner, memberId: member, claimId: claim, documentType: "police_report", payload: POLICE_REPORT, pages: POLICE_PAGES });
    const docA = await evidence();
    const docB = await evidence();
    const docC = await evidence();
    await h.admin.provisionClaimReviewer({ userId: reviewer, displayLabel: "Reviewer", operator: "ops.lead" });
    const assignment = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: household, claimSessionId: claim, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
    const decide = (documentId: string, result: string, reason = `Reviewed ${result}.`) =>
      h.decide("match", reviewer, documentId, { assignmentId: assignment, contractId: policyId, coverageId, result, reason });
    const decisions = async (documentId: string) => (await pool.query<{ id: string; result: string; superseded_at: string | null; definition_evidence: { pageStart: number } }>(
      `SELECT id::text, result, superseded_at::text, definition_evidence FROM claim_cause_definition_matches WHERE evidence_document_id=$1 ORDER BY reviewed_at, id`, [documentId])).rows;
    const active = async (documentId: string) => (await decisions(documentId)).filter((d) => d.superseded_at === null);
    const gpa = async () => (await h.assess(household, member, claim, DEATH_FACTS)).assessments.find((a) => a.id === "gpa-accidental-death")!;

    await testAsync("reproduced defect: a decision on document B never supersedes document A's decision for the same policy and coverage", async () => {
      assert.equal((await decide(docA, "matches")).status, 200);
      assert.equal((await decide(docB, "needs_review")).status, 200);
      const a = await active(docA);
      assert.equal(a.length, 1, "document A keeps its active decision");
      assert.equal(a[0].result, "matches");
      assert.equal((await active(docB))[0].result, "needs_review");
      const statuses = await h.householdStatuses(household, owner, member, claim);
      assert.equal(statuses[docA], "reviewed", "document A's status is its own, not document B's");
      assert.equal(statuses[docB], "more_evidence_required");
      assert.equal(statuses[docC], "in_review");
    });

    await testAsync("disagreeing documents for one benefit are ambiguous: no amount, deterministically, until they agree", async () => {
      const item = await gpa();
      assert.equal(item.calculatedAmount ?? null, null, "a 'needs further review' on another document withholds the estimate");
      assert.notEqual(item.status, "potentially_applicable");
      assert.equal((await decide(docB, "does_not_match")).status, 200);
      assert.equal((await gpa()).calculatedAmount ?? null, null, "'does not match' on another document also withholds it");
      assert.equal((await decide(docB, "matches")).status, 200);
      const agreed = await gpa();
      assert.equal(agreed.status, "potentially_applicable", JSON.stringify(agreed));
      assert.equal(agreed.calculatedAmount, 600_000);
      const again = await gpa();
      assert.equal(again.calculationId, agreed.calculationId, "the same inputs always select the same decision");
    });

    await testAsync("a new decision on the SAME subject supersedes only that subject, and history stays immutable", async () => {
      const before = await decisions(docB);
      assert.equal(before.length, 3);
      assert.deepEqual(before.map((d) => d.superseded_at === null), [false, false, true]);
      assert.equal((await active(docA)).length, 1, "document A untouched by every decision on document B");
      const history = await (await h.workspace(reviewer, assignment)).json();
      assert.equal((history.history as { evidenceDocumentId: string }[]).filter((e) => e.evidenceDocumentId === docB).length, 3, "the reviewer sees every past decision");
    });

    await testAsync("a decision against older policy wording never unlocks newer wording, and a decision on new wording does not erase it", async () => {
      await pool.query(`UPDATE policy_pages SET page_number=page_number+100 WHERE policy_id=$1`, [policyId]);
      const stale = await gpa();
      assert.equal(stale.calculatedAmount ?? null, null, "decisions citing the old pages cannot unlock the re-read wording");
      assert.equal((await decide(docA, "matches", "Re-checked against the updated wording.")).status, 200);
      const docADecisions = await active(docA);
      assert.equal(docADecisions.length, 2, "the old-wording decision is a different subject: still recorded, not overwritten");
      assert.ok(docADecisions.some((d) => d.definition_evidence.pageStart > 100) && docADecisions.some((d) => d.definition_evidence.pageStart < 100));
      assert.equal((await gpa()).calculatedAmount, 600_000, "only the decision against the current wording is consumed");
      await pool.query(`UPDATE policy_pages SET page_number=page_number-100 WHERE policy_id=$1`, [policyId]);
    });

    await testAsync("historical duplicate active decisions for one subject are ignored, never picked arbitrarily", async () => {
      const [row] = (await pool.query<Record<string, unknown>>(`SELECT * FROM claim_cause_definition_matches WHERE evidence_document_id=$1 AND superseded_at IS NULL`, [docB])).rows;
      await pool.query(
        `INSERT INTO claim_cause_definition_matches(account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,cause_evidence,definition_evidence,result,reviewed_by,reason,evidence_provenance)
         SELECT account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,cause_evidence,definition_evidence,'matches','legacy-duplicate',reason,evidence_provenance
           FROM claim_cause_definition_matches WHERE id=$1`, [row.id]);
      const { loadCauseDefinitionMatchesForFacts } = await import("@/lib/claims/evidence/session-matches");
      const loaded = await loadCauseDefinitionMatchesForFacts(household, member, claim);
      assert.ok(!loaded.some((m) => (m.causeEvidence as { documentId: string }).documentId === docB), "both duplicates of the ambiguous subject are dropped");
      assert.ok(loaded.some((m) => (m.causeEvidence as { documentId: string }).documentId === docA), "other documents are unaffected");
      assert.equal((await gpa()).calculatedAmount, 600_000, "document A alone still decides this benefit");
      await pool.query(`UPDATE claim_cause_definition_matches SET superseded_at=now(), superseded_reason='test cleanup' WHERE evidence_document_id=$1 AND reviewed_by='legacy-duplicate'`, [docB]);
    });

    await testAsync("replacing document A makes its decisions unusable for any calculation; document B's stay", async () => {
      const replacement = await evidence();
      const { supersedeEvidenceDocument } = await import("@/lib/claims/evidence/store");
      await supersedeEvidenceDocument({ accountId: household, oldId: docA, newId: replacement, reason: "Corrected re-upload." });
      assert.equal((await active(docA)).length, 0, "every decision on the replaced document is retired");
      assert.equal((await decisions(docA)).length, 2, "but both are kept as history");
      assert.equal((await active(docB)).length, 1, "document B's decision is not touched");
      const { loadCauseDefinitionMatchesForFacts } = await import("@/lib/claims/evidence/session-matches");
      const loaded = await loadCauseDefinitionMatchesForFacts(household, member, claim);
      assert.ok(!loaded.some((m) => (m.causeEvidence as { documentId: string }).documentId === docA));
    });

    await testAsync("revocation keeps completed decisions; an undecided document returns to awaiting review", async () => {
      assert.equal((await h.householdStatuses(household, owner, member, claim))[docC], "in_review");
      await h.admin.revokeClaimReviewAssignment({ assignmentId: assignment, reason: "Reassigned.", operator: "ops.lead" });
      const statuses = await h.householdStatuses(household, owner, member, claim);
      assert.equal(statuses[docB], "reviewed");
      assert.equal(statuses[docC], "awaiting_assignment");
      asUser(reviewer);
      assert.equal((await decide(docC, "matches")).status, 404);
    });

    await testAsync("concurrent decisions on one subject never leave two active decisions", async () => {
      const second = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: household, claimSessionId: claim, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
      const body = (result: string) => ({ assignmentId: second, contractId: policyId, coverageId, result, reason: "Concurrent." });
      const results = await Promise.all([
        h.decide("match", reviewer, docC, body("matches")),
        h.decide("match", reviewer, docC, body("needs_review")),
      ]);
      assert.deepEqual(results.map((r) => r.status), [200, 200]);
      assert.equal((await active(docC)).length, 1);
    });
  } finally {
    await h.close();
  }
  console.log(`DearPolicy decision-identity regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

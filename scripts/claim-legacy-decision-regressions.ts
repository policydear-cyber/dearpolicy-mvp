/**
 * Legacy reviewer/household decisions -- rows written before decisions
 * carried a wording fingerprint -- can never unlock an estimate, in any of
 * the four reviewer-backed categories. They stay as immutable history,
 * are labelled legacy for reviewers, ask the household for a new review,
 * and are replaced (superseded, never deleted or backfilled) only by a new
 * fingerprinted decision on the identical subject. Real loaders, route,
 * rules, calculators, monetary gate and composition, on PGlite.
 */
import assert from "node:assert/strict";
import { pool } from "@/lib/db/client";
import { provenanceSnapshotForExtraction } from "@/lib/claims/evidence/extraction-provenance";
import { getLatestExtraction } from "@/lib/claims/evidence/store";
import { selectApplicableDecision } from "@/lib/claims/evidence/decision-selection";
import { fixedUuid, startReviewerHarness } from "./fixtures/reviewer-harness";
import { BENEFIT_FIXTURES, type BenefitCategoryFixture } from "./fixtures/reviewer-benefit-wording";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

const TABLE: Record<BenefitCategoryFixture["route"], string> = {
  match: "claim_cause_definition_matches", "travel-match": "claim_cause_definition_matches",
  "ci-match": "claim_ci_definition_matches", "disability-match": "claim_disability_definition_matches",
};

async function main() {
  const h = await startReviewerHarness();
  const reviewer = fixedUuid("c9100000", 1);
  try {
    await h.admin.provisionClaimReviewer({ userId: reviewer, displayLabel: "Reviewer", operator: "ops.lead" });
    let n = 0;
    for (const f of BENEFIT_FIXTURES) {
      n++;
      console.log(`legacy: ${f.category}`);
      const owner = fixedUuid("b9100000", n);
      const household = await h.createHousehold(fixedUuid("a9100000", n), owner);
      const member = await h.createMember(household, fixedUuid("d9100000", n), "Tan Yi Chuen Desmond");
      const claim = await h.createClaim(household, member, fixedUuid("e9100000", n), f.claimEventType);
      const { policyId, coverageId } = await h.createPolicy({ accountId: household, memberId: member, policyId: fixedUuid("f9100000", n), coverageId: fixedUuid("f9200000", n), ...f.policy });
      const document = await h.uploadEvidence({ accountId: household, ownerUserId: owner, memberId: member, claimId: claim, ...f.evidence });
      const assignment = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: household, claimSessionId: claim, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
      const ws = await (await h.workspace(reviewer, assignment)).json();
      const definition = (ws.definitions as { route: string; contractId: string; citation: { pageStart: number; pageEnd: number } }[]).find((d) => d.route === f.route && d.contractId === policyId)!;
      assert.ok(definition, `${f.category}: fixture wording resolves`);
      await h.admin.revokeClaimReviewAssignment({ assignmentId: assignment, reason: "Set-up read only.", operator: "ops.lead" });

      // A realistic pre-migration row: the right document, pages, contract
      // and coverage, even a VERIFIED provenance snapshot -- but no wording
      // fingerprint, written by a household-era reviewer name.
      const extraction = (await getLatestExtraction(household, document))!;
      const provenance = provenanceSnapshotForExtraction(extraction, document);
      assert.ok(provenance?.verified, "fixture: the legacy row even carries verified provenance");
      const definitionEvidence = { policyId, chunkId: `page:${policyId}:${definition.citation.pageStart}`, pageStart: definition.citation.pageStart, pageEnd: definition.citation.pageEnd, label: "legacy" };
      const evidence = { documentId: document, documentType: f.evidence.documentType, familyMemberId: member, claimEventId: claim, pageStart: 1, pageEnd: 1 };
      const table = TABLE[f.route];
      const extraCols = f.route === "ci-match" ? ",benefit_code,illness_name" : f.route === "disability-match" ? ",benefit_code,match_key" : "";
      const extraVals = f.route === "ci-match" ? [f.decisionScope.benefitCode, f.decisionScope.illnessName] : f.route === "disability-match" ? [f.decisionScope.benefitCode, f.decisionScope.matchKey] : [];
      const evidenceCol = table === "claim_cause_definition_matches" ? "cause_evidence" : "medical_evidence";
      const legacyId = (await pool.query<{ id: string }>(
        `INSERT INTO ${table}(account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,${evidenceCol},definition_evidence,result,reviewed_by,reason,evidence_provenance${extraCols})
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'matches','Household reviewer','Looks right to me.',$9::jsonb${extraVals.map((_, i) => `,$${10 + i}`).join("")}) RETURNING id::text`,
        [household, member, claim, policyId, coverageId, document, JSON.stringify(evidence), JSON.stringify(definitionEvidence), JSON.stringify(provenance), ...extraVals])).rows[0].id;
      // A second legacy row on the same document but a DIFFERENT citation:
      // the new decision must not retire it (identity rules unchanged).
      const otherCitation = { ...definitionEvidence, chunkId: `page:${policyId}:${definition.citation.pageStart + 40}`, pageStart: definition.citation.pageStart + 40, pageEnd: definition.citation.pageEnd + 40 };
      const otherId = (await pool.query<{ id: string }>(
        `INSERT INTO ${table}(account_id,family_member_id,claim_session_id,contract_id,coverage_id,evidence_document_id,${evidenceCol},definition_evidence,result,reviewed_by,reason,evidence_provenance${extraCols})
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'matches','Household reviewer','Looks right to me.',$9::jsonb${extraVals.map((_, i) => `,$${10 + i}`).join("")}) RETURNING id::text`,
        [household, member, claim, policyId, coverageId, document, JSON.stringify(evidence), JSON.stringify(otherCitation), JSON.stringify(provenance), ...extraVals])).rows[0].id;
      const snapshot = async () => (await pool.query(`SELECT * FROM ${table} WHERE id=$1`, [legacyId])).rows[0] as Record<string, unknown>;
      const before = await snapshot();
      const item = async () => (await h.assess(household, member, claim, f.facts)).assessments.find((a) => a.id === f.itemId && a.coverageId === coverageId);

      await testAsync(`${f.category}: a legacy decision without a wording fingerprint never unlocks an estimate`, async () => {
        const out = await h.assess(household, member, claim, f.facts);
        const legacyItem = out.assessments.find((a) => a.id === f.itemId && a.coverageId === coverageId);
        assert.ok(legacyItem, "the potential benefit stays visible");
        assert.equal(legacyItem!.calculatedAmount, undefined, JSON.stringify(legacyItem));
        assert.notEqual(legacyItem!.status, "potentially_applicable");
        assert.equal(out.composition.totalsByCurrency.reduce((s, t) => s + t.includedAmount, 0), 0);
      });

      await testAsync(`${f.category}: both fail-closed layers hold -- the shared selection never returns it, and it reaches no calculator with provenance`, async () => {
        const loader = f.route === "ci-match" ? (await import("@/lib/claims/evidence/ci-session-matches")).loadCIDefinitionMatchesForFacts
          : f.route === "disability-match" ? (await import("@/lib/claims/evidence/disability-session-matches")).loadDisabilityDefinitionMatchesForFacts
          : (await import("@/lib/claims/evidence/session-matches")).loadCauseDefinitionMatchesForFacts;
        const loaded = (await loader(household, member, claim)) as { provenance?: unknown; definitionEvidence: unknown; result: string; reviewedAt: string }[];
        assert.equal(loaded.length, 2, "both kept and loaded as history");
        for (const row of loaded) assert.equal(row.provenance, undefined, "stripped of provenance: every calculator independently blocks it (EVIDENCE_PROVENANCE_MISSING)");
        assert.equal(selectApplicableDecision(loaded, { ...definitionEvidence, wordingHash: "sha256:anything" }), null, "never selected for any current wording");
        assert.equal(selectApplicableDecision(loaded, definitionEvidence), null, "not even against its own citation");
        if (f.route === "match") {
          const { calculateAccidentalDeath } = await import("@/lib/claims/calculators/accidental-death");
          const ref = { policyId, chunkId: definitionEvidence.chunkId, pageStart: definitionEvidence.pageStart, pageEnd: definitionEvidence.pageEnd };
          const direct = calculateAccidentalDeath({
            ownership: { contractId: policyId, coverageId }, familyMember: { id: member, confirmed: true }, claimEventId: claim,
            deathConfirmed: true, dateOfDeath: "2026-09-14", policyEffectiveDate: "2020-01-01", sumInsured: 600_000, currency: "SGD",
            formula: { kind: "sum_insured_fraction", fraction: 1, evidence: ref }, ruleEvidence: ref,
            ownershipEvidence: { policyId, chunkId: `coverage:${coverageId}`, coverageId, familyMemberId: member },
            accidentalDeathDefinitionEvidence: ref, causeDefinitionMatch: loaded[0] as never,
          });
          assert.equal(direct.status, "blocked");
          if (direct.status === "blocked") assert.equal(direct.reasonCode, "EVIDENCE_PROVENANCE_MISSING");
        }
      });

      await testAsync(`${f.category}: the household is asked for a new review; the reviewer sees it labelled legacy`, async () => {
        assert.equal((await h.householdStatuses(household, owner, member, claim))[document], "re_review_required");
        const a2 = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: household, claimSessionId: claim, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
        assert.equal((await h.householdStatuses(household, owner, member, claim))[document], "in_review");
        const history = (await (await h.workspace(reviewer, a2)).json()).history as { id: string; legacyUnverified: boolean }[];
        assert.equal(history.find((e) => e.id === legacyId)?.legacyUnverified, true);

        // A new fingerprinted decision on the identical subject replaces it --
        // as history, never deleted, never backfilled.
        const res = await h.decide(f.route, reviewer, document, { assignmentId: a2, contractId: policyId, coverageId, result: "matches", reason: "Re-reviewed against the current wording.", ...f.decisionScope });
        assert.equal(res.status, 200, await res.clone().text());
        const after = await snapshot();
        assert.ok(after.superseded_at, "the legacy decision is retired");
        for (const key of Object.keys(before)) if (key !== "superseded_at" && key !== "superseded_reason") assert.deepEqual(after[key], before[key], `legacy ${key} unchanged`);
        assert.equal((after.definition_evidence as { wordingHash?: string }).wordingHash, undefined, "no fingerprint was ever backfilled");
        const other = (await pool.query(`SELECT superseded_at, definition_evidence FROM ${table} WHERE id=$1`, [otherId])).rows[0] as { superseded_at: unknown; definition_evidence: { wordingHash?: string } };
        assert.equal(other.superseded_at, null, "a legacy row for a different citation is not retired");
        assert.equal(other.definition_evidence.wordingHash, undefined);
        const now = await item();
        assert.equal(now?.status, "potentially_applicable", JSON.stringify(now));
        assert.equal(now?.calculatedAmount, f.expectedAmount);
        assert.equal((await h.householdStatuses(household, owner, member, claim))[document], "reviewed");
      });
    }

    await testAsync("legacy rows are kept, never deleted: every same-subject row retired, every other-citation row still open", async () => {
      for (const table of ["claim_cause_definition_matches", "claim_ci_definition_matches", "claim_disability_definition_matches"]) {
        const r = (await pool.query<{ total: string; open: string }>(`SELECT count(*)::text AS total, count(*) FILTER (WHERE superseded_at IS NULL)::text AS open FROM ${table} WHERE reviewed_by='Household reviewer'`)).rows[0];
        const expected = table === "claim_cause_definition_matches" ? 2 : 1;
        assert.equal(r.total, String(expected * 2), `${table}: all legacy rows kept`);
        assert.equal(r.open, String(expected), `${table}: only the other-citation rows remain open`);
      }
    });
  } finally {
    await h.close();
  }
  console.log(`DearPolicy legacy-decision regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

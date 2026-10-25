/**
 * Regression suite for the claim-evidence pipeline (PR #9, stacked on the
 * validated-evidence/policy-specific-match work in PR #8).
 *
 * Two halves:
 *  1. Pure-function tests (no database) -- upload validation, the state
 *     machine, identity/event matching, and the calculator's behaviour
 *     against pipeline-shaped CauseDefinitionMatch records.
 *  2. Database-backed tests, run against a disposable PGlite instance
 *     exactly the way scripts/system-database-regressions.ts already tests
 *     the rest of this app's Postgres behaviour: real SQL, real
 *     constraints, no live Postgres required. Covers cross-account/
 *     cross-family-member/cross-claim isolation, duplicate-upload and
 *     retry idempotency, invalid-transition rejection, audit-trail
 *     creation, match supersession/invalidation, and the review action
 *     (lib/claims/evidence/matches.ts) end to end, including confirming
 *     that a match for one policy can never unlock another.
 *
 * This suite deliberately does NOT mock the hosted LLM extraction call
 * end-to-end -- lib/claims/evidence/extract.ts's own citation-verification
 * is exercised indirectly through the schema and identity tests below, and
 * model-output quality is scripts/extraction-eval.ts's job elsewhere in
 * this repo (npm run eval:extraction), not this suite's.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import fixture from "./fixtures/singlife-death-wording.json";

import { validateEvidenceUpload, looksLikePdf, isSupportedDocumentType } from "@/lib/claims/evidence/validation";
import { isValidEvidenceTransition, assertValidEvidenceTransition, InvalidEvidenceTransitionError } from "@/lib/claims/evidence/state-machine";
import { evaluateClaimEvidenceIdentity } from "@/lib/claims/evidence/identity";
import { ClaimEvidenceExtractionSchema } from "@/lib/claims/evidence/extraction-schema";
import type { ClaimEvidenceDocumentRow, ClaimEvidenceExtractedFields } from "@/lib/claims/evidence/types";
import { calculateAccidentalDeath } from "@/lib/claims/calculators/accidental-death";
import type { CauseDefinitionMatch } from "@/lib/claims/calculators/evidence";
import { verifiedEvidenceProvenance } from "./fixtures/verified-evidence-provenance";
import { resolveDeathEvidence, type DeathWordingPage } from "@/lib/claims/death-evidence";

let cases = 0;
function test(name: string, fn: () => void) {
  try { fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

// ---------------------------------------------------------------------
// 1. Pure-function tests
// ---------------------------------------------------------------------

function runPureTests() {
  const pdfBytes = new TextEncoder().encode("%PDF-1.4 synthetic body long enough to sniff");
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
  const exeBytes = new TextEncoder().encode("MZ\u0090\u0000 synthetic executable header");
  test("rejects an unsupported document type", () => {
    const r = validateEvidenceUpload({ documentType: "brochure", filename: "x.pdf", mimeType: "application/pdf", byteSize: pdfBytes.length, bytes: pdfBytes });
    assert.equal(r.valid, false);
    if (!r.valid) assert.equal(r.reasonCode, "UNSUPPORTED_DOCUMENT_TYPE");
  });
  test("rejects a declared MIME type that does not match the real bytes", () => {
    const r = validateEvidenceUpload({ documentType: "death_certificate", filename: "x.pdf", mimeType: "image/png", byteSize: pdfBytes.length, bytes: pdfBytes });
    assert.equal(r.valid, false);
    if (!r.valid) assert.equal(r.reasonCode, "MIME_EXTENSION_MISMATCH");
  });
  test("rejects an extension that does not match the real bytes", () => {
    const r = validateEvidenceUpload({ documentType: "death_certificate", filename: "x.png", mimeType: "application/pdf", byteSize: pdfBytes.length, bytes: pdfBytes });
    assert.equal(r.valid, false);
    if (!r.valid) assert.equal(r.reasonCode, "SIGNATURE_MISMATCH");
  });
  test("rejects a Word document as claim evidence (policy-side only)", () => {
    const docx = new TextEncoder().encode("PK\u0003\u0004 word/document.xml synthetic zip entry listing");
    const r = validateEvidenceUpload({ documentType: "death_certificate", filename: "x.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: docx.length, bytes: docx });
    assert.equal(r.valid, false);
    if (!r.valid) assert.equal(r.reasonCode, "UNSUPPORTED_FORMAT");
  });
  test("rejects an executable whatever it is called", () => {
    const r = validateEvidenceUpload({ documentType: "death_certificate", filename: "x.pdf", mimeType: "application/pdf", byteSize: exeBytes.length, bytes: exeBytes });
    assert.equal(r.valid, false);
    if (!r.valid) assert.equal(r.reasonCode, "EXECUTABLE_FILE");
  });
  test("rejects an oversized file", () => {
    const r = validateEvidenceUpload({ documentType: "death_certificate", filename: "x.pdf", mimeType: "application/pdf", byteSize: 26 * 1024 * 1024, bytes: pdfBytes });
    assert.equal(r.valid, false);
    if (!r.valid) assert.equal(r.reasonCode, "FILE_TOO_LARGE");
  });
  test("rejects an empty file", () => {
    const r = validateEvidenceUpload({ documentType: "death_certificate", filename: "x.pdf", mimeType: "application/pdf", byteSize: 0, bytes: new Uint8Array(0) });
    assert.equal(r.valid, false);
    if (!r.valid) assert.equal(r.reasonCode, "EMPTY_FILE");
  });
  test("accepts a well-formed PDF upload", () => {
    const r = validateEvidenceUpload({ documentType: "police_report", filename: "report.pdf", mimeType: "application/pdf", byteSize: pdfBytes.length, bytes: pdfBytes });
    assert.equal(r.valid, true);
  });
  test("accepts a phone photo (PNG) as claim evidence", () => {
    const r = validateEvidenceUpload({ documentType: "hospital_bill", filename: "bill.png", mimeType: "image/png", byteSize: pngBytes.length, bytes: pngBytes });
    assert.equal(r.valid, true);
    if (r.valid) assert.equal(r.format, "png");
  });
  test("looksLikePdf checks real magic bytes, not the filename", () => {
    assert.equal(looksLikePdf(new TextEncoder().encode("%PDF-1.4 rest")), true);
    assert.equal(looksLikePdf(new TextEncoder().encode("not a pdf at all")), false);
  });
  test("isSupportedDocumentType rejects anything outside the five known types", () => {
    assert.equal(isSupportedDocumentType("death_certificate"), true);
    assert.equal(isSupportedDocumentType("brochure"), false);
    assert.equal(isSupportedDocumentType(42), false);
  });

  test("state machine: uploaded -> quarantined -> processing -> extracted -> needs_review -> matched is valid step by step", () => {
    const chain: [string, string][] = [["uploaded","quarantined"],["quarantined","processing"],["processing","extracted"],["extracted","needs_review"],["needs_review","matched"]];
    for (const [from, to] of chain as [never, never][]) assert.equal(isValidEvidenceTransition(from, to), true, `${from} -> ${to}`);
  });
  test("state machine: rejects skipping review (uploaded -> matched, extracted -> matched)", () => {
    assert.equal(isValidEvidenceTransition("uploaded" as never, "matched" as never), false);
    assert.equal(isValidEvidenceTransition("extracted" as never, "matched" as never), false);
    assert.throws(() => assertValidEvidenceTransition("uploaded" as never, "matched" as never), InvalidEvidenceTransitionError);
  });
  test("state machine: rejects a self-transition and a transition out of a terminal state", () => {
    assert.equal(isValidEvidenceTransition("needs_review" as never, "needs_review" as never), false);
    assert.equal(isValidEvidenceTransition("rejected" as never, "needs_review" as never), false);
  });
  test("state machine: a failed document can resume into processing", () => {
    assert.equal(isValidEvidenceTransition("failed" as never, "processing" as never), true);
  });

  const familyMember = { displayName: "Tan Yi Chuen Raymond", preferredName: "Raymond" };
  const baseFields: ClaimEvidenceExtractedFields = {
    deceasedName: "Tan Yi Chuen Raymond", otherNamesMentioned: [], personIdentifiers: [{ label: "NRIC", value: "S1234567A" }],
    dateOfDeath: "2026-09-01", statedCauseOfDeath: "Blunt force trauma from a road traffic accident", mannerOfDeath: "accident",
    issuingAuthority: "Singapore Police Force", documentReference: "SPF/2026/00123", documentType: "police_report",
    pageCitations: [{ field: "statedCauseOfDeath", pageStart: 1, pageEnd: 1, excerpt: "Blunt force trauma from a road traffic accident" }],
    confidence: { deceasedName: 0.95 },
  };
  test("identity: a clean, unambiguous match is confirmed", () => {
    const r = evaluateClaimEvidenceIdentity({ familyMember, fields: baseFields, existingDeathDate: null, reusedDocuments: [], claimSessionId: "c1", familyMemberId: "m1" });
    assert.equal(r.status, "confirmed");
    assert.equal(r.conflicts.length, 0);
  });
  test("identity: a missing deceased name always needs review", () => {
    const r = evaluateClaimEvidenceIdentity({ familyMember, fields: { ...baseFields, deceasedName: null }, existingDeathDate: null, reusedDocuments: [], claimSessionId: "c1", familyMemberId: "m1" });
    assert.equal(r.status, "needs_review");
    assert.ok(r.conflicts.some((c) => c.code === "MISSING_IDENTIFIERS"));
  });
  test("identity: a wrong deceased person is a mismatch, not needs_review", () => {
    const r = evaluateClaimEvidenceIdentity({ familyMember, fields: { ...baseFields, deceasedName: "Someone Entirely Different" }, existingDeathDate: null, reusedDocuments: [], claimSessionId: "c1", familyMemberId: "m1" });
    assert.equal(r.status, "mismatch");
    assert.ok(r.conflicts.some((c) => c.code === "NAME_MISMATCH"));
  });
  test("identity: similar but not identical family-member names still confirm on strong overlap", () => {
    const r = evaluateClaimEvidenceIdentity({ familyMember, fields: { ...baseFields, deceasedName: "Raymond Tan Yi Chuen" }, existingDeathDate: null, reusedDocuments: [], claimSessionId: "c1", familyMemberId: "m1" });
    assert.equal(r.status, "confirmed");
  });
  test("identity: missing identifiers alone forces needs_review even with a name match", () => {
    const r = evaluateClaimEvidenceIdentity({ familyMember, fields: { ...baseFields, personIdentifiers: [] }, existingDeathDate: null, reusedDocuments: [], claimSessionId: "c1", familyMemberId: "m1" });
    assert.equal(r.status, "needs_review");
    assert.ok(r.conflicts.some((c) => c.code === "MISSING_IDENTIFIERS"));
  });
  test("identity: multiple people mentioned in the document forces needs_review, never resolved silently", () => {
    const r = evaluateClaimEvidenceIdentity({ familyMember, fields: { ...baseFields, otherNamesMentioned: ["Another Person"] }, existingDeathDate: null, reusedDocuments: [], claimSessionId: "c1", familyMemberId: "m1" });
    assert.equal(r.status, "needs_review");
    assert.ok(r.conflicts.some((c) => c.code === "MULTIPLE_PEOPLE_MENTIONED"));
  });
  test("identity: a conflicting date of death forces needs_review", () => {
    const r = evaluateClaimEvidenceIdentity({ familyMember, fields: baseFields, existingDeathDate: "2026-01-01", reusedDocuments: [], claimSessionId: "c1", familyMemberId: "m1" });
    assert.equal(r.status, "needs_review");
    assert.ok(r.conflicts.some((c) => c.code === "CONFLICTING_DATE_OF_DEATH"));
  });
  test("identity: a matching (same-day) date of death raises no conflict", () => {
    const r = evaluateClaimEvidenceIdentity({ familyMember, fields: baseFields, existingDeathDate: "2026-09-01", reusedDocuments: [], claimSessionId: "c1", familyMemberId: "m1" });
    assert.equal(r.conflicts.some((c) => c.code === "CONFLICTING_DATE_OF_DEATH"), false);
  });
  test("identity: a document already used for a different claim is flagged, never silently reused", () => {
    const other = { family_member_id: "m1", claim_session_id: "OTHER-CLAIM" } as ClaimEvidenceDocumentRow;
    const r = evaluateClaimEvidenceIdentity({ familyMember, fields: baseFields, existingDeathDate: null, reusedDocuments: [other], claimSessionId: "c1", familyMemberId: "m1" });
    assert.equal(r.status, "needs_review");
    assert.ok(r.conflicts.some((c) => c.code === "REUSED_FOR_ANOTHER_CLAIM"));
  });
  test("identity: a document already used for a different family member is flagged", () => {
    const other = { family_member_id: "OTHER-MEMBER", claim_session_id: "c1" } as ClaimEvidenceDocumentRow;
    const r = evaluateClaimEvidenceIdentity({ familyMember, fields: baseFields, existingDeathDate: null, reusedDocuments: [other], claimSessionId: "c1", familyMemberId: "m1" });
    assert.equal(r.status, "needs_review");
    assert.ok(r.conflicts.some((c) => c.code === "REUSED_FOR_ANOTHER_FAMILY_MEMBER"));
  });

  test("extraction schema: rejects a malformed model payload", () => {
    const result = ClaimEvidenceExtractionSchema.safeParse({ deceasedName: 123, otherNamesMentioned: "not-an-array" });
    assert.equal(result.success, false);
  });
  test("extraction schema: accepts a well-formed proposal with every field null/empty", () => {
    const result = ClaimEvidenceExtractionSchema.safeParse({
      deceasedName: null, otherNamesMentioned: [], personIdentifiers: [], dateOfDeath: null, statedCauseOfDeath: null,
      mannerOfDeath: null, issuingAuthority: null, documentReference: null, documentType: null, pageCitations: [], confidence: {},
    });
    assert.equal(result.success, true);
  });

  // --- Calculator integration: pipeline-shaped CauseDefinitionMatch objects.
  const definitionEvidenceA = { policyId: "policyA", chunkId: "page:policyA:5", pageStart: 5, pageEnd: 5 };
  const definitionEvidenceB = { policyId: "policyA", chunkId: "page:policyA:9", pageStart: 9, pageEnd: 9 }; // same policy, different (e.g. reprocessed) wording location
  const baseInput = {
    ownership: { contractId: "policyA", coverageId: "covA" },
    familyMember: { id: "m1", confirmed: true },
    claimEventId: "claim-1",
    deathConfirmed: true, dateOfDeath: "2026-09-01", sumInsured: 600_000, currency: "SGD",
    formula: { kind: "sum_insured_fraction" as const, fraction: 1, evidence: { policyId: "policyA", chunkId: "page:policyA:5", pageStart: 5, pageEnd: 5 } },
    ruleEvidence: { policyId: "policyA", chunkId: "page:policyA:5", pageStart: 5, pageEnd: 5 },
    ownershipEvidence: { policyId: "policyA", chunkId: "coverage:covA", coverageId: "covA", familyMemberId: "m1" },
    accidentalDeathDefinitionEvidence: definitionEvidenceA,
  };
  const matchFor = (definitionEvidence: typeof definitionEvidenceA, contractId = "policyA", coverageId = "covA"): CauseDefinitionMatch => ({
    familyMemberId: "m1", claimEventId: "claim-1", contractId, coverageId,
    causeEvidence: { documentId: "doc-1", documentType: "police_report", familyMemberId: "m1", claimEventId: "claim-1", pageStart: 1, pageEnd: 1 },
    definitionEvidence, result: "matches", reviewedAt: "2026-09-02", provenance: verifiedEvidenceProvenance("doc-1"),
  });

  test("calculator: no match on file blocks, no amount", () => {
    const r = calculateAccidentalDeath({ ...baseInput, causeDefinitionMatch: null });
    assert.equal(r.status, "blocked");
  });
  test("calculator: a match reviewed against an earlier/different wording location never unlocks the current definition", () => {
    const r = calculateAccidentalDeath({ ...baseInput, causeDefinitionMatch: matchFor(definitionEvidenceB) });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_DEFINITION_MISMATCH");
  });
  test("calculator: a match confirmed for a different contract (policy B) never unlocks policy A's calculation", () => {
    const r = calculateAccidentalDeath({ ...baseInput, causeDefinitionMatch: matchFor(definitionEvidenceA, "policyB", "covB") });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_CONTRACT_MISMATCH");
  });
  test("calculator: a fully validated, policy-specific match unlocks a calculated amount", () => {
    const r = calculateAccidentalDeath({ ...baseInput, causeDefinitionMatch: matchFor(definitionEvidenceA) });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") assert.equal(r.potentialAmount, 600_000);
  });
  test("calculator: does_not_match is not_applicable, not a calculated amount", () => {
    const r = calculateAccidentalDeath({ ...baseInput, causeDefinitionMatch: { ...matchFor(definitionEvidenceA), result: "does_not_match" } });
    assert.equal(r.status, "not_applicable");
  });
  test("calculator: changing the cause-evidence document changes the calculation ID; identical inputs reproduce it", () => {
    const r1 = calculateAccidentalDeath({ ...baseInput, causeDefinitionMatch: matchFor(definitionEvidenceA) });
    const r2 = calculateAccidentalDeath({ ...baseInput, causeDefinitionMatch: matchFor(definitionEvidenceA) });
    const differentDoc = calculateAccidentalDeath({ ...baseInput, causeDefinitionMatch: { ...matchFor(definitionEvidenceA), causeEvidence: { documentId: "doc-2", documentType: "death_certificate", familyMemberId: "m1", claimEventId: "claim-1", pageStart: 1, pageEnd: 1 }, provenance: verifiedEvidenceProvenance("doc-2") } });
    assert.equal(r1.status, "calculated"); assert.equal(r2.status, "calculated"); assert.equal(differentDoc.status, "calculated");
    if (r1.status === "calculated" && r2.status === "calculated" && differentDoc.status === "calculated") {
      assert.equal(r1.calculationId, r2.calculationId);
      assert.notEqual(r1.calculationId, differentDoc.calculationId);
    }
  });

  // --- Evidence-document resolution precedence (production fix for the
  // ambiguity PR #9 exposed: resolveDeathEvidence() must never pick between
  // two equally-qualified policy documents by insurer/group/wording alone).
  {
    const wordingPages = fixture.benefitSummary.pages.map((p) => ({ page_number: p.pageNumber, text: p.text }));
    const coverage = (overrides: Partial<{ id: string; policyId: string }> = {}) => ({
      id: overrides.id ?? "coverage-1", policyId: overrides.policyId ?? "policy-own", familyMemberId: "member-1",
      category: "Personal Accident", amount: 600_000, currency: "SGD", productName: "Group Personal Accident",
      sourcePage: null, evidenceText: null, insurer: "Singlife", policyName: "Group Personal Accident",
      policyNumber: null, groupPolicyNumber: "G007500", documentRole: "certificate", effectiveDate: null, renewalOrExpiryDate: null,
    });
    const documentPages = (policyId: string, opts: { role?: string; personalConfirmed?: boolean; linked?: boolean; text?: typeof wordingPages } = {}): DeathWordingPage[] =>
      (opts.text ?? wordingPages).map((p) => ({
        policy_id: policyId, page_number: p.page_number, text: p.text, group_policy_number: "G007500",
        insurer: "Singlife", product_name: "Group Personal Accident", original_filename: `${policyId}.pdf`,
        document_role: opts.role ?? "certificate", personal_coverage_confirmed: opts.personalConfirmed ?? true, linked_to_member: opts.linked ?? false,
      }));
    const noClausePages = (policyId: string): DeathWordingPage[] => [{
      policy_id: policyId, page_number: 1, text: "Table of contents. See the enclosed schedule for your Sum Insured.",
      group_policy_number: "G007500", insurer: "Singlife", product_name: "Group Personal Accident", original_filename: `${policyId}.pdf`,
      document_role: "certificate", personal_coverage_confirmed: true, linked_to_member: false,
    }];

    test("resolveDeathEvidence: a coverage's own policy document resolves directly (tier 1)", () => {
      const rows = documentPages("policy-own");
      const { rules, gaps } = resolveDeathEvidence([coverage()], rows);
      assert.equal(gaps.length, 0);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].citation.policyId, "policy-own");
    });

    test("resolveDeathEvidence: the own document is used even when it appears AFTER a matching linked document in row order (order-independence -- the exact production bug)", () => {
      // The linked document is inserted first in the rows array, and it also
      // carries byte-identical wording, but it must never be picked over the
      // coverage's own policy document: iteration/row order must not matter.
      const rows = [...documentPages("policy-linked", { role: "policy_wording", personalConfirmed: false, linked: true }), ...documentPages("policy-own")];
      const { rules, gaps } = resolveDeathEvidence([coverage()], rows);
      assert.equal(gaps.length, 0);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].citation.policyId, "policy-own", "must resolve from the coverage's own document, not the linked one, regardless of row order");
    });

    test("resolveDeathEvidence: two genuinely linked policies with byte-identical wording fail closed as ambiguous (no own document present)", () => {
      const rows = [
        ...documentPages("policy-linked-1", { role: "policy_wording", personalConfirmed: false, linked: true }),
        ...documentPages("policy-linked-2", { role: "policy_wording", personalConfirmed: false, linked: true }),
      ];
      const { rules, gaps } = resolveDeathEvidence([coverage({ policyId: "policy-none" })], rows);
      assert.equal(rules.length, 0, "an ambiguous tier must never contribute a rule");
      assert.equal(gaps.length, 1);
      assert.equal(gaps[0].reasonCode, "AMBIGUOUS_EVIDENCE");
    });

    test("resolveDeathEvidence: a single explicitly-linked document (tier 4) resolves when there is no own document", () => {
      const rows = documentPages("policy-linked-only", { role: "policy_wording", personalConfirmed: false, linked: true });
      const { rules, gaps } = resolveDeathEvidence([coverage({ policyId: "policy-none" })], rows);
      assert.equal(gaps.length, 0);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].citation.policyId, "policy-linked-only");
    });

    test("resolveDeathEvidence: an unlinked shared-reference document (tier 5) resolves only when nothing stronger is available", () => {
      const rows = documentPages("policy-reference-only", { role: "product_summary", personalConfirmed: false, linked: false });
      const { rules, gaps } = resolveDeathEvidence([coverage({ policyId: "policy-none" })], rows);
      assert.equal(gaps.length, 0);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].citation.policyId, "policy-reference-only");
    });

    test("resolveDeathEvidence: two unlinked shared-reference documents also fail closed as ambiguous, even with identical wording", () => {
      const rows = [
        ...documentPages("policy-ref-1", { role: "product_summary", personalConfirmed: false, linked: false }),
        ...documentPages("policy-ref-2", { role: "benefit_guide", personalConfirmed: false, linked: false }),
      ];
      const { rules, gaps } = resolveDeathEvidence([coverage({ policyId: "policy-none" })], rows);
      assert.equal(rules.length, 0);
      assert.equal(gaps.length, 1);
      assert.equal(gaps[0].reasonCode, "AMBIGUOUS_EVIDENCE");
    });

    test("resolveDeathEvidence: a linked candidate (tier 4) is preferred over an unlinked reference candidate (tier 5), never mixed into one ambiguity", () => {
      const rows = [
        ...documentPages("policy-linked-pref", { role: "policy_wording", personalConfirmed: false, linked: true }),
        ...documentPages("policy-ref-weaker", { role: "product_summary", personalConfirmed: false, linked: false }),
      ];
      const { rules, gaps } = resolveDeathEvidence([coverage({ policyId: "policy-none" })], rows);
      assert.equal(gaps.length, 0);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].citation.policyId, "policy-linked-pref");
    });

    test("resolveDeathEvidence: an own document with no matching clause falls through to a single linked candidate rather than blocking", () => {
      const rows = [...noClausePages("policy-own-empty"), ...documentPages("policy-linked-fallback", { role: "policy_wording", personalConfirmed: false, linked: true })];
      const { rules, gaps } = resolveDeathEvidence([coverage({ policyId: "policy-own-empty" })], rows);
      assert.equal(gaps.length, 0);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].citation.policyId, "policy-linked-fallback");
    });

    test("resolveDeathEvidence: no matching document at all produces a NO_MATCHING_DOCUMENT gap, not an amount", () => {
      const { rules, gaps } = resolveDeathEvidence([coverage({ policyId: "policy-none" })], []);
      assert.equal(rules.length, 0);
      assert.equal(gaps.length, 1);
      assert.equal(gaps[0].reasonCode, "NO_MATCHING_DOCUMENT");
    });
  }
}

// ---------------------------------------------------------------------
// 2. Database-backed tests (PGlite)
// ---------------------------------------------------------------------

async function runDatabaseTests() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));

  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; }); await previous; return release;
  };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) {
      const results = await db.exec(text); const result = results.at(-1);
      return { rows: result?.rows ?? [], rowCount: result?.affectedRows ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release };
  }) as typeof pool.connect;

  try {
    const { ensureClaimEvidenceSchema } = await import("@/lib/claims/evidence/schema");
    await ensureClaimEvidenceSchema();
    // Checkpoint 7: lib/claims/evidence/store.ts and lib/claims/evidence.ts now
    // filter on lifecycle_state (claim_evidence_documents/policies) via
    // activePredicate() -- exec sql/lifecycle.sql now that the table actually
    // exists (ensureClaimEvidenceSchema() just created it above; lifecycle.sql's
    // claim_evidence_documents ALTER is a no-op if run before the table exists).
    await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));
    const {
      createEvidenceDocument, getEvidenceDocument, getScopedEvidenceDocument, listEvidenceDocuments,
      findReusedEvidenceAcrossScopes, transitionEvidenceStatus, recordExtraction, getLatestExtraction,
      recordCauseDefinitionMatch, loadActiveCauseDefinitionMatches, supersedeEvidenceDocument,
    } = await import("@/lib/claims/evidence/store");
    const { appendClaimEvidenceAudit, listClaimEvidenceAudit } = await import("@/lib/claims/evidence/audit");
    const { processClaimEvidence, reprocessNeedsAttention } = await import("@/lib/claims/evidence/pipeline");
    const { confirmCauseDefinitionMatch, ClaimEvidenceMatchError } = await import("@/lib/claims/evidence/matches");
    const { loadCauseDefinitionMatchesForFacts } = await import("@/lib/claims/evidence/session-matches");

    const account = "10000000-0000-4000-8000-000000000001";
    const otherAccount = "10000000-0000-4000-8000-000000000099";
    const raymond = "20000000-0000-4000-8000-000000000001";
    const otherMember = "20000000-0000-4000-8000-000000000002";
    const claimA = "30000000-0000-4000-8000-000000000001";
    const claimB = "30000000-0000-4000-8000-000000000002";
    const policyA = "40000000-0000-4000-8000-0000000000a1";
    const policyB = "40000000-0000-4000-8000-0000000000b1";
    const coverageA = "50000000-0000-4000-8000-0000000000a1";
    const coverageB = "50000000-0000-4000-8000-0000000000b1";

    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Test'),($2,'Other')`, [account, otherAccount]);
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Tan Yi Chuen Raymond','Raymond','self'),($3,$2,'Other Member','Other','spouse')`, [raymond, account, otherMember]);
    await pool.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_type) VALUES($1,$2,$3,'fact_finding','death'),($4,$2,$3,'fact_finding','death')`, [claimA, account, raymond, claimB]);

    const pages = fixture.benefitSummary.pages.map((p) => ({ page_number: p.pageNumber, text: p.text }));
    for (const [policyId, groupNumber] of [[policyA, "G007500"], [policyB, "G007500"]] as const) {
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,group_policy_number,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,document_authority,quarantine_status)
         VALUES($1,$2,$3,'Singlife','Group Personal Accident',$4,'certificate',true,'ready','cert.pdf','k',90,'scan_clean')`,
        [policyId, account, raymond, groupNumber],
      );
      for (const p of pages) await pool.query(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)`, [account, policyId, p.page_number, p.text]);
    }
    // lib/claims/death-evidence.ts's loadDeathEvidence() only reads a
    // policy's own wording pages when EITHER policy_members links it to the
    // family member being asked about, OR it is an unlinked shared reference
    // document (personal_coverage_confirmed=false with a recognised
    // reference role) -- a per-member personal certificate like these
    // (personal_coverage_confirmed=true, document_role 'certificate') has to
    // be the former. Only policyA is linked here (matching the only policy
    // this suite ever calls confirmCauseDefinitionMatch against): linking
    // BOTH policyA and policyB, despite them carrying byte-identical wording
    // fixtures, would make resolveDeathEvidence's per-coverage document
    // search -- which is not required to prefer a coverage's own policy
    // document over any other linked/shared document with a matching
    // insurer and group -- non-deterministically resolve coverageA's own
    // accidental-death definition citation from policyB's document instead
    // of policyA's, depending on row ordering. policyB is exercised below
    // only through hand-constructed evidence, never through
    // confirmCauseDefinitionMatch, so it needs no policy_members link.
    await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')`, [policyA, raymond, account]);
    await pool.query(
      `INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,confirmed,evidence_verified,product_name)
       VALUES($1,$2,$3,$4,'Personal Accident',600000,'SGD',true,true,'Group Personal Accident'),
             ($5,$2,$6,$4,'Personal Accident',600000,'SGD',true,true,'Group Personal Accident')`,
      [coverageA, account, policyA, raymond, coverageB, policyB],
    );

    await testAsync("createEvidenceDocument: duplicate upload for the same claim is idempotent", async () => {
      const first = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "report.pdf", storageKey: "k1", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-1" });
      assert.equal(first.created, true);
      const second = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "report.pdf", storageKey: "k1", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-1" });
      assert.equal(second.created, false);
      assert.equal(second.document.id, first.document.id);
    });

    await testAsync("cross-account access: a document cannot be read through another account's id", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "death_certificate", originalFilename: "dc.pdf", storageKey: "k2", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-2" });
      assert.equal(await getEvidenceDocument(otherAccount, document.id), null);
      assert.equal(await getEvidenceDocument(account, document.id) !== null, true);
    });

    await testAsync("cross-family-member and cross-claim scoping: the full ownership chain is required, not just the id", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "coroners_report", originalFilename: "cor.pdf", storageKey: "k3", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-3" });
      assert.equal(await getScopedEvidenceDocument({ accountId: account, familyMemberId: otherMember, claimSessionId: claimA, id: document.id }), null);
      assert.equal(await getScopedEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimB, id: document.id }), null);
      assert.notEqual(await getScopedEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, id: document.id }), null);
    });

    await testAsync("reused-evidence detection never looks outside the account, and flags reuse within it", async () => {
      const first = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "reused.pdf", storageKey: "k4", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-reused" });
      assert.equal(first.created, true);
      // Same bytes, different claim, same account -- must be visible.
      const sameAccountOtherClaim = await findReusedEvidenceAcrossScopes({ accountId: account, familyMemberId: raymond, claimSessionId: claimB, fileHash: "hash-reused" });
      assert.equal(sameAccountOtherClaim.length, 1);
      // Same bytes, different account entirely -- must never be visible.
      const crossAccount = await findReusedEvidenceAcrossScopes({ accountId: otherAccount, familyMemberId: raymond, claimSessionId: claimA, fileHash: "hash-reused" });
      assert.equal(crossAccount.length, 0);
    });

    await testAsync("invalid transitions are rejected; duplicate/retried transitions are safe no-ops", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "t.pdf", storageKey: "k5", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-5" });
      await assert.rejects(transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "matched" }));
      const moved = await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined" });
      assert.notEqual(moved, null);
      // Simulates a duplicated webhook/job delivery retrying the same
      // transition after another worker already applied it.
      const retried = await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined" });
      assert.equal(retried, null);
    });

    await testAsync("extraction recording is idempotent per document version; retries never fork the row", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "e.pdf", storageKey: "k6", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-6" });
      const fields: ClaimEvidenceExtractedFields = { deceasedName: "Tan Yi Chuen Raymond", otherNamesMentioned: [], personIdentifiers: [{ label: "NRIC", value: "S1234567A" }], dateOfDeath: "2026-09-01", statedCauseOfDeath: "Road traffic accident", mannerOfDeath: "accident", issuingAuthority: "SPF", documentReference: "ref-1", documentType: "police_report", pageCitations: [{ field: "statedCauseOfDeath", pageStart: 1, pageEnd: 1, excerpt: "Road traffic accident" }], confidence: {} };
      const first = await recordExtraction({ accountId: account, evidenceDocumentId: document.id, sourceDocumentVersion: "hash-6", extractedFields: fields, extractionModel: "test-model", extractionProvider: "test", extractionVersion: "v1", identityConflicts: [] });
      const retried = await recordExtraction({ accountId: account, evidenceDocumentId: document.id, sourceDocumentVersion: "hash-6", extractedFields: fields, extractionModel: "test-model", extractionProvider: "test", extractionVersion: "v1", identityConflicts: [] });
      assert.equal(first.id, retried.id);
      const latest = await getLatestExtraction(account, document.id);
      assert.equal(latest?.id, first.id);
    });

    await testAsync("processClaimEvidence resuming an already-reviewed document is a silent no-op (retry/duplicate delivery safe)", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "resume.pdf", storageKey: "k7", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-7" });
      // Seeded directly at needs_review, bypassing the real extraction call --
      // this test is about idempotent resumption, not model output.
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "quarantined", to: "processing" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "processing", to: "extracted" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "extracted", to: "needs_review" });
      const before = await listClaimEvidenceAudit(account, claimA);
      await processClaimEvidence({ accountId: account, documentId: document.id });
      const after = await listClaimEvidenceAudit(account, claimA);
      assert.equal(after.length, before.length);
      const stillReview = await getEvidenceDocument(account, document.id);
      assert.equal(stillReview?.status, "needs_review");
    });

    await testAsync("audit-trail creation: every action is recorded and readable per claim", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "audit.pdf", storageKey: "k8", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-8" });
      await appendClaimEvidenceAudit(account, { actor: "household", action: "uploaded", evidenceDocumentId: document.id, claimSessionId: claimA });
      const rows = await listClaimEvidenceAudit(account, claimA);
      assert.ok(rows.some((r) => r.evidence_document_id === document.id && r.action === "uploaded"));
    });

    await testAsync("supersession: a corrected re-upload invalidates any match built from the old document", async () => {
      const { document: oldDoc } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "old.pdf", storageKey: "k9a", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-9a" });
      const match = await recordCauseDefinitionMatch({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, contractId: policyA, coverageId: coverageA, evidenceDocumentId: oldDoc.id, causeEvidence: { documentId: oldDoc.id }, definitionEvidence: { policyId: policyA }, result: "matches", reviewedBy: "Reviewer", reason: null });
      assert.equal(match.superseded_at, null);
      const { document: newDoc } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "new.pdf", storageKey: "k9b", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-9b" });
      await supersedeEvidenceDocument({ accountId: account, oldId: oldDoc.id, newId: newDoc.id, reason: "Corrected re-upload." });
      const active = await loadActiveCauseDefinitionMatches(account, raymond, claimA);
      assert.equal(active.some((m) => m.id === match.id), false);
    });

    await testAsync("recordCauseDefinitionMatch supersedes the prior active match for the same scope, never leaving two active", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "scope.pdf", storageKey: "k10", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-10" });
      await recordCauseDefinitionMatch({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, contractId: policyA, coverageId: coverageA, evidenceDocumentId: document.id, causeEvidence: {}, definitionEvidence: {}, result: "needs_review", reviewedBy: "R1", reason: null });
      await recordCauseDefinitionMatch({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, contractId: policyA, coverageId: coverageA, evidenceDocumentId: document.id, causeEvidence: {}, definitionEvidence: {}, result: "matches", reviewedBy: "R2", reason: null });
      const active = await loadActiveCauseDefinitionMatches(account, raymond, claimA);
      const scoped = active.filter((m) => m.contract_id === policyA && m.coverage_id === coverageA);
      assert.equal(scoped.length, 1);
      assert.equal(scoped[0].result, "matches");
    });

    await testAsync("confirmCauseDefinitionMatch: rejects when the evidence document is not found under this scope (unauthorized review action)", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "wrongscope.pdf", storageKey: "k11", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-11" });
      await assert.rejects(
        confirmCauseDefinitionMatch({ accountId: account, reviewerName: "R", familyMemberId: otherMember, claimSessionId: claimA, evidenceDocumentId: document.id, contractId: policyA, coverageId: coverageA, result: "matches" }),
        ClaimEvidenceMatchError,
      );
    });

    await testAsync("confirmCauseDefinitionMatch: rejects confirming a match while the document has not finished processing", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "notready.pdf", storageKey: "k12", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-12" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined" });
      await assert.rejects(
        confirmCauseDefinitionMatch({ accountId: account, reviewerName: "R", familyMemberId: raymond, claimSessionId: claimA, evidenceDocumentId: document.id, contractId: policyA, coverageId: coverageA, result: "matches" }),
        ClaimEvidenceMatchError,
      );
    });

    await testAsync("confirmCauseDefinitionMatch: rejects confirming a MATCH before identity is confirmed", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "idpending.pdf", storageKey: "k13", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-13" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "quarantined", to: "processing" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "processing", to: "extracted", identityStatus: "needs_review" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "extracted", to: "needs_review" });
      await recordExtraction({ accountId: account, evidenceDocumentId: document.id, sourceDocumentVersion: "hash-13", extractedFields: { deceasedName: "Tan Yi Chuen Raymond", otherNamesMentioned: [], personIdentifiers: [], dateOfDeath: null, statedCauseOfDeath: "Accident", mannerOfDeath: "accident", issuingAuthority: null, documentReference: null, documentType: "police_report", pageCitations: [{ field: "statedCauseOfDeath", pageStart: 1, pageEnd: 1, excerpt: "test" }], confidence: {} }, extractionModel: "m", extractionProvider: "p", extractionVersion: "v1", identityConflicts: [] });
      await assert.rejects(
        confirmCauseDefinitionMatch({ accountId: account, reviewerName: "R", familyMemberId: raymond, claimSessionId: claimA, evidenceDocumentId: document.id, contractId: policyA, coverageId: coverageA, result: "matches" }),
        ClaimEvidenceMatchError,
      );
      // A non-"matches" result (still gathering review) is NOT gated on
      // identity confirmation -- only actually unlocking an amount is.
      const deferred = await confirmCauseDefinitionMatch({ accountId: account, reviewerName: "R", familyMemberId: raymond, claimSessionId: claimA, evidenceDocumentId: document.id, contractId: policyA, coverageId: coverageA, result: "needs_review" });
      assert.equal(deferred.result, "needs_review");
    });

    await testAsync("confirmCauseDefinitionMatch end to end: a reviewed match without persisted model provenance fails closed for every policy", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "e2e.pdf", storageKey: "k14", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-14" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "quarantined", to: "processing" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "processing", to: "extracted", identityStatus: "confirmed" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "extracted", to: "needs_review" });
      await recordExtraction({
        accountId: account, evidenceDocumentId: document.id, sourceDocumentVersion: "hash-14",
        extractedFields: { deceasedName: "Tan Yi Chuen Raymond", otherNamesMentioned: [], personIdentifiers: [{ label: "NRIC", value: "S1234567A" }], dateOfDeath: "2026-09-14", statedCauseOfDeath: "Motorbike accident", mannerOfDeath: "accident", issuingAuthority: "SPF", documentReference: "ref", documentType: "police_report", pageCitations: [{ field: "statedCauseOfDeath", pageStart: pages[0].page_number, pageEnd: pages[0].page_number, excerpt: pages[0].text.slice(0, 40) }], confidence: {} },
        extractionModel: "m", extractionProvider: "p", extractionVersion: "v1", identityConflicts: [],
      });

      const match = await confirmCauseDefinitionMatch({ accountId: account, reviewerName: "Household reviewer", familyMemberId: raymond, claimSessionId: claimA, evidenceDocumentId: document.id, contractId: policyA, coverageId: coverageA, result: "matches" });
      assert.equal(match.result, "matches");
      const matchedDoc = await getEvidenceDocument(account, document.id);
      assert.equal(matchedDoc?.status, "matched");

      const facts = await loadCauseDefinitionMatchesForFacts(account, raymond, claimA);
      // Decisions are identified per evidence document: earlier cases in this
      // suite left their own (still active) decisions on other documents.
      const forPolicyA = facts.find((m) => m.contractId === policyA && (m.causeEvidence as { documentId?: string }).documentId === document.id);
      assert.ok(forPolicyA);

      const definitionA = { policyId: policyA, chunkId: `page:${policyA}:5`, pageStart: 5, pageEnd: 5 };
      const definitionB = { policyId: policyB, chunkId: `page:${policyB}:5`, pageStart: 5, pageEnd: 5 };
      const sharedInput = {
        familyMember: { id: raymond, confirmed: true }, claimEventId: claimA, deathConfirmed: true, dateOfDeath: "2026-09-14",
        sumInsured: 600_000, currency: "SGD",
        formula: { kind: "sum_insured_fraction" as const, fraction: 1, evidence: definitionA },
        ruleEvidence: definitionA, ownershipEvidence: { policyId: policyA, chunkId: `coverage:${coverageA}`, coverageId: coverageA, familyMemberId: raymond },
      };
      const resultA = calculateAccidentalDeath({ ...sharedInput, ownership: { contractId: policyA, coverageId: coverageA }, accidentalDeathDefinitionEvidence: definitionA, causeDefinitionMatch: forPolicyA! });
      assert.equal(resultA.status, "blocked");
      if (resultA.status === "blocked") assert.equal(resultA.reasonCode, "EVIDENCE_PROVENANCE_MISSING");

      const resultB = calculateAccidentalDeath({ ...sharedInput, ownership: { contractId: policyB, coverageId: coverageB }, ruleEvidence: definitionB, ownershipEvidence: { policyId: policyB, chunkId: `coverage:${coverageB}`, coverageId: coverageB, familyMemberId: raymond }, formula: { kind: "sum_insured_fraction" as const, fraction: 1, evidence: definitionB }, accidentalDeathDefinitionEvidence: definitionB, causeDefinitionMatch: forPolicyA! });
      assert.equal(resultB.status, "blocked");
    });

    // --- Quarantine gating (launch-hardening: "Only scan_clean documents
    // may be parsed, OCRed, embedded, indexed, or sent to a model") -----

    await testAsync("transitionEvidenceStatus persists the real scan_status column, not just the audit log", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "scanstatus.pdf", storageKey: "k-scanstatus", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-scanstatus" });
      assert.equal(document.scan_status, "pending_scan", "a freshly created document defaults to pending_scan");
      const moved = await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined", scanStatus: "scan_unavailable" });
      assert.equal(moved?.scan_status, "scan_unavailable", "scanStatus must be persisted to the queryable column, not only the audit log");
      const reread = await getEvidenceDocument(account, document.id);
      assert.equal(reread?.scan_status, "scan_unavailable");
    });

    await testAsync("quarantine gate: an unscanned/unavailable-scan document stays quarantined and processClaimEvidence is a safe no-op on it", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "unscanned.pdf", storageKey: "k-unscanned", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-unscanned" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined", scanStatus: "scan_unavailable" });
      const auditForDoc = async () => (await listClaimEvidenceAudit(account, claimA)).filter((r) => r.evidence_document_id === document.id);
      const before = await auditForDoc();

      await processClaimEvidence({ accountId: account, documentId: document.id });
      const afterFirst = await getEvidenceDocument(account, document.id);
      assert.equal(afterFirst?.status, "quarantined", "a document whose scan is not clean must stay quarantined, never silently proceed to processing/extraction/OCR/embedding/model calls");
      assert.equal(afterFirst?.scan_status, "scan_unavailable");

      // Reprocessing (whether a single retry, a duplicate queue delivery,
      // or reprocessNeedsAttention()'s sweep over every RESUMABLE document
      // in the claim session -- which also touches other documents from
      // other tests sharing claimA, so this test's own assertions are
      // scoped to THIS document only) must never bypass the gate -- prove
      // it holds across several repeated calls, not just one.
      await processClaimEvidence({ accountId: account, documentId: document.id });
      await reprocessNeedsAttention(account, claimA);
      const afterRetries = await getEvidenceDocument(account, document.id);
      assert.equal(afterRetries?.status, "quarantined", "reprocessing a quarantined, not-yet-clean document must not bypass quarantine");

      const after = await auditForDoc();
      assert.equal(after.length, before.length, "repeatedly finding this document still not clean must not spam the audit log with a new event every pass");
    });

    await testAsync("quarantine gate: a document whose scan is explicitly clean is allowed past quarantine", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "clean.pdf", storageKey: "k-clean-nonexistent", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-clean" });
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined", scanStatus: "clean" });

      // storageKey does not point at a real stored file in this suite, so
      // the pipeline is expected to fail once it actually tries to read
      // and process the (nonexistent) file -- the point of this test is
      // only that a clean-scanned document is let PAST quarantine at all,
      // unlike the not-yet-clean case above which stays quarantined
      // forever. Reaching "failed" (from the downstream read error) proves
      // that; staying "quarantined" would not.
      //
      // Checkpoint 8 (claude/v1-launch-hardening): processClaimEvidence()
      // now re-throws after recording its own document-level failure (see
      // lib/claims/evidence/pipeline.ts), so a durable-job caller such as
      // lib/jobs/pipeline-worker.ts's runAsDurableJob() actually observes
      // the failure and can classify it -- this direct caller isn't one,
      // so it must expect and swallow that rejection itself.
      await assert.rejects(() => processClaimEvidence({ accountId: account, documentId: document.id }));
      const after = await getEvidenceDocument(account, document.id);
      assert.notEqual(after?.status, "quarantined", "a document with an explicit clean scan result must be allowed past quarantine");
      assert.equal(after?.status, "failed", "the downstream read error must land as a terminal failed status, not silently vanish");
    });

    await testAsync("an infected scan result is persisted to scan_status on the rejected transition too", async () => {
      const { document } = await createEvidenceDocument({ accountId: account, familyMemberId: raymond, claimSessionId: claimA, documentType: "police_report", originalFilename: "infected.pdf", storageKey: "k-infected", mimeType: "application/pdf", byteSize: 100, fileHash: "hash-infected" });
      const moved = await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "rejected", errorCode: "MALWARE_DETECTED", errorMessage: "flagged", scanStatus: "infected" });
      assert.equal(moved?.status, "rejected");
      assert.equal(moved?.scan_status, "infected", "an infected scan result must be persisted to scan_status, not only recorded in the audit log");
    });
  } finally {
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.close();
  }
}

export async function runClaimEvidenceRegressions() {
  runPureTests();
  await runDatabaseTests();
  console.log(`DearPolicy claim-evidence pipeline regressions passed (${cases} cases).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runClaimEvidenceRegressions().catch((error) => { console.error(error); process.exitCode = 1; });
}

/**
 * Cross-product currency provenance (Phase 3).
 *
 * A monetary figure may be calculated, normalised or totalled only when its
 * currency is WRITTEN in the applicable policy evidence: the cover's own
 * certificate line or cited certificate page (sum insured, reviewed bills),
 * or the quoted benefit clause (fixed amounts, caps, daily rates). A stored
 * policy_coverages.currency is never proof -- ingestion and the schema
 * default it to SGD when a document states none -- and a bare "$" names no
 * currency. Nothing is relabelled, converted or added across currencies.
 *
 * Every blocked case has a positive control that calculates once exactly
 * that blocker is corrected. Per-category end-to-end cases (accidental
 * death, critical illness, disability, travel through the real reviewer
 * route, calculator, gate and composition) live in
 * scripts/claim-reviewer-benefit-e2e-regressions.ts.
 */
import assert from "node:assert/strict";
import { checkNonTravelCurrency, currencyStatedIn, statedCurrency, CURRENCY_UNMATCHED_CONDITION } from "@/lib/claims/currency-evidence";
import { coverageCurrencyVerified, type OwnedCoverage } from "@/lib/coverage/facts";
import { assessMedicalClaim, type MedicalRuleEvidence } from "@/lib/claims/medical-rules";
import type { MedicalCashRule, MedicalPlanProvisions, MedicalReimbursementRule } from "@/lib/claims/medical-evidence";
import { evaluateMonetaryEligibility } from "@/lib/claims/monetary-gate";
import { composeClaim } from "@/lib/claims/composition/engine";
import { EMPTY_CLAIM_FACTS, type ClaimAssessmentItem, type ClaimEvidence, type ClaimFacts } from "@/lib/claims/types";
import type { VerifiedMedicalBillFacts } from "@/lib/claims/calculators/evidence";
import { validateCatalogFormula, assessCatalogBenefit, CATALOG_CURRENCY_MISSING, type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import { parseBenefitValue } from "@/lib/policies/benefit-rows";
import { verifiedEvidenceProvenance } from "./fixtures/verified-evidence-provenance";

let cases = 0;
function test(name: string, fn: () => void) {
  try { fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}
const RUNS = 3; // every scenario is run repeatedly: results must be identical

const citation = (policyId = "policy-1"): ClaimEvidence => ({ chunkId: `page:${policyId}:10`, policyId, policyName: "Wording", pageStart: 10, pageEnd: 10, evidenceLabel: "Wording" });
function coverage(o: Partial<OwnedCoverage> = {}): OwnedCoverage {
  return {
    id: "cov-1", policyId: "policy-1", familyMemberId: "fam-1", category: "Hospitalisation", amount: null, currency: "SGD",
    productName: "Hospitalisation Plan", sourcePage: 1, evidenceText: "Hospitalisation Plan, currency of cover: SGD", insurer: "Great Eastern",
    policyName: "Hospitalisation Plan", policyNumber: "H-001", groupPolicyNumber: null, documentRole: "certificate",
    effectiveDate: "2020-01-01", renewalOrExpiryDate: null, currencyVerified: true, policyDocumentVersion: "sha256:v1", ...o,
  };
}
const cashRule = (o: Partial<MedicalCashRule> = {}): MedicalCashRule => ({ coverageId: "cov-1", benefitCode: "med-hospital-cash", dailyRateMinor: 10_000, currency: "SGD", capDays: 30, quote: "S$100 per day of hospitalisation, up to 30 days.", citation: citation(), ...o });
const reimbursementRule = (o: Partial<MedicalReimbursementRule> = {}): MedicalReimbursementRule => ({ coverageId: "cov-1", benefitCode: "med-inpatient", eligibleCategories: ["surgical_fees"], categoryLimits: [], quote: "Inpatient medical benefits as charged.", citation: citation(), ...o });
const provisions = (o: Partial<MedicalPlanProvisions> = {}): MedicalPlanProvisions => ({ coverageId: "cov-1", deductibleMinor: null, coInsurancePercent: null, nonPanelFactor: null, dayCountRule: "calendar_day", edgeInclusion: { admissionDayIncluded: true, dischargeDayIncluded: false }, waitingDays: 0, citation: citation(), ...o });
const ruleEvidence = (o: Partial<MedicalRuleEvidence> = {}): MedicalRuleEvidence => ({ cashRules: [], reimbursementRules: [], planProvisions: [], gaps: [], ...o });
function bills(o: Partial<VerifiedMedicalBillFacts> = {}): VerifiedMedicalBillFacts {
  const f: VerifiedMedicalBillFacts = { lineItems: [], thirdPartyPayments: [], admissionISO: "2024-06-01T00:00:00+08:00", dischargeISO: "2024-06-06T00:00:00+08:00", hospitalName: null, hospitalCountry: null, admissionType: null, wardType: null, sourceDocumentIds: ["doc-1"], ...o };
  return { ...f, provenance: f.sourceDocumentIds.map(verifiedEvidenceProvenance) };
}
const facts = (o: Partial<ClaimFacts> = {}): ClaimFacts => ({ ...EMPTY_CLAIM_FACTS, eventType: "hospitalisation", eventDate: "2024-06-01", panelStatusReported: "panel", ...o });
const surgicalBill = (currency = "SGD") => bills({ lineItems: [{ category: "surgical_fees", description: null, amountMinor: 500_000, currency, documentId: "d1", documentType: "itemised_bill" }] });

function blocked(item: ClaimAssessmentItem | undefined, label: string) {
  assert.ok(item, `${label}: the benefit stays visible`);
  assert.equal(item!.status, "needs_document", `${label}: ${JSON.stringify(item)}`);
  assert.equal(item!.calculatedAmount, undefined, `${label}: no amount`);
  assert.equal(item!.amountText, null, `${label}: never shown as $0`);
  assert.ok(item!.conditions.includes(CURRENCY_UNMATCHED_CONDITION), `${label}: asks for the page that states the currency`);
}

// ---------------------------------------------------------------------------
// 1. Where a cover's currency comes from
// ---------------------------------------------------------------------------
test("verification: a stored SGD with a certificate line that writes S$ is verified (positive control)", () => {
  assert.equal(coverageCurrencyVerified("SGD", "Group Term Life sum insured: S$1,000,000", null), true);
  assert.equal(coverageCurrencyVerified("USD", "Sum insured USD 250,000", null), true);
});
test("verification: a stored (defaulted) SGD is never proof when the certificate writes no currency", () => {
  assert.equal(coverageCurrencyVerified("SGD", "Group Term Life sum insured: 1,000,000", null), false);
  assert.equal(coverageCurrencyVerified("SGD", null, null), false);
});
test("verification: a bare \"$\" names no currency", () => {
  assert.equal(coverageCurrencyVerified("SGD", "Sum insured: $1,000,000", "Sum insured: $1,000,000"), false);
});
test("verification: a stored SGD is never relabelled onto a certificate written in another currency", () => {
  assert.equal(coverageCurrencyVerified("SGD", "Sum insured: US$1,000,000", null), false);
  assert.equal(coverageCurrencyVerified("SGD", "Sum insured: MYR 100,000", "S$ appears elsewhere"), false, "the line's own currency wins; the page is not consulted");
});
test("verification: when the line has no currency, the cited certificate page may verify it -- only if it writes that one currency", () => {
  assert.equal(coverageCurrencyVerified("SGD", "Sum insured: 1,000,000", "Certificate. All amounts in SGD. Sum insured: 1,000,000"), true, "positive control");
  assert.equal(coverageCurrencyVerified("SGD", "Sum insured: 1,000,000", "Premium US$120. Sum insured: S$1,000,000"), false, "two currencies on the page: ambiguous");
  assert.equal(coverageCurrencyVerified("SGD", "Sum insured: 1,000,000", "Sum insured: 1,000,000"), false);
});
test("verification: a line that writes two currencies is ambiguous", () => {
  assert.equal(coverageCurrencyVerified("SGD", "S$1,000,000 (US$740,000)", null), false);
});
test("statedCurrency / currencyStatedIn: explicit markers only, never a default", () => {
  assert.equal(statedCurrency("a benefit of S$5,000"), "SGD");
  assert.equal(statedCurrency("a benefit of $5,000"), null);
  assert.equal(statedCurrency("5,000"), null);
  assert.equal(statedCurrency("S$5,000 or US$4,000"), null);
  assert.equal(currencyStatedIn("SGD", "US$5,000"), false);
  assert.equal(currencyStatedIn("HKD", "HK$5,000"), true);
});

// ---------------------------------------------------------------------------
// 2. The shared non-travel gate
// ---------------------------------------------------------------------------
test("gate: verified cover + same quoted currency calculates in that currency (positive control)", () => {
  assert.deepEqual(checkNonTravelCurrency({ coverage: coverage(), requireCoverageCurrency: true, quoted: ["SGD", undefined] }), { ok: true, currency: "SGD" });
});
test("gate: a sum-insured figure on an unverified cover is blocked with a request for the page", () => {
  const r = checkNonTravelCurrency({ coverage: coverage({ currencyVerified: false }), requireCoverageCurrency: true, quoted: [] });
  assert.equal(r.ok, false); if (!r.ok) { assert.equal(r.reasonCode, "COVERAGE_CURRENCY_UNVERIFIED"); assert.equal(r.condition, CURRENCY_UNMATCHED_CONDITION); }
  const absent = checkNonTravelCurrency({ coverage: coverage({ currencyVerified: undefined }), requireCoverageCurrency: true, quoted: [] });
  assert.equal(absent.ok, false, "absent = not verified");
});
test("gate: a quoted amount with no written currency is blocked; different or mixed currencies are never converted", () => {
  const missing = checkNonTravelCurrency({ coverage: coverage(), requireCoverageCurrency: true, quoted: [null] });
  assert.equal(missing.ok, false); if (!missing.ok) assert.equal(missing.reasonCode, "BENEFIT_CURRENCY_MISSING");
  const mismatch = checkNonTravelCurrency({ coverage: coverage(), requireCoverageCurrency: true, quoted: ["USD"] });
  assert.equal(mismatch.ok, false); if (!mismatch.ok) assert.equal(mismatch.reasonCode, "CURRENCY_MISMATCH");
  const mixed = checkNonTravelCurrency({ coverage: coverage({ currencyVerified: false }), requireCoverageCurrency: false, quoted: ["SGD", "USD"] });
  assert.equal(mixed.ok, false); if (!mixed.ok) assert.equal(mixed.reasonCode, "CURRENCY_MISMATCH");
});
test("gate: a wording-quoted amount on an unverified cover uses the currency written in the clause (positive control)", () => {
  assert.deepEqual(checkNonTravelCurrency({ coverage: coverage({ currencyVerified: false }), requireCoverageCurrency: false, quoted: ["USD"] }), { ok: true, currency: "USD" });
});

// ---------------------------------------------------------------------------
// 3. Medical reimbursement and hospital cash (death, critical illness,
//    disability and travel run end to end in the reviewer e2e suite)
// ---------------------------------------------------------------------------
test("medical reimbursement: verified cover + reviewed bills in that currency calculates (positive control)", () => {
  for (let i = 0; i < RUNS; i++) {
    const [item] = assessMedicalClaim(facts({ verifiedMedicalBillFacts: surgicalBill() }), [coverage()], ruleEvidence({ reimbursementRules: [reimbursementRule()], planProvisions: [provisions()] }));
    assert.equal(item.status, "potentially_applicable", JSON.stringify(item));
    assert.equal(item.calculatedAmount, 5000); assert.equal(item.currency, "SGD");
  }
});
test("medical reimbursement: an unverified cover is blocked -- the bills' currency never fills the gap", () => {
  for (let i = 0; i < RUNS; i++) {
    const [item] = assessMedicalClaim(facts({ verifiedMedicalBillFacts: surgicalBill() }), [coverage({ currencyVerified: false, evidenceText: "Hospitalisation Plan" })], ruleEvidence({ reimbursementRules: [reimbursementRule()], planProvisions: [provisions()] }));
    blocked(item, "reimbursement on an unverified cover");
  }
});
test("hospital cash: a daily rate whose clause writes its currency calculates (positive control)", () => {
  const [item] = assessMedicalClaim(facts({ verifiedMedicalBillFacts: bills() }), [coverage({ currencyVerified: false })], ruleEvidence({ cashRules: [cashRule()], planProvisions: [provisions()] }));
  assert.equal(item.status, "likely_applicable", JSON.stringify(item)); assert.equal(item.currency, "SGD"); assert.ok(item.calculatedAmount! > 0);
});
test("hospital cash: a verified cover in another currency than the clause is blocked, never relabelled", () => {
  const [item] = assessMedicalClaim(facts({ verifiedMedicalBillFacts: bills() }), [coverage({ currency: "USD", evidenceText: "Currency of cover: USD" })], ruleEvidence({ cashRules: [cashRule()], planProvisions: [provisions()] }));
  blocked(item, "hospital cash SGD clause on a USD cover");
});

// ---------------------------------------------------------------------------
// 4. The monetary gate is a second, independent choke point
// ---------------------------------------------------------------------------
function allowedItem(o: Partial<ClaimAssessmentItem> = {}): ClaimAssessmentItem {
  return { id: "gtl-death", title: "Death", status: "potentially_applicable", amountText: "S$1,000,000", reason: "fixture", conditions: [], evidenceTerms: [],
    productName: "Group Term Life", coverageId: "cov-1", calculatedAmount: 1_000_000, currency: "SGD", calculationId: "death:fixture", ruleEvidence: citation(), ...o };
}
const deathFacts = facts({ eventType: "death", deathDate: "2024-06-01", eventDate: "2024-06-01" });
test("monetary gate: a figure in the cover's verified currency is allowed (positive control)", () => {
  assert.equal(evaluateMonetaryEligibility({ item: allowedItem(), facts: deathFacts, coverages: [coverage({ category: "Death" })] }).status, "allowed");
});
test("monetary gate: a figure on an unverified cover whose currency is in no quoted clause is blocked", () => {
  const d = evaluateMonetaryEligibility({ item: allowedItem(), facts: deathFacts, coverages: [coverage({ category: "Death", currencyVerified: false })] });
  assert.equal(d.status, "blocked"); if (d.status === "blocked") assert.equal(d.reasonCode, "INVALID_CURRENCY");
  const quoted = evaluateMonetaryEligibility({ item: allowedItem({ evidenceTerms: ["a fixed benefit of S$1,000,000 will be paid"] }), facts: deathFacts, coverages: [coverage({ category: "Death", currencyVerified: false })] });
  assert.equal(quoted.status, "allowed", "positive control: the quoted clause writes the currency");
});
test("monetary gate: a figure relabelled into a currency other than the cover's verified one is blocked", () => {
  const d = evaluateMonetaryEligibility({ item: allowedItem({ currency: "USD", amountText: "US$1,000,000" }), facts: deathFacts, coverages: [coverage({ category: "Death" })] });
  assert.equal(d.status, "blocked");
});

// ---------------------------------------------------------------------------
// 5. Composition never adds across currencies
// ---------------------------------------------------------------------------
test("composition: two covers in different verified currencies stay in separate totals", () => {
  for (let i = 0; i < RUNS; i++) {
    const sgd = allowedItem({ id: "med-hospital-cash", calculatedAmount: 500, amountText: "S$500.00", calculationId: "hc:sgd", monetaryDecision: { status: "allowed" } });
    const usd = allowedItem({ id: "med-hospital-cash", coverageId: "cov-2", calculatedAmount: 300, currency: "USD", amountText: "US$300.00", calculationId: "hc:usd", ruleEvidence: citation("policy-2"), monetaryDecision: { status: "allowed" } });
    const result = composeClaim({ claimEventId: "claim-1", familyMemberId: "fam-1", facts: facts(), wordingPages: [], assessments: [sgd, usd],
      coverages: [coverage(), coverage({ id: "cov-2", policyId: "policy-2", currency: "USD", insurer: "AIA", policyNumber: "A-2", evidenceText: "Currency of cover: USD" })] });
    const totals = Object.fromEntries(result.totalsByCurrency.map((t) => [t.currency, t.includedAmount]));
    assert.equal(totals.SGD ?? 0, 500); assert.equal(totals.USD ?? 0, 300);
    assert.ok(!result.totalsByCurrency.some((t) => t.includedAmount === 800), "never 500 + 300");
  }
});

// ---------------------------------------------------------------------------
// 6. Benefit tables and stored rules never default to SGD
// ---------------------------------------------------------------------------
test("benefit table: a cell without a written currency keeps no currency; a written one is kept (control)", () => {
  for (const cell of ["$689/month", "$30 per day"]) {
    const parsed = parseBenefitValue(cell);
    assert.ok(parsed, `parses: ${cell}`);
    assert.equal(parsed!.currency, null, `${cell}: a bare "$" names no currency`);
  }
  assert.equal(parseBenefitValue("S$30 per day")?.currency, "SGD");
  assert.equal(parseBenefitValue("S$5,000")?.currency, "SGD");
});
test("stored rule: the quoted clause decides the currency; a reader-supplied currency absent from the quote is not proof", () => {
  const base = { kind: "fixed", value: 5000, factKey: null, offsetDays: null, maximumDays: null } as const;
  assert.equal(validateCatalogFormula({ ...base, currency: null, quote: "We will pay a benefit of S$5,000 on accidental death." }).currency, "SGD");
  assert.equal(validateCatalogFormula({ ...base, currency: "SGD", quote: "We will pay a benefit of $5,000 on accidental death." }).currency, null);
  assert.equal(validateCatalogFormula({ ...base, currency: "USD", quote: "We will pay a benefit of S$5,000 on accidental death." }).formulaKind, "none", "contradiction");
});
test("stored rule: a fixed benefit with no stated currency yields no figure and asks for the page (positive control with a currency)", () => {
  const benefit = (currency: string | null): CatalogBenefit => ({ id: "b1", policyId: "policy-1", productName: "Group Personal Accident", benefitName: "Accidental death",
    traits: ["death"], formulaKind: "fixed", formulaValue: 5000, currency, factKey: null, offsetDays: null, maximumDays: null, sourcePage: 3,
    quote: "We will pay a benefit of 5,000 on accidental death.", conditions: [], requirements: [], needsReview: false });
  const none = assessCatalogBenefit({ benefit: benefit(null), coverage: coverage({ category: "Personal Accident" }), ownerName: "A", facts: {} });
  assert.equal(none.item.calculatedAmount, undefined, "no figure");
  assert.doesNotMatch(none.item.amountText ?? "", /S\$|SGD|US\$|USD/, "the rule may be described, but never in a guessed currency");
  assert.ok(none.missing.includes(CATALOG_CURRENCY_MISSING));
  const withCurrency = assessCatalogBenefit({ benefit: benefit("SGD"), coverage: coverage({ category: "Personal Accident" }), ownerName: "A", facts: {} });
  assert.equal(withCurrency.item.calculatedAmount, 5000); assert.equal(withCurrency.item.currency, "SGD");
});
test("stored rule: a share of the sum insured needs the cover's verified currency", () => {
  const share: CatalogBenefit = { id: "b2", policyId: "policy-1", productName: "Group Term Life", benefitName: "Death", traits: ["death"], formulaKind: "sum_insured",
    formulaValue: 1, currency: null, factKey: null, offsetDays: null, maximumDays: null, sourcePage: 3, quote: "100% of the Sum Insured is payable on death.", conditions: [], requirements: [], needsReview: false };
  const verified = assessCatalogBenefit({ benefit: share, coverage: coverage({ category: "Death", amount: 350_000 }), ownerName: "A", facts: {} });
  assert.equal(verified.item.calculatedAmount, 350_000, "positive control");
  const unverified = assessCatalogBenefit({ benefit: share, coverage: coverage({ category: "Death", amount: 350_000, currencyVerified: false }), ownerName: "A", facts: {} });
  assert.equal(unverified.item.calculatedAmount, undefined, "no figure on an unverified cover");
  assert.doesNotMatch(unverified.item.amountText ?? "", /350[,.]?000|S\$|SGD/, "the rule may be described, but the cover amount is never shown");
});

console.log(`Cross-product currency regressions passed: ${cases} cases (${RUNS} repeated runs where noted).`);

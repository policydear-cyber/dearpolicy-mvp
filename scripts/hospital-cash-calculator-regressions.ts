import assert from "node:assert/strict";
import { calculateHospitalCash, type HospitalCashInput } from "@/lib/claims/calculators/hospital-cash";

const ruleEvidence = { chunkId: "page:wording-1:9", policyId: "wording-1", pageStart: 9, pageEnd: 9, label: "Hospital cash clause" };
const ownershipEvidence = { chunkId: "cert:policy-1:1", policyId: "policy-1", pageStart: 1, pageEnd: 1, label: "Certificate of insurance" };
const ownership = { contractId: "contract-1", coverageId: "coverage-1", label: "Group Term Life" };

const base: HospitalCashInput = {
  dailyRate: 100,
  currency: "SGD",
  hospitalStayOngoing: false,
  hospitalNights: 8,
  offsetDays: 2,
  maximumDays: 30,
  ownership,
  ruleEvidence,
  ownershipEvidence,
  unresolvedConditions: [],
};

export function runHospitalCashCalculatorRegressions() {
  // Normal bounded calculation -- matches the worked example in the spec
  // (8 nights, 2-day waiting period, 6 payable days, S$600).
  {
    const r = calculateHospitalCash(base);
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") {
      assert.equal(r.payableDays, 6);
      assert.equal(r.potentialAmount, 600);
      assert.equal(r.currency, "SGD");
      assert.equal(r.dailyRate, 100);
    }
  }

  // Zero offset
  {
    const r = calculateHospitalCash({ ...base, offsetDays: 0, hospitalNights: 4 });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") { assert.equal(r.payableDays, 4); assert.equal(r.potentialAmount, 400); }
  }

  // Waiting period longer than the stay -> not_applicable, never a $0 payout
  {
    const r = calculateHospitalCash({ ...base, hospitalNights: 1, offsetDays: 5 });
    assert.equal(r.status, "not_applicable");
    assert.equal(r.potentialAmount, null);
  }

  // Maximum-day cap
  {
    const r = calculateHospitalCash({ ...base, hospitalNights: 60, offsetDays: 2, maximumDays: 30 });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") { assert.equal(r.payableDays, 30); assert.equal(r.potentialAmount, 3000); }
  }

  // One-night stay
  {
    const r = calculateHospitalCash({ ...base, hospitalNights: 1, offsetDays: 0 });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") { assert.equal(r.payableDays, 1); assert.equal(r.potentialAmount, 100); }
  }

  // Ongoing stay blocks regardless of any nights figure
  {
    const r = calculateHospitalCash({ ...base, hospitalStayOngoing: true, hospitalNights: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "STAY_ONGOING");
    const r2 = calculateHospitalCash({ ...base, hospitalStayOngoing: true, hospitalNights: 3 });
    assert.equal(r2.status, "blocked");
  }

  // Missing nights
  {
    const r = calculateHospitalCash({ ...base, hospitalNights: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "INVALID_HOSPITAL_NIGHTS");
  }

  // Fractional nights
  {
    const r = calculateHospitalCash({ ...base, hospitalNights: 2.5 });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "INVALID_HOSPITAL_NIGHTS");
  }

  // Negative nights
  {
    const r = calculateHospitalCash({ ...base, hospitalNights: -1 });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "INVALID_HOSPITAL_NIGHTS");
  }

  // Missing / invalid daily rate
  {
    const r1 = calculateHospitalCash({ ...base, dailyRate: null });
    assert.equal(r1.status, "blocked");
    if (r1.status === "blocked") assert.equal(r1.reasonCode, "INVALID_DAILY_RATE");
    const r2 = calculateHospitalCash({ ...base, dailyRate: 0 });
    assert.equal(r2.status, "blocked");
    const r3 = calculateHospitalCash({ ...base, dailyRate: -50 });
    assert.equal(r3.status, "blocked");
  }

  // Missing / invalid waiting period
  {
    const r = calculateHospitalCash({ ...base, offsetDays: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "INVALID_OFFSET_DAYS");
    const r2 = calculateHospitalCash({ ...base, offsetDays: -1 });
    assert.equal(r2.status, "blocked");
  }

  // Missing maximum days -- this is exactly the "no uncapped daily benefit
  // calculation" safety invariant: an absent day cap must never let the
  // calculation through.
  {
    const r = calculateHospitalCash({ ...base, maximumDays: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_MAXIMUM_DAYS");
  }

  // Missing evidence
  {
    const r = calculateHospitalCash({ ...base, ruleEvidence: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_RULE_EVIDENCE");
    const r2 = calculateHospitalCash({ ...base, ownershipEvidence: null });
    assert.equal(r2.status, "blocked");
    if (r2.status === "blocked") assert.equal(r2.reasonCode, "MISSING_OWNERSHIP_EVIDENCE");
  }

  // Missing ownership mapping
  {
    const r = calculateHospitalCash({ ...base, ownership: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_OWNERSHIP_MAPPING");
  }

  // Invalid currency
  {
    const r1 = calculateHospitalCash({ ...base, currency: null });
    assert.equal(r1.status, "blocked");
    const r2 = calculateHospitalCash({ ...base, currency: "sgd" });
    assert.equal(r2.status, "blocked");
    const r3 = calculateHospitalCash({ ...base, currency: "SG" });
    assert.equal(r3.status, "blocked");
  }

  // Unresolved policy condition
  {
    const r = calculateHospitalCash({ ...base, unresolvedConditions: ["The diagnosis must satisfy the defined illness."] });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "UNRESOLVED_CONDITION");
  }

  // Deterministic repeated calculation
  {
    const r1 = calculateHospitalCash(base);
    const r2 = calculateHospitalCash(base);
    assert.deepEqual(r1, r2);
  }

  // Large but valid values, no floating-point rounding drift
  {
    const r = calculateHospitalCash({ ...base, dailyRate: 999.99, hospitalNights: 1000, offsetDays: 0, maximumDays: 1000 });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") {
      assert.equal(r.payableDays, 1000);
      assert.equal(r.potentialAmount, 999990);
    }
  }

  console.log("DearPolicy hospital-cash calculator regressions passed.");
}

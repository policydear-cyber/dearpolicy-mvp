import assert from "node:assert/strict";
import { answerFromLedger } from "@/lib/ledger/answer";
import type { LedgerRow } from "@/lib/ledger/store";
import type { ConversationFact, FactValue, SubjectFacts } from "@/lib/chat/types";

const known = (value: FactValue): ConversationFact => ({ value, state: "known", quote: "test", recordedAt: new Date().toISOString(), source: "user" });

const baseRow = (overrides: Partial<LedgerRow>): LedgerRow => ({
  id: "row-1", familyMemberId: "p1", policyId: "policy-1", planName: "Group Term Life", insurer: "Synthetic Insurer",
  eventType: "hospital_daily_cash", detail: null, cause: null, paysKind: "per_day", amount: 100, currency: "SGD", sumBasis: null,
  minimumFact: null, minimumValue: null, offsetDays: 2, maximumDays: 30, conditions: [], note: null,
  sourcePage: 4, quote: "S$100 per day after the first 2 days, up to 30 days", origin: "wording", inferred: false,
  status: "confirmed", updatedAt: new Date().toISOString(), ...overrides,
});

const people = [{ id: "p1", name: "Dad" }];

export function runLedgerHospitalCashRegressions() {
  // Asking for completed hospital nights when the stay is known but the
  // length is not.
  {
    const facts: Record<string, SubjectFacts> = { p1: { hospitalised: known(true) } };
    const out = answerFromLedger({ rows: [baseRow({})], people, facts });
    assert.equal(out.question?.factKey, "hospitalNights", "Should ask how many nights once hospitalisation is known");
    assert.equal(out.items.length, 1, "The potentially relevant benefit stays visible while the fact is pending");
    assert.equal(out.items[0].status, "needs_document");
    assert.equal(out.items[0].amountText, null);
  }

  // Not repeating a fact already supplied.
  {
    const facts: Record<string, SubjectFacts> = { p1: { hospitalised: known(true), hospitalNights: known(8), hospitalStayOngoing: known(false) } };
    const out = answerFromLedger({ rows: [baseRow({})], people, facts });
    assert.equal(out.question, null, "Nights are already known; must not ask again");
  }

  // Withholding an amount while the stay is ongoing.
  {
    const facts: Record<string, SubjectFacts> = { p1: { hospitalised: known(true), hospitalStayOngoing: known(true) } };
    const out = answerFromLedger({ rows: [baseRow({})], people, facts });
    const item = out.items[0];
    assert.ok(item, "The benefit stays visible while the stay is ongoing");
    assert.equal(item.amountText, null);
    assert.equal(item.calculatedAmount, undefined);
    assert.ok(item.conditions.some(c => /completed length of stay/i.test(c)), "The condition must explain the benefit may apply once the stay ends");
  }

  // Calculating after the user supplies the final nights -- matches the
  // worked example in the task spec (8 nights, 2-day wait, 6 payable days,
  // S$600).
  {
    const facts: Record<string, SubjectFacts> = { p1: { hospitalised: known(true), hospitalNights: known(8), hospitalStayOngoing: known(false) } };
    const out = answerFromLedger({ rows: [baseRow({})], people, facts });
    const item = out.items[0];
    assert.equal(item.calculatedAmount, 600);
    assert.equal(item.amountText, "S$600.00");
    assert.equal(item.estimateBasis, "confirmed");
  }

  // Excluding the result from totals when the benefit is structurally
  // blocked -- an absent day cap must never produce an uncapped amount.
  {
    const facts: Record<string, SubjectFacts> = { p1: { hospitalised: known(true), hospitalNights: known(8), hospitalStayOngoing: known(false) } };
    const out = answerFromLedger({ rows: [baseRow({ maximumDays: null })], people, facts });
    const item = out.items[0];
    assert.equal(item.amountText, null, "An unbounded daily benefit must never show an uncapped amount");
    assert.equal(item.calculatedAmount, undefined);
  }

  // Including it exactly once when allowed -- no duplication for a single
  // row.
  {
    const facts: Record<string, SubjectFacts> = { p1: { hospitalised: known(true), hospitalNights: known(8), hospitalStayOngoing: known(false) } };
    const out = answerFromLedger({ rows: [baseRow({})], people, facts });
    assert.equal(out.items.filter(i => i.title.includes("Hospital daily cash")).length, 1);
  }

  // Preserving family-member scope: only the person with a reported stay
  // gets an item.
  {
    const facts: Record<string, SubjectFacts> = {
      p1: { hospitalised: known(true), hospitalNights: known(8), hospitalStayOngoing: known(false) },
      p2: {},
    };
    const rows = [baseRow({ id: "r1", familyMemberId: "p1" }), baseRow({ id: "r2", familyMemberId: "p2" })];
    const out = answerFromLedger({ rows, people: [...people, { id: "p2", name: "Mum" }], facts });
    assert.ok(out.items.length > 0);
    assert.ok(out.items.every(i => i.title.startsWith("Dad ·")), "Only the person with a reported hospital stay should get an item");
  }

  console.log("DearPolicy ledger hospital-cash regressions passed.");
}

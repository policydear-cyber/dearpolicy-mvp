/**
 * Agent K: the benefit calculators the conversation loop's `calculate` tool runs. They do not do their own arithmetic:
 *  - hospital cash  -> lib/claims/day-count.ts (payable days under the policy's OWN day-count rule) and
 *                      lib/claims/calculators/hospital-cash.ts calculateHospitalCash (min(day cap, days - waiting) x rate);
 *  - bills          -> lib/claims/calculators/medical-reimbursement.ts calculateMedicalReimbursement (sub-limits,
 *                      deductible / co-insurance through the shared deduction core, caps; unresolved deduction order blocks);
 *  - lump sums      -> sum insured x printed percentage, capped (illustration only: the claim workflow's reviewed
 *                      definition match -- lib/claims/calculators/critical-illness.ts et al. -- is never waived).
 * Each produces a CalculationRecord (types/index.ts) that lib/claims/calc-record.ts re-runs before it is issued, and
 * which the save-time gate re-runs again. Result kinds stay distinct: a printed figure (cited), a conditional
 * illustration (only for a what-if the household asked), an indicative estimate (every condition established; never a
 * payout; never in a total), or "unresolved" -- the supported printed figure plus the specific missing information.
 */
import { createHash } from "node:crypto";
import type { CalcCondition, CalcOperand, CalcStep, CalculationRecord, FigureBinding } from "@/types";
import { calculateHospitalCash } from "@/lib/claims/calculators/hospital-cash";
import { calculateMedicalReimbursement, type DeductionStep } from "@/lib/claims/calculators/medical-reimbursement";
import { dayRuleNeedsTimes, payableDaysUnderRule, type PolicyDayRule } from "@/lib/claims/day-count";
import { recomputeCalculation } from "@/lib/claims/calc-record";
import { applyDeductionCore, divHalfUp } from "@/lib/claims/calculators/deductions";
import { toFigureBinding, type EvidenceRef } from "../evidence";
import type { TableValueOperand } from "../compute";
import type { BenefitTerms } from "./terms";

export type HouseholdInput = { value: number | string; currency?: string | null; words: string; kind: "household" | "assumption" };
export type DocValue = { operand: TableValueOperand; valueId?: string | null };
export type CalcOutcome = {
  calcId: string;
  kind: "conditional_illustration" | "indicative_estimate" | "unresolved" | "not_payable";
  calculator: CalculationRecord["calculator"];
  subjectId: string; policyId: string; benefit: string; documentHash: string | null;
  /** The printed figures this outcome rests on (cited; always safe to state as printed). */
  printed: { label: string; value: number; unit: "money" | "percent" | "count"; currency: string | null; evidence: EvidenceRef; binding: FigureBinding | null; valueId?: string | null }[];
  conditions: CalcCondition[];
  /** What is still needed, in the household's terms (empty for an estimate / illustration). */
  requirements: string[];
  amount: number | null; currency: string | null;
  record: Omit<CalculationRecord, "sentence"> | null;
  steps: string[];
  unresolvedText: string;
  /** Why the benefit pays nothing for these facts (not_payable), stated from the wording. */
  reason?: string | null;
  evidence: EvidenceRef[];
  evidenceRequirements: string[];
};
export type Refusal = { refused: string };

const money = (cents: number, cur: string) => `${cur === "SGD" ? "S$" : cur + " "}${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const idOf = (parts: unknown[]) => "k" + createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 10);
const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const ISO_D = /^\d{4}-\d{2}-\d{2}$/;
const passageOf = (e: EvidenceRef) => ({ policyId: e.policyId, pageStart: e.page.start, pageEnd: e.page.end, text: e.passage.text });

function docOperand(id: string, role: Extract<CalcOperand, { source: "document" }>["role"], v: DocValue, subjectId: string): Extract<CalcOperand, { source: "document" }> | string {
  const o = v.operand;
  const value = o.valueKind === "money" ? (o.cents ?? NaN) / 100 : o.valueKind === "percent" ? (o.ppm ?? NaN) / 10_000 : (o.count ?? NaN);
  if (!Number.isFinite(value)) return `the value for ${o.benefit} is not a printed ${o.valueKind}`;
  const binding = toFigureBinding({ ...o.evidence, subjectId: o.evidence.subjectId ?? subjectId }, o.benefit, value, o.currency ?? "");
  if (!binding) return `the passage for ${o.benefit} does not print its value for this person`;
  return { id, source: "document", role, label: o.benefit, unit: o.valueKind, value, currency: o.valueKind === "money" ? (o.currency ?? null) : null, period: o.period ?? null, row: o.evidence.table?.rowLabel ?? o.evidence.passage.text, column: o.evidence.table ? (o.evidence.table.columnLeaf || o.evidence.table.columnHeader || null) : null, binding };
}
function printedOf(v: DocValue, subjectId: string): CalcOutcome["printed"][number] {
  const o = v.operand;
  const value = o.valueKind === "money" ? (o.cents ?? 0) / 100 : o.valueKind === "percent" ? (o.ppm ?? 0) / 10_000 : (o.count ?? 0);
  return { label: o.benefit, value, unit: o.valueKind, currency: o.currency ?? null, evidence: o.evidence, binding: toFigureBinding({ ...o.evidence, subjectId: o.evidence.subjectId ?? subjectId }, o.benefit, value, o.currency ?? ""), valueId: v.valueId ?? null };
}
function householdOperand(id: string, role: Extract<CalcOperand, { source: "household" }>["role"], label: string, unit: "money" | "count" | "datetime" | "date", h: HouseholdInput): CalcOperand {
  return h.kind === "assumption"
    ? { id, source: "assumption", role, label, unit, value: h.value, currency: h.currency ?? null, attribution: h.words.trim() }
    : { id, source: "household", role, label, unit, value: h.value, currency: h.currency ?? null, attribution: h.words.trim() };
}
const settledStatus = (c: CalcCondition[]) => c.every((x) => x.status !== "unresolved");

/** Applies the household's settlement of a condition (their own words), never a document fact. */
function applySettled(conds: CalcCondition[], settled: { id: string; status: "established" | "not_applicable"; words: string }[]) {
  for (const s of settled) {
    const c = conds.find((x) => x.id === s.id);
    if (!c || c.basis === "document" || c.kind === "day_count_rule" || c.kind === "deduction_order" || c.kind === "definition" || !s.words?.trim()) continue;
    c.status = s.status; c.basis = "household"; c.householdWords = s.words.trim(); c.needs = null;
  }
}

function finish(o: Omit<CalcOutcome, "calcId" | "unresolvedText"> & { who: string; product: string }): CalcOutcome | Refusal {
  const calcId = idOf([o.calculator, o.policyId, o.benefit, o.subjectId, o.record?.operands, o.record?.steps, o.conditions.map((c) => [c.id, c.status])]);
  const need = o.requirements.length ? o.requirements.join("; and ") : "information the documents do not give";
  const unresolvedText = o.kind === "not_payable" ? `${o.product} ${o.benefit.toLowerCase()} does not apply to these facts: ${o.reason ?? "see the policy wording"}.`
    : `To work out ${o.who}’s ${o.benefit.toLowerCase()} under ${o.product}, I still need ${need}.`;
  if (o.record) {
    const rec = recomputeCalculation(o.record);
    if (!rec.ok) return { refused: "internal: the calculation record does not re-run: " + rec.error };
    o.record.id = calcId; o.record.unresolvedText = unresolvedText;
  }
  const { who: _w, product: _p, ...rest } = o; void _w; void _p;
  return { ...rest, calcId, unresolvedText };
}

// ---------------------------------------------------------------------------------------------------- hospital cash
export function hospitalCash(a: {
  subjectId: string; who: string; benefit: string; terms: BenefitTerms; rate: DocValue; dayCap?: DocValue | null;
  admission?: HouseholdInput | null; discharge?: HouseholdInput | null; ongoing?: boolean | null;
  settled?: { id: string; status: "established" | "not_applicable"; words: string }[]; whatIf: boolean;
}): CalcOutcome | Refusal {
  const t = a.terms, product = t.productName ?? "this policy";
  const r = a.rate.operand;
  if (r.valueKind !== "money" || r.cents == null || !r.currency) return { refused: "the hospital cash rate must be a printed amount (a value_id from select_table_value)" };
  if (r.evidence.policyId !== t.policyId) return { refused: "the rate is from another document than the one calculated for" };
  if (r.period && !["day", "night"].includes(r.period)) return { refused: `the rate is printed per ${r.period}, not per day` };
  const rateOp = docOperand("rate", "rate", a.rate, a.subjectId); if (typeof rateOp === "string") return { refused: rateOp };
  const printed = [printedOf(a.rate, a.subjectId)];
  const conds: CalcCondition[] = [];
  const reqs: string[] = [];
  // Day-count rule: from the wording only.
  if (t.dayRule) conds.push({ id: "c_day_rule", kind: "day_count_rule", text: `Days are counted as the wording states: “${t.dayRule.evidence.passage.text}”`, status: "established", basis: "document", passage: passageOf(t.dayRule.evidence) });
  else {
    const why = t.dayRuleConflict.length ? `the document states two different ways of counting hospital days (pages ${[...new Set(t.dayRuleConflict.map((e) => e.passage.onPage))].join(", ")})` : `the stored ${product} wording does not say how hospital days are counted`;
    conds.push({ id: "c_day_rule", kind: "day_count_rule", text: why, status: "unresolved", basis: "none", needs: `how ${product} counts hospital days (${why}; only the insurer can confirm it)` });
    reqs.push(`how ${product} counts hospital days, which the stored wording does not state (only the insurer can confirm it)`);
  }
  // Waiting (excess) period.
  if (t.waitingDays) conds.push({ id: "c_waiting", kind: "waiting_period", text: `No benefit for the first ${t.waitingDays.value} day(s): “${t.waitingDays.evidence.passage.text}”`, status: "established", basis: "document", passage: passageOf(t.waitingDays.evidence) });
  else conds.push({ id: "c_waiting", kind: "waiting_period", text: "No excess / waiting period is printed for this benefit.", status: "not_applicable", basis: "absent" });
  // Day cap: a printed count (value) or the wording.
  let capOp: Extract<CalcOperand, { source: "document" }> | null = null;
  if (a.dayCap) {
    const c = docOperand("day_cap", "day_cap", a.dayCap, a.subjectId); if (typeof c === "string") return { refused: c };
    if (c.unit !== "count") return { refused: "the day cap must be a printed number of days" };
    capOp = c; printed.push(printedOf(a.dayCap, a.subjectId));
    conds.push({ id: "c_day_cap", kind: "day_cap", text: `At most ${c.value} days (${c.row}).`, status: "established", basis: "document", passage: passageOf(a.dayCap.operand.evidence) });
  } else if (t.dayCap) {
    const e = t.dayCap.evidence;
    const binding: FigureBinding | null = toFigureBinding({ ...e, subjectId: e.subjectId ?? a.subjectId }, a.benefit, t.dayCap.value, "");
    if (binding) capOp = { id: "day_cap", source: "document", role: "day_cap", label: `${a.benefit} maximum days`, unit: "count", value: t.dayCap.value, currency: null, period: null, row: e.table?.rowLabel ?? e.passage.text, column: binding.column ?? null, binding };
    conds.push({ id: "c_day_cap", kind: "day_cap", text: `At most ${t.dayCap.value} days: “${e.passage.text}”`, status: "established", basis: "document", passage: passageOf(e) });
  } else conds.push({ id: "c_day_cap", kind: "day_cap", text: "No maximum number of days is printed for this benefit.", status: "not_applicable", basis: "absent" });
  // Minimum stay.
  if (t.minimumStayHours) conds.push({ id: "c_min_stay", kind: "minimum_stay", text: `The stay must last at least ${t.minimumStayHours.value} hours: “${t.minimumStayHours.evidence.passage.text}”`, status: "unresolved", basis: "document", passage: passageOf(t.minimumStayHours.evidence), needs: `${a.who}’s admission and discharge times (the stay must last at least ${t.minimumStayHours.value} hours)` });
  // Benefit-specific exclusions: the household settles them in their own words, or they stay open.
  t.exclusions.forEach((x, i) => conds.push({ id: "c_excl_" + (i + 1), kind: "exclusion", text: `Exclusion: “${x.evidence.passage.text}”`, status: "unresolved", basis: "none", passage: passageOf(x.evidence), needs: `whether this applies to ${a.who}’s stay: “${x.evidence.passage.text}”` }));
  applySettled(conds, a.settled ?? []);

  // Inputs the rule needs.
  const rule = t.dayRule?.value ?? null;
  const needTimes = (rule ? dayRuleNeedsTimes(rule) : false) || !!t.minimumStayHours;
  const okInput = (h: HouseholdInput | null | undefined) => !!h && typeof h.value === "string" && (ISO_DT.test(h.value) || (!needTimes && ISO_D.test(h.value))) && !!h.words?.trim();
  if (a.ongoing) reqs.push(`${a.who}’s discharge date${needTimes ? " and time" : ""} (the stay is still ongoing; the benefit is worked out on the completed stay)`);
  else if (!okInput(a.admission) || !okInput(a.discharge)) reqs.push(`${a.who}’s admission and discharge dates${needTimes ? " and times (with the hospital’s time zone)" : ""}`);
  const minStay = conds.find((c) => c.id === "c_min_stay");
  if (minStay && okInput(a.admission) && okInput(a.discharge) && ISO_DT.test(String(a.admission!.value)) && ISO_DT.test(String(a.discharge!.value))) {
    const hours = (Date.parse(String(a.discharge!.value)) - Date.parse(String(a.admission!.value))) / 3_600_000;
    if (hours >= t.minimumStayHours!.value) { minStay.status = "established"; minStay.basis = "derived"; minStay.needs = null; }
    else return finish({ kind: "not_payable", calculator: "hospital_cash", subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, printed, conditions: conds, requirements: [], amount: null, currency: r.currency, record: null, steps: [], reason: `the stay lasted ${Math.floor(hours)} hours and the wording requires at least ${t.minimumStayHours!.value}`, evidence: [r.evidence, t.minimumStayHours!.evidence], evidenceRequirements: [], who: a.who, product });
  }
  for (const c of conds) if (c.status === "unresolved" && c.needs && c.kind !== "day_count_rule" && c.kind !== "minimum_stay") reqs.push(c.needs);
  const evidence = [r.evidence, ...(t.dayRule ? [t.dayRule.evidence] : []), ...(t.waitingDays ? [t.waitingDays.evidence] : []), ...(a.dayCap ? [a.dayCap.operand.evidence] : t.dayCap ? [t.dayCap.evidence] : [])];
  const evidenceRequirements = [`the hospital’s discharge summary or bill showing ${a.who}’s admission and discharge dates and times`, `the ${product} claim form`];
  const base = { calculator: "hospital_cash" as const, subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, printed, evidence, evidenceRequirements, who: a.who, product };
  const unresolvedNow = reqs.length > 0 || !rule || (!a.whatIf && !settledStatus(conds));
  if (unresolvedNow) return finish({ ...base, kind: "unresolved", conditions: conds, requirements: [...new Set(reqs)], amount: null, currency: r.currency, record: null, steps: [] });

  // Payable days under the wording's rule, then the hospital-cash calculator.
  const days = payableDaysUnderRule(rule!, String(a.admission!.value), String(a.discharge!.value));
  if (days.status !== "calculated") return finish({ ...base, kind: "unresolved", conditions: conds, requirements: [`${a.who}’s admission and discharge dates and times (${days.message})`], amount: null, currency: r.currency, record: null, steps: [] });
  const waiting = t.waitingDays?.value ?? 0;
  const hc = calculateHospitalCash({ dailyRate: r.cents / 100, currency: r.currency, hospitalStayOngoing: false, hospitalNights: days.grossNights, offsetDays: waiting, maximumDays: capOp ? Number(capOp.value) : days.grossNights,
    ownership: { contractId: t.policyId, label: product }, ruleEvidence: { policyId: t.policyId, pageStart: r.evidence.page.start, pageEnd: r.evidence.page.end, label: a.benefit }, ownershipEvidence: { policyId: t.policyId, pageStart: r.evidence.page.start, pageEnd: r.evidence.page.end, label: "insured person's column" }, unresolvedConditions: [] });
  if (hc.status === "blocked") return { refused: "the hospital cash calculator blocked: " + hc.message };
  const ops: CalcOperand[] = [rateOp, householdOperand("admission", "admission", "admission", ISO_DT.test(String(a.admission!.value)) ? "datetime" : "date", a.admission!), householdOperand("discharge", "discharge", "discharge", ISO_DT.test(String(a.discharge!.value)) ? "datetime" : "date", a.discharge!)];
  const steps: CalcStep[] = [{ id: "s_days", op: "day_count", rule: rule!, inputs: ["admission", "discharge"], out: days.grossNights }];
  let last = "s_days";
  if (waiting > 0) { steps.push({ id: "s_after_wait", op: "days_after_waiting", inputs: [last], waitingDays: waiting, out: Math.max(0, days.grossNights - waiting) }); last = "s_after_wait"; }
  if (capOp) { ops.push(capOp); steps.push({ id: "s_capped", op: "min_count", inputs: [last, capOp.id], out: hc.payableDays }); last = "s_capped"; }
  if (hc.status === "not_applicable") return finish({ ...base, kind: "not_payable", conditions: conds, requirements: [], amount: null, currency: r.currency, record: null, steps: [], reason: `no day of the stay counts under the wording (“${t.dayRule!.evidence.passage.text}”${waiting ? `, after the first ${waiting} day(s)` : ""})` });
  const cents = Math.round(hc.potentialAmount * 100);
  steps.push({ id: "s_amount", op: "multiply", inputs: ["rate", last], out: cents });
  const kind = ops.some((o) => o.source === "assumption") ? "conditional_illustration" : "indicative_estimate";
  if (kind === "conditional_illustration" && !a.whatIf) return { refused: "an assumed figure is used only for a what-if the household asked (purpose what_if)" };
  if (kind === "indicative_estimate" && !settledStatus(conds)) return finish({ ...base, kind: "unresolved", conditions: conds, requirements: [...new Set(reqs)], amount: null, currency: r.currency, record: null, steps: [] });
  const record: Omit<CalculationRecord, "sentence"> = { id: "", calculator: "hospital_cash", kind, subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, operands: ops, steps, result: { value: cents / 100, currency: r.currency }, currency: r.currency, rounding: { mode: "half_up", precision: 2, source: "default" }, conditions: conds, evidenceRequirements, assumption: kind === "conditional_illustration" ? [a.admission!, a.discharge!].filter((h) => h.kind === "assumption").map((h) => h.words.trim()).join("; ") : null, unresolvedText: "" };
  const lines = [`payable days under “${t.dayRule!.words}”: ${days.grossNights}`, ...(waiting ? [`after the first ${waiting} day(s): ${Math.max(0, days.grossNights - waiting)}`] : []), ...(capOp ? [`capped at ${capOp.value} days: ${hc.payableDays}`] : []), `${money(r.cents, r.currency)} × ${hc.payableDays} = ${money(cents, r.currency)}`];
  return finish({ ...base, kind, conditions: conds, requirements: [], amount: cents / 100, currency: r.currency, record, steps: lines });
}

// --------------------------------------------------------------------------------------------- bill reimbursement
export function billReimbursement(a: {
  subjectId: string; who: string; benefit: string; terms: BenefitTerms; bill: HouseholdInput | null;
  subLimits: DocValue[]; limits: DocValue[]; deductible?: DocValue | null; coInsurance?: DocValue | null; coInsuranceCap?: DocValue | null;
  settled?: { id: string; status: "established" | "not_applicable"; words: string }[]; whatIf: boolean;
}): CalcOutcome | Refusal {
  const t = a.terms, product = t.productName ?? "this policy";
  const all = [...a.subLimits, ...a.limits, ...(a.deductible ? [a.deductible] : []), ...(a.coInsuranceCap ? [a.coInsuranceCap] : [])];
  if (!a.subLimits.length && !a.limits.length && !a.deductible && !a.coInsurance) return { refused: "a bill calculation needs at least one printed limit, deductible or co-insurance" };
  for (const v of [...all, ...(a.coInsurance ? [a.coInsurance] : [])]) if (v.operand.evidence.policyId !== t.policyId) return { refused: `${v.operand.benefit} is from another document than the one calculated for` };
  for (const v of all) if (v.operand.valueKind !== "money" || v.operand.cents == null || !v.operand.currency) return { refused: `${v.operand.benefit} is not a printed amount` };
  if (a.coInsurance && (a.coInsurance.operand.valueKind !== "percent" || a.coInsurance.operand.ppm == null)) return { refused: "the co-insurance must be a printed percentage" };
  const currencies = new Set(all.map((v) => v.operand.currency));
  const printed = [...all, ...(a.coInsurance ? [a.coInsurance] : [])].map((v) => printedOf(v, a.subjectId));
  const conds: CalcCondition[] = [];
  const reqs: string[] = [];
  const cur = [...currencies][0] ?? (a.bill?.currency ?? "SGD");
  if (currencies.size > 1) return { refused: `mixed currencies (${[...currencies].join(", ")}) are never combined` };
  if (a.bill && a.bill.currency && a.bill.currency !== cur) {
    conds.push({ id: "c_currency", kind: "currency", text: `The bill is in ${a.bill.currency}; the policy’s figures are in ${cur}. DearPolicy never converts currencies.`, status: "unresolved", basis: "none", needs: `the bill amount in ${cur} (the bill you gave is in ${a.bill.currency}; the insurer converts it)` });
  }
  if (a.deductible && a.coInsurance) {
    if (t.deductionOrder) conds.push({ id: "c_order", kind: "deduction_order", text: `Order of deductions: “${t.deductionOrder.evidence.passage.text}”`, status: "established", basis: "document", passage: passageOf(t.deductionOrder.evidence) });
    else conds.push({ id: "c_order", kind: "deduction_order", text: "The stored wording does not say whether the deductible or the co-insurance is applied first, which changes the result.", status: "unresolved", basis: "none", needs: `whether ${product} applies the deductible or the co-insurance first (the stored wording does not say; only the insurer can confirm it)` });
  }
  t.exclusions.forEach((x, i) => conds.push({ id: "c_excl_" + (i + 1), kind: "exclusion", text: `Exclusion: “${x.evidence.passage.text}”`, status: "unresolved", basis: "none", passage: passageOf(x.evidence), needs: `whether this applies to ${a.who}’s bill: “${x.evidence.passage.text}”` }));
  applySettled(conds, a.settled ?? []);
  const billOk = !!a.bill && typeof a.bill.value === "number" && Number.isFinite(a.bill.value) && a.bill.value >= 0 && !!a.bill.currency && !!a.bill.words?.trim();
  if (!billOk) reqs.push(`the amount of ${a.who}’s bill, with its currency`);
  for (const c of conds) if (c.status === "unresolved" && c.needs) reqs.push(c.needs);
  const evidence = printed.map((p) => p.evidence).concat(t.deductionOrder ? [t.deductionOrder.evidence] : []);
  const evidenceRequirements = [`the itemised hospital or clinic bill (the insurer reviews the bill itself; the amount you gave is not a reviewed bill)`, `the ${product} claim form`];
  const base = { calculator: "bill_reimbursement" as const, subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, printed, evidence, evidenceRequirements, who: a.who, product };
  const unresolved = () => finish({ ...base, kind: "unresolved", conditions: conds, requirements: [...new Set(reqs)], amount: null, currency: cur, record: null, steps: [] });
  if (reqs.length || conds.some((c) => c.status === "unresolved" && (c.kind === "deduction_order" || c.kind === "currency"))) return unresolved();
  if (!a.whatIf && !settledStatus(conds)) return unresolved();

  // The claims calculator does the arithmetic (one engine): the household's bill as one eligible line.
  const billMinor = Math.round(Number(a.bill!.value) * 100);
  const minor = (v: DocValue) => v.operand.cents!;
  const subCap = a.subLimits.length ? Math.min(...a.subLimits.map(minor)) : null;
  const deductionSteps: DeductionStep[] = [];
  const ref = (v: DocValue) => ({ policyId: t.policyId, pageStart: v.operand.evidence.page.start, pageEnd: v.operand.evidence.page.end, label: v.operand.benefit });
  const dedStep = a.deductible ? { kind: "deductible" as const, amountMinor: minor(a.deductible), evidence: ref(a.deductible) } : null;
  const coStep = a.coInsurance ? { kind: "co_insurance" as const, percent: a.coInsurance.operand.ppm! / 10_000, evidence: ref(a.coInsurance) } : null;
  const coFirst = t.deductionOrder?.value === "co_insurance_first";
  for (const s of coFirst ? [coStep, dedStep] : [dedStep, coStep]) if (s) deductionSteps.push(s);
  const anyRef = ref(all[0] ?? a.coInsurance!);
  const mr = calculateMedicalReimbursement({ currency: cur, eligibleCategories: ["household_reported_bill"], billedItems: [{ category: "household_reported_bill", description: a.bill!.words, amountMinor: billMinor }],
    categoryLimits: subCap != null ? [{ category: "household_reported_bill", capMinor: subCap, evidence: anyRef }] : [], wardProration: null,
    // No panel restriction is part of this calculation (the wording read prints none for it): the panel step leaves the amount unchanged.
    panelRestriction: { panelStatus: "panel", nonPanelFactor: null, evidence: anyRef },
    deductionSteps, deductionOrderEvidenced: deductionSteps.length <= 1 || !!t.deductionOrder,
    perAdmissionCap: a.limits.length ? { amountMinor: Math.min(...a.limits.map(minor)), evidence: anyRef } : null,
    thirdPartyCoordination: null, thirdPartyPayments: [], remainingLimits: [], ownership: { contractId: t.policyId, label: product }, ruleEvidence: anyRef, ownershipEvidence: anyRef, unresolvedConditions: [] });
  if (mr.status === "blocked") { reqs.push(mr.message); return unresolved(); }
  // A co-insurance cap is applied by the shared deduction core (the claims calculator has no cap on the share).
  const ops: CalcOperand[] = [householdOperand("bill", "bill", "bill", "money", { ...a.bill!, currency: a.bill!.currency ?? cur })];
  const steps: CalcStep[] = [];
  let last = "bill", running = billMinor;
  const lines: string[] = [`the bill you gave: ${money(billMinor, cur)}`];
  const addDoc = (id: string, role: Extract<CalcOperand, { source: "document" }>["role"], v: DocValue) => { const o = docOperand(id, role, v, a.subjectId); if (typeof o === "string") throw new Error(o); ops.push(o); return o; };
  try {
    if (a.subLimits.length) { const ids = a.subLimits.map((v, i) => addDoc("sub" + (i + 1), "limit", v).id); running = Math.min(running, subCap!); steps.push({ id: "s_sub", op: "min", inputs: [last, ...ids], out: running }); last = "s_sub"; lines.push(`up to the sub-limit${ids.length > 1 ? "s" : ""}: ${money(running, cur)}`); }
    const applyDed = () => { if (!a.deductible) return; const d = addDoc("deductible", "deductible", a.deductible); running = Math.max(0, running - minor(a.deductible)); steps.push({ id: "s_ded", op: "deductible", inputs: [last, d.id], out: running }); last = "s_ded"; lines.push(`less the deductible ${money(minor(a.deductible), cur)}: ${money(running, cur)}`); };
    const applyCo = () => {
      if (!a.coInsurance) return; const p = addDoc("co_insurance", "co_insurance", a.coInsurance); const capO = a.coInsuranceCap ? addDoc("co_cap", "co_insurance_cap", a.coInsuranceCap) : null;
      const before = running;
      const share = applyDeductionCore(before, { kind: "co_insurance", ppm: a.coInsurance.operand.ppm! }).householdShareMinor;
      const out = applyDeductionCore(before, { kind: "co_insurance", ppm: a.coInsurance.operand.ppm!, capMinor: capO ? minor(a.coInsuranceCap!) : null });
      const cappedShare = out.householdShareMinor;
      running = out.afterMinor;
      steps.push({ id: "s_co", op: "co_insurance", inputs: capO ? [last, p.id, capO.id] : [last, p.id], out: running }); last = "s_co";
      lines.push(`less your ${a.coInsurance.operand.ppm! / 10_000}% co-insurance share ${money(cappedShare, cur)}${capO && cappedShare < share ? ` (capped at ${money(minor(a.coInsuranceCap!), cur)})` : ""}: ${money(running, cur)}`);
    };
    if (coFirst) { applyCo(); applyDed(); } else { applyDed(); applyCo(); }
    if (a.limits.length) { const ids = a.limits.map((v, i) => addDoc("lim" + (i + 1), "limit", v).id); running = Math.min(running, ...a.limits.map(minor)); steps.push({ id: "s_lim", op: "min", inputs: [last, ...ids], out: running }); last = "s_lim"; lines.push(`up to the limit${ids.length > 1 ? "s" : ""}: ${money(running, cur)}`); }
  } catch (e) { return { refused: e instanceof Error ? e.message : String(e) }; }
  // One engine: without a co-insurance cap, the steps must reproduce the claims calculator exactly.
  const mrMinor = mr.status === "calculated" ? Math.round(mr.potentialAmount * 100) : 0;
  if (!a.coInsuranceCap && mrMinor !== running) return { refused: `internal: the bill steps (${running}) do not reproduce the claims calculator (${mrMinor})` };
  if (!steps.length) return { refused: "nothing to calculate" };
  if (running === 0) return finish({ ...base, kind: "not_payable", conditions: conds, requirements: [], amount: null, currency: cur, record: null, steps: lines, reason: a.deductible && billMinor <= minor(a.deductible) ? `the bill you gave (${money(billMinor, cur)}) does not exceed the deductible` : "nothing is left after the deductions" });
  const kind = a.bill!.kind === "assumption" ? "conditional_illustration" : "indicative_estimate";
  if (kind === "conditional_illustration" && !a.whatIf) return { refused: "an assumed figure is used only for a what-if the household asked (purpose what_if)" };
  const record: Omit<CalculationRecord, "sentence"> = { id: "", calculator: "bill_reimbursement", kind, subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, operands: ops, steps, result: { value: running / 100, currency: cur }, currency: cur, rounding: { mode: "half_up", precision: 2, source: "default" }, conditions: conds, evidenceRequirements, assumption: kind === "conditional_illustration" ? a.bill!.words.trim() : null, unresolvedText: "" };
  return finish({ ...base, kind, conditions: conds, requirements: [], amount: running / 100, currency: cur, record, steps: lines });
}

// ------------------------------------------------------------------------------------------------------ lump sums
export function lumpSum(a: { subjectId: string; who: string; benefit: string; terms: BenefitTerms; sumInsured: DocValue; percent?: DocValue | null; cap?: DocValue | null; condition: string; whatIf: boolean; assumptionWords?: string | null }): CalcOutcome | Refusal {
  const t = a.terms, product = t.productName ?? "this policy";
  const s = a.sumInsured.operand;
  if (s.valueKind !== "money" || s.cents == null || !s.currency) return { refused: "the sum insured must be a printed amount" };
  if (a.percent && (a.percent.operand.valueKind !== "percent" || a.percent.operand.ppm == null)) return { refused: "the percentage must be a printed percentage" };
  if (a.cap && (a.cap.operand.valueKind !== "money" || a.cap.operand.currency !== s.currency)) return { refused: "the cap must be a printed amount in the same currency" };
  const printed = [a.sumInsured, ...(a.percent ? [a.percent] : []), ...(a.cap ? [a.cap] : [])].map((v) => printedOf(v, a.subjectId));
  // The claim workflow requires a reviewed decision that the medical evidence meets the policy's own definition
  // (CIDefinitionMatch / DisabilityDefinitionMatch / cause-of-death match, by an authorised reviewer). Never waived here.
  const conds: CalcCondition[] = [{ id: "c_definition", kind: "definition", text: `${a.condition} must meet ${product}’s own definition, confirmed by a reviewed medical decision.`, status: "unresolved", basis: "none", needs: `a reviewed decision that ${a.who}’s diagnosis meets ${product}’s definition of ${a.condition} (the insurer’s medical assessment)` }];
  const evidenceRequirements = ["the specialist’s diagnosis report", "the insurer’s claim form and medical assessment"];
  const base = { calculator: "lump_sum" as const, subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, printed, evidence: printed.map((p) => p.evidence), evidenceRequirements, who: a.who, product };
  if (!a.whatIf || !a.percent || !a.assumptionWords?.trim()) return finish({ ...base, kind: "unresolved", conditions: conds, requirements: [conds[0].needs!], amount: null, currency: s.currency, record: null, steps: [] });
  const ops: CalcOperand[] = [];
  const sum = docOperand("sum_insured", "sum_insured", a.sumInsured, a.subjectId), pct = docOperand("percent", "percent", a.percent, a.subjectId);
  if (typeof sum === "string") return { refused: sum }; if (typeof pct === "string") return { refused: pct };
  ops.push(sum, pct);
  const part = Number(divHalfUp(BigInt(s.cents) * BigInt(a.percent.operand.ppm!), 1_000_000n));
  const steps: CalcStep[] = [{ id: "s_part", op: "percent_of", inputs: ["sum_insured", "percent"], out: part }];
  let out = part;
  if (a.cap) { const c = docOperand("cap", "cap", a.cap, a.subjectId); if (typeof c === "string") return { refused: c }; ops.push(c); out = Math.min(part, a.cap.operand.cents!); steps.push({ id: "s_cap", op: "min", inputs: ["s_part", "cap"], out }); }
  const record: Omit<CalculationRecord, "sentence"> = { id: "", calculator: "lump_sum", kind: "conditional_illustration", subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, operands: ops, steps, result: { value: out / 100, currency: s.currency }, currency: s.currency, rounding: { mode: "half_up", precision: 2, source: "default" }, conditions: conds, evidenceRequirements, assumption: a.assumptionWords.trim(), unresolvedText: "" };
  return finish({ ...base, kind: "conditional_illustration", conditions: conds, requirements: [conds[0].needs!], amount: out / 100, currency: s.currency, record, steps: [`${a.percent.operand.ppm! / 10_000}% of ${money(s.cents, s.currency)} = ${money(part, s.currency)}`, ...(a.cap ? [`capped at ${money(a.cap.operand.cents!, s.currency)}: ${money(out, s.currency)}`] : [])] });
}

export type { PolicyDayRule };

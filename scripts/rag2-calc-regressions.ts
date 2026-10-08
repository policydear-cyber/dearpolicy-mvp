/**
 * Agent K: the benefit calculation contract (npm run rag2:calc-test).
 *
 * PGlite with the real schema and this suite's own synthetic household (scripts/fixtures/rag2-calc/household.ts).
 *  D  day counts under the policy's own rule (lib/claims/day-count.ts): first full day, complete 24 hours, each night,
 *     day-or-part, across midnight, local offset, midnight admission, same-day stays.
 *  H  hospital cash through the calculate tool -> calculateHospitalCash: rule / waiting / minimum stay / day cap /
 *     exclusion read from the stored wording; dates, never nights; cap hit exactly; unresolved -> printed rate plus
 *     the specific missing information, no estimate; household nights refused by compute.
 *  B  bills -> calculateMedicalReimbursement + the shared deduction core: min(bill, per-fracture, annual), deductible
 *     larger than the bill, deductible then co-insurance with cap, half-up rounding, unresolved deduction order,
 *     mixed currency refused.
 *  L  lump sums: printed figure + reviewed-definition requirement; illustration only for a what-if.
 *  V  the save-time gate re-runs calculation records: valid deduction / cap / per-day survive; wrong operation,
 *     column, person, version, rule, unresolved condition, unquoted household words, payout / total wording, an
 *     illustration without a what-if, and a number merely printed on the page are rejected -- and the sentence is
 *     replaced by the calculation's specific unresolved requirement, never silently dropped.
 *  C  composer: three result kinds and the unresolved form.
 *  R  claim records only in a claim scenario (existing recordClaim workflow); ordinary questions never create one.
 * Prints an expected-vs-actual table; exit 1 if any check failed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ACCOUNT, DOCS, M, OTHER_ACCOUNT } from "./fixtures/rag2-calc/household";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
const table: { kase: string; expected: string; actual: string }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}
const expectRow = (kase: string, expected: unknown, actual: unknown) => { table.push({ kase, expected: String(expected), actual: String(actual) }); assert.equal(String(actual), String(expected), kase); };
const doc = (key: string) => DOCS.find((d) => d.key === key)!;
const ON = { DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;

async function main() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "v11-ingestion-evidence.sql"])
    await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  const execute = async (text: string, params: unknown[] = []) => { if (!params.length && /;\s*\S/.test(text)) { await db.exec(text); return { rows: [], rowCount: 0 }; } const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  pool.query = (async (text: string, params: unknown[] = []) => execute(text, params)) as typeof pool.query;
  pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household K'),($2,'Other household')", [ACCOUNT, OTHER_ACCOUNT]);
  for (const p of Object.values(M)) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [p.id, ACCOUNT, p.name, p.pref, p.rel]);
  for (const d of DOCS) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,'schedule',true,'ready',$8,$8,'scan_clean','active',$9)`, [d.id, ACCOUNT, d.owner, d.insurer, d.product, "K-" + d.key, d.type, d.key.toLowerCase() + ".pdf", d.hash]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1)", [d.id, m, ACCOUNT]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [ACCOUNT, d.id, Number(page), text]);
  }

  const DC = await import("@/lib/claims/day-count");
  const DED = await import("@/lib/claims/calculators/deductions");
  const MR = await import("@/lib/claims/calculators/medical-reimbursement");
  const CR = await import("@/lib/claims/calc-record");
  const R = await import("@/lib/rag2/tools");
  const K = await import("@/lib/rag2/compute");
  const CT = await import("@/lib/rag2/calc/tool");
  const CL = await import("@/lib/rag2/calc/claim-record");
  const CO = await import("@/lib/rag2/loop/compose");
  const { emptyLoopState } = await import("@/lib/rag2/loop/types");
  const { verifyAnswerFigures, FIGURE_LEFT_OUT_NOTE } = await import("@/lib/chat/answer-verification");
  type Out = import("@/lib/rag2/calc/engine").CalcOutcome;

  const ctxFor = () => R.createToolContext({ accountId: ACCOUNT, asOf: "2026-10-08" });
  const sel = async (ctx: ReturnType<typeof ctxFor>, key: string, benefit: string, who: string, want = "any") => {
    const r = await R.runTool(ctx, "select_table_value", { policy_id: doc(key).id, benefit, subject_id: who, want }, ON);
    assert.ok(r.ok, JSON.stringify(r)); const d = r.data as { status: string; valueId: string; value: number };
    assert.equal(d.status, "ok", `select ${key}/${benefit}: ${JSON.stringify(d).slice(0, 300)}`); return d;
  };
  const calc = async (ctx: ReturnType<typeof ctxFor>, args: Record<string, unknown>) => {
    const r = await R.runTool(ctx, "calculate", args, ON);
    if (!r.ok) return { refused: (r as { error: string }).error } as const;
    const d = r.data as { calc_id: string }; return CT.calcOutcomes(ctx).get(d.calc_id)! as Out & { purpose: string };
  };
  const at = (iso: string, words: string, assumed = false) => ({ at: iso, words, ...(assumed ? { assumed: true } : {}) });

  // ------------------------------------------------------------------------------------------------ D: day counts
  await check("D1 day counts under each rule (across midnight, local +08:00 dates, midnight admission, same day)", () => {
    const n = (rule: import("@/lib/claims/day-count").PolicyDayRule, a: string, b: string) => { const r = DC.payableDaysUnderRule(rule, a, b); return r.status === "calculated" ? r.grossNights : r.reasonCode; };
    const A = "2026-03-01T20:00+08:00", B = "2026-03-04T11:00+08:00"; // 63 hours, 3 local midnights
    expectRow("first full day, 1 Mar 20:00 -> 4 Mar 11:00", 2, n("first_full_day", A, B));
    expectRow("complete 24h, same stay (63 h)", 2, n("completed_24h", A, B));
    expectRow("each night, same stay", 3, n("per_night", A, B));
    expectRow("day or part of a day, same stay", 4, n("calendar_day_inclusive", A, B));
    expectRow("first full day, admitted 00:00 local", 3, n("first_full_day", "2026-03-01T00:00+08:00", B));
    expectRow("each night, 01:00 local (+08:00 is the previous UTC date) -> 23:00 same day", 0, n("per_night", "2026-03-02T01:00+08:00", "2026-03-02T23:00+08:00"));
    expectRow("first full day, same-day stay", 0, n("first_full_day", "2026-03-02T08:00+08:00", "2026-03-02T20:00+08:00"));
    expectRow("complete 24h, 23h59m", 0, n("completed_24h", "2026-03-02T08:00+08:00", "2026-03-03T07:59+08:00"));
    expectRow("timestamp without offset is blocked", "MISSING_TIMEZONE_OFFSET", n("per_night", "2026-03-02T08:00", "2026-03-03T07:59+08:00"));
    // The default calendar basis is unchanged (UTC dates) for existing callers.
    const utc = DC.computeHospitalDays({ admissionISO: "2026-03-02T01:00+08:00", dischargeISO: "2026-03-02T23:00+08:00", rule: "calendar_day", edgeInclusion: { admissionDayIncluded: true, dischargeDayIncluded: false }, icuPeriods: [], icuMode: null, waitingDays: 0 });
    assert.equal(utc.status === "calculated" ? utc.grossNights : -1, 1, "UTC basis unchanged for existing callers");
  });
  await check("D2 day-count wording is read, never defaulted; two different rules are not resolved by picking one", () => {
    assert.equal(DC.dayRuleFromWording("Hospital cash is payable from the first full day of admission.")?.rule, "first_full_day");
    assert.equal(DC.dayRuleFromWording("paid for every complete 24 hours in hospital")?.rule, "completed_24h");
    assert.equal(DC.dayRuleFromWording("S$200 for each night spent in hospital")?.rule, "per_night");
    assert.equal(DC.dayRuleFromWording("each day or part thereof")?.rule, "calendar_day_inclusive");
    assert.equal(DC.dayRuleFromWording("Hospital allowance S$50 per day"), null);
    assert.equal(DC.dayRuleFromWording("each night, or each complete 24 hours"), null);
  });

  // --------------------------------------------------------------------------------------------- H: hospital cash
  await check("H1 complete-24-hour rule: 63 h stay -> 2 periods x S$120 = S$240 indicative estimate (record re-runs)", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "H24", "Daily hospital income", M.ana.id, "amount");
    const c = await calc(ctx, { calculator: "hospital_cash", purpose: "question", subject_id: M.ana.id, policy_id: doc("H24").id, benefit: "Daily hospital income", rate_value_id: v.valueId, admission: at("2026-03-01T22:00+08:00", "admitted on 1 March at 10pm"), discharge: at("2026-03-04T09:00+08:00", "discharged on 4 March at 9am") });
    assert.ok(!("refused" in c), JSON.stringify(c));
    expectRow("H24 kind", "indicative_estimate", c.kind); expectRow("H24 amount", 240, c.amount);
    assert.ok(c.record && CR.recomputeCalculation(c.record).ok);
    assert.ok(c.record!.steps.some((s) => s.op === "day_count" && s.rule === "completed_24h"));
    assert.ok(c.record!.operands.some((o) => o.source === "document" && o.role === "day_cap" && o.value === 90), "the Maximum days row is read for the person's column");
  });
  await check("H2 child's column; each night after the first 2 nights, up to 20 days: 5 nights -> 3 x S$200 = S$600", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "NIGHT", "Night cash benefit", M.ana.id, "amount");
    const c = await calc(ctx, { calculator: "hospital_cash", purpose: "question", subject_id: M.ana.id, policy_id: doc("NIGHT").id, benefit: "Night cash benefit", rate_value_id: v.valueId, admission: at("2026-05-01", "went in on 1 May"), discharge: at("2026-05-06", "came home on 6 May") });
    assert.ok(!("refused" in c), JSON.stringify(c));
    expectRow("NIGHT amount (5 nights, 2 excess)", 600, c.amount);
    assert.deepEqual(c.record!.steps.map((s) => s.op), ["day_count", "days_after_waiting", "min_count", "multiply"]);
    const v2 = await sel(ctx, "H24", "Daily hospital income", M.ben.id, "amount");
    expectRow("H24 Ben's (child) column rate", 60, v2.value);
  });
  await check("H3 first full day + minimum stay + exclusion: unresolved until the household settles the exclusion; then 2 full days x S$80 (child) = S$160", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "FFD", "Hospital cash per day", M.ben.id, "amount");
    const args = { calculator: "hospital_cash", purpose: "claim", subject_id: M.ben.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId, admission: at("2026-03-01T20:00+08:00", "admitted 1 March 8pm"), discharge: at("2026-03-04T11:00+08:00", "discharged 4 March 11am") };
    const u = await calc(ctx, args); assert.ok(!("refused" in u), JSON.stringify(u));
    expectRow("FFD with open exclusion: kind", "unresolved", u.kind); expectRow("FFD with open exclusion: amount", "null", u.amount);
    assert.match(u.requirements.join(" "), /day surgery/); assert.equal(u.record, null);
    assert.ok(u.printed.some((p) => p.value === 80 && p.binding?.column === "Child"));
    const c = await calc(ctx, { ...args, settled: [{ condition_id: "c_excl_1", status: "not_applicable", words: "he was warded, it wasn't day surgery" }] });
    assert.ok(!("refused" in c), JSON.stringify(c));
    expectRow("FFD settled: amount (2 full days)", 160, c.amount);
    assert.equal(c.conditions.find((x) => x.kind === "minimum_stay")?.status, "established");
  });
  await check("H4 day cap hit exactly: 30 full days (cap 30) -> S$2,400; 31 full days -> still S$2,400", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "FFD", "Hospital cash per day", M.ben.id, "amount");
    const base = { calculator: "hospital_cash", purpose: "question", subject_id: M.ben.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId, settled: [{ condition_id: "c_excl_1", status: "not_applicable", words: "not day surgery" }] };
    const c30 = await calc(ctx, { ...base, admission: at("2026-04-01T10:00+08:00", "admitted 1 April 10am"), discharge: at("2026-05-02T09:00+08:00", "out 2 May 9am") });
    const c31 = await calc(ctx, { ...base, admission: at("2026-04-01T10:00+08:00", "admitted 1 April 10am"), discharge: at("2026-05-03T09:00+08:00", "out 3 May 9am") });
    assert.ok(!("refused" in c30) && !("refused" in c31));
    expectRow("cap exactly (30 full days)", 2400, c30.amount); expectRow("cap exceeded (31 full days)", 2400, c31.amount);
  });
  await check("H5 no day-count rule in the wording -> unresolved: printed S$50 rate + 'how days are counted'; never an estimate", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "PLAIN", "Hospital allowance per day", M.carl.id, "amount");
    const c = await calc(ctx, { calculator: "hospital_cash", purpose: "question", subject_id: M.carl.id, policy_id: doc("PLAIN").id, benefit: "Hospital allowance per day", rate_value_id: v.valueId, admission: at("2026-03-01", "1 March"), discharge: at("2026-03-04", "4 March") });
    assert.ok(!("refused" in c));
    expectRow("PLAIN kind", "unresolved", c.kind); expectRow("PLAIN amount", "null", c.amount);
    assert.match(c.unresolvedText, /counts hospital days/); assert.equal(moneyIn(c.unresolvedText), 0);
  });
  await check("H6 dates missing -> unresolved with the specific inputs the rule needs (dates AND times for first-full-day)", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "FFD", "Hospital cash per day", M.ben.id, "amount");
    const c = await calc(ctx, { calculator: "hospital_cash", purpose: "question", subject_id: M.ben.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId });
    assert.ok(!("refused" in c)); expectRow("FFD no dates kind", "unresolved", c.kind);
    assert.match(c.requirements.join(" "), /admission and discharge dates and times/);
    const d = await calc(ctx, { calculator: "hospital_cash", purpose: "question", subject_id: M.ben.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId, admission: at("2026-03-01", "1 March"), discharge: at("2026-03-04", "4 March") });
    assert.ok(!("refused" in d)); expectRow("FFD dates without times", "unresolved", d.kind);
  });
  await check("H7 minimum stay not met (4 h) -> not payable, with the wording's reason, no amount", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "FFD", "Hospital cash per day", M.ana.id, "amount");
    const c = await calc(ctx, { calculator: "hospital_cash", purpose: "question", subject_id: M.ana.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId, admission: at("2026-03-02T10:00+08:00", "in at 10am"), discharge: at("2026-03-02T14:00+08:00", "out at 2pm") });
    assert.ok(!("refused" in c)); expectRow("FFD 4 h stay", "not_payable", c.kind); assert.match(c.reason ?? "", /at least 6/);
  });
  await check("H8 household nights are never payable days: compute per_day / product with a household count refused; the old nights x rate estimate is gone", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "FFD", "Hospital cash per day", M.ben.id, "amount");
    const r = await R.runTool(ctx, "compute", { operation: "per_day", operands: [{ value_id: v.valueId }, { household: { label: "nights", attribution: "warded for 2 nights", count: 2 } }] }, ON);
    expectRow("compute per_day with household nights", "refused", r.ok ? "ok" : "refused");
    const p = await R.runTool(ctx, "compute", { operation: "product", operands: [{ value_id: v.valueId }, { household: { label: "nights", attribution: "warded for 2 nights", count: 2 } }] }, ON);
    assert.equal(p.ok, false);
    const bad = await R.runTool(ctx, "calculate", { calculator: "hospital_cash", purpose: "question", subject_id: M.ben.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId, nights: 2 }, ON);
    assert.equal(bad.ok, false, "a nights parameter does not exist");
  });
  await check("H9 assumed dates only for a what-if: refused for purpose question; an illustration for purpose what_if", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "H24", "Daily hospital income", M.ana.id, "amount");
    const base = { calculator: "hospital_cash", subject_id: M.ana.id, policy_id: doc("H24").id, benefit: "Daily hospital income", rate_value_id: v.valueId, admission: at("2026-06-01T09:00+08:00", "if I went in at 9am on 1 June", true), discharge: at("2026-06-06T09:00+08:00", "and left at 9am on 6 June", true) };
    const q = await calc(ctx, { ...base, purpose: "question" }); assert.ok("refused" in q);
    const w = await calc(ctx, { ...base, purpose: "what_if" }); assert.ok(!("refused" in w), JSON.stringify(w));
    expectRow("H24 what-if (5 x 24 h)", "conditional_illustration 600", `${w.kind} ${w.amount}`);
  });

  // ---------------------------------------------------------------------------------------------------- B: bills
  await check("B1 fracture: min(bill S$2,400, S$800 per fracture, S$1,500 child annual limit) = S$800", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "PA", "Accidental medical expenses", M.ben.id, "amount");
    const c = await calc(ctx, { calculator: "bill_reimbursement", purpose: "question", subject_id: M.ben.id, policy_id: doc("PA").id, benefit: "Accidental medical expenses", bill: { amount: 2400, currency: "SGD", words: "The bill was S$2,400" }, limit_value_ids: [v.valueId], passage_limits: [{ page: 2, quote: "Fractures are reimbursed under accidental medical expenses up to S$800 per fracture.", amount: 800, currency: "SGD", label: "Accidental medical expenses per fracture", applies: "sub_limit" }] });
    assert.ok(!("refused" in c), JSON.stringify(c));
    expectRow("fracture cap", 800, c.amount); expectRow("fracture kind", "indicative_estimate", c.kind);
    expectRow("child annual limit read from the Insured Child column", 1500, v.value);
  });
  await check("B2 deductible larger than the bill -> not payable (never a negative or S$0 'estimate')", async () => {
    const ctx = ctxFor(); const d = await sel(ctx, "SHIELD", "Deductible", M.carl.id, "amount");
    const c = await calc(ctx, { calculator: "bill_reimbursement", purpose: "question", subject_id: M.carl.id, policy_id: doc("SHIELD").id, benefit: "Hospital bill", bill: { amount: 2000, currency: "SGD", words: "my bill came to S$2,000" }, deductible_value_id: d.valueId });
    assert.ok(!("refused" in c)); expectRow("deductible > bill", "not_payable", c.kind); assert.match(c.reason ?? "", /does not exceed the deductible/);
  });
  await check("B3 deductible then 10% co-insurance capped at S$3,000: S$50,000 -> S$46,500 -> S$43,500", async () => {
    const ctx = ctxFor(); const d = await sel(ctx, "SHIELD", "Deductible", M.carl.id, "amount"), ci = await sel(ctx, "SHIELD", "Co-insurance", M.carl.id, "percent"), cap = await sel(ctx, "SHIELD", "Co-insurance cap", M.carl.id, "amount"), lim = await sel(ctx, "SHIELD", "Annual claim limit", M.carl.id, "amount");
    const c = await calc(ctx, { calculator: "bill_reimbursement", purpose: "question", subject_id: M.carl.id, policy_id: doc("SHIELD").id, benefit: "Hospital bill", bill: { amount: 50000, currency: "SGD", words: "the hospital bill is S$50,000" }, deductible_value_id: d.valueId, co_insurance_value_id: ci.valueId, co_insurance_cap_value_id: cap.valueId, limit_value_ids: [lim.valueId] });
    assert.ok(!("refused" in c), JSON.stringify(c));
    expectRow("deductible + co-insurance cap", 43500, c.amount);
    assert.equal(c.conditions.find((x) => x.kind === "deduction_order")?.status, "established");
  });
  await check("B4 rounding half-up to the cent, and the bill steps reproduce calculateMedicalReimbursement exactly", async () => {
    const ctx = ctxFor(); const d = await sel(ctx, "SHIELD", "Deductible", M.carl.id, "amount"), ci = await sel(ctx, "SHIELD", "Co-insurance", M.carl.id, "percent");
    const c = await calc(ctx, { calculator: "bill_reimbursement", purpose: "question", subject_id: M.carl.id, policy_id: doc("SHIELD").id, benefit: "Hospital bill", bill: { amount: 12345.67, currency: "SGD", words: "it was S$12,345.67" }, deductible_value_id: d.valueId, co_insurance_value_id: ci.valueId });
    assert.ok(!("refused" in c), JSON.stringify(c));
    expectRow("S$12,345.67 - S$3,500 then 90% (half-up)", 7961.1, c.amount);
    expectRow("core: 10% of 1005 cents, policy bears (half-up)", 905, DED.applyDeductionCore(1005, { kind: "co_insurance", ppm: 100_000 }).afterMinor);
    expectRow("core: 10% of 1015 cents (913.5 -> 914)", 914, DED.applyDeductionCore(1015, { kind: "co_insurance", ppm: 100_000 }).afterMinor);
    const ev = { policyId: "p", pageStart: 1, pageEnd: 1 };
    const mr = MR.calculateMedicalReimbursement({ currency: "SGD", eligibleCategories: ["x"], billedItems: [{ category: "x", description: "", amountMinor: 1015 }], categoryLimits: [], wardProration: null, panelRestriction: { panelStatus: "panel", nonPanelFactor: null, evidence: ev }, deductionSteps: [{ kind: "co_insurance", percent: 10, evidence: ev }], deductionOrderEvidenced: true, perAdmissionCap: null, thirdPartyCoordination: null, thirdPartyPayments: [], remainingLimits: [], ownership: { contractId: "c" }, ruleEvidence: ev, ownershipEvidence: ev });
    expectRow("claims calculator on the same core", 9.14, mr.status === "calculated" ? mr.potentialAmount : mr.status);
  });
  await check("B5 policy rounding in a record (to the dollar, down) re-runs; a wrong rounding is rejected", () => {
    const rec = { operands: [{ id: "bill", source: "household" as const, role: "bill" as const, label: "bill", unit: "money" as const, value: 100.99, currency: "SGD", attribution: "S$100.99" }, { id: "cap", source: "household" as const, role: "amount" as const, label: "cap", unit: "money" as const, value: 500, currency: "SGD", attribution: "S$500" }], steps: [{ id: "s", op: "min" as const, inputs: ["bill", "cap"], out: 10099 }], currency: "SGD" };
    assert.ok(CR.recomputeCalculation({ ...rec, result: { value: 100, currency: "SGD" }, rounding: { mode: "down", precision: 0, source: "policy" } }).ok);
    assert.equal(CR.recomputeCalculation({ ...rec, result: { value: 101, currency: "SGD" }, rounding: { mode: "down", precision: 0, source: "policy" } }).ok, false);
  });
  await check("B6 deduction order not printed -> unresolved with that requirement (no competing guess)", async () => {
    const ctx = ctxFor(); const d = await sel(ctx, "SHIELD2", "Deductible", M.ana.id, "amount"), ci = await sel(ctx, "SHIELD2", "Co-insurance", M.ana.id, "percent");
    const c = await calc(ctx, { calculator: "bill_reimbursement", purpose: "question", subject_id: M.ana.id, policy_id: doc("SHIELD2").id, benefit: "Hospital bill", bill: { amount: 9000, currency: "SGD", words: "S$9,000 bill" }, deductible_value_id: d.valueId, co_insurance_value_id: ci.valueId });
    assert.ok(!("refused" in c)); expectRow("order unresolved", "unresolved", c.kind); assert.match(c.unresolvedText, /deductible or the co-insurance first/);
  });
  await check("B8 order of the excess and the limit follows the wording: silent and it matters -> unresolved; silent and it does not -> estimate; stated (excess first) -> applied as stated", async () => {
    const run = async (key: string, bill: number) => { const ctx = ctxFor(); const l = await sel(ctx, key, "Outpatient accident treatment", M.carl.id, "amount"), x = await sel(ctx, key, "Excess", M.carl.id, "amount");
      return calc(ctx, { calculator: "bill_reimbursement", purpose: "question", subject_id: M.carl.id, policy_id: doc(key).id, benefit: "Outpatient accident treatment", bill: { amount: bill, currency: "SGD", words: `the bill was S$${bill}` }, limit_value_ids: [l.valueId], deductible_value_id: x.valueId }); };
    const silent = await run("XS1", 1500); assert.ok(!("refused" in silent), JSON.stringify(silent));
    expectRow("silent, order matters (S$1,100 vs S$1,200)", "unresolved", silent.kind); assert.match(silent.unresolvedText, /before or after applying the limit/);
    const same = await run("XS1", 1000); assert.ok(!("refused" in same)); expectRow("silent, either order S$900", "indicative_estimate 900", `${same.kind} ${same.amount}`);
    const stated = await run("XS2", 1500); assert.ok(!("refused" in stated), JSON.stringify(stated));
    expectRow("excess first, then the S$1,200 limit: min(1,400, 1,200)", "indicative_estimate 1200", `${stated.kind} ${stated.amount}`);
    assert.equal(stated.conditions.find((c) => c.id === "c_limit_order")?.status, "established");
  });
  await check("B7 mixed currency refused: an SGD bill against a US$ limit -> unresolved; compute sum of SGD + USD refused", async () => {
    const ctx = ctxFor(); const l = await sel(ctx, "TRAVEL", "Overseas medical expenses", M.ana.id, "amount");
    const c = await calc(ctx, { calculator: "bill_reimbursement", purpose: "question", subject_id: M.ana.id, policy_id: doc("TRAVEL").id, benefit: "Overseas medical expenses", bill: { amount: 3000, currency: "SGD", words: "S$3,000 at the clinic" }, limit_value_ids: [l.valueId] });
    assert.ok(!("refused" in c)); expectRow("SGD bill vs USD limit", "unresolved", c.kind); assert.match(c.unresolvedText, /in USD/);
    const s = K.sum([K.householdFigure("a", "S$1", { amount: 1, currency: "SGD" }), K.householdFigure("b", "US$1", { amount: 1, currency: "USD" })]);
    assert.equal(s.status, "refused");
  });

  // ------------------------------------------------------------------------------------------------ L: lump sums
  await check("L1 lump sum: a question gives the printed sum + the reviewed-definition requirement; a what-if gives 25% of S$150,000 = S$37,500 (cap S$50,000) as an illustration", async () => {
    const ctx = ctxFor(); const s = await sel(ctx, "CI", "Sum assured", M.ana.id, "amount"), p = await sel(ctx, "CI", "Early stage critical illness", M.ana.id, "percent"), cap = await sel(ctx, "CI", "Early stage cap", M.ana.id, "amount");
    const base = { calculator: "lump_sum", subject_id: M.ana.id, policy_id: doc("CI").id, benefit: "Early stage critical illness", sum_insured_value_id: s.valueId, percent_value_id: p.valueId, cap_value_id: cap.valueId, condition: "early-stage cancer" };
    const q = await calc(ctx, { ...base, purpose: "question" }); assert.ok(!("refused" in q));
    expectRow("CI question", "unresolved", q.kind); assert.match(q.unresolvedText, /reviewed decision/);
    const w = await calc(ctx, { ...base, purpose: "what_if", assumption_words: "if it turns out to be early-stage cancer" }); assert.ok(!("refused" in w));
    expectRow("CI what-if", "conditional_illustration 37500", `${w.kind} ${w.amount}`);
  });

  // -------------------------------------------------------------------------------------------- V: verifier
  const answerWith = (sentence: string, calc: Out, extra: Partial<import("@/types").ChatAnswer> = {}): import("@/types").ChatAnswer => ({ mode: "answer", summary: sentence, details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], calculations: calc.record ? [{ ...calc.record, sentence }] : [], ...extra } as import("@/types").ChatAnswer);
  const fracture = async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "PA", "Accidental medical expenses", M.ben.id, "amount");
    const c = await calc(ctx, { calculator: "bill_reimbursement", purpose: "question", subject_id: M.ben.id, policy_id: doc("PA").id, benefit: "Accidental medical expenses", bill: { amount: 2400, currency: "SGD", words: "The bill was S$2,400" }, limit_value_ids: [v.valueId], passage_limits: [{ page: 2, quote: "Fractures are reimbursed under accidental medical expenses up to S$800 per fracture.", amount: 800, currency: "SGD", label: "Accidental medical expenses per fracture", applies: "sub_limit" }] });
    assert.ok(!("refused" in c)); return c;
  };
  const shield = async () => {
    const ctx = ctxFor(); const d = await sel(ctx, "SHIELD", "Deductible", M.carl.id, "amount"), ci = await sel(ctx, "SHIELD", "Co-insurance", M.carl.id, "percent"), cap = await sel(ctx, "SHIELD", "Co-insurance cap", M.carl.id, "amount");
    const c = await calc(ctx, { calculator: "bill_reimbursement", purpose: "question", subject_id: M.carl.id, policy_id: doc("SHIELD").id, benefit: "Hospital bill", bill: { amount: 50000, currency: "SGD", words: "the hospital bill is S$50,000" }, deductible_value_id: d.valueId, co_insurance_value_id: ci.valueId, co_insurance_cap_value_id: cap.valueId });
    assert.ok(!("refused" in c)); return c;
  };
  const ffd = async (rule?: string) => {
    const ctx = ctxFor(); const v = await sel(ctx, "FFD", "Hospital cash per day", M.ben.id, "amount");
    const c = await calc(ctx, { calculator: "hospital_cash", purpose: "question", subject_id: M.ben.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId, admission: at("2026-03-01T20:00+08:00", "admitted 1 March 8pm"), discharge: at("2026-03-04T11:00+08:00", "discharged 4 March 11am"), settled: [{ condition_id: "c_excl_1", status: "not_applicable", words: "not day surgery" }] });
    assert.ok(!("refused" in c)); void rule; return c;
  };
  const FRACTURE_TEXT = "Indicative estimate: for the S$2,400 bill you gave, Ben's accidental medical expenses for the fracture come to S$800.";
  const FRACTURE_USER = "The bill was S$2,400. How much can we claim for his fracture?";
  const gate = async (a: import("@/types").ChatAnswer, userText: string) => ({ problems: await verifyAnswerFigures(a, { accountId: ACCOUNT, userText }), a });
  await check("V1 valid cap on the household's bill survives (household figure attributed, cap and result re-run)", async () => {
    const c = await fracture(); const { problems, a } = await gate(answerWith(FRACTURE_TEXT, c), FRACTURE_USER);
    expectRow("gate: valid min/cap record", "kept", problems.length ? "rejected: " + problems[0].reason : "kept"); assert.equal(a.summary, FRACTURE_TEXT);
  });
  await check("V2 valid deductible + co-insurance cap survives; the household's bill without attribution is rejected", async () => {
    const c = await shield();
    const ok = await gate(answerWith("Indicative estimate: for the S$50,000 bill you gave, after the S$3,500 deductible and your co-insurance share (capped at S$3,000), Verdant Shield Plus would leave S$43,500 of the hospital bill.", c), "the hospital bill is S$50,000, what would the plan cover?");
    expectRow("gate: valid deduction record", "kept", ok.problems.length ? "rejected: " + ok.problems[0].reason : "kept");
    const bad = await gate(answerWith("Indicative estimate: on a S$50,000 hospital bill Verdant Shield Plus would leave S$43,500.", c), "the hospital bill is S$50,000, what would the plan cover?");
    expectRow("gate: household figure unattributed", "rejected", bad.problems.length ? "rejected" : "kept");
  });
  await check("V3 valid per-day with the wording's day-count rule survives", async () => {
    const c = await ffd();
    const r = await gate(answerWith("Indicative estimate: Ben's hospital cash under Kestrel DayCare Cash comes to S$160 for the full days of his stay.", c), "admitted 1 March 8pm and discharged 4 March 11am; not day surgery");
    expectRow("gate: per-day with first-full-day rule", "kept", r.problems.length ? "rejected: " + r.problems[0].reason : "kept");
  });
  const tamper = async (name: string, mk: () => Promise<Out>, f: (r: import("@/types").CalculationRecord) => void, text: string, user: string, want: RegExp) => {
    await check(name, async () => {
      const c = await mk(); const rec = { ...structuredClone(c.record!), sentence: "" }; f(rec);
      const a = answerWith(text, { ...c, record: rec });
      const { problems } = await gate(a, user);
      expectRow(name.split(":")[0] + " -> rejected", "rejected", problems.length ? "rejected" : "kept");
      assert.match(problems[0].reason, want);
      // Never silently dropped: the sentence is replaced by the calculation's specific requirement.
      assert.ok(a.summary.includes("I still need") || a.summary.includes("does not apply"), "the unresolved requirement is stated: " + a.summary);
      assert.ok(!a.summary.includes("S$"), "no figure is left");
      assert.ok(!a.details.includes(FIGURE_LEFT_OUT_NOTE), "the specific requirement replaces the generic note");
    });
  };
  await tamper("V4 wrong operation: a 'min' step whose output is the sum", fracture, (r) => { const s = r.steps.find((x) => x.op === "min")!; s.out = 240000 + 80000; r.steps[r.steps.length - 1].out = 320000; r.result.value = 3200; }, FRACTURE_TEXT.replace("S$800", "S$3,200"), FRACTURE_USER, /re-running it gives|stated result/);
  await tamper("V5 wrong column: the limit bound to the Insured Adult column for the child", fracture, (r) => { const o = r.operands.find((x) => x.id === "lim1") as Extract<import("@/types").CalcOperand, { source: "document" }>; o.value = 3000; o.binding = { ...o.binding, column: "Insured Adult" }; o.column = "Insured Adult"; }, FRACTURE_TEXT, FRACTURE_USER, /column|person/i);
  await tamper("V6 wrong person: an operand bound to another household member", fracture, (r) => { const o = r.operands.find((x) => x.source === "document") as Extract<import("@/types").CalcOperand, { source: "document" }>; o.binding = { ...o.binding, subjectId: M.carl.id }; }, FRACTURE_TEXT, FRACTURE_USER, /another person|does not speak/);
  await tamper("V7 wrong version: the record names another document hash", fracture, (r) => { r.documentHash = "sha256:old"; }, FRACTURE_TEXT, FRACTURE_USER, /version/);
  await tamper("V8 wrong day-count rule: 'each night' where the wording says first full day", ffd, (r) => { const s = r.steps.find((x) => x.op === "day_count")!; (s as { rule: string }).rule = "per_night"; s.out = 3; r.steps.find((x) => x.op === "min_count")!.out = 3; r.steps[r.steps.length - 1].out = 24000; r.result.value = 240; }, "Indicative estimate: Ben's hospital cash under Kestrel DayCare Cash comes to S$240 for his stay.", "admitted 1 March 8pm, discharged 4 March 11am, not day surgery", /rule/);
  await tamper("V9 an unresolved condition in an estimate", ffd, (r) => { const c = r.conditions.find((x) => x.kind === "exclusion")!; c.status = "unresolved"; c.basis = "none"; }, "Indicative estimate: Ben's hospital cash under Kestrel DayCare Cash comes to S$160 for his stay.", "admitted 1 March 8pm, discharged 4 March 11am, not day surgery", /unresolved/);
  await tamper("V10 household words not in their messages", fracture, (r) => { (r.operands.find((x) => x.source === "household") as { attribution: string }).attribution = "the bill was S$2,400 exactly"; }, FRACTURE_TEXT, FRACTURE_USER, /not in their messages/);
  await tamper("V11 nights for days: a hospital-cash record without a day count from the dates", ffd, (r) => { r.steps = r.steps.filter((x) => x.op !== "day_count").map((x) => x.op === "min_count" ? { ...x, inputs: ["day_cap", "day_cap"] as string[] } : x) as typeof r.steps; r.steps.find((x) => x.op === "min_count")!.out = 30; r.steps[r.steps.length - 1] = { ...r.steps[r.steps.length - 1], out: 240000 } as typeof r.steps[number]; r.result.value = 2400; }, "Indicative estimate: Ben's hospital cash under Kestrel DayCare Cash comes to S$2,400.", "admitted 1 March 8pm, discharged 4 March 11am, not day surgery", /day count|counted from the admission/);
  await check("V12 payout wording, a total, and an illustration without a what-if are rejected", async () => {
    const c = await fracture();
    const p = await gate(answerWith("Indicative estimate: for the S$2,400 bill you gave, you will receive S$800 for Ben's fracture.", c), FRACTURE_USER);
    expectRow("gate: payout wording", "rejected", p.problems.length ? "rejected" : "kept");
    const t = await gate(answerWith("Indicative estimate: for the S$2,400 bill you gave, the total for Ben's fracture comes to S$800.", c), FRACTURE_USER);
    expectRow("gate: estimate stated as a total", "rejected", t.problems.length ? "rejected" : "kept");
    const ctx = ctxFor(); const v = await sel(ctx, "H24", "Daily hospital income", M.ana.id, "amount");
    const w = await calc(ctx, { calculator: "hospital_cash", purpose: "what_if", subject_id: M.ana.id, policy_id: doc("H24").id, benefit: "Daily hospital income", rate_value_id: v.valueId, admission: at("2026-06-01T09:00+08:00", "went in at 9am on 1 June", true), discharge: at("2026-06-06T09:00+08:00", "left at 9am on 6 June", true) });
    assert.ok(!("refused" in w));
    const okIll = await gate(answerWith("If Ana went in at 9am on 1 June and left at 9am on 6 June, HarbourCare's daily hospital income wording gives S$600.", w), "What if I went in at 9am on 1 June and left at 9am on 6 June?");
    expectRow("gate: illustration for a what-if", "kept", okIll.problems.length ? "rejected: " + okIll.problems[0].reason : "kept");
    const noIf = await gate(answerWith("If Ana went in at 9am on 1 June and left at 9am on 6 June, HarbourCare's daily hospital income wording gives S$600.", w), "I went in at 9am on 1 June and left at 9am on 6 June.");
    expectRow("gate: illustration without a what-if asked", "rejected", noIf.problems.length ? "rejected" : "kept");
  });
  await check("V13 a number merely printed on the cited page never validates a calculation (S$160 is the ICU row)", async () => {
    const ctx = ctxFor(); const icu = await sel(ctx, "FFD", "ICU cash per day", M.ben.id, "amount");
    const e = ctx.values.get(icu.valueId)!.operand.evidence;
    const s = "Indicative estimate: Ben's hospital cash for two days comes to S$160.";
    const a: import("@/types").ChatAnswer = { mode: "answer", summary: s, details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [],
      figureBindings: [{ policyId: e.policyId, subjectId: M.ben.id, benefit: "ICU cash per day", documentHash: e.documentHash, pageStart: e.page.start, pageEnd: e.page.end, passage: e.passage.text, column: "Child", sentence: s, value: 160, currency: "SGD" }] } as import("@/types").ChatAnswer;
    const { problems } = await gate(a, "he was in for two days");
    expectRow("gate: page number without a calculation", "rejected", problems.length ? "rejected" : "kept");
  });
  await check("V14 household words from an earlier turn of the same conversation are accepted (stored user messages)", async () => {
    const conv = (await db.query<{ id: string }>("INSERT INTO chat_conversations(account_id,family_member_id,title) VALUES($1,$2,'k') RETURNING id", [ACCOUNT, M.ana.id])).rows[0].id;
    await db.query("INSERT INTO chat_messages(account_id,family_member_id,role,content,conversation_id) VALUES($1,$2,'user',$3,$4)", [ACCOUNT, M.ana.id, "The bill was S$2,400.", conv]);
    const c = await fracture();
    const a = answerWith(FRACTURE_TEXT, c, { conversationId: conv } as Partial<import("@/types").ChatAnswer>);
    const { problems } = await gate(a, "So how much for his fracture?");
    expectRow("gate: earlier-turn household words", "kept", problems.length ? "rejected: " + problems[0].reason : "kept");
    const b = answerWith(FRACTURE_TEXT, c);
    const r2 = await gate(b, "So how much for his fracture?");
    expectRow("gate: household words found nowhere", "rejected", r2.problems.length ? "rejected" : "kept");
  });

  // ------------------------------------------------------------------------------------------------ C: composer
  await check("C1 composer: an unresolved result gives the printed rate (bound) plus the specific requirement; an estimate carries its record", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "FFD", "Hospital cash per day", M.ben.id, "amount");
    const u = await calc(ctx, { calculator: "hospital_cash", purpose: "question", subject_id: M.ben.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId });
    assert.ok(!("refused" in u));
    const state = emptyLoopState();
    const cx = { state, tools: ctx, computeCalls: new Map(), householdIds: new Set(Object.values(M).map((m) => m.id)), userText: "How much hospital cash does Ben get?" };
    const comp = CO.composeFinal({ sentences: [{ text: "Ben's hospital cash per day under Kestrel DayCare Cash is S$80.", result_id: u.calcId }, { text: "Indicative estimate: about S$160.", result_id: u.calcId }], subjectId: M.ben.id }, cx);
    expectRow("composer unresolved: sentences", "printed+requirement", comp.sentences.map((s) => s.kind).join("+").replace("printed+requirement", "printed+requirement"));
    assert.equal(comp.figureBindings.length, 1); assert.equal(comp.calculations.length, 0);
    assert.ok(comp.dropped.some((d) => /not a printed figure|estimate/.test(d.reason)), "an estimate from an unresolved result is dropped");
    const e = await calc(ctx, { calculator: "hospital_cash", purpose: "question", subject_id: M.ben.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId, admission: at("2026-03-01T20:00+08:00", "admitted 1 March 8pm"), discharge: at("2026-03-04T11:00+08:00", "discharged 4 March 11am"), settled: [{ condition_id: "c_excl_1", status: "not_applicable", words: "not day surgery" }] });
    assert.ok(!("refused" in e));
    state.claim = { subjectId: M.ben.id, facts: { admitted_at: { value: "2026-03-01T20:00+08:00", words: "admitted 1 March 8pm", turn: 1 }, discharged_at: { value: "2026-03-04T11:00+08:00", words: "discharged 4 March 11am", turn: 1 } }, derived: [] };
    const comp2 = CO.composeFinal({ sentences: [{ text: "Ben's hospital cash under Kestrel DayCare Cash comes to S$160 for his stay.", result_id: e.calcId }] }, cx);
    expectRow("composer estimate: label + record", "true 1", `${comp2.sentences[0]?.text.startsWith("Indicative estimate:")} ${comp2.calculations.length}`);
    const comp3 = CO.composeFinal({ sentences: [{ text: "Ben will be paid S$160.", result_id: e.calcId }] }, cx);
    assert.equal(comp3.sentences.length, 0, "a payout is dropped");
  });

  // ------------------------------------------------------------------------------------------- R: claim records
  await check("R1 claim records: a claim scenario creates one (no amount on it); an ordinary question or a what-if never does", async () => {
    const count = async () => Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM claim_sessions WHERE account_id=$1", [ACCOUNT])).rows[0].n);
    const ctx = ctxFor(); const v = await sel(ctx, "FFD", "Hospital cash per day", M.ben.id, "amount");
    const q = await calc(ctx, { calculator: "hospital_cash", purpose: "question", subject_id: M.ben.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId });
    const claimC = await calc(ctx, { calculator: "hospital_cash", purpose: "claim", subject_id: M.ben.id, policy_id: doc("FFD").id, benefit: "Hospital cash per day", rate_value_id: v.valueId });
    assert.ok(!("refused" in q) && !("refused" in claimC));
    const conv = (await db.query<{ id: string }>("INSERT INTO chat_conversations(account_id,family_member_id,title) VALUES($1,$2,'k2') RETURNING id", [ACCOUNT, M.ben.id])).rows[0].id;
    const before = await count();
    const noFacts = emptyLoopState();
    expectRow("claim purpose without recorded event facts", "null", String(await CL.syncCalcClaimRecord({ accountId: ACCOUNT, conversationId: conv, state: noFacts, calcs: [claimC] })));
    const withFacts = emptyLoopState(); withFacts.claim = { subjectId: M.ben.id, facts: { injury: { value: "fracture (arm)", words: "broke his arm", turn: 1 }, admitted: { value: "yes", words: "he was warded", turn: 1 } }, derived: [] };
    expectRow("ordinary question with event facts", "null", String(await CL.syncCalcClaimRecord({ accountId: ACCOUNT, conversationId: conv, state: withFacts, calcs: [q] })));
    assert.equal(await count(), before, "no claim record for ordinary questions");
    const rec = await CL.syncCalcClaimRecord({ accountId: ACCOUNT, conversationId: conv, state: withFacts, calcs: [claimC] });
    assert.ok(rec?.id); expectRow("claim scenario creates a record", before + 1, await count());
    const again = await CL.syncCalcClaimRecord({ accountId: ACCOUNT, conversationId: conv, state: withFacts, calcs: [claimC] });
    expectRow("the same conversation updates the same record", rec!.id, again!.id);
    const row = (await db.query<{ status: string; family_member_id: string; decision_packet: unknown; facts: { hospitalised: boolean | null } }>("SELECT status, family_member_id::text, decision_packet, facts FROM claim_sessions WHERE id=$1", [rec!.id])).rows[0];
    assert.equal(row.family_member_id, M.ben.id); assert.equal(row.status, "fact_finding", "unresolved requirements keep the claim open");
    assert.equal(row.facts.hospitalised, true);
  });

  console.log("\nExpected vs actual:");
  console.log("| case | expected | actual |\n|---|---|---|");
  for (const r of table) console.log(`| ${r.kase} | ${r.expected} | ${r.actual} |`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2:calc-test ${results.length - failed.length}/${results.length} passed`);
  await db.close();
  process.exit(failed.length ? 1 : 0);
}
const moneyIn = (t: string) => (t.match(/S\$\s?\d/g) ?? []).length;
main().catch((e) => { console.error(e); process.exit(1); });

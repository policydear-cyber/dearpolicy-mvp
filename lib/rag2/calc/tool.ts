/**
 * Agent K: the `calculate` tool. The model picks the calculator that fits the benefit and passes value ids it read
 * with select_table_value (or a quoted printed passage), the household's own inputs (each with their verbatim words)
 * and the purpose; the server validates every input, reads the benefit's own conditions from the stored wording
 * (terms.ts) and runs the claim calculators (engine.ts). Registered beside the lib/rag2 tools (tools.ts imports
 * CALC_TOOLS); results are kept per tool context so the composer can bind a sentence to them (calcOutcomes).
 */
import type { JsonSchema, ToolContext, ToolDef, ToolResult } from "../tools";
import { evidenceFor, type EvidenceRef } from "../evidence";
import { loadMembers, pageMap, loadDocs } from "../store";
import type { TableValueOperand } from "../compute";
import { billReimbursement, hospitalCash, lumpSum, type CalcOutcome, type DocValue, type HouseholdInput, type Refusal } from "./engine";
import { readBenefitTerms } from "./terms";

const outcomes = new WeakMap<ToolContext, Map<string, CalcOutcome>>();
/** The calculations made in this tool context (calc id -> outcome). */
export function calcOutcomes(ctx: ToolContext): Map<string, CalcOutcome> {
  let m = outcomes.get(ctx); if (!m) { m = new Map(); outcomes.set(ctx, m); } return m;
}

const str = (d: string): JsonSchema => ({ type: "string", description: d });
const INPUT = (d: string, props: Record<string, JsonSchema>, required: string[]): JsonSchema => ({ type: "object", description: d, properties: { ...props, words: str("The household's own words this comes from, quoted verbatim."), assumed: { type: "boolean", description: "true only for a what-if the household asked about (purpose what_if)." } }, required: [...required, "words"], additionalProperties: false });
const AT = INPUT("A date-time the household gave: ISO 8601 with the hospital's UTC offset (e.g. 2026-10-05T14:30+08:00), or a date (YYYY-MM-DD) when only the date is known.", { at: str("ISO date-time with offset, or YYYY-MM-DD.") }, ["at"]);
const PASSAGE_FIGURE: JsonSchema = { type: "object", description: "A limit printed in a sentence (not a table): the page and the verbatim quote that prints it.", properties: { page: { type: "integer", minimum: 1 }, quote: str("Verbatim from the page."), amount: { type: "number" }, currency: str("ISO code."), label: str("What the limit is (\"accidental medical expenses per fracture\")."), applies: { type: "string", enum: ["sub_limit", "limit"] } }, required: ["page", "quote", "amount", "currency", "label", "applies"], additionalProperties: false };

export const CALCULATE_TOOL: ToolDef = {
  name: "calculate",
  description: "Work out a benefit for one household member from one document with DearPolicy's claim calculators. calculator: hospital_cash (a daily rate; the policy's own day-count rule, waiting days, minimum stay and day cap are read from the document -- pass admission/discharge as dates or date-times, NEVER a number of nights), bill_reimbursement (the household's bill against printed sub-limits / limits, deductible, co-insurance and co-insurance cap), lump_sum (sum insured x printed percentage, capped; only ever an illustration for a what-if). purpose: question, what_if (only when the household asked 'what if'; inputs marked assumed), claim (the household is pursuing a claim for an event). Returns kind = indicative_estimate (every condition established), conditional_illustration (a what-if), unresolved (the printed figures to cite plus the specific missing information -- ask for it or state it; never estimate) or not_payable (with the wording's reason), with a calc_id to cite as result_id in final_answer.",
  parameters: { type: "object", properties: {
    calculator: { type: "string", enum: ["hospital_cash", "bill_reimbursement", "lump_sum"] },
    purpose: { type: "string", enum: ["question", "what_if", "claim"] },
    subject_id: str("The household member."), policy_id: str("The document."), benefit: str("The benefit, as the document words it."),
    rate_value_id: str("hospital_cash: the daily rate's value id."), day_cap_value_id: str("hospital_cash: a printed maximum number of days (value id), when the table prints one."),
    admission: AT, discharge: AT, stay_ongoing: { type: "boolean" },
    prior_use: { type: "object", description: "hospital_cash: what the household said about earlier use of a limit that runs per year / policy year / disability (\"max 90 per year\"): periods already paid, or the amount already paid. Only from their words; never guessed. (\"None this year\" settles it through settled instead.)", properties: { periods: { type: "integer", minimum: 0 }, amount: { type: "number", minimum: 0 }, currency: str("ISO code of the amount."), words: str("The household's own words, quoted verbatim.") }, required: ["words"], additionalProperties: false },
    bill: INPUT("bill_reimbursement: the bill amount the household gave.", { amount: { type: "number", minimum: 0 }, currency: str("ISO code the household gave.") }, ["amount", "currency"]),
    sub_limit_value_ids: { type: "array", items: { type: "string" }, description: "Printed sub-limits applied to the bill first (value ids)." },
    limit_value_ids: { type: "array", items: { type: "string" }, description: "Printed limits applied last (per admission / per year), value ids." },
    passage_limits: { type: "array", items: PASSAGE_FIGURE },
    deductible_value_id: str("A printed deductible (value id)."), co_insurance_value_id: str("A printed co-insurance percentage (value id)."), co_insurance_cap_value_id: str("A printed cap on the co-insurance share (value id)."),
    sum_insured_value_id: str("lump_sum: the sum insured (value id)."), percent_value_id: str("lump_sum: the printed percentage payable (value id)."), cap_value_id: str("lump_sum: a printed cap (value id)."),
    condition: str("lump_sum: the illness / disability / event the household asked about."),
    assumption_words: str("lump_sum what_if: the household's what-if, quoted."),
    settled: { type: "array", items: { type: "object", properties: { condition_id: str("A condition id from an earlier calculate result."), status: { type: "string", enum: ["established", "not_applicable"] }, words: str("The household's own words that settle it, quoted.") }, required: ["condition_id", "status", "words"], additionalProperties: false } },
  }, required: ["calculator", "purpose", "subject_id", "policy_id", "benefit"], additionalProperties: false },
  handler: async (ctx, a) => runCalculate(ctx, a),
};
export const CALC_TOOLS: ToolDef[] = [CALCULATE_TOOL];

const fail = (error: string, evidence: EvidenceRef[] = []): ToolResult => ({ ok: false, error, evidence });

export async function runCalculate(ctx: ToolContext, a: Record<string, unknown>): Promise<ToolResult> {
  const subjectId = String(a.subject_id), policyId = String(a.policy_id), benefit = String(a.benefit).trim();
  const purpose = String(a.purpose) as "question" | "what_if" | "claim";
  const whatIf = purpose === "what_if";
  const member = (await loadMembers(ctx.accountId)).find((m) => m.id === subjectId);
  if (!member) return fail("subject_id is not an active member of this household");
  const doc = (await loadDocs(ctx.accountId, [policyId]))[0];
  if (!doc) return fail("that document is not one of this household's readable documents");
  const who = member.preferredName || member.displayName;
  const value = (key: string, want?: TableValueOperand["valueKind"]): DocValue | string | null => {
    const id = a[key]; if (id == null) return null;
    const v = ctx.values.get(String(id));
    if (!v) return `${key}: unknown value id ${String(id)} (values must come from select_table_value in this conversation)`;
    if (v.subjectId !== subjectId) return `${key}: ${String(id)} was read for another person`;
    if (v.operand.evidence.policyId !== policyId) return `${key}: ${String(id)} is from another document`;
    if (want && v.operand.valueKind !== want) return `${key}: ${String(id)} is a printed ${v.operand.valueKind}, not a ${want}`;
    return { operand: v.operand, valueId: String(id) };
  };
  const values = (key: string): DocValue[] | string => { const out: DocValue[] = []; for (const id of (a[key] as string[]) ?? []) { const x = ctx.values.get(String(id)); if (!x) return `${key}: unknown value id ${id}`; if (x.subjectId !== subjectId || x.operand.evidence.policyId !== policyId) return `${key}: ${id} is for another person or document`; out.push({ operand: x.operand, valueId: id }); } return out; };
  const household = (key: string, unit: "at" | "bill"): HouseholdInput | string | null => {
    const h = a[key] as Record<string, unknown> | undefined; if (!h) return null;
    const words = String(h.words ?? "").trim(); if (!words) return `${key}: the household's own words are required`;
    const assumed = h.assumed === true;
    if (assumed && !whatIf) return `${key}: an assumed input is allowed only for purpose what_if`;
    if (unit === "at") return { value: String(h.at ?? ""), words, kind: assumed ? "assumption" : "household" };
    if (typeof h.amount !== "number" || !Number.isFinite(h.amount) || h.amount < 0) return `${key}: the amount is not a number`;
    return { value: h.amount, currency: typeof h.currency === "string" ? h.currency.toUpperCase() : null, words, kind: assumed ? "assumption" : "household" };
  };
  const settled = ((a.settled as { condition_id: string; status: "established" | "not_applicable"; words: string }[]) ?? []).map((s) => ({ id: s.condition_id, status: s.status, words: s.words }));
  const terms = await readBenefitTerms({ accountId: ctx.accountId, policyId, benefit, subjectId });
  if (!terms) return fail("that document is not one of this household's readable documents");

  let out: CalcOutcome | Refusal;
  if (a.calculator === "hospital_cash") {
    const rate = value("rate_value_id", "money"); if (typeof rate === "string") return fail(rate); if (!rate) return fail("hospital_cash needs rate_value_id (read the daily rate with select_table_value first)");
    let cap = value("day_cap_value_id", "count"); if (typeof cap === "string") return fail(cap);
    if (!cap) cap = await autoDayCap(ctx, policyId, subjectId, benefit);
    const adm = household("admission", "at"), dis = household("discharge", "at");
    if (typeof adm === "string") return fail(adm); if (typeof dis === "string") return fail(dis);
    const t2 = await readBenefitTerms({ accountId: ctx.accountId, policyId, benefit, subjectId, rowLabel: rate.operand.evidence.table?.rowLabel ?? null });
    const pu = a.prior_use as { periods?: number; amount?: number; currency?: string; words?: string } | undefined;
    if (pu && !String(pu.words ?? "").trim()) return fail("prior_use: the household's own words are required");
    const priorUse = pu ? { periods: typeof pu.periods === "number" ? pu.periods : null, amount: typeof pu.amount === "number" ? pu.amount : null, currency: typeof pu.currency === "string" ? pu.currency.toUpperCase() : null, words: String(pu.words) } : null;
    out = hospitalCash({ subjectId, who, benefit, terms: t2 ?? terms, rate, dayCap: cap, admission: adm, discharge: dis, ongoing: a.stay_ongoing === true, settled, whatIf, priorUse });
  } else if (a.calculator === "bill_reimbursement") {
    const subs = values("sub_limit_value_ids"), lims = values("limit_value_ids"); if (typeof subs === "string") return fail(subs); if (typeof lims === "string") return fail(lims);
    for (const p of (a.passage_limits as Record<string, unknown>[]) ?? []) { const v = await passageFigure(ctx, policyId, subjectId, p); if (typeof v === "string") return fail(v); (p.applies === "sub_limit" ? subs : lims).push(v); }
    const ded = value("deductible_value_id", "money"), co = value("co_insurance_value_id", "percent"), coCap = value("co_insurance_cap_value_id", "money");
    for (const x of [ded, co, coCap]) if (typeof x === "string") return fail(x);
    const bill = household("bill", "bill"); if (typeof bill === "string") return fail(bill);
    out = billReimbursement({ subjectId, who, benefit, terms, bill, subLimits: subs, limits: lims, deductible: ded as DocValue | null, coInsurance: co as DocValue | null, coInsuranceCap: coCap as DocValue | null, settled, whatIf });
  } else if (a.calculator === "lump_sum") {
    const sum = value("sum_insured_value_id", "money"); if (typeof sum === "string") return fail(sum); if (!sum) return fail("lump_sum needs sum_insured_value_id");
    const pct = value("percent_value_id", "percent"), cap = value("cap_value_id", "money");
    if (typeof pct === "string") return fail(pct); if (typeof cap === "string") return fail(cap);
    out = lumpSum({ subjectId, who, benefit, terms, sumInsured: sum, percent: pct, cap, condition: String(a.condition ?? benefit), whatIf, assumptionWords: typeof a.assumption_words === "string" ? a.assumption_words : null });
  } else return fail(`unknown calculator ${String(a.calculator)}`);
  if ("refused" in out) return fail(out.refused);
  calcOutcomes(ctx).set(out.calcId, { ...out, purpose } as CalcOutcome & { purpose: string });
  const missing = await missingInputs(ctx, out, a, doc.fileHash ?? null);
  return { ok: true, evidence: out.evidence, data: {
    calc_id: out.calcId, kind: out.kind, purpose, amount: out.amount, currency: out.currency,
    printed: out.printed.map((p) => ({ label: p.label, value: p.value, unit: p.unit, currency: p.currency, value_id: p.valueId ?? null })),
    requirements: out.requirements, conditions: out.conditions.map((c) => ({ id: c.id, kind: c.kind, status: c.status, text: c.text, ...(c.needs ? { needs: c.needs } : {}) })),
    steps: out.steps, unresolved_text: out.kind === "unresolved" || out.kind === "not_payable" ? out.unresolvedText : null, reason: out.reason ?? null, evidence_requirements: out.evidenceRequirements,
    missing,
  } };
}

/**
 * Integration (agent C's request 3): what the calculation still needs, as data the loop can act on. Each item names
 * the fact key its answer is recorded under (or the condition id to pass back in `settled`), who can answer it
 * ("household": ask them, one question at a time; "insurer": state it, never ask the household), why (the
 * calculator's own wording of the requirement) and the passages that make it matter (shown to the model as evidence
 * ids). Ordered as they should be asked. Empty when the calculation is resolved.
 */
export type MissingInput = { key: string; condition_id: string | null; ask: "household" | "insurer"; why: string; evidence: EvidenceRef[] };
async function missingInputs(ctx: ToolContext, out: CalcOutcome, a: Record<string, unknown>, documentHash: string | null): Promise<MissingInput[]> {
  if (out.kind !== "unresolved") return [];
  const pages = await pageMap(ctx.accountId, out.policyId);
  const refOf = (c: CalcOutcome["conditions"][number]): EvidenceRef[] => {
    if (!c.passage) return [];
    const same = out.evidence.find((e) => e.passage.text === c.passage!.text);
    if (same) return [same];
    const text = pages.get(c.passage.pageStart);
    const ev = text ? evidenceFor({ policyId: out.policyId, documentHash, page: c.passage.pageStart, pageText: text, passage: c.passage.text, subjectId: out.subjectId }) : null;
    return ev ? [ev] : [];
  };
  const items: MissingInput[] = [];
  const push = (m: MissingInput) => { if (!items.some((x) => x.key === m.key)) items.push(m); };
  const rate = out.evidence[0] ? [out.evidence[0]] : [];
  if (out.calculator === "hospital_cash") {
    const timing = out.conditions.filter((c) => c.kind === "day_count_rule" || c.kind === "minimum_stay").flatMap(refOf);
    const why = out.requirements.find((r) => /admission|discharge/i.test(r)) ?? "the admission and discharge dates and times the policy wording counts from";
    const at = (k: string) => { const h = a[k] as Record<string, unknown> | undefined; return h && typeof h.at === "string" ? h.at : null; };
    const hasTime = (v: string | null) => !!v && /T\d{2}:\d{2}/.test(v);
    const needTimes = out.requirements.some((r) => /times?\b/i.test(r) && /admission|discharge/i.test(r));
    if (out.requirements.some((r) => /admission|discharge/i.test(r))) {
      if (a.stay_ongoing !== true && (!at("admission") || (needTimes && !hasTime(at("admission"))))) push({ key: "admission_datetime", condition_id: null, ask: "household", why, evidence: [...rate, ...timing] });
      if (!at("discharge") || (needTimes && !hasTime(at("discharge")))) push({ key: "discharge_datetime", condition_id: null, ask: "household", why, evidence: [...rate, ...timing] });
    }
  }
  if (out.calculator === "bill_reimbursement" && !a.bill) push({ key: "bill_amount", condition_id: null, ask: "household", why: "the bill amount", evidence: rate });
  for (const c of out.conditions) {
    if (c.status !== "unresolved" || !c.needs) continue;
    if (c.kind === "minimum_stay") continue; // settled by the admission / discharge times above
    if (c.kind === "currency") { push({ key: "bill_amount", condition_id: c.id, ask: "household", why: c.needs, evidence: rate }); continue; }
    const insurer = c.kind === "day_count_rule" || c.kind === "deduction_order" || c.kind === "definition";
    push({ key: c.id, condition_id: c.id, ask: insurer ? "insurer" : "household", why: c.needs, evidence: refOf(c).length ? refOf(c) : rate });
  }
  return items;
}

/** A limit printed in a sentence, located verbatim on its stored page; its amount must be printed in the quote. */
async function passageFigure(ctx: ToolContext, policyId: string, subjectId: string, p: Record<string, unknown>): Promise<DocValue | string> {
  const pages = await pageMap(ctx.accountId, policyId);
  const page = Number(p.page), text = pages.get(page);
  if (!text) return `passage_limits: page ${page} is not a stored page of that document`;
  const doc = (await loadDocs(ctx.accountId, [policyId]))[0];
  const ev = evidenceFor({ policyId, documentHash: doc?.fileHash ?? null, page, pageText: text, passage: String(p.quote ?? ""), subjectId });
  if (!ev) return "passage_limits: the quote is not on that page";
  const amount = Number(p.amount), currency = String(p.currency ?? "").toUpperCase();
  const nums = (ev.passage.text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.some((n) => Math.abs(n - amount) < 1e-9)) return "passage_limits: the amount is not printed in the quote";
  return { operand: { kind: "table_value", benefit: String(p.label ?? "limit"), valueKind: "money", cents: Math.round(amount * 100), currency, evidence: ev } };
}

/** A printed "Maximum days ..." row of the same document for this person's column, when the table prints one that
 * names no other benefit (\"Maximum recuperation days\" is another benefit's cap). */
async function autoDayCap(ctx: ToolContext, policyId: string, subjectId: string, benefit: string): Promise<DocValue | null> {
  const pages = await pageMap(ctx.accountId, policyId);
  const own = new Set((benefit.toLowerCase().match(/[a-z]{3,}/g) ?? []));
  const neutral = new Set(["maximum", "max", "days", "day", "per", "admission", "number", "of", "payable", "confinement", "hospital", "stay", "hospitalisation", "hospitalization", "the"]);
  for (const text of pages.values()) for (const line of text.split("\n")) {
    const label = line.trim().split(/\t|\s{3,}/)[0] ?? "";
    if (!/^max(?:imum)?\b/i.test(label) || !/\bdays?\b/i.test(label)) continue;
    const extra = (label.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !neutral.has(w) && !own.has(w));
    if (extra.length) continue;
    const { selectTableValue } = await import("../tables");
    const r = await selectTableValue({ accountId: ctx.accountId, policyId, benefit: label, subject: { memberId: subjectId }, want: "count", asOf: ctx.asOf });
    if (r.status === "ok" && r.valueKind === "count") return { operand: { kind: "table_value", benefit: r.rowLabel || label, valueKind: "count", cents: null, ppm: null, count: r.value, currency: null, period: r.period, evidence: r.evidence } };
  }
  return null;
}

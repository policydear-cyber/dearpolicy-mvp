/**
 * Agent K: the `calculate` tool. The model picks the calculator that fits the benefit and passes value ids it read
 * with select_table_value (or a quoted printed passage), the household's own inputs (each with their verbatim words)
 * and the purpose; the server validates every input, reads the benefit's own conditions from the stored wording
 * (terms.ts) and runs the claim calculators (engine.ts). Registered beside the lib/rag2 tools (tools.ts imports
 * CALC_TOOLS); results are kept per tool context so the composer can bind a sentence to them (calcOutcomes).
 */
import type { JsonSchema, ToolContext, ToolDef, ToolResult } from "../tools";
import { evidenceFor, type EvidenceRef } from "../evidence";
import { loadMembers, pageMap, loadDocs, familyBase, policyFamily, resolveDocumentRef, type DocRow, type MemberRow } from "../store";
import { selectTableValue, type SelectedValue } from "../tables";
import { columnApplicability, columnFitProblem, personApplicability } from "@/lib/claims/person";
import type { TableValueOperand } from "../compute";
import { billReimbursement, hospitalCash, lumpSum, waitingNotReached, type CalcOutcome, type DocValue, type HouseholdInput, type Refusal } from "./engine";
import { isCalendarDate } from "@/lib/claims/day-count";
import { amendmentDayEdges, applyAmendmentDayEdges, readBenefitTerms } from "./terms";
import { benefitRowProblem, ownTables, percentTables, rowAt, rowNotes, tableConditions } from "./pct-rows";

const outcomes = new WeakMap<ToolContext, Map<string, CalcOutcome>>();
/** The calculations made in this tool context (calc id -> outcome). */
export function calcOutcomes(ctx: ToolContext): Map<string, CalcOutcome> {
  let m = outcomes.get(ctx); if (!m) { m = new Map(); outcomes.set(ctx, m); } return m;
}

const str = (d: string): JsonSchema => ({ type: "string", description: d });
const INPUT = (d: string, props: Record<string, JsonSchema>, required: string[]): JsonSchema => ({ type: "object", description: d, properties: { ...props, words: str("The household's own words this comes from, quoted verbatim."), assumed: { type: "boolean", description: "true only for a what-if the household asked about (purpose what_if)." } }, required: [...required, "words"], additionalProperties: false });
const AT = INPUT("A date-time the household gave: ISO 8601 with the hospital's UTC offset (e.g. 2026-10-05T14:30+08:00), or a date (YYYY-MM-DD) when only the date is known.", { at: str("ISO date-time with offset, or YYYY-MM-DD.") }, ["at"]);
const PASSAGE_FIGURE: JsonSchema = { type: "object", description: "A limit printed in a sentence (not a table): preferably the evidence_id of the retrieved passage that prints it (the server reads the exact line, page and figure); otherwise the page and the verbatim quote.", properties: { evidence_id: str("The evidence id (e1, e2, ...) of the retrieved passage printing this limit. Preferred: no quote or page needed."), page: { type: "integer", minimum: 1 }, quote: str("Verbatim from the page."), amount: { type: "number" }, currency: str("ISO code."), label: str("What the limit is (\"accidental medical expenses per fracture\")."), applies: { type: "string", enum: ["sub_limit", "limit"] } }, required: ["label", "applies"], additionalProperties: false };

export const CALCULATE_TOOL: ToolDef = {
  name: "calculate",
  description: "Work out a benefit for one household member from one document with DearPolicy's claim calculators. calculator: hospital_cash (a daily rate; the policy's own day-count rule, waiting days, minimum stay and day cap are read from the document -- pass admission/discharge as dates or date-times, NEVER a number of nights), bill_reimbursement (the household's bill against printed sub-limits / limits, deductible, co-insurance and co-insurance cap), lump_sum (sum insured x printed percentage [x a printed share for a stated case, via proportion], capped; only ever a conditional illustration -- for a what-if or a reported event; the sum insured must be the one printed for this document's product). purpose: question, what_if (only when the household asked 'what if'; inputs marked assumed), claim (the household is pursuing a claim for an event). Returns kind = indicative_estimate (every condition established), conditional_illustration (a what-if), unresolved (the printed figures to cite plus the specific missing information -- ask for it or state it; never estimate) or not_payable (with the wording's reason), with a calc_id to cite as result_id in final_answer.",
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
    sum_insured_value_id: str("lump_sum: the sum insured (value id), for a percentage OF THE SUM INSURED. A percentage of a fixed benefit limit or sub-limit printed in the wording (\"% of Simple Fracture benefit limit\") is worked out on that limit, read by the server."),
    base_value_id: str("lump_sum: another printed amount the percentage's wording names as its base (value id)."), percent_value_id: str("lump_sum: the printed percentage payable (value id)."), cap_value_id: str("lump_sum: a printed cap (value id)."),
    proportion: { type: "object", description: "lump_sum: a share of the printed percentage that the policy's wording pays in a stated case (e.g. \"For a simple (closed) fracture 50% of the percentage shown is payable\"): the page and the verbatim quote of the calculation's document that prints it, the share, and the case. The result is an illustration for that case only; state the case in the sentence.", properties: { evidence_id: str("The evidence id of the retrieved passage printing the share. Preferred: the server reads the exact sentence, page and percentage; no quote needed."), page: { type: "integer", minimum: 1 }, quote: str("Verbatim from the page; it must print the share."), percent: { type: "number", minimum: 0, maximum: 100 }, applies_when: str("The case the wording names, in its words (\"a simple (closed) fracture\").") }, required: ["applies_when"], additionalProperties: false },
    rate_passage: { type: "object", description: "hospital_cash: a daily (or per-period) rate printed in a sentence of the wording rather than a table (\"Accident Hospital Income: S$100 for each complete period of 24 hours ...\"): the page and verbatim quote printing it, the amount and currency. Use instead of rate_value_id; rate_evidence_id is preferred.", properties: { page: { type: "integer", minimum: 1 }, quote: str("Verbatim from the page; it must print the amount."), amount: { type: "number", minimum: 0 }, currency: str("ISO code.") }, required: ["page", "quote", "amount", "currency"], additionalProperties: false },
    rate_evidence_id: str("hospital_cash: the evidence id of the retrieved passage printing the daily rate in a sentence. Preferred over rate_passage: the server reads the exact line, page, amount and currency."),
    condition: str("lump_sum: the illness / disability / event the household asked about."),
    assumption_words: str("lump_sum: the household's own words for the what-if or the event they reported, quoted; the result is always a conditional illustration, stated with its condition (\"If ...\")."),
    settled: { type: "array", items: { type: "object", properties: { condition_id: str("A condition id from an earlier calculate result."), status: { type: "string", enum: ["established", "not_applicable"] }, words: str("The household's own words that settle it, quoted.") }, required: ["condition_id", "status", "words"], additionalProperties: false } },
  }, required: ["calculator", "purpose", "subject_id", "policy_id", "benefit"], additionalProperties: false },
  handler: async (ctx, a) => runCalculate(ctx, a),
};
export const CALC_TOOLS: ToolDef[] = [CALCULATE_TOOL];

const fail = (error: string, evidence: EvidenceRef[] = []): ToolResult => ({ ok: false, error, evidence });

export async function runCalculate(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  // V1.5 (pr50-live D: the first recorded call passed base_value_id "" and was refused as an unknown value id): an empty
  // id is an id not given, never a lookup.
  const a = Object.fromEntries(Object.entries(args).filter(([k, v]) => !(/_id$/.test(k) && k !== "subject_id" && k !== "policy_id" && typeof v === "string" && !v.trim())));
  const subjectId = String(a.subject_id), benefit = String(a.benefit).trim();
  const purpose = String(a.purpose) as "question" | "what_if" | "claim";
  const whatIf = purpose === "what_if";
  const member = (await loadMembers(ctx.accountId)).find((m) => m.id === subjectId);
  if (!member) return fail("subject_id is not an active member of this household");
  // V1: the document the calculation is made on is the POLICY's own document (its schedule), whichever of its readable
  // documents (schedule or endorsement), policy number or name the model passed; a value read from any document of the
  // same policy is that policy's value. Unreadable documents stay unreadable (loadDocs), other policies stay refused.
  const readable = await loadDocs(ctx.accountId);
  const ref = resolveDocumentRef(readable, String(a.policy_id ?? ""));
  if ("error" in ref) return fail(ref.error);
  const family = policyFamily(readable, ref.doc);
  const doc = familyBase(family, ref.doc);
  const policyId = doc.id;
  const familyIds = new Set(family.map((d) => d.id));
  const ofPolicy = (e: EvidenceRef) => familyIds.has(e.policyId) || (!!e.amends && familyIds.has(e.amends.policyId));
  const who = member.preferredName || member.displayName;
  const value = (key: string, want?: TableValueOperand["valueKind"]): DocValue | string | null => {
    const id = a[key]; if (id == null) return null;
    const v = ctx.values.get(String(id));
    if (!v) return `${key}: unknown value id ${String(id)} (values must come from select_table_value in this conversation${key === "percent_value_id" ? "; or leave percent_value_id out and name the table row in benefit -- the server reads the percentage printed for it" : ""})`;
    if (v.subjectId !== subjectId) return `${key}: ${String(id)} was read for another person`;
    if (!ofPolicy(v.operand.evidence)) return `${key}: ${String(id)} is from another policy than ${doc.productName ?? "the one calculated for"}`;
    if (want && v.operand.valueKind !== want) return `${key}: ${String(id)} is a printed ${v.operand.valueKind}, not a ${want}`;
    return { operand: v.operand, valueId: String(id) };
  };
  const values = (key: string): DocValue[] | string => { const out: DocValue[] = []; for (const id of (a[key] as string[]) ?? []) { const x = ctx.values.get(String(id)); if (!x) return `${key}: unknown value id ${id}`; if (x.subjectId !== subjectId || !ofPolicy(x.operand.evidence)) return `${key}: ${id} is for another person or policy`; out.push({ operand: x.operand, valueId: id }); } return out; };
  const household = (key: string, unit: "at" | "bill"): HouseholdInput | string | null => {
    const h = a[key] as Record<string, unknown> | undefined; if (!h) return null;
    const words = String(h.words ?? "").trim(); if (!words) return `${key}: the household's own words are required`;
    const assumed = h.assumed === true;
    // V1.1: a stay the household reported only as a length ("in hospital for 3 days last month") may be placed on
    // assumed dates too -- the result is then a conditional illustration that states it.
    if (assumed && !whatIf && !(unit === "at" && /\b\d{1,3}\s+(?:full\s+|whole\s+)?days?\b/i.test(words))) return `${key}: an assumed input is allowed only for purpose what_if, or for a stay the household gave only as a number of days`;
    if (unit === "at") return { value: String(h.at ?? ""), words, kind: assumed ? "assumption" : "household" };
    if (typeof h.amount !== "number" || !Number.isFinite(h.amount) || h.amount < 0) return `${key}: the amount is not a number`;
    return { value: h.amount, currency: typeof h.currency === "string" ? h.currency.toUpperCase() : null, words, kind: assumed ? "assumption" : "household" };
  };
  const settled = ((a.settled as { condition_id: string; status: "established" | "not_applicable"; words: string }[]) ?? []).map((s) => ({ id: s.condition_id, status: s.status, words: s.words }));
  const terms = await readBenefitTerms({ accountId: ctx.accountId, policyId, benefit, subjectId });
  if (!terms) return fail("that document is not one of this household's readable documents");

  let out: CalcOutcome | Refusal;
  // V1.3: a waiting period the reported stay cannot reach decides the hospital benefit before any rate is bound -- a
  // missing or unverifiable rate never hides that conclusion.
  const early = a.calculator === "hospital_cash" && a.stay_ongoing !== true ? (() => { const ad = household("admission", "at"), di = household("discharge", "at"); return typeof ad === "string" || typeof di === "string" ? null : waitingNotReached({ subjectId, who, benefit, terms, admission: ad, discharge: di }); })() : null;
  if (early) out = early;
  else if (a.calculator === "hospital_cash") {
    let given = value("rate_value_id", "money"); if (typeof given === "string") return fail(given);
    if (!given && a.rate_passage) { const rp = await passageFigure(ctx, policyId, subjectId, { ...(a.rate_passage as Record<string, unknown>), label: benefit, applies: "limit" }); if (typeof rp === "string") return fail(rp.replace(/^passage_limits/, "rate_passage")); given = rp; }
    if (!given) return fail("hospital_cash needs rate_value_id (read the daily rate with select_table_value first), or rate_passage for a rate printed in a sentence");
    let cap = value("day_cap_value_id", "count"); if (typeof cap === "string") return fail(cap);
    if (!cap) cap = await autoDayCap(ctx, policyId, subjectId, benefit);
    const adm = household("admission", "at"), dis = household("discharge", "at");
    if (typeof adm === "string") return fail(adm); if (typeof dis === "string") return fail(dis);
    // V1: the rate in force for the stay's dates (a schedule's rate, or an endorsement's revised rate from its effective
    // date), for this person -- not the one in force on the day of the conversation.
    const rate = await rateInForce(ctx, member, doc, given, ctx.values.get(String(a.rate_value_id))?.selected ?? null, adm, dis);
    if (typeof rate === "string") return fail(rate);
    const t2 = await readBenefitTerms({ accountId: ctx.accountId, policyId, benefit, subjectId, rowLabel: rate.operand.evidence.table?.rowLabel ?? null });
    const pu = a.prior_use as { periods?: number; amount?: number; currency?: string; words?: string } | undefined;
    if (pu && !String(pu.words ?? "").trim()) return fail("prior_use: the household's own words are required");
    const priorUse = pu ? { periods: typeof pu.periods === "number" ? pu.periods : null, amount: typeof pu.amount === "number" ? pu.amount : null, currency: typeof pu.currency === "string" ? pu.currency.toUpperCase() : null, words: String(pu.words) } : null;
    // Round 8e: an amendment document of this policy that restates the admission / discharge day exception supersedes
    // the schedule's only from its stated effective date (applyAmendmentDayEdges); otherwise the day is a conflict.
    let chosen = t2 ?? terms;
    const amendDocs = family.filter((d) => d.id !== policyId && /endorse|alteration|amendment/i.test(d.documentRole ?? ""));
    if (amendDocs.length) {
      const ae = await amendmentDayEdges({ accountId: ctx.accountId, amendments: amendDocs.map((d) => ({ id: d.id, effectiveDate: d.effectiveDate })), benefit, subjectId });
      const localDate = (h: HouseholdInput | null) => (h && typeof h.value === "string" && isCalendarDate(h.value.slice(0, 10)) ? h.value.slice(0, 10) : null);
      if (ae.length) chosen = { ...chosen, ...applyAmendmentDayEdges(chosen, ae, { admission: localDate(adm), discharge: localDate(dis) }) };
    }
    out = hospitalCash({ subjectId, who, benefit, terms: chosen, rate, dayCap: cap, admission: adm, discharge: dis, ongoing: a.stay_ongoing === true, settled, whatIf, priorUse });
  } else if (a.calculator === "bill_reimbursement") {
    const subs = values("sub_limit_value_ids"), lims = values("limit_value_ids"); if (typeof subs === "string") return fail(subs); if (typeof lims === "string") return fail(lims);
    for (const p of (a.passage_limits as Record<string, unknown>[]) ?? []) { const v = await passageFigure(ctx, policyId, subjectId, p); if (typeof v === "string") return fail(v); (p.applies === "sub_limit" ? subs : lims).push(v); }
    const ded = value("deductible_value_id", "money"), co = value("co_insurance_value_id", "percent"), coCap = value("co_insurance_cap_value_id", "money");
    for (const x of [ded, co, coCap]) if (typeof x === "string") return fail(x);
    const bill = household("bill", "bill"); if (typeof bill === "string") return fail(bill);
    out = billReimbursement({ subjectId, who, benefit, terms, bill, subLimits: subs, limits: lims, deductible: ded as DocValue | null, coInsurance: co as DocValue | null, coInsuranceCap: coCap as DocValue | null, settled, whatIf });
  } else if (a.calculator === "lump_sum") {
    let pct = value("percent_value_id", "percent"); const cap = value("cap_value_id", "money");
    let recoveredNote: string | null = null;
    // V1.5 (live verification: percent_value_id pointed at a printed amount, the call was refused and the turn ran out
    // of budget): the wrong value type is still never used as a percentage. The ONE bounded recovery is the percentage
    // this document prints for the benefit row named -- the same server read as leaving percent_value_id out. If there
    // is none, the refusal names the percentages already read for this person on this policy.
    if (typeof pct === "string" && /is a printed money, not a percent$/.test(pct)) {
      const wrong = ctx.values.get(String(a.percent_value_id));
      const read = await printedPercent(ctx, policyId, subjectId, benefit);
      if (read) { recoveredNote = `percent_value_id ${String(a.percent_value_id)} is a printed amount (${wrong?.operand.benefit ?? "an amount"}), not a percentage, so it was not used; the percentage printed for “${read.operand.benefit}” was read instead`; pct = read; }
      else {
        const pcts = [...ctx.values.entries()].filter(([, v]) => v.subjectId === subjectId && v.operand.valueKind === "percent" && ofPolicy(v.operand.evidence)).map(([id, v]) => `${id} (${v.operand.benefit}: ${(v.operand.ppm ?? 0) / 10_000}%)`);
        return fail(`${pct}. ${pcts.length ? `Percentages already read for this person on this policy: ${pcts.join("; ")}.` : "No percentage has been read for this person on this policy yet."} Pass one of those as percent_value_id, or leave percent_value_id out and name the table row (as printed) in benefit -- the server reads the percentage printed for it.`);
      }
    }
    if (typeof pct === "string") return fail(pct); if (typeof cap === "string") return fail(cap);
    // V1.2: no percentage passed -- the percentage this document prints for the benefit named, for this person, read
    // by the server with the select_table_value rules (one row, this person's column; anything ambiguous is not used).
    if (!pct) pct = await printedPercent(ctx, policyId, subjectId, benefit);
    // V1.3: a "share" quoted from a table row printed under a "% of ..." header is that row's percentage, not a share of
    // another percentage -- it is never applied twice.
    let shareIsPercent = false;
    if (a.proportion) {
      const v = await passagePercent(ctx, policyId, subjectId, a.proportion as Record<string, unknown>);
      // (A row wrapped over two lines -- its percentage on the line below its label -- is one row: pct-rows.ts.)
      // V1.5 (pr50-live D): or a row of a percentage table reconstructed on its stored page -- including a table extracted
      // as plain text with single spaces ("Jaw, Pelvis, Leg, Ankle or Knee 50%" under "Compensation (% of S$5,000)").
      const rowOnPage = async () => { if (typeof v === "string") return false; const ev = v.operand.evidence; const pg = (await pageMap(ctx.accountId, ev.policyId)).get(ev.passage.onPage) ?? ""; return !!rowAt(percentTables(pg), ev.passage.start); };
      const tableRow = typeof v !== "string" && (/\S(?:\t+| {3,})\d+(?:\.\d+)?\s*%\s*$/.test(v.operand.evidence.passage.text.trim().replace(/[ \t]*\n[ \t]*/g, "   ")) || await rowOnPage());
      if (typeof v !== "string" && tableRow && await percentBaseOf(ctx, v)) {
        if (pct && pct.operand.ppm !== v.operand.ppm) return fail("proportion: the quoted line is a row of the percentage table (a percentage of the benefit's base), not a share of another percentage -- pass that row as the percentage only");
        if (!pct) pct = v;
        shareIsPercent = true;
      }
    }
    if (!pct && typeof a.condition === "string" && a.condition.trim()) pct = await printedPercent(ctx, policyId, subjectId, a.condition);
    // V1.5: a percentage row printed in ANOTHER benefit's table on the same page (the Other Fracture table below the
    // Simple Fracture table) is never used for this benefit, whichever way it was selected.
    let rowNotesOf: { marker: string; text: string; evidence: EvidenceRef }[] = [];
    if (pct) {
      const ev = pct.operand.evidence, page = (await pageMap(ctx.accountId, ev.policyId)).get(ev.passage.onPage) ?? "";
      const tables = percentTables(page), at = rowAt(tables, ev.passage.start);
      if (at && at.table.name && !ownTables(tables, benefit).includes(at.table) && ownTables(tables, benefit).length < tables.length) return fail(`lump_sum: the percentage “${at.row.label}” is printed in the ${at.table.name} table, not in the table for ${benefit}`);
      // fx-live-1: the footnotes the page prints for THIS row (its marker is on the row; the page defines it under the table)
      // (PR #57 follow-up, QC Q1: and the conditions it prints under the table for the table's benefit, unmarked -- marker "")
      if (at) rowNotesOf = [...rowNotes(page, at.table, at.row), ...tableConditions(page, at.table)].flatMap((n) => { const nev = evidenceFor({ policyId: ev.policyId, documentHash: doc.fileHash ?? null, page: ev.passage.onPage, pageText: page, passage: page.slice(n.start, n.end), near: n.start, subjectId: null }); return nev ? [{ marker: n.marker, text: n.text, evidence: nev }] : []; });
    }
    // V1.3: what the percentage is OF is read from its own wording (the table header / the sentence above it), never
    // assumed to be the certificate's general sum insured. A fixed benefit limit or sub-limit is read from the same
    // document by the server; a sum insured passed for a percentage of a benefit limit is not used.
    const pctBase = pct ? await percentBaseOf(ctx, pct) : null;
    let sum: DocValue | null = null, baseNote: string | null = null;
    if (pctBase && (pctBase.kind === "benefit_limit" || pctBase.kind === "sublimit")) {
      const lim = await printedLimit(ctx, pct!.operand.evidence.policyId, pctBase.name, pctBase.kind);
      if (typeof lim === "string") return fail(`lump_sum: the percentage is of the ${pctBase.name} ${pctBase.kind === "sublimit" ? "sub-limit" : "benefit limit"} (“${pctBase.words}”), and ${lim}`);
      // The amount the table header names must be the limit the document prints.
      if (pctBase.printed && (lim.operand.currency !== pctBase.printed.currency || lim.operand.cents !== Math.round(pctBase.printed.value * 100))) return fail(`lump_sum: the table is a percentage of “${pctBase.words}”, but the ${pctBase.name} limit is printed as a different amount, so which applies is not established`);
      sum = lim;
      if (a.sum_insured_value_id != null || a.base_value_id != null) baseNote = `the percentage is of the ${lim.operand.benefit} printed in the wording (“${pctBase.words}”), so that amount is used -- not the sum insured or other amount passed`;
    } else if (pctBase?.kind === "referenced_amount" && pctBase.printed) {
      const ev = pct!.operand.evidence;
      const pages = await pageMap(ctx.accountId, ev.policyId);
      const line = (pages.get(ev.passage.onPage) ?? "").split(/\n/).find((l) => l.replace(/\s{2,}/g, " ").trim() === pctBase.words) ?? null;
      const hev = line ? evidenceFor({ policyId: ev.policyId, documentHash: doc.fileHash ?? null, page: ev.passage.onPage, pageText: pages.get(ev.passage.onPage)!, passage: line.trim(), subjectId: null }) : null;
      if (!hev) return fail(`lump_sum: the percentage is of “${pctBase.words}”, and that line could not be located on its page`);
      sum = { operand: { kind: "table_value", benefit: `amount the table is a percentage of (${pctBase.name})`, valueKind: "money", cents: Math.round(pctBase.printed.value * 100), ppm: null, count: null, currency: pctBase.printed.currency, period: null, evidence: hev } as TableValueOperand };
      if (a.sum_insured_value_id != null || a.base_value_id != null) baseNote = `the percentage is of the amount its table prints (“${pctBase.words}”), so that amount is used -- not the sum insured or other amount passed`;
    } else {
      const given = value(a.sum_insured_value_id != null ? "sum_insured_value_id" : "base_value_id", "money"); if (typeof given === "string") return fail(given);
      if (!given) return fail(pctBase?.kind === "referenced_amount" ? `lump_sum: the percentage is of “${pctBase.words}”: read that amount for this person (select_table_value) and pass it as sum_insured_value_id` : "lump_sum needs sum_insured_value_id");
      sum = given;
      // V1.2: a sum insured read from another document of the policy (a group certificate listing several products) must
      // be the one printed for THIS document's product -- the Group Term Life row is not the Group Personal Accident sum
      // insured. The product it is printed under must share a distinctive word with the calculation document's product.
      // (Actual-library findings: a generic booklet's title names no product; the server bound this row to the schedule by
      // the product section the schedule is printed in -- that binding, made by evaluate_benefit, is the product link.)
      const sumVid = String(a.sum_insured_value_id ?? a.base_value_id);
      const printedUnder = ctx.values.get(sumVid)?.selected?.benefit ?? null;
      const linkProblem = printedUnder && ctx.sectionBound?.get(sumVid) === printedUnder ? null : sumInsuredLink(sum, doc, printedUnder);
      if (linkProblem) return fail(linkProblem);
      // A fixed limit passed as the base of a percentage of the Sum Insured is refused.
      if (pctBase?.kind === "sum_insured" && /\blimit\b/i.test(sum.operand.benefit) && !/sum (?:insured|assured)/i.test(sum.operand.benefit)) return fail(`lump_sum: the percentage is of the Sum Insured (“${pctBase.words}”), not of ${sum.operand.benefit}`);
    }
    let share: DocValue | null = null;
    if (a.proportion && !shareIsPercent) { const v = await passagePercent(ctx, policyId, subjectId, a.proportion as Record<string, unknown>); if (typeof v === "string") return fail(v); share = v; }
    out = lumpSum({ subjectId, who, benefit, terms, sumInsured: sum, percent: pct, cap, notes: rowNotesOf, condition: String(a.condition ?? benefit), whatIf, assumptionWords: typeof a.assumption_words === "string" ? a.assumption_words : null, proportion: share, proportionWhen: share ? String((a.proportion as Record<string, unknown>).applies_when ?? "") : null,
      base: pctBase && pctBase.kind !== "sum_insured" && (pctBase.kind !== "referenced_amount" || pctBase.printed) ? { kind: pctBase.kind === "referenced_amount" ? "benefit_limit" : pctBase.kind, label: sum.operand.benefit } : { kind: "sum_insured", label: sum.operand.benefit } });
    if (!("refused" in out) && (baseNote || recoveredNote)) (out as CalcOutcome & { notes?: string[] }).notes = [baseNote, recoveredNote].filter((x): x is string => !!x);
  } else return fail(`unknown calculator ${String(a.calculator)}`);
  if ("refused" in out) return fail(out.refused);
  calcOutcomes(ctx).set(out.calcId, { ...out, purpose } as CalcOutcome & { purpose: string });
  const missing = await missingInputs(ctx, out, a, doc.fileHash ?? null);
  return { ok: true, evidence: out.evidence, data: {
    calc_id: out.calcId, kind: out.kind, purpose, amount: out.amount, currency: out.currency,
    printed: out.printed.map((p) => ({ label: p.label, value: p.value, unit: p.unit, currency: p.currency, value_id: p.valueId ?? null })),
    requirements: out.requirements, conditions: out.conditions.map((c) => ({ id: c.id, kind: c.kind, status: c.status, text: c.text, ...(c.needs ? { needs: c.needs } : {}) })),
    steps: out.steps, unresolved_text: out.kind === "unresolved" || out.kind === "not_payable" ? out.unresolvedText : null, reason: out.reason ?? null, suggested_evidence: out.evidenceRequirements.length ? { items: out.evidenceRequirements, note: "general suggestions to confirm with the insurer, not requirements printed in the policy" } : null,
    ...((out as CalcOutcome & { notes?: string[] }).notes?.length ? { notes: (out as CalcOutcome & { notes?: string[] }).notes } : {}),
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

/** A quote located verbatim on its stored page (whitespace is already tolerated). The only other difference allowed is
 * trailing sentence punctuation (a quote ending "." where the page continues with ";"): the quote without it must
 * still be found verbatim -- every word, figure, operator and qualifier as printed. Never a search for another line. */
export function locateQuote(args: Parameters<typeof evidenceFor>[0]): EvidenceRef | null {
  const ev = evidenceFor(args);
  if (ev) return ev;
  const trimmed = args.passage.replace(/[\s.;,:!?]+$/, "");
  return trimmed !== args.passage && trimmed.length >= 20 ? evidenceFor({ ...args, passage: trimmed }) : null;
}

const MONEY_IN = /(S\$|SGD|US\$|USD|RM|MYR|HK\$|HKD)\s?(\d[\d,]*(?:\.\d+)?)/g;
const CURRENCY_OF: Record<string, string> = { "S$": "SGD", SGD: "SGD", "US$": "USD", USD: "USD", RM: "MYR", MYR: "MYR", "HK$": "HKD", HKD: "HKD" };
const SELECT_NEUTRAL = new Set(["benefit", "benefits", "each", "every", "with", "from", "that", "this", "which", "shall", "will", "payable", "paid", "insured", "person", "policy", "under", "their", "fracture", "the", "and", "for"]);
const selectWords = (t: string) => [...new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !SELECT_NEUTRAL.has(w)))];
/** The lines / sentences of a retrieved passage, each verbatim. */
function unitsOf(text: string): string[] {
  return text.split(/\n+/).flatMap((l) => l.split(/(?<=;)\s+|(?<=\.)\s+(?=[A-Z(])/)).map((u) => u.trim()).filter((u) => u.length >= 8);
}
/**
 * V1.2: the figure a calculation needs, read from a passage the tools already retrieved (selected by its evidence id):
 * the ONE line / sentence of it that supports the operation -- for a rate or limit, the line naming the benefit's own
 * words and printing exactly one amount; for a proportion, the sentence naming the case and printing exactly one
 * percentage. The page, quote and figure come from the stored record, never from the model's transcription. No such
 * line, or more than one equally good: refused (never the first, never any line that merely prints the same figure).
 */
export function figureFromEvidence(e: EvidenceRef, op: { kind: "amount" | "percent"; words: string; percent?: number | null; amount?: number | null; also?: string | null }): { page: number; quote: string; amount?: number; currency?: string; percent?: number } | string {
  const first = figureFromWords(e, op);
  // V1.3: a proportion named only by its section ("a simple fracture", no row of which says it) is read from the ONE table row (cells, never a prose sentence) the calculation's
  // own condition names ("... of the leg (tibia) ..."): the single line printing one percentage with the most of those
  // words, strictly ahead of every other line. A tie or no such line: the first refusal stands.
  if (typeof first !== "string" || op.kind !== "percent" || !op.also?.trim() || !/no single line/.test(first)) return first;
  // Only when the case the proportion was given for names no row at all (a section name, not another row's case).
  const own = selectWords(op.words);
  if (unitsOf(e.passage.text).some((u) => /\d\s*%/.test(u) && own.some((w) => u.toLowerCase().includes(w)))) return first;
  const want = selectWords(`${op.words} ${op.also}`);
  const rows = unitsOf(e.passage.text).map((u) => ({ u, hits: want.filter((w) => u.toLowerCase().includes(w)).length, pcts: (u.match(/(\d+(?:\.\d+)?)\s*%/g) ?? []).map((m) => Number(m.replace(/[%\s]/g, ""))) }))
    .filter((x) => x.pcts.length === 1 && x.hits > 0 && /\S(?:\t+| {3,})\S/.test(x.u)).sort((a, b) => b.hits - a.hits);
  if (!rows.length || (rows[1] && rows[1].hits === rows[0].hits)) return first;
  const r = rows[0];
  if (op.percent != null && Math.abs(op.percent - r.pcts[0]) > 1e-9) return `that passage prints ${r.pcts[0]}%, not ${op.percent}%`;
  return { page: e.passage.onPage, quote: r.u, percent: r.pcts[0] };
}
function figureFromWords(e: EvidenceRef, op: { kind: "amount" | "percent"; words: string; percent?: number | null; amount?: number | null }): { page: number; quote: string; amount?: number; currency?: string; percent?: number } | string {
  const want = selectWords(op.words);
  if (!want.length) return `name the ${op.kind === "percent" ? "case" : "benefit"} the figure is for`;
  const scored = unitsOf(e.passage.text).map((u) => {
    const lw = u.toLowerCase();
    const hits = want.filter((w) => lw.includes(w)).length;
    const money = [...u.matchAll(MONEY_IN)];
    const pcts = (u.match(/(\d+(?:\.\d+)?)\s*%/g) ?? []).map((m) => Number(m.replace(/[%\s]/g, "")));
    return { u, hits, money, pcts };
  }).filter((x) => (op.kind === "amount" ? x.money.length === 1 : x.pcts.length === 1) && x.hits >= Math.ceil(want.length / 2));
  if (!scored.length) return `that passage has no single line that prints one ${op.kind === "percent" ? "percentage" : "amount"} for “${op.words}”`;
  const best = Math.max(...scored.map((x) => x.hits));
  const top = scored.filter((x) => x.hits === best);
  if (new Set(top.map((x) => x.u)).size > 1) return `that passage prints more than one ${op.kind === "percent" ? "percentage" : "amount"} for “${op.words}”, so which one applies is ambiguous`;
  const { u, money, pcts } = top[0];
  if (op.kind === "percent") {
    if (op.percent != null && Math.abs(op.percent - pcts[0]) > 1e-9) return `that passage prints ${pcts[0]}%, not ${op.percent}%`;
    return { page: e.passage.onPage, quote: u, percent: pcts[0] };
  }
  const amount = Number(money[0][2].replace(/,/g, "")), currency = CURRENCY_OF[money[0][1]] ?? null;
  if (!currency) return "that passage does not print the amount's currency";
  if (op.amount != null && Math.abs(op.amount - amount) > 1e-9) return `that passage prints ${money[0][0]}, not ${op.amount}`;
  return { page: e.passage.onPage, quote: u, amount, currency };
}

/** V1.3: what a printed percentage is OF, from its own wording: the table's column header or the nearest line above
 * the row that says "% of ..." / "percentage of ...". */
async function percentBaseOf(ctx: ToolContext, pct: DocValue): Promise<{ kind: "sum_insured" | "benefit_limit" | "sublimit" | "referenced_amount"; name: string; words: string; printed?: { value: number; currency: string } } | null> {
  const ev = pct.operand.evidence;
  const page = (await pageMap(ctx.accountId, ev.policyId)).get(ev.passage.onPage) ?? "";
  const header = ev.table?.columnHeader || ev.table?.columnLeaf || "";
  const above = page.slice(0, Math.max(0, ev.passage.start)).split(/\n/).reverse().slice(0, 15);
  const OF = /(?:%|per ?cent(?:age)?)\s+of\s+(?:the\s+)?([^.;\n]{3,80})/i;
  const line = [header, ...above].find((l) => OF.test(l)) ?? null;
  if (!line) return null;
  const of = OF.exec(line)![1].trim();
  const words = line.trim().replace(/\s{2,}/g, " ");
  if (/\bsum (?:insured|assured)\b/i.test(of)) return { kind: "sum_insured", name: "Sum Insured", words };
  // A percentage OF A PRINTED AMOUNT ("Compensation (% of S$5,000)"): the amount is that table's fixed base. When the page
  // names it ("Simple Fracture Benefit Limit: S$5,000") it is that limit, read and checked by the server as any other.
  const amt = /^(S\$|SGD|US\$|USD|RM|MYR|HK\$|HKD)\s?(\d[\d,]*(?:\.\d+)?)/.exec(of);
  if (amt) {
    const value = Number(amt[2].replace(/,/g, "")), currency = CURRENCY_OF[amt[1]];
    const named = page.split(/\n/).map((l) => /^\s*([A-Za-z][A-Za-z ()'’/-]{2,60}?)\s+(sub-?limit|benefit limit|limit)\s*:\s*(S\$|SGD|US\$|USD|RM|MYR|HK\$|HKD)\s?(\d[\d,]*(?:\.\d+)?)/i.exec(l))
      .filter((m): m is RegExpExecArray => !!m && CURRENCY_OF[m[3]] === currency && Number(m[4].replace(/,/g, "")) === value);
    if (named.length === 1) return { kind: /sub/i.test(named[0][2]) ? "sublimit" : "benefit_limit", name: named[0][1].trim(), words, printed: { value, currency } };
    return { kind: "referenced_amount", name: of.replace(/\)+$/, ""), words, printed: { value, currency } };
  }
  const lim = /^(.*?)\s*(sub-?limit|benefit limit|limit)\b/i.exec(of);
  if (lim) return { kind: /sub/i.test(lim[2]) ? "sublimit" : "benefit_limit", name: lim[1].replace(/^(?:the|this)\s+/i, "").trim() || "benefit", words };
  return { kind: "referenced_amount", name: of, words };
}
/** V1.3: the one amount the document prints as "<name> benefit limit" (or sub-limit): a sentence or line naming it with
 * exactly one money figure. None, or different amounts: why not. */
async function printedLimit(ctx: ToolContext, policyId: string, name: string, kind: "benefit_limit" | "sublimit"): Promise<DocValue | string> {
  const pages = await pageMap(ctx.accountId, policyId);
  const doc = (await loadDocs(ctx.accountId, [policyId]))[0];
  const want = (name.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !["the", "and", "for", "benefit", "limit"].includes(w));
  const LIMIT = kind === "sublimit" ? /\bsub-?limit\b/i : /\blimit\b/i;
  const found: { page: number; text: string; amount: number; currency: string }[] = [];
  for (const [page, text] of pages) for (const sentence of text.split(/(?<=\.)\s+|\n+/)) {
    if (!LIMIT.test(sentence) || !want.every((w) => sentence.toLowerCase().includes(w))) continue;
    const m = [...sentence.matchAll(MONEY_IN)];
    if (m.length !== 1) continue;
    const currency = CURRENCY_OF[m[0][1]]; if (!currency) continue;
    found.push({ page, text: sentence.trim(), amount: Number(m[0][2].replace(/,/g, "")), currency });
  }
  const amounts = [...new Set(found.map((f) => `${f.currency} ${f.amount}`))];
  if (!found.length) return `the document does not print an amount for it`;
  if (amounts.length > 1) return `the document prints different amounts for it (${found.map((f) => `“${f.text}” page ${f.page}`).join("; ")}), so which applies is not established`;
  const f = found[0];
  const ev = evidenceFor({ policyId, documentHash: doc?.fileHash ?? null, page: f.page, pageText: pages.get(f.page)!, passage: f.text, subjectId: null });
  if (!ev) return "its sentence could not be located on its page";
  const label = `${name} ${kind === "sublimit" ? "sub-limit" : "benefit limit"}`;
  return { operand: { kind: "table_value", benefit: label, valueKind: "money", cents: Math.round(f.amount * 100), ppm: null, count: null, currency: f.currency, period: null, evidence: ev } as TableValueOperand };
}

/** lump_sum without percent_value_id: the percentage printed for the benefit in this document, for this person. */
async function printedPercent(ctx: ToolContext, policyId: string, subjectId: string, benefit: string): Promise<DocValue | null> {
  const r = await selectTableValue({ accountId: ctx.accountId, policyId, benefit, subject: { memberId: subjectId }, want: "percent", asOf: ctx.asOf }).catch(() => null);
  if (!r || r.status !== "ok" || r.valueKind !== "percent") return null;
  // V1.5: on a page whose percentage tables are reconstructed (pct-rows.ts), the row read must be the one the benefit
  // name singles out in the benefit's own table -- never a row of an adjacent table, never the first of several.
  const page = (await pageMap(ctx.accountId, r.evidence.policyId)).get(r.evidence.passage.onPage) ?? "";
  if (benefitRowProblem(page, r.evidence.passage.start, benefit)) return null;
  const id = "v" + ++ctx.seq;
  const operand: TableValueOperand = { kind: "table_value", benefit: r.rowLabel || r.benefit, valueKind: "percent", cents: r.cents, ppm: r.ppm, count: null, currency: r.currency, period: r.period, evidence: r.evidence };
  ctx.values.set(id, { selected: r, subjectId, operand });
  return { operand, valueId: id };
}

/** A limit printed in a sentence, located verbatim on its stored page; its amount must be printed in the quote. */
async function passageFigure(ctx: ToolContext, policyId: string, subjectId: string, p: Record<string, unknown>): Promise<DocValue | string> {
  if (p.evidence_id != null) return "passage_limits: evidence_id is read by the conversation, not here";
  if (p.page == null || typeof p.quote !== "string") return "passage_limits: give the evidence_id of the retrieved passage (preferred), or its page and verbatim quote";
  const pages = await pageMap(ctx.accountId, policyId);
  const page = Number(p.page), text = pages.get(page);
  if (!text) return `passage_limits: page ${page} is not a stored page of that document`;
  const doc = (await loadDocs(ctx.accountId, [policyId]))[0];
  const ev = locateQuote({ policyId, documentHash: doc?.fileHash ?? null, page, pageText: text, passage: String(p.quote ?? ""), subjectId });
  if (!ev) return "passage_limits: the quote is not on that page";
  const amount = Number(p.amount), currency = String(p.currency ?? "").toUpperCase();
  const nums = (ev.passage.text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.some((n) => Math.abs(n - amount) < 1e-9)) return "passage_limits: the amount is not printed in the quote";
  return { operand: { kind: "table_value", benefit: String(p.label ?? "limit"), valueKind: "money", cents: Math.round(amount * 100), currency, evidence: ev } };
}

const GENERIC_PRODUCT_WORDS = new Set(["group", "plan", "policy", "policies", "scheme", "cover", "coverage", "insurance", "insured", "benefit", "benefits", "sum", "assured", "amount", "schedule", "certificate", "wording", "the", "and", "for", "with", "public", "service", "employee", "basic", "plus", "per"]);
const productWords = (t: string) => (t.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !GENERIC_PRODUCT_WORDS.has(w));
function sumInsuredLink(sum: DocValue, doc: DocRow, printedUnder: string | null): string | null {
  if (sum.operand.evidence.policyId === doc.id || !printedUnder) return null;
  const under = productWords(printedUnder);
  if (!under.length) return null;
  const own = new Set(productWords(`${doc.productName ?? ""} ${doc.policyType ?? ""}`));
  if (under.some((w) => own.has(w) || own.has(w.replace(/s$/, "")))) return null;
  return `sum_insured_value_id: that amount is printed under “${printedUnder}”, not under this document's product (${doc.productName ?? "the calculation's document"}): read the sum insured printed for this product (select_table_value with the product's name as the benefit)`;
}

/** V1.2: a share printed in a sentence of the calculation's document (lump_sum proportion): located verbatim on its
 * stored page, the percentage printed in the quote. */
async function passagePercent(ctx: ToolContext, policyId: string, subjectId: string, p: Record<string, unknown>): Promise<DocValue | string> {
  if (p.evidence_id != null) return "proportion: evidence_id is read by the conversation, not here";
  if (p.page == null || typeof p.quote !== "string") return "proportion: give the evidence_id of the retrieved passage (preferred), or its page and verbatim quote";
  const pages = await pageMap(ctx.accountId, policyId);
  const page = Number(p.page), text = pages.get(page);
  if (!text) return `proportion: page ${page} is not a stored page of that document`;
  const doc = (await loadDocs(ctx.accountId, [policyId]))[0];
  const ev = locateQuote({ policyId, documentHash: doc?.fileHash ?? null, page, pageText: text, passage: String(p.quote ?? ""), subjectId });
  if (!ev) return "proportion: the quote is not on that page";
  const pct = Number(p.percent);
  const printed = (ev.passage.text.match(/(\d+(?:\.\d+)?)\s*%/g) ?? []).map((m) => Number(m.replace(/[%\s]/g, "")));
  if (!printed.some((n) => Math.abs(n - pct) < 1e-9)) return "proportion: that percentage is not printed in the quote";
  const when = String(p.applies_when ?? "").trim();
  if (!when) return "proportion: applies_when (the case the wording names) is required";
  return { operand: { kind: "table_value", benefit: when, valueKind: "percent", cents: null, ppm: Math.round(pct * 10_000), count: null, currency: null, period: null, evidence: ev } as TableValueOperand };
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

/**
 * V1: the daily rate in force for the stay's dates, for this person. The value the model passed was selected as of the
 * conversation's date; the stay may be before an endorsement's effective date (or after it). The rate is read again
 * from the policy's own document as of the admission date and as of the discharge date: one value -> that value (from
 * the schedule or the endorsement in force); two values -> the stay spans the change, which is not split here. An
 * endorsement row printed for another class of person ("Category: Child (each)") does not change this person's rate.
 */
async function rateInForce(ctx: ToolContext, member: MemberRow, base: DocRow, given: DocValue, selected: SelectedValue | null, adm: HouseholdInput | null, dis: HouseholdInput | null): Promise<DocValue | string> {
  const day = (h: HouseholdInput | null) => (h && typeof h.value === "string" && /^\d{4}-\d{2}-\d{2}/.test(h.value) ? h.value.slice(0, 10) : null);
  const from = day(adm), to = day(dis) ?? from;
  if (!from || !selected) return given;
  const tier = selected.columnBasis.basis === "explicit_tier" ? selected.columnHeader : null;
  const person = personApplicability({ relationship: member.relationship, notes: member.notes, dateOfBirth: member.dateOfBirth }, { asOf: from });
  const excludes = (s: SelectedValue) => (!!s.amends || !!s.amendedFrom) && s.evidence.passage.text.split(/\t| {3,}/).map((c) => c.trim()).filter(Boolean)
    .some((c) => { const col = columnApplicability(c); return col.kind === "class" && !!columnFitProblem(col, person, { isOwner: null, header: c }); });
  const dayBefore = (iso: string) => new Date(Date.parse(iso + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
  const at = async (asOf: string): Promise<SelectedValue | string> => {
    let r = await selectTableValue({ accountId: ctx.accountId, policyId: base.id, benefit: selected.benefit, subject: { memberId: member.id, tier }, want: "amount", asOf });
    if (r.status === "ok" && excludes(r)) {
      const eff = r.amends?.effectiveDate ?? null;
      if (!eff) return `the amended ${selected.benefit} row is printed for another class of person, and its effective date is not stated`;
      r = await selectTableValue({ accountId: ctx.accountId, policyId: base.id, benefit: selected.benefit, subject: { memberId: member.id, tier }, want: "amount", asOf: dayBefore(eff) });
    }
    if (r.status !== "ok") return `the daily rate in force on ${asOf} could not be read: ${r.reason}`;
    if (r.valueKind !== "money" || r.cents == null) return `the daily rate in force on ${asOf} is not a printed amount`;
    return r;
  };
  const a = await at(from); if (typeof a === "string") return a;
  if (to && to !== from) {
    const b = await at(to); if (typeof b === "string") return b;
    if (b.cents !== a.cents || b.currency !== a.currency) {
      const eff = b.amends?.effectiveDate ?? a.amends?.endsOn ?? null;
      return `the daily rate changes during the stay (${a.currency} ${a.value} on ${from}, ${b.currency} ${b.value} on ${to}${eff ? `; the change takes effect on ${eff}` : ""}): the stay is not split across the change here -- state both printed rates and the effective date, and ask the insurer how the days are apportioned`;
    }
  }
  if (a.evidence.policyId === given.operand.evidence.policyId && a.cents === given.operand.cents && a.rowLabel === given.operand.benefit) return given;
  const valueId = "v" + ++ctx.seq;
  const operand: TableValueOperand = { kind: "table_value", benefit: a.rowLabel || a.benefit, valueKind: a.valueKind, cents: a.cents, ppm: a.ppm, count: null, currency: a.currency, period: a.period, evidence: a.evidence };
  ctx.values.set(valueId, { selected: a, subjectId: member.id, operand });
  return { operand, valueId };
}

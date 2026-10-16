/**
 * Reliable chat, contract B: the model SELECTS a benefit (a benefit_id from person_benefits) and passes only what the
 * household reported; the SERVER re-resolves the benefit for this household and person, picks the operands from the
 * document's own structure (a schedule row and the base its header names; a printed daily rate) and runs the existing
 * deterministic calculators (runCalculate -> engine.ts). The model never assembles money ids, percentage ids, quotes,
 * pages or percentage roles, and never supplies an output.
 *
 *   evaluate_benefit(benefit_id, reported facts)
 *     -> documented_terms | needs_facts | conditional_illustration (or indicative_estimate / not_payable / unresolved)
 *        | unresolved_evidence | unsupported_operation
 */
import { recordsFor, type ToolContext, type ToolResult } from "./tools";
import type { EvidenceRef } from "./evidence";
import type { TableValueOperand } from "./compute";
import type { SelectedValue } from "./tables";
import { selectedFromBenefit, type PersonBenefit } from "./benefits";
import { selectTableValue } from "./tables";
import { choosePercentRow } from "./calc/pct-rows";
import { caseFor, partLabel, rowConsistent } from "./calc/case-terms";
import { runCalculate } from "./calc/tool";
import { formatMoney, recordForModel, resolveBenefitRecords, type BenefitRecord, type ScheduleRow } from "./benefit-records";

const ok = (data: unknown, evidence: EvidenceRef[]): ToolResult => ({ ok: true, data, evidence });
const fail = (error: string, evidence: EvidenceRef[] = []): ToolResult => ({ ok: false, error, evidence });
const DAY_RATE = /\b(?:per|a|each)\s+(?:day|night|24\s*hours?)\b|\bdaily\b/i;

function issueValue(ctx: ToolContext, subjectId: string, selected: SelectedValue | Record<string, unknown>, operand: TableValueOperand): string {
  const id = "v" + ++ctx.seq;
  ctx.values.set(id, { selected: selected as SelectedValue, subjectId, operand });
  return id;
}
function percentOperand(row: ScheduleRow, subjectId: string): { operand: TableValueOperand; selected: Record<string, unknown> } {
  const evidence = { ...row.evidence, subjectId };
  const operand = { kind: "table_value", benefit: row.label, valueKind: "percent", cents: null, ppm: row.ppm, count: null, currency: null, period: null, evidence } as TableValueOperand;
  return { operand, selected: { status: "ok", benefit: row.label, rowLabel: row.label, valueKind: "percent", value: row.percent, ppm: row.ppm, cents: null, currency: null, unit: null, period: null, conditions: [], columnHeader: "", evidence, notes: [], related: [] } };
}
/** A person's own printed amount as a table value: the table reader's own selection (the same evidence contract
 * select_table_value issues), else the shared view's reconstructed row; issued once per turn. */
export async function personAmountValue(ctx: ToolContext, b: PersonBenefit, memberName: string, subjectId: string): Promise<string | null> {
  if (b.applicability !== "person_row" || b.printed.kind !== "money") return null;
  const key = `${b.policy.id}|${subjectId}|${b.benefit.label.toLowerCase()}`;
  const known = ctx.personRows?.get(key); if (known) return known;
  const r0 = await selectTableValue({ accountId: ctx.accountId, policyId: b.policy.id, benefit: b.benefit.label, subject: { memberId: subjectId }, want: "amount", asOf: ctx.asOf }).catch(() => null);
  const sel = r0?.status === "ok" && r0.valueKind === "money" && r0.cents === b.printed.cents && r0.currency === b.printed.currency ? r0 : selectedFromBenefit(b, memberName);
  if (!sel || sel.valueKind !== "money") return null;
  const id = issueValue(ctx, subjectId, sel, { kind: "table_value", benefit: sel.rowLabel || sel.benefit, valueKind: "money", cents: sel.cents, ppm: null, count: null, currency: sel.currency, period: sel.period, evidence: sel.evidence } as TableValueOperand);
  (ctx.personRows ??= new Map()).set(key, id);
  return id;
}
const caseOptions = (rows: ScheduleRow[]) => rows.map((r) => ({ option_id: r.id, case: r.label, percent: r.percent }));

export async function evaluateBenefit(ctx: ToolContext, a: Record<string, unknown>): Promise<ToolResult> {
  const subjectId = String(a.subject_id ?? ""), benefitId = String(a.benefit_id ?? "").trim();
  if (!subjectId || !benefitId) return fail("evaluate_benefit needs subject_id and benefit_id (a benefit_id from person_benefits for this person)");
  const records = await recordsFor(ctx, subjectId);
  const rec = records.find((r) => r.id === benefitId);
  if (!rec) {
    const alts = records.filter((r) => r.kind === "percentage_schedule" || r.applicability === "person_row").slice(0, 6).map((r) => `${r.id} (${r.benefit}${r.policy.product ? `, ${r.policy.product}` : ""})`);
    return fail(`benefit_id ${benefitId} is not one of this person's benefits in the household's current documents (benefit ids belong to one person; a removed or replaced document's ids no longer resolve).${alts.length ? ` This person's benefits include: ${alts.join("; ")}.` : ""} Call person_benefits for this person to see them all.`);
  }
  const purpose = ["what_if", "claim", "question"].includes(String(a.purpose)) ? String(a.purpose) : "what_if";
  const words = typeof a.assumption_words === "string" ? a.assumption_words : null;
  const summary = recordForModel(rec);

  if (rec.kind === "percentage_schedule" && rec.schedule) {
    const s = rec.schedule;
    // 1. the case: an option id, else the household's own words for it -- and either way, the case must be the one the
    //    household's recorded words name (a valid option id never overrides what they reported).
    let row: ScheduleRow | null = null;
    const optionId = typeof a.option_id === "string" ? a.option_id.trim() : "";
    if (optionId) { row = s.rows.find((r) => r.id === optionId) ?? null; if (!row) return fail(`option_id ${optionId} is not one of ${rec.benefit}'s listed cases; the cases are: ${s.rows.map((r) => `${r.id} = ${r.label} ${r.percent}%`).join("; ")}`); }
    const caseWords = typeof a.case === "string" ? a.case.trim() : "";
    const reported = ctx.reported?.get(subjectId) ?? [];
    const printed = s.rows.map((r) => `${r.label} ${r.percent}%`).join("; ");
    const pct_of = summary.schedule && (summary.schedule as { percentage_of: string }).percentage_of;
    const unlisted = (parts: string[]) => (ctx.unlisted ??= new Map()).set(`${subjectId}|${rec.id}`, parts.map(partLabel)) && ok({ status: "unlisted_case", benefit: rec.benefit, benefit_id: rec.id, named: parts.map(partLabel), listed_cases: printed, percentage_of: pct_of,
      note: `What the household reported (${parts.map(partLabel).join(", ")}) is not one of ${rec.benefit}'s listed cases in this document. Say that, with the cases it does list (a statement of kind benefit_terms citing benefit_id), and suggest asking the insurer whether anything else applies. Do not ask the household to choose one of these cases.` }, [rec.source.evidence]);
    const ambiguous = (cases: ScheduleRow[], parts: string[]) => ok({ status: "needs_facts", reason: "ambiguous", benefit: rec.benefit, benefit_id: rec.id, need: `${parts.map(partLabel).join(", ")} could be more than one listed case`,
      ask: `Which of these cases is it: ${cases.map((r) => r.label).join(" or ")}?`, options: caseOptions(cases), percentage_of: pct_of,
      note: "State the benefit's printed terms (kind benefit_terms), then ask which of THESE cases it is (one question, in plain words); do not choose one for them. Then call evaluate_benefit again with that option_id." }, [rec.source.evidence]);
    if (!row && caseWords) {
      const c = caseFor(s.rows, caseWords);
      if (c.kind === "row") row = s.rows.find((r) => r.id === c.row.id) ?? null;
      else if (c.kind === "ambiguous") return ambiguous(s.rows.filter((r) => c.rows.some((x) => x.id === r.id)), c.parts);
      else if (c.kind === "unlisted") return unlisted(c.parts);
      else {
        // no body part named: the printed labels' own words (schedules of other kinds -- "Loss of one eye")
        const choice = choosePercentRow([s.table], rec.benefit, caseWords);
        if ("row" in choice && !("unresolved" in choice)) row = s.rows.find((r) => r.evidence.passage.start === choice.row.start) ?? null;
        else if ("ambiguous" in choice) return ambiguous(choice.ambiguous.map((x) => s.rows.find((r) => r.evidence.passage.start === x.row.start)).filter((r): r is ScheduleRow => !!r), []);
      }
    }
    if (row && reported.length) {
      const consistent = rowConsistent(s.rows, row, reported);
      if (!consistent.ok) {
        const c = caseFor(s.rows, reported.join(" ; "));
        if (c.kind === "unlisted") return unlisted(c.parts);
        return ok({ status: "case_conflict", benefit: rec.benefit, benefit_id: rec.id, chosen: row.label, reported: consistent.parts.map(partLabel), matching_cases: c.kind === "row" ? [c.row.label] : c.kind === "ambiguous" ? c.rows.map((r) => r.label) : [],
          note: `“${row.label}” is not the case the household reported (${consistent.parts.map(partLabel).join(", ")}). Use the case their words name${c.kind === "row" ? ` (option ${c.row.id})` : ""}; never a different one.` }, [rec.source.evidence]);
      }
    }
    if (!row) return ok({ status: "needs_facts", reason: "missing", benefit: rec.benefit, benefit_id: rec.id, need: "which listed case applies", ask: `Which of ${rec.benefit}'s listed cases applies?`, options: caseOptions(s.rows),
      percentage_of: pct_of, conditions: rec.conditions, note: "The household has not said which case it is. State the benefit's printed terms first (kind benefit_terms), then ask which case applies." }, [rec.source.evidence]);
    // 2. the base, as the table's own header names it
    if (s.base.kind === "unresolved") return ok({ status: "unresolved_evidence", benefit: rec.benefit, benefit_id: rec.id, case: row.label, percent: row.percent, why: s.base.why,
      note: "Say the case's printed percentage and what it is a percentage of, and that the amount it is a percentage of could not be established -- never assume another amount." }, [row.evidence, rec.source.evidence]);
    // 3. the server's own operands into the existing calculator
    const pct = percentOperand(row, subjectId);
    const percentId = issueValue(ctx, subjectId, pct.selected, pct.operand);
    // the illustration's stated assumption: the household's own words for the event, else the case they identified
    const assumption = words?.trim() || caseWords || `the listed case “${row.label}” applies`;
    const args: Record<string, unknown> = { calculator: "lump_sum", purpose, subject_id: subjectId, policy_id: rec.policy.id, benefit: rec.benefit, condition: row.label, percent_value_id: percentId, assumption_words: assumption };
    if (s.base.kind === "sum_insured") {
      const vid = await personAmountValue(ctx, s.base.from, rec.memberName, subjectId);
      if (!vid) return ok({ status: "unresolved_evidence", benefit: rec.benefit, benefit_id: rec.id, why: `${rec.memberName}'s sum insured row could not be read as a printed amount` }, [rec.source.evidence]);
      if (s.base.section) (ctx.sectionBound ??= new Map()).set(vid, s.base.from.benefit.label);
      args.sum_insured_value_id = vid;
    }
    const res = await runCalculate(ctx, args);
    if (!res.ok) return ok({ status: "unresolved_evidence", benefit: rec.benefit, benefit_id: rec.id, case: row.label, why: res.error.replace(/\b(?:percent_value_id|sum_insured_value_id|base_value_id)\b:?\s*/g, "") }, res.evidence);
    const d = res.data as Record<string, unknown>;
    const kind = String(d.kind);
    return ok({ status: kind, result_id: d.calc_id, benefit: rec.benefit, benefit_id: rec.id, case: row.label, percent: row.percent,
      base: s.base.kind === "fixed_limit" || s.base.kind === "sum_insured" ? { label: s.base.label, amount: formatMoney(s.base.cents, s.base.currency) } : null,
      amount: d.amount != null && d.currency ? formatMoney(Math.round(Number(d.amount) * 100), String(d.currency)) : null,
      conditions: d.conditions, requirements: d.requirements, missing: d.missing, suggested_evidence: d.suggested_evidence,
      note: kind === "conditional_illustration" ? "State it with a statement of kind calculation citing result_id (the server writes the figures and their sources); it is an illustration, never a payment or decision." : undefined }, res.evidence);
  }

  // A printed daily rate with the stay the household reported: the existing hospital-cash calculator.
  if (rec.kind === "printed_amount" && rec.printed?.kind === "money" && DAY_RATE.test(`${rec.printed.unit ?? ""} ${rec.printed.period ?? ""} ${rec.source.evidence.passage.text}`)) {
    const adm = a.admission as Record<string, unknown> | undefined, dis = a.discharge as Record<string, unknown> | undefined;
    if (!adm || !dis) return ok({ status: "needs_facts", benefit: rec.benefit, benefit_id: rec.id, need: !adm && !dis ? "the admission and discharge dates and times" : !adm ? "the admission date and time" : "the discharge date and time", printed: summary.printed, conditions: rec.conditions,
      note: "State the printed rate and how it counts days first; ask only for what the household has not given." }, [rec.source.evidence]);
    const ev = rec.source.evidence;
    const line = ev.passage.text.split("\n").find((l) => l.includes((rec.printed as { amount: number }).amount.toLocaleString("en-SG")) || /\d/.test(l)) ?? ev.passage.text;
    const res = await runCalculate(ctx, { calculator: "hospital_cash", purpose, subject_id: subjectId, policy_id: rec.policy.id, benefit: rec.benefit, rate_passage: { page: ev.passage.onPage, quote: line.trim(), amount: rec.printed.amount, currency: rec.printed.currency }, admission: adm, discharge: dis, ...(a.stay_ongoing === true ? { stay_ongoing: true } : {}) });
    if (!res.ok) return ok({ status: "unresolved_evidence", benefit: rec.benefit, benefit_id: rec.id, why: res.error }, res.evidence);
    const d = res.data as Record<string, unknown>;
    return ok({ status: String(d.kind), result_id: d.calc_id, benefit: rec.benefit, benefit_id: rec.id, amount: d.amount != null && d.currency ? formatMoney(Math.round(Number(d.amount) * 100), String(d.currency)) : null,
      conditions: d.conditions, requirements: d.requirements, missing: d.missing, steps: d.steps, unresolved_text: d.unresolved_text }, res.evidence);
  }

  // Everything else: the documented terms, as printed (a dated amount is that date's amount, not current cover).
  const valueId = rec.personBenefit ? await personAmountValue(ctx, rec.personBenefit, rec.memberName, subjectId) : null;
  return ok({ status: rec.status === "resolved" ? "documented_terms" : "unresolved_evidence", ...summary, ...(valueId ? { value_id: valueId } : {}),
    note: rec.asOf ? `printed as of ${rec.asOf}: the document's amount on that date, not confirmation of cover on a later date` : undefined }, [rec.source.evidence]);
}

export type { BenefitRecord };

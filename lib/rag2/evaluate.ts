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
import { applicabilityOf } from "./applicability";

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
  const known = ctx.personRows?.get(key); if (known && ctx.values.has(known)) return known;
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
  // PR #54 follow-up (rc-live-5 BKL1: Other Fracture evaluated, and asked about, for a fracture the household called
  // closed): the benefit's OWN definition in its document, against what the household reported. An inconsistent benefit
  // is neither calculated nor clarified; one whose definition turns on something not yet reported gets one household
  // question for it. (A what-if is hypothetical: it is evaluated as asked.)
  const app = rec.definitions.length ? applicabilityOf(rec.benefit, rec.definitions, ctx.reportedFacts?.get(subjectId) ?? []) : null;
  const appEvidence = app && app.status !== "unconstrained" ? [app.definition.evidence, ...(app.via ? [app.via.evidence] : [])] : [];
  if (app?.status === "inconsistent" && purpose !== "what_if")
    return ok({ status: "not_applicable", benefit: rec.benefit, benefit_id: rec.id, definition: app.definition.text, ...(app.via ? { refers_to: app.via.text } : {}), reported: app.reported.words, why: app.why,
      note: `What the household reported is not what this document's definition of ${rec.benefit} describes. Do not calculate this benefit, state its terms or ask about its cases; at most say once that, by the document's own definition, it is for ${app.allowed.map((v) => app.attribute.said(v)).join(" or ")}. This is the wording's scope, not an insurer decision.` }, appEvidence);
  if (app?.status === "unresolved" && purpose !== "what_if")
    return ok({ status: "needs_facts", reason: "applicability", benefit: rec.benefit, benefit_id: rec.id, need: app.attribute.label, fact_key: app.attribute.factKey, ask: app.attribute.question(rec.memberName),
      options: app.attribute.values.map((v) => ({ option_id: `${app.attribute.id}:${v.id}`, case: v.label })), definition: app.definition.text, ...(app.via ? { refers_to: app.via.text } : {}), why: app.why,
      note: "Whether this benefit fits depends on a detail the household can tell you (its definition is cited). Ask that one question (ask_user with this result's requirement_id); do not calculate or choose for them." }, appEvidence);
  const applicability = app && app.status === "consistent" ? { status: "consistent", definition: app.definition.text, reported: app.reported.words, fact_keys: app.reported.keys } : undefined;

  if (rec.kind === "percentage_schedule" && rec.schedule) {
    const s = rec.schedule;
    // 1. the case: an option id, else the household's own words for it -- and either way, the case must be the one the
    //    household's recorded words name (a valid option id never overrides what they reported).
    let row: ScheduleRow | null = null;
    const optionId = typeof a.option_id === "string" ? a.option_id.trim() : "";
    if (optionId) { row = s.rows.find((r) => r.id === optionId) ?? null; if (!row) return fail(`option_id ${optionId} is not one of ${rec.benefit}'s listed cases; the cases are: ${s.rows.map((r) => `${r.id} = ${r.label} ${r.percent}%`).join("; ")}`); }
    const caseWords = typeof a.case === "string" ? a.case.trim() : "";
    // (structured-answers release, sa-live-2 SBp: a LATER report that names exactly one listed case settles the case; an EARLIER
    // report that left it open between several cases is history -- whatever fact key either was recorded under and whether or
    // not a question was pending. Reports that named one case, and everything else the household said, stay in play.)
    const heardAll = [...(ctx.reportedFacts?.get(subjectId) ?? [])];
    // PR #55 follow-up: it settles only an open report whose candidates INCLUDE that one case ("hip or tibia" is settled by
    // "the tibia"); a report of a different injury (a wrist) is a second event, and replaces nothing of the open one.
    const latestOne = heardAll.map((r) => ({ r, c: caseFor(s.rows, r.words) })).filter((x) => x.c.kind === "row").sort((x, y) => y.r.turn - x.r.turn)[0];
    // A CORRECTION replaces what it corrects whatever key the old report sits under (sa-live-4 SAr: the tibia had been recorded
    // under "injury" AND "fracture_site"; the correction replaced one and the other made every evaluation a case_conflict): when
    // the latest one-case report carries the household's correction cue, an earlier report of a DIFFERENT single case of this
    // benefit is history. Without the cue a different injury is a second event and replaces nothing.
    const history = latestOne && latestOne.c.kind === "row" ? heardAll.filter((r) => {
      if (r.turn >= latestOne.r.turn) return false;
      const c = caseFor(s.rows, r.words), id = (latestOne.c as { row: { id: string } }).row.id;
      return c.kind === "ambiguous" ? c.rows.some((x) => x.id === id) : c.kind === "row" && latestOne.r.cue && c.row.id !== id;
    }).map((r) => r.words) : [];
    const reported = (ctx.reported?.get(subjectId) ?? []).filter((w) => !history.some((h) => w.startsWith(h)));
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
      // Each report must fit the chosen case on its own: a joined reading would let a second injury ("also his wrist") make
      // an open "hip or tibia" report look compatible with the wrist row and silently drop it.
      const consistent = reported.map((w) => rowConsistent(s.rows, row!, [w])).find((x) => !x.ok) ?? rowConsistent(s.rows, row, reported);
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
    // (structured-answers release: the statement is written from the RESOLVED case, never from the household's raw words --
    // a correction, an earlier uncertain report or a multi-sentence message is not an assumption of the current result)
    // The record keeps the household's own words as PROVENANCE (what the save-time check finds quoted in their messages:
    // the event is theirs, not the server's), chosen from what they have CURRENTLY reported and that names this very
    // case -- never an earlier uncertain report, a correction notice or the model's paraphrase. The visible statement
    // never quotes them (renderCalculation): it says the resolved case.
    const rowId = row.id;
    const namesRow = (w: string) => { const c = caseFor(s.rows, w); return c.kind === "row" && c.row.id === rowId; };
    const heard = [...(ctx.reportedFacts?.get(subjectId) ?? [])].sort((a, b) => b.turn - a.turn);
    // (a sentence the household actually wrote first -- a recorded fact's words can carry the model's own normalised value)
    const current = heard.filter((r) => r.key === null).map((r) => r.words).find(namesRow) ?? heard.map((r) => r.words).find(namesRow)
      ?? [...reported].reverse().find(namesRow);
    const assumption = current?.trim() || (words && caseFor(s.rows, words).kind === "row" && (caseFor(s.rows, words) as { row: { id: string } }).row.id === rowId ? words.trim() : "") || `the listed case “${row.label}” applies`;
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
    return ok({ status: kind, result_id: d.calc_id, benefit: rec.benefit, benefit_id: rec.id, case: row.label, percent: row.percent, ...(applicability ? { applicability } : {}),
      base: s.base.kind === "fixed_limit" || s.base.kind === "sum_insured" ? { label: s.base.label, amount: formatMoney(s.base.cents, s.base.currency) } : null,
      amount: d.amount != null && d.currency ? formatMoney(Math.round(Number(d.amount) * 100), String(d.currency)) : null,
      conditions: d.conditions, requirements: d.requirements, missing: d.missing, suggested_evidence: d.suggested_evidence,
      ...(row.notes.length ? { row_footnotes: row.notes.map((n) => `${n.marker} ${n.text.replace(/\s+/g, " ")}`) } : {}),
      note: kind === "conditional_illustration" ? "State it with a statement of kind calculation citing result_id (the server writes the figures and their sources); it is an illustration, never a payment or decision." : undefined }, [...res.evidence, ...appEvidence]);
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

/** Claim estimates from the person's own benefit table (lib/benefit-table), for any household: the rows their documents
 * print for the event (a fracture of the reported body part, an ambulance trip, recuperation after a stay, a daily
 * hospital cash), worked out only with the figures, first paid day and most days those rows print. Nothing here names a
 * scheme, product, insurer or amount. Where a row cannot be worked out, the item says what the document prints and that
 * DearPolicy could not estimate it: it never fills a gap with a figure from code.
 *
 * Every amount still passes lib/claims/monetary-gate.ts: it must map to the person's verified cover, cite the page and
 * carry the currency the page prints. */
import type { PersonCover, TableRow } from "@/lib/benefit-table/assemble";
import { benefitName, rowDetail, shortFigure } from "@/lib/benefit-table/headline";
import { categoryOfBenefit } from "@/lib/coverage/table-figures";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import { formatMoney } from "@/lib/format/currency";
import { calculateHospitalCash } from "./calculators/hospital-cash";
import type { ClaimAssessmentItem, ClaimEvidence, ClaimFacts } from "./types";

/** The person's rows and covers from their benefit table; empty where the table is off. */
export type ClaimTable = { rows: TableRow[]; covers: PersonCover[] };
export const NO_TABLE: ClaimTable = { rows: [], covers: [] };

type Purpose = "fracture" | "ambulance" | "recuperation" | "hospital cash" | "death" | "critical illness" | "disability";
const TITLE: Record<Purpose, string> = { fracture: "Fracture benefit", ambulance: "Ambulance benefit", recuperation: "Recuperation benefit", "hospital cash": "Hospital cash",
  death: "Death benefit", "critical illness": "Critical illness benefit", disability: "Total and permanent disability benefit" };

const SIDE = new Set(["left", "right", "both", "the", "and", "of", "bone", "bones", "broken", "fracture", "fractured", "simple", "compound",
  "upper", "lower", "front", "back", "inner", "outer", "minor", "major", "hairline", "small", "partial", "complete", "my", "his", "her", "their"]);
/** The words of a reported body part that name it ("left wrist" -> wrist; "thigh bone" -> thigh). Every one must be in the
 * row's name: "upper arm" is never the "Upper jaw" row, and "neck of femur" never the "Neck (cervical vertebrae)" row
 * (Critic R225, TE P144-1). */
const partWords = (part: string) => part.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !SIDE.has(w)).map((w) => w.replace(/s$/, ""));

/** Which purpose a row serves for this event, or null. */
function purposeOf(row: TableRow, facts: ClaimFacts): Purpose | null {
  const name = `${row.benefit} ${row.section ?? ""}`;
  if (row.figure.kind === "projected" || row.pays === "not_covered") return null;
  if (facts.eventType === "accident" && facts.fractureBodyPart && /fractur/i.test(name)) {
    const words = partWords(facts.fractureBodyPart);
    if (words.length && words.every((w) => new RegExp(`\\b${w}s?\\b`, "i").test(row.benefit))) return "fracture";
  }
  if (facts.eventType === "accident" && facts.ambulanceUsed === true && /\bambulance\b/i.test(row.benefit)) return "ambulance";
  if (facts.eventType === "accident" && facts.hospitalised === true && /\b(?:recuperat|convalesc)/i.test(row.benefit)) return "recuperation";
  const inHospital = facts.eventType === "hospitalisation" || facts.hospitalised === true;
  if (inHospital && ["accident", "hospitalisation", "diagnosis"].includes(facts.eventType ?? "") && categoryOfBenefit(row.benefit) === "Hospital Cash") return "hospital cash";
  // Death from any cause: a life cover's death row. An accidental death row stays with the accident wording, which needs
  // the cause of death checked first (lib/claims/rules.ts).
  if (facts.eventType === "death" && categoryOfBenefit(row.benefit) === "Death") return "death";
  if (facts.eventType === "diagnosis" && ["Critical Illness", "Early Critical Illness"].includes(categoryOfBenefit(row.benefit) ?? "")) return "critical illness";
  if ((facts.eventType === "disability" || (facts.eventType === "accident" && facts.permanentImpairment === true)) && categoryOfBenefit(row.benefit) === "Total Permanent Disability") return "disability";
  return null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const currencyOf = (row: TableRow) => ("currency" in row.figure ? row.figure.currency : null) ?? null;
const printedText = (row: TableRow) => [shortFigure(row).text, rowDetail(row)].filter(Boolean).join(" · ");

/** The person's verified cover the row is paid under: on the row's own cover's document, the coverage with the row's
 * product or cover name, or the document's only coverage. Never another document's coverage with the same name, and never
 * another cover on a schedule of several (an accident cover's row is not paid by the life cover beside it; TE P144-4). */
function coverageFor(row: TableRow, table: ClaimTable, coverages: OwnedCoverage[]): OwnedCoverage | null {
  const cover = table.covers.find((c) => c.coverKey === row.coverKey);
  const doc = cover?.source.documentId;
  if (doc == null) return null;
  const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const named = (c: OwnedCoverage) => same(c.productName, row.product) || same(c.productName, row.cover);
  const onDoc = coverages.filter((c) => c.policyId === doc);
  return onDoc.find(named) ?? (onDoc.length === 1 ? onDoc[0] : null);
}

function itemFor(purpose: Purpose, rows: TableRow[], facts: ClaimFacts, table: ClaimTable, coverages: OwnedCoverage[]): ClaimAssessmentItem {
  const row = rows[0];
  const coverage = coverageFor(row, table, coverages);
  const ruleEvidence: ClaimEvidence = { chunkId: `page:${row.source.documentId}:${row.source.page}`, policyId: row.source.documentId,
    policyName: row.product, pageStart: row.source.page, pageEnd: row.source.page, evidenceLabel: benefitName(row.benefit) };
  const base = { id: `table-${slug(purpose)}-${slug(row.coverKey)}`, title: purpose === "fracture" ? benefitName(row.benefit) : TITLE[purpose],
    productName: row.product, coverLabel: row.cover, coverageId: coverage?.id, ruleEvidence,
    evidenceTerms: rows.map((r) => r.source.excerpt).filter(Boolean), conditions: [...new Set(rows.flatMap((r) => r.conditions))] };
  const where = `${row.source.document}, page ${row.source.page}`;
  const cannot = (why: string): ClaimAssessmentItem => ({ ...base, status: "potentially_applicable", amountText: null,
    reason: `${rows.length > 1 ? `Your documents print ${rows.length} figures for this: ${rows.map((r) => `${benefitName(r.benefit)}, ${printedText(r)}`).join("; ")}` : `${where} prints ${printedText(row)}`}. DearPolicy could not estimate your amount: ${why}`,
    conditions: [...base.conditions, "The insurer decides the amount from the policy's own conditions."] });

  if (!coverage) return cannot("this benefit is not matched to a cover confirmed for this person.");
  // Two rows with different figures (two plans, a table by severity): the person or the insurer must say which applies.
  const figures = new Set(rows.map((r) => printedText(r)));
  if (figures.size > 1) return cannot("more than one printed figure could apply.");
  const f = row.figure;
  const currency = currencyOf(row);

  if (purpose === "disability")
    return cannot("a medical assessment must first confirm the disability meets the policy's own definition of total and permanent disability.");
  if (purpose === "critical illness")
    return cannot("whether the diagnosis meets the policy's own definition, and any waiting or survival period the policy prints, must be checked against the medical report first.");
  if (purpose === "death") {
    const deathDate = facts.deathDate ?? facts.eventDate;
    if (deathDate && coverage.effectiveDate && Date.parse(deathDate) < Date.parse(coverage.effectiveDate))
      return { ...base, status: "not_applicable", amountText: null, reason: "The reported date of death is before this cover's effective date shown in the personal certificate." };
    if (facts.death !== true) return cannot("the death is not yet confirmed.");
  }
  if (purpose === "hospital cash") {
    if (f.kind !== "printed" || f.unit !== "per_day") return cannot("the page does not print a daily rate for it.");
    if (row.fromDay == null || row.maxDays == null) return cannot("the page's first paid day and most days were not both read, so the days it pays cannot be counted.");
    if (facts.hospitalNights == null) return cannot("the number of nights in hospital is still needed.");
    const calc = calculateHospitalCash({ dailyRate: f.amount, currency, hospitalStayOngoing: false, hospitalNights: facts.hospitalNights,
      offsetDays: Math.max(0, row.fromDay - 1), maximumDays: row.maxDays,
      ownership: { contractId: coverage.policyId, coverageId: coverage.id, label: row.product },
      ruleEvidence: { chunkId: ruleEvidence.chunkId, policyId: ruleEvidence.policyId, pageStart: row.source.page, pageEnd: row.source.page, label: row.benefit },
      ownershipEvidence: { chunkId: `coverage:${coverage.id}`, policyId: coverage.policyId, label: coverage.productName ?? undefined } });
    if (calc.status === "blocked") return cannot(calc.message);
    if (calc.status === "not_applicable") return { ...base, status: "not_applicable", amountText: null,
      reason: `${where} prints ${printedText(row)}. The reported ${facts.hospitalNights}-night stay does not reach day ${row.fromDay}, so it pays nothing for this stay.` };
    return { ...base, status: "likely_applicable", amountText: formatMoney(calc.potentialAmount, calc.currency), calculatedAmount: calc.potentialAmount,
      currency: calc.currency, calculationId: calc.calculationId,
      reason: `${where} prints ${printedText(row)}. ${calc.formula}.` };
  }
  // A fixed printed amount (a fracture row, a recuperation benefit) or one the table worked out from a printed base.
  if ((f.kind === "printed" && f.unit === "lump_sum") || f.kind === "worked_out") {
    if (!currency) return cannot("the page does not state the currency.");
    return { ...base, status: "potentially_applicable", amountText: formatMoney(f.amount, currency), calculatedAmount: f.amount, currency,
      reason: `${where} prints ${printedText(row)} for this.`,
      conditions: [...base.conditions, "The event must meet the policy's own definition for this benefit."] };
  }
  // "Up to" a limit (an ambulance bill) depends on the bill and the insurer's assessment.
  return cannot(f.kind === "printed" && f.unit === "up_to" ? "it repays the bill up to that limit, and the insurer decides the eligible amount." : "the page does not print a fixed amount for it.");
}

/** The items with the person's benefit-table items for the event added. A purpose an evidence-checked item already
 * assesses (a hospital cash from the wording's own rules, a critical-illness item, a death item with an outcome) is left
 * to it. A death item that only said the wording was missing is replaced by the table's item for the same cover. */
const DEATH_IDS = new Set(["gtl-death", "gpa-accidental-death", "travel-accidental-death"]);

export function withTableBenefits(facts: ClaimFacts, coverages: OwnedCoverage[], table: ClaimTable, existing: ClaimAssessmentItem[]): ClaimAssessmentItem[] {
  const groups = new Map<string, { purpose: Purpose; rows: TableRow[] }>();
  for (const row of table.rows) {
    const purpose = purposeOf(row, facts);
    if (!purpose) continue;
    const key = `${purpose}\u0000${row.coverKey}`;
    groups.set(key, { purpose, rows: [...(groups.get(key)?.rows ?? []), row] });
  }
  // An evidence-checked item for the same cover (or one not tied to a cover) already assesses the purpose. Any daily cash
  // from the wording's rules (hospital, ICU) counts for hospital cash, so a table row is never paid beside it (TE P144-3);
  // cover A's item never hides cover B's row (Critic R225).
  const covered = (p: Purpose, coverageId: string | undefined) => existing.some((i) => (i.coverageId == null || coverageId == null || i.coverageId === coverageId)
    && (p === "hospital cash" ? /\b(?:cash|allowance|income)\b/i.test(i.title) || /^med-.*cash/.test(i.id)
      : p === "critical illness" ? i.id.startsWith("ci-") : p === "disability" ? i.id === "tpd-lump-sum" : p === "death" ? false : new RegExp(p, "i").test(i.title)));
  let items = [...existing];
  for (const g of groups.values()) {
    const item = itemFor(g.purpose, g.rows, facts, table, coverages);
    if (covered(g.purpose, item.coverageId)) continue;
    if (g.purpose === "death") {
      // Every death item the rules make (a life cover's, an accident's, a trip's) for this cover: the table's is never a
      // second death payment (Critic R225).
      const deaths = items.filter((i) => DEATH_IDS.has(i.id));
      if (item.coverageId == null && deaths.length) continue;
      const same = deaths.filter((i) => i.coverageId === item.coverageId);
      // One not tied to a cover may be this cover's: it stands, and the table adds nothing beside an outcome.
      if ([...same, ...deaths.filter((i) => i.coverageId == null)].some((i) => i.status !== "needs_document")) continue;
      items = items.filter((i) => !same.includes(i));
    }
    items.push(item);
  }
  return items;
}

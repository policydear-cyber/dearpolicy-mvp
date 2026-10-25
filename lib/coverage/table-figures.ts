/** Which of a person's benefit-table rows (lib/benefit-table) answer one Home tile or Coverage page category, and the
 * figure to show for it. Pure, and for any household: it reads only the benefit names and figures the person's own
 * documents print, never a scheme, product or insurer named in code. A category no row names stays as before. */
import { rowDetail, shortFigure, type SummaryRow } from "@/lib/benefit-table/headline";

/** Benefit names, as policies in any market print them, for each category. Early critical illness is tested before
 * critical illness, and accidental death counts as personal accident, not death. */
const NAMES: [string, RegExp][] = [
  ["Early Critical Illness", /\b(?:early|intermediate)[\s-]+(?:stage\s+)?(?:critical\s+illness|ci|dread\s+disease)\b/i],
  ["Critical Illness", /\b(?:critical\s+illness|dread\s+disease)\b/i],
  ["Total Permanent Disability", /\btpd\b|\btotal\s+(?:and|&)\s+permanent\s+disab|\bpermanent\s+total\s+disab/i],
  ["Personal Accident", /\baccidental\s+death\b|\bpersonal\s+accident\b/i],
  ["Death", /\bdeath\b/i],
  ["Hospital Cash", /\b(?:hospital(?:isation)?|daily)\s+(?:cash|income|allowance)\b/i],
  ["Disability Income", /\bdisability\s+income\b|\bincome\s+(?:protection|replacement)\b/i],
  ["Outpatient", /\bout-?\s?patient\b/i],
  ["Hospitalisation", /\bward\b|\broom\s+(?:and|&)\s+board\b|\bin-?\s?patient\b|\bhospital\s+(?:charges|expenses|stay)\b/i],
];

/** The one category a benefit name belongs to, or null. A name matching several takes the first in NAMES. */
export function categoryOfBenefit(benefit: string): string | null {
  return NAMES.find(([, re]) => re.test(benefit))?.[0] ?? null;
}

/** The person's rows for the category: rows that pay something the person holds, never a projection or a row the
 * document marks not covered. */
export function categoryRows<T extends SummaryRow>(category: string, rows: T[]): T[] {
  return rows.filter((r) => r.figure.kind !== "projected" && r.pays !== "not_covered" && categoryOfBenefit(r.benefit) === category);
}

/** The text for a tile: the row's short figure and its days and conditions ("MYR 80 a day · from day 4 · up to 60
 * days"). Null when the rows print different figures (two plans, or a table by age): the tile then says Covered, and the
 * Coverage page lists each row with its own figure. */
export function tableDisplay(rows: SummaryRow[]): string | null {
  const texts = new Set(rows.map((r) => {
    const s = shortFigure(r);
    if (r.figure.kind === "none" && r.pays !== "as_charged") return null;
    return [s.text, rowDetail(r)].filter(Boolean).join(" · ");
  }));
  if (texts.size !== 1) return null;
  return [...texts][0];
}

const GENERIC = new Set(["insurance", "plan", "policy", "cover", "coverage", "scheme", "benefit", "benefits", "the", "of", "and"]);
function productWords(name: string | null | undefined): string[] {
  const v = (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\bgtl\b/g, "group term life").replace(/\bgpa\b/g, "group personal accident").replace(/\bghs\b/g, "group hospital surgical");
  return v.split(" ").filter((w) => w && !GENERIC.has(w));
}

/** Whether a reference wording (a scheme's policy wording, a product summary) describes a product the person owns. The
 * owner's own product name, group number and insurer must agree with the wording's, where both print them; with
 * neither a product name nor a group number on both sides, nothing matches, so a wording never adds cover on its own. */
export function wordingDescribes(owned: { productName: string | null; groupPolicyNumber: string | null; insurer: string | null },
  wording: { productName: string | null; groupPolicyNumber: string | null; insurer: string | null }): boolean {
  const norm = (s: string | null) => (s ?? "").replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  if (owned.insurer && wording.insurer && owned.insurer.trim().toLowerCase() !== wording.insurer.trim().toLowerCase()) return false;
  const bothGroup = Boolean(norm(owned.groupPolicyNumber) && norm(wording.groupPolicyNumber));
  if (bothGroup && norm(owned.groupPolicyNumber) !== norm(wording.groupPolicyNumber)) return false;
  const a = productWords(owned.productName), b = productWords(wording.productName);
  // Word for word, apart from words like "plan" and "insurance": "Critical Care" and "Critical Care Plus" are two products.
  if (a.length && b.length) return a.join(" ") === b.join(" ");
  return bothGroup;
}

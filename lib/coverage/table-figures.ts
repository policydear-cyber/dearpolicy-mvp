/** Which of a person's benefit-table rows (lib/benefit-table) answer one Home tile or Coverage page category, and the
 * figure to show for it. Pure, and for any household: it reads only the benefit names and figures the person's own
 * documents print, never a scheme, product or insurer named in code. A category no row names stays as before. */
import { rowDetail, shortFigure, type SummaryRow } from "@/lib/benefit-table/headline";
import { canonicalInsurer } from "@/lib/policies/insurer-name";

/** Benefit names, as policies in any market print them, for each category. Early critical illness is tested before
 * critical illness. A death or disability benefit paid only on an accident ("Accidental Death", "Death due to
 * Accident", "TPD by accident") is personal accident cover, never the Death or TPD tile: a death from illness is not
 * paid by it (Critic R225, TE P142-1). */
const NAMES: [string, RegExp][] = [
  ["Early Critical Illness", /\b(?:early|intermediate)[\s-]+(?:stage\s+)?(?:critical\s+illness|ci|dread\s+disease)\b/i],
  ["Critical Illness", /\b(?:critical\s+illness|dread\s+disease)\b/i],
  ["Personal Accident", /\b(?:accident(?:al(?:ly)?|s)?|injur(?:y|ies|ed))\b[^\n]*\b(?:death|died|dies|disab\w*|tpd|dismember\w*)\b|\b(?:death|disab\w*|tpd|dismember\w*)\b[^\n]*\b(?:accident(?:al(?:ly)?|s)?|injur(?:y|ies|ed))\b|\bpersonal\s+accident\b/i],
  ["Total Permanent Disability", /\btpd\b|\btotal\s+(?:and|&)\s+permanent\s+disab|\bpermanent\s+total\s+disab/i],
  ["Death", /\bdeath\b/i],
  ["Hospital Cash", /\b(?:hospital(?:isation)?|daily)\s+(?:cash|income|allowance)\b/i],
  ["Disability Income", /\bdisability\s+income\b|\bincome\s+(?:protection|replacement)\b/i],
  ["Outpatient", /\bout-?\s?patient\b/i],
  ["Hospitalisation", /\bward\b|\broom\s+(?:and|&)\s+board\b|\bin-?\s?patient\b|\bhospital\s+(?:charges|expenses|stay)\b/i],
];

const ACC = String.raw`(?:accident\w*|injur(?:y|ies|ed))`;
const ILL = String.raw`(?:illness(?:es)?|sickness(?:es)?|diseases?)`;
const ACCIDENT_ONLY = new RegExp(String.raw`\b(?:unless|only|solely|exclusively)\b[^\n]*\b${ACC}|\b${ACC}[^\n]*\b(?:only|solely|exclusively)\b|\bnot\s+(?:\w+\s+){1,2}except\s+(?:for\s+|by\s+)?(?:an?\s+)?${ACC}`, "i");
const ILLNESS_ONLY = new RegExp(String.raw`\b(?:other\s+than|except(?:\s+for)?|excluding)\s+(?:by\s+|for\s+|through\s+)?(?:an?\s+)?${ACC}`, "i");
const ANY_CAUSE = new RegExp(String.raw`\b(?:any|all)\s+causes?\b|\b${ILL}\s*(?:or|and|/|&)\s*(?:an?\s+)?${ACC}|\b${ACC}\s*(?:or|and|/|&)\s*(?:an?\s+)?${ILL}`, "i");
const PLAIN_DEATH = /^\s*death(?:\s+benefit)?\b/i;
const UPLIFT_FOR_ACCIDENT = new RegExp(String.raw`\b(?:doubl\w*|twice|uplift\w*)\s+(?:for|on|if|upon|in\s+case\s+of)\s+(?:an?\s+)?accident\w*\s+death\b`, "i");
const INCLUDING_ACCIDENT = new RegExp(String.raw`\bincluding\s+(?:death\s+)?(?:due\s+to\s+|from\s+|by\s+|caused\s+by\s+)?(?:an?\s+)?${ACC}`, "i");

/** What a death or disability name with an accident or injury word pays for. The default is accident only: any cause needs
 * a phrase that says so ("any cause", "illness or accident", a plain death benefit "doubled for accidental death" or
 * "including death due to injury"), and "other than accident" pays illness only. A name the rules cannot place stays
 * accident only, so it never pays a death from illness (TE P144-6, round 3: an allow-list, not a list of exclusions). */
function causeOf(benefit: string): "accident" | "any" | "illness" {
  if (/\bpersonal\s+accident\b/i.test(benefit) || ACCIDENT_ONLY.test(benefit)) return "accident";
  if (ILLNESS_ONLY.test(benefit)) return "illness";
  if (ANY_CAUSE.test(benefit)) return "any";
  if (PLAIN_DEATH.test(benefit) && (UPLIFT_FOR_ACCIDENT.test(benefit) || INCLUDING_ACCIDENT.test(benefit))) return "any";
  return "accident";
}

/** The one category a benefit name belongs to, or null. A name matching several takes the first in NAMES. */
export function categoryOfBenefit(benefit: string): string | null {
  return NAMES.find(([name, re]) => re.test(benefit) && !(name === "Personal Accident" && causeOf(benefit) !== "accident"))?.[0] ?? null;
}

/** A premium the person pays, never a benefit (chat.ts's PREMIUM_ROW). */
const PREMIUM = /^(?!.*\b(?:waiv|return|refund)\w*).*\bpremiums?\b/i;
/** The person's rows for the category: rows that pay something the person holds, never a projection, a fund or
 * surrender value ("Death benefit fund value"), a premium, or a row the document marks not covered (Critic R225). */
export function categoryRows<T extends SummaryRow>(category: string, rows: T[]): T[] {
  return rows.filter((r) => r.figure.kind !== "projected" && r.figure.kind !== "value" && r.pays !== "value" && r.pays !== "not_covered"
    && !PREMIUM.test(r.benefit) && categoryOfBenefit(r.benefit) === category);
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
  const a1 = canonicalInsurer(owned.insurer), b1 = canonicalInsurer(wording.insurer);
  if (a1 && b1 && a1 !== b1) return false;
  const bothGroup = Boolean(norm(owned.groupPolicyNumber) && norm(wording.groupPolicyNumber));
  if (bothGroup && norm(owned.groupPolicyNumber) !== norm(wording.groupPolicyNumber)) return false;
  const a = productWords(owned.productName), b = productWords(wording.productName);
  // Word for word, apart from words like "plan" and "insurance": "Critical Care" and "Critical Care Plus" are two products.
  if (a.length && b.length) return a.join(" ") === b.join(" ");
  return bothGroup;
}

/**
 * Benefit applicability (dj-live-2): whether a benefit applies to the FACTS the household reported, as an explicit result
 * that every output path reads (model statements, server completion, certificate summaries, repair and budget fallbacks).
 *
 *   supported            the benefit's own wording is satisfied by -- or sets no condition on -- the reported facts
 *   not_applicable       the benefit's own printed wording excludes the reported facts (e.g. "if an Insured Person dies as a
 *                        result of an Accident" against a death the household reported as an illness)
 *   unresolved           the wording turns on a fact that has not been reported (or is reported both ways)
 *
 * The result carries its source (the wording it rests on) and the reported facts it depends on, so a correction of a
 * reported fact re-decides it. It is NEVER inferred from a product name alone: a benefit is accident-only when its own
 * conditions say so, when its own name is an accident benefit, or when the same benefit (same label) is printed with that
 * condition in another document of the household's scheme -- and a benefit whose wording does not say is left as it is.
 */

export type ApplicabilityStatus = "supported" | "not_applicable" | "unresolved";
export type ApplicabilitySource = {
  /** where the decision comes from */
  kind: "own_conditions" | "benefit_name" | "product_wording" | "product_heading_only" | "same_benefit_in_scheme_document" | "no_condition_printed";
  /** the printed wording (or the benefit's name) it rests on */
  wording: string | null;
};
export type BenefitApplicability = {
  status: ApplicabilityStatus;
  source: ApplicabilitySource;
  /** the reported facts the decision depends on (attribute keys) */
  dependsOn: string[];
  /** what the household reported (their words) when the decision used a report */
  reported: string | null;
  /** true when no output may present this benefit's amount as potentially payable for the reported event */
  withhold: boolean;
  /** one sentence for traces: why */
  reason: string;
  /** the printed condition kind that decided it */
  condition: "accident" | "natural_catastrophe" | null;
};

export const ACCIDENT_COND = /\b(?:as a result of|resulting from|results? from|due to|caused by|arising (?:out of|from)|following|by reason of|through)\b[^.;]{0,60}\baccident|\baccident(?:al)?\s+(?:death|injury|bodily injury)\b|\bdies? (?:in|from|by) an? accident/i;
export const NATURAL_CAT = /\bnatural (?:catastrophe|disaster)s?\b/i;
export const coreLabel = (t: string) => t.toLowerCase().replace(/\(.*?\)/g, " ").replace(/\*/g, " ").replace(/\s+benefit\b/g, " ").replace(/^[a-z]\.\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

type RecLike = { benefit: string; policy: { product: string | null }; conditions: string[]; status?: string; applicability?: string };

/** The printed accident condition of this benefit and where it comes from: its own conditions, its name ("Accidental
 * Death", "Personal Accident"), or the same benefit (same name) printed with the condition in another document. */
export function accidentCondition(r: RecLike, all: (RecLike | { benefit: string; conditions: string[] })[] = []): { wording: string; kind: ApplicabilitySource["kind"] } | null {
  const c = r.conditions.find((x) => ACCIDENT_COND.test(x));
  if (c) return { wording: c, kind: "own_conditions" };
  if (/\baccident/i.test(r.benefit) || /\baccident/i.test(r.policy.product ?? "")) {
    // A BENEFIT named for an accident ("Accidental Death") says so in its own name. A person's amount printed under a PRODUCT
    // heading ("GROUP PERSONAL ACCIDENT", a certificate row) has no wording of its own: it counts as accident-only only where the
    // wording of that product's own documents (a benefit summary of the same product) prints an accident condition -- else the
    // name alone is not enough and the result is left unresolved.
    if (r.applicability !== "person_row") return { wording: `${r.benefit} is an accident benefit`, kind: "benefit_name" };
    const prod = coreLabel(r.benefit);
    const w = all.find((o) => o !== r && o.conditions.some((x) => ACCIDENT_COND.test(x)) && prod.length >= 8 && coreLabel((o as RecLike).policy?.product ?? "").includes(prod));
    return w ? { wording: w.conditions.find((x) => ACCIDENT_COND.test(x))!, kind: "product_wording" } : { wording: `${r.benefit} is a product heading; its documents print no cause condition for this amount`, kind: "product_heading_only" };
  }
  // (the same benefit printed with the condition in another document -- a person's amount row ("Group Term Life") and the wording
  // that defines it ("Group Term Life: Death or Terminal Illness") are the same benefit)
  const mine = coreLabel(r.benefit);
  const sib = all.find((o) => o !== r && o.conditions.some((x) => ACCIDENT_COND.test(x)) && (coreLabel(o.benefit) === mine || (r.applicability === "person_row" && mine.length >= 8 && (coreLabel(o.benefit) + " ").startsWith(mine + " "))));
  return sib ? { wording: sib.conditions.find((x) => ACCIDENT_COND.test(x))!, kind: "same_benefit_in_scheme_document" } : null;
}

/**
 * The applicability of one DEATH benefit to the reported cause of death.
 * `cause`: what the household reported (accident / illness) or "unknown". `deathBenefit`: the caller's decision that this
 * benefit is a death benefit (the benefit's own families); a benefit that is not one is outside this question (supported).
 */
export function causeApplicability(r: RecLike, all: RecLike[], f: { cause: "accident" | "illness" | "unknown"; words: string | null; deathBenefit: boolean }): BenefitApplicability {
  const supported = (reason: string, kind: ApplicabilitySource["kind"] = "no_condition_printed", wording: string | null = null): BenefitApplicability => ({ status: "supported", source: { kind, wording }, dependsOn: [], reported: f.words, reason, condition: null, withhold: false });
  if (r.status === "unsupported" || !f.deathBenefit) return supported("not a death benefit, or not read");
  const acc = accidentCondition(r, all);
  const nat = NATURAL_CAT.test(r.benefit) ? r.benefit : null;
  const condition: BenefitApplicability["condition"] = acc ? "accident" : nat ? "natural_catastrophe" : null;
  if (!condition) return supported("the benefit's own wording sets no cause condition");
  const source: ApplicabilitySource = acc ? { kind: acc.kind, wording: acc.wording } : { kind: "benefit_name", wording: nat };
  const base = { source, dependsOn: ["how_it_happened"], reported: f.words, condition };
  // (a certificate amount under a product heading whose documents print no cause condition: not decided by the name alone --
  // left unresolved; for a death the household reported as an illness it is still not presented as payable)
  if (source.kind === "product_heading_only") return { ...base, status: "unresolved", withhold: f.cause === "illness", reason: `${source.wording}; the cause of death is ${f.cause === "illness" ? "reported as an illness" : f.cause === "accident" ? "reported as an accident" : "not reported"}` };
  if (f.cause === "unknown") return { ...base, withhold: false, status: "unresolved", reason: `its printed condition is ${condition === "accident" ? "accident-only" : "for a natural catastrophe"} and the cause of death has not been reported` };
  if (f.cause === "accident") return { ...base, withhold: false, status: condition === "accident" ? "supported" : "unresolved", reason: condition === "accident" ? "the household reported an accident, which its printed condition requires (not a decision on the claim)" : "a natural-catastrophe benefit: whether the accident was one is not reported" };
  return { ...base, status: "not_applicable", withhold: true, reason: `its own printed condition is ${condition === "accident" ? `accident-only (${source.wording})` : "for a natural catastrophe"}; the household reported a death by illness (“${f.words ?? ""}”)` };
}

/** True when an output about this benefit may present its AMOUNT as potentially payable for the reported event. */
export const amountMayBePresented = (a: BenefitApplicability | undefined): boolean => !a || !a.withhold;

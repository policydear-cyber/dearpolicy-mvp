/** A plan's kind -- travel, life, health (hospital and medical), income protection, or another kind -- read from its
 * stored type through a closed list of whole English values, and from its name. A name and a type that
 * say different kinds make the plan "other" (neither); a plan neither says anything about is of no known kind (null).
 * Shared by the chat's readers so every page and answer agrees on which plan is which (#296). */
export type PlanKind = "travel" | "life" | "health" | "income" | "other";
const TYPE_KINDS = new Map<string, PlanKind>([
  ...["travel", "travel insurance", "travel takaful"].map((t) => [t, "travel"] as const),
  ...["life", "life insurance", "life assurance", "term", "term life", "term assurance", "term insurance", "whole life", "whole life assurance", "whole life insurance", "endowment",
    "family takaful"].map((t) => [t, "life"] as const),
  ...["health", "health insurance", "medical", "medical insurance", "hospitalisation", "hospitalization", "hospital and surgical", "hospital & surgical", "integrated shield",
    "integrated shield plan", "private medical", "private medical insurance", "medical takaful"].map((t) => [t, "health"] as const),
  ...["disability", "disability income", "income protection", "salary continuance", "permanent health", "permanent health insurance"].map((t) => [t, "income"] as const),
  ...["critical illness", "ci", "early critical illness", "personal accident", "accident", "long-term care", "long term care", "ltc", "careshield", "eldershield", "dental", "maternity",
    "hospital cash", "hospital income", "motor", "car", "home", "household", "contents", "investment", "investment-linked", "ilp", "annuity", "savings"].map((t) => [t, "other"] as const),
]);
const NAME_KINDS: [RegExp, PlanKind][] = [
  [/\btravel|\b(?:multi|single)[- ]trip\b|\btrip\b/i, "travel"],
  [/income protection|\bsalary\b|permanent health|disab/i, "income"],
  [/\bcritical\b|\bci\b|accident|long[- ]term|careshield|eldershield|hospital (?:cash|income)|dental|maternity/i, "other"],
  [/\bhealth\b|\bmedical\b|\bhospital(?!\s+(?:cash|income))|\bshield\b|medishield|integrated/i, "health"],
  [/^(?!.*(?:shield|short[- ]term|long[- ]term)).*(?:\blife\b|\bterm\b)/i, "life"],
];
export function planKind(d: { product: string | null; type?: string | null }): PlanKind | null {
  const byName = new Set(NAME_KINDS.filter(([re]) => re.test(d.product ?? "")).map(([, k]) => k));
  const byType = TYPE_KINDS.get((d.type ?? "").trim().toLowerCase().replace(/\s+/g, " "));
  // A name and a type that say different kinds ("Early Critical Protector" stored as Health, "Life Secure Critical
  // Illness" stored as Critical Illness) make the plan neither kind; a name that says two kinds, one of them the type's,
  // is the type's.
  if (byType) return !byName.size || byName.has(byType) ? byType : "other";
  return byName.size === 1 ? [...byName][0] : null;
}

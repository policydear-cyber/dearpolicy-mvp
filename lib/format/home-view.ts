/**
 * Which Home a household sees. The first-visit welcome ("Your portfolio is empty") is for a household with nothing on
 * file at all. Choosing one person who has nothing yet (a child just added, a spouse whose policy is not uploaded)
 * keeps the household's page: its cost, attention panel and the other people stay, and only that person's cover area
 * says nothing of theirs is on file, naming any policy a premium was already found for. Never "not covered". No I/O.
 */
export type HomeViewInput = {
  /** Documents linked to the chosen person (personal and reference). */
  personDocs: number;
  /** Each household member's linked-document count. */
  family: { policy_count?: number | null }[];
  /** Documents uploaded but not yet linked to anyone. */
  unclaimed: number;
  /** The chosen person's counted premiums. */
  premiums: { product_name: string | null; insurer: string | null }[];
};
export type HomeView = { empty: boolean; personEmpty: boolean; paidFor: string[] };

export function homeView(v: HomeViewInput): HomeView {
  const householdDocs = v.family.reduce((n, m) => n + (m.policy_count ?? 0), 0) + v.unclaimed;
  const hasAnything = v.personDocs > 0 || householdDocs > 0 || v.premiums.length > 0;
  const paidFor = [...new Set(v.premiums.map((p) => p.product_name ?? p.insurer).filter((n): n is string => !!n))];
  return { empty: !hasAnything, personEmpty: hasAnything && v.personDocs === 0, paidFor };
}

/**
 * Round 5: which column of a multi-column benefit table applies to each
 * person a document names -- the plan tier ("Plan A") or person class
 * ("Child", "Dependants", "Adult", "Private hospital") -- and, for a
 * personal hospital plan, the cover the Portfolio shows when the reading only
 * states it as a table row ("Policy year limit S$2,000,000").
 *
 * The choice is read from the document itself: the clause that names the
 * person ("Lim Xin Yi (child)", "Eligible employee: Lim Wei Jie, ..., Plan A",
 * "Dependants enrolled: spouse Tan Mei Ling") or the plan particulars line
 * ("Plan ShieldCare Premier (Private hospital) ..."). Nothing is guessed: a
 * person whose tier is not printed keeps benefit_tier NULL and every column
 * stays a candidate (see tierApplies in ./benefit-catalog).
 */
import { query } from "@/lib/db/client";
import { ensureEvidenceSchema } from "@/lib/documents/evidence";
import { normalizeCoverageCategory } from "@/lib/insurance";
import { selectTierRows, tierApplies } from "./benefit-catalog";

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
/** "Plan A (Grade M2 and above)" -> "Plan A"; the shortest printed form of a column. */
export const baseLabel = (tier: string) => flat(tier.replace(/\([^)]*\)\s*$/, "")) || flat(tier);
const shortestOf = (tiers: string[]) => [...tiers].sort((a, b) => baseLabel(a).length - baseLabel(b).length)[0];

/** The clause of the document that names this person: bounded by ; . or a
 * line break, at most ~60 characters before and ~160 after the name. */
export function personClause(text: string, name: string): string | null {
  const hay = text.replace(/[ \t]+/g, " ");
  const index = hay.toLowerCase().indexOf(flat(name).toLowerCase());
  if (index < 0) return null;
  const before = hay.slice(Math.max(0, index - 60), index);
  const after = hay.slice(index, index + name.length + 160);
  const sentence = [...before.matchAll(/\.\s/g)].pop();
  const start = Math.max(before.lastIndexOf(";"), before.lastIndexOf("\n"), sentence ? sentence.index! + 1 : -1);
  const endMatch = after.slice(name.length).search(/;|\n|\.(?:\s|$)/);
  return flat(before.slice(start + 1) + (endMatch < 0 ? after : after.slice(0, name.length + endMatch)));
}

/** Picks the column label for one person, or null when the document does not
 * say. Pure. */
export function pickMemberTier(args: { tiers: string[]; clause: string | null; relationshipHint?: string | null; particulars?: string[] }): string | null {
  const tiers = [...new Set(args.tiers.filter(Boolean))];
  if (!tiers.length) return null;
  const clause = (args.clause ?? "").toLowerCase();
  const hint = (args.relationshipHint ?? "").toLowerCase();
  const isChild = /\b(?:child|son|daughter)\b/.test(clause) || /^(?:child|son|daughter)$/.test(hint);
  const isSpouse = !isChild && (/\b(?:spouse|wife|husband)\b/.test(clause) || /^(?:spouse|wife|husband)$/.test(hint));
  const matching = (pattern: RegExp) => tiers.filter((t) => pattern.test(t));
  const asClass = (found: string[]) => (found.length ? baseLabel(shortestOf(found)) : null);
  const plan = clause.match(/\bplan\s+([a-z0-9]{1,3})\b(?!\w)/i);
  const byPlan = () => {
    if (!plan) return null;
    const key = "plan " + plan[1].toLowerCase();
    const found = tiers.filter((t) => tierApplies(t.toLowerCase(), key));
    return found.length ? shortestOf(found).slice(0, key.length) : null;
  };
  if (isChild) return asClass(matching(/\bchild(?:ren)?\b/i)) ?? asClass(matching(/\bdependants?\b/i));
  if (isSpouse) return asClass(matching(/\bspouse\b/i)) ?? asClass(matching(/\bdependants?\b/i)) ?? asClass(matching(/\badults?\b/i));
  const planned = byPlan();
  if (planned) return planned;
  // A plan particulars line that prints a column's own heading
  // ("Plan  ShieldCare Premier (Private hospital) with ...").
  for (const line of args.particulars ?? []) {
    const lower = flat(line).toLowerCase();
    const found = tiers.filter((t) => lower.includes(baseLabel(t).toLowerCase()));
    if (found.length === 1) return baseLabel(found[0]);
  }
  return asClass(matching(/\badults?\b/i));
}

/** The document's plan particulars lines ("Plan ...", "Plan type ..."). */
export function particularsLines(text: string): string[] {
  return [...text.matchAll(/(?:^|\n)[ \t]*(?:plan|plan\s+type|ward\s+class|class\s+of\s+cover)\b[^\n]{3,200}/gi)].map((m) => m[0].trim());
}

/** Writes policy_members.benefit_tier for the people this document linked,
 * then (personal hospital plans only) a cover row from the schedule's
 * policy-year limit when the reading left none the Portfolio can show.
 * Idempotent: recomputed on every read. */
export async function applyMemberTiers(args: {
  accountId: string; policyId: string; text: string;
  people: { name: string; memberId: string; relationshipHint?: string | null }[];
  policyType: string | null; productName: string | null; personalCoverageConfirmed: boolean;
}) {
  if (!args.people.length) return { assigned: 0, derived: 0 };
  await ensureEvidenceSchema();
  const tierRows = (await query<{ tier: string }>(
    `SELECT DISTINCT tier FROM policy_benefits WHERE account_id=$1 AND policy_id=$2 AND tier IS NOT NULL`, [args.accountId, args.policyId])).rows;
  const tiers = tierRows.map((r) => r.tier);
  const particulars = particularsLines(args.text);
  const chosen = new Map<string, string | null>();
  let assigned = 0;
  for (const person of args.people) {
    const tier = pickMemberTier({ tiers, clause: personClause(args.text, person.name), relationshipHint: person.relationshipHint, particulars });
    chosen.set(person.memberId, tier);
    // A tier the household chose on the Policies screen (user_declared) is
    // authoritative; a re-read of the document never overwrites it.
    await query(`UPDATE policy_members SET benefit_tier=$3 WHERE account_id=$1 AND policy_id=$2 AND family_member_id=$4
                  AND NOT (source='user_declared' AND benefit_tier IS NOT NULL)`,
      [args.accountId, args.policyId, tier, person.memberId]);
    if (tier) assigned++;
  }
  let derived = 0;
  const category = args.policyType ? normalizeCoverageCategory(args.policyType) : null;
  if (!args.personalCoverageConfirmed || category !== "Hospitalisation") return { assigned, derived };
  const limits = (await query<{ id: string; value: string; currency: string | null; source_page: number | null; quote: string | null; tier: string | null; passage_verified: boolean | null }>(
    `SELECT id,formula_value::text AS value,currency,source_page,quote,tier,passage_verified FROM policy_benefits
      WHERE account_id=$1 AND policy_id=$2 AND row_kind='policy_year_limit' AND formula_value IS NOT NULL ORDER BY source_page,id`,
    [args.accountId, args.policyId])).rows;
  const printed = flat(args.text).toLowerCase();
  for (const person of args.people) {
    const shown = await query(`SELECT 1 FROM policy_coverages WHERE account_id=$1 AND policy_id=$2 AND family_member_id=$3 AND category=$4 AND confirmed AND evidence_verified`,
      [args.accountId, args.policyId, person.memberId, category]);
    if (shown.rows.length) continue;
    const tier = chosen.get(person.memberId) ?? null;
    const candidates = selectTierRows(limits.map((l) => ({ ...l, policyId: args.policyId, benefitName: "policy year limit", sourcePage: l.source_page })), () => tier);
    if (!candidates.length || new Set(candidates.map((c) => Number(c.value) + "|" + (c.currency ?? ""))).size !== 1) continue;
    const limit = candidates[0];
    // The Portfolio row is only as good as its evidence: the table row was
    // verified on its page, and the person's name is printed in this document.
    const verified = limit.passage_verified === true && printed.includes(flat(person.name).toLowerCase());
    await query(
      `INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,notes,source_page,authority,confirmed,evidence_text,evidence_verified)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'personal_document',$10,$11,$10)`,
      [args.accountId, args.policyId, person.memberId, category, Number(limit.value), limit.currency, args.productName,
        "Policy-year limit" + (limit.tier ? " (" + limit.tier + ")" : "") + " from the table of benefits; hospital bills are otherwise paid as charged, after the deductible and co-insurance",
        limit.source_page, verified, limit.quote]);
    derived++;
  }
  return { assigned, derived };
}

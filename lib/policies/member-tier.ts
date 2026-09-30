/**
 * Round 5 (item 3): one document can cover several people, and a group
 * booklet often has tiers (employee / spouse / child cover). The people a
 * document covers are policy_members rows (one per person, already
 * many-to-many); the tier each person holds is the nullable
 * policy_members.benefit_tier column -- the same column the reading pipeline
 * fills from the document's own benefit table (lib/policies/member-tiers.ts)
 * and the claim / answer paths narrow by (selectTierRows). One column, one
 * vocabulary: when the document has a multi-column benefit table, the tiers
 * offered are that table's own column headings ("Plan A", "Child",
 * "Dependants"); otherwise the relationship tiers (Employee / Spouse / Child).
 */
import { query } from "@/lib/db/client";
import { baseLabel, pickMemberTier } from "@/lib/policies/member-tiers";

type TierGlobals = typeof globalThis & { __dearpolicyPolicyMemberTier?: Promise<void> };

export function ensurePolicyMemberTierSchema(): Promise<void> {
  const state = globalThis as TierGlobals;
  state.__dearpolicyPolicyMemberTier ??= query(`ALTER TABLE policy_members ADD COLUMN IF NOT EXISTS benefit_tier text`)
    .then(() => undefined)
    .catch((error) => { state.__dearpolicyPolicyMemberTier = undefined; throw error; });
  return state.__dearpolicyPolicyMemberTier;
}

const TIER_LABELS: Record<string, string> = {
  employee: "Employee", self: "Employee", member: "Employee", principal: "Employee", policyholder: "Employee",
  spouse: "Spouse", wife: "Spouse", husband: "Spouse", partner: "Spouse",
  child: "Child", son: "Child", daughter: "Child", dependant: "Child", dependent: "Child",
};

/** The tier label for one relationship hint ("spouse" -> "Spouse"). */
export function tierLabel(hint: string | null | undefined): string | null {
  const key = (hint ?? "").trim().toLowerCase();
  if (!key) return null;
  return TIER_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** The cover tiers a document itself describes, from the relationship each
 * named person is covered as (employee, spouse, child). Offered only when
 * the document has at least two distinct tiers. */
export function tierOptionsFromHints(hints: (string | null | undefined)[]): string[] {
  const labels = new Set<string>();
  for (const hint of hints) {
    const label = tierLabel(hint);
    if (label) labels.add(label);
  }
  const order = ["Employee", "Spouse", "Child"];
  const list = [...labels].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return list.length >= 2 ? list : [];
}

/** Employee / spouse / child: how group schemes (employer benefits
 * booklets) tier their cover. Offered for a group document even when the
 * reading pipeline kept no named people -- reference documents deliberately
 * keep none (lib/documents/intelligence.ts sanitizePolicyExtraction). */
export const GROUP_SCHEME_TIERS = ["Employee", "Spouse", "Child"];

/** The tiers to offer for one document: those its named people are covered
 * as, or, for a group scheme, the usual employee / spouse / child tiers. */
export function tierOptionsForDocument(args: { hints: (string | null | undefined)[]; groupPolicyNumber?: string | null; policyType?: string | null; tableTiers?: (string | null | undefined)[] }): string[] {
  const fromTable = tableTierOptions(args.tableTiers ?? []);
  if (fromTable.length) return fromTable;
  const fromHints = tierOptionsFromHints(args.hints);
  if (fromHints.length) return fromHints;
  const isGroup = Boolean(args.groupPolicyNumber) || /\bgroup\b/i.test(args.policyType ?? "");
  return isGroup ? [...GROUP_SCHEME_TIERS] : [];
}

/** A tier a person may be assigned: one the document offers, trimmed. */
export function normalizePlanTier(value: unknown, offered: string[]): string | null {
  if (typeof value !== "string") return null;
  const tier = value.trim();
  if (!tier) return null;
  return offered.find((o) => o.toLowerCase() === tier.toLowerCase()) ?? null;
}

/** The column headings of the document's own benefit table
 * (policy_benefits.tier), in their shortest printed form -- the vocabulary
 * policy_members.benefit_tier is matched against (tierApplies). */
export function tableTierOptions(tiers: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const tier of tiers) {
    if (typeof tier !== "string" || !tier.trim()) continue;
    const label = baseLabel(tier);
    if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The tier to pre-select for a person the document names, in the offered
 * vocabulary: a table column when the document has one, else the
 * relationship tier. */
export function namedTierFor(hint: string | null | undefined, offered: string[], tableTiers: (string | null | undefined)[] = []): string | null {
  const columns = tableTiers.filter((t): t is string => typeof t === "string" && !!t.trim());
  const tier = columns.length ? pickMemberTier({ tiers: columns, clause: null, relationshipHint: hint ?? null }) : tierLabel(hint);
  return tier ? offered.find((o) => o.toLowerCase() === tier.toLowerCase()) ?? null : null;
}

/** Distinct benefit-table column headings per document (policy_benefits.tier).
 * Read through to_jsonb so a database the reading pipeline has not yet
 * migrated simply has none. */
export async function loadTableTiers(
  client: { query: <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }> },
  accountId: string, policyIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!policyIds.length) return out;
  try {
    const rows = (await client.query<{ policy_id: string; tier: string }>(
      `SELECT DISTINCT policy_id::text AS policy_id, to_jsonb(pb)->>'tier' AS tier FROM policy_benefits pb
        WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) AND to_jsonb(pb)->>'tier' IS NOT NULL`, [accountId, policyIds])).rows;
    for (const row of rows) out.set(row.policy_id, [...(out.get(row.policy_id) ?? []), row.tier]);
  } catch { /* policy_benefits not created yet: no table tiers */ }
  return out;
}

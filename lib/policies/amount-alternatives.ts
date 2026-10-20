import { createHash } from "node:crypto";
import { formatMoney, statedCurrencyCode } from "@/lib/format/currency";
import { coverageForBenefit, type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import type { PolicyContract } from "@/lib/policies/inventory";
import { eventForBenefitName } from "@/lib/ledger/events";

/** Two ways one person's cover works out the same benefit.
 *
 * A personal accident scheme can print the same fracture row twice: as a share of a fixed fracture limit in one table
 * ("Compensation (% of S$5,000)": wrist 25%, S$1,250) and as a share of the accident sum insured in another
 * ("Compensation Schedule (% of Sum Insured)": wrist 20%, S$120,000 on a S$600,000 cover). Neither page says which
 * applies, so neither is THE amount: they are alternatives, never added together, and the insurer decides. Showing one
 * of them (whichever a page happened to pick) is how the household saw three different figures for one fracture.
 *
 * The shape is the one the Coverage and Benefits pages draw (mnt/project-files/ux-design/coverage-alternatives-shape.md):
 * the same object on every member row. A group is only returned whole: if any option's figure cannot be worked out
 * (no sum insured, no stated currency), nothing is returned, because one remaining option reads as the answer. */
export type AmountAlternatives = {
  groupId: string;
  note: string;
  options: {
    rowId: string;
    amountText: string;
    basis: string;
    documentName: string;
    policyId: string | null;
    page: number | null;
    asOf?: string | null;
    conditions: string[];
  }[];
};

export const ALTERNATIVES_NOTE = "There is more than one way your cover works this out. They are never added together; the insurer decides which applies.";

/** Bracketed annotations ("(Other Fracture)") and punctuation ("Leg^") are how one table marks a row the other states plainly. */
function rowKey(name: string) {
  return (name ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
}
/** Names that say nothing about which benefit a row is ("Others", "Any other fracture"): never matched across tables. */
const GENERIC_ROW = /^(?:(?:all|any)?others?\w*|balance|remaining|miscellaneous|misc)$/;
/** What a row pays for, beyond its name: the traits it responds to and the ones it requires. A "Leg" row in a fracture
 * table and a "Leg" row in a dismemberment table share a name and nothing else. */
// Only the traits that separate benefits are compared: the catalog gives the same row its other traits by different
// paths (keywords, or the reader's category: catalog-builder.ts readerTraits), so one printed by two documents differs there.
const DISTINGUISHING = new Set(["death", "disability", "illness", "hospitalisation"]);
const sameBenefitKey = (b: CatalogBenefit) => [rowKey(b.benefitName), [...(b.requires ?? [])].sort().join(","),
  b.traits.filter((t) => DISTINGUISHING.has(t)).sort().join(",")].join("|");
/** The event a row's own words name, or null when they name none ("Hip 75%"). */
const namedEvent = (b: CatalogBenefit) => { const e = eventForBenefitName(`${b.benefitName} ${b.quote}`).event; return e === "other" ? null : e; };

const percentOf = (quote: string) => {
  const m = String(quote ?? "").match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
};
/** A fraction (0.2) as a percentage ("20"). */
const pct = (fraction: number) => String(Math.round(fraction * 1000) / 10);

type Option = AmountAlternatives["options"][number] & { value: number; currency: string };

function optionFor(contract: PolicyContract, benefit: CatalogBenefit, documentName: (policyId: string) => string): Option | null {
  const value = benefit.formulaValue;
  if (value == null || !(value > 0)) return null;
  const accident = (benefit.requires ?? []).includes("accident") ? ["Accident only"] : [];
  const conditions = [...accident, ...benefit.conditions.filter((c) => c.length <= 120)].slice(0, 3);
  const base = { rowId: benefit.id, documentName: documentName(benefit.policyId), policyId: benefit.policyId, page: benefit.sourcePage, conditions };
  if (benefit.formulaKind === "fixed") {
    const currency = statedCurrencyCode(benefit.currency);
    if (!currency) return null;
    const share = percentOf(benefit.quote);
    const basis = share && share > 0 && share <= 100
      ? `${pct(share / 100)}% of the ${formatMoney(Math.round((value / (share / 100)) * 100) / 100, currency)} limit`
      : "the amount printed";
    return { ...base, value, currency, amountText: formatMoney(value, currency), basis };
  }
  if (benefit.formulaKind === "sum_insured" && value <= 2) {
    const cover = coverageForBenefit(contract, benefit);
    const currency = statedCurrencyCode(cover?.currency);
    if (!cover || cover.amount == null || !(cover.amount > 0) || !currency) return null;
    const amount = Math.round(value * cover.amount * 100) / 100;
    const label = (cover.category ?? cover.productName ?? "").trim();
    return { ...base, value: amount, currency, amountText: formatMoney(amount, currency),
      basis: `${pct(value)}% of the ${formatMoney(cover.amount, currency)}${label ? " " + label : ""} sum insured`,
      asOf: cover.effectiveDate ?? null };
  }
  return null;
}

/** The alternatives for each benefit of one person's contract that has them (keyed by benefit id). */
export function amountAlternatives(contract: PolicyContract, benefits: CatalogBenefit[], documentName: (policyId: string) => string): Map<string, AmountAlternatives> {
  const out = new Map<string, AmountAlternatives>();
  const groups = new Map<string, CatalogBenefit[]>();
  for (const b of benefits) {
    // A row read per plan column is narrowed by the person's plan elsewhere (selectTierRows), not offered as an alternative.
    if (b.tier || (b.formulaKind !== "fixed" && b.formulaKind !== "sum_insured")) continue;
    const name = rowKey(b.benefitName);
    if (!name || GENERIC_ROW.test(name)) continue;
    const key = sameBenefitKey(b);
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    // The alternatives are one benefit printed by different documents. Two rows of one document with the same name are
    // two tables' benefits (a fracture "Leg" and a dismemberment "Leg"), and rows whose words name different events
    // (a fracture and a loss of limb) are different benefits.
    if (new Set(rows.map((b) => b.policyId)).size !== rows.length) continue;
    if (new Set(rows.map(namedEvent).filter(Boolean)).size > 1) continue;
    const options = rows.map((b) => optionFor(contract, b, documentName));
    if (options.some((o) => !o)) continue;
    const opts = options as Option[];
    // The same figure stated twice is one figure; alternatives are only for figures that differ.
    if (new Set(opts.map((o) => o.currency + o.value)).size < 2) continue;
    opts.sort((a, b) => (a.documentName).localeCompare(b.documentName) || (a.page ?? 0) - (b.page ?? 0));
    const groupId = createHash("sha256").update(opts.map((o) => o.rowId).sort().join("|")).digest("hex").slice(0, 16);
    const group: AmountAlternatives = { groupId, note: ALTERNATIVES_NOTE,
      options: opts.map(({ value: _v, currency: _c, ...o }) => o) };
    for (const o of opts) out.set(o.rowId, group);
  }
  return out;
}

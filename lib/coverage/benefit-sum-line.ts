import { PRINTED_FIGURE, FIGURE_END, printedNumber, groupsInLakhs } from "@/lib/format/printed-number";

/**
 * Is the amount on a schedule line a benefit's sum, or something else the line prints beside a cover's name?
 *
 * A schedule prints more than sums: "Life Cover Premium A$1,200", "TPD Premium Waiver S$3,000", "Life Insurance Fund Value
 * RM45,000", "Deductible S$3,500". Intake files such a line under the cover its words name (lib/insurance.ts
 * normalizeCoverageCategory: "TPD Premium Waiver" is stored as Total Permanent Disability), so its stored category says
 * nothing; only the words the line prints before its figure (policy_coverages.evidence_text) do. A line whose own label
 * names a premium, a waiver, a fund, surrender or cash value, a policy loan, a fee, a tax or the person's own share of a
 * bill is never a benefit sum: it is no tile, no total, no claim amount and no ledger row. Read at read time, so a line
 * already stored this way is left out without a re-read, and nothing is deleted.
 *
 * A closed list in English, Malay, Indonesian, French, German and Chinese. A premium word that names a plan tier
 * ("Premium Plan", "Premium ward") is a product's name, not a premium.
 */
const NOT_A_SUM = new RegExp([
  // A premium or contribution the person pays (Takaful "contribution", Malay "caruman", French "cotisation").
  String.raw`\bpremi(?:um|ums|a)?\b(?!\s+(?:plans?|tiers?|class|wards?|rooms?|cover|care|edition|option|package|series|shield|health|life|plus|protect\w*|saver|select|gold|platinum|version)\b)`,
  String.raw`\bcontributions?\b|\bcaruman\b|\biuran\b|\bcotisations?\b|\bprimes?\s+(?:annuelle|mensuelle|totale|d['’]assurance|nette|brute)\b|Prämie|\bBeitr[aä]g\w*|保费|保費`,
  // A waiver of premium: what is waived is a premium, never the cover's sum.
  String.raw`\bwaiver\b|\bwaived?\b`,
  // A value the policy holds, not a sum it pays on a claim.
  String.raw`\b(?:fund|surrender|cash|account|policy|cash[\s-]in|transfer|units?|bid|investment|guaranteed\s+cash)\s+values?\b|\bnilai\s+(?:tunai|serahan|dana|akaun|penyerahan)\b|\bvaleur\s+de\s+rachat\b|R[uü]ckkaufswert|现金价值|現金價值|退保`,
  // A loan against the policy, or a fee or tax charged on it.
  String.raw`\bpolicy\s+loans?\b|\bloans?\s+(?:outstanding|balance|interest|amount\s+outstanding)\b|\bpinjaman\s+polisi\b|\b(?:policy|admin(?:istration)?|surrender|management|service|processing)\s+(?:fees?|charges?)\b|\bstamp\s+duty\b|\b(?:gst|vat|sst)\b|\blev(?:y|ies)\b`,
  // The person's own share of a bill.
  String.raw`\bdeductibles?\b|\bdeduktibel\b|\bexcess\b|\bco-?(?:payments?|pay|insurance)\b|\brisiko\s+sendiri\b|\bfranchise\b|\bSelbstbeteiligung\b|\bSelbstbehalt\b`,
].join("|"), "iu");

/** The words a line prints before its figure: the stored amount's own figure when the line prints it, else the first one. */
export function lineLabel(evidenceText: string | null | undefined, amount: number | null | undefined): string {
  const text = String(evidenceText ?? "");
  if (!text.trim()) return "";
  const lakh = groupsInLakhs(text);
  const figures = [...text.matchAll(new RegExp("(?<![\\d.,'’])" + PRINTED_FIGURE + FIGURE_END, "g"))];
  const at = (amount != null ? figures.find((m) => printedNumber(m[0], null, { lakh }) === amount) : undefined) ?? figures[0];
  const before = at ? text.slice(0, at.index) : text;
  // The label runs back to the start of its own line or row, never into the row before ("…S$500,000\nPremium S$1,200").
  const start = Math.max(before.lastIndexOf("\n"), before.lastIndexOf(";"), before.lastIndexOf("|"));
  return before.slice(start + 1).trim();
}

/** True when the line's own label says its amount is no benefit's sum (see above). A line with no printed label is a sum. */
export function notABenefitSum(line: { evidenceText?: string | null; amount?: number | null }): boolean {
  return NOT_A_SUM.test(lineLabel(line.evidenceText, line.amount ?? null));
}

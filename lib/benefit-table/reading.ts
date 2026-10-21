/** The benefit table, step 1: one careful reading of each document, once, into rows the server can check.
 *
 * The model reads one document at a time and writes two kinds of row, each with the exact words it rests on:
 *   covers    a person's own cover as a personal document prints it (who, which product and cover, which plan, the sum
 *             insured, the date it was printed for);
 *   benefits  what a benefit pays, under the section heading and table column it is printed in (an amount, a limit, a
 *             daily rate, a percentage and what it is a percentage of, "not covered"), with its own conditions.
 * It never works anything out: a percentage stays a percentage and the base is only named. The server checks every row
 * against the stored page (lib/benefit-table/check.ts), and the household's table is put together from the checked rows
 * (lib/benefit-table/assemble.ts). */
import { UNTRUSTED_DOCUMENT_NOTICE } from "@/lib/documents/evidence";

export const DOCUMENT_KINDS = ["personal_proof", "scheme_terms", "policy_wording", "product_summary", "illustration", "letter", "bill_or_receipt", "other"] as const;
export const PAYS = ["amount", "up_to", "per_day", "percent", "as_charged", "not_covered", "words"] as const;
export const PERCENT_OF = ["sum_insured", "fixed_amount", "other"] as const;

export type ReadCover = { person: string; product: string; cover: string; plan: string | null; sumInsured: number | null; asOf: string | null; page: number; quote: string };
export type ReadBenefit = {
  section: string | null; column: string | null; benefit: string; pays: (typeof PAYS)[number]; value: number | null;
  percentOf: (typeof PERCENT_OF)[number] | null; baseAmount: number | null; baseQuote: string | null;
  fromDay: number | null; maxDays: number | null; conditions: string[]; page: number; quote: string;
};
export type Reading = {
  document: { kind: (typeof DOCUMENT_KINDS)[number]; product: string | null; insurer: string | null; namedPeople: string[]; plan: string | null; periodFrom: string | null; periodTo: string | null };
  covers: ReadCover[];
  benefits: ReadBenefit[];
};

const nullable = (type: string) => ({ type: [type, "null"] });
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

export const READING_SCHEMA = object({
  document: object({
    kind: { type: "string", enum: DOCUMENT_KINDS },
    product: nullable("string"), insurer: nullable("string"),
    namedPeople: { type: "array", items: { type: "string" } },
    plan: nullable("string"), periodFrom: nullable("string"), periodTo: nullable("string"),
  }),
  covers: { type: "array", items: object({
    person: { type: "string" }, product: { type: "string" }, cover: { type: "string" }, plan: nullable("string"),
    sumInsured: nullable("number"), asOf: nullable("string"), page: { type: "integer" }, quote: { type: "string" },
  }) },
  benefits: { type: "array", items: object({
    section: nullable("string"), column: nullable("string"), benefit: { type: "string" },
    pays: { type: "string", enum: PAYS }, value: nullable("number"),
    percentOf: { anyOf: [{ type: "string", enum: PERCENT_OF }, { type: "null" }] }, baseAmount: nullable("number"), baseQuote: nullable("string"),
    fromDay: nullable("integer"), maxDays: nullable("integer"),
    conditions: { type: "array", items: { type: "string" } },
    page: { type: "integer" }, quote: { type: "string" },
  }) },
});

export const READING_PROMPT = `You read one insurance document for a household, once, and list what it prints. Your list becomes the household's table of benefits, which they will check, so copy exactly and never work anything out.

The document's pages arrive between <document> and </document>, each page in <page n="...">.${UNTRUSTED_DOCUMENT_NOTICE}

document:
- kind: "personal_proof" when the document names the people it insures and what they hold (a certificate's Part 1, a policy schedule, a personal travel summary). "scheme_terms" for a group scheme's terms for every member (highlights of cover, benefit summary). "policy_wording", "product_summary", "illustration" (a pre-sale illustration), "letter", "bill_or_receipt" or "other" otherwise. A pack can hold several parts: choose the kind by whether any page names an insured person with their cover.
- product, insurer, plan and period exactly as printed (dates as printed); namedPeople: the insured people the document names, as printed. Never list an address, an agent or a signatory as insured.

covers: only from pages that name a person with their cover. One row per person per cover line: the person as printed, the product (the policy or scheme), the cover (the line's own name, for example a group scheme's separate covers), the plan if printed, the sum insured as a plain number (600000 for "S$600,000"; null when none is printed), the "as of" or start date printed for it, the page, and the exact line as quote.

benefits: every row that says what a benefit pays or that it is not covered. Leave out definitions, exclusions on their own, contact details and premiums.
- section: the heading of the cover or policy the row is printed under, as printed (for example "BENEFIT 2: GROUP PERSONAL ACCIDENT" or "Section 3 Personal accident"). Look back across earlier pages for the heading that is still in force. null only when the whole document is one cover with no such heading.
- column: when a table prints different figures in different columns (plans such as Classic and Business, or Adult and Child), one row per column, with the column heading as printed. null when there is one figure.
- benefit: the row's own label, as printed, with its sub-heading when the label alone is unclear ("Simple Fracture: Arm, Elbow, Wrist or Ribs").
- pays: "amount" (a fixed sum), "up_to" (a limit), "per_day" (a daily amount), "percent" (a percentage of something), "as_charged", "not_covered", or "words" (pays but prints no figure).
- value: the figure as a plain number (25 for "25%", 500 for "S$500"), or null.
- percentOf: for a percentage, what the page says it is a percentage of: "sum_insured" when it says sum insured or sum assured or coverage amount; "fixed_amount" when it prints a figure ("% of S$5,000"), and then baseAmount is that figure and baseQuote the exact words that print it; "other" otherwise. null for other rows.
- fromDay and maxDays: for a daily benefit, the first paid day and the most days, as printed.
- conditions: the conditions printed for this row (its footnote, its heading's "due to Accident", its own "only if ..."), each as exact words from this document. Never a condition from another row.
- page and quote: the page and the exact words of the row, with its figure. Copy the words as they appear, including odd spacing or line breaks within a table row. Never shorten with "..." inside a figure.

Copy figures exactly. When a currency is not printed, do not add one. When unsure whether something is a benefit row, include it with pays "words".`;

/** The pages as the model reads them. */
export function renderDocument(doc: { name: string; pages: { page: number; text: string }[] }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<document name="${esc(doc.name)}">\n${doc.pages.map((p) => `<page n="${p.page}">\n${esc(p.text)}\n</page>`).join("\n")}\n</document>`;
}

// ------------------------------------------------------------------ step 2: which cover each benefit section belongs to

/** A benefit section (one document, one heading, one column) and the cover types the household holds. The model proposes
 * which cover a section's rows are paid under; the household sees and can change it on Coverage. */
export type SectionRef = { key: string; document: string; kind: string; product: string | null; section: string | null; column: string | null; examples: string[] };
export type CoverType = { key: string; product: string; cover: string; plan: string | null; holders: string[] };
export type SectionLink = { section: string; cover: string | null; why: string };

export const LINKING_SCHEMA = object({
  links: { type: "array", items: object({ section: { type: "string" }, cover: nullable("string"), why: { type: "string" } }) },
});

export const LINKING_PROMPT = `A household's documents have been read into benefit sections. Each section is one heading (and one table column) of one document. Say which of the household's covers each section's benefits are paid under.

- cover: the key of one cover from <covers>, or null when the section belongs to none of them (a product the household does not hold, a plan column they do not hold, a document about something else).
- Match by what the section is about and the product it belongs to: a group scheme's accident section belongs to the scheme's accident cover, not its life cover. A column belongs to a cover only when the column is the cover's plan or applies to every plan.
- why: one short sentence, in plain words, that a household member could check.
Every section key appears exactly once.`;

export function renderLinkingInput(sections: SectionRef[], covers: CoverType[]): string {
  return `<covers>\n${covers.map((c) => JSON.stringify({ key: c.key, product: c.product, cover: c.cover, plan: c.plan, heldBy: c.holders })).join("\n")}\n</covers>\n<sections>\n${sections.map((s) => JSON.stringify(s)).join("\n")}\n</sections>`;
}

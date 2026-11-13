/** The benefit table, step 1: one careful reading of each document, once, into rows the server can check.
 *
 * The model reads one document at a time and writes two kinds of row, each with the exact words it rests on:
 *   covers    a person's own policy, cover or rider as a personal document prints it (who, which product and cover,
 *             which base policy a rider is attached to, the plan, the sum insured, the premium, the dates);
 *   benefits  anything the document says is paid or held, under the section heading and table column it is printed in:
 *             an amount, a limit, a daily or monthly or yearly payout, a percentage and its base, a fund, cash or
 *             maturity value on a date, "not covered", or plain words with no figure. Each says whether the document
 *             calls it guaranteed, not guaranteed or an illustration.
 * Nothing is specific to one kind of insurance: the same rows hold accident, life, health, travel, investment-linked,
 * endowment and annuity documents. A row the reader cannot place is kept as plain words, never left out.
 * It never works anything out: a percentage stays a percentage and the base is only named. The server checks every row
 * against the stored page (lib/benefit-table/check.ts), and the household's table is put together from the checked rows
 * (lib/benefit-table/assemble.ts). */
import { UNTRUSTED_DOCUMENT_NOTICE } from "@/lib/documents/evidence";

export const DOCUMENT_KINDS = ["personal_proof", "scheme_terms", "policy_wording", "product_summary", "illustration", "letter", "bill_or_receipt", "other"] as const;
export const PAYS = ["amount", "up_to", "per_day", "per_period", "percent", "value", "as_charged", "not_covered", "words"] as const;
export const PERIODS = ["week", "month", "quarter", "half_year", "year"] as const;
export const BASES = ["guaranteed", "non_guaranteed", "illustrated"] as const;
export const PERCENT_OF = ["sum_insured", "fixed_amount", "other"] as const;
/** For whom a row is, on a document naming two or more insured people (assemble.ts perPersonRows). */
export const FOR_WHOM = ["each_named_insured", "some_insured"] as const;

export type ReadCover = { person: string; product: string; cover: string; plan: string | null; riderOf: string | null; policyNumber: string | null;
  sumInsured: number | null; premium: number | null; premiumQuote?: string | null; premiumFrequency: string | null; asOf: string | null; startDate: string | null; endDate: string | null; page: number; quote: string };
export type ReadBenefit = {
  section: string | null; column: string | null; benefit: string; pays: (typeof PAYS)[number]; value: number | null;
  period: (typeof PERIODS)[number] | null; basis: (typeof BASES)[number] | null; asOf: string | null;
  percentOf: (typeof PERCENT_OF)[number] | null; baseAmount: number | null; baseQuote: string | null;
  cap: number | null; capQuote: string | null;
  fromDay: number | null; maxDays: number | null; conditions: string[]; page: number; quote: string;
  /** Left out (undefined) unless the reader says; anything but "each_named_insured" gives the row to no one by this rule. */
  forWhom?: (typeof FOR_WHOM)[number] | null;
};
export type Reading = {
  document: { kind: (typeof DOCUMENT_KINDS)[number]; product: string | null; insurer: string | null; namedPeople: string[]; plan: string | null; periodFrom: string | null; periodTo: string | null };
  covers: ReadCover[];
  benefits: ReadBenefit[];
};

const nullable = (type: string) => ({ type: [type, "null"] });
/** A field the model leaves out when the page does not print it. The API refuses a schema with more than 16 nullable
 * (union-typed) fields, so the less central ones are optional instead; check.ts reads a missing field as null. */
const optional = (type: string) => ({ type, optional: true });
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false,
  required: Object.keys(properties).filter((k) => !(properties[k] as { optional?: boolean }).optional),
  properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => { const { optional: _o, ...rest } = v as { optional?: boolean }; return [k, rest]; })) });

export const READING_SCHEMA = object({
  document: object({
    kind: { type: "string", enum: DOCUMENT_KINDS },
    product: nullable("string"), insurer: optional("string"),
    namedPeople: { type: "array", items: { type: "string" } },
    plan: nullable("string"), periodFrom: optional("string"), periodTo: optional("string"),
  }),
  covers: { type: "array", items: object({
    person: { type: "string" }, product: { type: "string" }, cover: { type: "string" }, plan: nullable("string"),
    riderOf: optional("string"), policyNumber: nullable("string"),
    sumInsured: nullable("number"), premium: optional("number"), premiumQuote: optional("string"), premiumFrequency: optional("string"),
    asOf: nullable("string"), startDate: optional("string"), endDate: optional("string"), page: { type: "integer" }, quote: { type: "string" },
  }) },
  benefits: { type: "array", items: object({
    section: nullable("string"), column: nullable("string"), benefit: { type: "string" },
    pays: { type: "string", enum: PAYS }, value: nullable("number"),
    period: { anyOf: [{ type: "string", enum: PERIODS }, { type: "null" }] },
    basis: { anyOf: [{ type: "string", enum: BASES }, { type: "null" }] }, asOf: optional("string"),
    percentOf: { anyOf: [{ type: "string", enum: PERCENT_OF }, { type: "null" }] }, baseAmount: nullable("number"), baseQuote: nullable("string"),
    cap: nullable("number"), capQuote: nullable("string"),
    fromDay: optional("integer"), maxDays: optional("integer"), forWhom: { type: "string", enum: FOR_WHOM, optional: true },
    conditions: { type: "array", items: { type: "string" } },
    page: { type: "integer" }, quote: { type: "string" },
  }) },
});

export const READING_PROMPT = `You read one insurance document for a household, once, and list what it prints. Your list becomes the household's table of benefits, which they will check, so copy exactly and never work anything out.

The document's pages arrive between <document> and </document>, each page in <page n="...">.${UNTRUSTED_DOCUMENT_NOTICE}

document:
- kind: "personal_proof" when the document names the people it insures and what they hold (a certificate's Part 1, a policy schedule, a personal travel summary, a yearly policy or fund statement). "scheme_terms" for a group scheme's terms for every member (highlights of cover, benefit summary). "policy_wording", "product_summary", "illustration" (a pre-sale benefit illustration or quotation: it shows what might be bought, not what is held), "letter", "bill_or_receipt" or "other" otherwise. A pack can hold several parts: choose the kind by whether any page names an insured person with their cover.
- product, insurer, plan and period exactly as printed (dates as printed); namedPeople: the insured people the document names, as printed. Never list an address, an agent or a signatory as insured.

covers: only from pages that name a person with their cover. One row per person per cover line, including each rider: the person as printed, the product (the policy or scheme), the cover (the line's own name: a group scheme's separate covers, a basic plan, a rider), riderOf (for a rider, the basic plan or policy it is attached to, as printed; left out otherwise), the plan if printed, the policy number, the sum insured or sum assured as a plain number (600000 for "S$600,000"; null when none is printed), the premium and how often it is paid when the document prints them for that person's cover, with premiumQuote the exact words that print the premium when they are not in quote (each left out otherwise), the "as of" date, the start date and the end, expiry or maturity date as printed (each left out when not printed), the page, and the exact line as quote.

benefits: every row that says what is paid or held, or that something is not covered: benefits, limits, payouts, annuity or income payments, cash, surrender, fund or maturity values, bonuses. Leave out definitions, exclusions on their own and contact details.
- Be complete: go through every page and every table, row by row. A schedule of 20 rows (a fracture, dismemberment, sight or burns scale) gives 20 rows here, one per printed line, never a summary or a sample. When two documents print the same benefit, each document's rows are listed from that document.
- section: the heading of the cover or policy the row is printed under, as printed (for example "BENEFIT 2: GROUP PERSONAL ACCIDENT" or "Section 3 Personal accident"). Look back across earlier pages for the heading that is still in force. null only when the whole document is one cover with no such heading.
- column: when a table prints different figures in different columns (plans such as Classic and Business, or Adult and Child), one row per column, with the column heading as printed. null when there is one figure.
- benefit: the row's own label, as printed, with its sub-heading when the label alone is unclear ("Simple Fracture: Arm, Elbow, Wrist or Ribs").
- pays: "amount" (a fixed sum paid on an event), "up_to" (a limit), "per_day" (a daily amount), "per_period" (a payment every week, month, quarter, half year or year, such as annuity or income payments; set period), "percent" (a percentage of something), "value" (a fund, cash, surrender, account or maturity value; set asOf to the date it is printed for), "as_charged", "not_covered", or "words" (anything else the document says is paid or held, with no figure of its own; a row you cannot place goes here, never left out).
- value: the figure as a plain number (25 for "25%", 500 for "S$500"), or null.
- basis: "guaranteed" or "non_guaranteed" when the document says so for this figure; "illustrated" for a projected figure or one at an assumed rate of return; null when it says neither.
- asOf: the date a value or figure is printed for, as printed; left out otherwise.
- percentOf: for a percentage, what the page says it is a percentage of: "sum_insured" when it says sum insured or sum assured or coverage amount; "fixed_amount" when it prints a figure ("% of S$5,000"), and then baseAmount is that figure and baseQuote the exact words that print it; "other" otherwise. null for other rows.
- cap and capQuote: for a percentage, the most it pays when the row prints one ("100% of Sum Insured (up to S$400,000)", "15% of Sum Insured or up to S$50,000, whichever is lesser", "up to a maximum amount of $400,000"): cap is that figure as a plain number and capQuote the exact words that print it, with the figure in full. null for both when the row prints no such limit.
- fromDay and maxDays: for a daily benefit, the first paid day and the most days, as printed.
- forWhom: only on a document that names two or more insured people; left out otherwise, and whenever you are not sure. "each_named_insured" when the document itself says this row's figure is for each insured person it names (a column, heading or line such as "Limit per insured person" or "each insured person") and nothing anywhere in the document limits the row, or changes its figure, for some of them: not its label, its section or sub-heading, a footnote, or a note elsewhere (a child, an adult, a senior, an infant, an age group, a policyholder or a spouse, one named person or one life, "half for children"). "some_insured" when anything does.
- conditions: the conditions printed for this row (its footnote, its heading's "due to Accident", its own "only if ..."), each as exact words from this document. Never a condition from another row.
- page and quote: the page and the exact words of the row, with its figure. Copy the words as they appear, including odd spacing or line breaks within a table row. Never shorten with "..." inside a figure.

Copy figures exactly. When a currency is not printed, do not add one. When unsure whether something is a benefit row, include it with pays "words". Never decide what kind of insurance a document is and read it to a pattern: read what each page prints.`;

/** The pages as the model reads them. */
export function renderDocument(doc: { name: string; pages: { page: number; text: string }[] }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<document name="${esc(doc.name)}">\n${doc.pages.map((p) => `<page n="${p.page}">\n${esc(p.text)}\n</page>`).join("\n")}\n</document>`;
}

// ------------------------------------------------------------------ step 2: which cover each benefit section belongs to

/** A benefit section (one document, one heading, one column) and the cover types the household holds. The model proposes
 * which cover a section's rows are paid under; the household sees and can change it on Coverage. */
export type SectionRef = { key: string; document: string; kind: string; product: string | null; section: string | null; column: string | null; examples: string[] };
export type CoverType = { key: string; product: string; cover: string; plan: string | null; riderOf: string | null; holders: string[] };
export type SectionLink = { section: string; cover: string | null; why: string };

export const LINKING_SCHEMA = object({
  links: { type: "array", items: object({ section: { type: "string" }, cover: nullable("string"), why: { type: "string" } }) },
});

export const LINKING_PROMPT = `A household's documents have been read into benefit sections. Each section is one heading (and one table column) of one document. Say which of the household's covers each section's benefits are paid under.

- cover: the key of one cover from <covers>, or null when the section belongs to none of them (a product the household does not hold, a plan column they do not hold, a document about something else).
- Match by what the section is about and the product it belongs to: a group scheme's accident section belongs to the scheme's accident cover, not its life cover; a rider's benefits belong to the rider, not to its basic plan. A column belongs to a cover only when the column is the cover's plan or applies to every plan.
- why: one short sentence, in plain words, that a household member could check.
Every section key appears exactly once.`;

export function renderLinkingInput(sections: SectionRef[], covers: CoverType[]): string {
  return `<covers>\n${covers.map((c) => JSON.stringify({ key: c.key, product: c.product, cover: c.cover, plan: c.plan, riderOf: c.riderOf, heldBy: c.holders })).join("\n")}\n</covers>\n<sections>\n${sections.map((s) => JSON.stringify(s)).join("\n")}\n</sections>`;
}

/** For reading one page again on its own (lib/benefit-table/completeness.ts): which page, and the headings the whole
 * document's reading found, so a row under a heading printed on an earlier page keeps that heading. */
/** For a long document read in parts (lib/benefit-table/service.ts pageParts): which pages this call holds, the page
 * before shown for context only, and the headings and plan columns found so far, so a table that runs on from the page
 * before is read under its own columns. */
export function partReadingNote(pages: number[], total: number, headings: string[], columns: string[] = [], contextPage: number | null = null): string {
  const range = pages.length === 1 ? `page ${pages[0]}` : `pages ${pages[0]} to ${pages[pages.length - 1]}`;
  return `\n\nThis document has ${total} pages and is read in parts; this part is ${range}. List every row of every table on these pages, and fill "document" from what these pages print.` +
    (contextPage != null ? ` Page ${contextPage} is shown only so you can see the headings and plan columns of a table that runs on from it: do not list rows from page ${contextPage}.` : "") +
    (headings.length ? ` Headings found on earlier pages of this document, for "section" when one is still in force here: ${headings.map((h) => JSON.stringify(h)).join(", ")}.` : "") +
    (columns.length ? ` Plan or person columns found on earlier pages, for "column" when a table here runs on under them: ${columns.map((c) => JSON.stringify(c)).join(", ")}.` : "");
}

export function pageReadingNote(page: number, headings: string[]): string {
  return `\n\nList the rows of page ${page} only. The rest of the document was read before; a table on this page may have been skipped, so list every row of every table on it.` +
    (headings.length ? ` Headings found on earlier pages of this document, for "section" when one is still in force here: ${headings.map((h) => JSON.stringify(h)).join(", ")}.` : "");
}

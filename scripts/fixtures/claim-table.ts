/** Made-up benefit-table rows and covers for claim tests (lib/claims/table-benefits.ts). No real household, scheme or
 * insurer: each test says what its rows print. */
import type { Figure, PersonCover, TableRow } from "@/lib/benefit-table/assemble";
import type { ClaimTable } from "@/lib/claims/table-benefits";

export const printed = (amount: number, unit: "lump_sum" | "up_to" | "per_day", currency: string | null = "SGD"): Figure => ({ kind: "printed", amount, currency, unit });

export function tableRow(coverKey: string, product: string, benefit: string, figure: Figure, o: Partial<TableRow> = {}): TableRow {
  const page = o.source?.page ?? 2;
  return { personId: "m", person: "Test Person", coverKey, product, cover: product, plan: null, benefit, section: null, column: null,
    pays: figure.kind === "printed" ? (figure.unit === "per_day" ? "per_day" : figure.unit === "up_to" ? "up_to" : "amount") : "amount",
    figure, fromDay: null, maxDays: null, conditions: [], source: { documentId: "p", document: "schedule.pdf", page, excerpt: `${benefit} ${"amount" in figure ? figure.amount : ""}` },
    baseSource: null, linkWhy: "test", qualifier: null, percent: null, base: null, baseCorrected: false, percentOf: null, capSource: null, ...o } as TableRow;
}

export function personCover(coverKey: string, product: string, documentId = "p"): PersonCover {
  return { person: "Test Person", product, cover: product, plan: null, riderOf: null, policyNumber: null, sumInsured: null, premium: null,
    premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: product,
    source: { documentId, document: "certificate.pdf", page: 1, excerpt: product }, currency: "SGD", personId: "m", coverKey, confirmation: null } as PersonCover;
}

export const claimTable = (rows: TableRow[], covers: PersonCover[]): ClaimTable => ({ rows, covers });

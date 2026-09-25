/**
 * Client-safe helpers for the household bill-review form on
 * app/claims/[id]/page.tsx. Every value is kept as the text the household
 * sees and types -- amounts exactly as printed -- and nothing here converts,
 * sums or otherwise does arithmetic on money. The server validates and
 * parses (lib/claims/evidence/bill-review-validation.ts); the calculators
 * decide any amount.
 */
export const BILL_REVIEW_NOTICE =
  "Reviewing confirms what this document says. It is not a decision on your claim -- the insurer decides every claim.";

export type BillLineDraft = { category: string; description: string; amountText: string; currency: string };
export type BillPaymentDraft = { source: string; amountText: string; currency: string };
export type BillReviewDraft = {
  patientName: string; hospitalName: string; hospitalCountry: string; admissionDate: string; dischargeDate: string;
  admissionType: string; wardType: string; billLineItems: BillLineDraft[]; thirdPartyPayments: BillPaymentDraft[];
};

const SCALARS = ["patientName", "hospitalName", "hospitalCountry", "admissionDate", "dischargeDate", "admissionType", "wardType"] as const;
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The editable starting point: reviewer corrections win over the model's
 * proposal, field by field -- the same precedence the server uses. */
export function billReviewDraftFrom(extracted: Record<string, unknown>, reviewed: Record<string, unknown> | null | undefined): BillReviewDraft {
  const pick = (key: string) => (reviewed && key in reviewed ? reviewed[key] : extracted[key]);
  const rows = (value: unknown) => (Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : []);
  const draft = Object.fromEntries(SCALARS.map((key) => [key, text(pick(key))])) as Omit<BillReviewDraft, "billLineItems" | "thirdPartyPayments">;
  return {
    ...draft,
    billLineItems: rows(pick("billLineItems")).map((row) => ({ category: text(row.category), description: text(row.description), amountText: text(row.amountText), currency: text(row.currency) })),
    thirdPartyPayments: rows(pick("thirdPartyPayments")).map((row) => ({ source: text(row.source), amountText: text(row.amountText), currency: text(row.currency) })),
  };
}

export type BillReviewRequest =
  | { ok: true; body: { familyMemberId: string; claimSessionId: string; confirmTranscription: true; reviewedFields: Record<string, unknown> } }
  | { ok: false; message: string };

/** Builds the POST body for /api/claims/evidence/[id]/medical-bill-review.
 * Refuses without explicit confirmation. Blank scalar fields become null;
 * every amount is sent exactly as typed. */
export function buildBillReviewRequest(args: { draft: BillReviewDraft; familyMemberId: string; claimSessionId: string; confirmed: boolean }): BillReviewRequest {
  if (!args.confirmed) return { ok: false, message: "Tick the box to confirm you have checked these details against the document." };
  const reviewedFields: Record<string, unknown> = {};
  for (const key of SCALARS) reviewedFields[key] = args.draft[key].trim() === "" ? null : args.draft[key];
  reviewedFields.billLineItems = args.draft.billLineItems.map((row) => ({
    category: row.category, description: row.description.trim() === "" ? null : row.description, amountText: row.amountText, currency: row.currency.trim() === "" ? null : row.currency,
  }));
  reviewedFields.thirdPartyPayments = args.draft.thirdPartyPayments.map((row) => ({
    source: row.source, amountText: row.amountText, currency: row.currency.trim() === "" ? null : row.currency,
  }));
  return { ok: true, body: { familyMemberId: args.familyMemberId, claimSessionId: args.claimSessionId, confirmTranscription: true, reviewedFields } };
}

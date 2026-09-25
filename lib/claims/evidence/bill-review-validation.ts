/**
 * Server-side validation for a household member's medical-bill review.
 *
 * A bill review may only confirm or correct facts visibly printed on the
 * bill itself -- never a clinical, cause-of-death or policy-definition
 * field. Every submitted amount is kept EXACTLY as typed (the printed
 * text) and must pass the same deterministic parser
 * (./medical-bill-evidence.ts's parseAmountMinor()) that later turns it into
 * minor units; nothing here does arithmetic or trusts a client number.
 */
import { parseAmountMinor } from "./medical-bill-evidence";
import type { ClaimEvidenceExtractedFields } from "./types";

export const BILL_REVIEW_SCALAR_KEYS = ["patientName", "hospitalName", "hospitalCountry", "admissionDate", "dischargeDate", "admissionType", "wardType"] as const;
export const BILL_REVIEW_LIST_KEYS = ["billLineItems", "thirdPartyPayments"] as const;
const ALLOWED_KEYS = new Set<string>([...BILL_REVIEW_SCALAR_KEYS, ...BILL_REVIEW_LIST_KEYS]);
const DATE_KEYS = new Set<string>(["admissionDate", "dischargeDate"]);
const MAX_TEXT = 300;
const MAX_ROWS = 200;

export type BillReviewValidation =
  | { ok: true; fields: Partial<ClaimEvidenceExtractedFields> }
  | { ok: false; fieldErrors: Record<string, string> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function textOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= MAX_TEXT);
}
function currencyOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[A-Za-z]{3}$/.test(value));
}

export function validateBillReviewFields(input: unknown): BillReviewValidation {
  const fieldErrors: Record<string, string> = {};
  if (!isPlainObject(input)) return { ok: false, fieldErrors: { reviewedFields: "Bill details must be sent as an object." } };
  const fields: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_KEYS.has(key)) { fieldErrors[key] = "This detail cannot be changed in a bill review."; continue; }
    if ((BILL_REVIEW_SCALAR_KEYS as readonly string[]).includes(key)) {
      if (!textOrNull(value)) { fieldErrors[key] = "Enter this as text, or leave it blank."; continue; }
      const text = value === null ? null : value.trim() === "" ? null : value.trim();
      if (text !== null && DATE_KEYS.has(key) && !validIsoDate(text)) { fieldErrors[key] = "Use the date as YYYY-MM-DD."; continue; }
      fields[key] = text;
      continue;
    }
    if (!Array.isArray(value) || value.length > MAX_ROWS) { fieldErrors[key] = "Send a list of rows."; continue; }
    const rows: unknown[] = [];
    value.forEach((row, index) => {
      const at = `${key}.${index}`;
      if (!isPlainObject(row)) { fieldErrors[at] = "Each row must be an object."; return; }
      const expected = key === "billLineItems" ? ["category", "description", "amountText", "currency"] : ["source", "amountText", "currency"];
      for (const rowKey of Object.keys(row)) if (!expected.includes(rowKey)) fieldErrors[`${at}.${rowKey}`] = "This detail cannot be changed in a bill review.";
      const label = key === "billLineItems" ? row.category : row.source;
      const labelKey = key === "billLineItems" ? "category" : "source";
      if (typeof label !== "string" || !label.trim() || label.length > MAX_TEXT) fieldErrors[`${at}.${labelKey}`] = "Enter what this row is for, as printed.";
      if (key === "billLineItems" && !textOrNull(row.description ?? null)) fieldErrors[`${at}.description`] = "Enter the description as text, or leave it blank.";
      if (typeof row.amountText !== "string" || parseAmountMinor(row.amountText) === null) {
        fieldErrors[`${at}.amountText`] = "Enter the amount exactly as printed, for example 1,250.00.";
      }
      if (!currencyOrNull(row.currency ?? null)) fieldErrors[`${at}.currency`] = "Use a three-letter currency code such as SGD, or leave it blank.";
      rows.push(key === "billLineItems"
        ? { category: typeof label === "string" ? label.trim() : "", description: typeof row.description === "string" && row.description.trim() ? row.description.trim() : null, amountText: row.amountText, currency: typeof row.currency === "string" ? row.currency.toUpperCase() : null }
        : { source: typeof label === "string" ? label.trim() : "", amountText: row.amountText, currency: typeof row.currency === "string" ? row.currency.toUpperCase() : null });
    });
    fields[key] = rows;
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, fields: fields as Partial<ClaimEvidenceExtractedFields> };
}

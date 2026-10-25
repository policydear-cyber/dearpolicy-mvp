import { MONEY_SIGN } from "@/lib/format/currency";

/** The household's typed sum insured, read strictly. Only a plain amount is accepted ("250000", "S$250,000", "RM 250,000",
 * "1,500,000.00"); anything with words or letters ("1.5 million", "250k", "abc") is refused rather than guessed, and so
 * is zero, so a typo can never be saved as a different amount. */
export type ParsedAmount = { ok: true; amount: number } | { ok: false; why: string };

export function parseAmount(input: string): ParsedAmount {
  const s = input.trim().replace(new RegExp(String.raw`^${MONEY_SIGN}\s*`, "i"), "");
  if (!s) return { ok: false, why: "Type the amount." };
  if (!/^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$/.test(s))
    return { ok: false, why: "Type the amount in figures only, like 250000 or 250,000." };
  const amount = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return { ok: false, why: "Type the amount in figures only, like 250000 or 250,000." };
  if (amount <= 0) return { ok: false, why: "The amount must be more than 0." };
  return { ok: true, amount };
}

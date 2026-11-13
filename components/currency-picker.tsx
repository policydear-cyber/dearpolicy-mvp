"use client";
import { useState } from "react";
import { isIsoCurrency } from "@/lib/format/currency";

/** Codes offered first, for convenience only: any ISO 4217 code can be entered under "Other". */
export const COMMON_CURRENCIES = ["SGD", "USD", "MYR", "HKD", "AUD", "NZD", "GBP", "EUR", "JPY", "CNY", "THB", "IDR", "PHP", "INR", "KRW", "TWD", "CAD", "CHF"];
const OTHER = "__other";

/** The three-letter ISO 4217 code a person typed, or "" while it is not one. A sign is never read: a bare "$" names no
 * currency, so a person states the code itself. */
export function typedCurrency(text: string): string {
  const code = text.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) && isIsoCurrency(code) ? code : "";
}

/** A currency choice for an amount the person reads from their own document: a short list of common codes, then any
 * other ISO 4217 code typed in (DearPolicy is for any insurer and currency). Calls onChange with "" until a real code is
 * chosen, so the form's own "choose the currency" check holds; nothing is ever chosen for the person. */
export function CurrencyPicker({ value, onChange, placeholder = "Currency", ariaLabel = "Currency" }:
  { value: string; onChange: (code: string) => void; placeholder?: string; ariaLabel?: string }) {
  const common = !value || COMMON_CURRENCIES.includes(value);
  const [other, setOther] = useState(!common);
  const [typed, setTyped] = useState(common ? "" : value);
  const invalid = other && typed.trim().length >= 3 && !typedCurrency(typed);
  return <>
    <select aria-label={ariaLabel} value={other ? OTHER : value} onChange={(e) => {
      if (e.target.value === OTHER) { setOther(true); onChange(typedCurrency(typed)); }
      else { setOther(false); onChange(e.target.value); }
    }}>
      <option value="">{placeholder}</option>
      {COMMON_CURRENCIES.map((c) => <option value={c} key={c}>{c}</option>)}
      <option value={OTHER}>Other…</option>
    </select>
    {other && <input aria-label="Currency code" aria-invalid={invalid || undefined} maxLength={3} size={4} autoCapitalize="characters"
      placeholder="e.g. THB" value={typed} onChange={(e) => { setTyped(e.target.value.toUpperCase()); onChange(typedCurrency(e.target.value)); }} />}
    {invalid && <small role="alert" className="row-error">Enter the 3-letter currency code printed on your document, for example THB or KWD.</small>}
  </>;
}

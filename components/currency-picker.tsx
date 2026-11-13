"use client";
import { useEffect, useId, useState } from "react";
import { isIsoCurrency, statedCurrencyCode } from "@/lib/format/currency";

/** Codes offered first, for convenience only: any ISO 4217 code can be entered under "Other". */
export const COMMON_CURRENCIES = ["SGD", "USD", "MYR", "HKD", "AUD", "NZD", "GBP", "EUR", "JPY", "CNY", "THB", "IDR", "PHP", "INR", "KRW", "TWD", "CAD", "CHF"];
const OTHER = "__other";

/** The three-letter ISO 4217 code a person typed, or "" while it is not one. A sign is never read: a bare "$" names no
 * currency, so a person states the code itself. */
export function typedCurrency(text: string): string {
  const code = text.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) && isIsoCurrency(code) ? code : "";
}

/** The ISO code a stored currency names ("S$" is SGD), or "" when it names none (a bare "$", an unknown code). */
export function storedCurrency(value: string): string {
  const code = statedCurrencyCode(value) ?? "";
  return code && isIsoCurrency(code) ? code : "";
}

/** A currency choice for an amount the person reads from their own document: a short list of common codes, then any
 * other ISO 4217 code typed in (DearPolicy is for any insurer and currency). Calls onChange with "" until a real code is
 * chosen, so the form's own "choose the currency" check holds; nothing is ever chosen for the person. */
export function CurrencyPicker({ value, onChange, placeholder = "Currency", ariaLabel = "Currency" }:
  { value: string; onChange: (code: string) => void; placeholder?: string; ariaLabel?: string }) {
  // A stored value is read the same way as a typed one: "S$" is SGD, a bare "$" or an unknown code is no currency yet.
  const start = storedCurrency(value);
  const common = !start || COMMON_CURRENCIES.includes(start);
  const [other, setOther] = useState(!common || (!!value && !start));
  const [typed, setTyped] = useState(common ? (value && !start ? value : "") : start);
  useEffect(() => { if (value && start !== value) onChange(start); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hintId = useId();
  const text = typed.trim();
  const invalid = other && !!text && !typedCurrency(text) && (text.length >= 3 || /[^A-Za-z]/.test(text));
  return <>
    <select aria-label={ariaLabel} value={other ? OTHER : start} onChange={(e) => {
      if (e.target.value === OTHER) { setOther(true); onChange(typedCurrency(typed)); }
      else { setOther(false); onChange(e.target.value); }
    }}>
      <option value="">{placeholder}</option>
      {COMMON_CURRENCIES.map((c) => <option value={c} key={c}>{c}</option>)}
      <option value={OTHER}>Other…</option>
    </select>
    {other && <input aria-label="Currency code" aria-invalid={invalid || undefined} aria-describedby={invalid ? hintId : undefined} maxLength={3} size={4} autoCapitalize="characters"
      placeholder="e.g. THB" value={typed} onChange={(e) => { setTyped(e.target.value.toUpperCase()); onChange(typedCurrency(e.target.value)); }} />}
    {invalid && <small id={hintId} role="alert" className="row-error">Enter the 3-letter currency code printed on your document, for example THB or KWD.</small>}
  </>;
}

"use client";
import { useEffect, useState, type FormEvent } from "react";
import { customerMessage } from "@/components/customer-text";
import { HOUSEHOLD_CURRENCIES, HOUSEHOLD_CURRENCY_LABELS, NO_HOUSEHOLD_CURRENCY } from "@/lib/documents/household-currency-options";

type HouseholdState = { activeHouseholdId: string | null; activeHouseholdCurrency: string | null; memberships?: Array<{ householdId: string; role: string }> };

/**
 * The policy currency is compulsory (DC 18 Nov 2026). New households choose it at sign-up (app/signup/SignupForm.tsx).
 * A household that has none (made before that, or through an emailed link or a fresh start) is asked here, at the top
 * of every household page, until its owner chooses. It can't be dismissed. Only an owner can choose, as in Account
 * settings, so a member sees nothing. The choice only ever fills amounts a document prints without any currency; a
 * printed currency always comes first (lib/documents/household-currency.ts).
 */
export function HouseholdCurrencyPrompt() {
  const [needed, setNeeded] = useState(false);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/household", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as HouseholdState;
        const owner = data.memberships?.some((m) => m.householdId === data.activeHouseholdId && m.role === "owner");
        if (!cancelled && data.activeHouseholdId && owner && !data.activeHouseholdCurrency) setNeeded(true);
      } catch { /* nothing shown when it can't be read */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!needed) return null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!choice) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/household", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ currency: choice }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(customerMessage(payload.error, "Could not save the currency. Please try again in a moment.")); return; }
      setNeeded(false);
      // The page's own amounts were read before the choice: load it again.
      window.location.reload();
    } catch {
      setError("Could not save the currency. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="alert" aria-labelledby="currency-prompt-title" data-testid="household-currency-prompt">
      <p style={{ margin: 0 }}><strong id="currency-prompt-title">Choose your policy currency</strong></p>
      <p style={{ margin: 0 }}>DearPolicy uses it only for amounts a document prints without a currency. A currency the document prints always comes first. You can change it later in Account settings.</p>
      <form onSubmit={save} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4 }}>
        <select aria-label="Policy currency" value={choice} onChange={(e) => setChoice(e.target.value)} required>
          <option value="" disabled>Choose a currency…</option>
          {[...HOUSEHOLD_CURRENCIES, NO_HOUSEHOLD_CURRENCY].map((code) => <option value={code} key={code}>{HOUSEHOLD_CURRENCY_LABELS[code]}</option>)}
        </select>
        <button className="button primary" type="submit" disabled={!choice || busy}>{busy ? "Saving…" : "Use this currency"}</button>
      </form>
      {error ? <p role="alert" style={{ margin: 0 }}>{error}</p> : null}
    </section>
  );
}

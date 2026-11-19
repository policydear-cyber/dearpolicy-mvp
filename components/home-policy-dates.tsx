"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { PolicyDate } from "@/lib/policies/policy-dates";

/** Home's "Policy dates": when each of the person's policies ends, as its documents print it (lib/policies/policy-dates.ts).
 * A date that has passed asks for proof of renewal, never says the policy ended (DC 19 Nov: a renewal often comes with only
 * a receipt). The household's owner may answer "I didn't renew it" instead (DC 19 Nov), shown as their own statement with
 * Undo. A policy printing no end date says so. Loads on its own, so the cards above never wait for it; shows nothing while
 * loading or if the list cannot be loaded. `onChanged`: an answer moves the policy out of current cover, so Home reloads. */
export function HomePolicyDates({ memberId, onChanged }: { memberId?: string | null; onChanged?: () => void }) {
  const [list, setList] = useState<PolicyDate[] | null>(null);
  const [canAnswer, setCanAnswer] = useState(false);
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const load = useCallback(async (live: () => boolean = () => true) => {
    if (!memberId) return;
    try {
      const r = await fetch(`/api/policies/dates?member=${encodeURIComponent(memberId)}`);
      const p = r.ok ? await r.json() : null;
      if (!live()) return;
      setList(Array.isArray(p?.policies) ? p.policies : []); setCanAnswer(p?.canAnswer === true);
    } catch { if (live()) setList([]); }
  }, [memberId]);
  useEffect(() => { let live = true; setList(null); setError(""); void load(() => live); return () => { live = false; }; }, [load]);
  async function answer(p: PolicyDate, notRenewed: boolean) {
    if (!memberId || !p.endsOn) return;
    setBusy(p.key); setError("");
    try {
      const r = await fetch("/api/policies/dates/not-renewed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ member: memberId, key: p.key, endsOn: p.endsOn, notRenewed }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof body.error === "string" ? body.error : "");
      await load(); onChanged?.();
    } catch (e) { setError(e instanceof Error && e.message ? e.message : "That didn't save. Please try again in a moment."); }
    finally { setBusy(""); }
  }
  if (!list?.length) return null;
  return <section className="home-dates" data-testid="home-policy-dates" aria-labelledby="home-dates-title">
    <h2 id="home-dates-title">Policy dates</h2>
    {error && <p className="home-dates-error" role="alert">{error}</p>}
    <ul>{list.map((p) => <li key={p.key} className={`home-date ${p.state}`} data-state={p.state}>
      <div className="home-date-head"><strong>{p.name}</strong><DateChip p={p} /></div>
      <DateLine p={p} />
      {!!p.sooner.length && p.state !== "renewal_due" && p.state !== "not_renewed" && <small>{p.sooner.length === 1 ? "One cover ends sooner" : "Some covers end sooner"}: {p.sooner.map((s) => `${s.name} ${s.ended ? "ended" : "until"} ${s.endsText}`).join("; ")}.</small>}
      {p.state === "renewal_due" && <div className="home-date-actions">
        <Link href="/policies" className="button secondary">Upload proof of renewal</Link>
        {canAnswer && <button type="button" className="home-date-link" disabled={busy === p.key} onClick={() => void answer(p, true)}>I didn&rsquo;t renew it</button>}
      </div>}
      {p.state === "not_renewed" && canAnswer && <div className="home-date-actions"><button type="button" className="home-date-link" disabled={busy === p.key} onClick={() => void answer(p, false)}>Undo</button></div>}
    </li>)}</ul>
  </section>;
}

function DateChip({ p }: { p: PolicyDate }) {
  if (p.state === "renewal_due") return <span className="home-date-chip warn">Renewed?</span>;
  if (p.state === "renewed") return <span className="home-date-chip good">Renewed</span>;
  if (p.state === "no_date") return <span className="home-date-chip unresolved">End date not printed</span>;
  if (p.state === "not_renewed") return <span className="home-date-chip info">Not renewed</span>;
  return null;
}

function DateLine({ p }: { p: PolicyDate }) {
  if (p.state === "no_date") return null;
  if (p.state === "renewal_due") return <p>Cover was until <b>{p.endsText}</b>, as printed. If you renewed it, upload the receipt, renewal notice or new schedule.</p>;
  if (p.state === "not_renewed") return <p>You said you didn&rsquo;t renew it. Cover was until <b>{p.endsText}</b>, as printed, so it isn&rsquo;t shown as current cover.</p>;
  if (p.state === "renewed") return <p>Cover was until {p.endsText}. Renewed{p.renewal?.paidText ? <>: premium paid <b>{p.renewal.paidText}</b></> : null}{p.renewal?.untilText ? <> · cover until <b>{p.renewal.untilText}</b>, from the receipt</> : null}.</p>;
  const days = p.daysLeft ?? 0;
  return <p>Cover until <b>{p.endsText}</b>{p.state === "ends_soon" ? (days === 0 ? " · ends today" : days === 1 ? " · tomorrow" : ` · in ${days} days`) : null}</p>;
}

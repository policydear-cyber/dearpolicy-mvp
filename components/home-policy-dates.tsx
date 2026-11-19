"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PolicyDate } from "@/lib/policies/policy-dates";

/** Home's "Policy dates": when each of the person's policies ends, as its documents print it (lib/policies/policy-dates.ts).
 * A date that has passed asks for proof of renewal, never says the policy ended (DC 19 Nov: a renewal often comes with only
 * a receipt). A policy printing no end date says so. Loads on its own, so the cards above never wait for it; shows nothing
 * while loading or if the list cannot be loaded. */
export function HomePolicyDates({ memberId }: { memberId?: string | null }) {
  const [list, setList] = useState<PolicyDate[] | null>(null);
  useEffect(() => {
    let live = true; setList(null);
    if (!memberId) return;
    fetch(`/api/policies/dates?member=${encodeURIComponent(memberId)}`).then((r) => r.ok ? r.json() : null)
      .then((p) => { if (live) setList(Array.isArray(p?.policies) ? p.policies : []); }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [memberId]);
  if (!list?.length) return null;
  return <section className="home-dates" data-testid="home-policy-dates" aria-labelledby="home-dates-title">
    <h2 id="home-dates-title">Policy dates</h2>
    <ul>{list.map((p) => <li key={p.key} className={`home-date ${p.state}`} data-state={p.state}>
      <div className="home-date-head"><strong>{p.name}</strong><DateChip p={p} /></div>
      <DateLine p={p} />
      {!!p.sooner.length && p.state !== "renewal_due" && <small>{p.sooner.length === 1 ? "One cover ends sooner" : "Some covers end sooner"}: {p.sooner.map((s) => `${s.name} ${s.ended ? "ended" : "until"} ${s.endsText}`).join("; ")}.</small>}
      {p.state === "renewal_due" && <Link href="/policies" className="button secondary home-date-upload">Upload proof of renewal</Link>}
    </li>)}</ul>
  </section>;
}

function DateChip({ p }: { p: PolicyDate }) {
  if (p.state === "renewal_due") return <span className="home-date-chip warn">Renewed?</span>;
  if (p.state === "renewed") return <span className="home-date-chip good">Renewed</span>;
  if (p.state === "no_date") return <span className="home-date-chip unresolved">End date not printed</span>;
  return null;
}

function DateLine({ p }: { p: PolicyDate }) {
  if (p.state === "no_date") return null;
  if (p.state === "renewal_due") return <p>Cover was until <b>{p.endsText}</b>, as printed. If you renewed it, upload the receipt, renewal notice or new schedule.</p>;
  if (p.state === "renewed") return <p>Cover was until {p.endsText}. Renewed{p.renewal?.paidText ? <>: premium paid <b>{p.renewal.paidText}</b></> : null}{p.renewal?.untilText ? <> · cover until <b>{p.renewal.untilText}</b>, from the receipt</> : null}.</p>;
  const days = p.daysLeft ?? 0;
  return <p>Cover until <b>{p.endsText}</b>{p.state === "ends_soon" ? (days === 0 ? " · ends today" : days === 1 ? " · tomorrow" : ` · in ${days} days`) : null}</p>;
}

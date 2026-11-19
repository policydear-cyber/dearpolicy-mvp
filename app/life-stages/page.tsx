"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatMoney } from "@/lib/format/currency";
import type { LifeStages, LifePolicy, LifeStage, LifeValue } from "@/lib/policies/life-stages";

/** Life stages: one person's policies from now on, as their documents print them (lib/policies/life-stages.ts). A timeline
 * shows each policy to its printed end, when premiums stop and when it matures; a table shows what stays in place at each
 * stage; and each policy's values printed for an age or policy year are listed as printed, a projection always said to be
 * one. Nothing is added up or worked out. Members may view it. */
type Payload = LifeStages & { member: { id: string; name: string | null } | null; error?: string };

const DAY = 86_400_000;
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function LifeStagesContent() {
  const member = useSearchParams().get("member") ?? "";
  const [data, setData] = useState<Payload | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true; setData(null); setFailed(false);
    fetch(`/api/policies/life-stages${member ? `?member=${encodeURIComponent(member)}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: Payload) => { if (live) setData(p); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [member]);
  const name = data?.member?.name ?? "";
  const home = data?.member ? `/?familyMemberId=${encodeURIComponent(data.member.id)}` : "/";
  return <div className="page life-stages">
    <header className="page-header compact"><div>
      <div className="eyebrow">Life stages</div>
      <h1>{name ? `${name}${data?.age != null ? `, age ${data.age}` : ""}` : "Life stages"}</h1>
      <p className="lead">When each policy ends, when premiums stop and what it pays at maturity, as the documents print them.</p>
    </div><div className="hero-actions"><Link href={home} className="button secondary">← Home</Link></div></header>
    {failed ? <div className="alert error" role="alert">DearPolicy couldn&rsquo;t load this page just now. Your documents are safe. Please refresh in a moment.</div>
      : !data ? <section className="section"><div className="empty-card" role="status">Loading life stages…</div></section>
      : !data.member ? <section className="section"><div className="empty-card">This person isn&rsquo;t in your household.</div></section>
      : <Body data={data} />}
  </div>;
}

function Body({ data }: { data: Payload }) {
  const { policies, stages, renewalDue, notRenewed } = data;
  const home = `/?familyMemberId=${encodeURIComponent(data.member!.id)}`;
  const anyDate = policies.some((p) => p.endsOn || p.premiumsEnd || p.matures);
  return <>
    {!!renewalDue.length && <div className="life-note warn" role="status">
      <strong>Renewed?</strong> The printed end date of {listOf(renewalDue)} has passed, so {renewalDue.length === 1 ? "it isn't" : "they aren't"} shown here. <Link href={home}>Answer on Home</Link>
    </div>}
    {!!notRenewed.length && <p className="muted">Not shown: {listOf(notRenewed)}, which the household said wasn&rsquo;t renewed.</p>}
    {data.age == null && !!policies.length && <p className="muted">Add {data.member!.name ? `${data.member!.name}’s` : "a"} date of birth in <Link href="/family">Family</Link> to see ages here.</p>}
    {!policies.length ? <section className="section"><div className="empty-card">{renewalDue.length || notRenewed.length ? <>No other policies to show for {data.member!.name ?? "this person"}.</> : <>No policies on file for {data.member!.name ?? "this person"} yet. <Link href="/policies">Upload a policy schedule</Link> to see its dates here.</>}</div></section> : <>
      <section className="section life-section" aria-labelledby="life-timeline-title">
        <h2 id="life-timeline-title">Timeline</h2>
        {anyDate ? <Timeline policies={policies} age={data.age} /> : <p className="muted">None of these policies prints an end, premium end or maturity date yet.</p>}
      </section>
      <section className="section life-section" aria-labelledby="life-stages-title">
        <h2 id="life-stages-title">At each stage</h2>
        <div className="life-table-wrap"><table className="life-table">
          <thead><tr><th scope="col">Stage</th><th scope="col">Printed cover runs past this point</th><th scope="col">Premiums</th><th scope="col">What changes</th></tr></thead>
          <tbody>{stages.map((s, i) => <tr key={s.from.on}>
            <th scope="row">{stageLabel(s, i)}</th>
            <td data-label="Printed cover runs past this point">{s.inPlace.length ? s.inPlace.join(", ") : "None"}{s.renewedNoEnd.length ? <small>Renewed; new end date not printed: {s.renewedNoEnd.join(", ")}</small> : null}{s.endNotPrinted.length ? <small>End not printed: {s.endNotPrinted.join(", ")}</small> : null}</td>
            <td data-label="Premiums">{s.paying.length ? `Premiums printed until after this point: ${s.paying.join(", ")}` : "No premium end printed after this point"}</td>
            <td data-label="What changes">{s.events.length ? <ul>{s.events.map((e, j) => <li key={j}>{e.policy}: {e.kind === "premiums_end" ? "premiums stop" : e.kind === "matures" ? "matures" : "cover ends, as printed"}</li>)}</ul> : "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
      <section className="section life-section" aria-labelledby="life-policies-title">
        <h2 id="life-policies-title">Each policy</h2>
        <ul className="life-policies">{policies.map((p) => <PolicyCard key={p.key} p={p} />)}</ul>
      </section>
    </>}
  </>;
}

/** A bar per policy from today to its printed end; premiums shown solid until they stop; a policy with no printed end is
 * drawn dashed to the edge, never as ending. The scale runs ten years at least, to the last printed date. */
function Timeline({ policies, age }: { policies: LifePolicy[]; age: number | null }) {
  const now = Date.now();
  const dates = policies.flatMap((p) => [p.endsOn, p.premiumsEnd?.on, p.matures?.on]).filter((d): d is string => !!d).map(dayMs);
  const last = Math.max(now + 10 * 365.25 * DAY, ...dates);
  const pos = (ms: number) => `${Math.min(100, Math.max(0, ((ms - now) / (last - now)) * 100)).toFixed(2)}%`;
  const years = (last - now) / (365.25 * DAY), step = years > 40 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(years / step) + 1 }, (_, i) => i * step);
  return <div className="life-timeline">
    <ul>{policies.map((p) => {
      const end = p.endsOn ? dayMs(p.endsOn) : null, premium = p.premiumsEnd ? dayMs(p.premiumsEnd.on) : null, matures = p.matures ? dayMs(p.matures.on) : null;
      return <li key={p.key}>
        <span className="life-bar-name">{p.name}<small>{endWords(p)}</small></span>
        <span className="life-bar-track" aria-hidden="true">
          <span className={`life-bar${end == null ? " open" : ""}`} style={{ width: end == null ? "100%" : pos(end) }} />
          {premium != null && premium > now && <span className="life-bar paying" style={{ width: pos(Math.min(premium, end ?? premium)) }} />}
          {matures != null && matures > now && <span className="life-mark" style={{ left: pos(matures) }} />}
        </span>
      </li>;
    })}</ul>
    <div className="life-axis" aria-hidden="true">{ticks.map((t) => <span key={t} style={{ left: pos(now + t * 365.25 * DAY) }}>{age != null ? age + t : t === 0 ? "Now" : `+${t} yrs`}</span>)}</div>
    <p className="life-legend"><span className="life-key paying" />Premiums, as printed<span className="life-key" />Cover period, as printed<span className="life-key open" />End not printed<span className="life-key mark" />Matures</p>
  </div>;
}

function PolicyCard({ p }: { p: LifePolicy }) {
  return <li className="life-policy">
    <div className="life-policy-head"><strong>{p.name}</strong>{p.insurer ? <span className="muted">{p.insurer}</span> : null}</div>
    <dl>
      <div><dt>Cover</dt><dd>{endWords(p)}</dd></div>
      <div><dt>Premiums</dt><dd>{p.premiumsEnd ? `Stop ${p.premiumsEnd.onText}${p.premiumsEnd.age != null ? ` (age ${p.premiumsEnd.age})` : ""}` : p.premiumTerm ? `Term as printed: ${p.premiumTerm}` : "End not printed"}</dd></div>
      {p.matures && <div><dt>Matures</dt><dd>{p.matures.onText}{p.matures.age != null ? ` (age ${p.matures.age})` : ""}</dd></div>}
    </dl>
    {!!p.values.length && <div className="life-table-wrap"><table className="life-table values">
      <caption>Values the documents print</caption>
      <thead><tr><th scope="col">At</th><th scope="col">What</th><th scope="col">Amount</th><th scope="col">Source</th></tr></thead>
      <tbody>{p.values.map((v, i) => <tr key={i}><th scope="row">{atWords(v)}</th><td data-label="What">{v.benefit}</td>
        <td data-label="Amount"><b className="life-money">{formatMoney(v.amount, v.currency)}</b><small>{basisWords(v)}</small></td>
        <td data-label="Source">{v.document}, page {v.page}</td></tr>)}</tbody>
    </table></div>}
  </li>;
}

function endWords(p: LifePolicy): string {
  if (!p.endsOn) return p.state === "renewed" ? "Renewed; new end date not printed" : "End not printed";
  return `Until ${p.endsText}${p.endAge != null ? ` (age ${p.endAge})` : ""}${p.state === "renewed" ? ", from the renewal receipt" : ""}`;
}
function stageLabel(s: LifeStage, i: number): string {
  const at = (x: { onText: string; age: number | null }) => (x.age != null ? `${x.onText} (age ${x.age})` : x.onText);
  const from = i === 0 ? "Now" : `From ${at(s.from)}`;
  return s.to ? `${from} to ${at(s.to)}` : i === 0 ? "From now" : from;
}
function atWords(v: LifeValue): string {
  return [v.age != null ? `Age ${v.age}` : null, v.policyYear != null ? `Policy year ${v.policyYear}` : null].filter(Boolean).join(" · ");
}
function basisWords(v: LifeValue): string {
  if (!v.projected) return "As printed";
  const rate = v.rate ? ` at ${v.rate} a year` : "";
  return v.basis === "non_guaranteed" ? `Projected${rate}, not guaranteed` : `From an illustration${rate}: not an amount held or payable`;
}
function listOf(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default function LifeStagesPage() {
  return <Suspense fallback={<div className="page">Loading life stages…</div>}><LifeStagesContent /></Suspense>;
}

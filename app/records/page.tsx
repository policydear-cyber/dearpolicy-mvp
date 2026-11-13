"use client";

import { Icon } from "@/components/icons";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format/currency";
import { premiumRowDetail, premiumSourceCaption } from "@/lib/format/premium-source";
import type { CountedPremium, CountedPremiums } from "@/lib/policies/counted-premiums";

type RecordRow = { id: string; family_member_name: string | null; insurer: string | null; product_name: string | null; policy_number: string | null; amount: string; currency: string; frequency: string | null; payment_date: string | null; period_start: string | null; notes: string | null };
type Person = { id: string; display_name: string; relationship: string; premiums: CountedPremiums };

function money(amount: string, currency: string) { return formatMoney(amount,currency); }
// A premium is shown in its record's currency only when the record states one; premiums in two currencies are never added.
const premiumMoney=(i:CountedPremium,v:number)=>formatMoney(v,i.currencyStated===false?null:i.currency);
const perCurrency=(totals:CountedPremiums["totals"],k:"monthly"|"annual")=>totals.map(t=>formatMoney(t[k],t.currency)).join(" + ");

function PremiumRow({ item, once }: { item: CountedPremium; once?: boolean }) {
  return <div className="premium-breakdown-row"><div className="payment-brand">{(item.insurer??"IN").slice(0,2).toUpperCase()}</div><div><strong>{item.product_name??item.insurer??"Insurance policy"}</strong><span>{premiumRowDetail(item)}</span></div>
    <div className="premium-breakdown-value">{once?<><strong>{premiumMoney(item,item.amount)}</strong><span>paid once</span></>:<><strong>{premiumMoney(item,item.monthly)}<small>/mo</small></strong><span>{premiumMoney(item,item.annual)} / year</span></>}</div></div>;
}

function PersonPremiums({ person }: { person: Person }) {
  const p=person.premiums;
  return <section className="section premium-breakdown-panel">
    <div className="section-heading"><div><h2>{person.display_name}</h2>
      <p className="note premium-cost-line">{p.totals.length?<>{perCurrency(p.totals,"monthly")}/month, about {perCurrency(p.totals,"annual")} a year {premiumSourceCaption(p.items.map(i=>i.source))}. Portfolio shows the same cost.</>:p.items.length?"These premiums are not added up: none of them says which currency it is in.":p.countedElsewhere?.length&&!p.missing.length?"No separate premium: "+person.display_name+"’s cover is paid under another family member’s policy (see the note below).":"No premium found yet."}</p></div></div>
    <div className="premium-breakdown-list">
      {p.items.map(i=><PremiumRow item={i} key={i.id}/>)}
      {p.oneOff.map(i=><PremiumRow item={i} once key={i.id}/>)}
      {!p.items.length&&!p.oneOff.length&&!(p.countedElsewhere?.length&&!p.missing.length)&&<div className="empty-row">Upload a policy schedule, renewal notice or receipt for {person.display_name} on <Link href="/policies" className="text-link">Documents</Link>.</div>}
    </div>
    {p.oneOff.length>0&&<p className="note">A premium paid once, such as a single trip, is listed but not counted in the monthly or yearly cost.</p>}
    {p.note&&<p className="note">{p.note}</p>}
  </section>;
}

export default function RecordsPage() {
  const [records,setRecords] = useState<RecordRow[]|null>(null); const [failed,setFailed] = useState(false);
  const [people,setPeople] = useState<Person[]|null>(null); const [peopleFailed,setPeopleFailed] = useState(false);

  // Nothing is said about payments until they have loaded: "No payments found yet" before the list arrives is wrong.
  useEffect(()=>{
    void fetch("/api/premiums/summary").then((x)=>{ if(!x.ok) throw new Error(); return x.json(); }).then((r)=>setPeople(r.people ?? [])).catch(()=>setPeopleFailed(true));
    void fetch("/api/premiums").then((x)=>{ if(!x.ok) throw new Error(); return x.json(); }).then((r)=>setRecords(r.records ?? [])).catch(()=>setFailed(true));
  },[]);

  return (
    <div className="page">
      <header className="page-header compact"><div><h1><span className="title-icon"><Icon name="payments"/></span>Payments</h1><p className="lead">What each person&apos;s cover costs, from policy schedules, renewal notices, receipts and statements.</p></div></header>
      {/* One place to upload (Documents): a receipt or renewal notice uploaded there is read for its payments too. */}
      <p className="note"><Icon name="upload"/> To add a payment, upload the notice or receipt on <Link href="/policies" className="text-link">Documents</Link>.</p>
      {peopleFailed && <div className="alert error" role="alert">What your cover costs could not be loaded. Please refresh the page in a moment.</div>}
      {!people && !peopleFailed && <div className="empty-card" role="status">Loading what your cover costs…</div>}
      {people?.map((person)=><PersonPremiums person={person} key={person.id}/>)}
      {people && !people.length && <div className="empty-card">Add the people your policies cover in <Link href="/family" className="text-link">Account settings</Link>, then upload their documents. Their premiums are listed here.</div>}
      <section className="section">
        <div className="section-heading"><div><div className="icon-heading"><span className="title-icon"><Icon name="receipt"/></span><h2>Payment records</h2></div><p className="note premium-cost-line">Newest first.</p></div></div>
        <div className="payment-list">
          {failed && <div className="alert error" role="alert">Your payments could not be loaded. Please refresh the page in a moment.</div>}
          {!records && !failed && <div className="empty-card" role="status">Loading your payments…</div>}
          {records?.map((r)=><div className="payment-row" key={r.id}><div className="payment-brand">{(r.insurer??"IN").slice(0,2).toUpperCase()}</div><div className="payment-main"><strong>{r.product_name??r.insurer??"Insurance payment"}</strong><span>{r.family_member_name??"Shared family payment"}{r.policy_number?` · ${r.policy_number}`:""}</span></div><div className="payment-amount"><strong>{money(r.amount,r.currency)}</strong><span>{r.frequency??r.payment_date??r.period_start??"payment record"}</span></div></div>)}
          {records && !records.length && <div className="empty-card">No payment records yet. Upload the latest receipt or renewal notice from an insurer on <Link href="/policies" className="text-link">Documents</Link>.</div>}
        </div>
      </section>
    </div>
  );
}

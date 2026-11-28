"use client";

import { Icon } from "@/components/icons";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format/currency";
import { premiumRowDetail, premiumSourceCaption } from "@/lib/format/premium-source";
import type { CountedPremium, CountedPremiums } from "@/lib/policies/counted-premiums";
import { shownInsurer } from "@/lib/policies/insurer-name";

type RecordRow = { id: string; family_member_name: string | null; insurer: string | null; product_name: string | null; policy_number: string | null; amount: string; currency: string; frequency: string | null; payment_date: string | null; period_start: string | null; notes: string | null };
type Person = { id: string; display_name: string; relationship: string; premiums: CountedPremiums };

function money(amount: string, currency: string) { return formatMoney(amount,currency); }
// A premium is shown in its record's currency only when the record states one; premiums in two currencies are never added.
const premiumMoney=(i:CountedPremium,v:number)=>formatMoney(v,i.currencyStated===false?null:i.currency);

function PremiumRow({ item, once }: { item: CountedPremium; once?: boolean }) {
  return <div className="premium-breakdown-row"><div className="payment-brand">{(shownInsurer(item.insurer)??"IN").slice(0,2).toUpperCase()}</div><div><strong>{item.product_name??shownInsurer(item.insurer)??"Insurance policy"}</strong><span>{premiumRowDetail(item)}</span></div>
    <div className="premium-breakdown-value">{once?<><strong>{premiumMoney(item,item.amount)}</strong><span>paid once</span></>:<><strong>{premiumMoney(item,item.monthly)}<small>/mo</small></strong><span>{premiumMoney(item,item.annual)} / year</span></>}</div></div>;
}

// A premium paid monthly gives an exact monthly figure; one paid yearly, quarterly or half-yearly gives its year's
// premium spread over 12 months, and the total says so rather than present an average as a bill.
const paidMonthly=(i:CountedPremium)=>Math.abs(i.annual-i.total*12)<0.005;

/** Each person's total, the first thing under their name: per month and per year, one line per stated currency (premiums
 * in two currencies are never added), and "so far" while a policy's premium is still missing. */
function PersonTotal({ p }: { p: CountedPremiums }) {
  const counted=p.items.filter(i=>i.currencyStated!==false), spread=counted.some(i=>!paidMonthly(i));
  const n=counted.length, label=p.complete?"Total":"Total so far";
  return <div className="premium-person-total">
    <div className="premium-person-figures">
      <div><small>{label} each month</small>{p.totals.map(t=><strong key={t.currency}>{formatMoney(t.monthly,t.currency)}</strong>)}</div>
      <div><small>{label} each year</small>{p.totals.map(t=><strong key={t.currency}>{formatMoney(t.annual,t.currency)}</strong>)}</div>
    </div>
    <p>{n===1?"One premium":`${n} premiums`} {premiumSourceCaption(counted.map(i=>i.source))}.{p.totals.length>1?" Each currency is totalled separately.":""}{spread?" Premiums paid yearly, half-yearly or quarterly are spread over 12 months in the monthly figure.":""}</p>
  </div>;
}

function PersonPremiums({ person }: { person: Person }) {
  const p=person.premiums;
  return <section className="section premium-breakdown-panel">
    <div className="section-heading"><div><h2>{person.display_name}</h2>
      {!p.totals.length&&<p className="note premium-cost-line">{p.items.length?"These premiums are not added up: none of them says which currency it is in.":p.countedElsewhere?.length&&!p.missing.length?"No separate premium: "+person.display_name+"’s cover is paid under another family member’s policy (see the note below).":p.oneOff.length?"No monthly or yearly total: "+(p.oneOff.length===1?"the premium below is":"the premiums below are")+" paid once.":p.note?"No monthly or yearly total yet. The note below says why.":"No premium found yet."}</p>}</div></div>
    {p.totals.length>0&&<PersonTotal p={p}/>}
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
  // The premiums are added up on the server, which takes longer for a household with many documents: after a few seconds the
  // page says it is still working, so a long wait never looks frozen (Live tester 28 Nov: a blank wait of 14 seconds).
  const [slow,setSlow] = useState(false);
  useEffect(()=>{ const t=setTimeout(()=>setSlow(true),4000); return ()=>clearTimeout(t); },[]);

  // Nothing is said about payments until they have loaded: "No payments found yet" before the list arrives is wrong.
  useEffect(()=>{
    void fetch("/api/premiums/summary",typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?{signal:AbortSignal.timeout(20000)}:undefined).then((x)=>{ if(!x.ok) throw new Error(); return x.json(); }).then((r)=>setPeople(r.people ?? [])).catch(()=>setPeopleFailed(true));
    void fetch("/api/premiums").then((x)=>{ if(!x.ok) throw new Error(); return x.json(); }).then((r)=>setRecords(r.records ?? [])).catch(()=>setFailed(true));
  },[]);

  return (
    <div className="page">
      <header className="page-header compact"><div><h1><span className="title-icon"><Icon name="payments"/></span>Premiums</h1><p className="lead">What each person&apos;s cover costs, from policy schedules, renewal notices, receipts and statements.</p></div></header>
      {peopleFailed && <div className="alert error" role="alert">What your cover costs could not be loaded. Please refresh the page in a moment.</div>}
      {!people && !peopleFailed && <div className="empty-card" role="status">Loading what your cover costs…{slow?" Still working: a household with many documents takes longer.":""}</div>}
      {people?.map((person)=><PersonPremiums person={person} key={person.id}/>)}
      {people && !people.length && <div className="empty-card">Add the people your policies cover in <Link href="/family" className="text-link">Account settings</Link>, then upload their documents. Their premiums are listed here.</div>}
      {/* Payment records wait until the premiums above have loaded (or failed): they arrive after the page does and would push this section down (Live tester, 26 Nov: layout shift 0.48 on Records). */}
      {(people||peopleFailed)&&<section className="section">
        <div className="section-heading"><div><div className="icon-heading"><span className="title-icon"><Icon name="receipt"/></span><h2>Payment records</h2></div></div></div>
        <div className="payment-list">
          {failed && <div className="alert error" role="alert">Your payments could not be loaded. Please refresh the page in a moment.</div>}
          {!records && !failed && <div className="empty-card" role="status">Loading your payments…</div>}
          {records?.map((r)=><div className="payment-row" key={r.id}><div className="payment-brand">{(shownInsurer(r.insurer)??"IN").slice(0,2).toUpperCase()}</div><div className="payment-main"><strong>{r.product_name??shownInsurer(r.insurer)??"Insurance payment"}</strong><span>{r.family_member_name??"Shared family payment"}{r.policy_number?` · ${r.policy_number}`:""}</span></div><div className="payment-amount"><strong>{money(r.amount,r.currency)}</strong><span>{r.frequency??r.payment_date??r.period_start??"payment record"}</span></div></div>)}
          {records && !records.length && <div className="empty-card">No payment records yet. Upload the latest receipt or renewal notice from an insurer on <Link href="/policies" className="text-link">Documents</Link>.</div>}
        </div>
      </section>}
    </div>
  );
}

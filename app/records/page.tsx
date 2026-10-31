"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format/currency";

type RecordRow = { id: string; family_member_name: string | null; insurer: string | null; product_name: string | null; policy_number: string | null; amount: string; currency: string; frequency: string | null; payment_date: string | null; period_start: string | null; notes: string | null };

function money(amount: string, currency: string) { return formatMoney(amount,currency); }

export default function RecordsPage() {
  const [records,setRecords] = useState<RecordRow[]|null>(null); const [failed,setFailed] = useState(false);

  // Nothing is said about payments until they have loaded: "No payments found yet" before the list arrives is wrong.
  useEffect(()=>{ void fetch("/api/premiums").then((x)=>{ if(!x.ok) throw new Error(); return x.json(); }).then((r)=>setRecords(r.records ?? [])).catch(()=>setFailed(true)); },[]);

  return (
    <div className="page">
      <header className="page-header compact"><div><div className="eyebrow">PREMIUM RECORDS</div><h1>Know what your family is paying.</h1><p className="lead">The premiums DearPolicy found in your renewal notices, receipts and statements. The latest one for each policy is used to estimate what your cover costs each month and year.</p></div></header>
      {/* One place to upload (Documents): a receipt or renewal notice uploaded there is read for its payments too. */}
      <p className="note">To add a payment, upload the premium notice, renewal notice or receipt on <Link href="/policies" className="text-link">Documents</Link>. DearPolicy finds the amount and lists it here.</p>
      <section className="section">
        <div className="section-heading"><div><div className="eyebrow">HISTORY</div><h2>Payments found</h2></div></div>
        <div className="payment-list">
          {failed && <div className="alert error" role="alert">Your payments could not be loaded. Please refresh the page in a moment.</div>}
          {!records && !failed && <div className="empty-card" role="status">Loading your payments…</div>}
          {records?.map((r)=><div className="payment-row" key={r.id}><div className="payment-brand">{(r.insurer??"IN").slice(0,2).toUpperCase()}</div><div className="payment-main"><strong>{r.product_name??r.insurer??"Insurance payment"}</strong><span>{r.family_member_name??"Shared / family payment"}{r.policy_number?` · ${r.policy_number}`:""}</span></div><div className="payment-amount"><strong>{money(r.amount,r.currency)}</strong><span>{r.frequency??r.payment_date??r.period_start??"payment record"}</span></div></div>)}
          {records && !records.length && <div className="empty-card">No payments found yet. Upload the latest receipt or renewal notice from an insurer on <Link href="/policies" className="text-link">Documents</Link>.</div>}
        </div>
      </section>
    </div>
  );
}

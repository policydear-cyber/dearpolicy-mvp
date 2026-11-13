"use client";
import { AccountTabs } from "@/components/account-tabs";
import { useEffect,useState } from "react";

/** Plan usage, for a household: how much of this month's plan has been used.
 *
 * V1.1: no models, tokens, provider prices, routing or spending limits here
 * -- that operational view (by operation and model, against the owner's
 * provider budget) is in the operator area (/operator). This page is the
 * Plan usage tab of Account settings. */
/** "2026-10" -> "October 2026". */
function monthLabel(month:string){const m=/^(\d{4})-(\d{2})$/.exec(month);return m?new Date(Date.UTC(+m[1],+m[2]-1,1)).toLocaleDateString("en-SG",{month:"long",year:"numeric",timeZone:"UTC"}):month;}
type Usage={month:string;chatTurns:number;documentsRead:number;plan:{name:string;includedChatTurns:number;includedDocuments:number}};

function Meter({label,used,included,testId}:{label:string;used:number;included:number;testId:string}){
  const pct=included>0?Math.min(100,Math.round(used/included*100)):0;
  return <div className="plan-meter" data-testid={testId}>
    <div className="plan-meter-head"><strong>{label}</strong><span>{used} of {included} included</span></div>
    <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={included} aria-valuenow={Math.min(used,included)} aria-label={label}><div className="progress-fill" style={{width:Math.max(used?2:0,pct)+"%"}}/></div>
  </div>;
}

export default function PlanUsagePage(){
  const [usage,setUsage]=useState<Usage|null>(null);const [error,setError]=useState(false);
  useEffect(()=>{void fetch("/api/usage",{cache:"no-store"}).then(async r=>{const p=await r.json().catch(()=>({}));if(!r.ok||p.error||!p.usage)throw new Error("load");setUsage(p.usage);}).catch(()=>setError(true));},[]);
  const plan=usage?.plan;
  return <div className="page">
    <header className="page-header compact"><div><h1>Account settings</h1></div></header>
    <AccountTabs />
    <div className="section-heading"><div><h2>Plan usage this month</h2><p>How much of your plan your household has used this month. Answers from documents DearPolicy has already read are always available.</p></div></div>
    {error&&<div className="alert error" role="alert"><strong>Your plan usage couldn&rsquo;t be loaded.</strong><span> Refresh the page in a moment.</span></div>}
    {usage&&plan&&<section className="section">
      <div className="section-heading"><div><div className="eyebrow">{monthLabel(usage.month)}</div><h3>{plan.name} plan</h3></div></div>
      <Meter label="Questions asked" used={usage.chatTurns} included={plan.includedChatTurns} testId="plan-questions" />
      <Meter label="Documents read" used={usage.documentsRead} included={plan.includedDocuments} testId="plan-documents" />
    </section>}
  </div>;
}

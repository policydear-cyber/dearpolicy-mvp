"use client";
import { useEffect,useState } from "react";

/** What this household costs to run, this month, against its plan.
 *
 * A subscription price is a bet on this number. The page shows the bet being
 * checked: tokens and dollars per job, questions and documents against the
 * plan's allowance, and which model is doing which job. */
type Role={role:string;calls:number;inputTokens:number;outputTokens:number;costUsd:number};
type Usage={month:string;calls:number;inputTokens:number;outputTokens:number;costUsd:number;unpricedCalls:number;byRole:Role[];
  chatTurns:number;documentsRead:number;plan:{name:string;priceUsd:number;includedChatTurns:number;includedDocuments:number;hardStopUsd:number};warnings:string[]};
type Routing={role:string;model:string;hosted:boolean;price:string};
const ROLE_COPY:Record<string,string>={reading:"Reading documents",judgement:"Understanding questions and deciding what applies",narration:"Wording the answer",chat:"Chat (unrouted)"};
const money=(v:number)=>"$"+v.toFixed(v<0.1?4:2);
export default function UsagePage(){
  const [usage,setUsage]=useState<Usage|null>(null);const [routing,setRouting]=useState<Routing[]>([]);const [error,setError]=useState("");
  useEffect(()=>{void fetch("/api/usage").then(r=>r.json()).then(p=>{if(p.error)throw new Error(p.error);setUsage(p.usage);setRouting(p.routing??[]);}).catch(e=>setError(e.message));},[]);
  const plan=usage?.plan;
  const pct=(n:number,d:number)=>Math.min(100,Math.round(n/Math.max(1,d)*100));
  return <div className="page">
    <header className="page-header compact"><div><div className="eyebrow">USAGE & COST</div><h1>What this household costs to run.</h1><p className="lead">Every model call is counted — hosted or local — so the plan price is checked against real numbers, not a guess. Local calls cost nothing but are counted as what a hosted bill would be.</p></div></header>
    {error&&<div className="alert error"><strong>Usage could not be loaded.</strong><span>Please try refreshing in a moment — if this keeps happening, contact support.</span></div>}
    {usage&&plan&&<>
      {!!usage.warnings.length&&<div className="usage-warnings">{usage.warnings.map((w,i)=><p key={i}>{w}</p>)}</div>}
      <section className="schedule-summary">
        <div><strong>{money(usage.costUsd)}</strong><span>model cost, {usage.month}</span></div>
        <div><strong>{money(plan.priceUsd)}</strong><span>{plan.name} plan, per month</span></div>
        <div className={usage.chatTurns>=plan.includedChatTurns?"warn":""}><strong>{usage.chatTurns}<small> / {plan.includedChatTurns}</small></strong><span>questions this month</span></div>
        <div className={usage.documentsRead>=plan.includedDocuments?"warn":""}><strong>{usage.documentsRead}<small> / {plan.includedDocuments}</small></strong><span>documents read this month</span></div>
      </section>
      <section className="section"><div className="section-heading"><div><div className="eyebrow">AGAINST THE PLAN</div><h2>Where the money goes</h2></div><small>Hard stop at {money(plan.hardStopUsd)} — {pct(usage.costUsd,plan.hardStopUsd)}% used</small></div>
        <div className="progress-track"><div className="progress-fill" style={{width:pct(usage.costUsd,plan.hardStopUsd)+"%"}}/></div>
        <div className="schedule-table-scroll"><table className="schedule-table"><thead><tr><th>Job</th><th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr></thead><tbody>
          {usage.byRole.map(r=><tr key={r.role}><td><strong>{ROLE_COPY[r.role]??r.role}</strong></td><td>{r.calls}</td><td>{r.inputTokens.toLocaleString()}</td><td>{r.outputTokens.toLocaleString()}</td><td className="pays-cell">{money(r.costUsd)}</td></tr>)}
          {!usage.byRole.length&&<tr><td colSpan={5}><em>No model calls yet this month.</em></td></tr>}
        </tbody></table></div>
      </section>
      <section className="section"><div className="section-heading"><div><div className="eyebrow">WHICH MODEL DOES WHAT</div><h2>Routing</h2></div><small>Which model handles each job, and what it costs</small></div>
        <div className="schedule-table-scroll"><table className="schedule-table"><thead><tr><th>Job</th><th>Model</th><th>Where</th><th>List price</th></tr></thead><tbody>
          {routing.map(r=><tr key={r.role}><td><strong>{ROLE_COPY[r.role]??r.role}</strong></td><td>{r.model}</td><td>{r.hosted?"Hosted":"This computer"}</td><td>{r.price}</td></tr>)}
        </tbody></table></div>
        <p className="unclaimed-lead" style={{marginTop:10}}>Rule of thumb from the numbers above: reading is a one-off per document, questions are a few thousand tokens each. A typical household costs well under a dollar a month on hosted models when reading goes to the cheap tier and only the judgement goes to the mid tier.</p>
      </section>
    </>}
  </div>;
}

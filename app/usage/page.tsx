"use client";
import { AccountTabs } from "@/components/account-tabs";
import { customerError } from "@/components/customer-text";
import { Icon } from "@/components/icons";
import { PlanCards } from "@/components/plan-cards";
import { PLANS, documentsLabel, formatSgd, questionsResetLabel, type BillingInterval, type Plan, type PlanId } from "@/lib/plans/catalogue";
import { checkoutAddress,subscriptionAddress } from "@/components/plan-actions";
import { useEffect,useState } from "react";

/** Plan usage, for a household: which plan it is on (Free, Plus or Family; lib/plans/catalogue.ts), what counts against
 * it, and how to upgrade.
 *
 * V1.1: no models, tokens, provider prices, routing or spending limits here -- that operational view (by operation and
 * model, against the owner's provider budget) is in the operator area (/operator). This page is the Plan usage tab of
 * Account settings. Only the household's owner can upgrade or manage billing (members view and ask; DC, 18 Nov). */
type Subscription={plan:Plan;status:string|null;interval:BillingInterval|null;currentPeriodEnd:string|null;hasBillingAccount:boolean;
  documentsKept:number;questionsThisMonth:number;limitsEnforced:boolean;billingEnabled:boolean;isOwner:boolean};

function Meter({label,used,included,detail,over,testId}:{label:string;used:number;included:number|null;detail?:string;over?:string;testId:string}){
  const pct=included&&included>0?Math.min(100,Math.round(used/included*100)):0;
  // More than the plan includes (a plan that was changed, or limits not enforced for this household): "15 of 5" reads
  // like a mistake, so say it in words and say what is still true.
  const beyond=included!=null&&used>included;
  return <div className="plan-meter" data-testid={testId}>
    <div className="plan-meter-head"><strong>{label}</strong><span>{included==null?`${used} kept`:beyond?`${used}, ${included} included`:`${used} of ${included}`}</span></div>
    {included!=null?<div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={included} aria-valuenow={Math.min(used,included)} aria-valuetext={beyond?`${used}, ${included} included`:undefined} aria-label={label}><div className="progress-fill" style={{width:Math.max(used?2:0,pct)+"%"}}/></div>:null}
    {beyond&&over?<small data-testid={testId+"-over"}>{over}</small>:null}
    {detail?<small>{detail}</small>:null}
  </div>;
}

const OPEN_FAILED="The payment page couldn\u2019t open just now. Nothing was charged. Please try again shortly.";

function dateLabel(iso:string|null){
  if(!iso)return null;const d=new Date(iso);if(Number.isNaN(d.getTime()))return null;
  return d.toLocaleDateString("en-SG",{day:"numeric",month:"long",year:"numeric"});
}

export default function PlanUsagePage(){
  const [sub,setSub]=useState<Subscription|null>(null);const [error,setError]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);const [actionError,setActionError]=useState("");
  const [upgraded,setUpgraded]=useState(false);
  useEffect(()=>{
    setUpgraded(new URLSearchParams(window.location.search).get("upgraded")==="1");
    void fetch("/api/usage",{cache:"no-store"}).then(async r=>{const p=await r.json().catch(()=>({}));if(!r.ok||p.error||!p.subscription)throw new Error("load");setSub(p.subscription);}).catch(()=>setError(true));
  },[]);

  async function open(address:()=>Promise<string>,key:string){
    setBusy(key);setActionError("");
    try{window.location.assign(await address());}
    catch(e){setActionError(customerError(e,OPEN_FAILED));setBusy(null);}
  }

  const plan=sub?.plan;
  const current:PlanId|null=plan?.id??null;
  const paid=!!plan&&plan.id!=="free";
  const renews=dateLabel(sub?.currentPeriodEnd??null);
  const action=(card:Plan,interval:BillingInterval)=>{
    if(!sub)return null;
    if(card.id===current)return <small>Your household&rsquo;s plan.</small>;
    if(card.id==="free")return paid?<small>Cancel in Manage subscription to move to Free.</small>:null;
    if(!sub.billingEnabled)return <small>Upgrades open soon.</small>;
    if(!sub.isOwner)return <small>The household&rsquo;s owner can upgrade.</small>;
    if(paid)return <small>Change plan in Manage subscription.</small>;
    const key=card.id+"-"+interval;
    return <button type="button" className={"button"+(card.id==="plus"?" primary":"")} disabled={busy!==null} onClick={()=>void open(()=>checkoutAddress(card.id as "plus"|"family",interval),key)} data-testid={"upgrade-"+card.id}>
      {busy===key?"Opening…":`Upgrade to ${card.name}`}</button>;
  };

  return <div className="page">
    <header className="page-header compact"><div><h1><span className="title-icon"><Icon name="family"/></span>Account settings</h1></div></header>
    <AccountTabs />
    <div className="section-heading"><div><h2>Your plan</h2><p>What your household&rsquo;s plan includes and how much of it is used. Answers you already have stay here on every plan.</p></div></div>
    {error&&<div className="alert error" role="alert"><strong>Your plan couldn&rsquo;t be loaded.</strong><span> Refresh the page in a moment.</span></div>}
    {upgraded&&<div className="alert" role="status" data-testid="plan-upgraded"><strong>Thank you.</strong><span> Your new plan shows here within a minute. Refresh the page if it hasn&rsquo;t changed yet.</span></div>}
    {sub&&plan&&<section className="section" data-testid="plan-current">
      <div className="section-heading"><div>
        <div className="eyebrow">{plan.id==="free"?formatSgd(0):sub.interval==="year"?`${formatSgd(plan.priceYearlySgd)} a year`:`${formatSgd(plan.priceMonthlySgd)} a month`}</div>
        <h3>{plan.name} plan</h3>
        {paid&&renews?<p>{sub.status==="past_due"?`Your last payment didn’t go through. Update your card in Manage subscription to keep ${plan.name}.`:`Paid up to ${renews}.`}</p>:null}
      </div>
      {sub.isOwner&&sub.billingEnabled&&sub.hasBillingAccount?<button type="button" className="button" disabled={busy!==null} onClick={()=>void open(subscriptionAddress,"portal")} data-testid="manage-subscription">{busy==="portal"?"Opening…":"Manage subscription"}</button>:null}
      </div>
      <Meter label="Documents" used={sub.documentsKept} included={plan.unlimitedDocuments?null:plan.documents} testId="plan-documents"
        over={`That is more than the ${plan.name} plan includes. Your documents and earlier answers are still here.`}
        detail={plan.unlimitedDocuments?`${documentsLabel(plan)}, within fair use of ${plan.documents}.`:"Documents DearPolicy couldn’t read, and older copies you replaced, don’t count."}/>
      <Meter label="Questions this month" used={sub.questionsThisMonth} included={plan.questionsPerMonth} testId="plan-questions"
        over={`That is more than the ${plan.name} plan includes. Your earlier answers are still here.`}
        detail={`Questions start again on ${questionsResetLabel()}.`}/>
      <p>Everyone in your family is included on every plan.</p>
    </section>}
    {actionError&&<div className="alert error" role="alert"><strong>Not opened.</strong><span> {actionError}</span></div>}
    {sub&&<section className="section" aria-labelledby="plans-title">
      <div className="section-heading"><div><h3 id="plans-title">Plans</h3>
        {sub.billingEnabled?<p>{PLANS.plus.name} and {PLANS.family.name} are paid through Stripe&rsquo;s secure page. DearPolicy never sees your card.</p>:<p>{PLANS.plus.name} and {PLANS.family.name} are not open for purchase yet.</p>}</div></div>
      <PlanCards current={current} action={action} headingLevel="h4"/>
    </section>}
  </div>;
}

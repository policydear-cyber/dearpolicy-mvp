"use client";

import Link from "next/link";
import { useEffect,useMemo,useState } from "react";
import { customerError } from "@/components/customer-text";

/** Benefits: what the household's documents say each policy pays.
 *
 * V1.1: this page shows what the documents establish, each with its source
 * (collapsed), and says plainly when an amount could not be established.
 * Households are never asked to confirm a table heading, fix a row or re-read
 * a document -- that review lives in the operator area
 * (/operator/benefits). The one question asked here is the one only the
 * document's owner can answer: an amount the document itself does not make
 * readable. */
type Benefit={
  id:string;policyId:string;productName:string|null;benefitName:string;
  formulaKind:"none"|"sum_insured"|"fixed"|"expense_cap"|"daily";formulaValue:number|null;
  currency:string|null;factKey:string|null;offsetDays:number|null;maximumDays:number|null;
  pays:string;sourcePage:number|null;quote:string;conditions:string[];
  needsConfirmation:boolean;attention:"confirm"|"unreadable"|null;
  calculatedAgainst:{owner:string;plan:string|null;amount:string|null}[];
  documentName:string;insurer:string|null;owners:string[];
};
type Condition={id:string;policyId:string;documentName:string;cover:string|null;kind:string;description:string;effect:string;sourcePage:number|null;quote:string};
type Member={id:string;display_name:string;relationship:string};

/** What the page can say about an amount: established (with the document's
 * own wording), or honestly not established. */
function paysLine(b:Benefit):{text:string;established:boolean}{
  if(b.attention==="unreadable")return {text:`The amount on ${b.sourcePage?`page ${b.sourcePage}`:"the page"} could not be read.`,established:false};
  if(b.attention==="confirm"||b.needsConfirmation)return {text:"Described in the document. The amount has not been verified against the page yet, so it is not used in answers.",established:false};
  if(b.formulaKind==="none")return {text:b.pays||"As stated in the document.",established:true};
  return {text:b.pays,established:true};
}
/** Only an unreadable, simple amount can be answered by the household. */
const CLARIFIABLE=new Set<Benefit["formulaKind"]>(["fixed","expense_cap","daily"]);

export default function BenefitsPage(){
  const [benefits,setBenefits]=useState<Benefit[]>([]);
  const [conditions,setConditions]=useState<Condition[]>([]);
  const [family,setFamily]=useState<Member[]>([]);
  const [memberId,setMemberId]=useState("");
  const [search,setSearch]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(false);
  const [stillReading,setStillReading]=useState(false);
  /** Unread documents that did not get read after a while of waiting: shown
   * with a "Try again" that reads them now, instead of "still being read"
   * forever. */
  const [readStalled,setReadStalled]=useState(false);
  const [retrying,setRetrying]=useState(false);
  const [status,setStatus]=useState("");

  async function load(member=memberId){
    setLoading(true);
    try{
      const query=member?`?familyMemberId=${encodeURIComponent(member)}`:"";
      const response=await fetch(`/api/benefits${query}`,{cache:"no-store"});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||payload.error)throw new Error("load");
      setBenefits(payload.benefits??[]);setConditions(payload.conditions??[]);setError(false);
    }catch{setError(true);}
    finally{setLoading(false);}
  }
  useEffect(()=>{
    void load("");
    void fetch("/api/family").then(r=>r.json()).then(p=>setFamily(p.family??[])).catch(()=>setFamily([]));
    void checkUnread();
  },[]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only whether anything is still being read -- never which reader or how many.
  async function checkUnread():Promise<boolean>{
    try{
      const p=await fetch("/api/benefits/index",{cache:"no-store"}).then(r=>r.json());
      const unread=Array.isArray(p.unread)&&p.unread.length>0;
      setStillReading(unread);if(!unread)setReadStalled(false);
      return unread;
    }catch{setStillReading(false);return false;}
  }
  // While something is unread, check again every few seconds; after about a
  // minute with no change, stop waiting and offer "Try again".
  useEffect(()=>{
    if(!stillReading||readStalled||retrying)return;
    let checks=0;
    const id=setInterval(()=>{void checkUnread().then(unread=>{if(!unread){clearInterval(id);void load();}else if(++checks>=10){clearInterval(id);setReadStalled(true);}});},6000);
    return ()=>clearInterval(id);
  },[stillReading,readStalled,retrying]); // eslint-disable-line react-hooks/exhaustive-deps
  async function retryReading(){
    setRetrying(true);setReadStalled(false);
    try{
      // One document per request; stop when nothing is left or a read makes no progress.
      let last=Infinity;
      for(let i=0;i<20;i++){
        const response=await fetch("/api/benefits/index",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
        const p=await response.json().catch(()=>({}));
        if(!response.ok||p.done||typeof p.remaining!=="number"||p.remaining>=last)break;
        last=p.remaining;
      }
    }catch{/* reported below by what is still unread */}
    const unread=await checkUnread();
    await load();
    setReadStalled(unread);setRetrying(false);
  }

  const visible=useMemo(()=>{
    const needle=search.trim().toLowerCase();
    return benefits.filter(b=>!needle||[b.benefitName,b.productName??"",b.documentName,b.insurer??""].join(" ").toLowerCase().includes(needle));
  },[benefits,search]);
  const groups=useMemo(()=>{
    const map=new Map<string,Benefit[]>();
    for(const benefit of visible){const key=benefit.productName??benefit.documentName;map.set(key,[...(map.get(key)??[]),benefit]);}
    return [...map.entries()];
  },[visible]);

  return <div className="page schedule-page">
    <header className="page-header compact"><div>
      <div className="eyebrow">BENEFITS</div>
      <h1>What your policies pay.</h1>
      <p className="lead">Organised by policy: each benefit as the document states it, with the page it comes from, and the exclusions and limits that apply. Where a document does not make an amount clear, this page says so instead of guessing.</p>
      <p className="muted">Want to see what one person is covered for across all their plans? <Link className="text-link" href="/ledger">See Coverage, by person →</Link></p>
    </div></header>

    {error&&<div className="alert error" role="alert"><strong>Your benefits could not be loaded.</strong><span> Please refresh the page in a moment.</span></div>}
    {stillReading&&(readStalled&&!retrying
      ?<div className="unread-documents stalled" role="status"><div><strong>Some documents couldn&rsquo;t be read for this page yet.</strong><span>Their benefits are missing below. You can still ask about them in Ask DearPolicy.</span></div><button type="button" className="button secondary compact" onClick={()=>void retryReading()}>Try again</button></div>
      :<div className="unread-documents" role="status"><div><strong>{retrying?"Reading your documents again…":"Some of your documents are still being read."}</strong><span>Their benefits will appear here when they are ready.</span></div></div>)}

    <section className="schedule-controls">
      <div className="field"><label htmlFor="schedule-person">Person</label>
        <select id="schedule-person" value={memberId} onChange={e=>{setMemberId(e.target.value);void load(e.target.value);}}>
          <option value="">Everyone in the household</option>
          {family.map(m=><option value={m.id} key={m.id}>{m.display_name}</option>)}
        </select></div>
      <div className="field"><label htmlFor="schedule-search">Find a benefit</label>
        <input id="schedule-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Fracture, hospital cash, dental…" /></div>
    </section>

    {status&&<div className="schedule-status" role="status">{status}</div>}

    {loading?<div className="empty-card">Loading your benefits…</div>
      :!benefits.length?<div className="empty-card">{stillReading?"Your documents are still being read. You can already ask a question in Ask DearPolicy.":<>No benefits yet. Upload a policy document or benefit summary and DearPolicy reads it for you. <Link className="text-link" href="/policies">Upload documents →</Link></>}</div>
      :!visible.length?<div className="empty-card">No benefit matches that search.</div>
      :groups.map(([product,rows])=>
        <section className="section schedule-group" key={product}>
          <div className="section-heading"><div><div className="eyebrow">{rows[0].insurer??"POLICY"}</div><h2>{product}</h2></div>
            <small>{rows[0].owners.length?rows[0].owners.join(" · "):<Link className="text-link" href="/">Whose policy is this? →</Link>}</small></div>
          <ul className="benefit-list">
            {rows.map(benefit=>{const line=paysLine(benefit);return <li key={benefit.id} className="benefit-item" data-testid="benefit-item" data-established={line.established?"yes":"no"}>
              <div className="benefit-head"><strong>{benefit.benefitName}</strong>{benefit.owners.length>0&&<small>{benefit.owners.join(", ")}</small>}</div>
              <p className={line.established?"pays-cell":"muted-cell"}>{line.text}</p>
              {line.established&&benefit.formulaKind==="sum_insured"&&benefit.calculatedAgainst?.filter(c=>c.amount).map((c,i)=><small key={i} className="pays-basis">{c.owner}: {c.amount}{c.plan?` (${c.plan})`:""}</small>)}
              {benefit.attention==="unreadable"&&CLARIFIABLE.has(benefit.formulaKind)&&<UnreadableAmount benefit={benefit} onSaved={async(message)=>{setStatus(message);await load();}} />}
              <details className="source-details">
                <summary>Source{benefit.sourcePage?` · page ${benefit.sourcePage}`:""} · {benefit.documentName}</summary>
                {benefit.quote?<blockquote>{benefit.quote}</blockquote>:<p className="muted">No passage recorded for this benefit.</p>}
                {benefit.conditions.length>0&&<ul>{benefit.conditions.map((c,i)=><li key={i}>{c}</li>)}</ul>}
              </details>
            </li>;})}
          </ul>
        </section>)}

    {!!conditions.length&&<details className="section schedule-group source-details" data-testid="benefit-conditions">
      <summary>Exclusions, waiting periods and limits in these documents</summary>
      <p className="muted">These can reduce or rule out a payment. Whether one applies to a particular event is the insurer&rsquo;s decision.</p>
      <ul className="benefit-list">{conditions.map(condition=><li key={condition.id} className="benefit-item">
        <div className="benefit-head"><strong>{condition.description}</strong><small>{condition.cover??condition.documentName}</small></div>
        <details className="source-details"><summary>Source{condition.sourcePage?` · page ${condition.sourcePage}`:""}</summary><blockquote>{condition.quote}</blockquote></details>
      </li>)}</ul>
    </details>}
  </div>;
}

/** The one clarification a household can be asked here: the document shows
 * this benefit but its amount is unreadable, and the person holding the
 * paper copy can read it. Saved as the household's own statement. */
function UnreadableAmount({benefit,onSaved}:{benefit:Benefit;onSaved:(message:string)=>Promise<void>}){
  const [open,setOpen]=useState(false);
  const [amount,setAmount]=useState("");
  const [currency,setCurrency]=useState(benefit.currency??"");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  async function save(){
    const value=Number(amount.replace(/,/g,""));
    if(!amount.trim()||!Number.isFinite(value)||value<=0){setError("Enter the amount as printed, for example 5,000.");return;}
    if(!currency){setError("Choose the currency printed next to the amount.");return;}
    setSaving(true);setError("");
    try{
      const response=await fetch("/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:benefit.id,benefitName:benefit.benefitName,formula:{kind:benefit.formulaKind,value,currency,factKey:benefit.factKey,offsetDays:benefit.offsetDays,maximumDays:benefit.maximumDays}})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||payload.error)throw new Error(payload.error);
      setOpen(false);await onSaved(`Saved the amount for “${benefit.benefitName}”.`);
    }catch(e){setError(customerError(e,"That could not be saved. Please try again."));}
    finally{setSaving(false);}
  }
  if(!open)return <button type="button" className="link-button" onClick={()=>setOpen(true)}>I can read the amount on my copy</button>;
  return <div className="clarify-amount">
    <div className="schedule-amount-row">
      <select aria-label="Currency" value={currency} onChange={e=>setCurrency(e.target.value)}>
        <option value="">Currency</option>
        {["SGD","USD","MYR","HKD","AUD","GBP","EUR"].map(c=><option value={c} key={c}>{c}</option>)}
      </select>
      <input aria-label="Amount as printed" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Amount as printed" />
      <button type="button" className="button primary compact" disabled={saving} onClick={()=>void save()}>{saving?"Saving…":"Save"}</button>
      <button type="button" className="button secondary compact" disabled={saving} onClick={()=>setOpen(false)}>Cancel</button>
    </div>
    {error&&<small role="alert" className="row-error">{error}</small>}
  </div>;
}

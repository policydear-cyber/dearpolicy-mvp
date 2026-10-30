"use client";

import Link from "next/link";
import { groupHeading } from "@/lib/policies/group-heading";
import { useEffect,useMemo,useState } from "react";

/** OPERATOR: benefit extraction review (moved out of the household Benefits
 * page in V1.1 -- households no longer confirm headings, fix rows or re-read
 * documents). Acts on the signed-in operator's own household through the
 * household benefits API.
 *
 * The benefit schedule.
 *
 * Every payout rule DearPolicy has read out of the household's documents, in
 * plain English, next to the page it came from. It is useful with no claim in
 * progress, and it is where extraction stops having to be perfect: a person who
 * can see a wrong rule can fix it once, and the correction outlives every later
 * re-read of that document. */
type Benefit={
  id:string;policyId:string;productName:string|null;benefitName:string;traits:string[];
  /** Added after a name cut at its stored length: ")" or "…" (lib/policies/cut-name). */
  nameSuffix?:string;
  formulaKind:"none"|"sum_insured"|"fixed"|"expense_cap"|"daily";formulaValue:number|null;
  currency:string|null;factKey:string|null;offsetDays:number|null;maximumDays:number|null;
  pays:string;sourcePage:number|null;quote:string;conditions:string[];
  needsReview:boolean;reviewedAt:string|null;needsConfirmation:boolean;
  /** "confirm" = DearPolicy needs an answer before it will use this rule.
   *  "unreadable" = it could not read an amount here; nothing to answer. */
  attention:"confirm"|"unreadable"|null;
  calculatedAgainst:{owner:string;plan:string|null;amount:string|null}[];
  documentName:string;insurer:string|null;owners:string[];
};
type Summary={total:number;needsYou:number;unreadable:number;usable:number;documents:number;unclaimed:number;
  conditions?:number;conditionsThatChangeAmounts?:number};
/** What a cover does NOT pay: the exclusions, waiting periods and caps read
 * from the same documents. Shown here because a condition read wrongly takes
 * money OFF an answer, which is the error a person most needs to catch. */
type Condition={id:string;policyId:string;documentName:string;cover:string|null;kind:string;
  description:string;effect:string;sourcePage:number|null;quote:string;needsReview:boolean};
type Member={id:string;display_name:string;relationship:string};
type Unread={id:string;name:string;pages:number};

const KINDS:{value:Benefit["formulaKind"];label:string;hint:string}[]=[
  {value:"sum_insured",label:"A percentage of the sum insured",hint:"Calculated from the sum insured on your own schedule."},
  {value:"fixed",label:"A fixed amount",hint:"The same amount every time this benefit is claimed."},
  {value:"expense_cap",label:"Reimburses a cost, up to a limit",hint:"Pays what was actually spent, never more than the limit."},
  {value:"daily",label:"An amount for each day",hint:"Needs a maximum number of days, otherwise it would pay without end."},
  {value:"none",label:"Not a payout rule",hint:"Kept for reference. No amount is ever calculated from it."},
];
const EXPENSE_FACTS:{value:string;label:string}[]=[
  {value:"hospitalBill",label:"the hospital bill"},
  {value:"ambulanceBill",label:"the ambulance bill"},
  {value:"vehicleRepairBill",label:"the vehicle repair bill"},
  {value:"outOfPocket",label:"out-of-pocket medical costs"},
];

type Draft={kind:Benefit["formulaKind"];amount:string;currency:string;factKey:string;offsetDays:string;maximumDays:string;benefitName:string};
function draftFrom(benefit:Benefit):Draft{
  return {
    kind:benefit.formulaKind,
    // A share of the sum insured is stored as a fraction and read as a percentage.
    amount:benefit.formulaValue==null?"":String(benefit.formulaKind==="sum_insured"?Math.round(benefit.formulaValue*1000)/10:benefit.formulaValue),
    // Never pre-filled with SGD: the person picks the currency their policy states.
    currency:benefit.currency??"",
    factKey:benefit.factKey??"",
    offsetDays:benefit.offsetDays==null?"":String(benefit.offsetDays),
    maximumDays:benefit.maximumDays==null?"":String(benefit.maximumDays),
    benefitName:benefit.benefitName,
  };
}

export default function OperatorBenefitExtractionPage(){
  const [benefits,setBenefits]=useState<Benefit[]>([]);
  const [conditions,setConditions]=useState<Condition[]>([]);
  const [showConditions,setShowConditions]=useState(false);
  const [summary,setSummary]=useState<Summary|null>(null);
  const [family,setFamily]=useState<Member[]>([]);
  const [memberId,setMemberId]=useState("");
  const [filter,setFilter]=useState<"all"|"review"|"unreadable">("all");
  const [search,setSearch]=useState("");
  const [openId,setOpenId]=useState("");
  const [draft,setDraft]=useState<Draft|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");
  const [saving,setSaving]=useState(false);
  // Documents are read on the way in. These are the ones that predate that, or
  // whose reading failed — reading them is a button here, not a command.
  const [unread,setUnread]=useState<Unread[]>([]);
  const [reading,setReading]=useState("");

  async function load(member=memberId){
    setLoading(true);
    try{
      const query=member?`?familyMemberId=${encodeURIComponent(member)}`:"";
      const response=await fetch(`/api/benefits${query}`);
      const payload=await response.json().catch(()=>({error:`The benefit schedule returned an unreadable response (${response.status}).`}));
      if(!response.ok||payload.error)throw new Error(payload.error??`The benefit schedule could not be loaded (${response.status}).`);
      setBenefits(payload.benefits??[]);setConditions(payload.conditions??[]);setSummary(payload.summary??null);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Could not reach DearPolicy.");}
    finally{setLoading(false);}
  }
  const [reader,setReader]=useState("");
  const [everything,setEverything]=useState<Unread[]>([]);
  async function checkUnread(){
    try{
      const payload=await (await fetch("/api/benefits/index?all=1")).json();
      setUnread(payload.unread??[]);setEverything(payload.all??[]);setReader(payload.reader??"");
    }catch{setUnread([]);}
  }
  /** Re-read every document with the current reading model, one at a time.
   * Corrections a person has made are kept. */
  async function rereadAll(){
    setStatus("");
    let found=0;
    for(const [index,doc] of everything.entries()){
      setReading(`${doc.name} (${index+1} of ${everything.length})`);
      try{
        const response=await fetch("/api/benefits/index",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({policyId:doc.id})});
        const payload=await response.json();
        if(!response.ok||payload.error)throw new Error(payload.error||"That document could not be read.");
        found+=Number(payload.stored??0);
        setStatus(`Read ${payload.name} — ${payload.stored} benefit${payload.stored===1?"":"s"} found. ${found} so far.`);
        await load();
      }catch(e){setStatus(e instanceof Error?e.message:"That document could not be read.");break;}
    }
    setReading("");
    await checkUnread();
  }
  useEffect(()=>{
    void load("");
    void checkUnread();
    void fetch("/api/family").then(r=>r.json()).then(p=>setFamily(p.family??[])).catch(()=>setFamily([]));
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  /** One document per request, so the screen can say which one it is on. */
  async function readAll(){
    setStatus("");
    for(let guard=0;guard<60;guard++){
      const next=unread[0];
      setReading(next?next.name:"the next document");
      try{
        const response=await fetch("/api/benefits/index",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({})});
        const payload=await response.json();
        if(!response.ok||payload.error)throw new Error(payload.error||"That document could not be read.");
        if(payload.done&&payload.stored==null){setUnread([]);break;}
        setStatus(`Read ${payload.name} — ${payload.stored} benefit${payload.stored===1?"":"s"} found.`);
        await checkUnread();
        await load();
        if(payload.done){setUnread([]);break;}
      }catch(e){setStatus(e instanceof Error?e.message:"That document could not be read.");break;}
    }
    setReading("");
    await checkUnread();
  }

  async function chooseMember(id:string){setMemberId(id);setOpenId("");await load(id);}

  function open(benefit:Benefit){
    if(openId===benefit.id){setOpenId("");setDraft(null);return;}
    setOpenId(benefit.id);setDraft(draftFrom(benefit));setStatus("");
  }

  async function save(benefit:Benefit){
    if(!draft)return;
    setSaving(true);setStatus("");
    try{
      const raw=Number(draft.amount.replace(/,/g,""));
      const value=draft.kind==="none"?null:draft.kind==="sum_insured"?raw/100:raw;
      const response=await fetch("/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:benefit.id,benefitName:draft.benefitName.trim()||benefit.benefitName,
          formula:{kind:draft.kind,value:value!=null&&Number.isFinite(value)?value:null,currency:draft.currency,
            factKey:draft.factKey||null,
            offsetDays:draft.offsetDays===""?null:Number(draft.offsetDays),
            maximumDays:draft.maximumDays===""?null:Number(draft.maximumDays)}})});
      const payload=await response.json().catch(()=>({error:"That correction could not be saved."}));
      if(!response.ok||payload.error)throw new Error(payload.error||"That correction could not be saved.");
      setOpenId("");setDraft(null);setStatus(`Saved. DearPolicy will use your version of “${benefit.benefitName}” from now on.`);
      await load();
    }catch(e){setStatus(e instanceof Error?e.message:"That correction could not be saved.");}
    finally{setSaving(false);}
  }
  async function markCorrect(benefit:Benefit){
    setSaving(true);
    try{
      const response=await fetch("/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:benefit.id,needsReview:false})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||"Could not mark that benefit as checked.");
      setStatus(`“${benefit.benefitName}” is marked as checked.`);await load();
    }catch(e){setStatus(e instanceof Error?e.message:"Could not mark that benefit as checked.");}
    finally{setSaving(false);}
  }
  async function remove(benefit:Benefit){
    setSaving(true);
    try{
      const response=await fetch("/api/benefits",{method:"DELETE",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:benefit.id})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||"Could not remove that row.");
      setOpenId("");setDraft(null);
      setStatus(`Removed “${benefit.benefitName}”. Your document is untouched — re-indexing it brings the row back.`);
      await load();
    }catch(e){setStatus(e instanceof Error?e.message:"Could not remove that row.");}
    finally{setSaving(false);}
  }

  const visible=useMemo(()=>{
    const needle=search.trim().toLowerCase();
    return benefits.filter(b=>{
      if(filter==="review"&&b.attention!=="confirm")return false;
      if(filter==="unreadable"&&b.attention!=="unreadable")return false;
      if(!needle)return true;
      return [b.benefitName,b.productName??"",b.documentName,b.insurer??""].join(" ").toLowerCase().includes(needle);
    });
  },[benefits,filter,search]);
  const groups=useMemo(()=>{
    const map=new Map<string,Benefit[]>();
    for(const benefit of visible){
      // One group per plan, and one per document with no plan name: two documents can share a readable name.
      const key=benefit.productName??"doc:"+benefit.policyId;
      map.set(key,[...(map.get(key)??[]),benefit]);
    }
    return [...map.entries()];
  },[visible]);

  return <div className="page schedule-page">
    <header className="page-header compact"><div>
      <div className="eyebrow">OPERATOR · BENEFIT EXTRACTION</div>
      <h1>Extracted benefit rules</h1>
      <p className="lead">Every payout rule DearPolicy read out of your documents, with the page it came from. Most rows need nothing from you. A row marked <b>confirm this</b> is one DearPolicy will not calculate with until you answer — usually because the amount was printed in the table heading rather than the row, and your own documents state those differently. Answering takes one click and lasts: your version survives the document being read again.</p>
    </div></header>

    {error&&<div className="alert error" role="alert"><strong>The benefit schedule could not be loaded.</strong><span>Something went wrong reaching your data.</span><small>Your documents are untouched. Please try refreshing in a moment — if this keeps happening, contact support.</small></div>}

    {!!unread.length&&<section className="unread-documents">
      <div><strong>{unread.length} document{unread.length===1?"":"s"} still to read</strong>
        <span>{unread.slice(0,3).map(d=>d.name).join(" · ")}{unread.length>3?` and ${unread.length-3} more`:""}. DearPolicy reads {unread.length===1?"it":"them"} on the way in, and finishes whatever is left the next time you ask a question — the first answer after an upload can take a little longer because of it. Nothing here needs doing.</span></div>
      <button type="button" className="link-button" disabled={!!reading} onClick={()=>void readAll()}>
        {reading?`Reading ${reading}…`:"Read them now instead of waiting"}</button>
    </section>}

    {!unread.length&&!!everything.length&&<div className="schedule-reread">
      <span>Read by {reader||"the local model"}. Changed the reading model, or want a fresh read? Your corrections are kept.</span>
      <button type="button" className="link-button" disabled={!!reading} onClick={()=>void rereadAll()}>{reading?`Reading ${reading}…`:"Re-read all documents"}</button>
    </div>}

    <section className="schedule-summary">
      <div><strong>{summary?.total??0}</strong><span>benefit{summary?.total===1?"":"s"} on file</span></div>
      <div><strong>{summary?.usable??0}</strong><span>ready to calculate with</span></div>
      <div className={summary?.needsYou?"warn":""}><strong>{summary?.needsYou??0}</strong><span>need one answer from you</span></div>
      <div><strong>{summary?.unreadable??0}</strong><span>DearPolicy could not read an amount</span></div>
      <div><strong>{summary?.documents??0}</strong><span>document{summary?.documents===1?"":"s"} read</span></div>
      <div><strong>{summary?.conditions??0}</strong><span>condition{summary?.conditions===1?"":"s"} on what they pay</span></div>
    </section>

    {!!conditions.length&&<section className="section schedule-group">
      <div className="section-heading">
        <div><div className="eyebrow">WHAT YOUR COVERS DO NOT PAY</div>
          <h2>{conditions.length} condition{conditions.length===1?"":"s"} read from your documents</h2></div>
        <button type="button" className="link-button" onClick={()=>setShowConditions(!showConditions)}>
          {showConditions?"Hide":"Show all"}</button>
      </div>
      <p className="muted">Exclusions, waiting periods, survival periods and caps. {summary?.conditionsThatChangeAmounts??0} of
        these can change an estimated amount; the rest are stated next to it, because whether they apply is the insurer&rsquo;s
        decision and not something DearPolicy can settle from what you tell it.</p>
      {showConditions&&<div className="schedule-table-scroll"><table className="schedule-table">
        <thead><tr><th>Cover</th><th>Condition</th><th>Effect</th><th>Page</th></tr></thead>
        <tbody>{conditions.map(condition=><tr key={condition.id}>
          <td>{condition.cover??condition.documentName}</td>
          <td>{condition.description}<br /><small className="muted">&ldquo;{condition.quote.slice(0,160)}&rdquo;</small></td>
          <td><small>{condition.effect}</small></td>
          <td>{condition.sourcePage??"—"}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>}

    <section className="schedule-controls">
      <div className="field"><label htmlFor="schedule-person">Person</label>
        <select id="schedule-person" value={memberId} onChange={e=>void chooseMember(e.target.value)}>
          <option value="">Everyone in the household</option>
          {family.map(m=><option value={m.id} key={m.id}>{m.display_name}</option>)}
        </select></div>
      <div className="field"><label htmlFor="schedule-search">Find a benefit</label>
        <input id="schedule-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Fracture, hospital cash, dental…" /></div>
      <div className="schedule-filters" role="group" aria-label="Filter benefits">
        <button type="button" className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>All</button>
        <button type="button" className={filter==="review"?"active":""} onClick={()=>setFilter("review")}>Needs you</button>
        <button type="button" className={filter==="unreadable"?"active":""} onClick={()=>setFilter("unreadable")}>No amount found</button>
      </div>
    </section>

    {status&&<div className="schedule-status" role="status">{status}</div>}

    {loading?<div className="empty-card">Loading the benefit schedule…</div>
      :!benefits.length?<div className="empty-card">{unread.length?"Your documents are still being read. Ask your question in the chat — DearPolicy reads whatever it still needs before it answers.":<>No benefits have been read yet. Upload a policy document or benefit summary and DearPolicy will read it once, on the way in. <Link className="text-link" href="/policies">Upload documents →</Link></>}</div>
      :!visible.length?<div className="empty-card">Nothing matches that filter.</div>
      :groups.map(([product,rows])=>
        <section className="section schedule-group" key={product}>
          <div className="section-heading"><div><div className="eyebrow">{rows[0].insurer??"POLICY"}</div><h2>{groupHeading(groups,product)}</h2></div>
            <small>{rows[0].owners.length?rows[0].owners.join(" · "):"Nobody has claimed this document yet"}</small></div>
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>Person</th><th>Benefit</th><th>Pays</th><th>Page</th><th></th></tr></thead>
            <tbody>
              {rows.map(benefit=><tr key={benefit.id} className={benefit.attention==="confirm"?"needs-review":""}>
                <td>{benefit.owners.length?benefit.owners.join(", "):<em>unclaimed</em>}</td>
                <td><strong>{benefit.benefitName}{benefit.nameSuffix}</strong>{benefit.attention==="confirm"&&<span className="schedule-flag">confirm this</span>}{benefit.reviewedAt&&<span className="schedule-flag checked">you confirmed this</span>}</td>
                <td className={benefit.formulaKind==="none"||benefit.needsConfirmation?"muted-cell":"pays-cell"}>{benefit.pays}{benefit.needsConfirmation&&<small className="pays-unconfirmed">read from the table heading — not used until you confirm it</small>}
                  {benefit.formulaKind==="sum_insured"&&benefit.calculatedAgainst?.map((c,i)=><small key={i} className={c.amount?"pays-basis":"pays-unconfirmed"}>{c.amount?`${c.owner}: ${c.amount} (${c.plan})`:`${c.owner}: no sum insured on file for this plan — set the product name to match the certificate`}</small>)}</td>
                <td>{benefit.sourcePage??"—"}</td>
                <td><button type="button" className="link-button" onClick={()=>open(benefit)} aria-expanded={openId===benefit.id}>{openId===benefit.id?"Close":"Check"}</button></td>
              </tr>)}
            </tbody>
          </table></div>
          {rows.filter(b=>b.id===openId).map(benefit=><div className="schedule-editor" key={"editor-"+benefit.id}>
            <div className="schedule-editor-source">
              <small>FROM PAGE {benefit.sourcePage??"?"} OF {benefit.documentName}</small>
              <blockquote>{benefit.quote}</blockquote>
              {benefit.conditions.length>0&&<ul>{benefit.conditions.map((c,i)=><li key={i}>{c}</li>)}</ul>}
            </div>
            {draft&&<div className="schedule-editor-form">
              <div className="field"><label htmlFor="benefit-name">What this benefit is called</label>
                <input id="benefit-name" value={draft.benefitName} onChange={e=>setDraft({...draft,benefitName:e.target.value})} /></div>
              <div className="field"><label htmlFor="benefit-kind">What it pays</label>
                <select id="benefit-kind" value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as Draft["kind"]})}>
                  {KINDS.map(k=><option value={k.value} key={k.value}>{k.label}</option>)}
                </select>
                <small>{KINDS.find(k=>k.value===draft.kind)?.hint}</small></div>
              {draft.kind!=="none"&&<div className="field"><label htmlFor="benefit-amount">{draft.kind==="sum_insured"?"Percentage":draft.kind==="daily"?"Amount for each day":draft.kind==="expense_cap"?"Limit":"Amount"}</label>
                <div className="schedule-amount-row">
                  {draft.kind!=="sum_insured"&&<select aria-label="Currency" value={draft.currency} onChange={e=>setDraft({...draft,currency:e.target.value})}>
                    <option value="">Currency in policy</option>
                    {["SGD","USD","MYR","HKD","AUD","GBP","EUR"].map(c=><option value={c} key={c}>{c}</option>)}
                  </select>}
                  <input id="benefit-amount" inputMode="decimal" value={draft.amount} onChange={e=>setDraft({...draft,amount:e.target.value})} />
                  {draft.kind==="sum_insured"&&<span className="schedule-unit">% of the sum insured</span>}
                </div></div>}
              {draft.kind==="expense_cap"&&<div className="field"><label htmlFor="benefit-fact">Which cost this limit applies to</label>
                <select id="benefit-fact" value={draft.factKey} onChange={e=>setDraft({...draft,factKey:e.target.value})}>
                  <option value="">Choose a cost…</option>
                  {EXPENSE_FACTS.map(f=><option value={f.value} key={f.value}>{f.label}</option>)}
                </select></div>}
              {draft.kind==="daily"&&<>
                <div className="field"><label htmlFor="benefit-offset">Days before it starts paying</label>
                  <input id="benefit-offset" inputMode="numeric" value={draft.offsetDays} onChange={e=>setDraft({...draft,offsetDays:e.target.value})} placeholder="0" />
                  <small>Enter 0 if it pays from the first day.</small></div>
                <div className="field"><label htmlFor="benefit-max">Maximum number of days</label>
                  <input id="benefit-max" inputMode="numeric" value={draft.maximumDays} onChange={e=>setDraft({...draft,maximumDays:e.target.value})} /></div>
              </>}
              <div className="schedule-editor-actions">
                <button type="button" className="button primary" disabled={saving} onClick={()=>void save(benefit)}>{saving?"Saving…":"Save my correction"}</button>
                {benefit.attention==="confirm"&&<button type="button" className="button secondary" disabled={saving} onClick={()=>void markCorrect(benefit)}>This is already right</button>}
                <button type="button" className="link-button danger" disabled={saving} onClick={()=>void remove(benefit)}>This is not a benefit</button>
              </div>
              <small className="schedule-editor-note">DearPolicy keeps your version even when this document is read again. Your document, your uploaded evidence and your confirmed cover are never changed from this screen.</small>
            </div>}
          </div>)}
        </section>)}
  </div>;
}


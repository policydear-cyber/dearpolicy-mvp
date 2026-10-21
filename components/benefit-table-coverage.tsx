"use client";

import Link from "next/link";
import { useState } from "react";
import { parseAmount } from "@/lib/benefit-table/amount";

/** Coverage from the benefit table (lib/benefit-table): for each person, their covers with the headline amounts to
 * confirm or correct, then what each cover pays, each row with its page. Parts of documents not linked to anyone's
 * cover are listed with a "belongs to" choice, never dropped. Shown only when DEARPOLICY_BENEFIT_TABLE is on. */
type Source={documentId:string;document:string;page:number;excerpt:string};
type Confirmation={status:"confirmed"|"corrected";sumInsured:number|null;printed:number|null;updatedAt?:string|null};
type Cover={personId:string;coverKey:string;product:string;cover:string;plan:string|null;riderOf:string|null;policyNumber:string|null;
  sumInsured:number|null;premium:number|null;premiumFrequency:string|null;startDate:string|null;endDate:string|null;currency:string|null;
  source:Source;confirmation:Confirmation|null};
type Row={coverKey:string;benefit:string;section:string|null;column:string|null;qualifier?:string|null;figureText:string;figure:{kind:string};
  fromDay:number|null;maxDays:number|null;conditions:string[];source:Source;baseSource:Source|null;linkWhy:string};
type Person={id:string;name:string;covers:Cover[];rows:Row[]};
type Section={key:string;document:string;section:string|null;column:string|null;examples:string[]};
type CoverRef={key:string;product:string;cover:string;plan:string|null;riderOf:string|null};
type Other={person:string;product:string;cover:string;plan:string|null;source:Source};
export type BenefitTableData={enabled:true;people:Person[];covers:CoverRef[];documents:{id:string;name:string;state:"read"|"waiting"|"not_readable"}[];
  unmatchedCovers:Other[];illustrationCovers:Other[];unlinkedSections:{section:Section;why:string;chosenBy:"model"|"household"|null}[];
  staleConfirmations:{personId:string;coverKey:string;status:string;sumInsured:number|null}[]};

const money=(n:number|null,currency:string|null)=>n==null?"not printed":`${currency==="SGD"?"S$":currency?currency+" ":"$"}${n.toLocaleString("en-US",{maximumFractionDigits:2})}`;
const coverName=(c:{product:string;cover:string;plan:string|null;riderOf?:string|null})=>
  [c.product,c.cover!==c.product?c.cover:null,c.plan?`plan ${c.plan}`:null,c.riderOf?`rider of ${c.riderOf}`:null].filter(Boolean).join(" · ");
const days=(r:Row)=>[r.fromDay!=null?`from day ${r.fromDay}`:null,r.maxDays!=null?`up to ${r.maxDays} days`:null].filter(Boolean).join(", ");

/** The page the row was read from, opened in the stored document (the Documents page's Preview). */
function SourceLink({source,label="Open page"}:{source:Source;label?:string}){
  return <a className="text-link" href={`/api/policies/${source.documentId}/file#page=${source.page}`} target="_blank" rel="noopener noreferrer">{label} {source.page} of {source.document}</a>;
}

function post(url:string,body:unknown){
  return fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(async r=>{
    if(!r.ok)throw new Error((await r.json().catch(()=>({})))?.error??"Could not save that");
  });
}

function CoverCard({cover,reload}:{cover:Cover;reload:()=>Promise<void>}){
  const [editing,setEditing]=useState(false);
  const [value,setValue]=useState(cover.sumInsured==null?"":String(cover.sumInsured));
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const save=async(status:"confirmed"|"corrected"|null,sumInsured:number|null=null)=>{
    setBusy(true);setError("");
    try{await post("/api/benefit-table/confirm",{personId:cover.personId,coverKey:cover.coverKey,status,sumInsured});setEditing(false);await reload();}
    catch(e){setError(e instanceof Error?e.message:"Could not save that");}
    finally{setBusy(false);}
  };
  const parsed=parseAmount(value);
  const k=cover.confirmation;
  return <li className="benefit-item coverage-row" data-testid="table-cover">
    <div className="coverage-top">
      <div className="benefit-head"><strong>{coverName(cover)}</strong>{cover.policyNumber?<small>Policy {cover.policyNumber}</small>:null}</div>
      <p className="pays-cell">Sum insured {money(cover.sumInsured,cover.currency)}</p>
    </div>
    {k?.status==="corrected"?<p className="coverage-conditions">You corrected this. The document prints {money(k.printed,cover.currency)}.</p>
      :k?.status==="confirmed"?<p className="coverage-conditions">You confirmed this amount.</p>:null}
    <p className="coverage-plan">{[cover.premium!=null?`Premium ${money(cover.premium,cover.currency)}${cover.premiumFrequency?` ${cover.premiumFrequency}`:""}`:null,
      cover.startDate?`from ${cover.startDate}`:null,cover.endDate?`to ${cover.endDate}`:null].filter(Boolean).join(" · ")}</p>
    {editing?<form className="schedule-controls" onSubmit={e=>{e.preventDefault();if(parsed.ok)void save("corrected",parsed.amount);}}>
      <div className="field"><label htmlFor={`si-${cover.coverKey}`}>Correct sum insured</label>
        <input id={`si-${cover.coverKey}`} inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)} aria-describedby={`si-${cover.coverKey}-check`}/>
        {/* What will be saved, before it is saved: a typed amount is never guessed at. */}
        <small id={`si-${cover.coverKey}-check`} className={parsed.ok?"muted":"error"} data-testid="correct-preview" role="status">
          {parsed.ok?`Will save ${money(parsed.amount,cover.currency)}`:parsed.why}</small></div>
      <button type="submit" className="button secondary compact" disabled={busy||!parsed.ok}>Save</button>
      <button type="button" className="mini-button" onClick={()=>setEditing(false)}>Cancel</button>
    </form>:<div className="schedule-controls">
      {k?.status!=="confirmed"&&cover.sumInsured!=null?<button type="button" className="button secondary compact" disabled={busy} onClick={()=>void save("confirmed")}>Confirm</button>:null}
      <button type="button" className="mini-button" disabled={busy} onClick={()=>setEditing(true)}>Correct</button>
      {k?<button type="button" className="mini-button" disabled={busy} onClick={()=>void save(null)}>Undo</button>:null}
    </div>}
    {error?<p className="alert error" role="alert">{error}</p>:null}
    <details className="source-details"><summary>Source</summary><p><SourceLink source={cover.source}/></p><blockquote>{cover.source.excerpt}</blockquote></details>
  </li>;
}

function SectionPicker({item,covers,reload}:{item:BenefitTableData["unlinkedSections"][number];covers:CoverRef[];reload:()=>Promise<void>}){
  const [error,setError]=useState("");
  const choose=async(value:string)=>{
    setError("");
    try{await post("/api/benefit-table/link",{section:item.section.key,cover:value==="none"?null:value});await reload();}
    catch(e){setError(e instanceof Error?e.message:"Could not save that");}
  };
  const s=item.section;
  return <li className="benefit-item" data-testid="table-unlinked">
    <div className="benefit-head"><strong>{s.section??"Untitled part"}{s.column?` (${s.column})`:""}</strong><small>{s.document}</small></div>
    {s.examples.length?<p className="muted">For example: {s.examples.slice(0,3).join("; ")}</p>:null}
    <p className="muted">{item.chosenBy==="household"?"You said this belongs to none of these covers.":`Not linked: ${item.why}`}</p>
    <div className="field"><label htmlFor={`link-${s.key}`}>Belongs to</label>
      <select id={`link-${s.key}`} defaultValue="" onChange={e=>{if(e.target.value)void choose(e.target.value);}}>
        <option value="" disabled>Choose a cover…</option>
        {covers.map(c=><option key={c.key} value={c.key}>{coverName(c)}</option>)}
        <option value="none">None of these</option>
      </select></div>
    {error?<p className="alert error" role="alert">{error}</p>:null}
  </li>;
}

export function BenefitTableCoverage({data,reload}:{data:BenefitTableData;reload:()=>Promise<void>}){
  const waiting=data.documents.filter(d=>d.state==="waiting"),unreadable=data.documents.filter(d=>d.state==="not_readable");
  const nameOf=(personId:string)=>data.people.find(p=>p.id===personId)?.name??"Someone";
  const coverOf=(key:string)=>data.covers.find(c=>c.key===key);
  return <div className="page">
    <header className="page-header"><div>
      <div className="eyebrow">COVERAGE</div>
      <h1>Who is covered for what.</h1>
      <p className="lead">For each person: their covers, then what each one pays, each with the page it comes from. Amounts are as your documents print them or worked out from them, not a payment or an insurer&rsquo;s decision.</p>
      <p className="muted">Check each sum insured once. A correction changes every amount worked out from it.</p>
    </div></header>
    {waiting.length?<div className="unread-documents" role="status"><div><strong>{waiting.length===1?"One document has":`${waiting.length} documents have`} not been read into this page yet.</strong>
      <span>{waiting.map(d=>d.name).join(", ")}. Use Read again on the <Link className="text-link" href="/policies">Documents page</Link>.</span></div></div>:null}
    {unreadable.length?<div className="unread-documents stalled" role="status"><div><strong>{unreadable.length===1?"One document":"Some documents"} could not be read.</strong><span>{unreadable.map(d=>d.name).join(", ")}</span></div></div>:null}
    {!data.people.some(p=>p.covers.length)?<div className="empty-card">No covers yet. Upload a certificate, schedule or policy wording on the Documents page and DearPolicy reads it for you.</div>:null}
    {data.people.map(person=>{
      const byCover=person.covers.map(c=>({cover:c,rows:person.rows.filter(r=>r.coverKey===c.coverKey)}));
      return <section className="section coverage-person" key={person.id} data-testid="table-person">
        <div className="section-heading"><h2>{person.name}</h2></div>
        {!person.covers.length?<p className="empty-row">No cover for {person.name} was found in your documents.</p>:<>
          <h3>Covers</h3>
          <ul className="benefit-list">{person.covers.map(c=><CoverCard key={c.coverKey+c.source.page} cover={c} reload={reload}/>)}</ul>
          {byCover.map(({cover,rows})=><div className="coverage-kind" key={"pays-"+cover.coverKey+cover.source.page}>
            <h3>What {coverName(cover)} pays</h3>
            {!rows.length?<p className="muted">No benefit rows linked to this cover yet. If a part of a document below belongs to it, choose it there.</p>:
            <ul className="benefit-list">{rows.map((r,i)=><li className="benefit-item coverage-row" key={i} data-testid="table-row">
              <div className="coverage-top">
                <div className="benefit-head"><strong>{r.benefit}</strong>{r.section?<small>{r.section}{r.column?` (${r.column})`:""}</small>:null}</div>
                <p className={r.figure.kind==="none"?"muted-cell":"pays-cell"}>{r.figureText.replace(/^./,ch=>ch.toUpperCase())}{r.qualifier?<strong data-testid="row-qualifier"> (for {r.qualifier})</strong>:null}</p>
              </div>
              {days(r)||r.conditions.length?<p className="coverage-conditions">{[days(r),...r.conditions.slice(0,2)].filter(Boolean).join(" · ")}{r.conditions.length>2?` · ${r.conditions.length-2} more below`:""}</p>:null}
              <details className="source-details"><summary>{r.conditions.length?"Conditions and source":"Source"}</summary>
                {r.conditions.length?<ul>{r.conditions.map((c,j)=><li key={j}>{c}</li>)}</ul>:null}
                <p><SourceLink source={r.source}/></p><blockquote>{r.source.excerpt}</blockquote>
                {r.baseSource&&r.baseSource.page!==r.source.page?<p className="muted">Worked out from <SourceLink source={r.baseSource} label="page"/></p>:null}
                <p className="muted">Linked to this cover because: {r.linkWhy}</p>
              </details>
            </li>)}</ul>}
          </div>)}
        </>}
      </section>;})}
    {data.unlinkedSections.length||data.unmatchedCovers.length||data.illustrationCovers.length||data.staleConfirmations.length?
      <section className="section" data-testid="table-not-placed">
        <div className="section-heading"><h2>Not on anyone&rsquo;s table</h2></div>
        {data.staleConfirmations.length?<><h3>Check these again</h3><ul className="benefit-list">{data.staleConfirmations.map((k,i)=><li className="benefit-item" key={i}>
          You {k.status} a cover for {nameOf(k.personId)} ({coverOf(k.coverKey)?coverName(coverOf(k.coverKey)!):k.coverKey}), but your documents no longer show it for them.</li>)}</ul></>:null}
        {data.unlinkedSections.length?<><h3>Parts of documents not linked to a cover</h3>
          <ul className="benefit-list">{data.unlinkedSections.map(u=><SectionPicker key={u.section.key} item={u} covers={data.covers} reload={reload}/>)}</ul></>:null}
        {data.unmatchedCovers.length?<><h3>Covers for someone not in your family</h3><ul className="benefit-list">{data.unmatchedCovers.map((c,i)=><li className="benefit-item" key={i}>
          <strong>{c.person}</strong>: {coverName(c)}. Add them on the <Link className="text-link" href="/family">Family page</Link> if they should be here. <SourceLink source={c.source}/></li>)}</ul></>:null}
        {data.illustrationCovers.length?<><h3>Only in a quotation</h3><p className="muted">A quotation or illustration is not proof of cover.</p><ul className="benefit-list">{data.illustrationCovers.map((c,i)=><li className="benefit-item" key={i}>
          {c.person}: {coverName(c)}. <SourceLink source={c.source}/></li>)}</ul></>:null}
      </section>:null}
  </div>;
}

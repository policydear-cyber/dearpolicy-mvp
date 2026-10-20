"use client";

import Link from "next/link";
import { useEffect,useMemo,useState } from "react";
import { StuckDocuments,canRetryNow,stuckDocuments,stuckTitle,type ReadingDocument } from "@/components/reading-status";
import { COVER_KINDS,coverGaps,coverKindOf,listOf } from "@/components/cover-kinds";
import { AlternativeAmountsBlock,hasAlternatives,type AlternativeAmounts } from "@/components/alternative-amounts";

/** Coverage: what each plan pays, for each person, as the documents state it.
 *
 * V1.1: read-only for households. Each row shows what the documents
 * establish and where (collapsed), and says so when no figure is stated.
 * Fixing rows, adding rows and re-checking documents moved to the operator
 * area (/operator/coverage): a household never repairs DearPolicy's reading.
 * Documents not yet read into this view are read automatically, without a
 * click. */
type Row={
  id:string;familyMemberId:string;ownerName:string;policyId:string|null;planName:string;insurer:string|null;
  eventType:string;eventLabel:string;detail:string|null;cause:"accident"|"illness"|null;
  paysKind:string;amount:number|null;currency:string;conditions:string[];sourcePage:number|null;quote:string|null;
  origin:"schedule"|"wording"|"person";status:"proposed"|"confirmed"|"rejected";pays:string;hasFigure:boolean;
  /** Two documents print different amounts for this row: drawn as one either/or block, never a total. */
  alternatives?:AlternativeAmounts|null;
};
type Member={id:string;display_name:string;relationship:string};
type Reading={pending:number;inProgress:boolean;documents?:ReadingDocument[]};
const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,"-");

const KINDS=COVER_KINDS;
const kindOf=(row:Row)=>coverKindOf(row.eventType);

/** The server's pays text, read aloud: a capital first letter, and "after the first 1" says what the 1 counts. */
const plainPays=(pays:string)=>pays.replace(/after the first (\d+)\b(?! day)/,(_,n)=>`after the first ${n==="1"?"day":n+" days"}`).replace(/^./,c=>c.toUpperCase());

/** The amount in plain words: a row the documents give no figure for says so, without "on file" or "as stated". */
function amountLine(row:Row){
  if(row.hasFigure)return plainPays(row.pays);
  if(row.paysKind==="stated"||!row.pays)return "Covered. Your documents don’t print an amount for this.";
  return plainPays(row.pays);
}

/** Conditions short enough to read at a glance go on the row; longer clauses stay in the details. */
const SHORT=80;
function glanceConditions(row:Row){
  const lines=[...(row.cause?[row.cause==="accident"?"Only after an accident":"Only for an illness"]:[]),...row.conditions.filter(c=>c.length<=SHORT).slice(0,2)];
  const more=row.conditions.length-row.conditions.filter(c=>c.length<=SHORT).slice(0,2).length;
  return {lines,more};
}

function sourceLabel(row:Row){
  if(row.origin==="person")return "Added by you";
  const page=row.sourcePage?`, page ${row.sourcePage}`:"";
  return row.origin==="schedule"?`Your schedule or certificate${page}`:`Your policy wording${page}`;
}

export default function CoveragePage(){
  const [rows,setRows]=useState<Row[]>([]);
  const [family,setFamily]=useState<Member[]>([]);
  const [member,setMember]=useState("");
  const [error,setError]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [reading,setReading]=useState<Reading>({pending:0,inProgress:false});
  const [autoRead,setAutoRead]=useState(false);
  /** The read was asked for and finished, but documents are still unread:
   * say so and offer another try, instead of "still being read" forever. */
  const [readStalled,setReadStalled]=useState(false);
  const stuck=stuckDocuments(reading.documents);
  const [retrying,setRetrying]=useState(false);

  const load=async(who=member):Promise<Reading|null>=>{
    try{
      const res=await fetch("/api/ledger"+(who?"?familyMemberId="+encodeURIComponent(who):""),{cache:"no-store"});
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error("load");
      const next:Reading=data.reading??{pending:0,inProgress:false};
      setRows((data.rows??[]).filter((r:Row)=>r.status!=="rejected"));setFamily(data.family??[]);setReading(next);setError(false);
      if(!next.pending)setReadStalled(false);
      return next;
    }catch{setError(true);return null;}
    finally{setLoaded(true);}
  };
  // "?member=<id>" (from a Family card) opens on that person.
  useEffect(()=>{
    let who="";
    try{who=new URLSearchParams(window.location.search).get("member")??"";}catch{/* no filter */}
    if(who)setMember(who);
    void load(who);
  },[]); // eslint-disable-line react-hooks/exhaustive-deps
  const readNow=async()=>{
    try{
      const res=await fetch("/api/ledger",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"read"})});
      const after=await load();
      setReadStalled(!res.ok||!!(after&&after.pending>0&&!after.inProgress));
    }catch{setReadStalled(true);}
  };
  // Documents not yet read into this view are read now, once, silently.
  useEffect(()=>{
    if(!reading.pending||reading.inProgress||autoRead)return;
    setAutoRead(true);
    void readNow();
  },[reading.pending,reading.inProgress]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry=async()=>{setRetrying(true);setReadStalled(false);await readNow();setRetrying(false);};
  useEffect(()=>{
    if(!reading.inProgress)return;
    const id=setInterval(()=>{void load();},4000);
    return ()=>clearInterval(id);
  },[reading.inProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Person, then kind of cover. A person with no rows is listed too, so a gap is never just an absence. */
  const people=useMemo(()=>{
    const names=member?family.filter(m=>m.id===member).map(m=>m.display_name):[...new Set([...family.map(m=>m.display_name),...rows.map(r=>r.ownerName)])];
    return names.map(name=>{
      const own=rows.filter(r=>r.ownerName===name);
      // An either/or pair is one choice for this person: drawn once, where its first option appears.
      const seen=new Set<string>();
      const shown=own.filter(r=>{const g=hasAlternatives(r.alternatives)?r.alternatives.groupId:null;if(!g)return true;if(seen.has(g))return false;seen.add(g);return true;});
      const kinds=KINDS.map(k=>({...k,rows:shown.filter(r=>kindOf(r).id===k.id)})).filter(k=>k.rows.length);
      const gaps=coverGaps(own.map(r=>r.eventType));
      return {name,kinds,gaps,count:own.length};
    });
  },[rows,family,member]);
  const stillReading=reading.pending>0||reading.inProgress;
  /** A document that could not be read will not be read on its own: gaps are then "in the documents read so far". */
  const unreadable=stuck.length||(readStalled?Math.max(1,reading.pending):0);
  const unreadableNote=unreadable?`${unreadable===1?"One document":`${unreadable} documents`} couldn’t be read (see above), and ${unreadable===1?"it":"they"} may cover`:"";

  return <div className="page">
    <header className="page-header"><div>
      <div className="eyebrow">COVERAGE</div>
      <h1>Who is covered for what.</h1>
      <p className="lead">For each person: what their plans pay, and the main kinds of cover not found in your documents. Amounts are as your documents print them, not a payment or an insurer&rsquo;s decision.</p>
      <p className="muted">Looking for everything one policy pays, with its exclusions? <Link className="text-link" href="/schedule">See Benefits, by policy →</Link></p>
    </div></header>
    {error?<div className="alert error" role="alert"><strong>Your coverage could not be loaded.</strong><span> Please refresh the page in a moment.</span></div>:null}
    {/* The server names each document whose read failed, why, and when it is tried again; without that, the plain stalled banner. */}
    {stuck.length&&!retrying?<div className="unread-documents stalled" role="status"><div><strong>{stuckTitle(stuck,"this page")}</strong><StuckDocuments stuck={stuck}/><span>Rows from {stuck.length===1?"it":"them"} are missing below. You can still ask about {stuck.length===1?"it":"them"} in Ask DearPolicy.</span></div>{canRetryNow(stuck)?<button type="button" className="button secondary compact" onClick={()=>void retry()}>Try again</button>:null}</div>
      :readStalled&&!retrying?<div className="unread-documents stalled" role="status"><div><strong>{reading.pending===1?"One document":"Some documents"} couldn&rsquo;t be read for this page yet.</strong><span>Rows from {reading.pending===1?"it":"them"} are missing below. You can still ask about {reading.pending===1?"it":"them"} in Ask DearPolicy.</span></div><button type="button" className="button secondary compact" onClick={()=>void retry()}>Try again</button></div>
      :(reading.pending>0||reading.inProgress||retrying)?<div className="unread-documents" role="status"><div><strong>Some of your documents are still being read.</strong><span>This page updates on its own when they are ready.</span></div></div>:null}
    <div className="schedule-controls">
      <div className="field"><label htmlFor="coverage-person">Person</label>
        <select id="coverage-person" value={member} onChange={e=>{setMember(e.target.value);void load(e.target.value);}}>
          <option value="">Everyone</option>
          {family.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      </div>
    </div>
    {loaded&&!rows.length&&!error?<div className="empty-card">{(readStalled||stuck.length)&&!retrying?"Nothing to show yet, because those documents couldn’t be read. Try again above, or ask about them in Ask DearPolicy.":reading.pending>0||reading.inProgress?"Nothing to show yet. Rows appear here once your documents have been read.":"Nothing here yet. Upload a certificate, schedule or policy wording on the Documents page and DearPolicy reads it for you."}</div>:null}
    {loaded&&rows.length?people.map(person=><section className="section coverage-person" key={person.name} data-testid="coverage-person">
      <div className="section-heading"><h2>{person.name}</h2></div>
      {/* At a glance: the kinds of cover found, then the main kinds that are not in the documents. */}
      <div className="coverage-glance">
        {person.kinds.length?<ul className="coverage-kinds" aria-label="Covered for">{person.kinds.map(k=><li key={k.id}><a href={`#cover-${slug(person.name)}-${k.id}`}>{k.label}</a></li>)}</ul>:null}
        {(person.gaps.missing.length||person.gaps.notes.length)&&person.count?<p className="coverage-gaps" data-testid="coverage-gaps">
          {person.gaps.missing.length?<><b>{unreadable?"Not found in the documents read so far":`Not found in your uploaded documents${stillReading?" yet":""}`}:</b> {listOf(person.gaps.missing).replace(/^./,c=>c.toUpperCase())}. {unreadable?`${unreadableNote} ${person.gaps.missing.length===1?"it":"them"}.`:stillReading?"More may appear once all your documents are read.":`A plan you haven’t uploaded may still cover ${person.gaps.missing.length===1?"it":"them"}.`}</>:null}
          {person.gaps.notes.length?<span className="coverage-gap-notes"> {person.gaps.notes.join(" ")}</span>:null}</p>:null}
      </div>
      {person.kinds.map(k=><div className="coverage-kind" key={k.id} id={`cover-${slug(person.name)}-${k.id}`}>
        <h3>{k.label}</h3>
        <ul className="benefit-list">{k.rows.map(row=>{
          const alt=hasAlternatives(row.alternatives)?row.alternatives:null;
          const plans=alt?[...new Set(rows.filter(r=>r.ownerName===person.name&&alt.options.some(o=>o.rowId===r.id)).map(r=>r.planName))]:[row.planName];
          const glance=glanceConditions(row);
          return <li key={row.id} className="benefit-item coverage-row" data-testid="coverage-row">
            {/* What it is, then what it pays, before anything else. */}
            <div className="coverage-top">
              <div className="benefit-head"><strong>{row.eventLabel}</strong>{row.detail?<small>{row.detail}</small>:null}</div>
              {alt?null:<p className={row.hasFigure?"pays-cell":"muted-cell"}>{amountLine(row)}</p>}
            </div>
            {alt?<AlternativeAmountsBlock alternatives={alt} rowId={plans.length>1?"":row.id}/>:null}
            {!alt&&glance.lines.length?<p className="coverage-conditions">{glance.lines.join(" · ")}{glance.more?` · ${glance.more} more condition${glance.more===1?"":"s"} below`:""}</p>:null}
            <p className="coverage-plan">{plans.join(" or ")}{!alt&&row.insurer?` · ${row.insurer}`:""}</p>
            <details className="source-details"><summary>{row.conditions.length?"Conditions and source":"Source"}</summary>
              <p className="muted">{sourceLabel(row)}</p>
              {row.conditions.length?<ul>{row.conditions.map((c,i)=><li key={i}>{c}</li>)}</ul>:null}
              {row.quote?<blockquote>{row.quote}</blockquote>:<p className="muted">No passage recorded for this row.</p>}
            </details>
          </li>;})}</ul>
      </div>)}
      {!person.kinds.length?<p className="empty-row">{unreadable?`No cover for ${person.name} was found in the documents read so far. ${unreadableNote} them.`:stillReading?`Nothing for ${person.name} yet. Documents are still being read.`:`No cover for ${person.name} was found in your uploaded documents. A plan you haven’t uploaded may still cover them.`}</p>:null}
    </section>):null}
  </div>;
}

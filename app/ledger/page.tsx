"use client";

import Link from "next/link";
import { useEffect,useMemo,useState } from "react";

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
};
type Member={id:string;display_name:string;relationship:string};
type Reading={pending:number;inProgress:boolean};

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

  const groups=useMemo(()=>{
    const map=new Map<string,Row[]>();
    for(const r of rows){const key=r.ownerName+" · "+r.planName;map.set(key,[...(map.get(key)??[]),r]);}
    return [...map.entries()];
  },[rows]);

  return <div className="page">
    <header className="page-header"><div>
      <div className="eyebrow">COVERAGE</div>
      <h1>What each plan pays, for each person.</h1>
      <p className="lead">Organised by person: for each family member, what each of their plans pays when something happens. Taken from your schedules, certificates and policy wording; open a row&rsquo;s source to see the passage. Where a document states no figure, this page says so.</p>
      <p className="muted">Looking for everything one policy pays, with its exclusions? <Link className="text-link" href="/schedule">See Benefits, by policy →</Link></p>
    </div></header>
    {error?<div className="alert error" role="alert"><strong>Your coverage could not be loaded.</strong><span> Please refresh the page in a moment.</span></div>:null}
    {readStalled&&!retrying?<div className="unread-documents stalled" role="status"><div><strong>{reading.pending===1?"One document":"Some documents"} couldn&rsquo;t be read for this page yet.</strong><span>Rows from {reading.pending===1?"it":"them"} are missing below. You can still ask about {reading.pending===1?"it":"them"} in Ask DearPolicy.</span></div><button type="button" className="button secondary compact" onClick={()=>void retry()}>Try again</button></div>
      :(reading.pending>0||reading.inProgress||retrying)?<div className="unread-documents" role="status"><div><strong>Some of your documents are still being read.</strong><span>This page updates on its own when they are ready.</span></div></div>:null}
    <div className="schedule-controls">
      <div className="field"><label htmlFor="coverage-person">Person</label>
        <select id="coverage-person" value={member} onChange={e=>{setMember(e.target.value);void load(e.target.value);}}>
          <option value="">Everyone</option>
          {family.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      </div>
    </div>
    {loaded&&!rows.length&&!error?<div className="empty-card">{reading.pending>0||reading.inProgress?"Nothing to show yet. Rows appear here once your documents have been read.":"Nothing here yet. Upload a certificate, schedule or policy wording on the Documents page and DearPolicy reads it for you."}</div>:null}
    {groups.map(([key,list])=><section className="section schedule-group" key={key}>
      <div className="section-heading"><h2>{key}</h2>{list[0].insurer?<small>{list[0].insurer}</small>:null}</div>
      <ul className="benefit-list">{list.map(row=><li key={row.id} className="benefit-item" data-testid="coverage-row">
        <div className="benefit-head"><strong>{row.eventLabel}</strong>{row.detail?<small>{row.detail}</small>:null}</div>
        <p className={row.hasFigure?"pays-cell":"muted-cell"}>{row.hasFigure?row.pays:(row.pays||"No amount is stated in your documents for this.")}</p>
        {row.cause?<small className="pays-basis">Only when caused by {row.cause==="accident"?"an accident":"an illness"}</small>:null}
        <details className="source-details"><summary>Source · {sourceLabel(row)}</summary>
          {row.quote?<blockquote>{row.quote}</blockquote>:<p className="muted">No passage recorded for this row.</p>}
          {row.conditions.length?<ul>{row.conditions.map((c,i)=><li key={i}>{c}</li>)}</ul>:null}
        </details>
      </li>)}</ul>
    </section>)}
  </div>;
}

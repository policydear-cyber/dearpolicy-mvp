"use client";

import { useEffect,useMemo,useState } from "react";

/** The Coverage Ledger.
 *
 * One row per (person, plan, event, what it pays). Every payout answer in chat
 * is a lookup in this table, so this page is where accuracy comes from: a row
 * DearPolicy proposed from a document is marked "Proposed" until the person
 * confirms it, and a confirmed row is what makes the next answer exact. */
type Row={
  id:string;familyMemberId:string;ownerName:string;policyId:string|null;planName:string;insurer:string|null;
  eventType:string;eventLabel:string;detail:string|null;cause:"accident"|"illness"|null;
  paysKind:"lump_sum"|"per_day"|"per_month"|"percent_of_sum"|"reimbursement_cap"|"stated";
  amount:number|null;currency:string;sumBasis:number|null;offsetDays:number|null;maximumDays:number|null;
  conditions:string[];note:string|null;sourcePage:number|null;quote:string|null;
  origin:"schedule"|"wording"|"person";inferred:boolean;status:"proposed"|"confirmed"|"rejected";
  pays:string;hasFigure:boolean;
};
type Member={id:string;display_name:string;relationship:string};
type EventOption={value:string;label:string};
type Summary={total:number;confirmed:number;proposed:number;noFigure:number};
type Reading={pending:number;inProgress:boolean};

const KINDS:{value:Row["paysKind"];label:string}[]=[
  {value:"lump_sum",label:"Lump sum"},
  {value:"percent_of_sum",label:"Percentage of the sum insured"},
  {value:"per_day",label:"Per day in hospital"},
  {value:"per_month",label:"Per month"},
  {value:"reimbursement_cap",label:"Actual cost, up to a limit"},
  {value:"stated",label:"No figure — as stated in the plan"},
];

export default function CoveragePage(){
  const [rows,setRows]=useState<Row[]>([]);
  const [summary,setSummary]=useState<Summary|null>(null);
  const [family,setFamily]=useState<Member[]>([]);
  const [events,setEvents]=useState<EventOption[]>([]);
  const [member,setMember]=useState<string>("");
  const [filter,setFilter]=useState<"all"|"proposed"|"confirmed"|"noFigure">("all");
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [editing,setEditing]=useState<Row|null>(null);
  const [draft,setDraft]=useState<{paysKind:Row["paysKind"];amount:string;sumBasis:string;eventType:string;planName:string}|null>(null);
  const [adding,setAdding]=useState(false);
  const [addDraft,setAddDraft]=useState({familyMemberId:"",planName:"",eventType:"death",paysKind:"lump_sum" as Row["paysKind"],amount:"",currency:"SGD"});
  const [notice,setNotice]=useState<string|null>(null);
  const [reading,setReading]=useState<Reading>({pending:0,inProgress:false});

  const load=async(who=member)=>{
    setError(null);
    try{
      const res=await fetch("/api/ledger"+(who?"?familyMemberId="+who:""));
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Could not load the coverage ledger");
      setRows(data.rows);setSummary(data.summary);setFamily(data.family);setEvents(data.events);setReading(data.reading??{pending:0,inProgress:false});
    }catch(e){setError(e instanceof Error?e.message:"Could not load the coverage ledger");}
  };
  useEffect(()=>{void load();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  // DearPolicy checks its own work — it should never wait for a click. If a
  // document has not been read into the ledger yet, read it the moment this
  // page opens, silently, then refresh.
  useEffect(()=>{
    if(!reading.pending||reading.inProgress||busy==="read")return;
    void readNow();
  },[reading.pending,reading.inProgress]); // eslint-disable-line react-hooks/exhaustive-deps
  // A read can also have been kicked off elsewhere (the dashboard reads
  // pending documents in the background too) — poll quietly until it's done
  // so this page never needs a manual refresh to show the result.
  useEffect(()=>{
    if(!reading.inProgress)return;
    const id=setInterval(()=>{void load();},4000);
    return ()=>clearInterval(id);
  },[reading.inProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown=useMemo(()=>rows.filter(r=>filter==="all"?true:filter==="noFigure"?!r.hasFigure:r.status===filter),[rows,filter]);
  const groups=useMemo(()=>{
    const map=new Map<string,Row[]>();
    for(const r of shown){const key=r.ownerName+" · "+r.planName;map.set(key,[...(map.get(key)??[]),r]);}
    return [...map.entries()];
  },[shown]);

  const patch=async(id:string,body:Record<string,unknown>)=>{
    setBusy(id);setError(null);
    try{
      const res=await fetch("/api/ledger",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,...body})});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Could not update the row");
      setRows(current=>current.map(r=>r.id===id?(data.row??r):r).filter(r=>r.status!=="rejected"));
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not update the row");}
    finally{setBusy(null);}
  };
  const save=async()=>{
    if(!editing||!draft)return;
    const amountText=draft.amount.trim().replace(/[^0-9.]/g,"");
    const sumBasisText=draft.sumBasis.trim().replace(/[^0-9.]/g,"");
    if(draft.amount.trim()!==""&&amountText===""){setError("Enter a number for the amount, or leave it blank.");return;}
    if(draft.sumBasis.trim()!==""&&sumBasisText===""){setError("Enter a number for the sum basis, or leave it blank.");return;}
    const amount=amountText===""?null:Number(amountText);
    const sumBasis=sumBasisText===""?null:Number(sumBasisText);
    await patch(editing.id,{paysKind:draft.paysKind,amount:draft.paysKind==="percent_of_sum"&&amount!=null?amount/100:amount,sumBasis,eventType:draft.eventType,planName:draft.planName,status:"confirmed"});
    setEditing(null);setDraft(null);
  };
  const add=async()=>{
    const amountText=addDraft.amount.trim().replace(/[^0-9.]/g,"");
    if(addDraft.amount.trim()!==""&&amountText===""){setError("Enter a number for the amount, or leave it blank.");return;}
    setBusy("add");setError(null);
    try{
      const amount=amountText===""?null:Number(amountText);
      const res=await fetch("/api/ledger",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({familyMemberId:addDraft.familyMemberId||member||family[0]?.id,planName:addDraft.planName,eventType:addDraft.eventType,paysKind:addDraft.paysKind,
          amount:addDraft.paysKind==="percent_of_sum"&&amount!=null?amount/100:amount,currency:addDraft.currency})});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Could not add the row");
      setAdding(false);setAddDraft({familyMemberId:"",planName:"",eventType:"death",paysKind:"lump_sum",amount:"",currency:"SGD"});
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not add the row");}
    finally{setBusy(null);}
  };
  const readNow=async()=>{
    setBusy("read");setNotice(null);setError(null);
    try{
      const res=await fetch("/api/ledger",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"read"})});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Could not read the documents");
      setNotice((data.documents?data.documents+" document"+(data.documents===1?"":"s")+" read. ":"")+(data.added?data.added+" new row"+(data.added===1?"":"s")+" added.":"Nothing new found."));
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not read the documents");}
    finally{setBusy(null);}
  };

  return <div className="page">
    <header className="page-header">
      <div>
        <div className="eyebrow">Coverage Ledger</div>
        <h1>What each plan pays, for each person.</h1>
        <p className="lead">Every payout figure in chat is looked up here. DearPolicy reads each document the moment it's uploaded and checks its own reading a second time before using it — nothing on this page is waiting on you. The source column says where a figure came from, purely so you can see the working; fix a row only if you know something the document doesn't say.</p>
      </div>
      <div className="hero-actions">
        <button className="button secondary" onClick={()=>void readNow()} disabled={busy==="read"||reading.inProgress}>{busy==="read"||reading.inProgress?"Reading…":"Re-check documents"}</button>
        <button className="button primary" onClick={()=>setAdding(a=>!a)}>{adding?"Close":"Add a row"}</button>
      </div>
    </header>
    {error?<div className="alert error" role="alert">{error}</div>:null}
    {notice?<div className="schedule-status">{notice}</div>:null}
    {reading.pending&&!notice?<div className="unread-documents"><div><strong>Reading {reading.pending} document{reading.pending===1?"":"s"} into the ledger…</strong><span>This started automatically — the page will update on its own when it's done.</span></div></div>:null}
    {adding?<div className="upload-panel" style={{marginBottom:16}}>
      <div className="profile-add-grid">
        <div className="field"><label>Person</label><select value={addDraft.familyMemberId||member||family[0]?.id||""} onChange={e=>setAddDraft(d=>({...d,familyMemberId:e.target.value}))}>{family.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></div>
        <div className="field"><label>Plan</label><input value={addDraft.planName} placeholder="e.g. DPS" onChange={e=>setAddDraft(d=>({...d,planName:e.target.value}))}/></div>
        <div className="field"><label>Event</label><select value={addDraft.eventType} onChange={e=>setAddDraft(d=>({...d,eventType:e.target.value}))}>{events.map(ev=><option key={ev.value} value={ev.value}>{ev.label}</option>)}</select></div>
        <div className="field"><label>Pays</label><select value={addDraft.paysKind} onChange={e=>setAddDraft(d=>({...d,paysKind:e.target.value as Row["paysKind"]}))}>{KINDS.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
        <div className="field"><label>Amount {addDraft.paysKind==="percent_of_sum"?"(%)":"("+addDraft.currency+")"}</label><input inputMode="decimal" value={addDraft.amount} onChange={e=>setAddDraft(d=>({...d,amount:e.target.value}))}/></div>
        {addDraft.paysKind!=="percent_of_sum"&&<div className="field"><label>Currency</label><select value={addDraft.currency} onChange={e=>setAddDraft(d=>({...d,currency:e.target.value}))}>{["SGD","USD","MYR","EUR","GBP","AUD","HKD","JPY"].map(c=><option key={c} value={c}>{c}</option>)}</select></div>}
        <button className="button primary" disabled={busy==="add"||!addDraft.planName.trim()} onClick={()=>void add()}>Save row</button>
      </div>
      <p className="note">For cover no document states, such as DPS. A row you enter is used as written.</p>
    </div>:null}
    <div className="schedule-summary">
      <div><strong>{summary?.total??0}</strong><span>rows in the ledger</span></div>
      <div><strong>{summary?.confirmed??0}</strong><span>read from your policy wording</span></div>
      <div><strong>{summary?.proposed??0}</strong><span>from a certificate, standard rule</span></div>
      <div className={summary?.noFigure?"warn":""}><strong>{summary?.noFigure??0}</strong><span>without a figure yet</span></div>
    </div>
    <div className="schedule-controls">
      <div className="field"><label>Person</label>
        <select value={member} onChange={e=>{setMember(e.target.value);void load(e.target.value);}}>
          <option value="">Everyone</option>
          {family.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      </div>
      <div className="schedule-filters" role="tablist">
        {([["all","All"],["confirmed","From your wording"],["proposed","From your certificate"],["noFigure","No figure"]] as const).map(([value,text])=>
          <button key={value} className={filter===value?"active":""} onClick={()=>setFilter(value)} role="tab" aria-selected={filter===value}>{text}</button>)}
      </div>
    </div>
    {!rows.length?<div className="empty-card">No coverage rows yet. Upload a certificate, schedule or policy wording on the Documents page; DearPolicy reads it into rows here automatically.</div>:null}
    {!rows.length?null:!shown.length?<div className="empty-card">Nothing matches this filter.</div>:null}
    {groups.map(([key,list])=><section className="section schedule-group" key={key}>
      <div className="section-heading"><h2>{key}</h2><small>{list.length} row{list.length===1?"":"s"}{list[0].insurer?" · "+list[0].insurer:""}</small></div>
      <div className="schedule-table-scroll"><table className="schedule-table">
        <thead><tr><th>Event</th><th>Pays</th><th>Source</th><th></th></tr></thead>
        <tbody>{list.map(row=><tr key={row.id}>
          <td><strong>{row.eventLabel}</strong>{row.detail?<span className="pays-basis">{row.detail}</span>:null}{row.cause?<span className="pays-basis">Only when caused by {row.cause==="accident"?"an accident":"an illness"}</span>:null}</td>
          <td className={row.hasFigure?"pays-cell":"muted-cell"}>{row.pays}{row.origin==="schedule"&&row.note?<span className="pays-basis">{row.note}</span>:null}</td>
          <td><em>{row.origin==="person"?"Entered by you":row.origin==="schedule"?"Your schedule / certificate":"Read from your policy wording"+(row.sourcePage?", page "+row.sourcePage:"")+", checked by a second read"}</em></td>
          <td style={{whiteSpace:"nowrap"}}>
            <button className="link-button" disabled={busy===row.id} onClick={()=>{setEditing(row);setDraft({paysKind:row.paysKind,amount:row.amount==null?"":String(row.paysKind==="percent_of_sum"?Math.round(row.amount*1000)/10:row.amount),sumBasis:row.sumBasis==null?"":String(row.sumBasis),eventType:row.eventType,planName:row.planName});}}>Fix</button>
          </td>
        </tr>)}</tbody>
      </table></div>
      {editing&&list.some(r=>r.id===editing.id)&&draft?<div className="schedule-editor">
        <div className="schedule-editor-source">
          <small>What the document says</small>
          {editing.quote?<blockquote>{editing.quote}</blockquote>:<p className="note">No quoted text for this row.</p>}
          {editing.conditions.length?<ul>{editing.conditions.map((c,i)=><li key={i}>{c}</li>)}</ul>:null}
        </div>
        <div className="schedule-editor-form">
          <div className="field"><label>Plan</label><input value={draft.planName} onChange={e=>setDraft(d=>d&&({...d,planName:e.target.value}))}/></div>
          <div className="field"><label>Event</label><select value={draft.eventType} onChange={e=>setDraft(d=>d&&({...d,eventType:e.target.value}))}>{events.map(ev=><option key={ev.value} value={ev.value}>{ev.label}</option>)}</select></div>
          <div className="field"><label>Pays</label><select value={draft.paysKind} onChange={e=>setDraft(d=>d&&({...d,paysKind:e.target.value as Row["paysKind"]}))}>{KINDS.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
          {draft.paysKind!=="stated"?<div className="field"><label>{draft.paysKind==="percent_of_sum"?"Percentage":draft.paysKind==="reimbursement_cap"?"Limit (S$)":draft.paysKind==="per_day"?"Per day (S$)":draft.paysKind==="per_month"?"Per month (S$)":"Amount (S$)"}</label><input inputMode="decimal" value={draft.amount} onChange={e=>setDraft(d=>d&&({...d,amount:e.target.value}))}/></div>:null}
          {draft.paysKind==="percent_of_sum"?<div className="field"><label>Sum insured it applies to (S$)</label><input inputMode="decimal" value={draft.sumBasis} onChange={e=>setDraft(d=>d&&({...d,sumBasis:e.target.value}))}/></div>:null}
          <div className="schedule-editor-actions">
            <button className="button primary compact" disabled={busy===editing.id} onClick={()=>void save()}>Save and confirm</button>
            <button className="button secondary compact" onClick={()=>{setEditing(null);setDraft(null);}}>Cancel</button>
          </div>
          <p className="schedule-editor-note">A row you correct is kept as you wrote it. Re-reading the document never changes it.</p>
        </div>
      </div>:null}
    </section>)}
  </div>;
}

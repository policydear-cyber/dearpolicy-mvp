"use client";

import Link from "next/link";
import { useState } from "react";
import { benefitNames, bySection, keyBenefits, money, rowDetail, shortFigure, type SummaryRow } from "@/lib/benefit-table/headline";

/** Coverage from the benefit table (lib/benefit-table), as a summary to read, with nothing to confirm: for each person,
 * one card per cover with its sum insured, premium and a few key benefits, and every other benefit in a collapsed list
 * grouped by section. Each amount links to the page it is printed on. Shown only when DEARPOLICY_BENEFIT_TABLE is on. */
type Source={documentId:string;document:string;page:number;excerpt:string};
type Cover={personId:string;coverKey:string;product:string;cover:string;plan:string|null;riderOf:string|null;policyNumber:string|null;
  sumInsured:number|null;premium:number|null;premiumFrequency:string|null;startDate:string|null;endDate:string|null;currency:string|null;
  source:Source;premiumSource?:Source|null};
type Row=SummaryRow&{coverKey:string;source:Source};
type Person={id:string;name:string;covers:Cover[];rows:Row[]};
type Other={person:string;product:string;cover:string;plan:string|null;source:Source};
export type BenefitTableData={enabled:true;people:Person[];documents:{id:string;name:string;state:"read"|"waiting"|"stalled"|"held"|"table_unread"|"no_table"|"not_readable";hold?:string|null}[];
  unmatchedCovers:Other[];illustrationCovers:Other[];
  unlinkedSections:{section:{key:string;document:string;section:string|null;column:string|null};source:Source|null}[]};

const coverName=(c:{product:string;cover:string;plan:string|null;riderOf?:string|null})=>
  [c.product,c.plan&&!c.product.toLowerCase().includes(c.plan.toLowerCase())?`Plan ${c.plan}`:null].filter(Boolean).join(" · ");
const coverLine=(c:Cover)=>[c.cover!==c.product?c.cover:null,c.riderOf?`rider of ${c.riderOf}`:null,c.policyNumber?`policy ${c.policyNumber}`:null,
  c.startDate&&c.endDate?`${c.startDate} to ${c.endDate}`:c.startDate?`from ${c.startDate}`:c.endDate?`to ${c.endDate}`:null].filter(Boolean).join(" · ");
const plural=(n:number,one:string,many=one+"s")=>`${n} ${n===1?one:many}`;

/** The page a figure is printed on, opened in the stored document (the Documents page's Preview). */
function PageLink({source}:{source:Source}){
  return <a className="pg" href={`/api/policies/${source.documentId}/file#page=${source.page}`} target="_blank" rel="noopener noreferrer"
    title={`Open page ${source.page} of ${source.document}`} aria-label={`Page ${source.page} of ${source.document}`}>p.&nbsp;{source.page}</a>;
}

/** A benefit's name with its detail line, and what it pays: the cells of a key-benefit row or of a table row. */
function benefitParts(row:Row,name:(r:Row)=>string){
  const f=shortFigure(row),detail=[rowDetail(row),f.note].filter(Boolean).join(" · ");
  return {name:<>{name(row)}{detail?<small>{detail}</small>:null}</>,pays:f.text};
}

function CoverCard({cover,rows}:{cover:Cover;rows:Row[]}){
  const key=keyBenefits(rows).map(i=>rows[i]),name=benefitNames(rows);
  const premium=cover.premium!=null?`${money(cover.premium,cover.currency)}${cover.premiumFrequency?` ${cover.premiumFrequency}`:""}`:null;
  return <article className="cov-cover" data-testid="table-cover">
    <header className="cov-cover-head">
      <div className="cov-cover-name"><strong>{coverName(cover)}</strong>{coverLine(cover)?<small>{coverLine(cover)}</small>:null}</div>
      <div className="cov-si">
        <b>{cover.sumInsured!=null?money(cover.sumInsured,cover.currency):"Sum insured not printed"}</b>
        <small>{premium?<>Premium {premium} </>:null}<PageLink source={premium&&cover.premiumSource?cover.premiumSource:cover.source}/></small>
      </div>
    </header>
    {!rows.length?<p className="muted cov-reading">Its benefits are still being read.</p>:<>
      <ul className="cov-key" data-testid="table-key">{key.map((r,i)=>{const b=benefitParts(r,name);
        return <li key={i} data-testid="table-row"><span className="b">{b.name}</span><span className="v">{b.pays}</span><PageLink source={r.source}/></li>;})}</ul>
      {rows.length>key.length?<details className="cov-all"><summary>All {plural(rows.length,"benefit")}</summary>
        <table className="cov-table"><tbody>{bySection(rows).map(g=>[
          <tr className="sec" key={"s"+g.section}><th colSpan={3} scope="colgroup">{g.section}</th></tr>,
          ...g.rows.map((r,i)=>{const b=benefitParts(r,name);
            return <tr key={g.section+i}><td className="b">{b.name}</td><td className="v">{b.pays}</td><td className="p"><PageLink source={r.source}/></td></tr>;})])}
        </tbody></table></details>:null}
    </>}
  </article>;
}

/** The one control besides the page links: tell DearPolicy something looks wrong. It changes no amount. */
function TellUs({person}:{person:Person}){
  const [open,setOpen]=useState(false),[text,setText]=useState(""),[state,setState]=useState<"idle"|"sending"|"sent"|"error">("idle");
  const send=async()=>{
    setState("sending");
    const r=await fetch("/api/benefit-table/report",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({personId:person.id,message:text})}).catch(()=>null);
    setState(r?.ok?"sent":"error");
  };
  if(state==="sent")return <p className="cov-wrong muted" role="status">Thanks. We&rsquo;ll look into it.</p>;
  if(!open)return <p className="cov-wrong"><button type="button" className="link-button" onClick={()=>setOpen(true)}>Something looks wrong for {person.name}? Tell us</button></p>;
  return <form className="cov-report" onSubmit={e=>{e.preventDefault();if(text.trim())void send();}}>
    <label htmlFor={`report-${person.id}`}>What looks wrong for {person.name}?</label>
    <textarea id={`report-${person.id}`} rows={3} maxLength={1000} value={text} onChange={e=>setText(e.target.value)} placeholder="For example: the sum insured for the hospital plan should be S$1,000,000"/>
    <div className="schedule-controls">
      <button type="submit" className="button secondary compact" disabled={!text.trim()||state==="sending"}>Send</button>
      <button type="button" className="mini-button" onClick={()=>setOpen(false)}>Cancel</button>
    </div>
    {state==="error"?<p className="alert error" role="alert">That didn&rsquo;t send. Please try again.</p>:null}
  </form>;
}

export function BenefitTableCoverage({data}:{data:BenefitTableData;reload?:()=>Promise<void>}){
  // "waiting" is only a document DearPolicy is reading now; it needs nothing from the household. A document the table
  // never reads, or whose table reading was not stored, is "no_table": said not to be shown here, which claims nothing
  // about what it holds (it may well have benefits), never as unread or sent to Read again. The chat reads every ready
  // document's pages (lib/simple-chat/library.ts), so it can still be asked about.
  const waiting=data.documents.filter(d=>d.state==="waiting"),unreadable=data.documents.filter(d=>d.state==="not_readable"),
    noTable=data.documents.filter(d=>d.state==="no_table"),
    // In intake, but no job is reading it: the Documents page calls it stalled and offers Try again. Never "still being read".
    stalled=data.documents.filter(d=>d.state==="stalled"),
    // On hold for its malware scan with no scan running: the Documents page shows the hold and offers no Try again (the
    // reprocess route refuses until the scan is clean), so neither does this page. Never "still being read".
    held=data.documents.filter(d=>d.state==="held"),
    // The household's own schedule or certificate whose benefits were not read in: Read again on the Documents page reads
    // it into this page.
    tableUnread=data.documents.filter(d=>d.state==="table_unread");
  const people=data.people.filter(p=>p.covers.length);
  return <div className="page cov">
    <header className="page-header"><div>
      <div className="eyebrow">COVERAGE</div>
      <h1>Who is covered for what.</h1>
      <p className="lead">Read from your documents. Tap a page number to see where it&rsquo;s printed.</p>
    </div></header>
    {waiting.length?<div className="unread-documents" role="status"><div><strong>{waiting.length===1?"One document is":`${waiting.length} documents are`} still being read.</strong>
      <span>{waiting.map(d=>d.name).join(", ")}. {waiting.length===1?"Its benefits show":"Their benefits show"} here when DearPolicy has finished.</span></div></div>:null}
    {stalled.length?<div className="unread-documents stalled" role="status"><div><strong>{stalled.length===1?"One document hasn’t":`${stalled.length} documents haven’t`} finished reading.</strong>
      <span>{stalled.map(d=>d.name).join(", ")}. You can try again on the <Link className="text-link" href="/policies">Documents page</Link>.</span></div></div>:null}
    {held.length?<div className="unread-documents" role="status" data-testid="table-held"><div><strong>{held.length===1?"One document is on hold and hasn’t":`${held.length} documents are on hold and haven’t`} been read yet.</strong>
      <span>{held.map(d=>d.hold?`${d.name} (${d.hold})`:d.name).join(", ")}. The <Link className="text-link" href="/policies">Documents page</Link> shows {held.length===1?"its":"their"} status.</span></div></div>:null}
    {tableUnread.length?<div className="unread-documents stalled" role="status" data-testid="table-unread"><div><strong>{tableUnread.length===1?"One document’s benefits couldn’t":`${tableUnread.length} documents’ benefits couldn’t`} be read for Coverage yet.</strong>
      <span>{tableUnread.map(d=>d.name).join(", ")}. You can use Read again on the <Link className="text-link" href="/policies">Documents page</Link>.</span></div></div>:null}
    {unreadable.length?<div className="unread-documents stalled" role="status"><div><strong>{unreadable.length===1?"One document":"Some documents"} could not be read.</strong><span>{unreadable.map(d=>d.name).join(", ")}</span></div></div>:null}
    {noTable.length?<p className="muted" data-testid="table-not-shown">{noTable.map(d=>d.name).join(", ")} {noTable.length===1?"isn’t shown on this page. You can still ask about it in chat.":"aren’t shown on this page. You can still ask about them in chat."}</p>:null}
    {!people.length?<div className="empty-card">No covers yet. Upload a certificate, schedule or policy wording on the Documents page and DearPolicy reads it for you.</div>:null}
    {people.length>1?<nav className="cov-people" aria-label="People">{people.map(p=><a key={p.id} href={`#person-${p.id}`}>{p.name} <span>{p.covers.length}</span></a>)}</nav>:null}
    {people.map(person=><section className="cov-person" id={`person-${person.id}`} key={person.id} data-testid="table-person">
      <div className="cov-person-head"><h2>{person.name}</h2><span>{plural(person.covers.length,"cover")} · {plural(person.rows.length,"benefit")}</span></div>
      {person.covers.map(c=><CoverCard key={c.coverKey+c.source.documentId+c.source.page} cover={c} rows={person.rows.filter(r=>r.coverKey===c.coverKey)}/>)}
      <TellUs person={person}/>
    </section>)}
    {data.unmatchedCovers.length||data.illustrationCovers.length||data.unlinkedSections.length?<section className="cov-person" data-testid="table-also-found">
      <div className="cov-person-head"><h2>Also in your documents</h2></div>
      <ul className="cov-also">
        {data.unmatchedCovers.map((c,i)=><li key={"u"+i}><span><strong>{c.person}</strong>: {coverName(c)}. Not in your family. Add them on the <Link className="text-link" href="/family">Family page</Link> if they should be here.</span><PageLink source={c.source}/></li>)}
        {data.unlinkedSections.length?<li data-testid="table-unplaced"><details className="cov-unplaced"><summary>{data.unlinkedSections.length===1?"One part":`${data.unlinkedSections.length} parts`} of your documents couldn&rsquo;t be placed under a cover, so {data.unlinkedSections.length===1?"it isn’t":"they aren’t"} in this summary or in the chat.</summary>
          <ul>{data.unlinkedSections.map(u=><li key={u.section.key}><span>{u.section.section??"Untitled part"}{u.section.column?` (${u.section.column})`:""} <small>{u.section.document}</small></span>{u.source?<PageLink source={u.source}/>:null}</li>)}</ul></details></li>:null}
        {data.illustrationCovers.map((c,i)=><li key={"q"+i}><span><strong>{c.person}</strong>: {coverName(c)}. Only in a quotation, which is not proof of cover.</span><PageLink source={c.source}/></li>)}
      </ul>
    </section>:null}
    <p className="cov-foot">Amounts are as your documents print them, or worked out from them. They are not a payment or an insurer&rsquo;s decision.</p>
  </div>;
}

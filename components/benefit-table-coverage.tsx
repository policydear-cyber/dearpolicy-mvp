"use client";

import { Icon } from "@/components/icons";
import Link from "next/link";
import { useState } from "react";
import { benefitNames, bySection, keyBenefits, money, rowDetail, shortFigure, type SummaryRow } from "@/lib/benefit-table/headline";
import { rowsForCover } from "@/lib/benefit-table/cover-rows";
import { sharedCoverText } from "@/lib/benefit-table/shared-cover";

/** Coverage from the benefit table (lib/benefit-table), as a summary to read, with nothing to confirm: for each person,
 * one card per cover with its sum insured, premium and a few key benefits, and every other benefit in a collapsed list
 * grouped by section. Each amount links to the page it is printed on. Shown only when DEARPOLICY_BENEFIT_TABLE is on. */
type Source={documentId:string;document:string;page:number;excerpt:string};
type Cover={personId:string;coverKey:string;product:string;cover:string;plan:string|null;riderOf:string|null;policyNumber:string|null;
  sumInsured:number|null;premium:number|null;premiumFrequency:string|null;startDate:string|null;endDate:string|null;currency:string|null;
  source:Source;premiumSource?:Source|null;
  /** The currency the premium's own line or page settles; unset, the premium has the cover's currency (check.ts). */
  premiumCurrency?:string|null;};
type Row=SummaryRow&{coverKey:string;source:Source;product?:string|null};
type Person={id:string;name:string;covers:Cover[];rows:Row[];
  /** The person's schedule lines (what Home's tiles count), from GET /api/benefit-table. Optional: an older server sends none. */
  scheduleLines?:{policyId:string;category:string}[]};
type Other={person:string;product:string;cover:string;plan:string|null;source:Source};
export type BenefitTableData={enabled:true;people:Person[];documents:{id:string;name:string;state:"read"|"read_in_part"|"waiting"|"stalled"|"held"|"table_unread"|"no_table"|"not_readable";hold?:string|null;unreadPages?:number[]}[];
  unmatchedCovers:Other[];illustrationCovers:Other[];
  /** A cover printed for a name several people in the family share, not yet placed under one of them. Optional: an older server sends none. */
  ambiguousCovers?:{cover:Other;documentId:string;candidates:{id:string;name:string}[];sameName?:boolean}[];
  unlinkedSections:{section:{key:string;document:string;section:string|null;column:string|null};source:Source|null}[];
  /** Figures the figure guards could not settle (lib/benefit-table/guards.ts). Sent only with the guards switched on. */
  figureChecks?:FigureCheck[]};
type FigureCheck={status:"confirm"|"checking";field:string;claimKey:string;page:number;line:string;candidates:number[];note:string;documentId:string;document:string};

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

/** A figure with no currency, in one fixed format so server and browser renders agree (Critic R376 L2). */
const plainFigure=(n:number)=>n.toLocaleString("en-US",{minimumFractionDigits:Number.isInteger(n)?0:2,maximumFractionDigits:2});

/** reading: some document of the household is still being read, so benefits may yet arrive. With nothing being read, a
 * cover with no benefit rows is never said to be "still being read": its schedule was read, and what it pays is in a
 * document not uploaded yet (or its benefits could not be read). */
/** listedWith: no row is this cover's own or this very benefit, but another cover of the same product lists its rows
 * (lib/benefit-table/cover-rows.ts): the card points there, never asks for a wording that is already on file. */
/** shared: the cover is on a document that also covers others in the household (lib/benefit-table/shared-cover.ts). */
function CoverCard({cover,rows,reading,listedWith,shared}:{cover:Cover;rows:Row[];reading:boolean;listedWith?:Cover|null;shared?:string|null}){
  const key=keyBenefits(rows).map(i=>rows[i]),name=benefitNames(rows);
  // A premium whose line and page state no currency claims none, never a bare "$" (Critic R374 L1).
  const premiumCode=cover.premiumCurrency===undefined?cover.currency:cover.premiumCurrency;
  const premium=cover.premium!=null?`${premiumCode?money(cover.premium,premiumCode):`${plainFigure(Number(cover.premium))} (currency not stated)`}${cover.premiumFrequency?` ${cover.premiumFrequency}`:""}`:null;
  return <article className="cov-cover" data-testid="table-cover">
    <header className="cov-cover-head">
      <div className="cov-cover-name"><strong>{coverName(cover)}</strong>{coverLine(cover)?<small>{coverLine(cover)}</small>:null}</div>
      <div className="cov-si">
        <b>{cover.sumInsured!=null?money(cover.sumInsured,cover.currency):"Sum insured not printed"}</b>
        <small>{premium?<>Premium {premium} </>:null}<PageLink source={premium&&cover.premiumSource?cover.premiumSource:cover.source}/></small>
      </div>
    </header>
    {shared?<p className="muted cov-reading" data-testid="table-shared">{shared}</p>:null}
    {!rows.length?<p className="muted cov-reading">{listedWith?`What it pays is set out with ${coverName(listedWith)}${listedWith.cover!==listedWith.product?` (${listedWith.cover})`:""}, in the same policy wording.`:reading?"Its benefits are still being read.":"No benefits are listed for it yet. If you have its policy wording or benefit summary, upload it on the Documents page and DearPolicy adds what it pays."}</p>:<>
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

const FIELD_NAME:Record<string,string>={value:"Amount",cap:"Most it pays",sum_insured:"Sum insured",premium:"Premium"};
/** One figure the readers did not agree on: the printed line and page, the figures they read, and the household's answer.
 * What the household gives is final (DC, 6 Nov 2026). */
function FigureToConfirm({check,done}:{check:FigureCheck;done:()=>void}){
  const [typed,setTyped]=useState(""),[state,setState]=useState<"idle"|"sending"|"error">("idle"),[error,setError]=useState<string|null>(null);
  const send=async(value:number)=>{
    setState("sending");setError(null);
    const r=await fetch("/api/benefit-table/figure",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({documentId:check.documentId,claimKey:check.claimKey,value})}).catch(()=>null);
    if(r?.ok){done();return;}
    const body=await r?.json().catch(()=>null) as {error?:string}|null;
    setState("error");setError(body?.error??"That didn’t save. Please try again.");
  };
  const n=Number(typed.replace(/[^\d.]/g,""));
  return <li data-testid="figure-check">
    <span><strong>{FIELD_NAME[check.field]??"Figure"}</strong> in {check.document}: &ldquo;{check.line}&rdquo; <PageLink source={{documentId:check.documentId,document:check.document,page:check.page,excerpt:check.line}}/></span>
    <div className="schedule-controls">
      {check.candidates.map(c=><button key={c} type="button" className="button secondary compact" disabled={state==="sending"} onClick={()=>void send(c)}>It&rsquo;s {plainFigure(c)}</button>)}
      <input id={`fig-${check.claimKey}`} aria-label="Type the figure the page prints" inputMode="decimal" placeholder="Or type it" value={typed} onChange={e=>setTyped(e.target.value)} size={10}/>
      <button type="button" className="mini-button" disabled={!(n>0)||state==="sending"} onClick={()=>void send(n)}>Save</button>
    </div>
    {error?<p className="alert error" role="alert">{error}</p>:null}
  </li>;
}
/** The figures five readers could not agree on, document by document: shown to check, never used until the household
 * answers. Figures still being checked are counted, with nothing to do. */
function FigureChecks({checks,reload}:{checks:FigureCheck[];reload?:()=>Promise<void>}){
  const [hidden,setHidden]=useState<string[]>([]);
  const ask=checks.filter(c=>c.status==="confirm"&&!hidden.includes(c.documentId+c.claimKey)),checking=checks.filter(c=>c.status==="checking");
  if(!ask.length&&!checking.length)return null;
  return <section className="cov-person" data-testid="figure-checks">
    {ask.length?<><div className="cov-person-head"><h2>{ask.length===1?"One figure needs your check":`${ask.length} figures need your check`}</h2></div>
      <p className="muted">Five separate readings didn&rsquo;t agree on {ask.length===1?"this figure":"these figures"}, often because the print is unclear. {ask.length===1?"It isn’t":"They aren’t"} used anywhere until you say what the page prints. What you choose is kept.</p>
      <ul className="cov-also">{ask.map(c=><FigureToConfirm key={c.documentId+c.claimKey} check={c} done={()=>{setHidden(h=>[...h,c.documentId+c.claimKey]);void reload?.();}}/>)}</ul></>:null}
    {checking.length?<p className="muted" role="status" data-testid="figure-checking">{checking.length===1?"One figure is":`${checking.length} figures are`} still being checked, so {checking.length===1?"it isn’t":"they aren’t"} used yet.</p>:null}
  </section>;
}

/** A person in the family with no cover on this page: listed with their name, never silently left out. Asked to upload
 * only when nothing they may already have uploaded is on its way here: no document of the household is still being read,
 * stalled, on hold or not yet read into this table, and Home counts no schedule line of theirs (Critic #359 M1, the same
 * rule as the page's empty state). */
function NoCoverShown({person,pending}:{person:Person;pending:boolean}){
  const askUpload=!pending&&!person.scheduleLines?.length;
  return <section className="cov-person" id={`person-${person.id}`} data-testid="table-person">
    <div className="cov-person-head"><h2>{person.name}</h2></div>
    <p className="muted cov-reading" data-testid="table-person-none">No cover is shown for {person.name} from your documents yet.{askUpload?<> If a policy covers {person.name}, upload its schedule or certificate on the <Link className="text-link" href="/policies">Documents page</Link>.</>:null}</p>
    <TellUs person={person}/>
  </section>;
}

/** "page 23", "pages 4 and 23", "pages 4, 9 and 23". */
const pagesWord=(pages:number[])=>pages.length===1?`page ${pages[0]}`:`pages ${pages.slice(0,-1).join(", ")} and ${pages[pages.length-1]}`;
export function BenefitTableCoverage({data,reload}:{data:BenefitTableData;reload?:()=>Promise<void>}){
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
    tableUnread=data.documents.filter(d=>d.state==="table_unread"),
    // Read, but with pages DearPolicy could not read after several tries: the rest is shown, and those pages are named.
    readInPart=data.documents.filter(d=>d.state==="read_in_part");
  const people=data.people.filter(p=>p.covers.length);
  // Once anyone has cover here, everyone in the family is listed, so a person with none (a child with only a premium
  // record, say) is said to have none shown instead of silently missing from the page.
  const listed=people.length?data.people:[];
  return <div className="page cov">
    <header className="page-header"><div>
      <h1><span className="title-icon"><Icon name="ledger"/></span>Who is covered for what</h1>
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
    {readInPart.length?<div className="unread-documents stalled" role="status" data-testid="table-read-in-part"><div><strong>{readInPart.length===1?"One document was":`${readInPart.length} documents were`} read only in part.</strong>
      <span>{readInPart.map(d=>`${d.name} (${pagesWord(d.unreadPages??[])} not read)`).join(", ")}. Benefits on {readInPart.length===1&&(readInPart[0].unreadPages??[]).length===1?"that page aren’t":"those pages aren’t"} shown here. You can use Read again on the <Link className="text-link" href="/policies">Documents page</Link>.</span></div></div>:null}
    {unreadable.length?<div className="unread-documents stalled" role="status"><div><strong>{unreadable.length===1?"One document":"Some documents"} could not be read.</strong><span>{unreadable.map(d=>d.name).join(", ")}</span></div></div>:null}
    {data.figureChecks?.length?<FigureChecks checks={data.figureChecks} reload={reload}/>:null}
    {noTable.length?<p className="muted" data-testid="table-not-shown">{noTable.map(d=>d.name).join(", ")} {noTable.length===1?"isn’t shown on this page. You can still ask about it in chat.":"aren’t shown on this page. You can still ask about them in chat."}</p>:null}
    {/* "Upload one" only when nothing that could hold cover is on file: a household whose schedule is uploaded but not yet
        in this table is never told to upload a schedule. */}
    {!people.length?<div className="empty-card">{data.documents.some(d=>["waiting","stalled","held","table_unread"].includes(d.state))?"No covers are shown from your documents yet.":"No covers yet. Upload a certificate, schedule or policy wording on the Documents page and DearPolicy reads it for you."}</div>:null}
    {listed.length>1?<nav className="cov-people" aria-label="People">{listed.map(p=><a key={p.id} href={`#person-${p.id}`}>{p.name} <span>{p.covers.length}</span></a>)}</nav>:null}
    {listed.map(person=>!person.covers.length?<NoCoverShown key={person.id} person={person} pending={data.documents.some(d=>["waiting","stalled","held","table_unread"].includes(d.state))}/>:<section className="cov-person" id={`person-${person.id}`} key={person.id} data-testid="table-person">
      <div className="cov-person-head"><h2>{person.name}</h2><span>{plural(person.covers.length,"cover")} · {plural(person.rows.length,"benefit")}</span></div>
      {person.covers.map(c=>{const shown=rowsForCover(c,person.covers,person.rows);return <CoverCard key={c.coverKey+c.source.documentId+c.source.page} cover={c} rows={shown.rows} listedWith={shown.listedWith} reading={waiting.length>0} shared={sharedCoverText(data.people,person,c,shown.rows)}/>;})}
      <TellUs person={person}/>
    </section>)}
    {data.unmatchedCovers.length||data.illustrationCovers.length||data.unlinkedSections.length||data.ambiguousCovers?.length?<section className="cov-person" data-testid="table-also-found">
      <div className="cov-person-head"><h2>Also in your documents</h2></div>
      <ul className="cov-also">
        {(data.ambiguousCovers??[]).map((a,i)=><li key={"a"+i} data-testid="table-same-name"><span><strong>{a.cover.person}</strong>: {coverName(a.cover)}. {a.sameName===false?`This could be any of ${a.candidates.length} people in your family`:`${a.candidates.length} people in your family have this name`}, so it isn&rsquo;t under anyone yet. Choose who this document covers in <Link className="text-link" href="/policies">Documents</Link>.</span><PageLink source={a.cover.source}/></li>)}
        {data.unmatchedCovers.map((c,i)=><li key={"u"+i}><span><strong>{c.person}</strong>: {coverName(c)}. Not in your family. Add them under <Link className="text-link" href="/family">Account settings &gt; People</Link> if they should be here.</span><PageLink source={c.source}/></li>)}
        {data.unlinkedSections.length?<li data-testid="table-unplaced"><details className="cov-unplaced"><summary>{data.unlinkedSections.length===1?"One part":`${data.unlinkedSections.length} parts`} of your documents couldn&rsquo;t be placed under a cover, so {data.unlinkedSections.length===1?"it isn’t":"they aren’t"} in this summary or in the chat.</summary>
          <ul>{data.unlinkedSections.map(u=><li key={u.section.key}><span>{u.section.section??"Untitled part"}{u.section.column?` (${u.section.column})`:""} <small>{u.section.document}</small></span>{u.source?<PageLink source={u.source}/>:null}</li>)}</ul></details></li>:null}
        {data.illustrationCovers.map((c,i)=><li key={"q"+i}><span><strong>{c.person}</strong>: {coverName(c)}. Only in a quotation, which is not proof of cover.</span><PageLink source={c.source}/></li>)}
      </ul>
    </section>:null}
    <p className="cov-foot">Amounts are as your documents print them, or worked out from them. They are not a payment or an insurer&rsquo;s decision.</p>
  </div>;
}

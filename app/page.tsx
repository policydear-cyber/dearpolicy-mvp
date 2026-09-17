"use client";
import Link from "next/link";
import { useEffect,useMemo,useState } from "react";
import { formatMoney } from "@/lib/format/currency";

type Member={id:string;display_name:string;relationship:string;policy_count:number};
type Coverage={category:string;status:"covered"|"not_covered";reviewRequired:boolean;amount:number|null;displayAmount:string|null;currency:string;count:number;policyNames:string[];derived:boolean};
type PremiumItem={id:string;insurer:string|null;product_name:string|null;amount:number;currency:string;frequency:string|null;annual:number;monthly:number;shared:boolean};
type Reminder={kind:string;title:string;detail:string;href:string};
type Unclaimed={id:string;original_filename:string;product_name:string|null;insurer:string|null;document_role:string|null};
type Dashboard={family:Member[];activeMember:Member|null;coverages:Coverage[];premiums:{monthly:number;annual:number;items:PremiumItem[]};reminders:Reminder[];unclaimed:Unclaimed[];quality:{needsReview:number;referenceDocs:number;personalDocs:number};error?:string};
const icons:Record<string,string>={Hospitalisation:"✚","Hospital Cash":"▤",Death:"♥","Critical Illness":"✚","Early Critical Illness":"✦","Total Permanent Disability":"♥","Personal Accident":"✜","Disability Income":"◆",Outpatient:"+","Long-term Care":"◒",Travel:"✈",Home:"⌂",Motor:"◇",Savings:"▣",Investment:"↗"};
function money(v:number,c="SGD"){return formatMoney(v,c);}

export default function DashboardPage(){
 const [activeId,setActiveId]=useState(""),[data,setData]=useState<Dashboard|null>(null),[loading,setLoading]=useState(true);
 async function load(memberId?:string){setLoading(true);const q=memberId?`?familyMemberId=${encodeURIComponent(memberId)}`:"";let payload:Dashboard;
  try{
   const response=await fetch(`/api/dashboard${q}`);
   payload=await response.json().catch(()=>({error:"The dashboard service returned an unreadable response ("+response.status+")."}) as Dashboard);
   if(!response.ok&&!payload.error)payload={...payload,error:"The dashboard could not be loaded ("+response.status+")."};
  }catch(error){payload={error:error instanceof Error?error.message:"Could not reach DearPolicy."} as Dashboard;}
  setData(payload);if(!activeId&&payload.activeMember?.id)setActiveId(payload.activeMember.id);setLoading(false);} useEffect(()=>{void load();},[]); // eslint-disable-line react-hooks/exhaustive-deps

 // An uploaded document nobody has claimed is proof the household holds it; the
 // only thing missing is whose it is, and that is one click. Until it is
 // answered the document is used for nothing at all, which is why it is on the
 // portfolio rather than buried in the document list.
 const [claiming,setClaiming]=useState("");
 async function claim(policyId:string,familyMemberId:string){
  setClaiming(policyId);
  try{
   const response=await fetch("/api/policies/link-person",{method:"POST",headers:{"content-type":"application/json"},
     body:JSON.stringify({policyId,familyMemberId,declared:true})});
   if(!response.ok)throw new Error("Could not link that document.");
   await load(activeId||undefined);
  }catch{/* The banner already reports a failed load; nothing is lost. */}
  finally{setClaiming("");}
 }
 async function choose(id:string){setActiveId(id);await load(id);} const confirmed=useMemo(()=>data?.coverages?.filter(c=>c.status==="covered")??[],[data]);const active=data?.activeMember;
 return <div className="page dashboard-page">
  <header className="page-header portfolio-hero"><div><div className="eyebrow">YOUR FAMILY PORTFOLIO</div><h1>Know what your family has. Know what to do next.</h1><p className="lead">DearPolicy tells you what is covered and what is not covered from the policies you uploaded, then keeps the supporting evidence ready when you need it.</p></div><div className="hero-actions"><Link href="/policies" className="button secondary">Upload documents</Link><Link href="/chat" className="button primary">Ask DearPolicy</Link></div></header>
  {data?.error&&<div className="alert error" role="alert"><strong>DearPolicy could not load your portfolio.</strong><span>Something went wrong reaching your data.</span><small>Your documents are untouched. Please try refreshing in a moment — if this keeps happening, contact support.</small></div>}
  <section className="member-strip"><div className="member-strip-title"><strong>Viewing</strong><span>Choose a family member</span></div><div className="member-pills">{data?.family?.map(m=><button key={m.id} className={`member-pill ${m.id===(active?.id??activeId)?"active":""}`} onClick={()=>choose(m.id)}><span className="member-dot">{m.display_name.slice(0,1).toUpperCase()}</span><span><b>{m.display_name}</b><small>{m.relationship}</small></span></button>)}<Link className="member-pill add" href="/family">+ Add person</Link></div></section>
  <section className="summary-row"><div className="summary-card premium-feature"><div className="summary-label">Current insurance cost</div><strong>{money(data?.premiums?.monthly??0)}<small>/month</small></strong><div className="summary-sub">≈ {money(data?.premiums?.annual??0)} per year from the latest payment evidence.</div><Link href="/records" className="text-link">Payments & receipts →</Link></div><div className="summary-card"><div className="summary-label">Confirmed protection</div><strong>{confirmed.length}</strong><div className="summary-sub">categories backed by personalised, source-verified documents.</div></div><div className="summary-card"><div className="summary-label">Evidence health</div><strong>{data?.quality?.needsReview??0}</strong><div className="summary-sub">document{(data?.quality?.needsReview??0)===1?"":"s"} currently need review.</div><Link href="/policies" className="text-link">Review evidence →</Link></div></section>
  <section className="evidence-health"><span><b>{data?.quality?.personalDocs??0}</b> personal proof</span><span><b>{data?.quality?.referenceDocs??0}</b> reference documents</span><span><b>{active?.policy_count??0}</b> total linked documents</span><small>Personal documents establish which plans you own. Supporting policy wording is then used to determine the benefits included in those owned plans.</small></section>
  {!!data?.unclaimed?.length&&<section className="section unclaimed-panel"><div className="section-heading"><div><div className="eyebrow">ONE QUESTION</div><h2>Whose {data.unclaimed.length===1?"document is this":"documents are these"}?</h2></div></div>
   <p className="unclaimed-lead">You uploaded {data.unclaimed.length===1?"this":"these"}, so someone in the family holds {data.unclaimed.length===1?"it":"them"}. Until you say who, nothing in {data.unclaimed.length===1?"it is":"them is"} used to answer questions. Amounts printed inside stay marked as the document&rsquo;s own figures until a schedule or statement confirms yours.</p>
   <div className="unclaimed-list">{data.unclaimed.map(doc=><div className="unclaimed-row" key={doc.id}>
    <div><strong>{doc.product_name??doc.original_filename}</strong><span>{[doc.insurer,(doc.document_role??"").replaceAll("_"," ")].filter(Boolean).join(" · ")||doc.original_filename}</span></div>
    <div className="declare-owner">{data.family.map(m=><button key={m.id} type="button" className="button secondary" disabled={claiming===doc.id} onClick={()=>void claim(doc.id,m.id)}>{m.display_name}</button>)}</div>
   </div>)}</div></section>}
  <section className="section"><div className="section-heading"><div><div className="eyebrow">PORTFOLIO</div><h2>{active?.display_name??"Family member"}&apos;s protection</h2></div><Link href="/policies" className="text-link">Review evidence →</Link></div>
   {loading?<div className="empty-card">Updating portfolio…</div>:<div className="coverage-grid">{data?.coverages?.map(c=><Link href={`/coverage?member=${encodeURIComponent(active?.id??"")}&category=${encodeURIComponent(c.category)}`} className={`coverage-card ${c.status}`} key={c.category}><div className="coverage-top"><span className="coverage-icon">{icons[c.category]??"•"}</span><span className={`evidence-dot ${c.status}`}></span></div><div className="coverage-name">{c.category}</div>{c.status==="covered"?<><strong className="coverage-status">Covered</strong>{c.amount!=null&&<span className="coverage-amount">{money(c.amount,c.currency)}</span>}{c.displayAmount&&<span className="coverage-amount">{c.displayAmount}</span>}<small>{c.policyNames.length?c.policyNames.slice(0,2).join(" · "):`${c.count} verified coverage record${c.count===1?"":"s"}`}{c.derived?" · benefit confirmed by supporting policy wording":""}{c.reviewRequired?" · source review recommended":""}</small></>:<><strong className="coverage-status muted-status">Not covered</strong><small>No cover for this category was found in the personal policies you uploaded.</small></>}</Link>)}</div>}
  </section>
  <section className="section premium-breakdown-panel"><div className="section-heading"><div><div className="eyebrow">WHAT YOU ARE PAYING</div><h2>Current premium breakdown</h2></div><Link href="/records" className="text-link">Upload latest receipt →</Link></div><div className="premium-breakdown-list">{data?.premiums?.items.length?data.premiums.items.map(i=><div className="premium-breakdown-row" key={i.id}><div className="payment-brand">{(i.insurer??"IN").slice(0,2).toUpperCase()}</div><div><strong>{i.product_name??i.insurer??"Insurance policy"}</strong><span>{i.insurer??"Insurer"}{i.shared?" · shared/family payment":""}</span></div><div className="premium-breakdown-value"><strong>{money(i.monthly)}<small>/mo</small></strong><span>{money(i.annual)} / year</span></div></div>):<div className="empty-row">No current premium evidence yet. Upload a renewal notice or receipt.</div>}</div></section>
  <section className="dashboard-two-col"><div className="section dashboard-panel"><div className="section-heading"><div><div className="eyebrow">KEEP IT CURRENT</div><h2>To-do</h2></div></div><div className="reminder-list">{data?.reminders?.length?data.reminders.map((r,i)=><Link href={r.href} className="reminder-card" key={`${r.title}-${i}`}><span className={`reminder-icon ${r.kind}`}>{r.kind==="payment"?"$":r.kind==="family"?"◎":"!"}</span><span><strong>{r.title}</strong><small>{r.detail}</small></span><b>›</b></Link>):<div className="empty-row">Everything looks current based on the evidence you uploaded.</div>}</div></div><div className="section dashboard-panel"><div className="section-heading"><div><div className="eyebrow">WHEN LIFE HAPPENS</div><h2>Know what to do next</h2></div></div><Link href={`/chat${active?.id?`?member=${active.id}`:""}`} className="incident-card"><span className="incident-mark">!</span><span><strong>Something happened</strong><small>Tell DearPolicy what happened. It will first ask only the facts that can change eligibility or payout, then check confirmed personal cover and calculate the relevant benefits.</small></span><b>→</b></Link></div></section>
 </div>;
}

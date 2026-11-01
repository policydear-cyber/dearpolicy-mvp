"use client";
import Link from "next/link";
import { useEffect,useMemo,useRef,useState } from "react";
import { formatMoney } from "@/lib/format/currency";
import { premiumSourceCaption } from "@/lib/format/premium-source";
import { customerError } from "@/components/customer-text";
import { HomeAttention } from "@/components/home-attention";
import { homeView } from "@/lib/format/home-view";

type Member={id:string;display_name:string;relationship:string;policy_count:number};
type Coverage={category:string;status:"covered"|"not_covered";reviewRequired:boolean;amount:number|null;displayAmount:string|null;currency:string|null;count:number;policyNames:string[];derived:boolean;parts?:TilePart[]|null;known?:KnownSum|null;planNote?:string|null};
type TilePart={name:string;amount:number|null;currency:string|null;accelerates?:boolean;conditional?:boolean;period?:string|null;noFigure?:boolean};
type KnownSum={amount:number;currency:string;without:string[];otherTile?:string[]};
type PremiumItem={id:string;insurer:string|null;product_name:string|null;amount:number;currency:string;currencyStated?:boolean;frequency:string|null;annual:number;monthly:number;shared:boolean;fromTable?:boolean;detail?:string|null;source?:string|null};
type Reminder={kind:string;title:string;detail:string;href:string};
type Unclaimed={id:string;original_filename:string;product_name:string|null;insurer:string|null;document_role:string|null};
type Dashboard={family:Member[];activeMember:Member|null;coverages:Coverage[];reading?:number;premiums:{monthly:number|null;annual:number|null;currency?:string|null;totals?:{currency:string;monthly:number;annual:number}[];items:PremiumItem[]};reminders:Reminder[];unclaimed:Unclaimed[];quality:{needsReview:number;referenceDocs:number;personalDocs:number};notFullyRead?:string|null;error?:string};
const icons:Record<string,string>={Hospitalisation:"✚","Hospital Cash":"▤",Death:"♥","Critical Illness":"✚","Early Critical Illness":"✦","Total Permanent Disability":"♥","Personal Accident":"✜","Disability Income":"◆",Outpatient:"+","Long-term Care":"◒",Travel:"✈",Home:"⌂",Motor:"◇",Savings:"▣",Investment:"↗"};
// The currency the document states, or none: never a default (RM180 is not S$180).
function money(v:number,c:string|null|undefined){return formatMoney(v,c);}
// A premium is shown in its record's currency only when the record states one.
const premiumMoney=(i:PremiumItem,v:number)=>money(v,i.currencyStated===false?null:i.currency);
// One figure per currency: premiums in two currencies are never added into one.
const perCurrency=(totals:{currency:string;monthly:number;annual:number}[],k:"monthly"|"annual")=>totals.map(t=>money(t[k],t.currency)).join(" + ");
// Each policy's sum on a lump-sum tile, so the person sees what every policy gives; one with no sum read says where to look.
function partsText(parts:TilePart[]){const name=(n:string)=>n.replace(/\s*\((?:group\s+)?policy\s+no\.?[^)]*\)/gi,"").trim();return (parts.some(p=>p.period)?"Each policy: ":"Sum insured: ")+parts.map(p=>(p.amount!=null?`${name(p.name)} ${money(p.amount,p.currency)}${p.period?` a ${p.period}`:""}`:p.noFigure?`${name(p.name)}: see the document for how much it pays`:`${name(p.name)}: amount on Coverage`)+(p.conditional?" (conditions apply)":"")+(p.accelerates?" (paid instead of the death benefit)":"")).join(" · ");}

export default function DashboardPage(){
 const [activeId,setActiveId]=useState(""),[data,setData]=useState<Dashboard|null>(null),[loading,setLoading]=useState(true);
 // Only the newest request may change the page, so a late quiet re-fetch never shows a person the household has since
 // switched away from; quiet re-fetches follow whoever is chosen now (want), and say so (poll=1) so they start no reading.
 const seq=useRef(0),want=useRef<string|undefined>(undefined);
 async function load(memberId?:string,quiet=false){const n=++seq.current;if(!quiet)setLoading(true);const params=new URLSearchParams();if(memberId)params.set("familyMemberId",memberId);if(quiet)params.set("poll","1");
  const q=params.toString()?`?${params}`:"";let payload:Dashboard;
  try{
   const response=await fetch(`/api/dashboard${q}`);
   payload=await response.json().catch(()=>({error:"The dashboard service returned an unreadable response ("+response.status+")."}) as Dashboard);
   if(!response.ok&&!payload.error)payload={...payload,error:"The dashboard could not be loaded ("+response.status+")."};
  }catch{payload={error:"unavailable"} as Dashboard;}
  if(n!==seq.current)return;setData(payload);if(!want.current&&payload.activeMember?.id)want.current=payload.activeMember.id;if(!activeId&&payload.activeMember?.id)setActiveId(payload.activeMember.id);setLoading(false);} useEffect(()=>{void load();},[]); // eslint-disable-line react-hooks/exhaustive-deps
 // The tiles follow the documents: while one is still being read, fetch again quietly until its cover shows (for at most
 // ten minutes), and fetch again whenever the page comes back into view, so a policy uploaded elsewhere shows here.
 const readingSince=useRef<number|null>(null);
 useEffect(()=>{if(!data?.reading){readingSince.current=null;return;}readingSince.current??=Date.now();if(Date.now()-readingSince.current>600000)return;
  const timer=setTimeout(()=>{void load(want.current,true);},8000);return()=>clearTimeout(timer);},[data]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{const onVisible=()=>{if(document.visibilityState==="visible")void load(want.current,true);};document.addEventListener("visibilitychange",onVisible);
  return()=>document.removeEventListener("visibilitychange",onVisible);},[]); // eslint-disable-line react-hooks/exhaustive-deps

 // An uploaded document nobody has claimed is proof the household holds it; the
 // only thing missing is whose it is, and that is one click. Until it is
 // answered the document is used for nothing at all, which is why it is on the
 // portfolio rather than buried in the document list.
 const [claiming,setClaiming]=useState("");
 const [claimError,setClaimError]=useState("");
 async function claim(policyId:string,familyMemberId:string){
  setClaiming(policyId);setClaimError("");
  try{
   const response=await fetch("/api/policies/link-person",{method:"POST",headers:{"content-type":"application/json"},
     body:JSON.stringify({policyId,familyMemberId,declared:true})});
   const payload=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(payload.error||"Could not link that document.");
   await load(want.current);
  }catch(error){setClaimError(customerError(error,"Could not link that document. Please try again in a moment."));}
  finally{setClaiming("");}
 }
 async function choose(id:string){want.current=id;setActiveId(id);await load(id);} const confirmed=useMemo(()=>data?.coverages?.filter(c=>c.status==="covered")??[],[data]);const active=data?.activeMember;
 // Nothing uploaded yet: no cost, no "everything looks current", no
 // per-person protection grid -- just the next step.
 const documentCount=(data?.quality?.personalDocs??0)+(data?.quality?.referenceDocs??0)+(data?.unclaimed?.length??0);
 // The welcome is for a household with nothing on file. Choosing a person who has nothing yet (a child just added) keeps
 // the household's page, and says so for that person, with any premium already found for them.
 const view=homeView({personDocs:documentCount-(data?.unclaimed?.length??0),family:data?.family??[],unclaimed:data?.unclaimed?.length??0,covered:confirmed.length,premiums:data?.premiums?.items??[]});
 const emptyPortfolio=!loading&&!data?.error&&!!data&&view.empty;
 const returning=!!data&&!data.error&&!view.empty;
 const personEmpty=returning&&view.personEmpty;
 return <div className="page dashboard-page">
  {/* A returning household lands on what changed, what needs them and a box to ask; the welcome is for a first visit. */}
  {returning?<header className="page-header portfolio-hero compact"><div><div className="eyebrow">YOUR FAMILY PORTFOLIO</div><h1>Your family&rsquo;s cover at a glance</h1></div><div className="hero-actions"><Link href="/policies" className="button secondary">Upload documents</Link></div></header>
  :<header className="page-header portfolio-hero"><div><div className="eyebrow">YOUR FAMILY PORTFOLIO</div><h1>Know what your family has. Know what to do next.</h1><p className="lead">DearPolicy shows what your uploaded policies cover, with the page each answer comes from, ready for when you need it.</p></div><div className="hero-actions"><Link href="/policies" className="button secondary">Upload documents</Link><Link href="/chat" className="button primary">Ask DearPolicy</Link></div></header>}
  {returning&&<HomeAttention memberId={active?.id}/>}
  {data?.error&&<div className="alert error" role="alert"><strong>DearPolicy could not load your portfolio.</strong><span>Something went wrong reaching your data.</span><small>Your documents are untouched. Please try refreshing in a moment — if this keeps happening, contact support.</small></div>}
  <section className="member-strip"><div className="member-strip-title">{data?.family?.length?<><strong>Viewing</strong><span>Choose a family member</span></>:<><strong>Your family</strong><span>Add the people your policies cover</span></>}</div><div className="member-pills">{data?.family?.map(m=><button key={m.id} className={`member-pill ${m.id===(active?.id??activeId)?"active":""}`} onClick={()=>choose(m.id)}><span className="member-dot">{m.display_name.slice(0,1).toUpperCase()}</span><span><b>{m.display_name}</b><small>{m.relationship}</small></span></button>)}<Link className="member-pill add" href="/family">+ Add person</Link></div></section>
  {!emptyPortfolio&&<>
  <section className="summary-row"><div className="summary-card premium-feature"><div className="summary-label">Current insurance cost</div>{data?.premiums?.totals?.length?<><strong>{perCurrency(data.premiums.totals,"monthly")}<small>/month</small></strong><div className="summary-sub">≈ {perCurrency(data.premiums.totals,"annual")} per year {premiumSourceCaption(data.premiums.items.map(i=>i.source))}.</div></>:data?.premiums?.items?.length?<><strong className="summary-unknown">Not added up</strong><div className="summary-sub">The premiums on file don’t say which currency they are in. Payments lists each one.</div></>:<><strong className="summary-unknown">Not known yet</strong><div className="summary-sub">Add a premium notice or receipt to see what your cover costs.</div></>}<Link href="/records" className="text-link">Payments & receipts →</Link></div><div className="summary-card"><div className="summary-label">Cover found</div><strong>{confirmed.length}</strong><div className="summary-sub">{confirmed.length===1?"type":"types"} of cover found in {active?.display_name?`${active.display_name}’s`:"your"} own policies.</div></div><div className="summary-card"><div className="summary-label">{active?.display_name?`Documents for ${active.display_name}`:"Your documents"}</div><strong>{(data?.quality?.personalDocs??0)+(data?.quality?.referenceDocs??0)}</strong><div className="summary-sub">{data?.unclaimed?.length?"One question about them is waiting below.":"uploaded and read."}</div><Link href="/policies" className="text-link">Documents →</Link></div></section>
  </>}
  {!!data?.unclaimed?.length&&<section className="section unclaimed-panel"><div className="section-heading"><div><div className="eyebrow">ONE QUESTION</div><h2>Whose {data.unclaimed.length===1?"document is this":"documents are these"}?</h2></div></div>
   <p className="unclaimed-lead">You uploaded {data.unclaimed.length===1?"this":"these"}, so someone in the family holds {data.unclaimed.length===1?"it":"them"}. Until you say who, nothing in {data.unclaimed.length===1?"it is":"them is"} used to answer questions. Amounts printed inside stay marked as the document&rsquo;s own figures until a schedule or statement confirms yours.</p>
   <p className="muted">Covers more than one person, like a group booklet? <Link href="/policies" className="text-link">Choose everyone it covers on the Documents page →</Link></p>
   {claimError&&<div className="alert error" role="alert">{claimError}</div>}
   <div className="unclaimed-list">{data.unclaimed.map(doc=><div className="unclaimed-row" key={doc.id}>
    <div><strong>{doc.product_name??doc.original_filename}</strong><span>{[doc.insurer,(doc.document_role??"").replaceAll("_"," ")].filter(Boolean).join(" · ")||doc.original_filename}</span></div>
    <div className="declare-owner">{data.family.map(m=><button key={m.id} type="button" className="button secondary" disabled={claiming===doc.id} onClick={()=>void claim(doc.id,m.id)}>{m.display_name}</button>)}</div>
   </div>)}</div></section>}
  {emptyPortfolio?<EmptyPortfolio hasFamily={!!data?.family?.length}/>:<>
  <section className="section"><div className="section-heading"><div><div className="eyebrow">PORTFOLIO</div><h2>{active?.display_name?`${active.display_name}\u2019s protection`:"Your family\u2019s protection"}</h2></div><div className="section-links"><Link href={active?.id?`/ledger?member=${encodeURIComponent(active.id)}`:"/ledger"} className="text-link">Coverage, by person →</Link><Link href="/schedule" className="text-link">Benefits, by policy →</Link></div></div>
   {!loading&&!!data?.reading&&<p className="summary-sub">{data.reading===1?"A document is":`${data.reading} documents are`} still being read. These tiles update on their own when it is done.</p>}
   {loading?<div className="empty-card">Updating portfolio…</div>:personEmpty?<PersonNothingYet name={active?.display_name??"This person"} paidFor={view.paidFor}/>:<div className="coverage-grid">{data?.coverages?.map(c=><Link href={`/coverage?member=${encodeURIComponent(active?.id??"")}&category=${encodeURIComponent(c.category)}`} className={`coverage-card ${c.status}`} key={c.category}><div className="coverage-top"><span className="coverage-icon">{icons[c.category]??"•"}</span><span className={`evidence-dot ${c.status}`}></span></div><div className="coverage-name">{c.category}</div>{c.status==="covered"?<><strong className="coverage-status">Covered</strong>{c.amount!=null&&<span className="coverage-amount">{money(c.amount,c.currency)}</span>}{c.amount!=null&&((c.parts?.length??0)>1||c.parts?.some(p=>p.conditional))&&<small>{(c.parts?.length??0)>1?"Each policy’s sum insured, added up. ":"Sum insured. "}What is paid depends on each policy’s own terms.</small>}{c.displayAmount&&<span className="coverage-amount">{c.displayAmount}</span>}{c.amount==null&&c.known&&<><span className="coverage-amount">{money(c.known.amount,c.known.currency)}</span><small>{"Only policies with a fixed sum. Not included: "}{[c.known.without.length?`${c.known.without.join(", ")} (no fixed sum, see Coverage)`:null,c.known.otherTile?.length?`${c.known.otherTile.join(", ")} (pays only in some cases, see its own tile)`:null].filter(Boolean).join("; ")}.</small></>}{c.planNote&&<small>{c.planNote}</small>}<small>{c.parts?.length?partsText(c.parts):c.policyNames.length?c.policyNames.slice(0,2).join(" · "):"From your uploaded documents"}{c.derived?" · benefit shown in the plan’s policy wording":""}</small></>:<>{<><strong className="coverage-status muted-status">Not found</strong><small>{data?.notFullyRead?`Not found in what DearPolicy could read. ${data.notFullyRead}`:"Not found in the personal policies you uploaded. A policy you have not uploaded may still include it."}</small></>}</>}</Link>)}</div>}
  </section>
  <section className="section premium-breakdown-panel"><div className="section-heading"><div><div className="eyebrow">WHAT YOU ARE PAYING</div><h2>Current premium breakdown</h2></div><Link href="/records" className="text-link">Upload latest receipt →</Link></div><div className="premium-breakdown-list">{data?.premiums?.items.length?data.premiums.items.map(i=><div className="premium-breakdown-row" key={i.id}><div className="payment-brand">{(i.insurer??"IN").slice(0,2).toUpperCase()}</div><div><strong>{i.product_name??i.insurer??"Insurance policy"}</strong><span>{i.insurer??(i.fromTable?"From your policy document":"Insurer")}{i.shared?" · shared/family payment":""}{i.detail?` · ${i.detail}`:""}</span></div><div className="premium-breakdown-value"><strong>{premiumMoney(i,i.monthly)}<small>/mo</small></strong><span>{premiumMoney(i,i.annual)} / year</span></div></div>):<div className="empty-row">No current premium evidence yet. Upload a renewal notice or receipt.</div>}</div></section>
  <section className="dashboard-two-col"><div className="section dashboard-panel"><div className="section-heading"><div><div className="eyebrow">KEEP IT CURRENT</div><h2>To-do</h2></div></div><div className="reminder-list">{data?.reminders?.length?data.reminders.map((r,i)=><Link href={r.href} className="reminder-card" key={`${r.title}-${i}`}><span className={`reminder-icon ${r.kind}`}>{r.kind==="payment"?"$":r.kind==="family"?"◎":"!"}</span><span><strong>{r.title}</strong><small>{r.detail}</small></span><b>›</b></Link>):<div className="empty-row">Everything looks current based on the evidence you uploaded.</div>}</div></div><div className="section dashboard-panel"><div className="section-heading"><div><div className="eyebrow">WHEN LIFE HAPPENS</div><h2>Know what to do next</h2></div></div><Link href={`/chat${active?.id?`?member=${active.id}`:""}`} className="incident-card"><span className="incident-mark">!</span><span><strong>Something happened</strong><small>Tell DearPolicy what happened. It asks only what matters, one question at a time, and shows which of your policies may respond.</small></span><b>→</b></Link></div></section>
  </>}
 </div>;
}

/** One person with no document on file in a household that has some: what to upload for them, never "not covered". */
function PersonNothingYet({name,paidFor}:{name:string;paidFor:string[]}){
 const list=paidFor.length>1?`${paidFor.slice(0,-1).join(", ")} and ${paidFor[paidFor.length-1]}`:paidFor[0];
 return <div className="empty-card" data-testid="person-nothing-yet"><strong>No policy document for {name} is on file yet.</strong>
  <p>{paidFor.length?<>DearPolicy found a premium for {list}, so {name} may hold cover it has not read. Upload {paidFor.length>1?"their":"its"} policy schedule or certificate to see what {paidFor.length>1?"they cover":"it covers"}.</>:<>Upload a policy schedule or certificate that names {name} to see what it covers.</>}</p>
  <Link href="/policies" className="button primary">Upload a document</Link></div>;
}

/** The portfolio before anything is uploaded: what to do first, in order. */
function EmptyPortfolio({hasFamily}:{hasFamily:boolean}){
 return <section className="section empty-portfolio" data-testid="empty-portfolio">
  <div className="section-heading"><div><div className="eyebrow">GET STARTED</div><h2>Your portfolio is empty for now.</h2></div></div>
  <p className="lead">Once DearPolicy has read your policies, this page shows what each person is covered for, what you pay, and what needs attention.</p>
  <ol className="getting-started">
   <li className={hasFamily?"done":""}><strong>{hasFamily?"Family added ✓":"Add the people in your family"}</strong><span>So DearPolicy knows whose cover is whose.</span>{!hasFamily&&<Link href="/family" className="button primary">Add family members</Link>}</li>
   <li><strong>Upload a policy document</strong><span>A policy schedule, certificate, renewal notice or benefits booklet — a PDF, a scan or a photo.</span>{hasFamily&&<Link href="/policies" className="button primary">Upload a document</Link>}</li>
   <li><strong>Ask a question</strong><span>For example, what someone is covered for, or what to do after an accident.</span></li>
  </ol>
 </section>;
}

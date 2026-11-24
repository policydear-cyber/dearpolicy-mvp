"use client";
import Link from "next/link";
import { useEffect,useMemo,useRef,useState } from "react";
import { customerError } from "@/components/customer-text";
import { useCanManageHousehold } from "@/components/household-role";
import { documentCardTitle } from "@/lib/policies/document-name";
import { HomeAsk, HomeAttention } from "@/components/home-attention";
import { HomeNotFound, homeGaps } from "@/components/home-not-found";
import { HomePolicyDates } from "@/components/home-policy-dates";
import { homeView } from "@/lib/format/home-view";
import { Icon, coverCard, coverIcon, type IconName } from "@/components/icons";
import { homeCardSource, homeGridColumns } from "@/lib/coverage/home-card";
import { UpgradePrompt } from "@/components/plan-status";

type Member={id:string;display_name:string;relationship:string;policy_count:number};
type Coverage={category:string;status:"covered"|"on_file"|"not_covered";reviewRequired:boolean;amount:number|null;displayAmount:string|null;currency:string|null;count:number;policyNames:string[];sources?:string[];derived:boolean;parts?:TilePart[]|null;known?:KnownSum|null;planNote?:string|null;onFileDocuments?:string[]};
type TilePart={name:string;amount:number|null;currency:string|null;accelerates?:boolean;conditional?:boolean;period?:string|null;noFigure?:boolean};
type KnownSum={amount:number;currency:string;without:string[];otherTile?:string[]};
type PremiumItem={id:string;insurer:string|null;product_name:string|null;amount:number;currency:string;currencyStated?:boolean;frequency:string|null;annual:number;monthly:number;shared:boolean;fromTable?:boolean;detail?:string|null;source?:string|null};
type Reminder={kind:string;title:string;detail:string;href:string};
type Unclaimed={id:string;original_filename:string;product_name:string|null;insurer:string|null;document_role:string|null};
type Dashboard={family:Member[];activeMember:Member|null;coverages:Coverage[];reading?:number;premiums:{monthly:number|null;annual:number|null;currency?:string|null;note?:string|null;totals?:{currency:string;monthly:number;annual:number}[];items:PremiumItem[]};reminders:Reminder[];unclaimed:Unclaimed[];quality:{needsReview:number;referenceDocs:number;personalDocs:number};notFullyRead?:string|null;gapsPending?:boolean;error?:string};
// A card shows a figure only in the currency its document states, never a default (RM180 is not S$180).
// A heading with its icon in front, in place of the uppercase label that used to sit above it.
const Titled=({icon,children}:{icon:IconName;children:React.ReactNode})=><div className="icon-heading"><span className="title-icon"><Icon name={icon}/></span>{children}</div>;

export default function DashboardPage(){
 const [activeId,setActiveId]=useState(""),[data,setData]=useState<Dashboard|null>(null),[loading,setLoading]=useState(true);
 // Only the newest request may change the page, so a late quiet re-fetch never shows a person the household has since
 // switched away from; quiet re-fetches follow whoever is chosen now (want), and say so (poll=1) so they start no reading.
 const seq=useRef(0),want=useRef<string|undefined>(undefined);
 // Whether Home's ask box is on screen, so the phone's floating Ask button can step aside instead of covering it.
 const [askInView,setAskInView]=useState(false);
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
 // Only the household owner says whose a document is (components/household-role); a member is told who can.
 const canManage=useCanManageHousehold();
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
 // Re-run when the empty view gives way to Home, whose ask box is a new element.
 useEffect(()=>{if(typeof IntersectionObserver==="undefined")return;let io:IntersectionObserver|null=null;const watch=()=>{const box=document.getElementById("ask");if(!box)return false;io=new IntersectionObserver(([e])=>setAskInView(!!e?.isIntersecting),{threshold:.15});io.observe(box);return true;};
  if(watch())return()=>io?.disconnect();let tries=0;const t=window.setInterval(()=>{if(watch()||++tries>=20)window.clearInterval(t);},500);return()=>{window.clearInterval(t);io?.disconnect();};},[emptyPortfolio]);
 const returning=!!data&&!data.error&&!view.empty;
 const personEmpty=returning&&view.personEmpty;
 const name=active?.display_name??null;
 const covered=(data?.coverages??[]).filter(c=>c.status==="covered");
 const people=<section className="member-strip"><div className="member-pills" role="group" aria-label="Whose cover">{data?.family?.map((m,i)=><button key={m.id} data-person={i%4} aria-pressed={m.id===(active?.id??activeId)} className={`member-pill ${m.id===(active?.id??activeId)?"active":""}`} onClick={()=>choose(m.id)}><span className="member-dot">{m.display_name.slice(0,1).toUpperCase()}</span><span><b>{m.display_name}</b><small>{m.relationship}</small></span></button>)}{canManage&&<Link className="member-pill add" href="/family"><Icon name="plus"/> Add person</Link>}</div></section>;
 return <div className="page dashboard-page">
  {data?.error&&<div className="alert error" role="alert"><strong>DearPolicy couldn&rsquo;t load your family&rsquo;s cover just now.</strong><small>Your documents are safe. Please refresh the page in a moment.</small></div>}
  {emptyPortfolio?<>
   {/* A new household gets one thing to do at a time: the steps below carry the only button, so nothing on the page sends
       them to Ask before there is a document to ask about. */}
   <header className="page-header portfolio-hero"><div><h1>Let&rsquo;s read your first policy.</h1><p className="lead">Upload your family&rsquo;s insurance documents. DearPolicy shows who is covered for what, and answers your questions with the page each answer comes from.</p></div></header>
   {!!data?.family?.length&&people}
   <EmptyPortfolio hasFamily={!!data?.family?.length}/>
  </>:<>
  {/* The person's protection cards come first, with the ask box beside them (DC 16 Nov): what each person has, and the
      main feature, before anything else. Each card is covered, with its amount only when the amount is confirmed, and
      names what pays, so a card with no single amount is never an empty box (DC 17 Nov); the evidence and every figure
      are one tap away on Coverage. A cover no document gives this person has no card. */}
  <div className="home-top">
   <section className="home-cards" aria-labelledby="home-cards-title">
    <div className="home-cards-head"><h1 id="home-cards-title">{name?`${name}\u2019s protection`:"Your family\u2019s protection"}</h1>{canManage&&<Link href="/policies" className="text-link"><Icon name="upload"/>Upload</Link>}</div>
    {people}
    {!loading&&!!data?.reading&&<p className="summary-sub">{data.reading===1?"A document is":`${data.reading} documents are`} still being read. This page updates on its own when reading is done.</p>}
    {loading&&!data?<div className="empty-card home-loading" role="status">Loading…</div>:personEmpty?<PersonNothingYet name={name??"This person"} paidFor={view.paidFor}/>:covered.length?<div className="coverage-grid" data-testid="home-cards" data-cols={homeGridColumns(covered.length)}>{covered.map(c=>{const source=homeCardSource(c);return <Link href={`/coverage?member=${encodeURIComponent(active?.id??"")}&category=${encodeURIComponent(c.category)}`} className="coverage-card covered" data-card={coverCard(c.category)} key={c.category}><div className="coverage-top"><span className="coverage-icon"><Icon name={coverIcon(c.category)}/></span><div className="coverage-name">{c.category}</div></div>{source&&<span className="coverage-source" title={source}>{source}</span>}<strong className="coverage-status"><Icon name="checkCircle"/>Covered</strong></Link>;})}</div>
     :<div className="empty-card" data-testid="home-no-cards">{(active?.policy_count??0)>0?<>No cover card for {name??"this person"} yet. {active!.policy_count===1?"Their document is":`Their ${active!.policy_count} documents are`} on file: <Link href={`/chat?member=${encodeURIComponent(active!.id)}`} className="text-link">ask DearPolicy what {active!.policy_count===1?"it covers":"they cover"}</Link> or <Link href="/policies" className="text-link">open Documents</Link>.</>:<>No document for {name??"this person"} is on file yet. <Link href="/policies" className="text-link">Upload a policy</Link></>}</div>}
    {/* Gaps (DC 17 Nov): the main kinds of cover with no card, once the person has a card and nothing is still being read,
        so a gap is never shown for a document DearPolicy has not finished. Never "not covered". */}
    {!loading&&!personEmpty&&covered.length>0&&!data?.reading&&<HomeNotFound {...homeGaps(data?.coverages??[],active?.relationship)} memberId={active?.id??""} name={name} note={data?.notFullyRead} pending={data?.gapsPending===true}/>}
    {/* When each policy ends, as printed; a passed date asks for proof of renewal (DC 19 Nov). */}
    {!loading&&!personEmpty&&returning&&<HomePolicyDates memberId={active?.id} onChanged={()=>void load(want.current,true)}/>}
   </section>
   <HomeAsk memberId={active?.id} name={name}/>
  </div>
  {!!data?.unclaimed?.length&&<section className="section unclaimed-panel"><div className="section-heading"><div><Titled icon="person"><h2>Whose {data.unclaimed.length===1?"document is this":"documents are these"}?</h2></Titled></div></div>
   <p className="unclaimed-lead">{canManage?<>Choose who {data.unclaimed.length===1?"this document belongs":"these documents belong"} to. Until you do</>:<>The household owner can choose who {data.unclaimed.length===1?"this document belongs":"these documents belong"} to. Until they do</>}, DearPolicy doesn&rsquo;t use {data.unclaimed.length===1?"it":"them"}.</p>
   {canManage&&<p className="muted">Covers more than one person, like a group booklet? <Link href="/policies" className="text-link">Choose everyone it covers on the Documents page →</Link></p>}
   {claimError&&<div className="alert error" role="alert">{claimError}</div>}
   <div className="unclaimed-list">{data.unclaimed.map(doc=><div className="unclaimed-row" key={doc.id}>
    <div><strong>{documentCardTitle(doc)}</strong><span>{[doc.insurer,(doc.document_role??"").replaceAll("_"," ")].filter(Boolean).join(" · ")}</span></div>
    {canManage&&<div className="declare-owner">{data.family.map(m=><button key={m.id} type="button" className="button secondary" disabled={claiming===doc.id} onClick={()=>void claim(doc.id,m.id)}>{m.display_name}</button>)}</div>}
   </div>)}</div></section>}
  {returning&&<HomeAttention/>}
  {/* One short upgrade line for an owner on Free, after what the household came for (components/plan-status.tsx). */}
  {returning&&<UpgradePrompt place="home"/>}
  </>}
  {/* Phone: Ask stays one tap away, but steps aside while Home's own ask box is on screen, and an empty household has
      nothing to ask about yet (its first step is to add people or upload), so the button never covers that box or a step. */}
  {!emptyPortfolio&&<Link href={`/chat${active?.id?`?member=${encodeURIComponent(active.id)}`:""}`} className="home-ask-fab button primary" aria-label="Ask DearPolicy" data-hidden={askInView?"true":undefined} aria-hidden={askInView?true:undefined} tabIndex={askInView?-1:undefined}><Icon name="ask"/>Ask DearPolicy</Link>}
 </div>;
}

/** One person with no document on file in a household that has some: what to upload for them, never "not covered". */
function PersonNothingYet({name,paidFor}:{name:string;paidFor:string[]}){
 const list=paidFor.length>1?`${paidFor.slice(0,-1).join(", ")} and ${paidFor[paidFor.length-1]}`:paidFor[0];
 return <div className="empty-card" data-testid="person-nothing-yet"><strong>No policy document for {name} is on file yet.</strong>
  <p>{paidFor.length?<>DearPolicy found a premium for {list}, so {name} may hold cover it has not read. Upload {paidFor.length>1?"their":"its"} policy schedule or certificate to see what {paidFor.length>1?"they cover":"it covers"}.</>:<>Upload a policy schedule or certificate that names {name} to see what it covers.</>}</p>
  <Link href="/policies" className="button primary"><Icon name="upload"/>Upload a document</Link></div>;
}

/** The portfolio before anything is uploaded: what to do first, in order. */
function EmptyPortfolio({hasFamily}:{hasFamily:boolean}){
 // The step to do now is a white sheet with the page's one button; a step done is ticked; a step still to come is an
 // empty dashed slot, like a sheet not yet in the wallet.
 const state=(n:number)=>n<(hasFamily?2:1)?"done":n===(hasFamily?2:1)?"current":"later";
 return <section className="section empty-portfolio" data-testid="empty-portfolio">
  <h2 className="sr-only">Getting started</h2>
  <p className="lead">Three steps to get started. Once DearPolicy has read your documents, this page shows what each person is covered for, what you pay, and anything that needs you.</p>
  <ol className="getting-started">
   <li className={state(1)}><span className="step-mark" aria-hidden="true">{hasFamily?<Icon name="check"/>:"1"}</span><div><strong><Icon name={hasFamily?"checkCircle":"family"}/>{hasFamily?"Family added":"Add the people in your family"}</strong><span>So DearPolicy knows whose cover is whose.</span>{!hasFamily&&<Link href="/family" className="button primary">Add family members</Link>}</div></li>
   <li className={state(2)}><span className="step-mark" aria-hidden="true">2</span><div><strong><Icon name="upload"/>Upload a policy document</strong><span>A policy schedule, certificate, renewal notice or benefits booklet. A PDF, a scan or a photo is fine.</span>{hasFamily&&<Link href="/policies" className="button primary">Upload a document</Link>}</div></li>
   <li className={state(3)}><span className="step-mark" aria-hidden="true">3</span><div><strong><Icon name="ask"/>Ask a question</strong><span>In your own words. For example, &ldquo;Is my son covered if he breaks his arm?&rdquo; or &ldquo;What should I do after a car accident?&rdquo;</span></div></li>
  </ol>
 </section>;
}

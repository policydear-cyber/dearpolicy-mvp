"use client";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { useEffect,useState } from "react";
import { sgDate } from "@/components/format-date";

/** The household-facing status of a claim. Rendered ONLY from
 * claimDisplayStatus() (lib/claims/status.ts, shared interface 4), which the
 * claims API attaches to every claim as `display` -- the same function feeds
 * the claim detail page, so the list and the detail can never disagree
 * ("Assessment ready" beside "No estimate yet"), and the documents asked for
 * are the ones this claim's event needs (never death documents for a
 * fracture). */
type ClaimDisplay={label:string;tone:"info"|"waiting"|"ready";hasEstimate:boolean;requestedDocuments:string[];detail?:string};
type Claim={id:string;family_member_id:string;conversation_id?:string|null;display_name:string;relationship:string;event_summary:string|null;updated_at:string;display?:ClaimDisplay|null};

/** Until a claim carries its display status, nothing is claimed about it. */
const UNKNOWN:ClaimDisplay={label:"Open",tone:"info",hasEstimate:false,requestedDocuments:[]};

export default function ClaimsPage(){
 const [claims,setClaims]=useState<Claim[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(false);
 useEffect(()=>{fetch("/api/claims",{cache:"no-store"}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok||d.error)throw new Error("load");setClaims(d.claims??[]);}).catch(()=>setError(true)).finally(()=>setLoading(false));},[]);
 return <div className="page"><header className="page-header"><div><h1><span className="title-icon"><Icon name="claims"/></span>Past events</h1><p className="lead">Events you asked DearPolicy about, and what your documents say. Pick up where you left off.</p></div><Link href="/chat" className="button primary"><Icon name="plus"/>Ask about something new</Link></header>
 {error&&<div className="alert error" role="alert"><strong>Your past events couldn&rsquo;t be loaded.</strong><span> Refresh the page in a moment.</span></div>}
 <section className="section"><div className="claims-list">{loading?<div className="empty-card">Loading your past events…</div>:claims.length?claims.map(c=>{const d=c.display??UNKNOWN;return <div className="claim-session-entry" key={c.id} data-testid="claim-entry">
  <Link className="claim-session-card" href={`/claims/${c.id}`}><div className="claim-session-icon"><Icon name="claims"/></div><div><strong>{c.event_summary??"Claim"}</strong><span>{c.display_name} · {c.relationship}</span><small>Updated {sgDate(c.updated_at)}</small></div><div className={`claim-session-status tone-${d.tone}`} data-testid="claim-status" data-tone={d.tone}>{d.label}</div><b><Icon name="chevronRight"/></b></Link>
  {d.tone==="info"
   ?<Link className="claim-pack-link" href={c.conversation_id?`/chat?conversation=${c.conversation_id}`:`/chat?member=${c.family_member_id}`}>Continue answering questions →</Link>
   :d.requestedDocuments.length
    ?<Link className="claim-pack-link" href={`/claims/${c.id}`} data-testid="claim-requested-documents">Upload: {d.requestedDocuments.slice(0,3).join("; ")}{d.requestedDocuments.length>3?"; …":""} →</Link>
    :<Link className="claim-pack-link" href={`/claims/${c.id}`}>Open this claim →</Link>}
 </div>;}):<div className="empty-card">Nothing here yet. When something happens, such as an accident, a diagnosis or a hospital stay, ask DearPolicy what your documents say about it.</div>}</div></section>
 </div>;
}
